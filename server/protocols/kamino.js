/**
 * Kamino Lend protocol integration via Kamino's public REST API.
 *
 * Uses /kamino-market/{market}/users/{wallet}/obligations to fetch
 * all user lending positions across all Kamino markets.
 */

const KAMINO_API   = 'https://api.kamino.finance';
const MARKETS_TTL  = 10 * 60 * 1000; // 10 min cache
const SF_SCALE     = 1e18;            // marketValueSf denominator

// ── Cache ─────────────────────────────────────────────────────────────────

let _markets        = null;
let _marketsAt      = 0;
// reservePubkey → { token, mint }  per marketPubkey
const _reserveCache = new Map();
const _reserveCacheAt = new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kamino API ${res.status}: ${url}`);
  return res.json();
}

async function getMarkets() {
  if (_markets && Date.now() - _marketsAt < MARKETS_TTL) return _markets;
  const data = await fetchJson(`${KAMINO_API}/v2/kamino-market`);
  _markets   = data.map((m) => m.lendingMarket);
  _marketsAt = Date.now();
  return _markets;
}

async function getReserveMap(marketPubkey) {
  if (_reserveCache.has(marketPubkey) && Date.now() - (_reserveCacheAt.get(marketPubkey) ?? 0) < MARKETS_TTL) {
    return _reserveCache.get(marketPubkey);
  }
  let metrics;
  try {
    metrics = await fetchJson(`${KAMINO_API}/kamino-market/${marketPubkey}/reserves/metrics`);
  } catch {
    return new Map();
  }
  const map = new Map();
  for (const r of metrics) {
    map.set(r.reserve, { token: r.liquidityToken ?? 'UNKNOWN', mint: r.liquidityTokenMint ?? '' });
  }
  _reserveCache.set(marketPubkey, map);
  _reserveCacheAt.set(marketPubkey, Date.now());
  return map;
}

// ── Parsing helpers ───────────────────────────────────────────────────────

const NULL_PUBKEY = '11111111111111111111111111111111';

function sfToUsd(sf) {
  return parseFloat(sf || '0') / SF_SCALE;
}

function classifyRisk(hf) {
  if (hf === null) return 'SAFE';
  if (hf >= 2.0)   return 'SAFE';
  if (hf >= 1.5)   return 'WARNING';
  if (hf >= 1.2)   return 'HIGH';
  return 'CRITICAL';
}

function riskContext(positionType, healthFactor) {
  const hf = healthFactor?.toFixed(2) ?? '∞';
  switch (positionType) {
    case 'stablecoin_loop':   return `Stablecoin loop (HF ${hf}). Risk is interest-driven — borrow interest slowly erodes the buffer.`;
    case 'volatile_collateral': return `Volatile collateral (HF ${hf}). A drop in collateral value can trigger liquidation quickly.`;
    case 'volatile_borrow':   return `Volatile borrow (HF ${hf}). If the borrowed token pumps, liabilities grow and HF drops.`;
    default:                  return `Health factor: ${hf}`;
  }
}

const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'USDH', 'USDS', 'UXD', 'UST', 'DAI', 'PYUSD', 'USDe', 'EUSD']);

function classifyPositionType(deposits, borrows) {
  const collStable = deposits.every((d) => STABLECOIN_SYMBOLS.has(d.token));
  const borrStable  = borrows.every((b) => STABLECOIN_SYMBOLS.has(b.token));
  const collVol = deposits.some((d) => !STABLECOIN_SYMBOLS.has(d.token));
  const borrVol  = borrows.some((b) => !STABLECOIN_SYMBOLS.has(b.token));

  if (collStable && borrStable)  return 'stablecoin_loop';
  if (collVol    && borrStable)  return 'volatile_collateral';
  if (collStable && borrVol)     return 'volatile_borrow';
  return 'mixed';
}

// ── Obligation parsing ────────────────────────────────────────────────────

function parseObligation(obligation, marketPubkey, reserveMap) {
  const { state, refreshedStats, obligationAddress } = obligation;

  const ltv     = parseFloat(refreshedStats?.loanToValue    ?? '0');
  const liqLtv  = parseFloat(refreshedStats?.liquidationLtv ?? '0');
  const healthFactor = ltv > 0 ? liqLtv / ltv : null;

  const collateralUsd = parseFloat(refreshedStats?.userTotalDeposit ?? '0');
  const borrowUsd     = parseFloat(refreshedStats?.userTotalBorrow   ?? '0');

  // Build deposit balances
  const depositBalances = (state?.deposits ?? [])
    .filter((d) => d.depositReserve !== NULL_PUBKEY && d.depositedAmount !== '0')
    .map((d) => {
      const meta    = reserveMap.get(d.depositReserve) ?? { token: d.depositReserve.slice(0, 6), mint: '' };
      const assetUsd = sfToUsd(d.marketValueSf);
      return {
        token:       meta.token,
        mint:        meta.mint,
        assetQty:    0,          // raw qty not needed for health factor display
        liabilityQty: 0,
        priceUsd:    0,
        assetUsd,
        liabilityUsd: 0,
        weightedAssetUsd: assetUsd,
        weightedLiabUsd:  0,
      };
    });

  // Build borrow balances
  const borrowBalances = (state?.borrows ?? [])
    .filter((b) => b.borrowReserve !== NULL_PUBKEY && parseFloat(b.borrowedAmountSf ?? '0') > 0)
    .map((b) => {
      const meta       = reserveMap.get(b.borrowReserve) ?? { token: b.borrowReserve.slice(0, 6), mint: '' };
      const liabilityUsd = sfToUsd(b.marketValueSf);
      return {
        token:        meta.token,
        mint:         meta.mint,
        assetQty:     0,
        liabilityQty: 0,
        priceUsd:     0,
        assetUsd:     0,
        liabilityUsd,
        weightedAssetUsd: 0,
        weightedLiabUsd:  liabilityUsd,
      };
    });

  const balances      = [...depositBalances, ...borrowBalances];
  const positionType  = borrowBalances.length
    ? classifyPositionType(depositBalances, borrowBalances)
    : 'deposit_only';
  const riskLevel     = classifyRisk(healthFactor);

  return {
    protocol:       'kamino',
    marketPubkey,
    accountAddress: obligationAddress,
    collateralUsd,
    borrowUsd,
    healthFactor,
    riskLevel,
    positionType,
    riskContext:    riskContext(positionType, healthFactor),
    balances,
  };
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Returns all Kamino Lend positions for a wallet across all markets.
 * Same shape as getMarginFiPositions().
 */
export async function getKaminoPositions(walletAddress) {
  const markets = await getMarkets();
  const results = [];

  await Promise.all(
    markets.map(async (marketPubkey) => {
      let obligations;
      try {
        obligations = await fetchJson(
          `${KAMINO_API}/kamino-market/${marketPubkey}/users/${walletAddress}/obligations`
        );
      } catch (err) {
        console.error(`[kamino] market ${marketPubkey.slice(0, 8)}… fetch failed: ${err.message}`);
        return;
      }

      if (!obligations?.length) return;

      const reserveMap = await getReserveMap(marketPubkey);

      for (const ob of obligations) {
        // Skip obligations with no collateral at all
        if (parseFloat(ob.refreshedStats?.userTotalDeposit ?? '0') < 0.01) continue;
        results.push(parseObligation(ob, marketPubkey, reserveMap));
      }
    })
  );

  return results;
}
