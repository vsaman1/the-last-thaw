import { beforeAll, describe, expect, it } from 'vitest';
import type { LevelDef } from '../types';
import { sampleHeight } from '../heightGrid';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { level1 } from '../levels/level1';
import { getLevel, LEVELS } from '../levels';
import { createTerrain, type GeneratedTerrain } from './terrain';
import type { CourseProjection } from './course';
import { DECOR_FLOOR_CLEARANCE, DECOR_LIMITS, generateDecor, type DecorBatch } from './decor';
import { placementFootprint, validatePlacements } from './validate';
import { buildTerrainChunks } from './terrainGeometry';
import { buildBackdropGeometry, createSceneryModels } from './sceneryGeometry';

const nearCliff = (lv: LevelDef, a: number, b: number, margin: number): boolean =>
  lv.cliffs.some((c) => b >= c.s - margin && a <= c.s + margin);

describe('level 1 terrain', () => {
  let t: GeneratedTerrain;
  let buildMs = 0;
  beforeAll(() => {
    const t0 = performance.now();
    t = createTerrain(level1);
    buildMs = performance.now() - t0;
  });

  it('builds in under 1.5 s', () => {
    expect(buildMs).toBeLessThan(1500);
    expect(t.buildMs).toBeLessThan(1500);
  });

  it('is registered in LEVELS and getLevel', () => {
    expect(LEVELS[0]).toBe(level1);
    expect(getLevel('mountain-valley')).toBe(level1);
    expect(() => getLevel('nope')).toThrow();
  });

  it('is a short tutorial: ~500 m start to coast, finish ~20 m out, >= 100 m of sea beyond', () => {
    expect(level1.coastS - level1.startS).toBeGreaterThanOrEqual(480);
    expect(level1.coastS - level1.startS).toBeLessThanOrEqual(520);
    expect(level1.finishS - level1.coastS).toBeGreaterThanOrEqual(15);
    expect(level1.finishS - level1.coastS).toBeLessThanOrEqual(25);
    expect(t.course.length - level1.finishS).toBeGreaterThanOrEqual(100);
    expect(t.course.length).toBeLessThan(760);
  });

  it('descends at least 0.15 m per 4 m on the centreline from start to coast (except at cliffs)', () => {
    const cell = level1.cellSize;
    let checked = 0;
    for (let s = level1.startS; s + 4 <= level1.coastS; s += 4) {
      if (nearCliff(level1, s, s + 4, 2 * cell)) continue;
      const a = t.course.toWorld(s, 0).y;
      const b = t.course.toWorld(s + 4, 0).y;
      expect(a - b, `s=${s}`).toBeGreaterThanOrEqual(0.15);
      const floorDrop = t.course.sampleAt(s).floor - t.course.sampleAt(s + 4).floor;
      expect(floorDrop, `floor s=${s}`).toBeGreaterThan(0.15);
      checked++;
    }
    expect(checked).toBeGreaterThan(115);
  });

  it('is steep but in range: launch ramp <= ~0.18, typical slopes 0.09-0.14 away from cliffs', () => {
    const slopes: number[] = [];
    for (let s = level1.startS; s + 4 <= level1.coastS; s += 4) {
      if (nearCliff(level1, s, s + 4, 2 * level1.cellSize)) continue;
      const drop = t.course.toWorld(s, 0).y - t.course.toWorld(s + 4, 0).y;
      expect(drop / 4, `s=${s}`).toBeLessThan(0.19);
      slopes.push(drop / 4);
    }
    // The launch ramp right after the spawn is the steepest stretch.
    let ramp = 0;
    for (let s = level1.startS; s < level1.startS + 50; s += 4) {
      ramp = Math.max(ramp, (t.course.toWorld(s, 0).y - t.course.toWorld(s + 4, 0).y) / 4);
    }
    expect(ramp).toBeGreaterThan(0.16);
    slopes.sort((a, b) => a - b);
    const median = slopes[slopes.length >> 1];
    expect(median).toBeGreaterThanOrEqual(0.09);
    expect(median).toBeLessThanOrEqual(0.14);
    const cliffDrops = level1.cliffs.reduce((sum, c) => sum + c.drop, 0);
    const mean = (t.startPos.y - t.coastPos.y - cliffDrops) / (level1.coastS - level1.startS);
    expect(mean).toBeGreaterThanOrEqual(0.09);
    expect(mean).toBeLessThanOrEqual(0.14);
  });

  it('turns each cliff into a sharp drop within 10% of its definition over <= 2 grid cells', () => {
    const cell = level1.cellSize;
    for (const c of level1.cliffs) {
      expect(c.drop).toBeGreaterThanOrEqual(14);
      expect(c.drop).toBeLessThanOrEqual(16);
      const top = t.course.toWorld(c.s - cell, 0).y;
      const bottom = t.course.toWorld(c.s + cell, 0).y;
      const drop = top - bottom;
      expect(Math.abs(drop - c.drop)).toBeLessThan(0.1 * c.drop);
      // The lip is crisp: just upstream it is still nearly flat.
      const before = t.course.toWorld(c.s - 3 * cell, 0).y - top;
      expect(before).toBeLessThan(0.6);
      const info = t.cliffInfo.find((ci) => ci.s === c.s);
      expect(info).toBeDefined();
      expect(info!.lip.y - info!.base.y).toBeCloseTo(c.drop, 1);
      // Across the floor the step is there too.
      for (const f of [-0.6, 0.6]) {
        const hw = t.course.sampleAt(c.s).halfWidth;
        const dTop = t.course.toWorld(c.s - cell, f * hw).y;
        const dBottom = t.course.toWorld(c.s + cell, f * hw).y;
        expect(dTop - dBottom).toBeGreaterThan(0.9 * c.drop);
      }
    }
  });

  it('gives each cliff a clean, straight lip: same height and position across the floor', () => {
    for (const c of level1.cliffs) {
      const hw = t.course.sampleAt(c.s).halfWidth;
      const tops: number[] = [];
      const steps: number[] = [];
      for (const f of [-0.8, -0.4, 0, 0.4, 0.8]) {
        const top = t.course.toWorld(c.s - 3, f * hw).y;
        const bottom = t.course.toWorld(c.s + 3, f * hw).y;
        tops.push(top);
        let s = c.s - 3;
        while (s < c.s + 3 && t.course.toWorld(s, f * hw).y > (top + bottom) / 2) s += 0.05;
        steps.push(s);
      }
      // Bowl rise is symmetric, so the lip must be too; the step must not wander along the lip.
      expect(Math.abs(tops[0] - tops[4]), `lip heights ${tops.map((y) => y.toFixed(2))}`).toBeLessThan(0.1);
      expect(Math.abs(tops[1] - tops[3])).toBeLessThan(0.1);
      expect(Math.max(...steps) - Math.min(...steps), `step at s ${steps.map((s) => s.toFixed(2))}`)
        .toBeLessThan(0.5);
    }
  });

  it('round-trips project(toWorld(s, d)) on the floor', () => {
    let worstS = 0;
    let worstD = 0;
    for (let s = 5; s < t.course.length - 5; s += 7) {
      const hw = t.course.sampleAt(s).halfWidth;
      for (const f of [-0.95, -0.5, 0, 0.5, 0.95]) {
        const d = f * hw;
        const w = t.course.toWorld(s, d);
        const p = t.course.project(w.x, w.z);
        worstS = Math.max(worstS, Math.abs(p.s - s));
        worstD = Math.max(worstD, Math.abs(p.d - d));
      }
    }
    expect(worstS).toBeLessThan(0.75);
    expect(worstD).toBeLessThan(0.5);
  });

  it('uses the shared heading convention: +d is right of travel', () => {
    const smp = t.course.sampleAt(400);
    const w = t.course.toWorld(400, 5);
    expect((w.x - smp.x) * -smp.dirZ + (w.z - smp.z) * smp.dirX).toBeCloseTo(5, 3);
  });

  it('projects points beyond the course ends with clamped s and a meaningful d', () => {
    const end = t.course.sampleAt(t.course.length);
    const px = end.x + end.dirX * 30 - end.dirZ * 7;
    const pz = end.z + end.dirZ * 30 + end.dirX * 7;
    const p = t.course.project(px, pz);
    expect(p.s).toBeCloseTo(t.course.length, 3);
    expect(p.d).toBeCloseTo(7, 1);
    const ext: CourseProjection = { s: 0, sExt: 0, d: 0 };
    t.course.projectInto(px, pz, ext);
    expect(ext.sExt).toBeCloseTo(t.course.length + 30, 0);

    const st = t.course.sampleAt(0);
    const back = t.course.project(st.x - st.dirX * 20 + st.dirZ * 4, st.z - st.dirZ * 20 - st.dirX * 4);
    expect(back.s).toBe(0);
    expect(back.d).toBeCloseTo(-4, 1);
  });

  it('starts well above the sea and reaches it at the coast', () => {
    expect(t.startPos.y).toBeGreaterThan(level1.seaLevel + 60);
    expect(Math.abs(t.coastPos.y - level1.seaLevel)).toBeLessThan(1);
    expect(t.isOcean(t.coastPos.x, t.coastPos.z)).toBe(false);
  });

  it('is ocean on the centreline from the finish line to the end of the course and beyond', () => {
    for (let s = level1.finishS; s <= t.course.length + 40; s += 5) {
      const w = t.course.toWorld(s, 0);
      expect(t.isOcean(w.x, w.z), `s=${s}`).toBe(true);
    }
    // The finish is just into open water: deep enough to float, not far out.
    const f = t.course.toWorld(level1.finishS, 0);
    expect(f.y).toBeLessThan(level1.seaLevel - 2);
    expect(f.y).toBeGreaterThan(level1.seaLevel - 8);
    expect(t.isOcean(t.finishPos.x, t.finishPos.z)).toBe(true);
    // ...and the water starts between the coast and the finish line.
    let firstSea = -1;
    for (let s = level1.coastS - 10; s <= level1.finishS && firstSea < 0; s += 1) {
      const w = t.course.toWorld(s, 0);
      if (t.isOcean(w.x, w.z)) firstSea = s;
    }
    expect(firstSea).toBeGreaterThanOrEqual(level1.coastS);
    expect(level1.finishS - firstSea).toBeGreaterThanOrEqual(10);
    const deep = t.course.toWorld(t.course.length, 0);
    expect(deep.y).toBeGreaterThan(level1.seaLevel - 16);
    expect(deep.y).toBeLessThan(level1.seaLevel - 12);
  });

  it('has a real shoreline across the whole width, not a slot', () => {
    const z = t.coastPos.z + 70;
    let land = 0;
    let sea = 0;
    for (let x = level1.bounds.minX + 5; x < level1.bounds.maxX - 5; x += 10) {
      if (t.isOcean(x, z)) sea++;
      else land++;
    }
    expect(land).toBe(0);
    expect(sea).toBeGreaterThan(40);
    // Inland of the coast at the same arc length, the sides are still land.
    const inland = t.course.toWorld(level1.coastS - 60, 120);
    expect(t.isOcean(inland.x, inland.z)).toBe(false);
  });

  it('matches heightAt on the centreline to sampleAt(s).floor', () => {
    let worst = 0;
    for (let s = 0; s <= t.course.length; s += 3) {
      if (nearCliff(level1, s, s, 2 * level1.cellSize)) continue;
      const w = t.course.toWorld(s, 0);
      worst = Math.max(worst, Math.abs(w.y - t.course.sampleAt(s).floor));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('has a concave floor so loose things drift to the middle', () => {
    for (const s of [120, 270, 440, 480]) {
      const hw = t.course.sampleAt(s).halfWidth;
      const mid = t.course.toWorld(s, 0).y;
      const left = t.course.toWorld(s, -0.9 * hw).y;
      const right = t.course.toWorld(s, 0.9 * hw).y;
      expect(left).toBeGreaterThan(mid);
      expect(right).toBeGreaterThan(mid);
      expect(left - mid).toBeLessThan(1.2);
    }
  });

  it('rises into walls and mountains beside the floor', () => {
    for (const s of [100, 250, 340, 420]) {
      const hw = t.course.sampleAt(s).halfWidth;
      const floor = t.course.sampleAt(s).floor;
      for (const side of [-1, 1]) {
        const wall = t.course.toWorld(s, side * (hw + level1.wallRamp)).y;
        expect(wall - floor, `s=${s} side=${side}`).toBeGreaterThan(level1.wallHeight * 0.6);
        const far = t.course.toWorld(s, side * (hw + level1.wallRamp + 120)).y;
        expect(far - floor, `far s=${s} side=${side}`).toBeGreaterThan(level1.wallHeight + 20);
      }
    }
  });

  it('classifies surfaces sensibly', () => {
    const at = (s: number, d: number): string => {
      const w = t.course.toWorld(s, d);
      return t.surfaceAt(w.x, w.z);
    };
    expect(at(100, 0)).toBe('grass');
    expect(at(440, 3)).toBe('grass');
    expect(at(level1.finishS, 0)).toBe('seabed');
    expect(at(level1.coastS - 8, 0)).toBe('sand');
    // The cliff face is the grid cell that straddles the lip (within one cell either side of s).
    const cliff = level1.cliffs[0];
    const kinds = new Set<string>();
    for (let ds = -level1.cellSize; ds <= level1.cellSize; ds += 0.25) kinds.add(at(cliff.s + ds, 0));
    expect(kinds.has('rock')).toBe(true);
    let rock = 0;
    for (let s = 60; s < 440; s += 20) if (at(s, t.course.sampleAt(s).halfWidth + 12) === 'rock') rock++;
    expect(rock).toBeGreaterThan(12);
  });

  it('keeps normals and gradients consistent with heights', () => {
    const w = t.course.toWorld(300, 4);
    const g = t.gradientAt(w.x + 0.3, w.z + 0.3);
    const n = t.normalAt(w.x + 0.3, w.z + 0.3);
    expect(n.y).toBeGreaterThan(0.9);
    expect(n.x).toBeCloseTo(-g.dx / Math.hypot(g.dx, 1, g.dz), 6);
    expect(t.heightAt(w.x, w.z)).toBe(sampleHeight(t.grid, w.x, w.z));
  });

  it('places every obstacle inside the floor, away from cliffs, the start and the sea', () => {
    expect(validatePlacements(t)).toEqual([]);
    for (const p of level1.obstacles) {
      expect(p.s).toBeGreaterThan(level1.startS);
      expect(p.s).toBeLessThan(level1.coastS);
      for (const c of level1.cliffs) {
        expect(p.s <= c.s - 12 || p.s >= c.s + level1.cellSize + 15, `${p.kind} at s=${p.s}`).toBe(true);
      }
      const hw = t.course.sampleAt(p.s).halfWidth;
      expect(Math.abs(p.d) + placementFootprint(p)).toBeLessThanOrEqual(hw);
      const w = t.course.toWorld(p.s, p.d);
      expect(t.isOcean(w.x, w.z)).toBe(false);
      expect(w.y).toBeGreaterThan(level1.seaLevel + 0.5);
    }
  });

  it('has the designed set pieces, with fewer but meaningful obstacles', () => {
    const kinds = level1.obstacles.map((o) => o.kind);
    expect(kinds.filter((k) => k === 'house')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'stoneBarrier')).toHaveLength(1);
    expect(level1.obstacles.length).toBeLessThanOrEqual(30);
    expect(level1.cliffs).toHaveLength(1);
    const barrier = level1.obstacles.find((o) => o.kind === 'stoneBarrier')!;
    expect(t.course.sampleAt(barrier.s).halfWidth).toBeLessThan(16);
    expect(t.course.sampleAt(level1.startS).halfWidth).toBeGreaterThan(26);
    // A clear line exists through the gate: >= 2 iceberg diameters between barrier and other rocks.
    const gateRocks = level1.obstacles.filter((o) => Math.abs(o.s - barrier.s) < 10 && o !== barrier);
    for (const r of gateRocks) {
      const gap = Math.abs(r.d - barrier.d) - placementFootprint(r) - placementFootprint(barrier);
      expect(gap).toBeGreaterThan(2 * 2.2 * 0.9);
    }
  });

  it('generates deterministic decor that keeps trees and bushes off the valley floor', () => {
    const a = generateDecor(t, level1.seed);
    const b = generateDecor(t, level1.seed);
    const c = generateDecor(t, level1.seed + 1);
    for (const key of ['trees', 'bushes', 'tufts', 'pebbles'] as const) {
      expect(a[key].count).toBe(b[key].count);
      expect(Array.from(a[key].positions)).toEqual(Array.from(b[key].positions));
      expect(Array.from(a[key].variant)).toEqual(Array.from(b[key].variant));
      expect(a[key].count).toBeLessThanOrEqual(DECOR_LIMITS[key]);
    }
    const head = (d: DecorBatch): number[] => Array.from(d.positions.slice(0, 30));
    expect(head(c.trees)).not.toEqual(head(a.trees));
    expect(a.trees.count).toBeGreaterThan(300);
    expect(a.bushes.count).toBeGreaterThan(200);
    expect(a.tufts.count).toBeGreaterThan(400);

    const proj: CourseProjection = { s: 0, sExt: 0, d: 0 };
    const offFloor = (batch: DecorBatch, clearance: number): void => {
      for (let i = 0; i < batch.count; i++) {
        const x = batch.positions[i * 3];
        const z = batch.positions[i * 3 + 2];
        t.course.projectInto(x, z, proj);
        if (proj.sExt < -clearance) continue;
        const hw = t.course.halfWidthAt(proj.s);
        const msg = `instance ${i} at s=${proj.s.toFixed(1)}`;
        expect(Math.abs(proj.d), msg).toBeGreaterThan(hw + clearance - 0.01);
        expect(t.isOcean(x, z)).toBe(false);
      }
    };
    offFloor(a.trees, DECOR_FLOOR_CLEARANCE.trees);
    offFloor(a.bushes, DECOR_FLOOR_CLEARANCE.bushes);
  });

  it('builds terrain chunks with exactly the heightGrid triangulation, facing up', () => {
    const chunks = buildTerrainChunks(t);
    const g = t.grid;
    let tris = 0;
    for (const c of chunks) {
      const pos = c.geometry.getAttribute('position');
      const nor = c.geometry.getAttribute('normal');
      const col = c.geometry.getAttribute('color');
      tris += pos.count / 3;
      for (let v = 0; v < pos.count; v += 97) {
        expect(nor.getY(v)).toBeGreaterThan(0);
        expect(Number.isFinite(col.getX(v)) && col.getX(v) >= 0 && col.getX(v) <= 1.5).toBe(true);
      }
      // A triangle's centroid lies on the shared sampled surface.
      for (let f = 0; f < pos.count; f += 3 * 131) {
        const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
        const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
        const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
        expect(cy).toBeCloseTo(sampleHeight(g, cx, cz), 3);
      }
      c.geometry.dispose();
    }
    expect(tris).toBe(2 * (g.cols - 1) * (g.rows - 1));
    expect(chunks.length).toBeGreaterThan(8);
  });

  it('builds a crack-free backdrop that starts at the terrain edge', () => {
    const geo = buildBackdropGeometry(t);
    const pos = geo.getAttribute('position');
    const g = t.grid;
    const maxX = g.originX + (g.cols - 1) * g.cellSize;
    let onEdge = 0;
    let tall = 0;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      expect(Number.isFinite(y)).toBe(true);
      if (Math.abs(x - maxX) < 1e-3 && z > g.originZ && z < g.originZ + (g.rows - 1) * g.cellSize) {
        expect(y).toBeCloseTo(t.heightAt(x, z), 3);
        onEdge++;
      }
      if (y > level1.seaLevel + 150) tall++;
    }
    expect(onEdge).toBeGreaterThan(g.rows);
    expect(tall).toBeGreaterThan(10);
    geo.dispose();
  });
});

describe('analytic / synthetic courses', () => {
  const straight = (over: Partial<LevelDef> = {}): LevelDef => ({
    id: 'straight',
    index: 99,
    name: 'Straight',
    subtitle: 'test',
    seed: 7,
    bounds: { minX: -120, maxX: 120, minZ: -60, maxZ: 560 },
    cellSize: 2,
    seaLevel: 0,
    course: [
      { x: 0, z: 0, floor: 60, halfWidth: 20 },
      { x: 0, z: 250, floor: 40, halfWidth: 20 },
      { x: 0, z: 500, floor: 16, halfWidth: 20 },
    ],
    cliffs: [{ s: 200, drop: 10 }],
    wallHeight: 20,
    wallRamp: 15,
    startS: 20,
    coastS: 420,
    finishS: 470,
    obstacles: [],
    decor: { sceneryTreeDensity: 2, bushDensity: 2, grassTuftDensity: 5, pebbleDensity: 2 },
    ...over,
  });

  it('matches the analytic convention on a straight course (s = z, d = -x)', () => {
    const t = createTerrain(straight());
    const ref = createAnalyticTerrain({ height: inclinedPlane(0.08), length: 500 });
    expect(t.course.length).toBeCloseTo(500, 3);
    for (const [x, z] of [
      [-5, 50],
      [7, 120],
      [0, 333],
    ]) {
      const p = t.course.project(x, z);
      const q = ref.course.project(x, z);
      expect(p.s).toBeCloseTo(q.s, 6);
      expect(p.d).toBeCloseTo(q.d, 6);
      const w = t.course.toWorld(p.s, p.d);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.z).toBeCloseTo(z, 6);
    }
  });

  it('puts a sharp cliff at the requested s and keeps the floor descending elsewhere', () => {
    const lv = straight();
    const t = createTerrain(lv);
    const drop = t.heightAt(0, 200 - lv.cellSize) - t.heightAt(0, 200 + lv.cellSize);
    expect(drop).toBeGreaterThan(10);
    expect(drop).toBeLessThan(11);
    for (let s = lv.startS; s + 4 <= lv.coastS; s += 4) {
      if (nearCliff(lv, s, s + 4, 2 * lv.cellSize)) continue;
      expect(t.heightAt(0, s) - t.heightAt(0, s + 4), `s=${s}`).toBeGreaterThanOrEqual(0.15);
    }
    expect(t.isOcean(0, lv.finishS)).toBe(true);
    expect(t.isOcean(0, lv.coastS - 20)).toBe(false);
  });

  it('keeps the full drop of a cliff inside the coast blend (the blend starts below its foot)', () => {
    // Before, the blend erased a cliff ~15 m from the coast and shaved 55 m out (30 m -> ~25 m).
    for (const cliff of [
      { s: 365, drop: 20 },
      { s: 390, drop: 20 },
      { s: 405, drop: 20 },
    ]) {
      const lv = straight({ cliffs: [cliff] });
      const t = createTerrain(lv);
      const floor = (s: number): number => t.course.sampleAt(s).floor;
      expect(floor(cliff.s - 0.5) - floor(cliff.s + 0.5), `s=${cliff.s}`).toBeGreaterThan(0.95 * cliff.drop);
      const c = lv.cellSize;
      const grid = t.heightAt(0, cliff.s - c) - t.heightAt(0, cliff.s + c);
      expect(grid, `s=${cliff.s}`).toBeGreaterThan(0.95 * cliff.drop);
      // Upstream of the cliff the floor is the designed one; the beach and the sea still follow.
      expect(floor(cliff.s - 2)).toBeGreaterThan(floor(cliff.s - 6) - 0.6);
      expect(t.isOcean(0, lv.finishS)).toBe(true);
      expect(t.isOcean(0, cliff.s + 3)).toBe(false);
    }
  });

  it('validates obstacle placements: start, sea, walls and cliff face', () => {
    const lv = straight({
      obstacles: [
        { kind: 'rockSmall', s: 100, d: 0 }, // 0: fine
        { kind: 'rockSmall', s: 30, d: 0 }, // 1: right after the spawn
        { kind: 'rockSmall', s: 460, d: 0 }, // 2: out at sea
        { kind: 'house', s: 120, d: 16 }, // 3: its 6 m footprint reaches the wall (hw 20)
        { kind: 'rockSmall', s: 201, d: 0 }, // 4: on the cliff face (lip at s 200)
        { kind: 'boulder', s: 250, d: -12 }, // 5: fine
      ],
    });
    const issues = validatePlacements(createTerrain(lv));
    const of = (index: number): string[] => issues.filter((i) => i.index === index).map((i) => i.problem);
    expect(of(0)).toEqual([]);
    expect(of(5)).toEqual([]);
    expect(of(1)).toEqual(['too close to the start']);
    expect(of(2)).toContain('beyond the coast / course');
    expect(of(2)).toContain('in or at the sea');
    expect(of(3).join()).toMatch(/outside the floor/);
    expect(of(4).join()).toMatch(/exclusion zone of the cliff/);
    for (const i of issues) {
      expect(i.kind).toBe(lv.obstacles[i.index].kind);
      expect(i.s).toBe(lv.obstacles[i.index].s);
    }
  });

  it('runs decor on the generic Terrain interface (analytic terrain) without leaving the rules', () => {
    const ref = createAnalyticTerrain({
      height: (x, z) => 100 - 0.08 * z + Math.max(0, Math.abs(x) - 20) * 0.5,
      length: 400,
      width: 160,
      cellSize: 2,
      level: {
        decor: {
          sceneryTreeDensity: 3,
          bushDensity: 3,
          grassTuftDensity: 5,
          pebbleDensity: 2,
        },
      },
    });
    const a = generateDecor(ref, 3);
    const b = generateDecor(ref, 3);
    expect(Array.from(a.trees.positions)).toEqual(Array.from(b.trees.positions));
    expect(a.trees.count).toBeGreaterThan(10);
    for (let i = 0; i < a.trees.count; i++) {
      // z < 0 is behind the course start (s = 0), which counts as off-floor.
      if (a.trees.positions[i * 3 + 2] < 0) continue;
      expect(Math.abs(a.trees.positions[i * 3])).toBeGreaterThan(20 + DECOR_FLOOR_CLEARANCE.trees - 0.01);
    }
  });

  it('creates scenery models with geometry', () => {
    const m = createSceneryModels();
    for (const g of Object.values(m)) {
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
      g.dispose();
    }
  });
});
