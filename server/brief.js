import { config } from './config.js';
import { saveDailyBrief, getDailyBrief, getAllBriefs, getRecentBriefs, getHonestyStats, getSparkSeries } from './db.js';
import { fetchMacroCompleted } from './macro.js';
import { SECTORS, fetchCategories, detectSectorSpike } from './sectors.js';
import { cachedFetch } from './httpCache.js';

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
2. COINCIDENCE — two facts near in time where causation is plausible but unproven. ALLOWED: "coincided with", "alongside", "against a backdrop of", "at the same time as", "as ... also". BANNED: "because of", "due to", "caused by", "driven by", "in response to", "on the back of", "triggered by", "sparked by", "fuelled by", "fueled by", "weighed down by", "boosted by", "thanks to" — anything asserting one thing MADE another happen. This is a denylist, not an exhaustive list: reject any causal construction, including ones not named here.
3. UNKNOWN — the move has no clear correspondence to anything in the data. Say so explicitly. This is the single most trust-building thing you output.

## Mandate: name the unknown

If today's price action does not line up with any macro print, news, liquidation, or catalyst in the data, you MUST say so: "No clear catalyst — this looks like low-liquidity drift." Inventing a confident reason on a quiet day is the one failure that destroys reader trust.

## Forbidden: the advice register

Never recommend buying, selling, holding, or entering/exiting anything. No price targets, forecasts, or urgency language.

Never render a verdict on the market as a call to act. You may state direction factually ("prices fell"); you may NOT label the market or any asset "bullish", "bearish", "strong", "weak", "oversold", "overbought", "ready to bounce", "poised to rally", or any term implying a directional bet. Describe; never judge.

Describe the weather — never tell the reader whether to carry an umbrella.

## News timestamps are authoritative

Each news item carries a published_utc timestamp. Only treat a headline as relevant to today's move if its timestamp falls within today's session. Never link today's move to a headline that predates it; older items are background context only. An empty news array is meaningful — it supports a "no clear catalyst" read.

## Macro: completed vs scheduled

The macro data has two parts and they are not interchangeable.

macro.completed are releases that have ALREADY happened since the last brief. Each carries an actual and a previous value. You MAY cite these with their real numbers, using associative language against recent price action — for example "the move came alongside a CPI reading of 3.4%, up from 3.3% prior".

macro.scheduled are events due later today. They have NO actual value. Never treat a scheduled event as an explanation for a move that has already happened; refer to it only as something ahead — "FOMC is due at 18:00".

You do NOT have consensus or forecast figures. Frame any surprise on a completed release relative to its PREVIOUS reading ("came in at X, up from Y prior"), never relative to an expectation you were not given. Never invent a consensus number or say "versus expectations".

## Sector spike

market_state.sector_spike is null on almost every day. When it is null you say NOTHING about sectors — do not write "no sector spiked today", do not mention sectors at all, do not leave a gap for it. The brief reads exactly as if the field did not exist. Silence is the correct and normal output.

When it is NOT null, a single sector moved sharply and diverged from the whole market, and it has already been verified against its own constituents before reaching you. Add sector_note: one or two sentences stating the move as fact against the market move, naming the sector. Mention a constituent only if top_movers makes it relevant. If nothing in the data explains the spike, say so plainly — a sector up 20% with no identifiable cause is a more useful and more honest thing to report than a fabricated reason. All the usual rules apply: no causal language, no verdict, no advice.

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
  "explained": "well-explained | partly-explained | unexplained",
  "sector_note": "OMIT ENTIRELY unless sector_spike is non-null. One or two sentences."
}

Field rules:
- headline: purely descriptive. Good: "Market up 1.2% alongside easing US CPI." Bad: "Bullish momentum builds."
- direction: net total-market-cap move only.
- brief: lead with what moved (fact); then what it coincided with (coincidence only with associative language); then what is scheduled or noteworthy ahead.
- drivers: every factor you leaned on, tagged with epistemic status. On an unexplained day this may be a single unknown entry.
- explained: your honest read on how much of today's move the data accounts for.

## Worked examples

Example A — a day with a plausible macro coincidence.
Input (abridged): market cap −2.4%, BTC −2.1%, SOL −3.1%; US CPI released 13:30 at 3.4% vs 3.1% forecast; 24h liquidations $90M, 82% longs; Fear & Greed 41 (Fear).

{
  "headline": "Market down 2.4% alongside a hotter-than-expected US inflation print.",
  "direction": "down",
  "brief": "Total crypto market cap fell 2.4% over the past 24 hours, with BTC down 2.1% and SOL down 3.1%. The decline coincided with a US CPI reading of 3.4% year-on-year, above the 3.1% consensus, released at 13:30 UTC. Alongside the move, $90M in positions were liquidated, roughly 82% of them longs, consistent with leveraged positioning being unwound as prices fell. Sentiment sits at 41 on the Fear & Greed index — Fear. No further high-importance macro events are scheduled today.",
  "drivers": [
    { "claim": "Market cap fell 2.4% over 24h", "type": "fact" },
    { "claim": "US CPI printed 3.4% vs 3.1% expected, near in time to the decline", "type": "coincidence" },
    { "claim": "$90M liquidated, ~82% longs", "type": "fact" }
  ],
  "explained": "partly-explained"
}

Note it says "coincided with" and "consistent with", never "because of", and grades itself partly-explained rather than claiming CPI caused the drop.

Example B — a quiet day with no catalyst. This is the behaviour that matters most.
Input (abridged): market cap −0.8%, BTC −0.6%, SOL −0.9%; Saturday; macro_today empty; no notable news; 24h liquidations $12M; Fear & Greed 52 (Neutral).

{
  "headline": "Market drifts 0.8% lower on a quiet weekend with no clear catalyst.",
  "direction": "down",
  "brief": "Total market cap slipped 0.8% over the past 24 hours, a modest move with no clear driver in the data. There were no scheduled macro releases, no major news, and liquidations were light at $12M — none of the usual triggers for a directional move are present. This has the shape of low-liquidity weekend drift rather than a response to any specific event. Sentiment is neutral at 52. The next notable macro data is not until the coming week; today offers little to read into.",
  "drivers": [
    { "claim": "Market cap down 0.8% with no corresponding macro, news, or liquidation event in the data", "type": "unknown" }
  ],
  "explained": "unexplained"
}

It refuses to invent a story, tags the move unknown, and grades itself unexplained. Restraint on a nothing day is the standard, not a failure.`;

// ── Helpers ─────────────────────────────────────────────────────────────────

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&(?:apos|#0?39);/g, "'")
  .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
  .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”')
  .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
  .replace(/&nbsp;/g, ' ');

/** RSS items with their publish time. The timestamp is the point: without it a
 *  three-day-old headline can sit in today's market_state and be read as today's
 *  cause. `<item>` may carry attributes, hence the loose opening tag. */
function parseRssItems(xml, limit = 8) {
  if (!xml) return [];
  const out = [];
  for (const [block] of xml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g)) {
    if (out.length >= limit) break;
    const t = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    if (!t) continue;
    const title = decodeEntities(t[1].trim());
    if (!title) continue;

    const p = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    let published_utc = null;
    if (p) {
      const d = new Date(p[1].trim());
      if (!Number.isNaN(d.getTime())) published_utc = d.toISOString();
    }
    out.push({ title, published_utc });
  }
  return out;
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
    /* 0 */ cachedFetch(`${CG}/global`).then(r => r.ok ? r.json() : null),
    /* 1 */ cachedFetch(`${CG}/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`).then(r => r.ok ? r.json() : null),
    /* 2 */ cachedFetch(FNG).then(r => r.ok ? r.json() : null),
    /* 3 */ cachedFetch(`${COINALYZE}/funding-rate?symbols=BTCUSDT_PERP.A,ETHUSDT_PERP.A&api_key=${config.coinalyzeApiKey}`).then(r => r.ok ? r.json() : null),
    /* 4 */ cachedFetch(`${COINALYZE}/open-interest?symbols=BTCUSDT_PERP.A,ETHUSDT_PERP.A&api_key=${config.coinalyzeApiKey}`).then(r => r.ok ? r.json() : null),
    /* 5 */ cachedFetch(`${FRED}/series/observations?series_id=CPIAUCSL&api_key=${config.fredApiKey}&file_type=json&sort_order=desc&limit=2`).then(r => r.ok ? r.json() : null),
    /* 6 */ cachedFetch(`${FRED}/series/observations?series_id=FEDFUNDS&api_key=${config.fredApiKey}&file_type=json&sort_order=desc&limit=1`).then(r => r.ok ? r.json() : null),
    /* 7 */ cachedFetch(`${FRED}/series/observations?series_id=DGS10&api_key=${config.fredApiKey}&file_type=json&sort_order=desc&limit=1`).then(r => r.ok ? r.json() : null),
    /* 8 */ cachedFetch(FF_CALENDAR).then(r => r.ok ? r.json() : null),
    /* 9 */ cachedFetch(CT_RSS).then(r => r.ok ? r.text() : null),
    /* 10*/ cachedFetch(DECRYPT_RSS).then(r => r.ok ? r.text() : null),
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

  // BTC dominance 24h change — no source provides it, so derive it from
  // yesterday's stored snapshot. Missing row (first day, or a gap) stays null.
  let btcDominanceChange = null;
  const todayDom = g?.market_cap_percentage?.btc ?? null;
  const prevRow  = getDailyBrief(yesterday);
  if (prevRow && todayDom != null) {
    try {
      const prevDom = JSON.parse(prevRow.signals_json)?.market?.btc_dominance_pct;
      if (prevDom != null) btcDominanceChange = +(todayDom - prevDom).toFixed(2);
    } catch { /* unparseable older row — leave null */ }
  }

  // ForexFactory — forward schedule only; this feed never populates `actual`.
  const macroToday    = filterFfEvents(ffAll, today);
  const macroYesterday = filterFfEvents(ffAll, yesterday);

  // Sector spike — null on almost every day, which is the intended output.
  // Any failure here degrades to null (silent) rather than blocking the brief.
  let sectorSpike = null;
  try {
    const cats = await fetchCategories();
    sectorSpike = await detectSectorSpike(cats, g?.market_cap_change_percentage_24h_usd ?? null);
  } catch (err) {
    console.error('[spike] detection skipped:', err.message);
  }

  // Completed releases (BLS + FRED) — the actuals ForexFactory cannot supply.
  const macroCompleted = await fetchMacroCompleted()
    .catch(err => { console.error('[macro] completed-release fetch failed:', err.message); return []; });

  // News — merge both feeds, drop anything stale, newest first, cap at 8.
  // An empty array on a quiet day is correct: it reinforces "no clear catalyst".
  const RSS_MAX_AGE_MS = 36 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const allNews = [
    ...parseRssItems(ctXml, 8).map(x => ({ ...x, source: 'CoinTelegraph' })),
    ...parseRssItems(decryptXml, 8).map(x => ({ ...x, source: 'Decrypt' })),
  ]
    .filter(x => x.published_utc && (nowMs - Date.parse(x.published_utc)) <= RSS_MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.published_utc) - Date.parse(a.published_utc))
    .slice(0, 8);

  return {
    date:       today,
    as_of_utc:  new Date().toISOString(),
    market: {
      total_market_cap_usd:          g?.total_market_cap?.usd          ?? null,
      total_market_cap_change_24h_pct: g?.market_cap_change_percentage_24h_usd ?? null,
      btc_dominance_pct:             g?.market_cap_percentage?.btc     ?? null,
      btc_dominance_change_24h_pct:  btcDominanceChange,
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
    // null on quiet days. The prompt is explicit that null means say nothing —
    // not "no sector spiked", which would create a slot that wants filling.
    sector_spike: sectorSpike,
    // Two lists, deliberately separate. `completed` prints carry real numbers and
    // may be referenced; `scheduled` events have no actual yet and can never
    // account for a move that already happened. Collapsing them reintroduces
    // exactly that bug.
    macro: {
      scheduled: macroToday,
      completed: macroCompleted,
    },
    // Retained so rows stored before the split still render.
    macro_today:      macroToday,
    macro_recent_24h: macroYesterday,
    news:             allNews,
    funding_rates:    Object.keys(fundingRates).length ? fundingRates : null,
    open_interest:    Object.keys(openInterest).length ? openInterest : null,
    fred:             (fredData.cpi || fredData.fed_funds_rate || fredData.yield_10y) ? fredData : null,
  };
}

// ── synthesize ───────────────────────────────────────────────────────────────

/** Kept in sync with eval/run.js — these are the phrases the product exists to avoid. */
const BANNED_CAUSAL = [
  'because of', 'due to', 'caused by', 'driven by', 'in response to', 'on the back of',
  'triggered by', 'sparked by', 'fuelled by', 'fueled by', 'weighed down by',
  'boosted by', 'thanks to',
];
const BANNED_VERDICT = [
  'bullish', 'bearish', 'oversold', 'overbought', 'load up', 'price target',
  'will reach', 'could reach', 'poised to', 'ready to bounce', 'should buy', 'should sell',
];
// We are never given consensus figures, so any of these means the model invented one.
const BANNED_CONSENSUS = [
  'vs expected', 'versus expected', 'vs forecast', 'versus forecast', 'consensus',
  'expectations of', 'analysts expected', 'economists expected',
  'beat expectations', 'missed expectations', 'above expectations', 'below expectations',
];

async function callModel(userPrompt, maxTokens, system = SYSTEM_PROMPT, model = config.aiModel) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://vrynn.xyz',
      'X-Title':       'Vrynn',
    },
    body: JSON.stringify({
      model,
      messages:   [
        { role: 'system', content: system },
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

  // A syntactically valid body can still be missing required fields — observed
  // in practice, not theoretical. Treat that as a failed attempt so the retry
  // fires, rather than shipping a page with a hole in it.
  const REQUIRED = ['headline', 'direction', 'brief', 'drivers', 'explained'];
  const missing  = REQUIRED.filter(f => parsed[f] == null);
  if (missing.length) throw new Error(`response missing required field(s): ${missing.join(', ')}`);

  // The honesty bar is enforced here, not merely requested in the prompt. The
  // eval catches leaks in testing; the cron publishes unattended every day, so
  // the same check has to run in production. A violation fails the attempt and
  // retries — and if every attempt leaks, synthesize returns null and the page
  // renders data without prose. Publishing no read is strictly better than
  // publishing a causal claim the data does not support.
  const prose = `${parsed.headline} ${parsed.brief}`.toLowerCase();
  const causal = BANNED_CAUSAL.filter(p => prose.includes(p));
  if (causal.length) throw new Error(`banned causal phrase(s): ${causal.join(', ')}`);
  const verdict = BANNED_VERDICT.filter(p => prose.includes(p));
  if (verdict.length) throw new Error(`verdict/advice term(s): ${verdict.join(', ')}`);
  const invented = BANNED_CONSENSUS.filter(p => prose.includes(p));
  if (invented.length) throw new Error(`fabricated consensus: ${invented.join(', ')}`);

  return { parsed, reason };
}

/** One model call per day, but retry once on a malformed body. The usual cause
 *  is the completion hitting the token ceiling mid-JSON, which throws in
 *  JSON.parse and would otherwise publish a brief with tiles and no prose. */
/** Extra guidance for sector reads. Appended to the shared system prompt so the
 *  honesty rules (fact/coincidence/unknown, no causation, no advice) still apply
 *  unchanged — this only adds what a sector read must additionally do. */
const SECTOR_PROMPT = `

## This is a SECTOR read

Compare the sector's move to the overall market move and state the relationship as a FACT: outperforming, underperforming, or in line. Then, only if the data supports it, note a sector-specific coincidence (a completed macro print, a constituent-level event).

Most days a sector simply tracks the broad market with no sector-specific catalyst. When that is the case, say so plainly — "in line with the broad market; no sector-specific driver" — and grade it unexplained. Do not invent a sector narrative. A sector that merely moved with the market is the normal case, not a failure to explain.

A LARGE DIVERGENCE IS NOT AN EXPLANATION. When a sector moves far more than the market — 5%, 10%, more — the pull to explain it is strongest and the data supporting an explanation is usually no better than on a quiet day. Size of move never licenses causal language. State the divergence as a fact, then say plainly that the data contains no sector-specific driver if it does not. "Gaming rose 8% while the broad market rose 0.5%; no sector-specific catalyst appears in the data" is a complete and correct read. Never write that a sector move was driven by, fuelled by, or a response to anything.

If sector.read_as_flows is true (stablecoins), do NOT lead on the price move — these are pegged, so a ~0% change is meaningless and reporting it as "little movement" wastes the read. Lead instead on the direction and size of the market-cap change, which represents supply expanding or contracting. Expanding stablecoin supply is capital entering; contracting is capital leaving. State that as a fact about supply, never as a signal to act on.`;

export async function synthesize(marketState, opts = {}) {
  const system = opts.mode === 'sector' ? SYSTEM_PROMPT + SECTOR_PROMPT : SYSTEM_PROMPT;
  const label  = opts.mode === 'sector' ? 'sector read' : 'brief';

  const userPrompt =
    `Today's market data (this is the complete set of inputs — reason only from what is listed):\n\n` +
    `${JSON.stringify(marketState, null, 2)}\n\nGenerate the ${label}.`;

  // The brief is ~500 tokens of output; these caps exist only to absorb variance,
  // not because long output is wanted. Kept modest deliberately — the previous
  // model was a reasoning model that consumed the whole budget invisibly before
  // emitting, which is why it was replaced rather than given a bigger budget.
  const attempts = [1600, 2400, 2400];
  for (let i = 0; i < attempts.length; i++) {
    try {
      const { parsed, reason } = await callModel(userPrompt, attempts[i], system, config.aiModel);
      if (reason === 'length') throw new Error('completion truncated (finish_reason=length)');
      return parsed;
    } catch (err) {
      const last = i === attempts.length - 1;
      console.error(`[brief] ${label} synthesis attempt ${i + 1}/${attempts.length} failed:`, err.message);
      if (last) {
        // Last resort: a different provider. The primary's failure mode is an
        // empty completion, which no amount of retrying the same model fixes.
        try {
          const { parsed } = await callModel(userPrompt, 2000, system, config.aiModelFallback);
          console.error(`[brief] recovered via fallback model ${config.aiModelFallback}`);
          return parsed;
        } catch (fbErr) {
          console.error('[brief] fallback model also failed:', fbErr.message);
        }
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

/**
 * Type system. Serif for prose, mono for every number and label — the reader can
 * tell data from writing without being told, which is the same distinction the
 * product is built on. Tabular figures keep counting numbers from shifting the
 * layout. Fonts are self-hosted (see the /fonts route) and `swap` means text is
 * readable before they land.
 */
export const FONT_CSS = `
  @font-face { font-family:'Newsreader'; font-style:normal; font-weight:300 600;
    font-display:swap; src:url('/fonts/newsreader-300-600.woff2') format('woff2'); }
  @font-face { font-family:'IBM Plex Mono'; font-style:normal; font-weight:400;
    font-display:swap; src:url('/fonts/ibm-plex-mono-400.woff2') format('woff2'); }
  @font-face { font-family:'IBM Plex Mono'; font-style:normal; font-weight:500;
    font-display:swap; src:url('/fonts/ibm-plex-mono-500.woff2') format('woff2'); }
  :root { --serif:'Newsreader', Georgia, 'Times New Roman', serif;
          --mono:'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace; }
  body { font-family:var(--serif); font-optical-sizing:auto; -webkit-font-smoothing:antialiased; }
  /* Everything numeric or label-like sits on the mono rail. */
  .label, .value, .sub, .date, .explained, .driver-tag, .hero-pill, .rail-label,
  .recent-date, .sub-note, .entry-date, .sources, .track-record, footer,
  .today-label, .today-cap, .today-chg, .sector-links a, .brief-headline {
    font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .value, .today-cap { letter-spacing:-.01em; }
  h1, h2, .landing-h, .sub-title, .point-t, .hero-title { font-family:var(--serif); font-weight:600; }
  .read p, .recent-line, .driver-claim, .point-d, .landing-sub, .hero-sub, .sub-copy {
    font-family:var(--serif); }
  .read p:first-child::first-letter { float:left; font-size:3.1em; line-height:.84;
    padding:.06em .09em 0 0; font-weight:600; color:var(--a2); }
`;

/**
 * Sparkline web component + motion. Sparklines are fed real stored history, so
 * they carry signal rather than decoration. Motion is opt-out-aware: reduced
 * motion skips the animation entirely rather than shortening it.
 */
export const ENHANCE_JS = `
<script>
(function(){
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  class VrSpark extends HTMLElement {
    connectedCallback(){
      var v = (this.getAttribute('values')||'').split(',').map(Number).filter(function(n){return !isNaN(n);});
      if (v.length < 2) { this.style.display='none'; return; }
      var W=100,H=26,P=2, lo=Math.min.apply(null,v), hi=Math.max.apply(null,v), r=(hi-lo)||1;
      var x=function(i){return (i/(v.length-1))*W;}, y=function(n){return H-P-((n-lo)/r)*(H-P*2);};
      var pts=v.map(function(n,i){return x(i).toFixed(2)+','+y(n).toFixed(2);}).join(' ');
      var rising=v[v.length-1]>=v[0];
      var c=getComputedStyle(this).getPropertyValue(rising?'--up':'--down').trim();
      this.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true" '+
        'style="width:100%;height:100%;overflow:visible">'+
        '<polygon points="0,'+H+' '+pts+' '+W+','+H+'" fill="'+c+'" opacity=".10"></polygon>'+
        '<polyline points="'+pts+'" fill="none" stroke="'+c+'" stroke-width="1.25" '+
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>'+
        '<circle cx="'+x(v.length-1)+'" cy="'+y(v[v.length-1])+'" r="1.7" fill="'+c+'"></circle></svg>';
    }
  }
  if (!customElements.get('vr-spark')) customElements.define('vr-spark', VrSpark);

  function countUp(el){
    var target=parseFloat(el.dataset.count), dp=+(el.dataset.dp||0);
    var pre=el.dataset.prefix||'', suf=el.dataset.suffix||'';
    var fmt=function(n){return pre+n.toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp})+suf;};
    if (still){ el.textContent=fmt(target); return; }
    var dur=800, t0=performance.now();
    (function step(t){
      var p=Math.min((t-t0)/dur,1), e=1-Math.pow(1-p,3);
      el.textContent=fmt(target*e);
      if(p<1) requestAnimationFrame(step); else el.textContent=fmt(target);
    })(t0);
  }

  var reveals=document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || still){
    reveals.forEach(function(el){ el.classList.add('in'); });
    document.querySelectorAll('[data-count]').forEach(countUp);
    return;
  }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      e.target.classList.add('in');
      e.target.querySelectorAll('[data-count]').forEach(countUp);
      io.unobserve(e.target);
    });
  },{threshold:.12});
  reveals.forEach(function(el,i){ el.style.transitionDelay=(i*55)+'ms'; io.observe(el); });
})();
</script>`;

export const MOTION_CSS = `
  .reveal { opacity:0; transform:translateY(9px);
            transition:opacity .5s ease, transform .5s ease; }
  .reveal.in { opacity:1; transform:none; }
  @media (prefers-reduced-motion: reduce) {
    .reveal { opacity:1; transform:none; transition:none; }
  }
  vr-spark { display:block; margin-top:9px; height:26px; }
`;

/**
 * Sits at the foot of the page, after the reader has finished and found it
 * useful — not a popup that interrupts before the value has been shown.
 * Works without JavaScript (plain POST to a confirmation page); the inline
 * script only upgrades it to submit without navigating away.
 */
export const SUBSCRIBE_BLOCK = `
    <section class="subscribe" id="subscribe">
      <h2 class="sub-title">Get tomorrow's brief.</h2>
      <p class="sub-copy">The same honest read, in your inbox each morning —
        including the mornings it says there's no clear catalyst.</p>
      <form class="sub-form" method="POST" action="/subscribe">
        <input type="email" name="email" required maxlength="254" autocomplete="email"
               placeholder="you@email.com" aria-label="Email address">
        <button type="submit">Send it</button>
      </form>
      <p class="sub-note" role="status">One email a day. No spam, no advice, unsubscribe from any of them.
        Your address is used only to send the brief and is never shared.</p>
    </section>
    <script>
      (function () {
        var f = document.querySelector('.sub-form'); if (!f) return;
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var note = document.querySelector('.sub-note');
          var btn = f.querySelector('button'); btn.disabled = true;
          fetch('/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ email: f.email.value, source: 'brief' })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { f.style.display = 'none'; note.textContent = "You're on the list — tomorrow's brief lands in the morning."; }
            else { btn.disabled = false; note.textContent = d.error || 'Could not save that. Try again.'; }
          }).catch(function () { f.submit(); });
        });
      })();
    </script>`;

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
  const { landing = false, honesty = null, spark = null } = opts;
  const mc  = signals.market ?? {};
  const btc = signals.assets?.BTC ?? {};
  const eth = signals.assets?.ETH ?? {};
  const sol = signals.assets?.SOL ?? {};
  const fg  = signals.sentiment;

  const dir = mc.total_market_cap_change_24h_pct == null ? 'moving'
            : mc.total_market_cap_change_24h_pct >= 0 ? 'up' : 'down';

  // Every number on this page is a snapshot taken when the brief was generated —
  // it is the evidence the prose reasons about, so it must not move. Saying so is
  // the same discipline the product applies to its claims, applied to itself.
  const asOf = signals.as_of_utc
    ? `${new Date(signals.as_of_utc).toISOString().slice(11, 16)} UTC`
    : null;

  const prettyDate = new Date(`${signals.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  const title = `Why is crypto ${dir} today? — ${prettyDate} | Vrynn`;
  const desc  = `Crypto market cap ${fmtPct(mc.total_market_cap_change_24h_pct)} over 24h. `
              + `BTC ${fmtPct(btc.change_24h_pct)}, ETH ${fmtPct(eth.change_24h_pct)}, `
              + `SOL ${fmtPct(sol.change_24h_pct)}. What moved and what coincided with it.`;

  const sparkTag = (series) =>
    Array.isArray(series) && series.length > 1
      ? `<vr-spark values="${series.join(',')}"></vr-spark>` : '';

  const tile = (label, value, sub, cls = '', series = null) => `
      <div class="tile">
        <div class="label">${esc(label)}</div>
        <div class="value ${cls}">${esc(value)}</div>
        <div class="sub ${cls}">${esc(sub)}</div>
        ${sparkTag(series)}
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

  // Recent briefs sit full-width BELOW the prose, not in the rail. The rail is
  // only as tall as the drivers list, so pairing it with a long link list left a
  // dead column beside the prose whenever the read was short.
  const recentHtml = recentBriefs.length
    ? `<section class="recent">
        <div class="recent-head">
          <div class="rail-label">Recent briefs</div>
          <a class="rail-more" href="/brief">All briefs →</a>
        </div>
        <div class="recent-grid">
          ${recentBriefs.map(b => `
          <a class="recent-card" href="/brief/${esc(b.date)}">
            <span class="recent-date">${esc(prettyDay(b.date))}</span>
            <span class="recent-line">${esc(briefSummary(b))}</span>
          </a>`).join('')}
        </div>
      </section>`
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
<meta property="og:type" content="article">
<meta property="og:site_name" content="Vrynn">
<meta property="og:title" content="${esc(synthesis?.headline || title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="https://vrynn.xyz/brief/${esc(signals.date)}">
<meta property="og:image" content="https://vrynn.xyz/og/${esc(signals.date)}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="${esc(signals.date)}T06:00:00Z">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(synthesis?.headline || title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://vrynn.xyz/og/${esc(signals.date)}.png">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: (synthesis?.headline || title).slice(0, 110),
  description: desc,
  datePublished: `${signals.date}T06:00:00Z`,
  dateModified: `${signals.date}T06:00:00Z`,
  mainEntityOfPage: { '@type': 'WebPage', '@id': `https://vrynn.xyz/brief/${signals.date}` },
  image: [`https://vrynn.xyz/og/${signals.date}.png`],
  author:    { '@type': 'Organization', name: 'Vrynn', url: 'https://vrynn.xyz' },
  publisher: { '@type': 'Organization', name: 'Vrynn', url: 'https://vrynn.xyz' },
  isAccessibleForFree: true,
}).replace(/</g, '\\u003c')}</script>
<style>
  /* Neutrals carry a slight blue cast — pure #fff/#111 reads flat and unfinished. */
  :root { --bg:#fcfcfd; --fg:#0f1115; --muted:#5b6070; --line:#e6e7ec; --card:#f7f8fa;
          --up:#0a8f4d; --down:#d81b60; --a1:#00c8e0; --a2:#7000e0; --wash:.10;
          --shadow:0 1px 2px rgba(15,17,21,.04), 0 10px 28px rgba(15,17,21,.06); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0c10; --fg:#eef0f4; --muted:#9aa0b0; --line:#23252d; --card:#14161c;
            --up:#2ecc71; --down:#ff4d8d; --a1:#22d3ee; --a2:#a855f7; --wash:.16;
            --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.35); }
  }
  * { box-sizing: border-box; }
  ${FONT_CSS}
  ${MOTION_CSS}
  body { margin:0; background:var(--bg); color:var(--fg); position:relative;
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  /* Soft aurora behind the top of the page — depth without decoration. */
  body::before { content:''; position:absolute; top:0; left:0; right:0; height:640px;
    z-index:-1; pointer-events:none;
    background:radial-gradient(900px 420px at 10% -10%, rgba(0,200,224,var(--wash)), transparent 60%),
               radial-gradient(780px 380px at 90% -6%,  rgba(112,0,224,var(--wash)), transparent 62%); }
  .grad { background:linear-gradient(90deg,var(--a1),var(--a2)); -webkit-background-clip:text;
          background-clip:text; color:transparent; }
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
  .today-card  { position:relative; overflow:hidden; background:var(--bg);
                 border:1px solid var(--line); border-radius:14px;
                 padding:20px; box-shadow:var(--shadow); }
  .today-card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px;
                        background:linear-gradient(90deg,var(--a1),var(--a2)); }
  .today-label { font-size:11px; color:var(--muted); text-transform:uppercase;
                 letter-spacing:.07em; margin-bottom:11px; }
  .today-cap   { font-size:27px; font-weight:800; letter-spacing:-.02em; line-height:1.1; }
  .today-chg   { font-size:14px; margin-top:3px; }
  .today-badge { margin-top:13px; }
  .today-note  { font-size:12.5px; color:var(--muted); margin:13px 0 0; padding-top:12px;
                 border-top:1px solid var(--line); line-height:1.5; }
  .landing-cta { display:inline-block; font-size:14px; font-weight:650; text-decoration:none;
                 color:#fff; background:linear-gradient(90deg,var(--a1),var(--a2)); border:0;
                 border-radius:9px; padding:12px 20px;
                 box-shadow:0 6px 18px rgba(112,0,224,.24);
                 transition:transform .15s ease, box-shadow .15s ease, filter .15s ease; }
  .landing-cta:hover { filter:brightness(1.07); transform:translateY(-1px);
                       box-shadow:0 10px 24px rgba(112,0,224,.3); }
  .points  { display:grid; grid-template-columns:1fr; gap:26px; margin-top:44px; }
  @media (min-width:820px) { .points { grid-template-columns:repeat(3,1fr); gap:34px; } }
  .point-t { font-size:15px; font-weight:700; margin:0 0 7px; }
  .point-t::before { content:''; display:block; width:28px; height:3px; border-radius:2px;
                     margin-bottom:12px; background:linear-gradient(90deg,var(--a1),var(--a2)); }
  .point-d { font-size:14px; color:var(--muted); margin:0; line-height:1.62; }
  /* Spans the full container so its rule lines up with the tile grid below. */
  .sources { margin-top:14px; font-size:13px; color:var(--muted); line-height:1.6; }
  /* Crawlable path from the homepage to every sector page — internal links pass
     the little authority the homepage has, which the sitemap alone cannot do. */
  .sector-nav { margin-top:40px; padding-top:20px; border-top:1px solid var(--line); }
  .sector-nav-label { font-size:11px; color:var(--muted); text-transform:uppercase;
                      letter-spacing:.07em; margin-bottom:13px; }
  .sector-links { display:flex; flex-wrap:wrap; gap:8px; }
  .sector-links a { font-size:13px; text-decoration:none; color:var(--fg); background:var(--card);
                    border:1px solid var(--line); border-radius:8px; padding:6px 12px;
                    transition:border-color .15s ease, transform .15s ease; }
  .sector-links a:hover { border-color:var(--muted); transform:translateY(-1px); }
  .track-record { margin-top:38px; padding-top:18px; border-top:1px solid var(--line);
                  font-size:13.5px; color:var(--muted); line-height:1.6; }
  .track-record strong { color:var(--fg); font-weight:700; }
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
  .tile  { background:var(--card); border:1px solid var(--line); border-radius:11px;
           padding:15px 16px; min-width:0;
           transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
  .tile:hover { transform:translateY(-2px); box-shadow:var(--shadow); border-color:transparent; }
  .tile .value, .tile .sub { overflow-wrap:anywhere; }
  .label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; }
  .value { font-size:20px; font-weight:700; margin-top:4px; }
  .sub   { font-size:13px; color:var(--muted); margin-top:2px; }
  .up    { color:var(--up); } .down { color:var(--down); }
  .value.up, .value.down { color:var(--fg); }
  .read p { margin:0 0 16px; }
  /* Lead paragraph — the standard editorial cue that this is the start of a piece. */
  .read p:first-child { font-size:18px; line-height:1.6; letter-spacing:-.005em; }
  .read p:first-child::first-letter { font-size:1.05em; font-weight:600; }
  .unavailable { color:var(--muted); font-style:italic; }
  /* Prose + rail. One column on phones; prose capped at 700px beside the rail
     from 900px up, so the reading measure never stretches with the viewport. */
  .body { display:grid; grid-template-columns:1fr; gap:36px; }
  @media (min-width:900px) {
    .body { grid-template-columns:minmax(0,700px) minmax(230px,1fr); gap:56px; align-items:start; }
  }
  .rail { display:flex; flex-direction:column; gap:20px; }
  /* Rail blocks read as a distinct column rather than loose text beside the prose. */
  .rail-block { min-width:0; background:var(--card); border:1px solid var(--line);
                border-radius:12px; padding:16px 18px; }
  .rail-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em;
                margin-bottom:13px; }
  /* Same accent rule as the landing's three points — one visual language. */
  .rail-label::before { content:''; display:block; width:24px; height:3px; border-radius:2px;
                        margin-bottom:11px; background:linear-gradient(90deg,var(--a1),var(--a2)); }
  .rail-more  { display:inline-block; margin-top:12px; font-size:12.5px; color:var(--muted); text-decoration:none; }
  .rail-more:hover { text-decoration:underline; }
  .recent { margin-top:44px; padding-top:22px; border-top:1px solid var(--line); }
  .recent-head { display:flex; align-items:baseline; justify-content:space-between; gap:16px; }
  .recent-head .rail-label { margin-bottom:14px; }
  .recent-grid { display:grid; grid-template-columns:1fr; gap:12px; }
  @media (min-width:640px) { .recent-grid { grid-template-columns:repeat(2,1fr); } }
  @media (min-width:960px) { .recent-grid { grid-template-columns:repeat(3,1fr); } }
  .recent-card { display:block; padding:14px 16px; background:var(--card);
                 border:1px solid var(--line); border-radius:11px;
                 text-decoration:none; color:inherit;
                 transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
  .recent-card:hover { transform:translateY(-2px); box-shadow:var(--shadow); border-color:transparent; }
  .driver:last-child { margin-bottom:0; }
  .recent-date { display:block; font-size:11.5px; color:var(--muted); }
  .recent-line { display:block; font-size:13.5px; line-height:1.45; margin-top:2px; }
  .recent-item:hover .recent-line { text-decoration:underline; }
  .driver { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; font-size:13.5px; line-height:1.5; }
  .driver-tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                padding:2px 7px; border-radius:4px; white-space:nowrap; flex-shrink:0; }
  .driver-tag--fact        { background:rgba(0,200,224,.15);  color:#00c8e0; }
  .driver-tag--coincidence { background:rgba(112,0,224,.15);  color:#a366e0; }
  .driver-tag--unknown     { background:rgba(150,150,150,.15);color:var(--muted); }
  /* Only ever rendered when a spike cleared every guard — no empty state exists. */
  .spike { margin:0 0 26px; padding:15px 18px; background:var(--card);
           border:1px solid var(--line); border-left:3px solid var(--a2); border-radius:11px; }
  .spike-label { font-family:var(--mono); font-size:10.5px; color:var(--muted);
                 text-transform:uppercase; letter-spacing:.09em; margin-bottom:6px; }
  .spike-note { margin:0; font-size:15px; line-height:1.55; }
  .spike-link { display:inline-block; margin-top:9px; font-family:var(--mono);
                font-size:12px; color:var(--muted); text-decoration:none; }
  .spike-link:hover { text-decoration:underline; }
  .as-of { font-family:var(--mono); font-size:11.5px; color:var(--muted); letter-spacing:.02em;
           margin:-22px 0 30px; line-height:1.5; }
  .subscribe { margin-top:44px; padding:26px 24px; background:var(--card);
               border:1px solid var(--line); border-radius:14px; }
  .sub-title { font-size:20px; font-weight:700; letter-spacing:-.02em; margin:0 0 7px; }
  .sub-copy  { color:var(--muted); font-size:14.5px; margin:0 0 16px; max-width:56ch; line-height:1.55; }
  .sub-form  { display:flex; flex-wrap:wrap; gap:9px; margin-bottom:12px; }
  .sub-form input { flex:1 1 240px; min-width:0; font:inherit; font-size:14.5px;
                    padding:11px 14px; border-radius:9px; border:1px solid var(--line);
                    background:var(--bg); color:var(--fg); }
  .sub-form input:focus { outline:none; border-color:var(--a1); }
  .sub-form button { font:inherit; font-size:14.5px; font-weight:650; color:#fff; border:0;
                     padding:11px 22px; border-radius:9px; cursor:pointer;
                     background:linear-gradient(90deg,var(--a1),var(--a2));
                     box-shadow:0 6px 18px rgba(112,0,224,.24); }
  .sub-form button:hover:not(:disabled) { filter:brightness(1.07); }
  .sub-form button:disabled { opacity:.6; cursor:default; }
  .sub-note  { color:var(--muted); font-size:12.5px; margin:0; line-height:1.55; }
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
          <h1 class="landing-h">Understand what <span class="grad">actually</span> moved crypto today.</h1>
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

      <div class="sector-nav">
        <div class="sector-nav-label">By sector</div>
        <div class="sector-links">
          ${SECTORS.map(s => `<a href="/sector/${esc(s.slug)}">${esc(s.label)}</a>`).join('')}
        </div>
      </div>

      ${honesty ? `
      <p class="track-record">Over the last ${esc(honesty.days)} days,
        <strong>${esc(honesty.explainedPct)}%</strong> of daily market moves had a clear,
        data-linked driver. The remaining ${esc(100 - honesty.explainedPct)}% we flagged as
        having no identifiable catalyst rather than inventing one.</p>` : ''}

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

    <div class="tiles reveal">
      ${tile('Total market cap', fmtUsd(mc.total_market_cap_usd), `${fmtPct(mc.total_market_cap_change_24h_pct)} 24h`, dirClass(mc.total_market_cap_change_24h_pct), spark?.mcap)}
      ${tile('Bitcoin',   fmtUsd(btc.price_usd), `${fmtPct(btc.change_24h_pct)} 24h`, dirClass(btc.change_24h_pct), spark?.btc)}
      ${tile('Ethereum',  fmtUsd(eth.price_usd), `${fmtPct(eth.change_24h_pct)} 24h`, dirClass(eth.change_24h_pct), spark?.eth)}
      ${tile('Solana',    fmtUsd(sol.price_usd), `${fmtPct(sol.change_24h_pct)} 24h`, dirClass(sol.change_24h_pct), spark?.sol)}
      ${tile('BTC dominance', mc.btc_dominance_pct == null ? 'n/a' : `${mc.btc_dominance_pct.toFixed(1)}%`, mc.eth_dominance_pct == null ? '' : `ETH ${mc.eth_dominance_pct.toFixed(1)}%`, '', spark?.dom)}
      ${tile('Fear & Greed',  fg ? String(fg.fear_greed_value) : 'n/a', fg ? fg.fear_greed_label : '', '', spark?.fg)}
      ${(() => {
        const btcOi = signals.open_interest?.BTC?.contracts;
        const ethOi = signals.open_interest?.ETH?.contracts;
        return tile('Open interest', btcOi != null ? `${fmtOi(btcOi)} BTC` : 'n/a', ethOi != null ? `ETH ${fmtOi(ethOi)}` : '');
      })()}
      ${(() => {
        // A completed print outranks a scheduled one — it has a real number.
        const done = signals.macro?.completed ?? [];
        if (done.length) {
          const t = done[0];
          const val = t.unit === 'k' ? `${t.actual >= 0 ? '+' : ''}${t.actual}k`
                    : t.unit === '$' ? `$${t.actual}`
                    : `${t.actual}%`;
          const prev = t.previous == null ? 'released'
                     : `from ${t.unit === 'k' ? `${t.previous}k` : t.unit === '$' ? `$${t.previous}` : `${t.previous}%`} prior`;
          return tile(t.event.length > 20 ? t.event.slice(0, 18) + '…' : t.event, val, prev);
        }
        // Fall back to the schedule (and to the pre-split key for stored rows).
        const events = signals.macro?.scheduled ?? signals.macro_today ?? [];
        const top = events.find(e => e.importance === 'high') ?? events[0] ?? null;
        const label = top ? (top.event.length > 22 ? top.event.slice(0, 20) + '…' : top.event) : 'Quiet';
        const sub   = top ? `${top.currency} · ${top.status}` : 'No high-impact events';
        return tile('Macro today', label, sub);
      })()}
    </div>

    ${synthesis?.sector_note ? `<div class="spike col">
      <div class="spike-label">Sector move</div>
      <p class="spike-note">${esc(synthesis.sector_note)}</p>
      ${signals.sector_spike?.slug ? `<a class="spike-link" href="/sector/${esc(signals.sector_spike.slug)}">Full ${esc(signals.sector_spike.label)} read →</a>` : ''}
    </div>` : ''}

    ${asOf ? `<p class="as-of">Market data as of ${esc(asOf)} on ${esc(prettyDate)} — captured once daily when the brief is written, and not updated afterwards.</p>` : ''}

    <div class="body reveal">
      <div class="read">
        ${briefHtml}
      </div>
      <aside class="rail">
        ${driversHtml}
      </aside>
    </div>

    ${recentHtml}

    ${SUBSCRIBE_BLOCK}

    <footer>
      Vrynn reports what moved and what coincided with it. It does not assert causation
      and does not provide investment advice. Data: CoinGecko, Alternative.me, Coinalyze, FRED, ForexFactory, CoinTelegraph, Decrypt.
    </footer>
  </div>
  ${ENHANCE_JS}
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
<meta property="og:type" content="website">
<meta property="og:site_name" content="Vrynn">
<meta property="og:title" content="Daily crypto market brief archive | Vrynn">
<meta property="og:description" content="Every daily crypto market brief — what moved and what coincided with it.">
<meta property="og:url" content="https://vrynn.xyz/brief">
<meta property="og:image" content="https://vrynn.xyz/og/${esc(briefs[0]?.date ?? 'latest')}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Daily crypto market brief archive | Vrynn">
<meta name="twitter:description" content="Every daily crypto market brief — what moved and what coincided with it.">
<meta name="twitter:image" content="https://vrynn.xyz/og/${esc(briefs[0]?.date ?? 'latest')}.png">
<style>
  /* Same token set as the brief page — the two must not look like different products. */
  :root { --bg:#fcfcfd; --fg:#0f1115; --muted:#5b6070; --line:#e6e7ec; --card:#f7f8fa;
          --a1:#00c8e0; --a2:#7000e0; --wash:.10;
          --shadow:0 1px 2px rgba(15,17,21,.04), 0 10px 28px rgba(15,17,21,.06); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0c10; --fg:#eef0f4; --muted:#9aa0b0; --line:#23252d; --card:#14161c;
            --a1:#22d3ee; --a2:#a855f7; --wash:.16;
            --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.35); }
  }
  * { box-sizing: border-box; }
  ${FONT_CSS}
  ${MOTION_CSS}
  body { margin:0; background:var(--bg); color:var(--fg); position:relative;
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  body::before { content:''; position:absolute; top:0; left:0; right:0; height:520px;
    z-index:-1; pointer-events:none;
    background:radial-gradient(900px 400px at 10% -12%, rgba(0,200,224,var(--wash)), transparent 60%),
               radial-gradient(780px 360px at 90% -8%,  rgba(112,0,224,var(--wash)), transparent 62%); }
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
  .entry { display:block; padding:15px 14px 15px 0; border-top:1px solid var(--line);
           text-decoration:none; color:inherit; border-radius:10px;
           transition:background .15s ease, padding-left .15s ease; }
  .entry:hover { background:var(--card); padding-left:14px; }
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
  const html      = renderBrief(signals, synthesis, recent, { spark: getSparkSeries(today) });

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

  const honestyStats = getHonestyStats(30);
  const honesty = honestyStats ? { ...honestyStats, days: 30 } : null;

  // Generation failed (model down) — render live so the page still serves.
  if (!row) {
    const signals   = await fetchSignals();
    const synthesis = await synthesize(signals);
    return renderBrief(signals, synthesis, getRecentBriefs(today, 6), { landing: true, honesty, spark: getSparkSeries(today) });
  }

  const html = renderBrief(
    JSON.parse(row.signals_json),
    synthesisFromRow(row),
    getRecentBriefs(today, 6),
    { landing: true, honesty, spark: getSparkSeries(today) },
  );
  cache = { ...cache, date: today, home: html };
  return html;
}
