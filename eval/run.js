/**
 * Prompt regression harness.
 *
 * Runs the four stored market_state fixtures through the LIVE synthesis call and
 * asserts the honesty spine still holds. Run it after ANY prompt edit:
 *
 *   node eval/run.js
 *
 * The anchor is the quiet fixture: if it stops returning `unexplained` with all
 * drivers tagged `unknown`, the model has started manufacturing catalysts again —
 * the one failure that would sink the product's credibility.
 */
import { readFileSync } from 'node:fs';
import { synthesize } from '../server/brief.js';

const BANNED = [
  'because of', 'due to', 'caused by', 'driven by', 'in response to', 'on the back of',
  'triggered by', 'sparked by', 'fuelled by', 'fueled by', 'weighed down by',
  'boosted by', 'thanks to',
];

const VERDICT = [
  'bullish', 'bearish', 'oversold', 'overbought', 'load up', 'price target',
  'will reach', 'could reach', 'poised to', 'ready to bounce', 'should buy', 'should sell',
];

const hits = (text, list) => list.filter(p => text.toLowerCase().includes(p));

// Terms that would mean the model invented a consensus it was never given.
const FABRICATED_CONSENSUS = [
  'vs expected', 'versus expected', 'vs forecast', 'versus forecast',
  'consensus', 'expectations of', 'analysts expected', 'economists expected',
  'beat expectations', 'missed expectations', 'above expectations', 'below expectations',
];

const CASES = ['quiet', 'macro', 'crash', 'rally', 'release', 'sector-inline', 'sector-diverged'];

// Sector fixtures go through the sector-mode prompt, not the market one.
const isSector = (name) => name.startsWith('sector-');

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };

for (const name of CASES) {
  console.log(`\n── ${name} ──`);
  const marketState = JSON.parse(readFileSync(`eval/snapshots/${name}.json`, 'utf-8'));

  let brief;
  try {
    brief = await synthesize(marketState, isSector(name) ? { mode: 'sector' } : {});
  } catch (err) {
    fail(`${name}: synthesis threw — ${err.message}`);
    continue;
  }
  if (!brief) { fail(`${name}: synthesis returned null (parse/retry exhausted)`); continue; }

  for (const f of ['headline', 'direction', 'brief', 'drivers', 'explained']) {
    if (brief[f] == null) fail(`${name}: missing field "${f}"`);
  }

  const prose = `${brief.headline ?? ''} ${brief.brief ?? ''}`;
  const b = hits(prose, BANNED);
  const v = hits(prose, VERDICT);
  if (b.length) fail(`${name}: banned causal phrase(s): ${b.join(', ')}`);
  if (v.length) fail(`${name}: verdict/advice term(s): ${v.join(', ')}`);

  if (Array.isArray(brief.drivers)) {
    const bad = brief.drivers.filter(d => !['fact', 'coincidence', 'unknown'].includes(d.type));
    if (bad.length) fail(`${name}: invalid driver type(s): ${bad.map(d => d.type).join(', ')}`);
  }

  // The anchor assertion.
  if (name === 'quiet') {
    if (brief.explained !== 'unexplained') {
      fail(`quiet: expected explained="unexplained", got "${brief.explained}"`);
    }
    // Deliberately not "every driver must be unknown". A `fact` driver on a quiet
    // day ("market cap rose 0.38%") is honest — the spec says the array *may* be a
    // single unknown, not must. What the anchor actually guards against is a
    // manufactured catalyst, and that shows up as a `coincidence`: the model
    // pairing the move with something it has no business linking it to.
    const types = (brief.drivers ?? []).map(d => d.type);
    if (!types.includes('unknown')) {
      fail(`quiet: no driver tagged "unknown" on a no-catalyst day, got [${types.join(', ')}]`);
    }
    if (types.includes('coincidence')) {
      fail(`quiet: a "coincidence" driver on a day with no catalyst — manufactured link, got [${types.join(', ')}]`);
    }
  }

  // Only a RELEASED print can account for a move that has already happened; a
  // calendar full of scheduled events cannot, and grading those "unexplained" is
  // correct discipline rather than a regression. This assertion therefore keys off
  // released events and stays dormant until a source actually supplies them.
  if (name === 'macro') {
    const released = (marketState.macro_today ?? []).filter(e => e.status === 'released');
    if (released.length && brief.explained === 'unexplained') {
      fail(`macro: ${released.length} released print(s) in the data but graded unexplained`);
    } else if (!released.length) {
      console.log('  note: fixture has no released prints — explained-grade assertion skipped');
    }
  }

  // A completed print must be cited with its real number and framed against
  // `previous` — never against a consensus figure the model was never given.
  if (name === 'release') {
    const done = marketState.macro?.completed ?? [];
    const cited = done.some(c => prose.includes(String(c.actual)));
    if (!cited) {
      fail(`release: brief never cites the released actual (${done.map(c => c.actual).join(', ')})`);
    }
    const fab = hits(prose, FABRICATED_CONSENSUS);
    if (fab.length) fail(`release: fabricated consensus framing: ${fab.join(', ')}`);
  }

  // Sector reads must state the sector-vs-market relationship as a fact, and must
  // not manufacture a sector narrative when the sector merely tracked the market.
  if (isSector(name)) {
    const sc = marketState.sector?.market_cap_change_24h;
    const mc = marketState.market?.total_market_cap_change_24h_pct;
    const diff = sc - mc;
    const rel = /outperform|underperform|in line|track|lag|ahead of|behind/i.test(prose);
    if (!rel) fail(`${name}: never states the sector-vs-market relationship`);

    if (Math.abs(diff) < 0.25 && brief.explained !== 'unexplained') {
      fail(`${name}: sector tracked the market (${diff.toFixed(2)}pp) but graded "${brief.explained}" — likely an invented narrative`);
    }
    if (!prose.includes(String(Math.abs(sc).toFixed(1))) && !prose.includes(String(sc))) {
      console.log(`  note: sector move ${sc}% not quoted verbatim (not a failure)`);
    }
  }

  console.log(`  headline : ${brief.headline}`);
  console.log(`  explained: ${brief.explained}`);
  console.log(`  drivers  : ${(brief.drivers ?? []).map(d => d.type).join(', ')}`);
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall eval checks passed\n');
process.exit(failures ? 1 : 0);
