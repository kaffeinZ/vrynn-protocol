import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import { verifyWalletSignature, SIGN_MESSAGE } from './auth.js';
import {
  upsertUser,
  addWallet,
  getWalletsByUserId,
  removeWallet,
  getLatestPositions,
  savePosition,
  getAlerts,
  getLatestAiAnalysis,
  getWalletSettings,
  upsertWalletSettings,
  createLinkCode,
  getAiUsage,
  incrementAiUsage,
} from '../db.js';

const router = Router();

// ── Auth message ───────────────────────────────────────────────────────────
// GET /api/auth/message  →  returns the message the wallet should sign
router.get('/auth/message', (_req, res) => {
  res.json({ message: SIGN_MESSAGE });
});

// ── Wallet management ──────────────────────────────────────────────────────
// POST /api/wallet  body: { address, signature }
router.post('/wallet', (req, res) => {
  const { address, signature } = req.body ?? {};

  if (!address || !signature) {
    return res.status(400).json({ error: 'address and signature are required' });
  }

  try { new PublicKey(address); } catch {
    return res.status(400).json({ error: 'invalid Solana address' });
  }

  if (!verifyWalletSignature(address, signature)) {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  // Use the wallet address as the user identity (no Telegram required for dashboard auth)
  const user = upsertUser(`wallet:${address}`);
  const wallet = addWallet(user.id, address);

  res.json({ ok: true, user, wallet });
});

// GET /api/wallets/:address  →  list wallets for the user who owns this address
router.get('/wallets/:address', (req, res) => {
  const { address } = req.params;
  const user = getUserByAddress(address);
  if (!user) return res.status(404).json({ error: 'wallet not registered' });
  res.json(getWalletsByUserId(user.id));
});

// DELETE /api/wallet  body: { address, signature }
router.delete('/wallet', (req, res) => {
  const { address, signature } = req.body ?? {};
  if (!address || !signature) return res.status(400).json({ error: 'address and signature are required' });
  if (!verifyWalletSignature(address, signature)) return res.status(401).json({ error: 'signature verification failed' });

  const user = getUserByAddress(address);
  if (!user) return res.status(404).json({ error: 'not found' });

  removeWallet(user.id, address);
  res.json({ ok: true });
});

// ── Positions ──────────────────────────────────────────────────────────────
// GET /api/positions/:walletAddress
// Fetches live data from MarginFi, persists snapshot to DB, returns result.
router.get('/positions/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;

  try { new PublicKey(walletAddress); } catch {
    return res.status(400).json({ error: 'invalid Solana address' });
  }

  try {
    const { getMarginFiPositions } = await import('../protocols/marginfi.js');
    const { getKaminoPositions }   = await import('../protocols/kamino.js');

    const [marginfi, kamino] = await Promise.allSettled([
      getMarginFiPositions(walletAddress),
      getKaminoPositions(walletAddress),
    ]);

    const positions = [
      ...(marginfi.status === 'fulfilled' ? marginfi.value : []),
      ...(kamino.status  === 'fulfilled' ? kamino.value  : []),
    ];

    for (const p of positions) {
      savePosition({
        walletAddress,
        protocol:      p.protocol,
        collateralUsd: p.collateralUsd,
        borrowUsd:     p.borrowUsd,
        healthFactor:  p.healthFactor,
        rawData:       p,
      });
    }

    res.json(positions);
  } catch (err) {
    console.error('[positions]', err.message);
    res.json(getLatestPositions(walletAddress));
  }
});

// ── Portfolio overview ─────────────────────────────────────────────────────
// GET /api/portfolio/:walletAddress
// Aggregates live positions across all protocols into a single risk snapshot.
const POSITION_TYPE_WEIGHT = {
  lst_loop:           0.2,  // SOL/LST both move together — depeg risk only
  stablecoin_loop:    0.15, // interest-rate risk only
  deposit_only:       0.0,  // no debt, no liquidation risk
  volatile_collateral: 1.0,
  volatile_borrow:    1.0,
  mixed:              1.0,
};

function computeRiskScore(positions) {
  const activePositions = positions.filter(p => p.healthFactor !== null);
  if (!activePositions.length) return 0;

  // Score each position individually then take the worst adjusted score
  const scores = activePositions.map(p => {
    const raw    = Math.max(0, Math.min(100, Math.round((3.0 - p.healthFactor) / 2.0 * 100)));
    const weight = POSITION_TYPE_WEIGHT[p.positionType] ?? 1.0;
    return Math.round(raw * weight);
  });

  return Math.max(...scores);
}

router.get('/portfolio/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;

  try { new PublicKey(walletAddress); } catch {
    return res.status(400).json({ error: 'invalid Solana address' });
  }

  let positions;
  try {
    const { getMarginFiPositions } = await import('../protocols/marginfi.js');
    const { getKaminoPositions }   = await import('../protocols/kamino.js');

    const [marginfi, kamino] = await Promise.allSettled([
      getMarginFiPositions(walletAddress),
      getKaminoPositions(walletAddress),
    ]);

    positions = [
      ...(marginfi.status === 'fulfilled' ? marginfi.value : []),
      ...(kamino.status  === 'fulfilled' ? kamino.value  : []),
    ];

    for (const p of positions) {
      savePosition({
        walletAddress,
        protocol:      p.protocol,
        collateralUsd: p.collateralUsd,
        borrowUsd:     p.borrowUsd,
        healthFactor:  p.healthFactor,
        rawData:       p,
      });
    }
  } catch {
    // Fall back to last persisted snapshot
    positions = getLatestPositions(walletAddress).map((row) =>
      JSON.parse(row.raw_data || '{}')
    );
  }

  const totalCollateralUsd = positions.reduce((sum, p) => sum + (p.collateralUsd ?? 0), 0);
  const totalBorrowUsd     = positions.reduce((sum, p) => sum + (p.borrowUsd ?? 0), 0);
  const activeHfs          = positions.map((p) => p.healthFactor).filter((hf) => hf !== null);
  const worstHealthFactor  = activeHfs.length ? Math.min(...activeHfs) : null;
  res.json({
    positions,
    totalCollateralUsd,
    totalBorrowUsd,
    worstHealthFactor,
    riskScore:        computeRiskScore(positions),
    latestAiAnalysis: getLatestAiAnalysis(walletAddress),
    settings:         getWalletSettings(walletAddress),
  });
});

// ── Per-wallet settings ────────────────────────────────────────────────────
// POST /api/settings  body: { address, signature, hfWarning, hfCritical, alertsEnabled }
router.post('/settings', (req, res) => {
  const { address, signature, hfWarning, hfCritical, alertsEnabled } = req.body ?? {};

  if (!address || !signature) {
    return res.status(400).json({ error: 'address and signature are required' });
  }

  try { new PublicKey(address); } catch {
    return res.status(400).json({ error: 'invalid Solana address' });
  }

  if (!verifyWalletSignature(address, signature)) {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  const warn = parseFloat(hfWarning);
  const crit = parseFloat(hfCritical);

  if (isNaN(warn) || warn <= 0 || isNaN(crit) || crit <= 0 || crit >= warn) {
    return res.status(400).json({ error: 'hfWarning must be > hfCritical > 0' });
  }

  upsertWalletSettings(address, {
    hfWarning:     warn,
    hfCritical:    crit,
    alertsEnabled: alertsEnabled !== false,
  });

  res.json({ ok: true, settings: getWalletSettings(address) });
});

// ── Telegram linking ───────────────────────────────────────────────────────
// POST /api/telegram/link  body: { address, signature }
// Returns a short-lived code the user types into the Telegram bot.
router.post('/telegram/link', (req, res) => {
  const { address, signature } = req.body ?? {};

  if (!address || !signature) {
    return res.status(400).json({ error: 'address and signature are required' });
  }

  try { new PublicKey(address); } catch {
    return res.status(400).json({ error: 'invalid Solana address' });
  }

  if (!verifyWalletSignature(address, signature)) {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  const code = createLinkCode(address);
  res.json({ ok: true, code, expiresInSeconds: 600 });
});

// ── Alerts ─────────────────────────────────────────────────────────────────
// GET /api/alerts/:walletAddress?limit=20
router.get('/alerts/:walletAddress', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  res.json(getAlerts(req.params.walletAddress, limit));
});

// ── AI Risk Analysis ────────────────────────────────────────────────────────
// GET /api/risk/:walletAddress  →  latest AI analysis per protocol
router.get('/risk/:walletAddress', (req, res) => {
  res.json(getLatestAiAnalysis(req.params.walletAddress));
});

// POST /api/analyze  body: { address, signature }
// Manual on-demand AI analysis — free tier: 4/day
router.post('/analyze', async (req, res) => {
  const { address, signature } = req.body ?? {};

  if (!address || !signature) {
    return res.status(400).json({ error: 'address and signature are required' });
  }

  try { new PublicKey(address); } catch {
    return res.status(400).json({ error: 'invalid Solana address' });
  }

  if (!verifyWalletSignature(address, signature)) {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  const usage = getAiUsage(address);
  if (usage.remaining <= 0) {
    return res.status(429).json({
      error: 'Daily AI analysis limit reached (4/day on free plan). Resets at midnight UTC.',
      usage,
    });
  }

  try {
    const { getMarginFiPositions } = await import('../protocols/marginfi.js');
    const { getKaminoPositions }   = await import('../protocols/kamino.js');
    const { analyzeRisk }          = await import('../ai.js');
    const { buildPriceTrendContext } = await import('../priceMonitor.js');

    const [marginfi, kamino] = await Promise.allSettled([
      getMarginFiPositions(address),
      getKaminoPositions(address),
    ]);

    const positions = [
      ...(marginfi.status === 'fulfilled' ? marginfi.value : []),
      ...(kamino.status  === 'fulfilled' ? kamino.value  : []),
    ].filter(p => p.healthFactor !== null);

    if (!positions.length) {
      return res.status(400).json({ error: 'No active lending positions found' });
    }

    const priceTrendContext = await buildPriceTrendContext(positions).catch(() => null);
    const result = await analyzeRisk(address, positions, priceTrendContext);

    if (!result) return res.status(500).json({ error: 'AI analysis failed' });

    incrementAiUsage(address);
    const updatedUsage = getAiUsage(address);

    res.json({ ok: true, ...result, usage: updatedUsage });
  } catch (err) {
    console.error('[analyze]', err.message);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ── HF History ─────────────────────────────────────────────────────────────
// GET /api/hf-history/:walletAddress?period=24h|7d
router.get('/hf-history/:walletAddress', (req, res) => {
  const { walletAddress } = req.params;
  const period = req.query.period === '7d' ? 7 * 24 * 3600 : 24 * 3600;

  const rows = db.prepare(`
    SELECT protocol, health_factor, recorded_at
    FROM positions
    WHERE wallet_address = ?
      AND health_factor IS NOT NULL
      AND recorded_at >= unixepoch() - ?
    ORDER BY recorded_at ASC
  `).all(walletAddress, period);

  const byProtocol = {};
  for (const row of rows) {
    if (!byProtocol[row.protocol]) byProtocol[row.protocol] = [];
    byProtocol[row.protocol].push({ t: row.recorded_at, hf: row.health_factor });
  }

  res.json(byProtocol);
});

// ── Admin: manual tweet ────────────────────────────────────────────────────
// POST /api/admin/tweet  body: { secret, text }
router.post('/admin/tweet', async (req, res) => {
  const { secret, text } = req.body ?? {};
  const { config } = await import('../config.js');

  if (!config.adminSecret || secret !== config.adminSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!text?.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.trim().length > 280) {
    return res.status(400).json({ error: `text is ${text.trim().length} chars — max 280` });
  }

  const { postTweet } = await import('../twitter.js');
  const result = await postTweet(text.trim());

  if (!result) return res.status(500).json({ error: 'tweet failed — check server logs' });
  res.json({ ok: true, tweetId: result.id });
});

// ── Helpers ────────────────────────────────────────────────────────────────
import db from '../db.js';
function getUserByAddress(address) {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN wallets w ON w.user_id = u.id
    WHERE w.address = ?
  `).get(address);
}

export default router;
