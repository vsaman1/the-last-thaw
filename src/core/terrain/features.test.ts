import { describe, expect, it } from 'vitest';
import type { IcebergStepEvent, LevelDef, TerrainFeature } from '../types';
import { createIceberg, stepIceberg } from '../sim/iceberg';
import { DEFAULT_ICEBERG_PARAMS, SIM_TUNING } from '../sim/params';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { FEATURE_TUNING, featureContains, featureSpans, PAINT, rampLaunch } from './features';
import { timed } from '../testing/timing';

/**
 * Terrain features on a straight synthetic valley (s = z, d = -x; floor slope ≈ 0.087, half-width
 * 20 m). Each feature is compared against the same level without features.
 */

const level = (features: TerrainFeature[], over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'features',
  index: 99,
  name: 'Features',
  subtitle: 'test',
  seed: 7,
  bounds: { minX: -110, maxX: 110, minZ: -60, maxZ: 640 },
  cellSize: 2,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 70, halfWidth: 20 },
    { x: 0, z: 300, floor: 44, halfWidth: 20 },
    { x: 0, z: 600, floor: 16, halfWidth: 20 },
  ],
  cliffs: [],
  wallHeight: 20,
  wallRamp: 15,
  startS: 20,
  coastS: 540,
  finishS: 570,
  obstacles: [],
  decor: { sceneryTreeDensity: 2, bushDensity: 2, grassTuftDensity: 5, pebbleDensity: 2 },
  features,
  ...over,
});

const plain = createTerrain(level([]));
const y = (t: GeneratedTerrain, s: number, d: number): number => t.course.toWorld(s, d).y;
/** Height above the featureless terrain at the same course point. */
const rise = (t: GeneratedTerrain, s: number, d: number): number => y(t, s, d) - y(plain, s, d);
const slopeAt = (t: GeneratedTerrain, s: number, d: number): number => {
  const w = t.course.toWorld(s, d);
  const g = t.gradientAt(w.x, w.z);
  return Math.hypot(g.dx, g.dz);
};
const paintAt = (t: GeneratedTerrain, s: number, d: number): number => {
  const w = t.course.toWorld(s, d);
  return t.paintAt(w.x, w.z);
};
const surfaceAt = (t: GeneratedTerrain, s: number, d: number): string => {
  const w = t.course.toWorld(s, d);
  return t.surfaceAt(w.x, w.z);
};

/** Max |difference| to the featureless terrain over grid vertices outside [s0, s1]. */
function untouchedOutside(t: GeneratedTerrain, s0: number, s1: number): number {
  let worst = 0;
  const g = t.grid;
  for (let i = 0; i < g.heights.length; i++) {
    const z = g.originZ + Math.floor(i / g.cols) * g.cellSize;
    if (z >= s0 && z <= s1) continue;
    worst = Math.max(worst, Math.abs(g.heights[i] - plain.grid.heights[i]));
  }
  return worst;
}

const params = { ...DEFAULT_ICEBERG_PARAMS, meltPerMetre: 0, meltPerRadian: 0 };

interface Slide {
  events: { type: IcebergStepEvent['type']; s: number }[];
  track: { s: number; d: number; y: number; speed: number; grounded: boolean }[];
}

/** Slides an iceberg from (s, d) down-course at `speed` for `seconds` with a fixed steer. */
function slide(t: GeneratedTerrain, s: number, d: number, speed: number, seconds: number, steer = 0): Slide {
  const ice = createIceberg(t, params);
  const w = t.course.toWorld(s, d);
  const smp = t.course.sampleAt(s);
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = smp.dirX * speed;
  ice.vel.z = smp.dirZ * speed;
  const g = t.gradientAt(w.x, w.z);
  ice.vel.y = g.dx * ice.vel.x + g.dz * ice.vel.z;
  ice.heading = Math.atan2(smp.dirX, smp.dirZ);
  const out: Slide = { events: [], track: [] };
  for (let i = 0; i < seconds * 60; i++) {
    const evs = stepIceberg(ice, { steer, source: 'scripted' }, t, 1 / 60, params, 10 + i / 60);
    for (const e of evs) out.events.push({ type: e.type, s: t.course.project(e.pos.x, e.pos.z).s });
    const p = t.course.project(ice.pos.x, ice.pos.z);
    out.track.push({
      s: p.s,
      d: p.d,
      y: ice.pos.y,
      speed: Math.hypot(ice.vel.x, ice.vel.z),
      grounded: ice.grounded,
    });
  }
  return out;
}

describe('terrain features: hill', () => {
  const hill: TerrainFeature = { type: 'hill', s: 120, d: 2, radius: 16, height: 5 };
  const t = createTerrain(level([hill]));

  it('raises a smooth rounded mound of the requested height', () => {
    expect(rise(t, 120, 2)).toBeCloseTo(5, 0);
    // (1 - q²)² profile: 56 % of the height half-way out, in every direction.
    for (const [ds, dd] of [
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
    ]) {
      expect(rise(t, 120 + ds, 2 + dd)).toBeGreaterThan(0.56 * 5 - 0.35);
      expect(rise(t, 120 + ds, 2 + dd)).toBeLessThan(0.56 * 5 + 0.35);
    }
    expect(Math.abs(rise(t, 120, 2 + 17))).toBeLessThan(0.05);
  });

  it('stays driveable (no face steeper than ~0.65) and leaves the rest of the valley alone', () => {
    for (let s = 100; s <= 140; s += 0.5) {
      for (let d = -14; d <= 18; d += 0.5) expect(slopeAt(t, s, d), `s=${s} d=${d}`).toBeLessThan(0.65);
    }
    expect(untouchedOutside(t, 100, 140)).toBe(0);
  });

  it('turns back a slow iceberg but lets a fast one crest it', () => {
    const slow = slide(t, 96, 2, 5, 8);
    expect(Math.max(...slow.track.map((p) => p.s))).toBeLessThan(120);
    const fast = slide(t, 96, 2, 14, 5);
    expect(fast.track[fast.track.length - 1].s).toBeGreaterThan(140);
  });
});

describe('terrain features: basin', () => {
  const basin: TerrainFeature = { type: 'basin', s: 150, d: 0, radius: 12, depth: 5 };
  const t = createTerrain(level([basin]));

  it('sinks a bowl whose rim is well above its bottom in every direction (a trap)', () => {
    expect(rise(t, 150, 0)).toBeCloseTo(-5, 0);
    let bottom = Infinity;
    let bs = 0;
    let bd = 0;
    for (let s = 140; s <= 160; s += 0.5) {
      for (let d = -10; d <= 10; d += 0.5) {
        if (y(t, s, d) < bottom) [bottom, bs, bd] = [y(t, s, d), s, d];
      }
    }
    // To leave, the iceberg must climb at least 3 m whichever way it goes (slope 0.087 × 12 m ≈ 1 m
    // of the 5 m depth is lost on the downstream side).
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      let top = -Infinity;
      for (let r = 0; r <= 13; r += 0.5) {
        top = Math.max(top, y(t, bs + r * Math.cos(th), bd + r * Math.sin(th)));
      }
      expect(top - bottom, `direction ${a}`).toBeGreaterThan(3);
    }
    expect(untouchedOutside(t, 137, 163)).toBe(0);
  });

  it('holds a slow iceberg, while a fast one rides straight through', () => {
    const slow = slide(t, 147, 0, 3, 8);
    const end = slow.track[slow.track.length - 1];
    expect(Math.hypot(end.s - 150, end.d)).toBeLessThan(9);
    const fast = slide(t, 130, 0, 16, 3);
    expect(fast.track[fast.track.length - 1].s).toBeGreaterThan(170);
  });
});

describe('terrain features: ramp', () => {
  const ramp: TerrainFeature = { type: 'ramp', s: 180, d: 0, width: 10, length: 16, height: 3 };
  const t = createTerrain(level([ramp]));
  const lipSlope = (2 * ramp.height) / ramp.length;

  it('rises steadily to a crisp lip, then drops straight back to the floor', () => {
    const c = t.grid.cellSize;
    let prev = -Infinity;
    let peak = -Infinity;
    let peakS = 0;
    for (let s = 164; s <= 190; s += 0.25) {
      const r = rise(t, s, 0);
      if (s < 180 - c * Math.SQRT2) {
        expect(r, `s=${s}`).toBeGreaterThanOrEqual(prev - 0.02);
        prev = r;
      }
      if (r > peak) [peak, peakS] = [r, s];
    }
    // The grid can only lose what the face rises in one cell diagonal before the lip.
    expect(peak).toBeGreaterThan(ramp.height - lipSlope * c * Math.SQRT2 - 0.05);
    expect(peak).toBeLessThan(ramp.height + 0.05);
    expect(peakS).toBeGreaterThan(180 - c * Math.SQRT2 - 0.01);
    expect(peakS).toBeLessThanOrEqual(180.5);
    // Back face: within one cell diagonal + the back-face run, the floor is reached again.
    expect(rise(t, peakS + c * Math.SQRT2 + 0.8, 0)).toBeLessThan(0.3);
    // No rounding at the top: the face just below the peak is still steep.
    const face = (rise(t, peakS - 0.25, 0) - rise(t, peakS - 1.75, 0)) / 1.5;
    expect(face).toBeGreaterThan(0.6 * lipSlope);
    expect(paintAt(t, 176, 0)).toBe(PAINT.dirt);
  });

  it('has crisp sides and leaves the floor beside and beyond it untouched', () => {
    // t² profile: from s = 172 (half-way up the face) the kicker is at least height / 4 high.
    for (const s of [172, 176, 179]) {
      expect(rise(t, s, 5 + 1.6)).toBeLessThan(0.3);
      expect(rise(t, s, -5 - 1.6)).toBeLessThan(0.3);
      expect(rise(t, s, 0)).toBeGreaterThan(0.5);
    }
    // Beyond its apron (FEATURE_TUNING.rampClear around the footprint, where the floor bumps fade
    // out toward it) nothing changes; in the apron only the bumps go.
    const clear = FEATURE_TUNING.rampClear;
    expect(untouchedOutside(t, 162 - clear, 184 + clear)).toBe(0);
    for (const s of [150, 160, 190]) {
      for (const d of [-12, -7, 7, 12]) expect(Math.abs(rise(t, s, d))).toBeLessThan(0.25);
    }
  });

  it('launches an iceberg into a real jump (the same line without the ramp stays grounded)', () => {
    const run = slide(t, 150, 0, 16, 4);
    const air = run.events.find((e) => e.type === 'airborne');
    const land = run.events.find((e) => e.type === 'landed');
    expect(air).toBeDefined();
    expect(air!.s).toBeGreaterThan(180 - 3);
    expect(air!.s).toBeLessThan(181.5);
    expect(land).toBeDefined();
    expect(land!.s - 180).toBeGreaterThan(12);
    const est = rampLaunch(ramp, 15, 0.087);
    expect(est.distance).toBeGreaterThan(14);
    expect(est.distance).toBeLessThan(30);
    const none = slide(plain, 150, 0, 16, 4);
    expect(none.events.filter((e) => e.type === 'airborne')).toEqual([]);
  });
});

describe('terrain features: gap', () => {
  const gap: TerrainFeature = { type: 'gap', s: 260, length: 14, depth: 8 };
  const t = createTerrain(level([gap]));

  it('cuts a ravine across the whole floor with steep walls', () => {
    // A wall can only be as sharp as the grid: full depth from one cell inside each edge.
    const c = t.grid.cellSize;
    for (let s = 260 + c; s <= 274 - c; s += 1) {
      for (const d of [-18, -10, 0, 10, 18]) expect(rise(t, s, d), `s=${s} d=${d}`).toBeLessThan(-7.3);
    }
    // Walls far steeper than the iceberg can climb, on both sides.
    let steepNear = 0;
    let steepFar = 0;
    for (let d = -16; d <= 16; d += 2) {
      for (let s = 258; s <= 262; s += 0.25) steepNear = Math.max(steepNear, slopeAt(t, s, d));
      for (let s = 272; s <= 276; s += 0.25) steepFar = Math.max(steepFar, slopeAt(t, s, d));
    }
    expect(steepNear).toBeGreaterThan(SIM_TUNING.wallSlope * 1.3);
    expect(steepFar).toBeGreaterThan(SIM_TUNING.wallSlope * 1.3);
    expect(untouchedOutside(t, 257, 277)).toBe(0);
    expect(surfaceAt(t, 267, 0)).toBe('rock');
  });

  it('traps an iceberg that is too slow to clear it', () => {
    const run = slide(t, 248, 0, 9, 10);
    const end = run.track[run.track.length - 1];
    expect(Math.max(...run.track.map((p) => p.s))).toBeLessThan(276);
    expect(end.s).toBeGreaterThan(259);
    expect(end.y).toBeLessThan(y(plain, end.s, end.d) - 6);
    expect(end.speed).toBeLessThan(1.5);
  });

  it('is cleared from a ramp whose lip sits on the near edge', () => {
    const ramp: TerrainFeature = { type: 'ramp', s: 260, d: 0, width: 12, length: 16, height: 3 };
    const jump = createTerrain(level([ramp, gap]));
    const run = slide(jump, 225, 0, 17, 5);
    const land = run.events.find((e) => e.type === 'landed');
    expect(land).toBeDefined();
    expect(land!.s).toBeGreaterThan(274 + 2);
    expect(run.track[run.track.length - 1].s).toBeGreaterThan(300);
  });

  it('cuts only its own part of the floor when given a width', () => {
    const part = createTerrain(level([{ type: 'gap', s: 260, length: 10, depth: 6, d: 8, width: 12 }]));
    expect(rise(part, 265, 8)).toBeLessThan(-5.5);
    expect(rise(part, 265, 14 - part.grid.cellSize)).toBeLessThan(-5.5);
    expect(Math.abs(rise(part, 265, -6))).toBeLessThan(0.05);
    expect(Math.abs(rise(part, 265, 1))).toBeLessThan(0.05);
  });
});

describe('terrain features: island', () => {
  const island: TerrainFeature = { type: 'island', s0: 300, s1: 360, d: 0, width: 10, height: 7 };
  const t = createTerrain(level([island]));

  it('splits the floor into two clear channels with a rocky ridge between them', () => {
    for (const s of [315, 330, 345]) {
      expect(rise(t, s, 0), `s=${s}`).toBeGreaterThan(0.8 * island.height);
      // Each channel: from just outside the island to the floor edge, low and clear (>= 8 m wide).
      for (const side of [-1, 1]) {
        let clear = 0;
        for (let d = 6.5; d < 20; d += 0.5) if (rise(t, s, side * d) < 0.3) clear += 0.5;
        expect(clear, `s=${s} side=${side}`).toBeGreaterThanOrEqual(8);
      }
    }
    expect(surfaceAt(t, 330, 0)).toBe('rock');
    expect(surfaceAt(t, 330, 12)).toBe('grass');
    expect(paintAt(t, 330, 1)).toBe(PAINT.rock);
  });

  it('has flanks the iceberg cannot climb and rounded, narrower noses', () => {
    let steep = 0;
    for (let d = 3; d <= 7; d += 0.25) steep = Math.max(steep, slopeAt(t, 330, d));
    expect(steep).toBeGreaterThan(SIM_TUNING.wallSlope * 1.3);
    const widthAt = (s: number): number => {
      let w = 0;
      for (let d = -8; d <= 8; d += 0.25) if (rise(t, s, d) > 2) w += 0.25;
      return w;
    };
    expect(widthAt(302)).toBeLessThan(widthAt(330) * 0.75);
    expect(widthAt(330)).toBeGreaterThan(8);
    expect(untouchedOutside(t, 297, 363)).toBe(0);
  });

  it('deflects an iceberg driven into it; a channel line passes', () => {
    const into = slide(t, 285, 0, 15, 4);
    for (const p of into.track) {
      if (p.s > 300 && p.s < 360) expect(p.y - y(plain, p.s, p.d)).toBeLessThan(2.5);
    }
    const channel = slide(t, 285, -11, 15, 6);
    expect(channel.track[channel.track.length - 1].s).toBeGreaterThan(370);
  });
});

describe('terrain features: plateau', () => {
  const plateau: TerrainFeature = { type: 'plateau', s0: 380, s1: 450, d: -6, width: 18, height: 3 };
  const t = createTerrain(level([plateau]));

  it('is a raised shelf, flat across, that follows the valley descent', () => {
    for (const s of [405, 415, 425]) {
      const hs: number[] = [];
      for (let d = -9; d <= -3; d += 0.5) hs.push(y(t, s, d));
      expect(Math.max(...hs) - Math.min(...hs), `s=${s}`).toBeLessThan(0.12);
      expect(rise(t, s, -6)).toBeGreaterThan(2.6);
      expect(rise(t, s, -6)).toBeLessThan(3.4);
    }
    // The top keeps descending with the floor.
    expect(y(t, 405, -6) - y(t, 425, -6)).toBeGreaterThan(20 * 0.07);
  });

  it('is driveable over its end ramps, with steeper side edges', () => {
    let ramp = 0;
    for (let s = 376; s <= 404; s += 0.5) ramp = Math.max(ramp, (y(t, s + 0.5, -6) - y(t, s, -6)) / 0.5);
    expect(ramp).toBeLessThan(0.4);
    let edge = 0;
    for (let d = -6 + 4; d <= -6 + 11; d += 0.25) edge = Math.max(edge, slopeAt(t, 415, d));
    expect(edge).toBeGreaterThan(0.5);
    // Up the end ramp (losing ~1.5 m/s), across, and down the far ramp with the speed back.
    const run = slide(t, 362, -6, 14, 8);
    const end = run.track[run.track.length - 1];
    expect(end.s).toBeGreaterThan(470);
    expect(end.speed).toBeGreaterThan(14);
    expect(untouchedOutside(t, 360, 470)).toBe(0);
  });
});

describe('terrain features: road', () => {
  const road: TerrainFeature = { type: 'road', s0: 100, s1: 220, d: 10, width: 6 };

  it('is levelled flat across and smooth along, and painted as road', () => {
    const t = createTerrain(level([road]));
    let prev = NaN;
    for (let s = 104; s <= 216; s += 2) {
      const hs: number[] = [];
      for (let d = 7.5; d <= 12.5; d += 0.5) hs.push(y(t, s, d));
      expect(Math.max(...hs) - Math.min(...hs), `s=${s}`).toBeLessThan(0.06);
      const h = y(t, s, 10);
      if (!Number.isNaN(prev)) expect(Math.abs(prev - h - 2 * 0.087)).toBeLessThan(0.08);
      prev = h;
      expect(paintAt(t, s, 10)).toBe(PAINT.gravel);
    }
    expect(paintAt(t, 160, -5)).toBe(PAINT.none);
    expect(untouchedOutside(t, 88, 232)).toBe(0);
  });

  it('is asphalt in town (theme default) unless the road says otherwise', () => {
    const town = createTerrain(level([road], { theme: 'town' }));
    expect(paintAt(town, 160, 10)).toBe(PAINT.asphalt);
    expect(surfaceAt(town, 160, 10)).toBe('rock');
    const gravel = createTerrain(level([{ ...road, surface: 'gravel' }], { theme: 'town' }));
    expect(paintAt(gravel, 160, 10)).toBe(PAINT.gravel);
  });

  it('cuts a level terrace into the valley wall', () => {
    const terrace: TerrainFeature = { type: 'road', s0: 120, s1: 220, d: -27, width: 5 };
    const t = createTerrain(level([terrace]));
    for (let s = 130; s <= 210; s += 10) {
      const hs: number[] = [];
      for (let d = -29; d <= -25; d += 0.5) hs.push(y(t, s, d));
      expect(Math.max(...hs) - Math.min(...hs), `s=${s}`).toBeLessThan(0.06);
      // It sits well up the wall, not down on the floor.
      expect(y(t, s, -27) - y(t, s, 0)).toBeGreaterThan(3);
    }
  });
});

describe('terrain features: composition and bookkeeping', () => {
  it('composes with a cliff: a ramp on the lip still launches over a full drop', () => {
    const lv = level([{ type: 'ramp', s: 200, d: 0, width: 12, length: 14, height: 2.5 }], {
      cliffs: [{ s: 200, drop: 10 }],
    });
    const t = createTerrain(lv);
    const cliffOnly = createTerrain({ ...lv, features: [] });
    const c = t.grid.cellSize;
    expect(y(t, 200 - c * 2, 0) - y(t, 200 + c * 2, 0)).toBeGreaterThan(10 + 1.5);
    expect(Math.abs(y(t, 230, 0) - y(cliffOnly, 230, 0))).toBeLessThan(1e-9);
    const run = slide(t, 170, 0, 15, 4);
    expect(run.events.find((e) => e.type === 'airborne')!.s).toBeLessThan(201.5);
  });

  it('keeps the coast, the ocean finish and the featureless guarantees', () => {
    const feats: TerrainFeature[] = [
      { type: 'hill', s: 120, d: 0, radius: 12, height: 3 },
      { type: 'island', s0: 300, s1: 340, d: 0, width: 8, height: 7 },
      { type: 'road', s0: 380, s1: 430, d: 8, width: 6 },
    ];
    const lv = level(feats);
    const t = createTerrain(lv);
    expect(t.isOcean(t.finishPos.x, t.finishPos.z)).toBe(true);
    expect(t.isOcean(t.coastPos.x, t.coastPos.z)).toBe(false);
    const spans = featureSpans(lv, 2 * lv.cellSize);
    expect(spans.length).toBe(3);
    const near = (a: number, b: number): boolean => spans.some((sp) => b >= sp.s0 && a <= sp.s1);
    let checked = 0;
    for (let s = lv.startS; s + 4 <= 460; s += 4) {
      if (near(s, s + 4)) continue;
      expect(y(t, s, 0) - y(t, s + 4, 0), `s=${s}`).toBeGreaterThanOrEqual(0.15);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
    // The course floor (river line reference) ignores features.
    expect(t.course.floorAt(120)).toBeCloseTo(plain.course.floorAt(120), 9);
  });

  it('is deterministic and reports gaps and features at world points', () => {
    const feats: TerrainFeature[] = [
      { type: 'gap', s: 260, length: 12, depth: 7 },
      { type: 'island', s0: 300, s1: 340, d: 0, width: 8, height: 7 },
    ];
    const a = createTerrain(level(feats));
    const b = createTerrain(level(feats));
    expect(Array.from(a.grid.heights)).toEqual(Array.from(b.grid.heights));
    expect(Array.from(a.paint)).toEqual(Array.from(b.paint));
    expect(a.gapInfo).toHaveLength(1);
    const g = a.gapInfo[0];
    expect(g.s0).toBe(260);
    expect(g.s1).toBe(272);
    expect(g.lip.y - g.bottomY).toBeGreaterThan(6.5);
    expect(g.far.z).toBeCloseTo(272, 6);
    const w = a.course.toWorld(266, 3);
    expect(a.featureIndexAt(w.x, w.z)).toBe(0);
    const i = a.course.toWorld(320, 0);
    expect(a.featureIndexAt(i.x, i.z)).toBe(1);
    const none = a.course.toWorld(200, 0);
    expect(a.featureIndexAt(none.x, none.z)).toBe(-1);
    expect(featureContains(feats[1], 320, 3.5, 20)).toBe(true);
    expect(featureContains(feats[1], 320, 5.5, 20)).toBe(false);
  });

  it('builds a 1 km featured level in well under 1.5 s', () => {
    const feats: TerrainFeature[] = [];
    for (let k = 0; k < 6; k++) {
      const s = 120 + k * 140;
      feats.push({ type: 'hill', s, d: 8, radius: 14, height: 3 });
      feats.push({ type: 'island', s0: s + 20, s1: s + 60, d: -2, width: 8, height: 7 });
      feats.push({ type: 'road', s0: s + 70, s1: s + 110, d: 12, width: 5 });
    }
    feats.push({ type: 'ramp', s: 990, d: 0, width: 12, length: 16, height: 3 });
    feats.push({ type: 'gap', s: 990, length: 12, depth: 8 });
    const lv = level(feats, {
      bounds: { minX: -300, maxX: 300, minZ: -120, maxZ: 1250 },
      course: [
        { x: 0, z: 0, floor: 150, halfWidth: 28 },
        { x: 40, z: 300, floor: 115, halfWidth: 22 },
        { x: -30, z: 650, floor: 70, halfWidth: 30 },
        { x: 10, z: 1000, floor: 20, halfWidth: 40 },
        { x: 0, z: 1200, floor: 0, halfWidth: 60 },
      ],
      cellSize: 2,
      coastS: 1080,
      finishS: 1100,
    });
    // Best of up to three builds: parallel test workers can stall any single one.
    let ms = Infinity;
    let t: GeneratedTerrain | null = null;
    for (let k = 0; k < 3 && ms >= 1500; k++) {
      const r = timed(() => createTerrain(lv));
      t = r.result;
      ms = Math.min(ms, r.ms);
    }
    expect(t!.course.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1500);
  });
});
