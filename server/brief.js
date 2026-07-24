import { config } from './config.js';
import { saveDailyBrief, getDailyBrief } from './db.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CG = 'https://api.coingecko.com/api/v3';
const FNG = 'https://api.alternative.me/fng/';

/**
 * The honesty bar. This prompt is the product — every rule here exists to keep
 * the brief on the reporting side of the line: facts and coincidences only,
 * never causation, never advice.
 */
const SYSTEM_PROMPT = `You write a daily crypto market brief. You are given today's market data and nothing else.

Write 2-3 short paragraphs (max 120 words total) describing what moved and what coincided with it.

RULES - these are absolute:
1. State facts and timing coincidences only. Never assert causation. Write "coincided with" or "alongside", never "because of", "driven by", or "due to".
2. If the data shows no clear driver, say so plainly - for example "no clear catalyst is evident in today's inputs". Do not invent a reason. Reporting that a move is unexplained is correct and expected, not a failure.
3. Never give advice, predictions, or buy/sell language. No "expect", "likely to", "investors should", "watch for".
4. Use only the numbers provided. Do not introduce events, news, prices, or figures that are not in the data.
5. Plain English, no hype, no emoji, no headings. Just the paragraphs.`;

/** Pull the free live signals. Field names verified against the real endpoints. */
export async function fetchSignals() {
  const [globalRes, priceRes, fngRes] = await Promise.all([
    fetch(`${CG}/global`),
    fetch(`${CG}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`),
    fetch(FNG),
  ]);

  if (!globalRes.ok) throw new Error(`coingecko /global ${globalRes.status}`);
  if (!priceRes.ok)  throw new Error(`coingecko /simple/price ${priceRes.status}`);
  if (!fngRes.ok)    throw new Error(`fng ${fngRes.status}`);

  const g     = (await globalRes.json()).data;
  const p     = await priceRes.json();
  const fng   = (await fngRes.json()).data?.[0];

  return {
    date: new Date().toISOString().slice(0, 10),
    totalMcapUsd:      g.total_market_cap?.usd ?? null,
    mcapChange24hPct:  g.market_cap_change_percentage_24h_usd ?? null,
    btcDominancePct:   g.market_cap_percentage?.btc ?? null,
    ethDominancePct:   g.market_cap_percentage?.eth ?? null,
    btc: { price: p.bitcoin?.usd  ?? null, chg24h: p.bitcoin?.usd_24h_change  ?? null },
    eth: { price: p.ethereum?.usd ?? null, chg24h: p.ethereum?.usd_24h_change ?? null },
    sol: { price: p.solana?.usd   ?? null, chg24h: p.solana?.usd_24h_change   ?? null },
    // alternative.me returns value as a string
    fearGreed: fng ? { value: parseInt(fng.value, 10), label: fng.value_classification } : null,
    // No macro calendar wired yet (roadmap P4) - the model is told so explicitly
    // rather than left to guess at causes it has no data for.
    macroToday: [],
  };
}

/** Send the signals to the model and get the read back. Returns null on failure. */
export async function synthesize(signals) {
  const n = (v, d = 2) => (v == null ? 'n/a' : Number(v).toFixed(d));
  const facts = {
    date: signals.date,
    total_market_cap_usd: signals.totalMcapUsd,
    total_market_cap_change_24h_pct: signals.mcapChange24hPct,
    btc_dominance_pct: signals.btcDominancePct,
    eth_dominance_pct: signals.ethDominancePct,
    btc_usd: signals.btc.price, btc_change_24h_pct: signals.btc.chg24h,
    eth_usd: signals.eth.price, eth_change_24h_pct: signals.eth.chg24h,
    sol_usd: signals.sol.price, sol_change_24h_pct: signals.sol.chg24h,
    fear_greed: signals.fearGreed,
    scheduled_macro_events_today: signals.macroToday,
  };

  const userPrompt =
    `Today's market data (this is the complete set of inputs available - there is no news feed, ` +
    `no macro calendar, and no on-chain data beyond what is listed):\n\n` +
    `${JSON.stringify(facts, null, 2)}\n\n` +
    `Write the brief.`;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vrynn.xyz',
        'X-Title': 'Vrynn',
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: 400,
        temperature: 0.2,
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[brief] synthesis failed:', err.message);
    return null;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtUsd = (v) =>
  v == null ? 'n/a'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
  : v >= 1e9  ? `$${(v / 1e9).toFixed(1)}B`
  : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const fmtPct = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const dirClass = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');

/** Server-rendered HTML. Real content in the body - no JS, no client fetch. */
export function renderBrief(signals, briefText) {
  const dir = signals.mcapChange24hPct == null ? 'moving'
            : signals.mcapChange24hPct >= 0 ? 'up' : 'down';
  const prettyDate = new Date(`${signals.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  const title = `Why is crypto ${dir} today? — ${prettyDate} | Vrynn`;
  const desc = `Crypto market cap ${fmtPct(signals.mcapChange24hPct)} over 24h. `
             + `BTC ${fmtPct(signals.btc.chg24h)}, ETH ${fmtPct(signals.eth.chg24h)}, `
             + `SOL ${fmtPct(signals.sol.chg24h)}. What moved and what coincided with it.`;

  const tile = (label, value, sub, cls = '') => `
      <div class="tile">
        <div class="label">${esc(label)}</div>
        <div class="value ${cls}">${esc(value)}</div>
        <div class="sub ${cls}">${esc(sub)}</div>
      </div>`;

  const paragraphs = briefText
    ? briefText.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('\n        ')
    : `<p class="unavailable">The written brief could not be generated for this date.
         The market data above is live and unaffected.</p>`;

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
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 64px; }
  .brand { font-weight:800; font-size:22px; letter-spacing:-.02em;
           background:linear-gradient(90deg,#00c8e0,#7000e0); -webkit-background-clip:text;
           background-clip:text; color:transparent; text-decoration:none; }
  .date { color:var(--muted); font-size:13px; margin-top:24px; text-transform:uppercase; letter-spacing:.08em; }
  h1 { font-size:clamp(28px,5vw,40px); line-height:1.15; letter-spacing:-.02em; margin:8px 0 28px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:36px; }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; }
  .value { font-size:20px; font-weight:700; margin-top:4px; }
  .sub { font-size:13px; color:var(--muted); margin-top:2px; }
  .up { color:var(--up); } .down { color:var(--down); }
  .value.up, .value.down { color:var(--fg); }
  .read p { margin:0 0 16px; }
  .unavailable { color:var(--muted); font-style:italic; }
  footer { margin-top:40px; padding-top:20px; border-top:1px solid var(--line);
           color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="/">Vrynn</a>
    <div class="date">${esc(prettyDate)}</div>
    <h1>Why is crypto ${esc(dir)} today?</h1>

    <div class="tiles">
      ${tile('Total market cap', fmtUsd(signals.totalMcapUsd), `${fmtPct(signals.mcapChange24hPct)} 24h`, dirClass(signals.mcapChange24hPct))}
      ${tile('Bitcoin', fmtUsd(signals.btc.price), `${fmtPct(signals.btc.chg24h)} 24h`, dirClass(signals.btc.chg24h))}
      ${tile('Ethereum', fmtUsd(signals.eth.price), `${fmtPct(signals.eth.chg24h)} 24h`, dirClass(signals.eth.chg24h))}
      ${tile('Solana', fmtUsd(signals.sol.price), `${fmtPct(signals.sol.chg24h)} 24h`, dirClass(signals.sol.chg24h))}
      ${tile('BTC dominance', signals.btcDominancePct == null ? 'n/a' : `${signals.btcDominancePct.toFixed(1)}%`, `ETH ${signals.ethDominancePct == null ? 'n/a' : signals.ethDominancePct.toFixed(1) + '%'}`)}
      ${tile('Fear & Greed', signals.fearGreed ? String(signals.fearGreed.value) : 'n/a', signals.fearGreed ? signals.fearGreed.label : '')}
    </div>

    <div class="read">
        ${paragraphs}
    </div>

    <footer>
      Vrynn reports what moved and what coincided with it. It does not assert causation
      and does not provide investment advice. Data: CoinGecko, Alternative.me.
    </footer>
  </div>
</body>
</html>`;
}

// In-memory cache for the current request burst — DB is the durable store.
let cache = { date: null, html: null };

export async function getBriefHtml(date) {
  const today = new Date().toISOString().slice(0, 10);
  const target = date ?? today;

  // Serve a past date straight from DB — never re-fetch or re-synthesize.
  if (target !== today) {
    const row = getDailyBrief(target);
    return row ? row.html : null;
  }

  // Today: check in-memory cache first, then DB, then generate fresh.
  if (cache.date === today && cache.html) return cache.html;

  const saved = getDailyBrief(today);
  if (saved) {
    cache = { date: today, html: saved.html };
    return saved.html;
  }

  const signals = await fetchSignals();
  const text = await synthesize(signals);
  const html = renderBrief(signals, text);

  if (text) {
    saveDailyBrief({ date: today, signals, briefText: text, html });
    cache = { date: today, html };
  }

  return html;
}
