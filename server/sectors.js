import { notifyAdmin } from './notify.js';

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
  const res = await fetch(`${CG}/coins/categories`);
  if (!res.ok) throw new Error(`coingecko /coins/categories ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('coingecko /coins/categories: unexpected shape');
  return json;
}

/** Market caps for a set of coin ids — used to sanity-check sector aggregates. */
async function fetchCoinCaps(ids) {
  if (!ids.length) return {};
  const res = await fetch(`${CG}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&per_page=250`);
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

/** Fetch, validate and build state for every curated sector. Rejects are reported. */
export async function buildAllSectorStates(marketState) {
  const cats = await fetchCategories();
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
