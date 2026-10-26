// S4: the level each candidate magnitude mapping would ask for, on the hits played before the change.
//   node docs/evidence/audio/fix-round/s4-counterfactual.mjs
import { readFileSync } from 'node:fs';
const H = JSON.parse(readFileSync(new URL('./s4-hits.json', import.meta.url), 'utf8'));
const ranks = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); for (let i = 0; i < idx.length;) { let k = i; while (k + 1 < idx.length && idx[k + 1][0] === idx[i][0]) k++; for (let q = i; q <= k; q++) r[idx[q][1]] = (i + k) / 2 + 1; i = k + 1; } return r; };
const pearson = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return num / Math.sqrt(da * db); };
const sp = (a, b) => pearson(ranks(a), ranks(b));
const LREF = { 'hit.stone.light': -12, 'hit.stone.heavy': -12, 'hit.ice': -13, 'hit.wood': -13, 'hit.metal.panel': -14, 'hit.metal.heavy': -13, 'hit.masonry': -12 };
const ln = Math.log, cl = (x) => Math.min(1, Math.max(0, x));
const maps = {
  'design: + 0.25 min(1, v/25)': (J, v) => 0.75 * ln(1 + J) / ln(1501) + 0.25 * Math.min(1, v / 25),
  'speed weight 0.10': (J, v) => 0.9 * ln(1 + J) / ln(1501) + 0.1 * Math.min(1, v / 25),
  'impulse only': (J) => ln(1 + J) / ln(1501),
  'speed term x min(1, ln(1+J)/ln(21))': (J, v) => 0.75 * ln(1 + J) / ln(1501) + 0.25 * Math.min(1, v / 25) * Math.min(1, ln(1 + J) / ln(21)),
  'energy: ln(1+Jv)': (J, v) => ln(1 + J * v) / ln(1 + 1500 * 25),
};
for (const [name, hits] of [['bridge (requested levels)', H.beforeBridge], ['engine (played levels)', H.beforeEngine]]) {
  const hs = hits.filter((h) => typeof h.impulse === 'number' && typeof h.relSpeed === 'number');
  console.log(`\n${name}: n ${hs.length}; as recorded rho(J, gain) ${sp(hs.map((h) => h.impulse), hs.map((h) => h.gainDb)).toFixed(3)}`);
  for (const [m, fn] of Object.entries(maps)) {
    const keep = hs.filter((h) => cl(fn(h.impulse, h.relSpeed)) >= 0.08);
    const lv = keep.map((h) => (LREF[h.sound] ?? -13) + 26 * (cl(fn(h.impulse, h.relSpeed)) - 1));
    console.log(`  ${m.padEnd(38)} rho(J, level) ${sp(keep.map((h) => h.impulse), lv).toFixed(3)}  rho(J*v, level) ${sp(keep.map((h) => h.impulse * h.relSpeed), lv).toFixed(3)}  (${hs.length - keep.length} silent)`);
  }
}
