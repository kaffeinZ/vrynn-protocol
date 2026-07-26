import { config } from './config.js';
import { saveDailyBrief, getDailyBrief, getAllBriefs, getRecentBriefs } from './db.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CG           = 'https://api.coingecko.com/api/v3';
const FNG          = 'https://api.alternative.me/fng/';
const COINALYZE    = 'https://api.coinalyze.net/v1';
const FRED         = 'https://api.stlouisfed.org/fred';
const FF_CALENDAR  = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CT_RSS       = 'https://cointelegraph.com/rss';
const DECRYPT_RSS  = 'https://decrypt.co/feed';

// ── Synthesis prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the synthesis engine for Vrynn's daily crypto market brief. Your readers are serious, financially literate people who want to understand what happened in the market today and what it coincided with — not to be told what to do. Your entire value is disciplined honesty: you separate fact from correlation from the unknown.

You receive a JSON object, market_state, describing today's market. You produce one structured brief. Reason ONLY from the data provided. Never invent a number, event, or explanation not present in the input. If a field is null, state that data is unavailable — never guess around it.

## The cardinal rule: every claim is FACT, COINCIDENCE, or UNKNOWN

1. FACT — a number or event directly present in the data. State plainly and confidently.
2. COINCIDENCE — two facts near in time where causation is plausible but unproven. ALLOWED: "coincided with", "alongside", "against a backdrop of", "at the same time as". BANNED: "because of", "due to", "caused by", "driven by", "in response to", "triggered by", "sparked by".
3. UNKNOWN — the move has no clear correspondence to anything in the data. Say so explicitly. This is the single most trust-building thing you output.

## Mandate: name the unknown

If today's price action does not line up with any macro print, news, liquidation, or catalyst in the data, you MUST say so: "No clear catalyst — this looks like low-liquidity drift." Inventing a confident reason on a quiet day is the one failure that destroys reader trust.

## Forbidden: the advice register

Never recommend buying, selling, holding, or entering/exiting anything. No price targets, forecasts, or urgency language. Describe the weather — never tell the reader whether to carry an umbrella.

## Tone

Professional and macro-literate. Concise. No emojis. No exclamation marks. No filler ("it's important to note", "as always"). Get to the point. Assume the reader is intelligent and time-poor.

## Output

Return ONLY valid JSON in exactly this shape. No preamble, no markdown fences.

{
  "headline": "one factual line, 12 words or fewer, no verdict",
  "direction": "up | down | mixed | flat",
  "brief": "2 to 3 short paragraphs, plain text, separated by blank lines",
  "drivers": [
    { "claim": "the specific factor referenced", "type": "fact | coincidence | unknown" }
  ],
  "explained": "well-explained | partly-explained | unexplained"
}

Field rules:
- headline: purely descriptive. Good: "Market up 1.2% alongside easing US CPI." Bad: "Bullish momentum builds."
- direction: net total-market-cap move only.
- brief: lead with what moved (fact); then what it coincided with (coincidence only with associative language); then what is scheduled or noteworthy ahead.
- drivers: every factor you leaned on, tagged with epistemic status. On an unexplained day this may be a single unknown entry.
- explained: your honest read on how much of today's move the data accounts for.`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseRssTitles(xml, limit = 4) {
  if (!xml) return [];
  const items = [];
  for (const [block] of (xml.matchAll(/<item>[\s\S]*?<\/item>/g) || [])) {
    if (items.length >= limit) break;
    const m = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    if (m) {
      const title = m[1].trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;/g, "'");
      if (title) items.push(title);
    }
  }
  return items;
}

function filterFfEvents(events, dateUtc) {
  if (!Array.isArray(events)) return [];
  return events
    .filter(e => {
      try {
        return new Date(e.date).toISOString().slice(0, 10) === dateUtc &&
               ['High', 'Medium'].includes(e.impact);
      } catch { return false; }
    })
    .map(e => ({
      time_utc:   new Date(e.date).toISOString().slice(11, 16),
      event:      e.title,
      currency:   e.country,
      importance: e.impact.toLowerCase(),
      actual:     e.actual   || null,
      forecast:   e.forecast || null,
      previous:   e.previous || null,
      status:     e.actual   ? 'released' : 'scheduled',
    }));
}

// ── fetchSignals ─────────────────────────────────────────────────────────────

export async function fetchSignals() {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const results = await Promise.allSettled([
    /* 0 */ fetch(`${CG}/global`).then(r => r.ok ? r.json() : null),
    /* 1 */ fetch(`${CG}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`).then(r => r.ok ? r.json() : null),
    /* 2 */ fetch(FNG).then(r => r.ok ? r.json() : null),
    /* 3 */ fetch(`${COINALYZE}/funding-rate?symbols=BTCUSDT_PERP.A,ETHUSDT_PERP.A&api_key=${config.coinalyzeApiKey}`).then(r => r.ok ? r.json() : null),
    /* 4 */ fetch(`${COINALYZE}/open-interest?symbols=BTCUSDT_PERP.A,ETHUSDT_PERP.A&api_key=${config.coinalyzeApiKey}`).then(r => r.ok ? r.json() : null),
    /* 5 */ fetch(`${FRED}/series/observations?series_id=CPIAUCSL&api_key=${config.fredApiKey}&file_type=json&sort_order=desc&limit=2`).then(r => r.ok ? r.json() : null),
    /* 6 */ fetch(`${FRED}/series/observations?series_id=FEDFUNDS&api_key=${config.fredApiKey}&file_type=json&sort_order=desc&limit=1`).then(r => r.ok ? r.json() : null),
    /* 7 */ fetch(`${FRED}/series/observations?series_id=DGS10&api_key=${config.fredApiKey}&file_type=json&sort_order=desc&limit=1`).then(r => r.ok ? r.json() : null),
    /* 8 */ fetch(FF_CALENDAR).then(r => r.ok ? r.json() : null),
    /* 9 */ fetch(CT_RSS).then(r => r.ok ? r.text() : null),
    /* 10*/ fetch(DECRYPT_RSS).then(r => r.ok ? r.text() : null),
  ]);

  const v = (i) => results[i].status === 'fulfilled' ? results[i].value : null;

  const g          = v(0)?.data;
  const p          = v(1);
  const fng        = v(2)?.data?.[0];
  const coalFund   = v(3);   // [{symbol, value, update}]
  const coalOi     = v(4);   // [{symbol, value, update}]
  const fredCpi    = v(5);
  const fredFunds  = v(6);
  const fredYield  = v(7);
  const ffAll      = v(8);
  const ctXml      = v(9);
  const decryptXml = v(10);

  // Coinalyze — map by asset
  const fundingRates = {};
  const openInterest = {};
  if (Array.isArray(coalFund)) {
    for (const item of coalFund) {
      const sym = item.symbol.startsWith('BTC') ? 'BTC' : item.symbol.startsWith('ETH') ? 'ETH' : null;
      if (sym) fundingRates[sym] = {
        rate_8h:         item.value,
        annualized_pct:  +(item.value * 3 * 365 * 100).toFixed(2),
      };
    }
  }
  if (Array.isArray(coalOi)) {
    for (const item of coalOi) {
      const sym = item.symbol.startsWith('BTC') ? 'BTC' : item.symbol.startsWith('ETH') ? 'ETH' : null;
      if (sym) openInterest[sym] = { contracts: item.value };
    }
  }

  // FRED
  const fredData = {
    cpi: fredCpi?.observations?.[0]
      ? { date: fredCpi.observations[0].date, value: parseFloat(fredCpi.observations[0].value), prev_value: parseFloat(fredCpi.observations[1]?.value ?? null) }
      : null,
    fed_funds_rate: fredFunds?.observations?.[0]
      ? { date: fredFunds.observations[0].date, value: parseFloat(fredFunds.observations[0].value) }
      : null,
    yield_10y: fredYield?.observations?.[0]
      ? { date: fredYield.observations[0].date, value: parseFloat(fredYield.observations[0].value) }
      : null,
  };

  // ForexFactory
  const macroToday    = filterFfEvents(ffAll, today);
  const macroYesterday = filterFfEvents(ffAll, yesterday);

  // News — merge CT + Decrypt, dedupe by title
  const ctTitles      = parseRssTitles(ctXml, 4).map(t => ({ title: t, source: 'CoinTelegraph' }));
  const decryptTitles = parseRssTitles(decryptXml, 4).map(t => ({ title: t, source: 'Decrypt' }));
  const allNews       = [...ctTitles, ...decryptTitles].slice(0, 8);

  return {
    date:       today,
    as_of_utc:  new Date().toISOString(),
    market: {
      total_market_cap_usd:          g?.total_market_cap?.usd          ?? null,
      total_market_cap_change_24h_pct: g?.market_cap_change_percentage_24h_usd ?? null,
      btc_dominance_pct:             g?.market_cap_percentage?.btc     ?? null,
      eth_dominance_pct:             g?.market_cap_percentage?.eth     ?? null,
    },
    assets: {
      BTC: { price_usd: p?.bitcoin?.usd   ?? null, change_24h_pct: p?.bitcoin?.usd_24h_change   ?? null },
      ETH: { price_usd: p?.ethereum?.usd  ?? null, change_24h_pct: p?.ethereum?.usd_24h_change  ?? null },
      SOL: { price_usd: p?.solana?.usd    ?? null, change_24h_pct: p?.solana?.usd_24h_change    ?? null },
    },
    sentiment: fng
      ? { fear_greed_value: parseInt(fng.value, 10), fear_greed_label: fng.value_classification }
      : null,
    liquidations_24h: null,
    macro_today:      macroToday,
    macro_recent_24h: macroYesterday,
    news:             allNews,
    funding_rates:    Object.keys(fundingRates).length ? fundingRates : null,
    open_interest:    Object.keys(openInterest).length ? openInterest : null,
    fred:             (fredData.cpi || fredData.fed_funds_rate || fredData.yield_10y) ? fredData : null,
  };
}

// ── synthesize ───────────────────────────────────────────────────────────────

async function callModel(userPrompt, maxTokens) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://vrynn.xyz',
      'X-Title':       'Vrynn',
    },
    body: JSON.stringify({
      model:      config.aiModel,
      messages:   [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens:  maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data   = await res.json();
  const raw    = data.choices?.[0]?.message?.content?.trim();
  const reason = data.choices?.[0]?.finish_reason;
  if (!raw) throw new Error('empty completion');

  // Strip markdown fences if the model wraps the output anyway.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed  = JSON.parse(cleaned);   // throws on a truncated body
  return { parsed, reason };
}

/** One model call per day, but retry once on a malformed body. The usual cause
 *  is the completion hitting the token ceiling mid-JSON, which throws in
 *  JSON.parse and would otherwise publish a brief with tiles and no prose. */
export async function synthesize(marketState) {
  const userPrompt =
    `Today's market data (this is the complete set of inputs — reason only from what is listed):\n\n` +
    `${JSON.stringify(marketState, null, 2)}\n\nGenerate the brief.`;

  const attempts = [1400, 2000];
  for (let i = 0; i < attempts.length; i++) {
    try {
      const { parsed, reason } = await callModel(userPrompt, attempts[i]);
      if (reason === 'length') throw new Error('completion truncated (finish_reason=length)');
      return parsed;
    } catch (err) {
      const last = i === attempts.length - 1;
      console.error(`[brief] synthesis attempt ${i + 1}/${attempts.length} failed:`, err.message);
      if (last) {
        // Caller renders a data-only brief rather than publishing nothing.
        console.error('[brief] giving up — page will render tiles without prose');
        return null;
      }
    }
  }
  return null;
}

// ── render helpers ───────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtUsd = (v) =>
  v == null ? 'n/a'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
  : v >= 1e9  ? `$${(v / 1e9).toFixed(1)}B`
  : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const fmtPct  = (v) => v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const dirClass = (v) => v == null ? '' : v >= 0 ? 'up' : 'down';
const fmtOi   = (v) => v == null ? 'n/a' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));

const prettyDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

/** One-line summary of a stored brief.
 *  Prefers the synthesis headline; falls back to the first sentence for rows
 *  saved before `headline` was stored. The split requires whitespace + a capital
 *  after the stop, so decimals ("rose 0.73%") are not mistaken for sentence ends. */
function briefSummary(row) {
  if (row.headline) return row.headline;
  if (!row.brief_text) return 'Brief unavailable.';
  const first = row.brief_text.split(/(?<=[.!?])\s+(?=[A-Z])/)[0].trim();
  return first.length > 130 ? first.slice(0, 127).trimEnd() + '…' : first;
}

// ── renderBrief ──────────────────────────────────────────────────────────────

export function renderBrief(signals, synthesis, recentBriefs = [], opts = {}) {
  const { landing = false } = opts;
  const mc  = signals.market ?? {};
  const btc = signals.assets?.BTC ?? {};
  const eth = signals.assets?.ETH ?? {};
  const sol = signals.assets?.SOL ?? {};
  const fg  = signals.sentiment;

  const dir = mc.total_market_cap_change_24h_pct == null ? 'moving'
            : mc.total_market_cap_change_24h_pct >= 0 ? 'up' : 'down';

  const prettyDate = new Date(`${signals.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  const title = `Why is crypto ${dir} today? — ${prettyDate} | Vrynn`;
  const desc  = `Crypto market cap ${fmtPct(mc.total_market_cap_change_24h_pct)} over 24h. `
              + `BTC ${fmtPct(btc.change_24h_pct)}, ETH ${fmtPct(eth.change_24h_pct)}, `
              + `SOL ${fmtPct(sol.change_24h_pct)}. What moved and what coincided with it.`;

  const tile = (label, value, sub, cls = '') => `
      <div class="tile">
        <div class="label">${esc(label)}</div>
        <div class="value ${cls}">${esc(value)}</div>
        <div class="sub ${cls}">${esc(sub)}</div>
      </div>`;

  // Brief prose
  const briefHtml = synthesis?.brief
    ? synthesis.brief.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('\n        ')
    : `<p class="unavailable">The written brief could not be generated for this date. The market data above is live and unaffected.</p>`;

  // Headline
  const headlineHtml = synthesis?.headline
    ? `<p class="brief-headline">${esc(synthesis.headline)}</p>`
    : '';

  const explainedLabels = {
    'well-explained':   'Drivers identified',
    'partly-explained': 'Partly explained',
    'unexplained':      'No clear catalyst',
  };
  const driverTypeLabels = { fact: 'Fact', coincidence: 'Timing', unknown: 'No driver' };

  // Explained badge
  const explainedHtml = synthesis?.explained
    ? `<span class="explained explained--${synthesis.explained}">${explainedLabels[synthesis.explained] ?? synthesis.explained}</span>`
    : '';

  // Drivers transparency block — lives in the right rail
  const driversHtml = synthesis?.drivers?.length
    ? `<div class="rail-block">
        <div class="rail-label">How we read this move</div>
        ${synthesis.drivers.map(d => `
        <div class="driver">
          <span class="driver-tag driver-tag--${esc(d.type)}">${driverTypeLabels[d.type] ?? d.type}</span>
          <span class="driver-claim">${esc(d.claim)}</span>
        </div>`).join('')}
      </div>`
    : '';

  // Recent briefs — older entries only, so a stored page's rail never goes stale
  const recentHtml = recentBriefs.length
    ? `<div class="rail-block">
        <div class="rail-label">Recent briefs</div>
        ${recentBriefs.map(b => `
        <a class="recent-item" href="/brief/${esc(b.date)}">
          <span class="recent-date">${esc(prettyDay(b.date))}</span>
          <span class="recent-line">${esc(briefSummary(b))}</span>
        </a>`).join('')}
        <a class="rail-more" href="/brief">All briefs →</a>
      </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="https://vrynn.xyz/brief/${esc(signals.date)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --card:#fafafa; --up:#0a8f4d; --down:#d81b60; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d0f; --fg:#f2f2f2; --muted:#9a9a9a; --line:#26262b; --card:#16161a; --up:#2ecc71; --down:#ff4d8d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:1100px; margin:0 auto; padding:40px 20px 64px; }
  /* Reading column — capped for line length, left-aligned inside the wider page.
     The space this leaves on the right is where the archive/subscribe rail goes. */
  .col  { max-width:700px; }
  .brand { font-weight:800; font-size:22px; letter-spacing:-.02em;
           background:linear-gradient(90deg,#00c8e0,#7000e0); -webkit-background-clip:text;
           background-clip:text; color:transparent; text-decoration:none; }
  .hero       { margin-top:26px; padding-bottom:26px; border-bottom:1px solid var(--line); }
  .hero-title { font-size:clamp(19px,2.6vw,23px); font-weight:700; letter-spacing:-.02em; margin:0 0 6px; }
  .hero-sub   { color:var(--muted); font-size:15px; margin:0 0 14px; max-width:58ch; }
  .hero-rule  { display:flex; flex-wrap:wrap; gap:7px; align-items:center; max-width:700px;
                font-size:12.5px; color:var(--muted); line-height:1.9; }
  @media (max-width:600px) { .wrap { padding:28px 16px 48px; } }

  /* Landing — homepage only. Dated briefs keep the thin .hero so a visitor
     arriving from search lands on the content, not a marketing wall. */
  .landing     { padding:14px 0 44px; border-bottom:1px solid var(--line); }
  /* Hero is two-up from 900px: copy left, live proof card right. Below that the
     card drops under the copy rather than squeezing either into a narrow column. */
  .landing-top { display:grid; grid-template-columns:1fr; gap:30px; align-items:start; }
  @media (min-width:900px) { .landing-top { grid-template-columns:minmax(0,1fr) 270px; gap:54px; } }
  .landing-h   { font-size:clamp(32px,5.4vw,50px); line-height:1.08; letter-spacing:-.03em;
                 margin:10px 0 14px; max-width:22ch; }
  .landing-sub { font-size:clamp(16px,1.9vw,18.5px); color:var(--muted); max-width:54ch;
                 margin:0 0 20px; line-height:1.55; }
  .today-card  { background:var(--card); border:1px solid var(--line); border-radius:12px;
                 padding:18px 20px; }
  .today-label { font-size:11px; color:var(--muted); text-transform:uppercase;
                 letter-spacing:.07em; margin-bottom:11px; }
  .today-cap   { font-size:27px; font-weight:800; letter-spacing:-.02em; line-height:1.1; }
  .today-chg   { font-size:14px; margin-top:3px; }
  .today-badge { margin-top:13px; }
  .today-note  { font-size:12.5px; color:var(--muted); margin:13px 0 0; padding-top:12px;
                 border-top:1px solid var(--line); line-height:1.5; }
  .landing-cta { display:inline-block; font-size:14px; font-weight:600; text-decoration:none;
                 color:var(--fg); background:var(--card); border:1px solid var(--line);
                 border-radius:8px; padding:10px 17px; }
  .landing-cta:hover { border-color:var(--muted); }
  .points  { display:grid; grid-template-columns:1fr; gap:26px; margin-top:44px; }
  @media (min-width:820px) { .points { grid-template-columns:repeat(3,1fr); gap:34px; } }
  .point-t { font-size:15px; font-weight:700; margin:0 0 7px; }
  .point-d { font-size:14px; color:var(--muted); margin:0; line-height:1.62; }
  .sources { margin-top:38px; padding-top:18px; border-top:1px solid var(--line);
             font-size:13px; color:var(--muted); max-width:74ch; line-height:1.6; }
  .hero-pill  { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                padding:2px 7px; border-radius:4px; background:var(--card); border:1px solid var(--line); }
  .date  { color:var(--muted); font-size:13px; margin-top:24px; text-transform:uppercase; letter-spacing:.08em; }
  h1, .brief-q { font-size:clamp(28px,5vw,40px); line-height:1.15; letter-spacing:-.02em; margin:8px 0 8px; font-weight:700; }
  .landing-h { font-weight:800; }
  .brief-meta { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
  .brief-headline { margin:0; color:var(--muted); font-size:15px; font-style:italic; flex:1; }
  .explained { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
               padding:2px 8px; border-radius:4px; white-space:nowrap; }
  .explained--well-explained  { background:rgba(10,143,77,.15);  color:var(--up); }
  .explained--partly-explained{ background:rgba(230,138,0,.15);  color:#e68a00; }
  .explained--unexplained     { background:rgba(150,150,150,.15);color:var(--muted); }
  /* 8 tiles: 2 across on phones, 4 across (two clean rows) from tablet up.
     Explicit counts rather than auto-fit so the grid never leaves an orphan tile. */
  .tiles { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-bottom:36px; }
  @media (min-width:760px) { .tiles { grid-template-columns:repeat(4,1fr); } }
  .tile  { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; min-width:0; }
  .tile .value, .tile .sub { overflow-wrap:anywhere; }
  .label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; }
  .value { font-size:20px; font-weight:700; margin-top:4px; }
  .sub   { font-size:13px; color:var(--muted); margin-top:2px; }
  .up    { color:var(--up); } .down { color:var(--down); }
  .value.up, .value.down { color:var(--fg); }
  .read p { margin:0 0 16px; }
  .unavailable { color:var(--muted); font-style:italic; }
  /* Prose + rail. One column on phones; prose capped at 700px beside the rail
     from 900px up, so the reading measure never stretches with the viewport. */
  .body { display:grid; grid-template-columns:1fr; gap:36px; }
  @media (min-width:900px) {
    .body { grid-template-columns:minmax(0,700px) minmax(230px,1fr); gap:56px; align-items:start; }
  }
  .rail { display:flex; flex-direction:column; gap:30px; }
  .rail-block { min-width:0; }
  .rail-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em;
                padding-bottom:9px; margin-bottom:13px; border-bottom:1px solid var(--line); }
  .rail-more  { display:inline-block; margin-top:12px; font-size:12.5px; color:var(--muted); text-decoration:none; }
  .rail-more:hover { text-decoration:underline; }
  .recent-item { display:block; padding:9px 0; border-bottom:1px solid var(--line);
                 text-decoration:none; color:inherit; }
  .recent-item:last-of-type { border-bottom:0; }
  .recent-date { display:block; font-size:11.5px; color:var(--muted); }
  .recent-line { display:block; font-size:13.5px; line-height:1.45; margin-top:2px; }
  .recent-item:hover .recent-line { text-decoration:underline; }
  .driver { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; font-size:13.5px; line-height:1.5; }
  .driver-tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                padding:2px 7px; border-radius:4px; white-space:nowrap; flex-shrink:0; }
  .driver-tag--fact        { background:rgba(0,200,224,.15);  color:#00c8e0; }
  .driver-tag--coincidence { background:rgba(112,0,224,.15);  color:#a366e0; }
  .driver-tag--unknown     { background:rgba(150,150,150,.15);color:var(--muted); }
  footer { margin-top:40px; padding-top:20px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="wrap">
    <div>
      <a class="brand" href="/">Vrynn</a>
    </div>

    ${landing ? `
    <div class="landing">
      <div class="landing-top">
        <div>
          <h1 class="landing-h">Understand what actually moved crypto today.</h1>
          <p class="landing-sub">A daily brief that separates what happened from what merely
            coincided with it — and says so plainly when there is no clear cause.</p>
          <a class="landing-cta" href="#today">Read today's brief ↓</a>
        </div>

        <!-- Live proof: the same verdict the brief below reaches, shown up front so the
             honesty claim is demonstrated rather than just asserted. -->
        <aside class="today-card">
          <div class="today-label">Today · total market cap</div>
          <div class="today-cap">${esc(fmtUsd(mc.total_market_cap_usd))}</div>
          <div class="today-chg ${dirClass(mc.total_market_cap_change_24h_pct)}">${esc(fmtPct(mc.total_market_cap_change_24h_pct))} over 24h</div>
          ${synthesis?.explained ? `<div class="today-badge"><span class="explained explained--${esc(synthesis.explained)}">${explainedLabels[synthesis.explained] ?? synthesis.explained}</span></div>` : ''}
          <p class="today-note">That verdict is today's, not a slogan — it changes with the data.</p>
        </aside>
      </div>

      <div class="points">
        <div>
          <p class="point-t">Every claim is tagged</p>
          <p class="point-d">Fact, timing, or no driver. You can see exactly how firm each
            link is instead of taking a narrative on trust.</p>
        </div>
        <div>
          <p class="point-t">It says when it doesn't know</p>
          <p class="point-d">Most tools manufacture a reason every single day. On a quiet day
            this one reports no clear catalyst, because that is the honest read.</p>
        </div>
        <div>
          <p class="point-t">One brief a day</p>
          <p class="point-d">No alerts, no price targets, no urgency. Published each morning,
            then it stops talking. Free to read, no account needed.</p>
        </div>
      </div>

      <p class="sources">Built on CoinGecko, FRED, Coinalyze, ForexFactory and public news
        feeds. Every figure on this page traces back to one of them — and nothing here is
        investment advice.</p>
    </div>
    ` : `
    <div class="hero">
      <p class="hero-title">The daily crypto market brief.</p>
      <p class="hero-sub">What moved — and what merely coincided with it. Published every morning, free to read, no account needed.</p>
      <div class="hero-rule">
        Every claim is tagged
        <span class="hero-pill">Fact</span>
        <span class="hero-pill">Timing</span>
        <span class="hero-pill">No driver</span>
        — never advice, never a guess dressed as insight.
      </div>
    </div>
    `}

    <div class="date col" id="today"><a href="/brief" style="color:var(--muted);text-decoration:none;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">← All briefs</a> &nbsp;·&nbsp; ${esc(prettyDate)}</div>
    <${landing ? 'h2' : 'h1'} class="col brief-q">Why is crypto ${esc(dir)} today?</${landing ? 'h2' : 'h1'}>
    <div class="brief-meta col">
      ${headlineHtml}
      ${explainedHtml}
    </div>

    <div class="tiles">
      ${tile('Total market cap', fmtUsd(mc.total_market_cap_usd), `${fmtPct(mc.total_market_cap_change_24h_pct)} 24h`, dirClass(mc.total_market_cap_change_24h_pct))}
      ${tile('Bitcoin',   fmtUsd(btc.price_usd), `${fmtPct(btc.change_24h_pct)} 24h`, dirClass(btc.change_24h_pct))}
      ${tile('Ethereum',  fmtUsd(eth.price_usd), `${fmtPct(eth.change_24h_pct)} 24h`, dirClass(eth.change_24h_pct))}
      ${tile('Solana',    fmtUsd(sol.price_usd), `${fmtPct(sol.change_24h_pct)} 24h`, dirClass(sol.change_24h_pct))}
      ${tile('BTC dominance', mc.btc_dominance_pct == null ? 'n/a' : `${mc.btc_dominance_pct.toFixed(1)}%`, mc.eth_dominance_pct == null ? '' : `ETH ${mc.eth_dominance_pct.toFixed(1)}%`)}
      ${tile('Fear & Greed',  fg ? String(fg.fear_greed_value) : 'n/a', fg ? fg.fear_greed_label : '')}
      ${(() => {
        const btcOi = signals.open_interest?.BTC?.contracts;
        const ethOi = signals.open_interest?.ETH?.contracts;
        return tile('Open interest', btcOi != null ? `${fmtOi(btcOi)} BTC` : 'n/a', ethOi != null ? `ETH ${fmtOi(ethOi)}` : '');
      })()}
      ${(() => {
        const events = signals.macro_today ?? [];
        const top = events.find(e => e.importance === 'high') ?? events[0] ?? null;
        const label = top ? (top.event.length > 22 ? top.event.slice(0, 20) + '…' : top.event) : 'Quiet';
        const sub   = top ? `${top.currency} · ${top.status}` : 'No high-impact events';
        return tile('Macro today', label, sub);
      })()}
    </div>

    <div class="body">
      <div class="read">
        ${briefHtml}
      </div>
      <aside class="rail">
        ${driversHtml}
        ${recentHtml}
      </aside>
    </div>

    <footer>
      Vrynn reports what moved and what coincided with it. It does not assert causation
      and does not provide investment advice. Data: CoinGecko, Alternative.me, Coinalyze, FRED, ForexFactory, CoinTelegraph, Decrypt.
    </footer>
  </div>
</body>
</html>`;
}

// ── renderArchive ────────────────────────────────────────────────────────────

export function renderArchive(briefs) {
  const explainedLabels = {
    'well-explained':   'Drivers identified',
    'partly-explained': 'Partly explained',
    'unexplained':      'No clear catalyst',
  };

  const rows = briefs.map((b) => `
    <a class="entry" href="/brief/${esc(b.date)}">
      <span class="entry-date">${esc(prettyDay(b.date))}</span>
      <span class="entry-snippet">${esc(briefSummary(b))}</span>
      ${b.explained ? `<span class="explained explained--${esc(b.explained)}">${explainedLabels[b.explained] ?? b.explained}</span>` : ''}
    </a>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily crypto market brief archive | Vrynn</title>
<meta name="description" content="Every daily crypto market brief — what moved and what coincided with it.">
<link rel="canonical" href="https://vrynn.xyz/brief">
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --card:#fafafa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d0f; --fg:#f2f2f2; --muted:#9a9a9a; --line:#26262b; --card:#16161a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  /* Container and type scale intentionally match the brief page. */
  .wrap { max-width:1100px; margin:0 auto; padding:40px 20px 64px; }
  @media (max-width:600px) { .wrap { padding:28px 16px 48px; } }
  .brand { font-weight:800; font-size:22px; letter-spacing:-.02em;
           background:linear-gradient(90deg,#00c8e0,#7000e0); -webkit-background-clip:text;
           background-clip:text; color:transparent; text-decoration:none; }
  .hero       { margin-top:26px; padding-bottom:26px; border-bottom:1px solid var(--line); }
  .hero-title { font-size:clamp(19px,2.6vw,23px); font-weight:700; letter-spacing:-.02em; margin:0 0 6px; }
  .hero-sub   { color:var(--muted); font-size:15px; margin:0; max-width:58ch; }
  h1 { font-size:clamp(24px,4vw,34px); line-height:1.2; letter-spacing:-.02em; margin:28px 0 6px; }
  .sub { color:var(--muted); margin:0 0 28px; max-width:58ch; }
  /* Index grid — one column on phones, two from tablet up so the page fills out. */
  .entries { display:grid; grid-template-columns:1fr; gap:0 32px; }
  @media (min-width:820px) { .entries { grid-template-columns:1fr 1fr; } }
  .entry { display:block; padding:15px 0; border-top:1px solid var(--line);
           text-decoration:none; color:inherit; }
  .entry:hover .entry-date { text-decoration:underline; }
  .entry-date    { display:block; font-weight:600; font-size:15px; margin-bottom:3px; }
  .entry-snippet { display:block; color:var(--muted); font-size:14px; line-height:1.5; }
  .explained { display:inline-block; margin-top:7px;
               font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
               padding:2px 8px; border-radius:4px; }
  .explained--well-explained  { background:rgba(10,143,77,.15);   color:#0a8f4d; }
  .explained--partly-explained{ background:rgba(230,138,0,.15);   color:#e68a00; }
  .explained--unexplained     { background:rgba(150,150,150,.15); color:var(--muted); }
  footer { margin-top:40px; padding-top:20px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="/">Vrynn</a>

    <div class="hero">
      <p class="hero-title">The daily crypto market brief.</p>
      <p class="hero-sub">What moved — and what merely coincided with it. Published every morning, free to read, no account needed.</p>
    </div>

    <h1>Every brief</h1>
    <p class="sub">One per day. Each tagged by how much of the move the data actually accounts for.</p>
    <div class="entries">
      ${rows || '<p style="color:var(--muted)">No briefs yet.</p>'}
    </div>
    <footer>Vrynn reports facts and timing coincidences only. No investment advice.</footer>
  </div>
</body>
</html>`;
}

// ── In-memory cache ──────────────────────────────────────────────────────────
// `page` = the dated brief (no landing). `home` = same brief with the landing
// block on top. Both derive from one model call per day.
let cache = { date: null, page: null, home: null };

/** Rebuild the synthesis object from a stored row, so any page can be
 *  re-rendered from data without another model call. */
function synthesisFromRow(row) {
  return {
    headline:  row.headline ?? null,
    brief:     row.brief_text ?? null,
    drivers:   row.drivers_json ? JSON.parse(row.drivers_json) : [],
    explained: row.explained ?? null,
  };
}

export async function getBriefHtml(date) {
  const today  = new Date().toISOString().slice(0, 10);
  const target = date ?? today;

  // Past date — serve from DB only
  if (target !== today) {
    const row = getDailyBrief(target);
    return row ? row.html : null;
  }

  // Today — memory cache → DB → generate fresh
  if (cache.date === today && cache.page) return cache.page;

  const saved = getDailyBrief(today);
  if (saved) {
    cache = { ...cache, date: today, page: saved.html };
    return saved.html;
  }

  const signals   = await fetchSignals();
  const synthesis = await synthesize(signals);
  const recent    = getRecentBriefs(today, 5);
  const html      = renderBrief(signals, synthesis, recent);

  if (synthesis) {
    saveDailyBrief({
      date:     today,
      signals,
      briefText: synthesis.brief,
      html,
      drivers:   synthesis.drivers,
      explained: synthesis.explained,
      headline:  synthesis.headline,
    });
    cache = { date: today, page: html, home: null };
  }

  return html;
}

/** Homepage: today's brief with the landing block above it. Re-rendered from
 *  the stored row so the dated page at /brief/<today> stays landing-free. */
export async function getHomepageHtml() {
  const today = new Date().toISOString().slice(0, 10);
  if (cache.date === today && cache.home) return cache.home;

  let row = getDailyBrief(today);
  if (!row) {
    await getBriefHtml();          // generates and stores today's brief
    row = getDailyBrief(today);
  }

  // Generation failed (model down) — render live so the page still serves.
  if (!row) {
    const signals   = await fetchSignals();
    const synthesis = await synthesize(signals);
    return renderBrief(signals, synthesis, getRecentBriefs(today, 5), { landing: true });
  }

  const html = renderBrief(
    JSON.parse(row.signals_json),
    synthesisFromRow(row),
    getRecentBriefs(today, 5),
    { landing: true },
  );
  cache = { ...cache, date: today, home: html };
  return html;
}
