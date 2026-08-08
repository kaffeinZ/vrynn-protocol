import cron from 'node-cron';
import { getBriefHtml, getHomepageHtml } from './brief.js';
import { getDailyBrief } from './db.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function generateFor(label) {
  const date = todayUtc();
  try {
    await getBriefHtml();      // creates and persists today's row via the existing path
    await getHomepageHtml();   // warm the homepage variant so no visitor pays for it
    console.log(`[cron] ${label}: brief + homepage ready for ${date}`);
  } catch (err) {
    console.error(`[cron] ${label}: generation failed for ${date}:`, err.message);
  }
}

export function startBriefCron() {
  // pm2 runs this app in fork mode, so there is a single instance. If it is ever
  // switched to cluster mode, only instance 0 should schedule the job.
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    console.log('[cron] not instance 0 — skipping scheduler');
    return;
  }

  // 06:00 UTC: pre-generate so the first visitor (often a crawler) gets cached
  // HTML instead of waiting ~14s for a live model call.
  cron.schedule('0 6 * * *', () => generateFor('06:00 UTC'), { timezone: 'UTC' });
  console.log('[cron] brief scheduler armed for 06:00 UTC');

  // Catch-up: a restart after 06:00 on a day with no row would otherwise leave a
  // permanent hole in the archive.
  const date = todayUtc();
  if (!getDailyBrief(date) && new Date().getUTCHours() >= 6) {
    console.log(`[cron] no brief for ${date} and past 06:00 — catching up`);
    generateFor('boot catch-up');
  }
}
