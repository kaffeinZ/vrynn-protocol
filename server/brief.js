import { config } from './config.js';
import { saveDailyBrief, getDailyBrief, getAllBriefs } from './db.js';

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

export async function synthesize(marketState) {
  const userPrompt =
    `Today's market data (this is the complete set of inputs — reason only from what is listed):\n\n` +
    `${JSON.stringify(marketState, null, 2)}\n\nGenerate the brief.`;

  try {
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
        max_tokens:  800,
        temperature: 0.2,
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    // Strip markdown fences if model wraps output anyway
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[brief] synthesis failed:', err.message);
    return null;
  }
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

// ── renderBrief ──────────────────────────────────────────────────────────────

export function renderBrief(signals, synthesis) {
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

  // Drivers transparency section
  const driversHtml = synthesis?.drivers?.length
    ? `<div class="drivers">
        <div class="drivers-label">How we read this move</div>
        ${synthesis.drivers.map(d => `
        <div class="driver">
          <span class="driver-tag driver-tag--${esc(d.type)}">${driverTypeLabels[d.type] ?? d.type}</span>
          <span class="driver-claim">${esc(d.claim)}</span>
        </div>`).join('')}
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
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --card:#fafafa; --up:#0a8f4d; --down:#d81b60; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d0f; --fg:#f2f2f2; --muted:#9a9a9a; --line:#26262b; --card:#16161a; --up:#2ecc71; --down:#ff4d8d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:40px 20px 64px; }
  .brand { font-weight:800; font-size:22px; letter-spacing:-.02em;
           background:linear-gradient(90deg,#00c8e0,#7000e0); -webkit-background-clip:text;
           background-clip:text; color:transparent; text-decoration:none; }
  .date  { color:var(--muted); font-size:13px; margin-top:24px; text-transform:uppercase; letter-spacing:.08em; }
  h1     { font-size:clamp(28px,5vw,40px); line-height:1.15; letter-spacing:-.02em; margin:8px 0 8px; }
  .brief-meta { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
  .brief-headline { margin:0; color:var(--muted); font-size:15px; font-style:italic; flex:1; }
  .explained { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
               padding:2px 8px; border-radius:4px; white-space:nowrap; }
  .explained--well-explained  { background:rgba(10,143,77,.15);  color:var(--up); }
  .explained--partly-explained{ background:rgba(230,138,0,.15);  color:#e68a00; }
  .explained--unexplained     { background:rgba(150,150,150,.15);color:var(--muted); }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:36px; }
  .tile  { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; }
  .value { font-size:20px; font-weight:700; margin-top:4px; }
  .sub   { font-size:13px; color:var(--muted); margin-top:2px; }
  .up    { color:var(--up); } .down { color:var(--down); }
  .value.up, .value.down { color:var(--fg); }
  .read p { margin:0 0 16px; }
  .unavailable { color:var(--muted); font-style:italic; }
  .drivers { margin-top:32px; padding-top:24px; border-top:1px solid var(--line); }
  .drivers-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; margin-bottom:12px; }
  .driver { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; font-size:14px; line-height:1.5; }
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
    <div class="date"><a href="/brief" style="color:var(--muted);text-decoration:none;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">← All briefs</a> &nbsp;·&nbsp; ${esc(prettyDate)}</div>
    <h1>Why is crypto ${esc(dir)} today?</h1>
    <div class="brief-meta">
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
    </div>

    <div class="read">
      ${briefHtml}
    </div>

    ${driversHtml}

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
  const rows = briefs.map(({ date, brief_text }) => {
    const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    const snippet = brief_text ? esc(brief_text.split(/[.!?]/)[0].trim() + '.') : 'Brief unavailable.';
    return `
    <a class="entry" href="/brief/${esc(date)}">
      <span class="entry-date">${esc(pretty)}</span>
      <span class="entry-snippet">${snippet}</span>
    </a>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily crypto market brief archive | Vrynn</title>
<meta name="description" content="Every daily crypto market brief — what moved and what coincided with it.">
<link rel="canonical" href="https://vrynn.xyz/brief">
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --card:#fafafa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d0f; --fg:#f2f2f2; --muted:#9a9a9a; --line:#26262b; --card:#16161a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:40px 20px 64px; }
  .brand { font-weight:800; font-size:22px; letter-spacing:-.02em;
           background:linear-gradient(90deg,#00c8e0,#7000e0); -webkit-background-clip:text;
           background-clip:text; color:transparent; text-decoration:none; }
  h1 { font-size:clamp(24px,4vw,34px); line-height:1.2; letter-spacing:-.02em; margin:24px 0 8px; }
  .sub { color:var(--muted); margin:0 0 32px; }
  .entry { display:block; padding:16px 0; border-bottom:1px solid var(--line);
           text-decoration:none; color:inherit; }
  .entry:first-child { border-top:1px solid var(--line); }
  .entry:hover .entry-date { text-decoration:underline; }
  .entry-date    { display:block; font-weight:600; font-size:15px; margin-bottom:4px; }
  .entry-snippet { display:block; color:var(--muted); font-size:14px; line-height:1.5; }
  footer { margin-top:40px; padding-top:20px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="/">Vrynn</a>
    <h1>Daily crypto brief</h1>
    <p class="sub">What moved and what coincided with it — one brief per day, no advice.</p>
    ${rows || '<p style="color:var(--muted)">No briefs yet.</p>'}
    <footer>Vrynn reports facts and timing coincidences only. No investment advice.</footer>
  </div>
</body>
</html>`;
}

// ── In-memory cache ──────────────────────────────────────────────────────────
let cache = { date: null, html: null };

export async function getBriefHtml(date) {
  const today  = new Date().toISOString().slice(0, 10);
  const target = date ?? today;

  // Past date — serve from DB only
  if (target !== today) {
    const row = getDailyBrief(target);
    return row ? row.html : null;
  }

  // Today — memory cache → DB → generate fresh
  if (cache.date === today && cache.html) return cache.html;

  const saved = getDailyBrief(today);
  if (saved) {
    cache = { date: today, html: saved.html };
    return saved.html;
  }

  const signals   = await fetchSignals();
  const synthesis = await synthesize(signals);
  const html      = renderBrief(signals, synthesis);

  if (synthesis) {
    saveDailyBrief({
      date:     today,
      signals,
      briefText: synthesis.brief,
      html,
      drivers:   synthesis.drivers,
      explained: synthesis.explained,
    });
    cache = { date: today, html };
  }

  return html;
}
