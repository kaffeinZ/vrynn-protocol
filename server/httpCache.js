import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Opt-in, test-only HTTP cache.
 *
 * Production runs ~12 CoinGecko calls a day and sits comfortably inside the free
 * tier. What exhausts the allowance is *iterating* — running the same detection
 * a dozen times in an afternoon. This replays those from disk so repeated test
 * runs cost nothing.
 *
 * OFF unless VRYNN_HTTP_CACHE=1. The daily cron must always hit the live API —
 * a brief built from cached prices would be silently stale, which is precisely
 * the failure this project keeps guarding against.
 *
 *   VRYNN_HTTP_CACHE=1 node eval/run.js
 *   VRYNN_HTTP_CACHE=1 VRYNN_HTTP_CACHE_TTL=7200 node some-test.js
 */
const ENABLED = process.env.VRYNN_HTTP_CACHE === '1';
const TTL_MS  = (parseInt(process.env.VRYNN_HTTP_CACHE_TTL || '3600', 10)) * 1000;
const DIR     = resolve(dirname(fileURLToPath(import.meta.url)), '../.http-cache');

if (ENABLED) {
  mkdirSync(DIR, { recursive: true });
  console.log(`[http-cache] ENABLED (ttl ${TTL_MS / 1000}s, ${DIR}) — test mode, not for production`);
}

const keyFor = (url) => createHash('sha1').update(String(url)).digest('hex').slice(0, 20);

/** Minimal Response-alike: only the surface this codebase actually uses. */
function replay(entry) {
  return {
    ok: entry.ok,
    status: entry.status,
    cached: true,
    async json() { return JSON.parse(entry.body); },
    async text() { return entry.body; },
  };
}

export async function cachedFetch(url, opts) {
  if (!ENABLED) return fetch(url, opts);

  const file = resolve(DIR, `${keyFor(url)}.json`);
  if (existsSync(file)) {
    try {
      const entry = JSON.parse(readFileSync(file, 'utf-8'));
      if (Date.now() - entry.at < TTL_MS) return replay(entry);
    } catch { /* corrupt entry — fall through and refetch */ }
  }

  const res  = await fetch(url, opts);
  const body = await res.text();
  // Cache failures too: a 429 replayed from disk is far better than another 429.
  try {
    writeFileSync(file, JSON.stringify({ at: Date.now(), ok: res.ok, status: res.status, url: String(url), body }));
  } catch { /* cache is best-effort */ }

  return { ok: res.ok, status: res.status, cached: false,
           async json() { return JSON.parse(body); }, async text() { return body; } };
}

/** Drop cached entries — `node -e "import('./server/httpCache.js').then(m=>m.clearHttpCache())"` */
export function clearHttpCache() {
  if (!existsSync(DIR)) return 0;
  let n = 0;
  for (const f of readdirSync(DIR)) {
    if (f.endsWith('.json')) { unlinkSync(resolve(DIR, f)); n++; }
  }
  return n;
}

export function httpCacheStats() {
  if (!existsSync(DIR)) return { enabled: ENABLED, entries: 0 };
  const files = readdirSync(DIR).filter(f => f.endsWith('.json'));
  const bytes = files.reduce((a, f) => a + statSync(resolve(DIR, f)).size, 0);
  return { enabled: ENABLED, entries: files.length, kb: Math.round(bytes / 1024) };
}
