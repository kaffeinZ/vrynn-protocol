/**
 * Monitor loop — polls all tracked wallets every 60s, evaluates health
 * factors, persists snapshots, fires Telegram alerts, and triggers AI
 * analysis when health factor changes significantly.
 */

import cron from 'node-cron';
import { config } from './config.js';
import {
  getAllTrackedWallets,
  savePosition,
  getLastAnalysisHealthFactor,
} from './db.js';
import { getMarginFiPositions } from './protocols/marginfi.js';
import { getKaminoPositions } from './protocols/kamino.js';
import { sendAlert } from './alerts.js';
import { analyzeRisk } from './ai.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function riskTier(hf) {
  if (hf === null) return 0;   // no debt
  if (hf >= 2.0)   return 1;   // SAFE
  if (hf >= 1.5)   return 2;   // WARNING
  if (hf >= 1.2)   return 3;   // HIGH
  return 4;                     // CRITICAL
}

/**
 * Returns true when the health factor has moved enough to warrant a fresh
 * AI analysis: tier boundary crossed OR absolute shift > 0.1.
 */
function significantChange(currentHf, lastHf) {
  if (lastHf === null) return true; // first time — always analyse
  if (currentHf === null) return false;
  if (riskTier(currentHf) !== riskTier(lastHf)) return true;
  return Math.abs(currentHf - lastHf) > 0.1;
}

function shouldAlert(riskLevel) {
  return riskLevel === 'CRITICAL' || riskLevel === 'HIGH';
}

function buildAlertMessage(position, aiAnalysis) {
  const hf         = position.healthFactor?.toFixed(3) ?? 'N/A';
  const collateral = position.collateralUsd?.toFixed(2) ?? '0';
  const borrow     = position.borrowUsd?.toFixed(2) ?? '0';

  // Prefer the AI's natural-language analysis when available
  if (aiAnalysis?.analysis) return aiAnalysis.analysis;

  if (position.riskLevel === 'CRITICAL') {
    return (
      `Your ${position.protocol} position is at CRITICAL risk of liquidation. ` +
      `Health Factor: ${hf}. Collateral: $${collateral} / Borrow: $${borrow}. ` +
      `${position.riskContext} Take action immediately.`
    );
  }
  return (
    `Your ${position.protocol} position health is LOW. ` +
    `Health Factor: ${hf}. Collateral: $${collateral} / Borrow: $${borrow}. ` +
    `${position.riskContext} Consider adding collateral or reducing your borrow.`
  );
}

// ── Per-wallet scan ───────────────────────────────────────────────────────

async function scanWallet(address) {
  const [marginfiPositions, kaminoPositions] = await Promise.allSettled([
    getMarginFiPositions(address),
    getKaminoPositions(address),
  ]);

  const positions = [
    ...(marginfiPositions.status === 'fulfilled' ? marginfiPositions.value : []),
    ...(kaminoPositions.status  === 'fulfilled' ? kaminoPositions.value  : []),
  ];

  if (marginfiPositions.status === 'rejected') {
    console.error(`[monitor] marginfi failed for ${address.slice(0, 8)}…: ${marginfiPositions.reason?.message}`);
  }
  if (kaminoPositions.status === 'rejected') {
    console.error(`[monitor] kamino failed for ${address.slice(0, 8)}…: ${kaminoPositions.reason?.message}`);
  }

  if (!positions.length) return;

  // Collect positions that have debt (health factor is not null)
  const activePositions = positions.filter((p) => p.healthFactor !== null);

  for (const pos of positions) {
    savePosition({
      walletAddress: address,
      protocol:      pos.protocol,
      collateralUsd: pos.collateralUsd,
      borrowUsd:     pos.borrowUsd,
      healthFactor:  pos.healthFactor,
      rawData:       pos,
    });
  }

  if (!activePositions.length) return;

  // AI analysis — only when health factor has shifted meaningfully
  let aiResult = null;
  const needsAi = activePositions.some((pos) => {
    const lastHf = getLastAnalysisHealthFactor(address, pos.protocol);
    return significantChange(pos.healthFactor, lastHf);
  });

  if (needsAi) {
    aiResult = await analyzeRisk(address, activePositions);
  }

  // Telegram alerts for HIGH / CRITICAL positions
  for (const pos of activePositions) {
    if (shouldAlert(pos.riskLevel)) {
      const message = buildAlertMessage(pos, aiResult);
      await sendAlert({
        walletAddress: address,
        protocol:      pos.protocol,
        riskLevel:     pos.riskLevel,
        healthFactor:  pos.healthFactor,
        message,
      });
      console.log(`[monitor] alert for ${address.slice(0, 8)}… HF=${pos.healthFactor?.toFixed(3)} (${pos.riskLevel})`);
    }
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────

let _running = false;

export function startMonitor() {
  const intervalSecs = config.monitorIntervalSeconds;
  console.log(`[monitor] starting — polling every ${intervalSecs}s`);

  cron.schedule(`*/${intervalSecs} * * * * *`, async () => {
    if (_running) {
      console.log('[monitor] previous tick still running, skipping');
      return;
    }
    _running = true;

    const wallets = getAllTrackedWallets();
    if (!wallets.length) {
      _running = false;
      return;
    }

    console.log(`[monitor] scanning ${wallets.length} wallet(s)`);
    for (const { address } of wallets) {
      await scanWallet(address);
    }

    _running = false;
  });
}
