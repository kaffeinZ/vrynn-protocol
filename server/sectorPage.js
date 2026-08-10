import { SECTORS } from './sectors.js';
import { SUBSCRIBE_BLOCK, FONT_CSS, MOTION_CSS, ENHANCE_JS } from './brief.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtUsd = (v) =>
  v == null ? 'n/a'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
  : v >= 1e9  ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6  ? `$${(v / 1e6).toFixed(0)}M`
  : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const fmtPct  = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const dirClass = (v) => (v == null ? '' : v >= 0 ? 'up' : 'down');

const prettyDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const EXPLAINED = {
  'well-explained':   'Drivers identified',
  'partly-explained': 'Partly explained',
  'unexplained':      'No sector-specific driver',
};
const DRIVER_LABEL = { fact: 'Fact', coincidence: 'Timing', unknown: 'No driver' };

/** Relative performance stated as fact — computed here, not left to the model. */
function relative(sectorChg, marketChg) {
  if (sectorChg == null || marketChg == null) return null;
  const diff = sectorChg - marketChg;
  if (Math.abs(diff) < 0.25) return { word: 'in line with', diff };
  return { word: diff > 0 ? 'outperforming' : 'underperforming', diff };
}

export function renderSectorPage(sector, state, synthesis, { dates = [], isLatest = true } = {}) {
  const s   = state.sector ?? {};
  const mk  = state.market ?? {};
  const rel = relative(s.market_cap_change_24h, mk.total_market_cap_change_24h_pct);

  const dir = s.market_cap_change_24h == null ? 'moving'
            : s.market_cap_change_24h >= 0 ? 'up' : 'down';

  const canonical = isLatest
    ? `https://vrynn.xyz/sector/${sector.slug}`
    : `https://vrynn.xyz/sector/${sector.slug}/${state.date}`;

  // Frozen snapshot, same as the daily brief — say so rather than implying it is current.
  const asOfSource = state.sector?.fetched_utc ?? state.as_of_utc;
  const asOf = asOfSource
    ? `${new Date(asOfSource).toISOString().slice(11, 16)} UTC`
    : null;

  const title = `Why are ${sector.label} tokens ${dir} today? — ${prettyDay(state.date)} | Vrynn`;
  const desc  = `${sector.label} sector ${fmtPct(s.market_cap_change_24h)} over 24h versus `
              + `${fmtPct(mk.total_market_cap_change_24h_pct)} for the whole market. `
              + `What moved and what coincided with it.`;

  const tile = (label, value, sub, cls = '') => `
      <div class="tile">
        <div class="label">${esc(label)}</div>
        <div class="value ${cls}">${esc(value)}</div>
        <div class="sub ${cls}">${esc(sub)}</div>
      </div>`;

  const paragraphs = synthesis?.brief
    ? synthesis.brief.split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('\n        ')
    : `<p class="unavailable">The written read could not be generated for this date. The sector data above is unaffected.</p>`;

  const driversHtml = synthesis?.drivers?.length ? `
      <div class="rail-block">
        <div class="rail-label">How we read this move</div>
        ${synthesis.drivers.map(d => `
        <div class="driver">
          <span class="driver-tag driver-tag--${esc(d.type)}">${DRIVER_LABEL[d.type] ?? esc(d.type)}</span>
          <span class="driver-claim">${esc(d.claim)}</span>
        </div>`).join('')}
      </div>` : '';

  const otherSectors = SECTORS.filter(x => x.slug !== sector.slug).slice(0, 11);
  const railSectors = `
      <div class="rail-block">
        <div class="rail-label">Other sectors</div>
        <div class="sector-links">
          ${otherSectors.map(x => `<a href="/sector/${esc(x.slug)}">${esc(x.label)}</a>`).join('')}
        </div>
        <a class="rail-more" href="/">Today's market brief →</a>
      </div>`;

  const archive = dates.length > 1 ? `
      <div class="rail-block">
        <div class="rail-label">Earlier reads</div>
        ${dates.filter(d => d.date !== state.date).slice(0, 5).map(d => `
        <a class="recent-item" href="/sector/${esc(sector.slug)}/${esc(d.date)}">
          <span class="recent-date">${esc(prettyDay(d.date))}</span>
        </a>`).join('')}
      </div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Vrynn">
<meta property="og:title" content="${esc(synthesis?.headline || title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(synthesis?.headline || title)}">
<meta name="twitter:description" content="${esc(desc)}">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: (synthesis?.headline || title).slice(0, 110),
  description: desc,
  datePublished: `${state.date}T06:15:00Z`,
  mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
  author:    { '@type': 'Organization', name: 'Vrynn', url: 'https://vrynn.xyz' },
  publisher: { '@type': 'Organization', name: 'Vrynn', url: 'https://vrynn.xyz' },
  isAccessibleForFree: true,
}).replace(/</g, '\\u003c')}</script>
<style>
  :root { --bg:#fcfcfd; --fg:#0f1115; --muted:#5b6070; --line:#e6e7ec; --card:#f7f8fa;
          --up:#0a8f4d; --down:#d81b60; --a1:#00c8e0; --a2:#7000e0; --wash:.10;
          --shadow:0 1px 2px rgba(15,17,21,.04), 0 10px 28px rgba(15,17,21,.06); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b0c10; --fg:#eef0f4; --muted:#9aa0b0; --line:#23252d; --card:#14161c;
            --up:#2ecc71; --down:#ff4d8d; --a1:#22d3ee; --a2:#a855f7; --wash:.16;
            --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.35); }
  }
  * { box-sizing:border-box; }
  ${FONT_CSS}
  ${MOTION_CSS}
  body { margin:0; background:var(--bg); color:var(--fg); position:relative;
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  body::before { content:''; position:absolute; top:0; left:0; right:0; height:560px; z-index:-1;
    pointer-events:none;
    background:radial-gradient(900px 400px at 10% -12%, rgba(0,200,224,var(--wash)), transparent 60%),
               radial-gradient(780px 360px at 90% -8%, rgba(112,0,224,var(--wash)), transparent 62%); }
  .wrap { max-width:1100px; margin:0 auto; padding:40px 20px 64px; }
  @media (max-width:600px) { .wrap { padding:28px 16px 48px; } }
  .col { max-width:700px; }
  .brand { font-weight:800; font-size:22px; letter-spacing:-.02em;
           background:linear-gradient(90deg,var(--a1),var(--a2)); -webkit-background-clip:text;
           background-clip:text; color:transparent; text-decoration:none; }
  .date { color:var(--muted); font-size:13px; margin-top:24px; text-transform:uppercase; letter-spacing:.08em; }
  .date a { color:var(--muted); text-decoration:none; }
  h1 { font-size:clamp(27px,4.6vw,38px); line-height:1.15; letter-spacing:-.02em; margin:8px 0 8px; }
  .brief-meta { display:flex; align-items:center; gap:10px; margin-bottom:28px; flex-wrap:wrap; }
  .brief-headline { margin:0; color:var(--muted); font-size:15px; font-style:italic; flex:1; }
  .explained { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
               padding:2px 8px; border-radius:4px; white-space:nowrap; }
  .explained--well-explained  { background:rgba(10,143,77,.15); color:var(--up); }
  .explained--partly-explained{ background:rgba(230,138,0,.15); color:#e68a00; }
  .explained--unexplained     { background:rgba(150,150,150,.15); color:var(--muted); }
  .tiles { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin-bottom:36px; }
  @media (min-width:760px) { .tiles { grid-template-columns:repeat(4,1fr); } }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:11px; padding:15px 16px; min-width:0;
          transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
  .tile:hover { transform:translateY(-2px); box-shadow:var(--shadow); border-color:transparent; }
  .label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; }
  .value { font-size:20px; font-weight:700; margin-top:4px; overflow-wrap:anywhere; }
  .sub   { font-size:13px; color:var(--muted); margin-top:2px; overflow-wrap:anywhere; }
  .up { color:var(--up); } .down { color:var(--down); }
  .value.up, .value.down { color:var(--fg); }
  .body { display:grid; grid-template-columns:1fr; gap:36px; }
  @media (min-width:900px) { .body { grid-template-columns:minmax(0,700px) minmax(230px,1fr); gap:56px; align-items:start; } }
  .read p { margin:0 0 16px; }
  .read p:first-child { font-size:18px; line-height:1.6; letter-spacing:-.005em; }
  .unavailable { color:var(--muted); font-style:italic; }
  .rail { display:flex; flex-direction:column; gap:20px; }
  .rail-block { min-width:0; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .rail-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.07em; margin-bottom:13px; }
  .rail-label::before { content:''; display:block; width:24px; height:3px; border-radius:2px;
                        margin-bottom:11px; background:linear-gradient(90deg,var(--a1),var(--a2)); }
  .rail-more { display:inline-block; margin-top:12px; font-size:12.5px; color:var(--muted); text-decoration:none; }
  .rail-more:hover { text-decoration:underline; }
  .sector-links { display:flex; flex-wrap:wrap; gap:7px; }
  .sector-links a { font-size:12.5px; text-decoration:none; color:var(--fg); background:var(--bg);
                    border:1px solid var(--line); border-radius:7px; padding:4px 9px; }
  .sector-links a:hover { border-color:var(--muted); }
  .recent-item { display:block; padding:8px 0; border-bottom:1px solid var(--line); text-decoration:none; color:inherit; }
  .recent-item:last-of-type { border-bottom:0; }
  .recent-date { font-size:13px; }
  .recent-item:hover .recent-date { text-decoration:underline; }
  .driver { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; font-size:13.5px; line-height:1.5; }
  .driver:last-child { margin-bottom:0; }
  .driver-tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                padding:2px 7px; border-radius:4px; white-space:nowrap; flex-shrink:0; }
  .driver-tag--fact        { background:rgba(0,200,224,.15); color:#0093a8; }
  .driver-tag--coincidence { background:rgba(112,0,224,.15); color:#7a3fd0; }
  .driver-tag--unknown     { background:rgba(150,150,150,.15); color:var(--muted); }
  .as-of { font-family:var(--mono); font-size:11.5px; color:var(--muted); letter-spacing:.02em;
           margin:-22px 0 30px; line-height:1.5; }
  .subscribe { margin-top:44px; padding:26px 24px; background:var(--card);
               border:1px solid var(--line); border-radius:14px; }
  .sub-title { font-size:20px; font-weight:700; letter-spacing:-.02em; margin:0 0 7px; }
  .sub-copy  { color:var(--muted); font-size:14.5px; margin:0 0 16px; max-width:56ch; line-height:1.55; }
  .sub-form  { display:flex; flex-wrap:wrap; gap:9px; margin-bottom:12px; }
  .sub-form input { flex:1 1 240px; min-width:0; font:inherit; font-size:14.5px; padding:11px 14px;
                    border-radius:9px; border:1px solid var(--line); background:var(--bg); color:var(--fg); }
  .sub-form input:focus { outline:none; border-color:var(--a1); }
  .sub-form button { font:inherit; font-size:14.5px; font-weight:650; color:#fff; border:0;
                     padding:11px 22px; border-radius:9px; cursor:pointer;
                     background:linear-gradient(90deg,var(--a1),var(--a2));
                     box-shadow:0 6px 18px rgba(112,0,224,.24); }
  .sub-form button:hover:not(:disabled) { filter:brightness(1.07); }
  .sub-form button:disabled { opacity:.6; cursor:default; }
  .sub-note  { color:var(--muted); font-size:12.5px; margin:0; line-height:1.55; }
  footer { margin-top:40px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
</style>
</head>
<body>
  <div class="wrap">
    <div><a class="brand" href="/">Vrynn</a></div>

    <div class="date col">
      <a href="/">← Market brief</a> &nbsp;·&nbsp; ${esc(prettyDay(state.date))}
    </div>
    <h1 class="col">Why are ${esc(sector.label)} tokens ${esc(dir)} today?</h1>
    <div class="brief-meta col">
      ${synthesis?.headline ? `<p class="brief-headline">${esc(synthesis.headline)}</p>` : ''}
      ${synthesis?.explained ? `<span class="explained explained--${esc(synthesis.explained)}">${esc(EXPLAINED[synthesis.explained] ?? synthesis.explained)}</span>` : ''}
    </div>

    <div class="tiles reveal">
      ${tile(`${sector.label} market cap`, fmtUsd(s.market_cap_usd), `${fmtPct(s.market_cap_change_24h)} 24h`, dirClass(s.market_cap_change_24h))}
      ${tile('Whole market', fmtPct(mk.total_market_cap_change_24h_pct), '24h change', dirClass(mk.total_market_cap_change_24h_pct))}
      ${tile('Relative', rel ? rel.word : 'n/a', rel ? `${fmtPct(rel.diff)} vs market` : '', rel ? dirClass(rel.diff) : '')}
      ${tile('Sector volume', fmtUsd(s.volume_24h_usd), '24h traded')}
    </div>

    ${asOf ? `<p class="as-of">Sector data as of ${esc(asOf)} on ${esc(prettyDay(state.date))} — captured once daily when the read is written, and not updated afterwards.</p>` : ''}

    <div class="body reveal">
      <div class="read">
        ${paragraphs}
      </div>
      <aside class="rail">
        ${driversHtml}
        ${archive}
        ${railSectors}
      </aside>
    </div>

    ${SUBSCRIBE_BLOCK}

    <footer>
      Vrynn reports what moved and what coincided with it. It does not assert causation and
      does not provide investment advice. Sector aggregates: CoinGecko. Macro: BLS, FRED, ForexFactory.
    </footer>
  </div>
  ${ENHANCE_JS}
</body>
</html>`;
}
