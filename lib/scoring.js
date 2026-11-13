// Scoring rules. See README "Scoring" section.
// Raw percent correct -> band (Reading, Listening, Build a Sentence).
const TABLE = [[94, 6], [86, 5.5], [78, 5], [70, 4.5], [60, 4], [50, 3.5], [40, 3], [30, 2.5], [20, 2], [10, 1.5], [0, 1]];
function pctToBand(pct) { for (const [min, b] of TABLE) if (pct >= min) return b; return 1; }
const roundHalf = x => Math.round(x * 2) / 2;
const clampBand = x => Math.max(1, Math.min(6, x));
// Official ETS Table 6 (Score Scale Update 2026, https://www.eu.ets.org/pdfs/toefl/score-scale-update-2026.pdf):
// minimum 0-120 total for each 1-6 overall band, and 0-30 section ranges. Totals are sums of section minimums.
const TOTAL_MIN = { 6: 114, 5.5: 107, 5: 95, 4.5: 86, 4: 72, 3.5: 58, 3: 44, 2.5: 34, 2: 24, 1.5: 12, 1: 0 };
const SECTION30 = { // [min, max] per band
  reading:   { 6: [29, 30], 5.5: [27, 28], 5: [24, 26], 4.5: [22, 23], 4: [18, 21], 3.5: [12, 17], 3: [6, 11], 2.5: [4, 5], 2: [3, 3], 1.5: [2, 2], 1: [0, 1] },
  listening: { 6: [28, 30], 5.5: [26, 27], 5: [22, 25], 4.5: [20, 21], 4: [17, 19], 3.5: [13, 16], 3: [9, 12], 2.5: [6, 8], 2: [4, 5], 1.5: [2, 3], 1: [0, 1] },
  writing:   { 6: [29, 30], 5.5: [27, 28], 5: [24, 26], 4.5: [21, 23], 4: [17, 20], 3.5: [15, 16], 3: [13, 14], 2.5: [11, 12], 2: [7, 10], 1.5: [3, 6], 1: [0, 2] },
  speaking:  { 6: [28, 30], 5.5: [27, 27], 5: [25, 26], 4.5: [23, 24], 4: [20, 22], 3.5: [18, 19], 3: [16, 17], 2.5: [13, 15], 2: [10, 12], 1.5: [5, 9], 1: [0, 4] },
};
// Estimate only: midpoint of the official 0-120 range for the band (range = this band's minimum to the next band's minimum minus 1).
const approx120 = b => {
  const bands = Object.keys(TOTAL_MIN).map(Number).sort((x, y) => x - y);
  const k = roundHalf(Math.max(1, Math.min(6, b)));
  const lo = TOTAL_MIN[k], hi = k === 6 ? 120 : TOTAL_MIN[bands[bands.indexOf(k) + 1]] - 1;
  return Math.round((lo + hi) / 2);
};
// Midpoint of the official 0-30 range for a section band.
const approx30 = (section, b) => { const r = SECTION30[section] && SECTION30[section][roundHalf(Math.max(1, Math.min(6, b)))]; return r ? Math.round((r[0] + r[1]) / 2) : null; };

// House mapping, NOT published by ETS: item score 0-5 -> band 1-6 is score + 1.
// ETS builds the real section band from the SUM of raw task scores (equipercentile linked, tables unpublished).
const taskScoreToBand = s => clampBand(roundHalf(Number(s) + 1));
// Pool task results by raw points like ETS does. parts = [{ got, max }]. Returns a 1-6 band or null.
function pooledBand(parts) {
  const v = parts.filter(p => p && p.max > 0 && typeof p.got === 'number');
  if (!v.length) return null;
  const got = v.reduce((a, p) => a + p.got, 0), max = v.reduce((a, p) => a + p.max, 0);
  return clampBand(roundHalf(1 + 5 * got / max));
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

function overall(bands) {
  const v = ['reading', 'listening', 'speaking', 'writing'].map(k => bands[k]).filter(x => typeof x === 'number');
  if (v.length < 4) return null;
  return roundHalf(v.reduce((a, b) => a + b, 0) / 4);
}
module.exports = { pctToBand, roundHalf, clampBand, approx120, norm, overall, TABLE, TOTAL_MIN, SECTION30, approx30, taskScoreToBand, pooledBand };
