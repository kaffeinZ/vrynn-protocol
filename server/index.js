import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import routes from './api/routes.js';
import { bot } from './alerts.js';
import { startMonitor } from './monitor.js';
import rateLimit from 'express-rate-limit';

const app = express();

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

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[api] listening on port ${config.port}`);
});

bot.start({ onStart: () => console.log('[telegram] bot polling started') });

startMonitor();
