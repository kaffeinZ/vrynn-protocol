import { notifyAdmin } from './notify.js';
import { cachedFetch } from './httpCache.js';

const CG = 'https://api.coingecko.com/api/v3';

/**
 * Curated sector allowlist — twelve, fixed.
 *
 * Small and fixed on purpose. Mass-generating a page per CoinGecko category
 * would be thin near-duplicate content, which a young domain cannot afford.
 * Every id below was verified against /coins/categories on 2026-08-08 and each
 * aggregate was checked against its own top-3 constituents.
 *
 * Deliberately excluded:
 *   solana-ecosystem      — market_cap / change / volume all null, renders nothing.
 *                           REVISIT: this is the home audience. If CoinGecko starts
 *                           returning real numbers (or we sum constituents ourselves)
 *                           it earns a thirteenth slot on audience fit alone.
 *   liquid-staking-tokens — aggregate broken: reported $26.9M vs $34.1B for its own
 *                           top 3. Plausible-looking and completely wrong.
 *   smart-contract-platform — ~duplicate of layer-1; two near-identical pages is a
 *                           self-inflicted duplicate-content signal.
 */
export const SECTORS = [
  { slug: 'ai',          cgId: 'artificial-intelligence',    label: 'AI' },
  { slug: 'l1',          cgId: 'layer-1',                    label: 'Layer 1' },
  { slug: 'l2',          cgId: 'layer-2',                    label: 'Layer 2' },
  { slug: 'rwa',         cgId: 'real-world-assets-rwa',      label: 'RWA' },
  { slug: 'depin',       cgId: 'depin',                      label: 'DePIN' },
  { slug: 'memes',       cgId: 'meme-token',                 label: 'Memecoins' },
  { slug: 'defi',        cgId: 'decentralized-finance-defi', label: 'DeFi' },
  { slug: 'gaming',      cgId: 'gaming',                     label: 'Gaming' },
  { slug: 'privacy',     cgId: 'privacy-coins',              label: 'Privacy' },
  { slug: 'stablecoins', cgId: 'stablecoins',                label: 'Stablecoins', flowsRead: true },
  { slug: 'exchange',    cgId: 'exchange-based-tokens',      label: 'Exchange tokens' },
  { slug: 'base',        cgId: 'base-native',                label: 'Base ecosystem' },
];

export const sectorBySlug = (slug) => SECTORS.find(s => s.slug === slug) ?? null;

/** All categories in one call. */
export async function fetchCategories() {
  const res = await cachedFetch(`${CG}/coins/categories`);
  if (!res.ok) throw new Error(`coingecko /coins/categories ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('coingecko /coins/categories: unexpected shape');
  return json;
}

/** Market caps for a set of coin ids — used to sanity-check sector aggregates. */
async function fetchCoinCaps(ids) {
  if (!ids.length) return {};
  const res = await cachedFetch(`${CG}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&per_page=250`);
  if (!res.ok) return {};
  const rows = await res.json();
  return Object.fromEntries((rows ?? []).map(c => [c.id, c.market_cap ?? 0]));
}

/**
 * Runtime plausibility guard — the main event, not a backstop.
 *
 * Curation removes the two categories known bad today. This catches the one
 * CoinGecko breaks next month, when nobody is looking. The failure mode that
 * matters is not "page won't render" (visible) but "page renders a plausible
 * wrong number" (invisible), so a rejected sector is skipped AND reported.
 *
 * Rejects when:
 *   - market_cap is null/0
 *   - market_cap_change_24h is null (a page that cannot state its own move has
 *     nothing to synthesize)
 *   - the aggregate is below the sum of its own top-3 constituents, which is
 *     arithmetically impossible and is exactly how liquid-staking-tokens failed
 */
export async function validateCategory(cat) {
  if (!cat)                                return { ok: false, reason: 'category not returned by CoinGecko' };
  if (!cat.market_cap)                     return { ok: false, reason: 'market_cap null or zero' };
  if (cat.market_cap_change_24h == null)   return { ok: false, reason: 'market_cap_change_24h null' };

  const topIds = cat.top_3_coins_id ?? [];
  if (topIds.length) {
    const caps = await fetchCoinCaps(topIds);
    const top3 = Object.values(caps).reduce((a, b) => a + (b || 0), 0);
    if (top3 > 0 && cat.market_cap < top3 * 0.95) {
      return {
        ok: false,
        reason: `aggregate below its own top-3 constituents ` +
                `($${(cat.market_cap / 1e9).toFixed(2)}B vs $${(top3 / 1e9).toFixed(2)}B — ` +
                `off by ${(top3 / cat.market_cap).toFixed(0)}x)`,
      };
    }
  }
  return { ok: true };
}

/** The synthesis input for one sector: its own numbers + the day's shared macro. */
export function buildSectorState(sector, cat, marketState) {
  return {
    date:      marketState.date,
    as_of_utc: marketState.as_of_utc,
    sector: {
      slug:  sector.slug,
      label: sector.label,
      // The moment the shared category snapshot was taken — not "now". The sector
      // run happens minutes after the fetch, so stamping now would overstate how
      // fresh the numbers are.
      fetched_utc: marketState?.sector_source?.fetched_utc ?? marketState?.as_of_utc ?? new Date().toISOString(),
      market_cap_usd:        cat.market_cap,
      market_cap_change_24h: +Number(cat.market_cap_change_24h).toFixed(2),
      volume_24h_usd:        cat.volume_24h ?? null,
      top_coins:             cat.top_3_coins_id ?? [],
      // Stablecoin caps barely move by design; the signal is supply direction.
      read_as_flows:         sector.flowsRead === true,
    },
    market: {
      total_market_cap_usd:            marketState.market?.total_market_cap_usd ?? null,
      total_market_cap_change_24h_pct: marketState.market?.total_market_cap_change_24h_pct ?? null,
    },
    // Reused as-is from the daily brief so a sector read can reference the same
    // completed prints, under the same completed-vs-scheduled discipline.
    macro: marketState.macro ?? { scheduled: [], completed: [] },
    sentiment: marketState.sentiment ?? null,
  };
}

// ── Sector spike detection ──────────────────────────────────────────────────
//
// A NOTIFICATION, not a ranking. A ranker is obliged to return a winner every
// day, which is what drags junk to the top — measured 2026-08-08, the catalogue's
// top movers were `zodiac-themed +222%` ($1M cap) and a `-100.00%` broken
// aggregate. This fires only when a candidate clears every bar, and is otherwise
// silent. Silence is the normal output.
//
// Every check runs HERE, in code, before the model is handed anything. A model
// cannot verify an aggregate, and a broken -100% reads to it as a dramatic and
// highly reportable fact. Filtering is code's job; prose is the model's.

const SPIKE_MOVE_PCT     = 8;     // sector must move at least this much
const SPIKE_DIVERGE_PP   = 5;     // ...and diverge this far from the whole market
const SPIKE_CAP_FLOOR    = 1e9;   // $1B — measured: $200M leaves 2/20, $1B leaves 1/20
const SPIKE_MIN_COINS    = 8;     // a three-token "ecosystem" cannot qualify
const SPIKE_MAX_DIVERGENCE_FROM_CONSTITUENTS = 12; // pp; beyond this the aggregate is broken

// A move this size or larger MUST be verified against constituents before it is
// published. Below it, an unverifiable move ships — the downside is bounded, and
// rejecting on a transient API failure would take out every sector at once.
const UNVERIFIED_MOVE_CEILING = 5;      // percent
const CONSTITUENT_CALL_SPACING_MS = 1500;

/**
 * Cross-validate a category's 24h change against its own constituents.
 *
 * `validateCategory` only ever checked the CAP (is it ≥ the top-3 sum). RWA
 * passed that on 2026-08-09 while reporting −34.93%, because its cap fell from
 * $62.8B to $40.4B — CoinGecko dropping a constituent, not a price move. The
 * site published "RWA sector plunges 35%" against a constituent reality of
 * −0.48%. A composition change is not a market move and must never be reported
 * as one.
 *
 * The comparison is CAP-WEIGHTED. The category figure is cap-weighted, so an
 * equal-weighted mean would falsely reject legitimate moves where one large
 * constituent carries the sector.
 */
export async function validateChangeAgainstConstituents(cgId, categoryChange, maxDivergencePp = 10) {
  let coins;
  try { coins = await fetchCategoryConstituents(cgId); }
  catch (err) { return { ok: false, reason: `constituent fetch failed: ${err.message}`, unverifiable: true }; }

  const usable = coins.filter(c =>
    typeof c.price_change_percentage_24h === 'number' &&
    Number.isFinite(c.price_change_percentage_24h) &&
    typeof c.market_cap === 'number' && c.market_cap > 0);

  if (usable.length < 5) return { ok: false, reason: `only ${usable.length} usable constituents`, unverifiable: true };

  const totalCap = usable.reduce((a, c) => a + c.market_cap, 0);
  const weighted = usable.reduce((a, c) => a + c.price_change_percentage_24h * (c.market_cap / totalCap), 0);
  const gap = Math.abs(categoryChange - weighted);

  if (gap > maxDivergencePp) {
    return {
      ok: false,
      reason: `24h change disagrees with constituents — category ${categoryChange.toFixed(2)}% vs ` +
              `cap-weighted ${weighted.toFixed(2)}% across ${usable.length} coins (${gap.toFixed(1)}pp gap). ` +
              `Usually a composition change, not a market move.`,
      weighted, count: usable.length,
    };
  }
  return { ok: true, weighted, count: usable.length, coins: usable };
}

/** Constituents of a category, for the count and the cross-validation. */
async function fetchCategoryConstituents(cgId) {
  const res = await cachedFetch(
    `${CG}/coins/markets?vs_currency=usd&category=${encodeURIComponent(cgId)}&per_page=50&price_change_percentage=24h`,
  );
  if (!res.ok) throw new Error(`coingecko /coins/markets ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/**
 * Returns a spike object or null. Only curated sectors are considered — the
 * catalogue-wide version is the one the measurement showed to be unsafe.
 */
export async function detectSectorSpike(cats, marketChangePct) {
  if (marketChangePct == null) return null;
  const byId = new Map(cats.map(c => [c.id, c]));

  for (const sector of SECTORS) {
    const cat = byId.get(sector.cgId);
    if (!cat) continue;

    const move = cat.market_cap_change_24h;
    if (move == null) continue;
    if (Math.abs(move) < SPIKE_MOVE_PCT) continue;                     // not a spike
    if (Math.abs(move - marketChangePct) < SPIKE_DIVERGE_PP) continue; // moved with the market
    if (!cat.market_cap || cat.market_cap < SPIKE_CAP_FLOOR) continue; // too small to mean anything

    const base = await validateCategory(cat);
    if (!base.ok) {
      await notifyAdmin(`spike candidate ${sector.slug} failed the base guard`, base.reason);
      continue;
    }

    // Cross-validate against the constituents themselves. If the aggregate claims
    // +30% while its own coins average +4%, the aggregate is broken — this is the
    // check that would have caught liquid-staking-tokens automatically.
    const cross = await validateChangeAgainstConstituents(
      sector.cgId, move, SPIKE_MAX_DIVERGENCE_FROM_CONSTITUENTS);
    if (!cross.ok) {
      await notifyAdmin(`spike candidate ${sector.slug} rejected`, cross.reason);
      continue;   // unverifiable or broken means not published
    }
    if (cross.count < SPIKE_MIN_COINS) continue;
    const coins = cross.coins, mean = cross.weighted;

    return {
      slug: sector.slug,
      label: sector.label,
      market_cap_change_24h: +move.toFixed(2),
      market_change_24h_pct: +marketChangePct.toFixed(2),
      divergence_pp: +(move - marketChangePct).toFixed(2),
      constituent_weighted_24h_pct: +mean.toFixed(2),
      constituent_count: cross.count,
      top_movers: coins
        .filter(c => typeof c.price_change_percentage_24h === 'number')
        .sort((a, b) => Math.abs(b.price_change_percentage_24h) - Math.abs(a.price_change_percentage_24h))
        .slice(0, 3)
        .map(c => ({ name: c.name, symbol: (c.symbol || '').toUpperCase(),
                     change_24h_pct: +c.price_change_percentage_24h.toFixed(2) })),
    };
  }
  return null;   // the common case
}

/** Fetch, validate and build state for every curated sector. Rejects are reported. */
export async function buildAllSectorStates(marketState) {
  // Prefer the snapshot the brief already took. Fetching again here would give
  // the sector pages a different moment from the market figure they are compared
  // against — which is precisely the 270-minute mismatch seen on 2026-08-11.
  const reused = marketState?.sector_source?.categories;
  const cats = Array.isArray(reused) && reused.length ? reused : await fetchCategories();
  if (!reused?.length) console.warn('[sectors] no snapshot in market_state — fetching separately');
  const byId = new Map(cats.map(c => [c.id, c]));
  const built = [];
  const skipped = [];

  for (const sector of SECTORS) {
    const cat = byId.get(sector.cgId);
    const check = await validateCategory(cat);
    if (!check.ok) {
      skipped.push({ slug: sector.slug, reason: check.reason });
      continue;
    }

    // The cap passing is not enough — RWA proved the 24h change can be broken
    // while the cap looks fine. Publishing nothing beats publishing a false move.
    const changeCheck = await validateChangeAgainstConstituents(sector.cgId, cat.market_cap_change_24h);

    if (!changeCheck.ok) {
      // Verification is required in proportion to the size of the claim.
      //
      // A hard "unverifiable = reject" is wrong: one transient 429 would wipe out
      // every sector page at once (observed — 11 of 12 rejected on `n/a` during
      // testing). But blanket-accepting unverified data is the hole RWA fell
      // through. The split: a composition-change artefact shows up as a LARGE
      // spurious move (RWA was −34%), so an unverifiable small move has bounded
      // downside and ships, while an unverifiable large move is exactly the case
      // where verification mattered and it does not.
      const move = Math.abs(cat.market_cap_change_24h);
      if (changeCheck.unverifiable && move < UNVERIFIED_MOVE_CEILING) {
        console.warn(`[sectors] ${sector.slug}: unverified (${changeCheck.reason}) but move is ` +
                     `${move.toFixed(2)}% — under the ${UNVERIFIED_MOVE_CEILING}% ceiling, shipping`);
      } else {
        skipped.push({ slug: sector.slug, reason: changeCheck.reason });
        continue;
      }
    }

    // Space the constituent calls out — twelve back-to-back is enough to trip
    // CoinGecko's free tier, which is what produced the false rejections above.
    await new Promise(r => setTimeout(r, CONSTITUENT_CALL_SPACING_MS));

    built.push({ sector, state: buildSectorState(sector, cat, marketState) });
  }

  if (skipped.length) {
    await notifyAdmin(
      `sector guard rejected ${skipped.length}/${SECTORS.length}`,
      skipped.map(s => `  ${s.slug}: ${s.reason}`).join('\n'),
    );
  }
  return { built, skipped };
}
