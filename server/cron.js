import cron from 'node-cron';
import { getBriefHtml, getHomepageHtml } from './brief.js';
import { getDailyBrief } from './db.js';
import { runSectorBriefs } from './sectorRun.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function generateFor(label) {
  const date = todayUtc();
  try {
    // Order matters. The brief must exist first (sectors reuse its market_state),
    // and the homepage must be warmed LAST because it embeds the sector band —
    // warming it before the sector run bakes in yesterday's sector data for the
    // rest of the day, which is exactly what happened on 2026-08-10.
    await getBriefHtml();      // creates and persists today's row

    try { await runSectorBriefs(date); }
    catch (err) { console.error(`[cron] ${label}: sector run failed:`, err.message); }

    await getHomepageHtml();   // warm only once the sector band is current
    console.log(`[cron] ${label}: brief + sectors + homepage ready for ${date}`);
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
