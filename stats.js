#!/usr/bin/env node
/**
 * Usage: node stats.js
 * Run from the repo root to get a full usage snapshot.
 */

import db from './server/db.js';

const now   = Math.floor(Date.now() / 1000);
const day   = 86400;
const week  = 7 * day;

// ── Helpers ───────────────────────────────────────────────────────────────

function pct(n, total) {
  if (!total) return '';
  return ` (${Math.round(n / total * 100)}%)`;
}

function hline(char = '─', len = 52) {
  return char.repeat(len);
}

function row(label, value) {
  const pad = 32;
  console.log(`  ${label.padEnd(pad)}${value}`);
}

// ── Queries ───────────────────────────────────────────────────────────────

const totalWallets      = db.prepare('SELECT COUNT(*) as n FROM wallets').get().n;
const walletsToday      = db.prepare('SELECT COUNT(*) as n FROM wallets WHERE created_at >= ?').get(now - day).n;
const walletsThisWeek   = db.prepare('SELECT COUNT(*) as n FROM wallets WHERE created_at >= ?').get(now - week).n;

const totalPositionRows = db.prepare('SELECT COUNT(*) as n FROM positions').get().n;
const activeWallets     = db.prepare(`
  SELECT COUNT(DISTINCT wallet_address) as n FROM positions WHERE recorded_at >= ?
`).get(now - day).n;

const totalAlerts       = db.prepare('SELECT COUNT(*) as n FROM alerts').get().n;
const alertsToday       = db.prepare('SELECT COUNT(*) as n FROM alerts WHERE sent_at >= ?').get(now - day).n;
const alertsByRisk      = db.prepare(`
  SELECT risk_level, COUNT(*) as n FROM alerts GROUP BY risk_level ORDER BY n DESC
`).all();

const totalAiCalls      = db.prepare('SELECT COALESCE(SUM(calls_today),0) as n FROM ai_usage').get().n;
const aiWallets         = db.prepare('SELECT COUNT(*) as n FROM ai_usage WHERE calls_today > 0').get().n;

const totalAnalyses     = db.prepare('SELECT COUNT(*) as n FROM ai_analyses').get().n;

const telegramLinked    = db.prepare(`
  SELECT COUNT(DISTINCT wallet_address) as n FROM wallet_settings
`).get().n;

const recentWallets     = db.prepare(`
  SELECT address, datetime(created_at, 'unixepoch') as joined
  FROM wallets ORDER BY created_at DESC LIMIT 10
`).all();

const riskSnapshot      = db.prepare(`
  SELECT p.wallet_address, p.protocol, p.health_factor,
         datetime(p.recorded_at, 'unixepoch') as at
  FROM positions p
  INNER JOIN (
    SELECT wallet_address, protocol, MAX(recorded_at) as latest
    FROM positions GROUP BY wallet_address, protocol
  ) latest ON p.wallet_address = latest.wallet_address
          AND p.protocol = latest.protocol
          AND p.recorded_at = latest.latest
  WHERE p.health_factor IS NOT NULL
  ORDER BY p.health_factor ASC
  LIMIT 20
`).all();

const alertLeaderboard  = db.prepare(`
  SELECT wallet_address, COUNT(*) as n
  FROM alerts GROUP BY wallet_address ORDER BY n DESC LIMIT 5
`).all();

// ── Output ────────────────────────────────────────────────────────────────

console.log('\n' + hline('═'));
console.log('  Vrynn — Usage Stats  ' + new Date().toUTCString());
console.log(hline('═'));

console.log('\n  WALLETS');
console.log(hline());
row('Total registered',      totalWallets);
row('Joined today',          `${walletsToday}${pct(walletsToday, totalWallets)}`);
row('Joined this week',      `${walletsThisWeek}${pct(walletsThisWeek, totalWallets)}`);
row('Active today (scanned)',`${activeWallets}${pct(activeWallets, totalWallets)}`);

console.log('\n  POSITIONS');
console.log(hline());
row('Total snapshots stored', totalPositionRows);
if (riskSnapshot.length) {
  console.log('\n  Live health factors (worst first):');
  for (const r of riskSnapshot) {
    const hf   = r.health_factor?.toFixed(3) ?? 'N/A';
    const addr = r.wallet_address.slice(0, 6) + '…' + r.wallet_address.slice(-4);
    console.log(`    ${addr}  ${r.protocol.padEnd(10)}  HF ${hf}  ${r.at}`);
  }
} else {
  console.log('  No active positions tracked yet.');
}

console.log('\n  ALERTS');
console.log(hline());
row('Total alerts sent',  totalAlerts);
row('Alerts today',       alertsToday);
if (alertsByRisk.length) {
  console.log('\n  By risk level:');
  alertsByRisk.forEach(r => console.log(`    ${r.risk_level.padEnd(10)}  ${r.n}`));
}
if (alertLeaderboard.length) {
  console.log('\n  Most alerted wallets:');
  alertLeaderboard.forEach(r => {
    const addr = r.wallet_address.slice(0, 6) + '…' + r.wallet_address.slice(-4);
    console.log(`    ${addr}  ${r.n} alerts`);
  });
}

console.log('\n  AI ANALYSIS');
console.log(hline());
row('Total analyses stored',  totalAnalyses);
row('Wallets with usage today', aiWallets);

console.log('\n  INTEGRATIONS');
console.log(hline());
row('Wallets with settings saved', telegramLinked);

console.log('\n  RECENT SIGNUPS (last 10)');
console.log(hline());
if (recentWallets.length) {
  recentWallets.forEach(w => {
    const addr = w.address.slice(0, 6) + '…' + w.address.slice(-4);
    console.log(`    ${addr}  ${w.joined}`);
  });
} else {
  console.log('  No wallets registered yet.');
}

console.log('\n' + hline('═') + '\n');
