import { describe, expect, it } from 'vitest';
import { createTerrain, type GeneratedTerrain } from '../terrain/terrain';
import { rampLaunch } from '../terrain/features';
import type { CoursePoint, IcebergState, LevelDef, TerrainFeature } from '../types';
import { createIceberg, stepIceberg } from './iceberg';
import {
  alongLip,
  faceHeight,
  kickerFace,
  kickerTakeoff,
  type KickerFace,
  type KickerTakeoff,
} from './kicker';
import { DEFAULT_ICEBERG_PARAMS as P } from './params';

const level = (id: string, course: CoursePoint[], features: TerrainFeature[], cellSize = 2): LevelDef => ({
  id,
  index: 0,
  name: 'kicker test',
  subtitle: '',
  seed: 5,
  bounds: { minX: -100, maxX: 260, minZ: -50, maxZ: 450 },
  cellSize,
  seaLevel: 0,
  course,
  cliffs: [],
  wallHeight: 20,
  wallRamp: 20,
  startS: 10,
  coastS: 440,
  finishS: 445,
  obstacles: [],
  features,
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
});

/** Straight valley at `angle` rad from +Z falling 0.07, with the given features. */
function valley(features: TerrainFeature[], angle = 0, cellSize = 2): LevelDef {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  const course = [0, 150, 300, 450].map((s) => ({
    x: dx * s,
    z: dz * s,
    floor: 100 - 0.07 * s,
    halfWidth: 20,
  }));
  return level(`kicker-${angle}-${cellSize}`, course, features, cellSize);
}

type Ramp = Extract<TerrainFeature, { type: 'ramp' }>;
const ramp = (s: number, height = 3.5, length = 9): Ramp => ({
  type: 'ramp',
  s,
  d: 0,
  width: 9,
  length,
  height,
});

/** Puts the iceberg on the ground at course (s, d) moving `speed` along (forward, sideways). */
function place(t: GeneratedTerrain, s: number, d: number, forward: number, sideways = 0): IcebergState {
  const ice = createIceberg(t, P);
  const c = t.course;
  const w = c.toWorld(s, d);
  const cs = c.sampleAt(s);
  // Right of travel is (-dirZ, dirX).
  ice.pos.x = w.x;
  ice.pos.y = w.y;
  ice.pos.z = w.z;
  ice.vel.x = cs.dirX * forward - cs.dirZ * sideways;
  ice.vel.z = cs.dirZ * forward + cs.dirX * sideways;
  ice.heading = Math.atan2(ice.vel.x, ice.vel.z);
  return ice;
}

/** Approach the lip on the ramp's axis from 30 m out; take-off and first landing past the lip. */
function jump(t: GeneratedTerrain, lipS: number, speed: number) {
  const s = place(t, lipS - 30, 0, speed);
  const c = t.course;
  let takeoff = 0;
  let land = NaN;
  let top = -Infinity;
  for (let i = 0; i < 60 * 8 && !(land === land); i++) {
    for (const e of stepIceberg(s, { steer: 0, source: 'none' }, t, 1 / 60, P, 100 + i / 60)) {
      if (e.type === 'airborne' && takeoff === 0) takeoff = e.speed;
      if (e.type === 'landed' && takeoff > 0 && c.project(e.pos.x, e.pos.z).s > lipS + 1) {
        land = c.project(e.pos.x, e.pos.z).s - lipS;
      }
    }
    if (!s.grounded) top = Math.max(top, s.pos.y);
  }
  return { takeoff, land, top: top - c.sampleAt(lipS).floor };
}

/** Highest point above its start an iceberg reaches in `seconds` (no input). */
function rise(t: GeneratedTerrain, ice: IcebergState, seconds: number): number {
  const y0 = ice.pos.y;
  let top = y0;
  for (let i = 0; i < seconds * 60; i++) {
    stepIceberg(ice, { steer: 0, source: 'none' }, t, 1 / 60, P, 100 + i / 60);
    top = Math.max(top, ice.pos.y);
  }
  return top - y0;
}

describe('kicker lips (Terrain.kickers)', () => {
  it('carry the authored lip height and take-off slope wherever the lip falls on the grid', () => {
    for (const off of [0, 0.7, 1.3]) {
      const r = ramp(200 + off);
      const t = createTerrain(valley([r], 0.3));
      expect(t.kickers).toHaveLength(1);
      const k = t.kickers[0];
      const mid = Math.floor(k.height.length / 2);
      expect(k.height[mid] - t.course.sampleAt(r.s).floor).toBeCloseTo(r.height, 1);
      expect(k.slope[mid]).toBeCloseTo((2 * r.height) / r.length - 0.07, 2);
      // The face a cell diagonal + 0.5 m short of the lip (uphill of it):
      // 3.5·(1 − (1 − 3.33/9)²) − 0.07·3.33.
      expect(k.drop[mid]).toBeCloseTo(3.5 * (1 - (1 - (2 * Math.SQRT2 + 0.5) / 9) ** 2) - 0.07 * 3.33, 1);
      // The side edges taper down to the floor.
      expect(k.height[0]).toBeLessThan(k.height[mid] - 2);
    }
  });

  it('are read in the terrain’s own parameterisation on a bend (inside and outside of it)', () => {
    // A 90° right-hand bend of radius 60 m between s ≈ 100 and s ≈ 194.
    const R = 60;
    const pts: CoursePoint[] = [{ x: 0, z: 0, floor: 100, halfWidth: 20 }];
    for (let a = 0; a <= Math.PI / 2 + 1e-9; a += Math.PI / 16) {
      const s = 100 + R * a;
      pts.push({ x: -R + R * Math.cos(a), z: 100 + R * Math.sin(a), floor: 100 - 0.07 * s, halfWidth: 20 });
    }
    const sEnd = 100 + R * (Math.PI / 2) + 150;
    pts.push({ x: -R - 150, z: 100 + R, floor: 100 - 0.07 * sEnd, halfWidth: 20 });
    for (const d of [-8, 8]) {
      const r: Ramp = { type: 'ramp', s: 147.3, d, width: 6, length: 9, height: 3.5 };
      const t = createTerrain(level(`bend-${d}`, pts, [r]));
      const k = t.kickers[0];
      const mid = Math.floor(k.height.length / 2);
      // Lip = floor + bowl rise at |d| + height (no bumps on a ramp's middle).
      const bowl = 0.6 * (Math.abs(d) / 20) ** 2;
      expect(k.height[mid] - t.course.sampleAt(r.s).floor - bowl, `d=${d}`).toBeCloseTo(r.height, 1);
      // Rise per world metre: the face is (1 − κd) as long in the world as along the centreline.
      const a = t.course.toWorld(r.s - 1, d);
      const b = t.course.toWorld(r.s + 1, d);
      const perWorld = 2 / Math.hypot(b.x - a.x, b.z - a.z);
      const want = ((2 * r.height) / r.length - 0.07) * perWorld;
      expect(k.slope[mid] / want, `d=${d}`).toBeGreaterThan(0.97);
      expect(k.slope[mid] / want, `d=${d}`).toBeLessThan(1.03);
    }
  });
});

describe('kickerFace only rides a kicker face short of its lip, heading over it', () => {
  const t = createTerrain(valley([ramp(200)]));
  const k = t.kickers[0];
  const mid = Math.floor(k.height.length / 2);
  const lipY = k.height[mid];
  const face: KickerFace = { kicker: null, lipY: 0, slope: 0, curve: 0, cross: 0 };
  // Course along +Z: s = z, and right of travel (d > 0) is -x.
  const at = (s: number, d: number, y: number, vf: number, vs = 0): boolean =>
    kickerFace(t.kickers, -d, s, y, -vs, vf, face);

  it('rides the last metres of the face and takes off from the lip with its exact slope', () => {
    expect(at(199.5, 0, lipY - 0.3, 15)).toBe(true);
    // The exact face: 3.5·(1 − a/9)² on a floor falling 0.07 (a = metres short of the lip).
    const a = 2;
    const want = lipY - 3.5 * (1 - (1 - a / 9) ** 2) + 0.07 * a;
    expect(faceHeight(face, alongLip(k, 0, 200 - a))).toBeCloseTo(want, 2);
    const out: KickerTakeoff = { vy: 0, scale: 1 };
    expect(kickerTakeoff(face, lipY - 0.02, 0, 15, P.gravity, out)).toBe(true);
    expect(out.vy).toBeGreaterThan(15 * ((2 * 3.5) / 9 - 0.07) * 0.99);
    expect(out.vy).toBeLessThan(15 * ((2 * 3.5) / 9 - 0.07) * 1.03);
    expect(at(200 - k.before - 0.1, 0, lipY - 2, 15)).toBe(false); // farther back: the grid's face
  });

  it('never from past the lip: the back face, the floor or a gap edge beyond it', () => {
    expect(at(200.3, 0, lipY - 1, 15)).toBe(false);
    expect(at(200.8, 0, lipY - 3.5, 8)).toBe(false);
  });

  it('never from lower than the face can be', () => {
    expect(at(199, 0, lipY - k.drop[mid] - 1, 15)).toBe(false);
    expect(at(199, 0, lipY - k.drop[mid] + 0.1, 15)).toBe(true);
  });

  it('never running along the ramp or off its side edge, nor backwards or beside it', () => {
    expect(at(199.5, 2, lipY - 0.3, 3, 15)).toBe(false); // mostly sideways
    expect(at(199, 4, lipY - 0.3, 10, 7)).toBe(false); // meets the lip line outside the ramp
    expect(at(199, 3, lipY - 0.3, 10, 3)).toBe(true); // meets it inside
    expect(at(199.5, 0, lipY, -15)).toBe(false);
    expect(at(199.5, 8, lipY, 15)).toBe(false);
  });
});

describe('kicker take-offs in the integrator', () => {
  it('give no pop to an iceberg dropping off the floor past a lip into a gap', () => {
    // Lip on a grid row (cellSize 1); the floor vertex 1 m past it, then a gap from 1.5 m past it.
    const lip = 200;
    const t = createTerrain(
      valley([ramp(lip), { type: 'gap', s: lip + 1.5, length: 15, depth: 7, d: 0, width: 24 }], 0, 1),
    );
    // Before: popped 3.9 m up out of the gap edge.
    const ice = place(t, lip + 0.95, 0, 8);
    expect(rise(t, ice, 2)).toBeLessThan(0.3);
  });

  it('give no pop to an iceberg running sideways off a ramp’s side edge near the lip', () => {
    const t = createTerrain(valley([ramp(200.6)]));
    // 2 m/s over the lip, 12 m/s toward the side edge 2.5 m away; before: popped 0.7 m.
    for (const short of [0.3, 1]) {
      const ice = place(t, 200.6 - short, 2, 2, 12);
      expect(rise(t, ice, 1.5), `${short} m short of the lip`).toBeLessThan(0.3);
    }
  });
});

describe('kicker launches do not depend on where the lip falls on the grid', () => {
  // Measured before the kicker take-off (course along +Z, cellSize 2, same ramp): from 23 m/s the
  // jump fell from 66.7 m (lip on a grid row) to 52.8 m (lip 1.75 m past one), from 15 m/s from
  // 28.0 to 22.3 m.
  for (const angle of [0, 0.5]) {
    it(`sweeping the lip across a grid cell barely moves the landing (course at ${angle} rad)`, () => {
      const terrains: [number, GeneratedTerrain][] = [];
      for (let off = 0; off < 2.01; off += 0.25) {
        terrains.push([200 + off, createTerrain(valley([ramp(200 + off)], angle))]);
      }
      for (const speed of [10, 15, 23]) {
        const runs = terrains.map(([lipS, t]) => jump(t, lipS, speed));
        const lands = runs.map((r) => r.land);
        const tops = runs.map((r) => r.top);
        const spread = Math.max(...lands) - Math.min(...lands);
        const mean = lands.reduce((a, b) => a + b, 0) / lands.length;
        expect(spread, `from ${speed} m/s: ${lands.map((l) => l.toFixed(1)).join(' ')}`).toBeLessThan(
          Math.max(0.5, 0.02 * mean),
        );
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.3);
        // And the flight is the one rampLaunch() predicts for the take-off speed (the estimate has
        // no air drag, so the sim falls a little short).
        for (const r of runs) {
          const est = rampLaunch(ramp(0), r.takeoff, 0.07).distance;
          expect(r.land / est).toBeGreaterThan(0.92);
          expect(r.land / est).toBeLessThan(1.01);
        }
      }
    });

    it(`slow take-offs (5–9 m/s off a 1.2 m kicker) do not either (course at ${angle} rad)`, () => {
      // Before riding the exact face: spreads of 0.5–2.3 m over these 3.7–8.7 m hops, and some lip
      // positions gave no take-off at all (the iceberg slid off the grid's truncated lip).
      const terrains: [number, GeneratedTerrain][] = [];
      for (let off = 0; off < 2.01; off += 0.25) {
        terrains.push([200 + off, createTerrain(valley([ramp(200 + off, 1.2, 8)], angle))]);
      }
      for (const speed of [6, 7.5, 9]) {
        const runs = terrains.map(([lipS, t]) => jump(t, lipS, speed));
        const lands = runs.map((r) => r.land);
        expect(lands.every((l) => l === l), `from ${speed} m/s: every run takes off`).toBe(true);
        for (const r of runs) {
          expect(r.takeoff).toBeGreaterThan(5);
          expect(r.takeoff).toBeLessThan(9);
        }
        const spread = Math.max(...lands) - Math.min(...lands);
        expect(spread, `from ${speed} m/s: ${lands.map((l) => l.toFixed(2)).join(' ')}`).toBeLessThan(0.2);
      }
    });
  }
});
