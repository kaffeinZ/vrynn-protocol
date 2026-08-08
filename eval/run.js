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

const CASES = ['quiet', 'macro', 'crash', 'rally'];

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };

for (const name of CASES) {
  console.log(`\n── ${name} ──`);
  const marketState = JSON.parse(readFileSync(`eval/snapshots/${name}.json`, 'utf-8'));

  let brief;
  try {
    brief = await synthesize(marketState);
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
    const allUnknown = Array.isArray(brief.drivers) && brief.drivers.length > 0 &&
      brief.drivers.every(d => d.type === 'unknown');
    if (!allUnknown) {
      fail(`quiet: every driver should be type="unknown", got [${(brief.drivers ?? []).map(d => d.type).join(', ')}]`);
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

  console.log(`  headline : ${brief.headline}`);
  console.log(`  explained: ${brief.explained}`);
  console.log(`  drivers  : ${(brief.drivers ?? []).map(d => d.type).join(', ')}`);
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall eval checks passed\n');
process.exit(failures ? 1 : 0);
