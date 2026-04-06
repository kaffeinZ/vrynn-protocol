/**
 * MarginFi protocol integration.
 *
 * Compatibility notes:
 *  1. @mrgnlabs/marginfi-client-v2 v6.x calls mrgn-common's
 *     chunkedGetRawMultipleAccountInfoOrdered which uses Connection._rpcBatchRequest
 *     internally. Helius free tier blocks batch RPC → we serialise each batch request
 *     into individual _rpcRequest calls via patchConnectionForHelius().
 *  2. Some on-chain bank accounts have oracle Union variants that this SDK version
 *     can't decode (buffer-layout throws). We silence those via a BorshAccountsCoder
 *     patch and the SDK's own assetTag < KAMINO filter drops the broken entries.
 *
 * Both patches are applied lazily on first call and are idempotent.
 */

import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { MarginfiClient, getConfig, MarginRequirementType } from '@mrgnlabs/marginfi-client-v2';
import { Keypair } from '@solana/web3.js';
import { connection } from '../rpc.js';

// ── Patches (applied once) ────────────────────────────────────────────────

let _patched = false;

function applyPatches() {
  if (_patched) return;
  _patched = true;

  // Patch 1: silence unrecognised Borsh oracle variants so unknown bank types
  // don't crash the full bank.all() scan; SDK's assetTag filter removes them.
  const origDecode = BorshAccountsCoder.prototype.decode;
  BorshAccountsCoder.prototype.decode = function (name, data) {
    try {
      return origDecode.call(this, name, data);
    } catch {
      return { config: { assetTag: 999 } };
    }
  };

  // Patch 2: serialise _rpcBatchRequest calls so Helius free tier doesn't 403.
  const origBatch = connection._rpcBatchRequest.bind(connection);
  connection._rpcBatchRequest = async (requests) => {
    // If only one request, let the original path handle it (faster).
    if (requests.length === 1) {
      try { return await origBatch(requests); } catch { /* fall through */ }
    }
    const results = [];
    for (const req of requests) {
      try {
        results.push(await connection._rpcRequest(req.methodName, req.args));
      } catch {
        results.push({ result: { value: [] } });
      }
    }
    return results;
  };
}

// ── Singleton client ───────────────────────────────────────────────────────

let _client = null;
let _clientLoadedAt = 0;
const CLIENT_TTL_MS = 10 * 60 * 1000; // re-fetch bank metadata every 10 min

async function getClient() {
  const now = Date.now();
  if (_client && now - _clientLoadedAt < CLIENT_TTL_MS) return _client;

  applyPatches();

  // Read-only dummy wallet — we never sign anything from the server.
  const readonlyWallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async (t) => t,
    signAllTransactions: async (ts) => ts,
  };

  _client = await MarginfiClient.fetch(getConfig('production'), readonlyWallet, connection);
  _clientLoadedAt = now;
  return _client;
}

// ── Token balances ─────────────────────────────────────────────────────────

/**
 * Returns the token balances for all active MarginFi positions of a wallet,
 * without needing a borrow/lend relationship. Useful for the "what tokens
 * does this wallet hold inside MarginFi?" view.
 */
export async function getMarginFiTokenBalances(walletAddress) {
  const client = await getClient();
  const accounts = await client.getMarginfiAccountsForAuthority(walletAddress);
  if (!accounts.length) return [];

  const balances = [];
  for (const acc of accounts) {
    for (const b of acc.activeBalances) {
      const bank = client.getBankByPk(b.bankPk);
      if (!bank) continue;
      const oracle = client.getOraclePriceByBank(bank.address);
      const price = parseFloat(oracle?.priceRealtime?.price ?? '0');
      const qty = b.computeQuantityUi(bank);
      balances.push({
        token: bank.tokenSymbol,
        mint: bank.mint.toString(),
        assetQty: qty.assets.toNumber(),
        liabilityQty: qty.liabilities.toNumber(),
        priceUsd: price,
        assetUsd: qty.assets.toNumber() * price,
        liabilityUsd: qty.liabilities.toNumber() * price,
      });
    }
  }
  return balances;
}

// ── Positions ──────────────────────────────────────────────────────────────

/**
 * Returns all MarginFi lending positions for a wallet address.
 * Each entry represents one MarginFi account (a wallet can have several).
 *
 * Shape:
 * {
 *   protocol:       'marginfi',
 *   accountAddress: string,
 *   collateralUsd:  number,
 *   borrowUsd:      number,
 *   healthFactor:   number | null,   // null = no debt (infinite)
 *   riskLevel:      'SAFE' | 'WARNING' | 'HIGH' | 'CRITICAL',
 *   balances: [{
 *     token, mint, assetQty, liabilityQty, priceUsd, assetUsd, liabilityUsd
 *   }]
 * }
 */
export async function getMarginFiPositions(walletAddress) {
  const client = await getClient();
  const accounts = await client.getMarginfiAccountsForAuthority(walletAddress);
  if (!accounts.length) return [];

  return accounts.map((acc) => {
    const { assets, liabilities } = acc.computeHealthComponents(MarginRequirementType.Maintenance);
    const collateralUsd = assets.toNumber();
    const borrowUsd = liabilities.toNumber();
    const healthFactor = liabilities.isZero() ? null : assets.div(liabilities).toNumber();
    const riskLevel = classifyRisk(healthFactor);

    const balances = acc.activeBalances.map((b) => {
      const bank = client.getBankByPk(b.bankPk);
      const oracle = client.getOraclePriceByBank(bank?.address);
      const price = parseFloat(oracle?.priceRealtime?.price ?? '0');
      const qty = b.computeQuantityUi(bank);
      return {
        token: bank?.tokenSymbol ?? 'UNKNOWN',
        mint: bank?.mint.toString() ?? '',
        assetQty: qty.assets.toNumber(),
        liabilityQty: qty.liabilities.toNumber(),
        priceUsd: price,
        assetUsd: qty.assets.toNumber() * price,
        liabilityUsd: qty.liabilities.toNumber() * price,
      };
    });

    return {
      protocol: 'marginfi',
      accountAddress: acc.address.toString(),
      collateralUsd,
      borrowUsd,
      healthFactor,
      riskLevel,
      balances,
    };
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function classifyRisk(hf) {
  if (hf === null) return 'SAFE';       // no debt
  if (hf >= 2.0)   return 'SAFE';
  if (hf >= 1.5)   return 'WARNING';
  if (hf >= 1.2)   return 'HIGH';
  return 'CRITICAL';
}
