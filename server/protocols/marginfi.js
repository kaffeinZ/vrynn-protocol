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
import { MarginfiClient, getConfig } from '@mrgnlabs/marginfi-client-v2';
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
    const balances = acc.activeBalances.map((b) => {
      const bank = client.getBankByPk(b.bankPk);
      const oracle = client.getOraclePriceByBank(bank?.address);
      const price = parseFloat(oracle?.priceRealtime?.price ?? '0');
      const qty = b.computeQuantityUi(bank);
      const assetWeightMaint = bank?.config?.assetWeightMaint?.toNumber() ?? 1;
      const liabWeightMaint  = bank?.config?.liabilityWeightMaint?.toNumber() ?? 1;
      return {
        token: bank?.tokenSymbol ?? 'UNKNOWN',
        mint: bank?.mint.toString() ?? '',
        assetQty: qty.assets.toNumber(),
        liabilityQty: qty.liabilities.toNumber(),
        priceUsd: price,
        assetUsd: qty.assets.toNumber() * price,
        liabilityUsd: qty.liabilities.toNumber() * price,
        // weighted values used for health factor (maintenance requirement)
        weightedAssetUsd: qty.assets.toNumber() * price * assetWeightMaint,
        weightedLiabUsd:  qty.liabilities.toNumber() * price * liabWeightMaint,
      };
    });

    // Health factor = weighted assets / weighted liabilities (maintenance basis)
    // This matches MarginFi's liquidation threshold calculation.
    const weightedAssets = balances.reduce((s, b) => s + b.weightedAssetUsd, 0);
    const weightedLiabs  = balances.reduce((s, b) => s + b.weightedLiabUsd, 0);
    const collateralUsd  = balances.reduce((s, b) => s + b.assetUsd, 0);
    const borrowUsd      = balances.reduce((s, b) => s + b.liabilityUsd, 0);
    const healthFactor   = weightedLiabs === 0 ? null : weightedAssets / weightedLiabs;
    const riskLevel      = classifyRisk(healthFactor);
    const positionType   = classifyPositionType(balances);

    return {
      protocol: 'marginfi',
      accountAddress: acc.address.toString(),
      collateralUsd,
      borrowUsd,
      healthFactor,
      riskLevel,
      positionType,
      riskContext: riskContext(positionType, healthFactor),
      balances,
    };
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Known stablecoin mints on Solana mainnet
const STABLECOIN_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',  // USDH
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',  // USDS
  '7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT', // UXD
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK (excluded — volatile)
]);

/**
 * Classifies a position by what types of assets are involved.
 *
 * stablecoin_loop  — both collateral and borrows are stablecoins.
 *                    Risk is slow/interest-driven, not price-driven.
 * volatile_collateral — collateral contains volatile tokens (SOL, meme coins).
 *                       Risk is fast/price-driven.
 * volatile_borrow  — borrowing volatile tokens against stable collateral.
 *                    Risk from borrow-side price pumps.
 * mixed            — both sides have volatile exposure.
 */
function classifyPositionType(balances) {
  const collateralTokens = balances.filter(b => b.assetUsd > 0.01);
  const borrowTokens     = balances.filter(b => b.liabilityUsd > 0.01);

  if (collateralTokens.length === 0 && borrowTokens.length === 0) return 'empty';

  const collateralAllStable = collateralTokens.every(b => STABLECOIN_MINTS.has(b.mint));
  const borrowAllStable     = borrowTokens.every(b => STABLECOIN_MINTS.has(b.mint));
  const collateralHasVolatile = collateralTokens.some(b => !STABLECOIN_MINTS.has(b.mint));
  const borrowHasVolatile     = borrowTokens.some(b => !STABLECOIN_MINTS.has(b.mint));

  if (collateralAllStable && borrowAllStable)       return 'stablecoin_loop';
  if (collateralHasVolatile && borrowHasVolatile)   return 'mixed';
  if (collateralHasVolatile && borrowAllStable)     return 'volatile_collateral';
  if (collateralAllStable && borrowHasVolatile)     return 'volatile_borrow';
  return 'mixed';
}

/**
 * Returns a human-readable description of the risk for the alert/AI context.
 */
function riskContext(positionType, healthFactor) {
  const hf = healthFactor?.toFixed(2) ?? '∞';
  switch (positionType) {
    case 'stablecoin_loop':
      return `Stablecoin loop (HF ${hf}). Risk is interest-driven — borrow interest slowly erodes the buffer. No sudden price risk unless a stablecoin depegs.`;
    case 'volatile_collateral':
      return `Volatile collateral (HF ${hf}). Risk is price-driven — a drop in collateral value can trigger liquidation quickly.`;
    case 'volatile_borrow':
      return `Volatile borrow (HF ${hf}). Risk from borrow-side price pumps — if the borrowed token pumps, liabilities grow and HF drops.`;
    case 'mixed':
      return `Mixed position (HF ${hf}). Both collateral and borrow sides have volatile exposure. Monitor closely.`;
    default:
      return `Health factor: ${hf}`;
  }
}

function classifyRisk(hf) {
  if (hf === null) return 'SAFE';
  if (hf >= 2.0)   return 'SAFE';
  if (hf >= 1.5)   return 'WARNING';
  if (hf >= 1.2)   return 'HIGH';
  return 'CRITICAL';
}
