// S4 after the change, split into the +-8 m lanes and the rest. Not a held-out test: S4M's sample, on which
// COLLISION_MAG.jGate was chosen, includes the +-8 m lanes (the physics is deterministic per level, lane and seed),
// from the final S3 (bridge) run, whose run names were lost to a driver bug (fixed since): the hits are split
// by each run's hit count, in the run order of that driver.  node docs/evidence/audio/fix-round/s4-heldout.mjs
import { readFileSync } from 'node:fs';
const { afterBridge: j } = JSON.parse(readFileSync(new URL('./s4-hits.json', import.meta.url), 'utf8'));
const LEVELS = ['mountain-valley', 'rocky-canyon', 'alpine-pass', 'riverside-town', 'glacier-avalanche', 'power-valley', 'ravine-run', 'highland-maze', 'summit-labyrinth'];
const order = [...LEVELS.map((l) => [l, 0]), ['mountain-valley', 8], ['mountain-valley', 16], ...LEVELS.flatMap((l) => [[l, -8], [l, 8]]).filter(([l, k]) => !(l === 'mountain-valley' && k === 8))];
const ranks = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); for (let i = 0; i < idx.length;) { let k = i; while (k + 1 < idx.length && idx[k + 1][0] === idx[i][0]) k++; for (let q = i; q <= k; q++) r[idx[q][1]] = (i + k) / 2 + 1; i = k + 1; } return r; };
const pearson = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return num / Math.sqrt(da * db); };
const sp = (a, b) => pearson(ranks(a), ranks(b));
let k = 0; const held = [], rest = [];
j.runs.forEach((r, i) => { const [l, lane] = order[i]; if (r.level !== l) throw new Error(`run ${i}: ${r.level} != ${l}`); const hs = j.hits.slice(k, k + r.hits); k += r.hits; (lane === -8 || (lane === 8 && l !== 'mountain-valley') ? held : rest).push(...hs); });
const rho = (hs) => sp(hs.map((h) => h.impulse), hs.map((h) => h.gainDb));
console.log(`+-8 m lanes (in the gate's sample too): rho ${rho(held).toFixed(3)}, n ${held.length}; the other lines: rho ${rho(rest).toFixed(3)}, n ${rest.length}; all ${rho([...held, ...rest]).toFixed(3)}, n ${held.length + rest.length}`);
