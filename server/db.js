import Database from 'better-sqlite3';
import { config } from './config.js';

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT    UNIQUE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    address    TEXT    NOT NULL,
    label      TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, address)
  );

  CREATE TABLE IF NOT EXISTS positions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address  TEXT    NOT NULL,
    protocol        TEXT    NOT NULL,
    collateral_usd  REAL,
    borrow_usd      REAL,
    health_factor   REAL,
    raw_data        TEXT,
    recorded_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet_address, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS alerts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT    NOT NULL,
    protocol       TEXT    NOT NULL,
    risk_level     TEXT    NOT NULL,
    health_factor  REAL,
    message        TEXT,
    sent_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_wallet ON alerts(wallet_address, sent_at DESC);

  CREATE TABLE IF NOT EXISTS ai_analyses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT    NOT NULL,
    protocol       TEXT    NOT NULL,
    risk_level     TEXT    NOT NULL,
    analysis       TEXT    NOT NULL,
    health_factor  REAL,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_ai_wallet ON ai_analyses(wallet_address, created_at DESC);

  CREATE TABLE IF NOT EXISTS wallet_settings (
    wallet_address TEXT    PRIMARY KEY,
    hf_warning     REAL    NOT NULL DEFAULT 1.5,
    hf_critical    REAL    NOT NULL DEFAULT 1.2,
    alerts_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code           TEXT    PRIMARY KEY,
    wallet_address TEXT    NOT NULL,
    expires_at     INTEGER NOT NULL
  );
`);

// ── users ──────────────────────────────────────────────────────────────────
export function upsertUser(telegramId) {
  return db
    .prepare(`INSERT INTO users(telegram_id) VALUES(?) ON CONFLICT(telegram_id) DO UPDATE SET telegram_id=telegram_id RETURNING *`)
    .get(telegramId);
}

export function getUserByTelegramId(telegramId) {
  return db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
}

// ── wallets ────────────────────────────────────────────────────────────────
export function addWallet(userId, address, label = null) {
  return db
    .prepare(`INSERT OR IGNORE INTO wallets(user_id, address, label) VALUES(?, ?, ?) RETURNING *`)
    .get(userId, address, label);
}

export function getWalletsByUserId(userId) {
  return db.prepare(`SELECT * FROM wallets WHERE user_id = ?`).all(userId);
}

export function getAllTrackedWallets() {
  return db.prepare(`SELECT DISTINCT address FROM wallets`).all();
}

export function removeWallet(userId, address) {
  return db.prepare(`DELETE FROM wallets WHERE user_id = ? AND address = ?`).run(userId, address);
}

// ── positions ──────────────────────────────────────────────────────────────
export function savePosition({ walletAddress, protocol, collateralUsd, borrowUsd, healthFactor, rawData }) {
  db.prepare(`
    INSERT INTO positions(wallet_address, protocol, collateral_usd, borrow_usd, health_factor, raw_data)
    VALUES(?, ?, ?, ?, ?, ?)
  `).run(walletAddress, protocol, collateralUsd, borrowUsd, healthFactor, JSON.stringify(rawData));
}

export function getLatestPositions(walletAddress) {
  return db.prepare(`
    SELECT p.* FROM positions p
    INNER JOIN (
      SELECT protocol, MAX(recorded_at) AS latest
      FROM positions WHERE wallet_address = ?
      GROUP BY protocol
    ) g ON p.protocol = g.protocol AND p.recorded_at = g.latest AND p.wallet_address = ?
  `).all(walletAddress, walletAddress);
}

// ── alerts ─────────────────────────────────────────────────────────────────
export function saveAlert({ walletAddress, protocol, riskLevel, healthFactor, message }) {
  db.prepare(`
    INSERT INTO alerts(wallet_address, protocol, risk_level, health_factor, message)
    VALUES(?, ?, ?, ?, ?)
  `).run(walletAddress, protocol, riskLevel, healthFactor, message);
}

export function getAlerts(walletAddress, limit = 20) {
  return db.prepare(`SELECT * FROM alerts WHERE wallet_address = ? ORDER BY sent_at DESC LIMIT ?`).all(walletAddress, limit);
}

export function getLastAlertTime(walletAddress, protocol) {
  const row = db.prepare(`SELECT sent_at FROM alerts WHERE wallet_address = ? AND protocol = ? ORDER BY sent_at DESC LIMIT 1`).get(walletAddress, protocol);
  return row ? row.sent_at * 1000 : 0;
}

export function getLastAlert(walletAddress, protocol) {
  return db.prepare(`
    SELECT risk_level, health_factor, sent_at FROM alerts
    WHERE wallet_address = ? AND protocol = ?
    ORDER BY sent_at DESC LIMIT 1
  `).get(walletAddress, protocol) ?? null;
}

// ── ai_analyses ────────────────────────────────────────────────────────────
export function saveAiAnalysis({ walletAddress, protocol, riskLevel, analysis, healthFactor }) {
  db.prepare(`
    INSERT INTO ai_analyses(wallet_address, protocol, risk_level, analysis, health_factor)
    VALUES(?, ?, ?, ?, ?)
  `).run(walletAddress, protocol, riskLevel, analysis, healthFactor);
}

export function getLatestAiAnalysis(walletAddress) {
  return db.prepare(`
    SELECT a.* FROM ai_analyses a
    INNER JOIN (
      SELECT protocol, MAX(created_at) AS latest
      FROM ai_analyses WHERE wallet_address = ?
      GROUP BY protocol
    ) g ON a.protocol = g.protocol AND a.created_at = g.latest AND a.wallet_address = ?
  `).all(walletAddress, walletAddress);
}

export function getLastAnalysisHealthFactor(walletAddress, protocol) {
  const row = db.prepare(`
    SELECT health_factor FROM ai_analyses
    WHERE wallet_address = ? AND protocol = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(walletAddress, protocol);
  return row ? row.health_factor : null;
}

// ── wallet_settings ────────────────────────────────────────────────────────
export function getWalletSettings(walletAddress) {
  return db.prepare(`SELECT * FROM wallet_settings WHERE wallet_address = ?`).get(walletAddress)
    ?? { wallet_address: walletAddress, hf_warning: 1.5, hf_critical: 1.2, alerts_enabled: 1 };
}

export function upsertWalletSettings(walletAddress, { hfWarning, hfCritical, alertsEnabled }) {
  db.prepare(`
    INSERT INTO wallet_settings(wallet_address, hf_warning, hf_critical, alerts_enabled)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(wallet_address) DO UPDATE SET
      hf_warning     = excluded.hf_warning,
      hf_critical    = excluded.hf_critical,
      alerts_enabled = excluded.alerts_enabled,
      updated_at     = unixepoch()
  `).run(walletAddress, hfWarning, hfCritical, alertsEnabled ? 1 : 0);
}

// ── telegram_link_codes ────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function createLinkCode(walletAddress) {
  db.prepare(`DELETE FROM telegram_link_codes WHERE expires_at < unixepoch()`).run();

  const code = Array.from({ length: 6 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join('');

  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 min TTL
  db.prepare(`
    INSERT OR REPLACE INTO telegram_link_codes(code, wallet_address, expires_at)
    VALUES(?, ?, ?)
  `).run(code, walletAddress, expiresAt);

  return code;
}

export function claimLinkCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const row = db.prepare(`
    SELECT wallet_address FROM telegram_link_codes
    WHERE code = ? AND expires_at > unixepoch()
  `).get(code);

  if (!row) return null;

  db.prepare(`DELETE FROM telegram_link_codes WHERE code = ?`).run(code);
  return row.wallet_address;
}

export default db;
