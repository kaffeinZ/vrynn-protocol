import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import routes from './api/routes.js';
import { bot } from './alerts.js';
import { startMonitor } from './monitor.js';

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5173',   // Vite dev server
    'http://localhost:4173',   // Vite preview
    /https?:\/\/localhost/,
  ],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[api] listening on port ${config.port}`);
});

bot.start({ onStart: () => console.log('[telegram] bot polling started') });

startMonitor();
