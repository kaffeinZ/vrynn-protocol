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
    const positions = await getMarginFiPositions(walletAddress);

    // Persist snapshot so monitor loop & alert history work offline too
    for (const p of positions) {
      savePosition({
        walletAddress,
        protocol: p.protocol,
        collateralUsd: p.collateralUsd,
        borrowUsd: p.borrowUsd,
        healthFactor: p.healthFactor,
        rawData: p,
      });
    }

    res.json(positions);
  } catch (err) {
    console.error('[positions]', err.message);
    // Fall back to cached DB snapshot on RPC errors
    res.json(getLatestPositions(walletAddress));
  }
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
