import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import routes from './api/routes.js';
import { bot } from './alerts.js';
import { startMonitor } from './monitor.js';
import rateLimit from 'express-rate-limit';
import { getBriefHtml } from './brief.js';

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
});

// Telegram bot and monitor are disabled — dashboard-only mode
// startBot() and startMonitor() intentionally not called
