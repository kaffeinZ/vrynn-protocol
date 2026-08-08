import { buildAllSectorStates } from './sectors.js';
import { renderSectorPage } from './sectorPage.js';
import { synthesize } from './brief.js';
import { saveSectorBrief, getSectorDates, getDailyBrief } from './db.js';
import { notifyAdmin } from './notify.js';

/**
 * Generate today's sector reads. Runs after the daily brief so it can reuse that
 * day's market_state — same macro block, same completed-vs-scheduled discipline,
 * one shared source of truth rather than a second divergent fetch.
 */
export async function runSectorBriefs(date = new Date().toISOString().slice(0, 10)) {
  const row = getDailyBrief(date);
  if (!row) {
    await notifyAdmin('sector run aborted', `no daily brief stored for ${date}; sectors reuse its market_state`);
    return { generated: 0, skipped: 0 };
  }

  let marketState;
  try { marketState = JSON.parse(row.signals_json); }
  catch { await notifyAdmin('sector run aborted', `unparseable signals_json for ${date}`); return { generated: 0, skipped: 0 }; }

  const { built, skipped } = await buildAllSectorStates(marketState);
  let generated = 0;
  const failed = [];

  for (const { sector, state } of built) {
    try {
      const synthesis = await synthesize(state, { mode: 'sector' });
      const dates = getSectorDates(sector.slug, 6);
      const html  = renderSectorPage(sector, state, synthesis, { dates, isLatest: true });
      saveSectorBrief({ date, slug: sector.slug, aggregate: state, synthesis, html });
      generated++;
    } catch (err) {
      failed.push(`${sector.slug}: ${err.message}`);
    }
  }

  if (failed.length) await notifyAdmin(`sector synthesis failed for ${failed.length}`, failed.join('\n'));
  console.log(`[sectors] ${date}: generated ${generated}, guard-skipped ${skipped.length}, failed ${failed.length}`);
  return { generated, skipped: skipped.length, failed: failed.length };
}
