import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(HERE, '../og-cache');

mkdirSync(CACHE_DIR, { recursive: true });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Greedy word wrap — SVG has no text flow, so lines are split by hand. */
function wrap(text, maxChars, maxLines) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; if (lines.length === maxLines) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:]?$/, '') + '…';
  }
  return lines;
}

const fmtUsd = (v) =>
  v == null ? 'n/a'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T`
  : v >= 1e9  ? `$${(v / 1e9).toFixed(1)}B`
  : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const fmtPct = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);

const EXPLAINED_LABEL = {
  'well-explained':   'DRIVERS IDENTIFIED',
  'partly-explained': 'PARTLY EXPLAINED',
  'unexplained':      'NO CLEAR CATALYST',
};

/** 1200×630 share card carrying the day's real numbers. */
export function buildOgSvg(signals, synthesis) {
  const mc  = signals?.market ?? {};
  const a   = signals?.assets ?? {};
  const chg = mc.total_market_cap_change_24h_pct;
  const up  = chg == null ? null : chg >= 0;
  const accent = up == null ? '#9aa0b0' : up ? '#2ecc71' : '#ff4d8d';

  const prettyDate = signals?.date
    ? new Date(`${signals.date}T00:00:00Z`).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()
    : '';

  const headline = synthesis?.headline || `Crypto market ${fmtPct(chg)} over 24 hours.`;
  const lines = wrap(headline, 38, 3);
  const badge = synthesis?.explained ? EXPLAINED_LABEL[synthesis.explained] ?? '' : '';

  const stat = (x, label, value, colour) => `
    <text x="${x}" y="486" font-family="Helvetica,Arial,sans-serif" font-size="21"
          fill="#8b91a3" letter-spacing="1.6">${esc(label)}</text>
    <text x="${x}" y="530" font-family="Helvetica,Arial,sans-serif" font-size="38"
          font-weight="700" fill="${colour}">${esc(value)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#00c8e0"/><stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
    <radialGradient id="glow" cx="18%" cy="0%" r="85%">
      <stop offset="0" stop-color="#2a1d4a"/><stop offset="1" stop-color="#0b0c10"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="7" fill="url(#brand)"/>

  <text x="72" y="104" font-family="Helvetica,Arial,sans-serif" font-size="34"
        font-weight="800" fill="url(#brand)">Vrynn</text>
  <text x="72" y="150" font-family="Helvetica,Arial,sans-serif" font-size="20"
        fill="#8b91a3" letter-spacing="2.4">${esc(prettyDate)}</text>

  ${lines.map((l, i) => `
  <text x="72" y="${248 + i * 62}" font-family="Helvetica,Arial,sans-serif" font-size="52"
        font-weight="700" fill="#eef0f4">${esc(l)}</text>`).join('')}

  ${badge ? `
  <rect x="72" y="${268 + lines.length * 62}" width="${badge.length * 11 + 34}" height="40"
        rx="8" fill="#ffffff" fill-opacity="0.08"/>
  <text x="${72 + 17}" y="${295 + lines.length * 62}" font-family="Helvetica,Arial,sans-serif"
        font-size="19" font-weight="700" fill="#c9cede" letter-spacing="1.2">${esc(badge)}</text>` : ''}

  <line x1="72" y1="446" x2="1128" y2="446" stroke="#2a2d38" stroke-width="1"/>
  ${stat(72,  'TOTAL MARKET CAP', `${fmtUsd(mc.total_market_cap_usd)}  ${fmtPct(chg)}`, accent)}
  ${stat(560, 'BTC', fmtPct(a.BTC?.change_24h_pct), '#eef0f4')}
  ${stat(760, 'ETH', fmtPct(a.ETH?.change_24h_pct), '#eef0f4')}
  ${stat(960, 'SOL', fmtPct(a.SOL?.change_24h_pct), '#eef0f4')}

  <text x="72" y="590" font-family="Helvetica,Arial,sans-serif" font-size="19" fill="#6f7585">
    What moved — and what merely coincided with it.</text>
</svg>`;
}

/**
 * Render (and cache) the PNG. Cards are immutable once a brief is published, so a
 * cached file is served forever after the first request. Returns null if the
 * rasteriser is unavailable, letting the caller fall back rather than 500.
 */
export async function getOgPng(date, signals, synthesis) {
  const pngPath = resolve(CACHE_DIR, `${date}.png`);
  if (existsSync(pngPath)) return readFileSync(pngPath);

  const svgPath = resolve(CACHE_DIR, `${date}.svg`);
  try {
    writeFileSync(svgPath, buildOgSvg(signals, synthesis), 'utf-8');
    await exec('rsvg-convert', ['-w', '1200', '-h', '630', '-o', pngPath, svgPath]);
    return readFileSync(pngPath);
  } catch (err) {
    console.error(`[og] render failed for ${date}:`, err.message);
    return null;
  }
}
