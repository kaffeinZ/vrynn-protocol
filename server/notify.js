import { config } from './config.js';

/**
 * Loud failure channel for the cron.
 *
 * A silently skipped sector is a stale page you eventually notice. A plausible
 * wrong number is a credibility hit you never notice — so anything the guard
 * rejects must surface somewhere a human looks.
 *
 * Set TELEGRAM_ADMIN_CHAT_ID to route these to Telegram. Until then they go to
 * the pm2 error log, which is checkable but not push. Deliberately not silent
 * either way.
 */
export async function notifyAdmin(subject, detail = '') {
  const line = `[vrynn] ${subject}${detail ? `\n${detail}` : ''}`;
  console.error(line);

  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId || !config.telegramBotToken) return;

  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: line, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error('[notify] telegram send failed:', err.message);
  }
}
