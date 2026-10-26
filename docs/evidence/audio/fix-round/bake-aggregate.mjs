// Aggregate BAKE / BAKEOFF runs of scripts/audio-e2e.mjs: node bake-aggregate.mjs <out dir with run subfolders> [<dir>...]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const rows = [];
for (const root of process.argv.slice(2)) {
  for (const stamp of readdirSync(root)) {
    for (const id of ['BAKE', 'BAKEOFF']) {
      const f = path.join(root, stamp, `${id}.json`);
      if (!existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, 'utf8'));
      for (const [name, r] of Object.entries(j.data.runs ?? {})) {
        const rel = (t) => (t == null || r.gesture == null ? null : +((t - r.gesture) / 1000).toFixed(2));
        const lt = r.longtasks ?? {};
        rows.push({
          src: `${path.basename(root)}/${stamp}`,
          kind: id === 'BAKE' ? 'on' : 'off',
          name,
          loadSec: r.loadingEnd != null && r.gameAt != null ? +((r.loadingEnd - r.gameAt) / 1000).toFixed(2) : null,
          play: rel(r.playAt),
          bell: rel(r.bellBakedAt),
          sounds: rel(r.soundsBakedAt), set: rel(r.setBakedAt),
          strikes: r.bellStrikes ? `${r.bellStrikes.played}/${r.bellStrikes.played + r.bellStrikes.notReady}` : '',
          notReady: r.notReady?.total ?? null,
          p10mean: r.play10?.mean, p10p95: r.play10?.p95, p10p99: r.play10?.p99, p10over50: r.play10?.over50, p10n: r.play10?.n,
          lateMean: r.playLate?.mean, lateP99: r.playLate?.p99, lateOver50: r.playLate?.over50, lateN: r.playLate?.n,
          ltLoadMs: lt.loading?.ms ?? 0, ltPlayN: lt.playing?.n ?? 0, ltPlayMs: lt.playing?.ms ?? 0, ltPlayMax: lt.playing?.max ?? 0,
          bakeMs: r.bake?.time ? Object.fromEntries(Object.entries(r.bake.time.ms).map(([k, v]) => [k, Math.round(v)])) : null,
          bakeMax: r.bake?.time ? Object.fromEntries(Object.entries(r.bake.time.maxMs).map(([k, v]) => [k, +v.toFixed(1)])) : null,
          slices: r.bake?.time?.slices ?? null,
        });
      }
    }
  }
}
console.table(rows.map(({ bakeMs, bakeMax, slices, ...r }) => r));
for (const r of rows) if (r.bakeMs) console.log(r.src, r.kind, r.name, 'bake ms', JSON.stringify(r.bakeMs), 'max', JSON.stringify(r.bakeMax), 'slices', JSON.stringify(r.slices));
// Means per (kind, name)
const by = {};
for (const r of rows) (by[`${r.name}|${r.kind}`] ??= []).push(r);
const mean = (xs) => (xs.length ? +(xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(2) : null);
const out = [];
for (const [k, rs] of Object.entries(by)) {
  const [name, kind] = k.split('|');
  out.push({ name, kind, n: rs.length, loadSec: mean(rs.map((r) => r.loadSec)), playSec: mean(rs.map((r) => r.play)), setSec: mean(rs.filter((r) => r.set != null).map((r) => r.set)), p10mean: mean(rs.map((r) => r.p10mean)), p10p99: mean(rs.map((r) => r.p10p99)), p10over50: mean(rs.map((r) => r.p10over50)), lateMean: mean(rs.map((r) => r.lateMean)), lateP99: mean(rs.map((r) => r.lateP99)), lateOver50: mean(rs.map((r) => r.lateOver50)), ltPlayMs: mean(rs.map((r) => r.ltPlayMs)) });
}
console.table(out.sort((a, b) => (a.name + a.kind).localeCompare(b.name + b.kind)));
