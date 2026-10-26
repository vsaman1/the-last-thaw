import { describe, expect, it } from 'vitest';
import type { RiverSample, Terrain } from '../types';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import { RiverTrail } from './trail';
import { RIVER_CROSS_VERTS, buildRiverChunk, createRiverChunkGeometry } from './geometry';
import {
  ChunkMirror,
  buildAllChunks,
  distanceToPolyline,
  drive,
  fallClearance,
  fallRuns,
  gapIndices,
  hop,
  nearFallLip,
  probeSurface,
  trianglesAcross,
  waterFlight,
  type PathFn,
} from './testkit';

/*
 * River jumps: when the iceberg flies over a ravine the river pours into it and restarts at the
 * landing (RiverSample.gapBefore). Analytic terrains along +z (course s = z), 1 m grid so walls
 * are sheer.
 */

const CROSS = RIVER_CROSS_VERTS;
const LAND_OFFSET = 0.15;
const SLOPE = 0.08;
/** Kicker ramp: rises over [KICK0, LIP] to a sharp lip, then a 1 m back face. */
const KICK0 = 80;
const LIP = 100;
/** Sheer-walled trench: near wall [RIM, FLOOR0], floor, far wall [FAR0, FAR1]. */
const RIM = 110;
const FLOOR0 = 111;
const FAR0 = 120;
const FAR1 = 121;
const DEPTH = 12;
/** Landing on the far side when the gap is cleared. */
const LAND = 128;

const kicker = (z: number, h: number): number => {
  if (z > KICK0 && z <= LIP) return (h * (z - KICK0)) / (LIP - KICK0);
  if (z > LIP && z < LIP + 1) return h * (LIP + 1 - z);
  return 0;
};
const trench = (z: number): number => {
  if (z <= RIM || z >= FAR1) return 0;
  return -DEPTH * (z < FLOOR0 ? z - RIM : z > FAR0 ? FAR1 - z : 1);
};

const rampGap = createAnalyticTerrain({
  height: (_x, z) => 60 - SLOPE * z + kicker(z, 2.5) + trench(z),
  length: 260,
  width: 80,
  cellSize: 1,
});
const plainGap = createAnalyticTerrain({
  height: (_x, z) => 60 - SLOPE * z + trench(z),
  length: 260,
  width: 80,
  cellSize: 1,
});

const straight: PathFn = (d) => ({ x: 0, z: d });
const seg3 = (a: RiverSample, b: RiverSample): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const ground = (t: Terrain, p: RiverSample): number => t.heightAt(p.x, p.z) + LAND_OFFSET;

/** Drive `path` at 20 m/s, airborne while takeoff < d < land. */
function jump(
  terrain: Terrain,
  takeoff: number,
  land: number,
  o: { path?: PathFn; from?: number; to?: number; trail?: RiverTrail } = {},
): RiverTrail {
  const trail = o.trail ?? new RiverTrail();
  drive(trail, terrain, o.path ?? straight, {
    speed: 20,
    from: o.from ?? 10,
    to: o.to ?? 240,
    state: (d, ice) => {
      if (d > takeoff && d < land) ice.grounded = false;
    },
  });
  return trail;
}

function expectOnGround(terrain: Terrain, s: readonly RiverSample[]): void {
  for (let i = 0; i < s.length; i++) {
    if (s[i].kind !== 'flow') continue;
    expect(s[i].y, `sample ${i} at z ${s[i].z.toFixed(2)}`).toBeCloseTo(ground(terrain, s[i]), 4);
  }
}

describe('jumping a ravine', () => {
  it('pours into the ravine and restarts at the landing (ramp + gap)', () => {
    const s = jump(rampGap, LIP, LAND).samples;
    const gaps = gapIndices(s);
    expect(gaps).toHaveLength(1);
    const gi = gaps[0];
    const landing = s[gi];
    const before = s[gi - 1];
    expect(Math.abs(landing.z - LAND)).toBeLessThan(0.5);
    expect(landing.kind).toBe('flow');
    // the river before the gap ends on the trench floor, short of the far wall
    expect(before.z).toBeGreaterThan(FLOOR0);
    expect(before.z).toBeLessThan(FAR0 - 1);
    expect(landing.y - before.y).toBeGreaterThan(DEPTH - 2);
    // nothing climbs the far wall or crosses the gap
    for (const p of s) expect(p.z <= before.z + 1e-9 || p.z >= landing.z - 1e-9).toBe(true);

    // one pour: from the trench rim down the near wall onto the floor (no fall off the kicker)
    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    expect(Math.abs(s[lip].z - RIM)).toBeLessThan(1.3);
    expect(s[lip].kind).toBe('flow');
    expect(s[base].kind).toBe('flow');
    expect(s[base].z).toBeGreaterThanOrEqual(FLOOR0 - 0.01);
    expect(base).toBeLessThan(gi);
    expect(s[lip].y - s[base].y).toBeGreaterThan(DEPTH - 1);
    expect(last - first + 1).toBeGreaterThanOrEqual(8);
    for (let i = lip + 1; i <= base; i++) expect(s[i].y).toBeLessThanOrEqual(s[i - 1].y + 1e-9);

    expectOnGround(rampGap, s);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
      if (i !== gi) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    }
    expect(s.length - gi).toBeGreaterThan(40);
  });

  it('a jump that does not clear the ravine (lands in the trench) is one waterfall along the flight', () => {
    // 8.5 m/s off the kicker, kicked up at 3.5 m/s: over the rim, down onto the trench floor.
    const trail = new RiverTrail();
    const { state, flight } = hop(rampGap, straight, 8.5, LIP, 3.5);
    drive(trail, rampGap, straight, { speed: 8.5, from: 10, to: 119.5, state });
    const s = trail.samples;
    const land = flight.landing ?? { x: NaN, y: NaN, z: NaN };
    expect(land.z).toBeGreaterThan(FLOOR0);
    expect(land.z).toBeLessThan(FAR0);
    expect(gapIndices(s)).toHaveLength(0);
    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    // from the kicker's lip (where it took off), not from the trench rim; lifted a few cm where
    // it passes close over the rim
    expect(Math.abs(s[lip].z - LIP)).toBeLessThan(0.5);
    const water = waterFlight(flight);
    for (let i = first; i <= last; i++) {
      expect(distanceToPolyline(s[i], water), `sample ${i}`).toBeLessThan(0.1);
    }
    expect(s[lip].y - s[base].y).toBeGreaterThan(DEPTH - 1);
    expect(s[base].y).toBeCloseTo(ground(rampGap, s[base]), 4);
    for (let i = 1; i < s.length; i++) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    const fc = fallClearance(buildAllChunks(s, rampGap), rampGap);
    expect(fc.minVertical).toBeGreaterThan(0.149);
    expect(fc.trianglesLow, `lowest ${fc.minTriangle.toFixed(2)} m`).toBe(0);
  });

  it('a ravine whose far side is clearly lower: a waterfall along the flight onto the far side', () => {
    // As plainGap, but the far side is 8 m lower than the near one: the water does not pour into
    // the ravine, it follows the iceberg over it (no gap in the river).
    const lowFar = createAnalyticTerrain({
      height: (_x, z) => 60 - SLOPE * z + (z > FAR0 ? -8 * Math.min(1, z - FAR0) : 0) + trench(z),
      length: 260,
      width: 80,
      cellSize: 1,
    });
    const trail = new RiverTrail();
    const { state, flight } = hop(lowFar, straight, 20, RIM, -SLOPE * 20);
    drive(trail, lowFar, straight, { speed: 20, from: 10, to: 200, state });
    const s = trail.samples;
    const land = flight.landing ?? { x: NaN, y: NaN, z: NaN };
    expect(land.z).toBeGreaterThan(FAR1 + 5);
    expect(gapIndices(s)).toHaveLength(0);
    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    expect(Math.abs(s[lip].z - RIM)).toBeLessThan(0.5);
    const water = waterFlight(flight);
    for (let i = first; i <= last; i++) {
      expect(distanceToPolyline(s[i], water), `sample ${i}`).toBeLessThan(0.05);
    }
    expect(Math.abs(s[base].z - land.z)).toBeLessThan(0.3);
    for (let i = 1; i < s.length; i++) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    const fc = fallClearance(buildAllChunks(s, lowFar), lowFar);
    expect(fc.minVertical).toBeGreaterThan(0.149);
    expect(fc.trianglesLow, `lowest ${fc.minTriangle.toFixed(2)} m`).toBe(0);
  });

  it('flowAt is dry across the gap and wet on either side of it', () => {
    const trail = jump(rampGap, LIP, LAND);
    const s = trail.samples;
    const gi = gapIndices(s)[0];
    const end = s[gi - 1];
    const pool = trail.flowAt(0, end.z - 1.5);
    expect(pool).not.toBeNull();
    if (pool) expect(pool.surfaceY).toBeLessThan(end.y + 0.5);
    for (const z of [end.z + 0.4, FAR0 + 0.5, FAR1 + 1, 124, LAND - 0.4]) {
      expect(trail.flowAt(0, z), `z ${z}`).toBeNull();
    }
    const after = trail.flowAt(0, LAND + 3);
    expect(after).not.toBeNull();
    if (after) expect(after.vz).toBeGreaterThan(0);
  });

  it.each([0, 35])('a %i° crossing: nothing bridges the gap and nothing is buried or floating', (deg) => {
    const a = (deg * Math.PI) / 180;
    const D0 = 150;
    const path: PathFn = (d) => ({ x: Math.sin(a) * (d - D0), z: RIM + Math.cos(a) * (d - D0) });
    const cz = Math.cos(a);
    const takeoff = D0 - 0.2 / cz;
    const land = D0 + (LAND - RIM) / cz;
    const s = jump(plainGap, takeoff, land, { path, from: D0 - 60 / cz, to: D0 + 80 / cz }).samples;
    const gaps = gapIndices(s);
    expect(gaps).toHaveLength(1);
    expect(fallRuns(s)).toHaveLength(1);
    const chunks = buildAllChunks(s, plainGap);
    expect(trianglesAcross(chunks, gaps)).toBe(0);
    const rep = probeSurface(chunks, plainGap, nearFallLip(s, 4));
    expect(rep.fallInRock, `deepest fall vertex ${rep.maxFallDepth.toFixed(2)} m`).toBe(0);
    expect(rep.maxBury, `at sample ${rep.maxBuryAt}`).toBeLessThan(0.1);
    expect(rep.floatOver1, `max float ${rep.maxFloat.toFixed(2)} at ${rep.maxFloatAt}`).toBe(0);
  });
});

describe('river geometry across a gap', () => {
  const trail = jump(rampGap, LIP, LAND);
  const s = trail.samples;
  const gi = gapIndices(s)[0];

  it('draws no quads across the gap (degenerate indices) and keeps everything out of the rock', () => {
    const chunks = buildAllChunks(s, rampGap);
    expect(trianglesAcross(chunks, [gi])).toBe(0);
    const g = buildRiverChunk(s, gi - 10, gi + 10, rampGap);
    expect(Array.from(g.segmentGap.subarray(0, g.crossSections - 1))).toEqual(
      Array.from({ length: 20 }, (_, c) => (c === 9 ? 1 : 0)),
    );
    const rep = probeSurface(chunks, rampGap, nearFallLip(s, 4));
    expect(rep.fallInRock).toBe(0);
    expect(rep.maxBury).toBeLessThan(0.1);
    expect(rep.floatOver1).toBe(0);
  });

  it('chunk seams at and around the gap are bit-identical', () => {
    for (let m = gi - 2; m <= gi + 1; m++) {
      const a = buildRiverChunk(s, m - 20, m, rampGap);
      const b = buildRiverChunk(s, m, m + 20, rampGap);
      const whole = buildRiverChunk(s, m - 20, m + 20, rampGap);
      const last = 20 * CROSS;
      for (let k = 0; k < CROSS * 3; k++) {
        expect(a.position[last * 3 + k]).toBe(b.position[k]);
        expect(a.normal[last * 3 + k]).toBe(b.normal[k]);
        expect(whole.position[last * 3 + k]).toBe(b.position[k]);
        expect(whole.normal[last * 3 + k]).toBe(b.normal[k]);
      }
    }
  });

  it('incremental chunk rebuilds while recording equal a full rebuild, indices included', () => {
    for (const segments of [8, 16, 128]) {
      const live = new RiverTrail();
      const mirror = new ChunkMirror(segments);
      drive(live, rampGap, straight, {
        speed: 20,
        from: 10,
        to: 200,
        state: (d, ice) => {
          if (d > LIP && d < LAND) ice.grounded = false;
          mirror.update(live, rampGap);
        },
      });
      mirror.update(live, rampGap);
      const ls = live.samples;
      expect(gapIndices(ls)).toEqual([gi]);
      const keys = [
        'position',
        'normal',
        'uv',
        'lateral',
        'flowSpeed',
        'turbulence',
        'fall',
        'birth',
      ] as const;
      for (let k = 0; k < mirror.chunks.length; k++) {
        const inc = mirror.chunks[k].geo;
        const full = buildRiverChunk(ls, inc.start, inc.end, rampGap, createRiverChunkGeometry(segments + 1));
        for (const key of keys) {
          const per = full[key].length / full.maxCrossSections / CROSS;
          const n = full.vertexCount * per;
          expect(Array.from(inc[key].subarray(0, n)), `${key} of chunk ${k}/${segments}`).toEqual(
            Array.from(full[key].subarray(0, n)),
          );
        }
        expect(Array.from(inc.index.subarray(0, inc.indexCount))).toEqual(
          Array.from(full.index.subarray(0, full.indexCount)),
        );
      }
    }
  });

  it('a reused chunk restores the quads of a former gap and bumps indexVersion', () => {
    const geo = createRiverChunkGeometry(65);
    buildRiverChunk(s, gi - 30, gi + 30, rampGap, geo);
    expect(geo.segmentGap[29]).toBe(1);
    const v = geo.indexVersion;
    buildRiverChunk(s, gi + 2, gi + 60, rampGap, geo);
    expect(geo.indexVersion).toBeGreaterThan(v);
    const fresh = createRiverChunkGeometry(65);
    expect(Array.from(geo.index.subarray(0, geo.indexCount))).toEqual(
      Array.from(fresh.index.subarray(0, geo.indexCount)),
    );
    expect(Array.from(geo.segmentGap)).toEqual(Array.from(fresh.segmentGap));
  });
});

describe('decimation and gaps', () => {
  it('never merges across a gap', () => {
    const trail = new RiverTrail({ maxSamples: 150, protectTail: 40 });
    jump(rampGap, LIP, LAND, { trail, to: 250 });
    const s = trail.samples;
    expect(trail.stats.decimations).toBeGreaterThan(0);
    const gaps = gapIndices(s);
    expect(gaps).toHaveLength(1);
    const gi = gaps[0];
    // the samples on both sides of the gap are the ones a fresh, undecimated trail recorded
    const ref = jump(rampGap, LIP, LAND, { to: 250 }).samples;
    const rg = gapIndices(ref)[0];
    for (const [a, b] of [
      [s[gi - 1], ref[rg - 1]],
      [s[gi], ref[rg]],
    ]) {
      expect(a.x).toBe(b.x);
      expect(a.z).toBe(b.z);
      expect(a.y).toBe(b.y);
    }
    expect(trail.flowAt(0, 124)).toBeNull();
    expect(trail.stats.gaps).toBe(1);
  });
});

describe('jumps that are not ravines follow the ground', () => {
  const cases: [string, (x: number, z: number) => number, number][] = [
    ['a 2.5 m kicker on a 0.08 slope', (_x, z) => 60 - SLOPE * z + kicker(z, 2.5), 116],
    ['a 2.5 m kicker on a 0.15 slope (lands 5 m lower)', (_x, z) => 60 - 0.15 * z + kicker(z, 2.5), 118],
    ['a 4.5 m kicker with a sheer back onto flat ground', (_x, z) => 50 + kicker(z, 4.5), 118],
    [
      'a 6 m-deep gentle bowl',
      (_x, z) =>
        60 - SLOPE * z - (Math.abs(z - 120) < 20 ? 3 * (1 + Math.cos((Math.PI * (z - 120)) / 20)) : 0),
      140,
    ],
  ];

  it.each(cases)('%s: no gap, no waterfall sheet over the flight', (_name, height, land) => {
    const terrain = createAnalyticTerrain({ height, length: 260, width: 80, cellSize: 1 });
    const s = jump(terrain, LIP, land).samples;
    expect(gapIndices(s)).toHaveLength(0);
    // at most a short pour down a sheer back face, never a sheet arcing out to the landing
    for (const p of s) if (p.kind === 'fall') expect(p.z).toBeLessThan(LIP + 1.5);
    expectOnGround(terrain, s);
    for (let i = 1; i < s.length; i++) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    const rep = probeSurface(buildAllChunks(s, terrain), terrain, nearFallLip(s, 4));
    expect(rep.maxBury).toBeLessThan(0.1);
  });
});
