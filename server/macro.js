import { config } from './config.js';
import { BLS_SERIES, FRED_SERIES } from './macroSeries.js';
import { getMacroPeriod, setMacroPeriod } from './db.js';

const BLS_V1 = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const FRED   = 'https://api.stlouisfed.org/fred/series/observations';

const num = (v) => (v == null || v === '.' ? null : Number(String(v).replace(/,/g, '')));

/**
 * BLS via the keyless v1 endpoint. One POST covers every series.
 * v1 returns raw values only, so YoY is derived from the observation 12 months
 * back rather than a `calculations` block (which is v2-only).
 */
export async function fetchBls() {
  const ids  = Object.values(BLS_SERIES).map(s => s.id);
  // Two years back: in January the newest print is December, whose year-ago
  // comparison sits two calendar years behind the current one.
  const year = new Date().getUTCFullYear();

  const res = await fetch(BLS_V1, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seriesid: ids, startyear: String(year - 2), endyear: String(year) }),
  });
  if (!res.ok) throw new Error(`BLS ${res.status}`);

  const json = await res.json();
  if (json.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS: ${JSON.stringify(json.message)}`);

  const out = {};
  for (const series of json?.Results?.series ?? []) {
    const entry = Object.entries(BLS_SERIES).find(([, s]) => s.id === series.seriesID);
    if (!entry) continue;
    const [event, cfg] = entry;
    const obs = series.data ?? [];          // newest first
    if (!obs.length) continue;

    const latest = obs[0];
    const prior  = obs[1];
    const yearAgo = (o, back = 1) => obs.find(
      x => x.year === String(Number(o.year) - back) && x.period === o.period,
    );

    let actual = null, previous = null;
    if (cfg.mode === 'yoy') {
      const la = yearAgo(latest);
      const pa = prior ? yearAgo(prior) : null;
      if (la) actual   = +(((num(latest.value) / num(la.value)) - 1) * 100).toFixed(2);
      if (prior && pa) previous = +(((num(prior.value) / num(pa.value)) - 1) * 100).toFixed(2);
    } else if (cfg.mode === 'delta') {
      if (prior)     actual   = +(num(latest.value) - num(prior.value)).toFixed(1);
      if (obs[2])    previous = +(num(prior.value)  - num(obs[2].value)).toFixed(1);
    } else {
      actual   = num(latest.value);
      previous = prior ? num(prior.value) : null;
    }

    if (actual == null) continue;
    out[event] = {
      event, actual, previous, unit: cfg.unit,
      period: `${latest.year}-${latest.period.replace('M', '')}`,
      seriesId: series.seriesID,
    };
  }
  return out;
}

/** FRED — one GET per series. `pc1` yields a 12-month % change for index series. */
export async function fetchFred() {
  const out = {};
  await Promise.all(Object.entries(FRED_SERIES).map(async ([event, cfg]) => {
    try {
      const url = `${FRED}?series_id=${cfg.id}&api_key=${config.fredApiKey}`
                + `&file_type=json&sort_order=desc&limit=2&units=${cfg.units}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const obs = ((await res.json())?.observations ?? []).filter(o => o.value !== '.');
      if (!obs.length) return;
      out[event] = {
        event,
        actual:   +num(obs[0].value).toFixed(2),
        previous: obs[1] ? +num(obs[1].value).toFixed(2) : null,
        unit: cfg.unit,
        period: obs[0].date,
        seriesId: cfg.id,
        onChangeOnly: cfg.onChangeOnly === true,
      };
    } catch { /* one bad series must not sink the batch */ }
  }));
  return out;
}

/**
 * A series counts as newly released when its latest period advances past the one
 * we last recorded. No release calendar to guess at, and it self-corrects if a
 * run is missed. Returns [] on a day with no new prints, which is the common case
 * and is correct — an empty list supports a "no clear catalyst" read.
 */
export function detectCompleted(all, { seed = false } = {}) {
  const completed = [];
  const now = new Date().toISOString();

  for (const item of Object.values(all)) {
    if (item.actual == null) continue;
    const seen = getMacroPeriod(item.seriesId);
    if (seen === item.period) continue;

    setMacroPeriod(item.seriesId, item.period, now);
    // Seeding records current periods without reporting them as fresh releases,
    // so the first live run doesn't dump a year of prints into one brief.
    if (seed || seen == null) continue;

    // Daily series (e.g. the Fed funds target) advance their period every day.
    // For those, only an actual change in the value counts as an event.
    if (item.onChangeOnly && item.previous != null && item.actual === item.previous) continue;

    completed.push({
      event: item.event, actual: item.actual, previous: item.previous,
      unit: item.unit, period: item.period, detected_utc: now,
    });
  }
  return completed;
}

/** Gather both sources and return the releases that landed since the last brief. */
export async function fetchMacroCompleted(opts = {}) {
  const [bls, fred] = await Promise.all([
    fetchBls().catch(err => { console.error('[macro] BLS failed:', err.message);  return {}; }),
    fetchFred().catch(err => { console.error('[macro] FRED failed:', err.message); return {}; }),
  ]);
  return detectCompleted({ ...bls, ...fred }, opts);
}
