/**
 * CheetahFi — X (Twitter) posting module.
 *
 * Three posting modes:
 *   postTweet(text)      — post any text (used by admin endpoint + daily cron)
 *   postDailySummary()   — scheduled once/day with wallet + alert stats
 */

import { TwitterApi } from 'twitter-api-v2';
import { config } from './config.js';
import db from './db.js';

// ── Client ────────────────────────────────────────────────────────────────

function getClient() {
  if (!config.xApiKey || !config.xApiSecret || !config.xAccessToken || !config.xAccessTokenSecret) {
    return null;
  }
  return new TwitterApi({
    appKey:       config.xApiKey,
    appSecret:    config.xApiSecret,
    accessToken:  config.xAccessToken,
    accessSecret: config.xAccessTokenSecret,
  });
}

// ── Core ──────────────────────────────────────────────────────────────────

/**
 * Post a tweet. Returns the tweet data object or null on failure.
 */
export async function postTweet(text) {
  const client = getClient();
  if (!client) {
    console.log('[twitter] X API keys not configured — skipping tweet');
    return null;
  }

  try {
    const { data } = await client.v2.tweet(text);
    console.log(`[twitter] posted tweet ${data.id}`);
    return data;
  } catch (err) {
    console.error('[twitter] failed to post tweet:', err.message);
    return null;
  }
}

// ── Daily summary ─────────────────────────────────────────────────────────

export async function postDailySummary() {
  const walletCount = db
    .prepare(`SELECT COUNT(DISTINCT address) AS n FROM wallets`)
    .get()?.n ?? 0;

  // Don't post until there are real users
  if (walletCount === 0) {
    console.log('[twitter] daily summary skipped — no wallets monitored yet');
    return null;
  }

  const alertsToday = db
    .prepare(`SELECT COUNT(*) AS n FROM alerts WHERE sent_at > unixepoch() - 86400`)
    .get()?.n ?? 0;

  const criticalToday = db
    .prepare(`SELECT COUNT(*) AS n FROM alerts WHERE sent_at > unixepoch() - 86400 AND risk_level = 'CRITICAL'`)
    .get()?.n ?? 0;

  const lines = [
    `📊 CheetahFi Daily Update`,
    ``,
    `• ${walletCount} wallet${walletCount !== 1 ? 's' : ''} monitored`,
    `• ${alertsToday} alert${alertsToday !== 1 ? 's' : ''} fired today${criticalToday > 0 ? ` (${criticalToday} critical 🚨)` : ''}`,
    `• Protocols: MarginFi, Kamino`,
    ``,
    `Early beta — stay informed on your Solana positions 🐆`,
  ];

  return postTweet(lines.join('\n'));
}