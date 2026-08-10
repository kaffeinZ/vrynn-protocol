import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import routes from './api/routes.js';
import { bot } from './alerts.js';
import { startMonitor } from './monitor.js';
import rateLimit from 'express-rate-limit';
import { getBriefHtml, getHomepageHtml, renderArchive } from './brief.js';
import { startBriefCron } from './cron.js';
import { getAllBriefs, getSitemapEntries, getDailyBrief, getLatestSectorBrief, getSectorBrief,
         getSectorDates, getSectorSitemapEntries, addSubscriber, unsubscribeByToken } from './db.js';
import { sectorBySlug, SECTORS } from './sectors.js';
import { renderSectorPage } from './sectorPage.js';
import { getOgPng } from './og.js';

const app = express();
app.set('trust proxy', 1);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://vrynn.xyz',
    'https://www.vrynn.xyz',
    'http://localhost:5173',
    'http://localhost:4173',
    /https?:\/\/localhost/,
  ],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\n\nSitemap: https://vrynn.xyz/sitemap.xml\n');
});

// Nginx proxies `/` here, so a static favicon under dashboard/ never resolves.
// Read once at boot and serve it directly — covers the brief pages and /app alike.
const FAVICON = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../dashboard/public/favicon.svg'),
  'utf-8',
);
app.get('/favicon.svg', (_req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(FAVICON);
});

// ── Self-hosted fonts ──────────────────────────────────────────────────────
// Not loaded from Google's CDN, for two reasons: it costs two render-blocking
// external requests on a site whose whole strategy is being fast and crawlable,
// and it sends every visitor's IP to Google — which UK/EU data protection makes
// a live exposure. Self-hosted is faster and removes it entirely.
const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../dashboard/public/fonts');
const FONTS = new Map();
for (const f of ['newsreader-300-600.woff2', 'ibm-plex-mono-400.woff2', 'ibm-plex-mono-500.woff2']) {
  try { FONTS.set(f, readFileSync(resolve(FONT_DIR, f))); }
  catch (err) { console.error(`[fonts] missing ${f}:`, err.message); }
}
app.get('/fonts/:file', (req, res) => {
  const buf = FONTS.get(req.params.file);
  if (!buf) return res.status(404).type('text/plain').send('Not found.');
  res.type('font/woff2').set('Cache-Control', 'public, max-age=31536000, immutable').send(buf);
});

// ── OG share cards ─────────────────────────────────────────────────────────
// Rendered from the stored row so each shared link previews with that day's real
// numbers. Cards are immutable once published, hence the long cache.
app.get('/og/:date.png', async (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).type('text/plain').send('Bad date.');

  const row = getDailyBrief(date);
  if (!row) return res.status(404).type('text/plain').send('No brief for this date.');

  try {
    const png = await getOgPng(date, JSON.parse(row.signals_json), {
      headline:  row.headline ?? null,
      explained: row.explained ?? null,
    });
    if (!png) return res.status(503).type('text/plain').send('Card unavailable.');
    res.type('image/png').set('Cache-Control', 'public, max-age=31536000, immutable').send(png);
  } catch (err) {
    console.error('[og] route failed:', err.message);
    res.status(503).type('text/plain').send('Card unavailable.');
  }
});

// ── Sitemap ────────────────────────────────────────────────────────────────
// robots.txt advertises this URL, so it must exist and must serve application/xml
// (an XML sitemap returned as text/html is silently ignored).
//
// lastmod is deliberately honest: a published brief is immutable, so its lastmod
// is its generation time and never advances. Only `/` and `/brief` move, because
// new briefs genuinely push onto them. Claiming everything changed today is the
// exact behaviour Google now discounts.
app.get('/sitemap.xml', (_req, res) => {
  const BASE = 'https://vrynn.xyz';
  const iso  = (unixSecs) => new Date(unixSecs * 1000).toISOString().slice(0, 10);

  try {
    const rows = getSitemapEntries();
    const newest = rows.length ? iso(rows[0].created_at) : new Date().toISOString().slice(0, 10);

    const urls = [
      { loc: `${BASE}/`,      lastmod: newest, changefreq: 'daily',   priority: '1.0' },
      { loc: `${BASE}/brief`, lastmod: newest, changefreq: 'daily',   priority: '0.8' },
      ...rows.map(r => ({
        loc: `${BASE}/brief/${r.date}`,
        lastmod: iso(r.created_at),
        changefreq: 'never',        // a dated brief never changes once published
        priority: '0.6',
      })),
    ];

    // Sector pages. The /sector/:slug URLs are the ones meant to rank, so they
    // carry today's lastmod; dated sector reads are immutable like dated briefs.
    const sectorRows = getSectorSitemapEntries();
    const latestBySlug = new Map();
    for (const r of sectorRows) {
      if (!latestBySlug.has(r.sector_slug)) latestBySlug.set(r.sector_slug, r);
      urls.push({
        loc: `${BASE}/sector/${r.sector_slug}/${r.date}`,
        lastmod: iso(r.created_at),
        changefreq: 'never',
        priority: '0.5',
      });
    }
    for (const [slug, r] of latestBySlug) {
      urls.push({
        loc: `${BASE}/sector/${slug}`,
        lastmod: iso(r.created_at),
        changefreq: 'daily',
        priority: '0.7',
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('[sitemap] generation failed:', err.message);
    res.status(503).type('text/plain').send('Sitemap temporarily unavailable.');
  }
});

// ── Email capture ──────────────────────────────────────────────────────────
// No sending pipeline yet — this banks addresses so a launch that works does not
// evaporate. Deliberately tighter rate limiting than /api, and the response is
// identical whether or not the address was already known (no enumeration).
const subscribeLimiter = rateLimit({
  windowMs: 60 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const miniPage = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Vrynn</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
<meta name="robots" content="noindex">
<style>
 :root{--bg:#fcfcfd;--fg:#0f1115;--muted:#5b6070;--line:#e6e7ec}
 @media(prefers-color-scheme:dark){:root{--bg:#0b0c10;--fg:#eef0f4;--muted:#9aa0b0;--line:#23252d}}
 body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
 .w{max-width:560px;margin:0 auto;padding:64px 20px}
 .brand{font-weight:800;font-size:22px;letter-spacing:-.02em;background:linear-gradient(90deg,#00c8e0,#7000e0);
        -webkit-background-clip:text;background-clip:text;color:transparent;text-decoration:none}
 h1{font-size:26px;letter-spacing:-.02em;margin:28px 0 10px}
 p{color:var(--muted);margin:0 0 14px}
 a.back{color:var(--muted);font-size:14px}
</style></head><body><div class="w">
<a class="brand" href="/">Vrynn</a>${body}
<p><a class="back" href="/">← Back to today's brief</a></p>
</div></body></html>`;

app.post('/subscribe', subscribeLimiter, (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  const wantsJson = (req.get('accept') || '').includes('application/json');

  if (!EMAIL_RE.test(email) || email.length > 254) {
    if (wantsJson) return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
    return res.status(400).send(miniPage('Check that address',
      `<h1>That address doesn't look right</h1><p>Have another go — nothing was saved.</p>`));
  }

  try {
    addSubscriber(email, String(req.body?.source ?? 'brief').slice(0, 32));
  } catch (err) {
    console.error('[subscribe] failed:', err.message);
    if (wantsJson) return res.status(503).json({ ok: false, error: 'Could not save that right now.' });
    return res.status(503).send(miniPage('Something went wrong',
      `<h1>Could not save that right now</h1><p>Please try again shortly.</p>`));
  }

  if (wantsJson) return res.json({ ok: true });
  res.send(miniPage('You are on the list',
    `<h1>You're on the list</h1>
     <p>The email edition isn't running yet. You'll hear from us the day it starts — and nothing before then.</p>
     <p>After that, one a day, nothing else, unsubscribe from any of them. In the meantime the brief is on the site every morning.</p>`));
});

app.get('/unsubscribe/:token', (req, res) => {
  const result = unsubscribeByToken(req.params.token);
  if (result === 'unknown') {
    return res.status(404).send(miniPage('Link not recognised',
      `<h1>That link isn't recognised</h1><p>It may already have been used.</p>`));
  }
  res.send(miniPage('Unsubscribed',
    `<h1>Unsubscribed</h1><p>Your address has been removed. No further emails will be sent.</p>`));
});

// ── Sector pages ───────────────────────────────────────────────────────────
// /sector/:slug        → latest read (the URL that targets "why are X tokens down today")
// /sector/:slug/:date  → permanent dated archive, immutable once published
app.get('/sector/:slug', (req, res) => {
  const sector = sectorBySlug(req.params.slug);
  if (!sector) return res.status(404).type('text/plain').send('Unknown sector.');
  const row = getLatestSectorBrief(sector.slug);
  if (!row?.html) return res.status(503).type('text/plain').send('No read published for this sector yet.');
  res.type('html').send(row.html);
});

app.get('/sector/:slug/:date', (req, res) => {
  const sector = sectorBySlug(req.params.slug);
  if (!sector) return res.status(404).type('text/plain').send('Unknown sector.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).type('text/plain').send('Bad date.');

  const row = getSectorBrief(sector.slug, req.params.date);
  if (!row) return res.status(404).type('text/plain').send('No read for this sector on this date.');

  // Stored html carries the latest-canonical; re-render so the dated URL is
  // self-canonical and the two do not compete for the same query.
  try {
    const synthesis = row.synthesis_json ? JSON.parse(row.synthesis_json) : null;
    res.type('html').send(renderSectorPage(sector, JSON.parse(row.aggregate_json), synthesis, {
      dates: getSectorDates(sector.slug, 6), isLatest: false,
    }));
  } catch (err) {
    console.error('[sector] dated render failed:', err.message);
    res.status(503).type('text/plain').send('Sector read temporarily unavailable.');
  }
});

// ── Homepage → today's brief ───────────────────────────────────────────────
app.get('/', async (_req, res) => {
  try {
    const html = await getHomepageHtml();
    res.type('html').send(html);
  } catch (err) {
    console.error('[brief] homepage render failed:', err.message);
    res.status(503).type('text/plain').send('Brief temporarily unavailable.');
  }
});

// ── Brief archive ──────────────────────────────────────────────────────────
app.get('/brief', (_req, res) => {
  const briefs = getAllBriefs();
  res.type('html').send(renderArchive(briefs));
});

// ── Daily brief (server-rendered HTML, no wallet, anonymous) ────────────────
app.get('/brief/today', async (_req, res) => {
  try {
    const html = await getBriefHtml();
    res.type('html').send(html);
  } catch (err) {
    console.error('[brief] render failed:', err.message);
    res.status(503).type('text/plain').send('Brief temporarily unavailable.');
  }
});

app.get('/brief/:date', async (req, res) => {
  try {
    const html = await getBriefHtml(req.params.date);
    if (!html) return res.status(404).type('text/plain').send('No brief for this date.');
    res.type('html').send(html);
  } catch (err) {
    console.error('[brief] render failed:', err.message);
    res.status(503).type('text/plain').send('Brief temporarily unavailable.');
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[api] listening on port ${config.port}`);
  startBriefCron();
});

// Telegram bot and monitor are disabled — dashboard-only mode
// startBot() and startMonitor() intentionally not called
