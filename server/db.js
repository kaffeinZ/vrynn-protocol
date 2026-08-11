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

  -- UK data protection: an unsubscribe token exists from the first row, not
  -- retrofitted later, and the page states what the address is used for.
  CREATE TABLE IF NOT EXISTS subscribers (
    email             TEXT PRIMARY KEY,
    unsubscribe_token TEXT NOT NULL UNIQUE,
    source            TEXT,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    unsubscribed_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS sector_briefs (
    date           TEXT NOT NULL,
    sector_slug    TEXT NOT NULL,
    aggregate_json TEXT NOT NULL,
    synthesis_json TEXT,
    html           TEXT,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (date, sector_slug)
  );

  CREATE INDEX IF NOT EXISTS idx_sector_slug ON sector_briefs(sector_slug, date DESC);

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

// ── subscribers ────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto';

/** Idempotent. Re-subscribing after an unsubscribe clears the flag and keeps the
 *  original token, so an old unsubscribe link never silently stops working. */
export function addSubscriber(email, source = 'brief') {
  const normalized = String(email).trim().toLowerCase();
  const existing = db.prepare(`SELECT * FROM subscribers WHERE email = ?`).get(normalized);

  if (existing) {
    if (existing.unsubscribed_at) {
      db.prepare(`UPDATE subscribers SET unsubscribed_at = NULL WHERE email = ?`).run(normalized);
    }
    return { email: normalized, token: existing.unsubscribe_token, alreadyKnown: true };
  }

  const token = randomUUID();
  db.prepare(`INSERT INTO subscribers(email, unsubscribe_token, source) VALUES(?, ?, ?)`)
    .run(normalized, token, source);
  return { email: normalized, token, alreadyKnown: false };
}

export function unsubscribeByToken(token) {
  const info = db.prepare(`
    UPDATE subscribers SET unsubscribed_at = unixepoch()
    WHERE unsubscribe_token = ? AND unsubscribed_at IS NULL
  `).run(token);
  if (info.changes) return 'removed';
  const row = db.prepare(`SELECT 1 FROM subscribers WHERE unsubscribe_token = ?`).get(token);
  return row ? 'already-removed' : 'unknown';
}

export function getSubscriberStats() {
  return db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS active
    FROM subscribers
  `).get();
}

// ── sector_briefs ──────────────────────────────────────────────────────────
export function saveSectorBrief({ date, slug, aggregate, synthesis, html }) {
  db.prepare(`
    INSERT OR REPLACE INTO sector_briefs(date, sector_slug, aggregate_json, synthesis_json, html)
    VALUES(?, ?, ?, ?, ?)
  `).run(date, slug, JSON.stringify(aggregate), synthesis ? JSON.stringify(synthesis) : null, html ?? null);
}

export function getSectorBrief(slug, date) {
  return db.prepare(`SELECT * FROM sector_briefs WHERE sector_slug = ? AND date = ?`).get(slug, date) ?? null;
}

/** Most recent published read for a sector — powers /sector/:slug. */
export function getLatestSectorBrief(slug) {
  return db.prepare(`
    SELECT * FROM sector_briefs WHERE sector_slug = ? ORDER BY date DESC LIMIT 1
  `).get(slug) ?? null;
}

export function getSectorDates(slug, limit = 30) {
  return db.prepare(`
    SELECT date, created_at FROM sector_briefs WHERE sector_slug = ? ORDER BY date DESC LIMIT ?
  `).all(slug, limit);
}

/** Sector moves as they stood on a given date — for the at-a-glance band.
 *  Date-scoped on purpose: a dated brief showing today's sector moves would
 *  contradict its own frozen tiles. Falls back to the most recent reads on or
 *  before the date, so a day where a sector was guard-skipped still shows. */
export function getSectorMovesForDate(date) {
  return db.prepare(`
    SELECT s.sector_slug, s.date, s.aggregate_json
    FROM sector_briefs s
    INNER JOIN (
      SELECT sector_slug, MAX(date) AS d FROM sector_briefs
      WHERE date <= ? GROUP BY sector_slug
    ) g ON s.sector_slug = g.sector_slug AND s.date = g.d
  `).all(date).map(r => {
    let change = null, label = null, fetched = null;
    try {
      const a = JSON.parse(r.aggregate_json);
      change  = a?.sector?.market_cap_change_24h ?? null;
      label   = a?.sector?.label ?? null;
      fetched = a?.sector?.fetched_utc ?? a?.as_of_utc ?? null;
    } catch { /* unreadable row — the tile degrades to a plain link */ }
    return { slug: r.sector_slug, label, change, date: r.date, fetched };
  });
}

/** Latest row per sector — for the homepage sector grid. */
export function getLatestSectorAll() {
  return db.prepare(`
    SELECT s.* FROM sector_briefs s
    INNER JOIN (SELECT sector_slug, MAX(date) AS d FROM sector_briefs GROUP BY sector_slug) g
      ON s.sector_slug = g.sector_slug AND s.date = g.d
  `).all();
}

/** Every rendered sector page, for the sitemap. */
export function getSectorSitemapEntries() {
  return db.prepare(`
    SELECT sector_slug, date, created_at FROM sector_briefs
    WHERE html IS NOT NULL AND length(html) > 0
    ORDER BY date DESC
  `).all();
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

/** The most recent brief strictly before `date` — served while today's is unpublished. */
export function getPreviousBrief(date) {
  return db.prepare(`SELECT * FROM daily_briefs WHERE date < ? ORDER BY date DESC LIMIT 1`).get(date) ?? null;
}

export function getDailyBrief(date) {
  return db.prepare(`SELECT * FROM daily_briefs WHERE date = ?`).get(date) ?? null;
}

export function getAllBriefs() {
  return db.prepare(`SELECT date, brief_text, headline, explained FROM daily_briefs ORDER BY date DESC`).all();
}

/** Trailing history for the tile sparklines — real stored values, oldest first.
 *  Returns whatever exists; the component hides itself below two points. */
export function getSparkSeries(uptoDate, days = 8) {
  const rows = db.prepare(`
    SELECT signals_json FROM daily_briefs
    WHERE date <= ? ORDER BY date DESC LIMIT ?
  `).all(uptoDate, days).reverse();

  const out = { mcap: [], btc: [], eth: [], sol: [], fg: [], dom: [] };
  for (const r of rows) {
    let s; try { s = JSON.parse(r.signals_json); } catch { continue; }
    if (!s?.market || !s?.assets) continue;
    if (s.market.total_market_cap_usd != null) out.mcap.push(Math.round(s.market.total_market_cap_usd / 1e9));
    if (s.assets.BTC?.price_usd != null) out.btc.push(Math.round(s.assets.BTC.price_usd));
    if (s.assets.ETH?.price_usd != null) out.eth.push(Math.round(s.assets.ETH.price_usd));
    if (s.assets.SOL?.price_usd != null) out.sol.push(+Number(s.assets.SOL.price_usd).toFixed(2));
    if (s.sentiment?.fear_greed_value != null) out.fg.push(s.sentiment.fear_greed_value);
    if (s.market.btc_dominance_pct != null) out.dom.push(+Number(s.market.btc_dominance_pct).toFixed(2));
  }
  return out;
}

/** Rows that actually produced a page, for the sitemap.
 *  A sitemap listing URLs that 404 is read as a site-wide quality signal, so the
 *  html guard is the filter — not merely "a row exists".
 *  `created_at` is the real generation time and becomes an honest `lastmod`:
 *  a published brief never changes, so its lastmod must never move. */
export function getSitemapEntries() {
  return db.prepare(`
    SELECT date, created_at
    FROM daily_briefs
    WHERE html IS NOT NULL AND length(html) > 0
    ORDER BY date DESC
  `).all();
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
