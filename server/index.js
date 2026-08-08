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
import { getAllBriefs, getSitemapEntries } from './db.js';

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
