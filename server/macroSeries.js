/**
 * Macro series map. Every ID below was verified against a live response on
 * 2026-08-08 — the returned value is noted so a future drift is obvious.
 *
 * BLS is queried through the v1 endpoint, which needs no registration
 * (25 queries/day; we use one). v1 does NOT return the `calculations` block, so
 * year-on-year is computed here from raw index values. That computation was
 * validated against FRED's own published figure: BLS CUUR0000SA0 → 3.53% YoY vs
 * FRED CPIAUCNS pc1 → 3.53%, exact match.
 */

export const BLS_SERIES = {
  // mode: 'yoy'   → index series, 12-month % change computed from raw values
  // mode: 'level' → the value is already the published figure
  // mode: 'delta' → month-over-month change (payrolls)
  'CPI YoY':             { id: 'CUUR0000SA0',    unit: '%', mode: 'yoy'   }, // 333.952 idx
  'Core CPI YoY':        { id: 'CUUR0000SA0L1E', unit: '%', mode: 'yoy'   }, // 336.882 idx
  'PPI Final Demand YoY':{ id: 'WPUFD4',         unit: '%', mode: 'yoy'   }, // 157.045 idx
  'Unemployment rate':   { id: 'LNS14000000',    unit: '%', mode: 'level' }, // 4.1
  'Nonfarm payrolls':    { id: 'CES0000000001',  unit: 'k', mode: 'delta' }, // 158,858k total
  'Avg hourly earnings': { id: 'CES0500000003',  unit: '$', mode: 'level' }, // 37.62
};

export const FRED_SERIES = {
  'PCE YoY':        { id: 'PCEPI',           unit: '%', units: 'pc1' }, // 3.67
  'Core PCE YoY':   { id: 'PCEPILFE',        unit: '%', units: 'pc1' }, // 3.29
  'Real GDP QoQ':   { id: 'A191RL1Q225SBEA', unit: '%', units: 'lin' }, // 1.5 (already a rate)
  // Daily series: its period advances every single day, so period-advance alone
  // would report a "release" daily. The actual event is the rate changing, which
  // only happens at FOMC — hence onChangeOnly.
  'Fed funds upper':{ id: 'DFEDTARU',        unit: '%', units: 'lin', onChangeOnly: true }, // 3.75
};
