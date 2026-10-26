import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { RiverTrail } from './trail';
import { buildRiverChunk, createRiverChunkGeometry, riverChunkCount, riverChunkRange } from './geometry';
import { buildAllChunks, drive, makeIceberg, probeSurface, type PathFn } from './testkit';

/*
 * River width follows iceberg.radius, which grows above the base when the iceberg absorbs glacier
 * ice (size up to cbrt(maxIce) ≈ 1.8) and is scaled per level (LevelDef.iceberg.scale).
 */

const BASE_RADIUS = 2.2;
const MAX_SIZE = Math.cbrt(6);
const SPEED = 22;
const FROM = 10;

const bumpy = (x: number, z: number): number =>
  80 - 0.08 * z + 1.6 * Math.sin(x / 6.5) + 1.1 * Math.cos(z / 9) + 0.25 * x + 0.4 * Math.sin((x + z) / 3.1);
const terrain = createAnalyticTerrain({ height: bumpy, length: 900, width: 220, cellSize: 2.5 });
const path: PathFn = (d) => ({ x: 25 * Math.sin(d / 38), z: d * 0.9 });

/** Base radius until d = 150, then absorbs ice in 8 bites (every 25 m) up to MAX_SIZE, then holds. */
const radiusAt = (scale: number, d: number): number => {
  const bites = Math.max(0, Math.min(8, Math.floor((d - 150) / 25) + 1));
  return BASE_RADIUS * scale * (1 + ((MAX_SIZE - 1) * bites) / 8);
};

function growTrail(scale: number, to = 820, trail = new RiverTrail()): RiverTrail {
  const ice = makeIceberg(BASE_RADIUS * scale);
  drive(trail, terrain, path, {
    speed: SPEED,
    from: FROM,
    to,
    state: (d, st) => {
      st.radius = radiusAt(scale, d);
    },
  }, 0, ice);
  return trail;
}

describe('river width follows a growing iceberg', () => {
  it.each([1, 2])('level scale %i: width tracks radius smoothly up to size 1.8', (scale) => {
    const trail = growTrail(scale);
    const s = trail.samples;
    // width = 2.6 · radius · (0.96 + 0.16 · speedT) · (1 ± 0.15 noise)
    const speedFactor = 0.96 + 0.16 * 0.8336;
    let maxStep = 0;
    let early = 0;
    let earlyN = 0;
    let late = 0;
    let lateN = 0;
    for (let i = 1; i < s.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(s[i].width - s[i - 1].width) / s[i - 1].width);
      const d = FROM + s[i].t * SPEED;
      const r = radiusAt(scale, d);
      // settled: no radius change within the last 15 m
      if (radiusAt(scale, d - 15) !== r || i < 10) continue;
      const ratio = s[i].width / (2.6 * r * speedFactor);
      expect(ratio, `sample ${i}`).toBeGreaterThan(0.84);
      expect(ratio, `sample ${i}`).toBeLessThan(1.16);
      if (d < 150) {
        early += s[i].width;
        earlyN++;
      } else if (d > 400) {
        late += s[i].width;
        lateN++;
      }
    }
    expect(maxStep).toBeLessThan(0.06);
    expect(late / lateN / (early / earlyN)).toBeGreaterThan(MAX_SIZE * 0.92);
    expect(late / lateN / (early / earlyN)).toBeLessThan(MAX_SIZE * 1.08);

    // flowAt covers the whole (wider) river and nothing beyond it
    let wet = 0;
    for (let i = 20; i < s.length - 20; i += 23) {
      const sm = s[i];
      const rx = -sm.dirZ;
      const rz = sm.dirX;
      for (const side of [-1, 1]) {
        const inside = trail.flowAt(sm.x + side * rx * sm.width * 0.4, sm.z + side * rz * sm.width * 0.4);
        expect(inside, `sample ${i}`).not.toBeNull();
        if (inside) wet++;
        const out = 0.62 * sm.width;
        expect(trail.flowAt(sm.x + side * rx * out, sm.z + side * rz * out)).toBeNull();
      }
    }
    expect(wet).toBeGreaterThan(40);
  });

  it.each([1, 2])('level scale %i: the wide river drapes on bumpy ground and never folds', (scale) => {
    const trail = growTrail(scale);
    const s = trail.samples;
    const chunks = buildAllChunks(s, terrain);
    const rep = probeSurface(chunks, terrain);
    let flipped = 0;
    let minNormalY = 1;
    for (const g of chunks) {
      for (let v = 0; v < g.vertexCount; v++) minNormalY = Math.min(minNormalY, g.normal[v * 3 + 1]);
      const P = g.position;
      for (let t = 0; t < g.indexCount; t += 3) {
        const a = g.index[t] * 3;
        const b = g.index[t + 1] * 3;
        const c = g.index[t + 2] * 3;
        const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
        if (ny < -1e-6) flipped++;
      }
    }
    console.log(
      `[river] growth x${scale}: max width ${Math.max(...s.map((x) => x.width)).toFixed(1)} m, ` +
        `max float ${rep.maxFloat.toFixed(2)} m, max bury ${rep.maxBury.toFixed(3)} m, ` +
        `min normal.y ${minNormalY.toFixed(2)}`,
    );
    expect(flipped).toBe(0);
    expect(minNormalY).toBeGreaterThan(0.2);
    expect(rep.maxBury).toBeLessThan(0.6);
    expect(rep.floatOver1).toBe(0);
  });

  it('after decimations and growth, flowAt answers exactly like a coarse-celled reference', () => {
    // Small cap: several decimation passes, each rebuilding the hash with a cell sized to the
    // (growing) river; the reference keeps one 48 m cell size throughout.
    const opts = { maxSamples: 300, protectTail: 60 };
    const trail = growTrail(2, 820, new RiverTrail(opts));
    const ref = growTrail(2, 820, new RiverTrail({ ...opts, hashCellSize: 48 }));
    expect(trail.stats.decimations).toBeGreaterThan(2);
    expect(trail.stats.hashCellSize).toBeGreaterThan(trail.options.hashCellSize);
    let wet = 0;
    let points = 0;
    for (let z = 0; z < 760; z += 1.3) {
      for (let x = -60; x < 60; x += 1.3) {
        const a = trail.flowAt(x, z);
        const ax = a ? [a.vx, a.vz, a.surfaceY, a.strength] : null;
        const b = ref.flowAt(x, z);
        const bx = b ? [b.vx, b.vz, b.surfaceY, b.strength] : null;
        points++;
        if (ax) wet++;
        if (JSON.stringify(ax) !== JSON.stringify(bx)) expect(ax, `(${x}, ${z})`).toEqual(bx);
      }
    }
    expect(wet).toBeGreaterThan(0.1 * points);
  });

  it('a huge, grown iceberg keeps recording, flow queries and chunk builds within budget', () => {
    const plane = createAnalyticTerrain({
      height: inclinedPlane(0.02, 200),
      length: 11000,
      width: 260,
      cellSize: 4,
    });
    const trail = new RiverTrail();
    const ice = makeIceberg(BASE_RADIUS * 2 * MAX_SIZE);
    const curve: PathFn = (d) => ({ x: 60 * Math.sin(d / 140), z: d * 0.9 });
    // record() calls that ran a decimation pass (merge + hash rebuild), in ms
    const decimationMs: number[] = [];
    let steps = 0;
    const t0 = performance.now();
    for (let d = 5; d < 11800; d += SPEED / 60) {
      const p = curve(d);
      const q = curve(d + 0.01);
      const l = Math.hypot(q.x - p.x, q.z - p.z);
      ice.pos.x = p.x;
      ice.pos.z = p.z;
      ice.vel.x = ((q.x - p.x) / l) * SPEED;
      ice.vel.z = ((q.z - p.z) / l) * SPEED;
      const structure = trail.structureVersion;
      const r0 = performance.now();
      trail.record(ice, plane, steps / 60);
      if (trail.structureVersion !== structure) decimationMs.push(performance.now() - r0);
      steps++;
    }
    const recordMs = (performance.now() - t0) / steps;
    const stats = trail.stats;
    expect(stats.decimations).toBeGreaterThanOrEqual(3);
    expect(decimationMs).toHaveLength(stats.decimations);
    const sorted = [...decimationMs].sort((a, b) => a - b);

    const s = trail.samples;
    const bodies: { x: number; z: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const sm = s[s.length - 1 - i * 7];
      bodies.push({ x: sm.x + ((i % 9) - 4) * 2, z: sm.z + ((i % 5) - 2) * 2 });
    }
    let perStep = Infinity;
    let hits = 0;
    for (let batch = 0; batch < 8; batch++) {
      hits = 0;
      const t1 = performance.now();
      for (let k = 0; k < 60; k++) for (const b of bodies) if (trail.flowAt(b.x, b.z)) hits++;
      perStep = Math.min(perStep, (performance.now() - t1) / 60);
    }
    let buildMs = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const t2 = performance.now();
      buildAllChunks(s, plane);
      buildMs = Math.min(buildMs, performance.now() - t2);
    }
    const n = s.length;
    const tail = riverChunkRange(riverChunkCount(n) - 1, n);
    const geo = buildRiverChunk(s, tail.start, tail.end, plane, createRiverChunkGeometry());
    let incMs = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const t3 = performance.now();
      for (let k = 0; k < 100; k++) {
        buildRiverChunk(s, tail.start, tail.end, plane, geo, undefined, tail.end - 6);
      }
      incMs = Math.min(incMs, (performance.now() - t3) / 100);
    }
    console.log(
      `[river] huge iceberg (width ${s[n - 1].width.toFixed(1)} m): ${n} samples, ` +
        `hash ${stats.hashCells} cells of ${stats.hashCellSize.toFixed(1)} m, ` +
        `${stats.hashEntries} entries; ` +
        `record ${recordMs.toFixed(4)} ms/step; ${decimationMs.length} decimations ` +
        `${decimationMs.map((m) => m.toFixed(2)).join(' ')} ms; ` +
        `flowAt 200 bodies ${perStep.toFixed(4)} ms/step (${hits / 60} hits), ` +
        `full build ${buildMs.toFixed(1)} ms, ` +
        `incremental tail ${incMs.toFixed(4)} ms`,
    );
    expect(hits).toBeGreaterThan(0);
    expect(recordMs).toBeLessThan(0.1);
    // Decimation cost must not scale with width²: hash cells grow with the river, so a 21 m
    // river puts ~6 entries per segment into each rebuild (a 6 m one ~3.6; fixed 8 m cells ~15).
    expect(stats.hashEntries / n).toBeLessThan(8);
    // Timings take the fastest pass / batch: other test files share the CPU. A warm pass is
    // ~1.5–2.5 ms on a quiet laptop (the first runs cold), under a tenth of rebuilding the river
    // geometry, which the renderer does after every pass; the ratio holds when the CPU is busy.
    expect(sorted[0]).toBeLessThan(0.25 * buildMs);
    // ~0.35 ms on a laptop; ~2.5x the 6 m river's cost (river.test.ts, budget 0.5 ms), since
    // about that many more segments overlap any point of a 23 m river.
    expect(perStep).toBeLessThan(1);
    expect(buildMs).toBeLessThan(100);
    expect(incMs).toBeLessThan(1);
  });
});
