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
    wallet_address    TEXT    PRIMARY KEY,
    hf_warning        REAL    NOT NULL DEFAULT 1.5,
    hf_critical       REAL    NOT NULL DEFAULT 1.2,
    alerts_enabled    INTEGER NOT NULL DEFAULT 0,
    perp_alert_pct    REAL    NOT NULL DEFAULT 10,
    perp_critical_pct REAL    NOT NULL DEFAULT 5,
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code           TEXT    PRIMARY KEY,
    wallet_address TEXT    NOT NULL,
    expires_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    wallet_address TEXT    PRIMARY KEY,
    calls_today    INTEGER NOT NULL DEFAULT 0,
    reset_date     TEXT    NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS macro_state (
    series_id   TEXT PRIMARY KEY,
    last_period TEXT,
    updated_utc TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_briefs (
    date         TEXT    PRIMARY KEY,
    signals_json TEXT    NOT NULL,
    brief_text   TEXT,
    html         TEXT    NOT NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migrate existing DBs that predate perp_critical_pct column
try {
  db.prepare(`ALTER TABLE wallet_settings ADD COLUMN perp_critical_pct REAL NOT NULL DEFAULT 5`).run();
} catch { /* column already exists */ }

// Migrate daily_briefs for P4 structured synthesis output
try { db.prepare(`ALTER TABLE daily_briefs ADD COLUMN drivers_json TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE daily_briefs ADD COLUMN explained TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE daily_briefs ADD COLUMN headline TEXT`).run(); } catch {}

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

export function getAiAnalysisHistory(walletAddress, limit = 50) {
  return db.prepare(`
    SELECT * FROM ai_analyses
    WHERE wallet_address = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(walletAddress, limit);
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
    ?? { wallet_address: walletAddress, hf_warning: 1.5, hf_critical: 1.2, alerts_enabled: 0, perp_alert_pct: 10, perp_critical_pct: 5 };
}

export function upsertWalletSettings(walletAddress, { hfWarning, hfCritical, perpAlertPct, perpCriticalPct }) {
  db.prepare(`
    INSERT INTO wallet_settings(wallet_address, hf_warning, hf_critical, alerts_enabled, perp_alert_pct, perp_critical_pct)
    VALUES(?, ?, ?, 0, ?, ?)
    ON CONFLICT(wallet_address) DO UPDATE SET
      hf_warning        = excluded.hf_warning,
      hf_critical       = excluded.hf_critical,
      perp_alert_pct    = excluded.perp_alert_pct,
      perp_critical_pct = excluded.perp_critical_pct,
      updated_at        = unixepoch()
  `).run(walletAddress, hfWarning, hfCritical, perpAlertPct ?? 10, perpCriticalPct ?? 5);
}

// ── ai_usage ───────────────────────────────────────────────────────────────
const FREE_AI_LIMIT = 4;

export function getAiUsage(walletAddress) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`SELECT * FROM ai_usage WHERE wallet_address = ?`).get(walletAddress);
  if (!row || row.reset_date !== today) {
    db.prepare(`
      INSERT INTO ai_usage(wallet_address, calls_today, reset_date) VALUES(?, 0, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET calls_today = 0, reset_date = excluded.reset_date
    `).run(walletAddress, today);
    return { calls_today: 0, limit: FREE_AI_LIMIT, remaining: FREE_AI_LIMIT };
  }
  return { calls_today: row.calls_today, limit: FREE_AI_LIMIT, remaining: Math.max(0, FREE_AI_LIMIT - row.calls_today) };
}

export function incrementAiUsage(walletAddress) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO ai_usage(wallet_address, calls_today, reset_date) VALUES(?, 1, ?)
    ON CONFLICT(wallet_address) DO UPDATE SET
      calls_today = CASE WHEN reset_date = excluded.reset_date THEN calls_today + 1 ELSE 1 END,
      reset_date  = excluded.reset_date
  `).run(walletAddress, today);
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

// ── macro_state ────────────────────────────────────────────────────────────
// Tracks the newest period seen per series, so a release is detected by the
// period advancing rather than by guessing at a publication calendar.
export function getMacroPeriod(seriesId) {
  return db.prepare(`SELECT last_period FROM macro_state WHERE series_id = ?`).get(seriesId)?.last_period ?? null;
}

export function setMacroPeriod(seriesId, period, updatedUtc) {
  db.prepare(`
    INSERT INTO macro_state(series_id, last_period, updated_utc) VALUES(?, ?, ?)
    ON CONFLICT(series_id) DO UPDATE SET last_period = excluded.last_period, updated_utc = excluded.updated_utc
  `).run(seriesId, period, updatedUtc);
}

// ── daily_briefs ───────────────────────────────────────────────────────────
export function saveDailyBrief({ date, signals, briefText, html, drivers, explained, headline }) {
  db.prepare(`
    INSERT OR REPLACE INTO daily_briefs(date, signals_json, brief_text, html, drivers_json, explained, headline)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `).run(date, JSON.stringify(signals), briefText ?? null, html,
         drivers ? JSON.stringify(drivers) : null, explained ?? null, headline ?? null);
}

export function getDailyBrief(date) {
  return db.prepare(`SELECT * FROM daily_briefs WHERE date = ?`).get(date) ?? null;
}

export function getAllBriefs() {
  return db.prepare(`SELECT date, brief_text, headline, explained FROM daily_briefs ORDER BY date DESC`).all();
}

/** 30-day honesty track record: how often the data actually accounted for the move.
 *  Rows predating the `explained` column are excluded so the percentage isn't
 *  diluted by days we never graded. */
export function getHonestyStats(days = 30) {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                                        AS total,
      SUM(CASE WHEN explained = 'well-explained'   THEN 1 ELSE 0 END) AS well,
      SUM(CASE WHEN explained = 'partly-explained' THEN 1 ELSE 0 END) AS partly,
      SUM(CASE WHEN explained = 'unexplained'      THEN 1 ELSE 0 END) AS unexplained
    FROM daily_briefs
    WHERE explained IS NOT NULL AND date >= date('now', ?)
  `).get(`-${days} days`);

  if (!row || !row.total) return null;
  return {
    ...row,
    explainedPct: Math.round(((row.well + row.partly) / row.total) * 100),
  };
}

/** Briefs published before `date` — powers the "recent briefs" rail.
 *  Older-only, so a stored page's rail can never go stale. */
export function getRecentBriefs(beforeDate, limit = 5) {
  return db.prepare(`
    SELECT date, headline, brief_text FROM daily_briefs
    WHERE date < ? ORDER BY date DESC LIMIT ?
  `).all(beforeDate, limit);
}

export default db;
