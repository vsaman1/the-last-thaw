import { describe, expect, it } from 'vitest';
import type { IcebergState, RiverSample, Terrain } from '../types';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { dirToHeading, smoothstep } from '../math';
import { RiverTrail } from './trail';
import {
  buildAllChunks,
  distanceToPolyline,
  fallClearance,
  fallRuns,
  hop,
  nearFallLip,
  probeSurface,
  waterFlight,
} from './testkit';
import {
  RIVER_CHUNK_SEGMENTS,
  RIVER_CROSS_VERTS,
  RIVER_GEOMETRY_REACH,
  buildRiverChunk,
  createRiverChunkGeometry,
  riverChunkCount,
  riverChunkRange,
  riverCrossSection,
  type RiverChunkGeometry,
} from './geometry';

const DT = 1 / 60;
const CROSS = RIVER_CROSS_VERTS;

function makeIceberg(): IcebergState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    steer: 0,
    yawRate: 0,
    grounded: true,
    airTime: 0,
    airPeakY: 0,
    inOcean: false,
    stuckTimer: 0,
    pitch: 0,
    roll: 0,
    impact: 0,
    radius: 2.2,
    mass: 30,
    ice: 1,
    size: 1,
  };
}

type PathFn = (d: number) => { x: number; z: number };

interface DriveOptions {
  speed: number;
  from: number;
  to: number;
  /** Per-step overrides keyed on distance travelled along the path. */
  state?: (d: number, ice: IcebergState) => void;
}

/** Move an iceberg along a parametric path (d = distance along it) and record every step. */
function drive(trail: RiverTrail, terrain: Terrain, path: PathFn, o: DriveOptions, t0 = 0): number {
  const ice = makeIceberg();
  let t = t0;
  for (let d = o.from; d <= o.to; d += o.speed * DT) {
    const p = path(d);
    const q = path(d + 0.01);
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const dx = (q.x - p.x) / len;
    const dz = (q.z - p.z) / len;
    ice.pos.x = p.x;
    ice.pos.z = p.z;
    ice.pos.y = terrain.heightAt(p.x, p.z);
    ice.vel.x = dx * o.speed;
    ice.vel.z = dz * o.speed;
    ice.heading = dirToHeading(dx, dz);
    ice.grounded = true;
    ice.inOcean = false;
    o.state?.(d, ice);
    trail.record(ice, terrain, t);
    t += DT;
  }
  return t;
}

const horiz = (a: RiverSample, b: RiverSample): number => Math.hypot(b.x - a.x, b.z - a.z);
const seg3 = (a: RiverSample, b: RiverSample): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

function buildAll(trail: RiverTrail, terrain: Terrain): RiverChunkGeometry[] {
  const n = trail.samples.length;
  const out: RiverChunkGeometry[] = [];
  for (let k = 0; k < riverChunkCount(n); k++) {
    const r = riverChunkRange(k, n);
    out.push(buildRiverChunk(trail.samples, r.start, r.end, terrain));
  }
  return out;
}

function expectFinite(arr: Float32Array, count: number): void {
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`non-finite value at ${i}: ${arr[i]}`);
  }
}

describe('RiverTrail recording', () => {
  const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1), length: 700, width: 200 });
  const curve: PathFn = (d) => ({ x: 30 * Math.sin(d / 45), z: d * 0.85 });

  it('records a curved path as evenly spaced samples with increasing s', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, curve, { speed: 18, from: 10, to: 600 });
    const s = trail.samples;
    expect(s.length).toBeGreaterThan(300);
    for (let i = 1; i < s.length; i++) {
      const h = horiz(s[i - 1], s[i]);
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThanOrEqual(3);
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
      expect(s[i].kind).toBe('flow');
      expect(s[i].y).toBeCloseTo(terrain.heightAt(s[i].x, s[i].z) + 0.15, 4);
      expect(Math.hypot(s[i].dirX, s[i].dirZ)).toBeCloseTo(1, 6);
    }
    for (const sm of s) {
      expect(sm.width).toBeGreaterThan(4.2);
      expect(sm.width).toBeLessThan(8.2);
      expect(sm.flowSpeed).toBeGreaterThanOrEqual(3);
    }
    expect(trail.length).toBe(s[s.length - 1].s);
  });

  it('is deterministic', () => {
    const a = new RiverTrail();
    const b = new RiverTrail();
    drive(a, terrain, curve, { speed: 18, from: 10, to: 300 });
    drive(b, terrain, curve, { speed: 18, from: 10, to: 300 });
    expect(a.samples.map((x) => ({ ...x }))).toEqual(b.samples.map((x) => ({ ...x })));
  });

  it('flowAt points along the flow inside the water and is null outside', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, curve, { speed: 18, from: 10, to: 600 });
    const s = trail.samples;
    let inside = 0;
    for (let i = 5; i < s.length - 5; i += 7) {
      const sm = s[i];
      const tx = s[i + 1].x - s[i - 1].x;
      const tz = s[i + 1].z - s[i - 1].z;
      const tl = Math.hypot(tx, tz);
      const f = trail.flowAt(sm.x, sm.z);
      expect(f).not.toBeNull();
      if (!f) continue;
      inside++;
      const sp = Math.hypot(f.vx, f.vz);
      expect(sp).toBeGreaterThan(2);
      expect((f.vx * tx + f.vz * tz) / (sp * tl)).toBeGreaterThan(0.95);
      expect(f.strength).toBeGreaterThan(0.95);
      expect(f.surfaceY).toBeCloseTo(sm.y, 1);
      // part way to the bank: weaker but still in the water
      const rx = -tz / tl;
      const rz = tx / tl;
      const off = sm.width * 0.3;
      const g = trail.flowAt(sm.x + rx * off, sm.z + rz * off);
      expect(g).not.toBeNull();
      if (g) expect(g.strength).toBeLessThan(0.9);
      // beyond the bank: dry
      const dry = trail.flowAt(sm.x + rx * sm.width * 0.75, sm.z + rz * sm.width * 0.75);
      expect(dry).toBeNull();
    }
    expect(inside).toBeGreaterThan(20);
    expect(trail.flowAt(500, 500)).toBeNull();
  });

  it('disturb raises turbulence only near the point and bumps version', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, (d) => ({ x: 0, z: d }), { speed: 15, from: 10, to: 120 });
    const before = trail.samples.map((s) => s.turbulence);
    const v0 = trail.version;
    trail.disturb(0, 60, 0.6);
    expect(trail.version).toBeGreaterThan(v0);
    trail.samples.forEach((s, i) => {
      const d = Math.hypot(s.x, s.z - 60);
      if (d < 5) {
        expect(s.turbulence).toBeGreaterThan(before[i]);
        expect(s.rev).toBe(trail.version);
      } else if (d > 6.01) {
        expect(s.turbulence).toBe(before[i]);
      }
      expect(s.turbulence).toBeLessThanOrEqual(1);
    });
  });

  it('reset empties the trail and marks a structural change', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, curve, { speed: 18, from: 10, to: 100 });
    const sv = trail.structureVersion;
    trail.reset();
    expect(trail.samples.length).toBe(0);
    expect(trail.length).toBe(0);
    expect(trail.structureVersion).toBe(sv + 1);
    expect(trail.flowAt(curve(50).x, curve(50).z)).toBeNull();
  });
});

describe('waterfalls', () => {
  const STEP_Z = 100;
  const cliff = (_x: number, z: number): number => (z < STEP_Z ? 50 - 0.05 * z : 35 - 0.05 * z);
  const terrain = createAnalyticTerrain({ height: cliff, length: 300, width: 80, cellSize: 1 });

  /** Fly off `takeoff` metres before the cliff (the grid ramp spans z = 99..100) at 20 m/s. */
  function jumpTrail(takeoff = 1): RiverTrail {
    const trail = new RiverTrail();
    const speed = 20;
    const { state } = hop(terrain, (d) => ({ x: 0, z: d }), speed, STEP_Z - takeoff, -0.05 * speed);
    drive(trail, terrain, (d) => ({ x: 0, z: d }), { speed, from: 10, to: 220, state });
    return trail;
  }

  it('bridges an airborne 15 m drop with a connected waterfall', () => {
    const trail = jumpTrail();
    const s = trail.samples;
    const first = s.findIndex((x) => x.kind === 'fall');
    let last = -1;
    s.forEach((x, i) => {
      if (x.kind === 'fall') last = i;
    });
    expect(first).toBeGreaterThan(0);
    expect(last - first + 1).toBeGreaterThanOrEqual(10);
    const lip = first - 1;
    const base = last + 1;
    expect(s[lip].kind).toBe('flow');
    expect(s[base].kind).toBe('flow');
    expect(s[lip].y - s[base].y).toBeGreaterThan(14);
    // contiguous fall run, monotone descent, short segments
    for (let i = first; i <= last; i++) expect(s[i].kind).toBe('fall');
    for (let i = lip + 1; i <= base; i++) {
      expect(s[i].y).toBeLessThanOrEqual(s[i - 1].y + 1e-9);
      expect(s[i - 1].y - s[i].y).toBeLessThanOrEqual(1.5);
    }
    // leaves the lip (nearly) horizontally: first step drops far less than the last
    expect(s[lip].y - s[first].y).toBeLessThan(0.5 * (s[last].y - s[base].y));
    for (let i = 1; i < s.length; i++) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    for (let i = first; i <= last; i++) expect(s[i].turbulence).toBe(1);
    // plunge pool
    for (let i = base; i < s.length && s[i].s - s[base].s <= 6; i++) {
      expect(s[i].turbulence).toBeGreaterThanOrEqual(0.95);
    }
    // the river continues below
    expect(s.length - base).toBeGreaterThan(40);
    for (let i = 1; i < s.length; i++) expect(s[i].s).toBeGreaterThan(s[i - 1].s);
  });

  it('a late take-off halfway down the cliff still gives one descending, connected river', () => {
    const trail = jumpTrail(0.5);
    const s = trail.samples;
    const first = s.findIndex((x) => x.kind === 'fall');
    let last = -1;
    s.forEach((x, i) => {
      if (x.kind === 'fall') last = i;
    });
    expect(first).toBeGreaterThan(0);
    for (let i = first; i <= last + 1; i++) {
      expect(s[i].y).toBeLessThanOrEqual(s[i - 1].y + 1e-9);
      expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    }
  });

  it('fall geometry stays finite and sits out of the cliff face', () => {
    const trail = jumpTrail();
    const chunks = buildAll(trail, terrain);
    let fallVerts = 0;
    for (const g of chunks) {
      expectFinite(g.position, g.vertexCount * 3);
      expectFinite(g.normal, g.vertexCount * 3);
      for (let v = 0; v < g.vertexCount; v++) {
        if (g.fall[v] !== 1) continue;
        fallVerts++;
        const x = g.position[v * 3];
        const y = g.position[v * 3 + 1];
        const z = g.position[v * 3 + 2];
        expect(y).toBeGreaterThanOrEqual(terrain.heightAt(x, z) - 0.05);
      }
    }
    expect(fallVerts).toBeGreaterThan(50);
  });

  it('a grounded slide down a sheer cliff also becomes a waterfall', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, (d) => ({ x: 0, z: d }), { speed: 20, from: 10, to: 160 });
    const s = trail.samples;
    expect(s.some((x) => x.kind === 'fall')).toBe(true);
    for (let i = 1; i < s.length; i++) {
      expect(s[i - 1].y - s[i].y).toBeLessThanOrEqual(1.55);
      expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    }
  });

  it('a hop 12 m before the cliff pours from the take-off point along the flight, over the edge', () => {
    // The sheet follows the iceberg up off the plateau and down past the edge (it used to run the
    // water along the plateau and pour it down the cliff face from the edge).
    const trail = new RiverTrail();
    const path: PathFn = (d) => ({ x: 0, z: d });
    const { state, flight } = hop(terrain, path, 20, STEP_Z - 12, 4);
    drive(trail, terrain, path, { speed: 20, from: 10, to: 220, state });
    const s = trail.samples;
    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    expect(flight.takeoff).not.toBeNull();
    const to = flight.takeoff ?? { x: NaN, y: NaN, z: NaN };
    // (a take-off within 0.25 m of the newest sample pours from that sample)
    expect(Math.hypot(s[lip].x - to.x, s[lip].z - to.z)).toBeLessThan(0.26);
    expect(s[lip].z).toBeLessThan(STEP_Z - 11);
    const water = waterFlight(flight);
    for (let i = first; i <= last; i++) {
      expect(distanceToPolyline(s[i], water), `sample ${i}`).toBeLessThan(0.05);
    }
    expect(Math.abs(s[base].z - (flight.landing?.z ?? 0))).toBeLessThan(0.3);
    for (let i = 1; i < s.length; i++) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    const rep = probeSurface(buildAllChunks(s, terrain), terrain);
    expect(rep.fallInRock).toBe(0);
    expect(rep.maxBury).toBeLessThan(0.1);
  });
});

describe('waterfalls follow the flight', () => {
  // Level 1's cliff: a hard 15 m step on a 2.5 m grid, so the face spans one cell (z 97.5 → 100).
  const LIP_Z = 97.5;
  const SLOPE = 0.065;
  const step = createAnalyticTerrain({
    height: (_x, z) => 50 - SLOPE * z - (z < 100 ? 0 : 15),
    length: 300,
    width: 160,
    cellSize: 2.5,
  });
  // The same step dropping into the sea (seabed 6 m down), and a sheer one on a 1 m grid.
  const seaCliff = createAnalyticTerrain({
    height: (_x, z) => (z < 100 ? 22 - SLOPE * z : -6),
    length: 300,
    width: 160,
    cellSize: 2.5,
    seaLevel: 0,
  });
  const sheer = createAnalyticTerrain({
    height: (_x, z) => 50 - SLOPE * z - (z < 100 ? 0 : 15),
    length: 300,
    width: 160,
    cellSize: 1,
  });

  const cases: [string, Terrain, number, number, number][] = [
    // name, terrain, speed (m/s), approach angle (°), take-off z
    ['a fast jump (20 m/s)', step, 20, 0, LIP_Z],
    ['an angled jump (14 m/s at 40°)', step, 14, 40, LIP_Z],
    ['a sharply angled jump (18 m/s at 60°)', step, 18, 60, LIP_Z],
    ['a slow drop (3 m/s)', step, 3, 0, LIP_Z],
    ['a crawl over the edge (1.6 m/s)', step, 1.6, 0, LIP_Z],
    ['a slow angled drop (4 m/s at 30°)', step, 4, 30, LIP_Z],
    ['the sea cliff (12 m/s)', seaCliff, 12, 0, LIP_Z],
    ['a slow drop off a sheer cliff (2 m/s)', sheer, 2, 0, 99],
  ];

  it.each(cases)('%s: the sheet leaves the take-off point along the flight, clear of the rock', (
    _name,
    terrain,
    speed,
    deg,
    lipZ,
  ) => {
    const a = (deg * Math.PI) / 180;
    const D0 = 200;
    const path: PathFn = (d) => ({ x: Math.sin(a) * (d - D0), z: lipZ + Math.cos(a) * (d - D0) });
    const { state, flight } = hop(terrain, path, speed, D0, -SLOPE * speed * Math.cos(a));
    const trail = new RiverTrail();
    const reach = Math.min(70, 40 + speed);
    drive(trail, terrain, path, { speed, from: D0 - 30, to: D0 + reach / Math.cos(a), state });
    const s = trail.samples;
    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { lip, first, last, base } = runs[0];
    const to = flight.takeoff ?? { x: NaN, y: NaN, z: NaN };
    const land = flight.landing ?? { x: NaN, y: NaN, z: NaN };
    // out from the take-off point...
    expect(Math.hypot(s[lip].x - to.x, s[lip].z - to.z)).toBeLessThan(0.26);
    // ...along the flight: level with the lip until an angled edge is cleared, moved out from the
    // face where a slow one falls close to it...
    const water = waterFlight(flight);
    let dev = 0;
    let devBelow = 0;
    for (let i = first; i <= last; i++) {
      const d = distanceToPolyline(s[i], water);
      dev = Math.max(dev, d);
      if (s[i].y < s[lip].y - 3) devBelow = Math.max(devBelow, d);
    }
    // ...down to where it landed
    const baseOff = Math.hypot(s[base].x - land.x, s[base].z - land.z);
    expect(s[base].kind).toBe(terrain === seaCliff ? 'ocean' : 'flow');
    for (let i = 1; i < s.length; i++) {
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
      expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    }
    // Clear of the rock everywhere, both banks included; once falling (1 m below the lip), never
    // hugging the face.
    const chunks = buildAllChunks(s, terrain);
    const fc = fallClearance(chunks, terrain, (_i, y) => y < s[lip].y - 1);
    console.log(
      `[waterfall] ${_name}: ${last - first + 1} fall samples, max dev ${dev.toFixed(3)} m ` +
        `(${devBelow.toFixed(3)} m once 3 m down), base off ${baseOff.toFixed(2)} m, min vertical ` +
        `${fc.minVertical.toFixed(2)} m, min distance ${fc.minDistance.toFixed(2)} m, low triangles ` +
        `${fc.trianglesLow} (lowest ${fc.minTriangle.toFixed(2)} m)`,
    );
    expect(devBelow).toBeLessThan(speed >= 10 ? 0.05 : 1.5);
    expect(dev).toBeLessThan(speed >= 10 ? 0.6 : 1.5);
    expect(baseOff).toBeLessThan(1);
    expect(fc.minVertical).toBeGreaterThan(0.149);
    expect(fc.trianglesLow, `lowest ${fc.minTriangle.toFixed(2)} m`).toBe(0);
    expect(fc.minDistance, `at sample ${fc.minDistanceAt}`).toBeGreaterThan(0.4);
  });

  it('flowAt: dry under the arc of a sheet high overhead, wet in the plunge pool', () => {
    // Physics buoys a body in the water up to surfaceY: a body lying on the ground under a
    // waterfall arcing far overhead must not count as in it.
    const path: PathFn = (d) => ({ x: 0, z: d });
    const { state } = hop(step, path, 20, LIP_Z, -SLOPE * 20);
    const trail = new RiverTrail();
    drive(trail, step, path, { speed: 20, from: 60, to: 160, state });
    const s = trail.samples;
    const { lip, first, last, base } = fallRuns(s)[0];
    let dry = 0;
    for (let i = first; i <= last; i++) {
      const high = s[i].y - step.heightAt(s[i].x, s[i].z) > 2;
      // (the river above the lip and the pool below end in round caps half a width past them)
      if (!high || horiz(s[lip], s[i]) < s[lip].width || horiz(s[base], s[i]) < s[base].width) continue;
      expect(trail.flowAt(s[i].x, s[i].z), `under sample ${i}`).toBeNull();
      dry++;
    }
    expect(dry).toBeGreaterThan(10);
    const pool = trail.flowAt(s[base].x, s[base].z + 1);
    expect(pool).not.toBeNull();
    if (pool) expect(pool.vz).toBeGreaterThan(0);
  });

  it('a very long flight keeps its shape when the airborne buffer is thinned out', () => {
    // 40 m/s off a 420 m cliff: ~9 s and 600 m of flight, more points than the buffer holds.
    const tall = createAnalyticTerrain({
      height: (_x, z) => (z < 100 ? 450 - 0.05 * z : 30 - 0.05 * z),
      length: 700,
      width: 80,
      cellSize: 2.5,
    });
    const path: PathFn = (d) => ({ x: 0, z: d });
    const { state, flight } = hop(tall, path, 40, LIP_Z, -2);
    const trail = new RiverTrail();
    drive(trail, tall, path, { speed: 40, from: 60, to: 560, state });
    expect(flight.points.length).toBeGreaterThan(512);
    const s = trail.samples;
    const runs = fallRuns(s);
    expect(runs).toHaveLength(1);
    const { first, last } = runs[0];
    const water = waterFlight(flight);
    let dev = 0;
    for (let i = first; i <= last; i++) dev = Math.max(dev, distanceToPolyline(s[i], water));
    expect(dev).toBeLessThan(0.2);
    for (let i = first; i <= last + 1; i++) expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(1.25);
  });
});

describe('a waterfall where the cliff spreads out toward a valley wall', () => {
  // Sheer at x ≥ 0; for x < 0 the 15 m step is spread over 0.5 + 3·|x| metres, as level 1's cliff is
  // where it meets the walls. A sheet crossing at x = 0 has its left half over that ramp.
  const spread = (x: number): number => 0.5 + 3 * Math.max(0, -x);
  const h = (x: number, z: number): number => 50 - 0.05 * z - 15 * smoothstep(100, 100 + spread(x), z);
  const terrain = createAnalyticTerrain({ height: h, length: 300, width: 80, cellSize: 1 });

  it('keeps every waterfall vertex out of the rock, even when the iceberg tips over slowly', () => {
    const trail = new RiverTrail();
    const path: PathFn = (d) => ({ x: 0, z: d });
    const { state } = hop(terrain, path, 8, 99.8, -0.4);
    drive(trail, terrain, path, { speed: 8, from: 10, to: 200, state });
    const s = trail.samples;
    expect(fallRuns(s)).toHaveLength(1);
    const chunks = buildAllChunks(s, terrain);
    const rep = probeSurface(chunks, terrain);
    expect(rep.fallInRock, `deepest ${rep.maxFallDepth.toFixed(2)} m`).toBe(0);
    const fc = fallClearance(chunks, terrain);
    expect(fc.minVertical).toBeGreaterThan(0.149);
    expect(fc.trianglesLow, `lowest ${fc.minTriangle.toFixed(2)} m`).toBe(0);
  });
});

describe('airborne hops that are not cliffs', () => {
  // A valley wall rising toward +x (cross slope 0.34) on a 0.08 downhill run, like level 1's walls.
  const wall = (x: number, z: number): number => 60 - 0.08 * z + 0.34 * x;
  const terrain = createAnalyticTerrain({ height: wall, length: 300, width: 120, cellSize: 2.5 });

  it('a sideways hop down a wall slope follows the ground instead of becoming a waterfall', () => {
    // Review finding: a 16 m hop diagonally down the wall (drop ≈ 6.7 m, no cliff under it) was
    // turned into a flat waterfall sheet buried in the uphill rock and floating on the downhill side.
    const xAt = (d: number): number => (d < 100 ? 18 : d < 116 ? 18 - (d - 100) : 2);
    const trail = new RiverTrail();
    drive(trail, terrain, (d) => ({ x: xAt(d), z: d }), {
      speed: 18,
      from: 10,
      to: 200,
      state: (d, ice) => {
        if (d > 100 && d < 116) {
          ice.grounded = false;
          ice.pos.y = wall(18, 100) + 1;
        }
      },
    });
    const s = trail.samples;
    expect(s.filter((x) => x.kind === 'fall')).toHaveLength(0);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].y).toBeCloseTo(terrain.heightAt(s[i].x, s[i].z) + 0.15, 4);
      expect(seg3(s[i - 1], s[i])).toBeLessThanOrEqual(2.05);
    }
    const rep = probeSurface(buildAllChunks(s, terrain), terrain);
    expect(rep.fallInRock).toBe(0);
    expect(rep.maxBury).toBeLessThan(0.05);
  });
});

describe('river geometry', () => {
  const bumpy = (x: number, z: number): number =>
    80 - 0.08 * z + 1.6 * Math.sin(x / 6.5) + 1.1 * Math.cos(z / 9) + 0.25 * x +
    0.4 * Math.sin((x + z) / 3.1);
  const terrain = createAnalyticTerrain({ height: bumpy, length: 800, width: 160, cellSize: 2.5 });
  const path: PathFn = (d) => ({ x: 25 * Math.sin(d / 38), z: d * 0.9 });

  it('builds finite, seamless chunks that never dip under the terrain', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, path, { speed: 22, from: 10, to: 820 });
    const n = trail.samples.length;
    expect(riverChunkCount(n)).toBeGreaterThanOrEqual(4);
    const chunks = buildAll(trail, terrain);
    let landVerts = 0;
    for (const g of chunks) {
      expect(g.vertexCount).toBe(g.crossSections * CROSS);
      for (const arr of [g.position, g.normal]) expectFinite(arr, g.vertexCount * 3);
      for (const arr of [g.uv, g.lateral]) expectFinite(arr, g.vertexCount * 2);
      for (const arr of [g.flowSpeed, g.turbulence, g.fall, g.ocean, g.birth]) {
        expectFinite(arr, g.vertexCount);
      }
      for (let v = 0; v < g.vertexCount; v++) {
        const x = g.position[v * 3];
        const y = g.position[v * 3 + 1];
        const z = g.position[v * 3 + 2];
        if (g.fall[v] === 0 && g.ocean[v] === 0) {
          landVerts++;
          expect(y).toBeGreaterThanOrEqual(terrain.heightAt(x, z) - 0.05);
        }
        expect(g.normal[v * 3 + 1]).toBeGreaterThan(0.2);
        expect(g.uv[v * 2]).toBeGreaterThanOrEqual(0);
        expect(g.uv[v * 2]).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < g.indexCount; i++) expect(g.index[i]).toBeLessThan(g.vertexCount);
    }
    expect(landVerts).toBeGreaterThan(n * CROSS * 0.99);
    for (let k = 0; k + 1 < chunks.length; k++) {
      const a = chunks[k];
      const b = chunks[k + 1];
      expect(a.end).toBe(b.start);
      const lastA = (a.crossSections - 1) * CROSS;
      for (let j = 0; j < CROSS; j++) {
        for (let c = 0; c < 3; c++) {
          expect(a.position[(lastA + j) * 3 + c]).toBe(b.position[j * 3 + c]);
          expect(a.normal[(lastA + j) * 3 + c]).toBe(b.normal[j * 3 + c]);
        }
        expect(a.uv[(lastA + j) * 2 + 1]).toBe(b.uv[j * 2 + 1]);
        expect(a.lateral[(lastA + j) * 2]).toBe(b.lateral[j * 2]);
      }
    }
  });

  it('appending only changes cross-sections within RIVER_GEOMETRY_REACH of the tail', () => {
    const trail = new RiverTrail();
    const t = drive(trail, terrain, path, { speed: 22, from: 10, to: 300 });
    const n1 = trail.samples.length;
    const before = buildRiverChunk(trail.samples, 0, n1 - 1, terrain);
    const pos1 = before.position.slice(0, before.vertexCount * 3);
    const nrm1 = before.normal.slice(0, before.vertexCount * 3);
    drive(trail, terrain, path, { speed: 22, from: 300.3, to: 330 }, t);
    expect(trail.samples.length).toBeGreaterThan(n1 + 5);
    const after = buildRiverChunk(trail.samples, 0, n1 - 1, terrain);
    const stable = (n1 - 1 - RIVER_GEOMETRY_REACH) * CROSS * 3;
    for (let i = 0; i < stable; i++) {
      expect(after.position[i]).toBe(pos1[i]);
      expect(after.normal[i]).toBe(nrm1[i]);
    }
  });

  it('an incremental chunk rebuild matches a full rebuild exactly', () => {
    const trail = new RiverTrail();
    const t = drive(trail, terrain, path, { speed: 22, from: 10, to: 100 });
    const n1 = trail.samples.length;
    const inc = buildRiverChunk(trail.samples, 0, n1 - 1, terrain, createRiverChunkGeometry());
    drive(trail, terrain, path, { speed: 22, from: 100.3, to: 130 }, t);
    const n2 = Math.min(trail.samples.length, RIVER_CHUNK_SEGMENTS + 1);
    const from = n1 - 1 - RIVER_GEOMETRY_REACH;
    buildRiverChunk(trail.samples, 0, n2 - 1, terrain, inc, undefined, from);
    expect(inc.writtenFrom).toBe(from);
    const full = buildRiverChunk(trail.samples, 0, n2 - 1, terrain);
    expect(inc.vertexCount).toBe(full.vertexCount);
    const keys = ['position', 'normal', 'uv', 'lateral', 'flowSpeed', 'turbulence', 'birth'] as const;
    for (const key of keys) {
      const per = inc[key].length / inc.maxCrossSections / CROSS;
      expect(Array.from(inc[key].subarray(0, full.vertexCount * per))).toEqual(
        Array.from(full[key].subarray(0, full.vertexCount * per)),
      );
    }
    expect(inc.bounds.minY).toBeLessThanOrEqual(full.bounds.minY);
    expect(inc.bounds.maxZ).toBeGreaterThanOrEqual(full.bounds.maxZ);
  });

  it('does not fold on a tight hairpin', () => {
    const flat = createAnalyticTerrain({ height: () => 10, length: 200, width: 120 });
    const R = 3;
    const hairpin: PathFn = (d) => {
      if (d < 40) return { x: 0, z: d };
      const a = (d - 40) / R;
      if (a < Math.PI) return { x: -R + R * Math.cos(a), z: 40 + R * Math.sin(a) };
      return { x: -2 * R, z: 40 - (d - 40 - Math.PI * R) };
    };
    const trail = new RiverTrail();
    drive(trail, flat, hairpin, { speed: 5, from: 2, to: 40 + Math.PI * R + 35 });
    const g = buildRiverChunk(trail.samples, 0, trail.samples.length - 1, flat);
    let flipped = 0;
    const P = g.position;
    for (let i = 0; i < g.indexCount; i += 3) {
      const a = g.index[i] * 3;
      const b = g.index[i + 1] * 3;
      const c = g.index[i + 2] * 3;
      const ux = P[b] - P[a];
      const uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a];
      const vz = P[c + 2] - P[a + 2];
      // y component of (b − a) × (c − a)
      const ny = uz * vx - ux * vz;
      if (ny < -1e-6) flipped++;
    }
    expect(flipped).toBe(0);
  });
});

describe('river geometry on slopes and drop-offs', () => {
  it('water riding along a valley wall drapes on the slope instead of floating above it', () => {
    // Review finding: cross-sections stayed flat at the centreline level, so on a wall the downhill
    // half of the river hung metres above the ground (level 1: up to 3.2 m).
    const valley = (x: number, z: number): number =>
      70 - 0.08 * z + 40 * smoothstep(0, 30, -x - 4) + 0.6 * Math.sin(z / 11);
    const terrain = createAnalyticTerrain({ height: valley, length: 450, width: 140, cellSize: 2.5 });
    const path: PathFn = (d) => ({ x: -14 + 9 * Math.sin(d / 45), z: d * 0.95 });
    const trail = new RiverTrail();
    drive(trail, terrain, path, { speed: 18, from: 10, to: 440 });
    const rep = probeSurface(buildAllChunks(trail.samples, terrain), terrain);
    expect(rep.landTriangles).toBeGreaterThan(4000);
    expect(rep.maxFloat).toBeLessThan(0.75);
    expect(rep.maxBury).toBeLessThan(0.05);
  });

  describe('next to a sheer cliff', () => {
    const STEP_Z = 100;
    const cliff = (_x: number, z: number): number => (z < STEP_Z ? 50 - 0.05 * z : 35 - 0.05 * z);
    const terrain = createAnalyticTerrain({ height: cliff, length: 300, width: 320, cellSize: 1 });

    /** Lowest vertex of cross-sections [from, to] relative to each sample's own water level. */
    function lowestBankDrop(s: readonly RiverSample[], from: number, to: number): number {
      let worst = 0;
      for (let i = Math.max(0, from); i <= to; i++) {
        const cs = riverCrossSection(s, i, terrain);
        for (let k = 0; k < CROSS; k++) worst = Math.max(worst, s[i].y - cs[k * 3 + 1]);
      }
      return worst;
    }

    it.each([0, 30, 50, 65])(
      'a %i° crossing keeps the lip flat: no burial at the edge, no curtain down the face',
      (deg) => {
        const a = (deg * Math.PI) / 180;
        const D0 = 200;
        const cz = Math.cos(a);
        const path: PathFn = (d) => ({ x: Math.sin(a) * (d - D0), z: STEP_Z + cz * (d - D0) });
        const takeoff = D0 - 1 / cz;
        const trail = new RiverTrail();
        const { state } = hop(terrain, path, 20, takeoff, -0.05 * 20 * cz);
        drive(trail, terrain, path, { speed: 20, from: D0 - 40 / cz, to: D0 + 60 / cz, state });
        const s = trail.samples;
        const runs = fallRuns(s);
        expect(runs).toHaveLength(1);
        const { lip, base } = runs[0];
        expect(s[lip].kind).toBe('flow');
        expect(s[base].kind).toBe('flow');
        expect(s[lip].y - s[base].y).toBeGreaterThan(14);
        const rep = probeSurface(buildAllChunks(s, terrain), terrain);
        expect(rep.fallInRock).toBe(0);
        expect(rep.maxBury).toBeLessThan(0.1);
        expect(lowestBankDrop(s, lip - 6, lip)).toBeLessThan(1.6);
      },
    );

    it('riding along the cliff top keeps the overhanging bank flat instead of draping it down', () => {
      const trail = new RiverTrail();
      drive(trail, terrain, (d) => ({ x: d - 60, z: STEP_Z - 2 }), { speed: 15, from: 0, to: 120 });
      const s = trail.samples;
      expect(fallRuns(s)).toHaveLength(0);
      const rep = probeSurface(buildAllChunks(s, terrain), terrain);
      expect(rep.maxBury).toBeLessThan(0.1);
      expect(lowestBankDrop(s, 0, s.length - 1)).toBeLessThan(1.6);
    });
  });

  it('the surface probe sees a calm river on flat ground as neither floating nor buried', () => {
    const flat = createAnalyticTerrain({ height: () => 10, length: 200, width: 80 });
    const trail = new RiverTrail();
    drive(trail, flat, (d) => ({ x: 0, z: d }), { speed: 15, from: 5, to: 150 });
    const near = nearFallLip(trail.samples, 4);
    expect(trail.samples.some((_, i) => near(i))).toBe(false);
    const rep = probeSurface(buildAllChunks(trail.samples, flat), flat);
    expect(rep.maxFloat).toBeLessThan(0.4);
    expect(rep.maxBury).toBe(0);
  });
});

describe('ocean plume', () => {
  const coast = (_x: number, z: number): number => 10 - 0.1 * z;
  const terrain = createAnalyticTerrain({ height: coast, length: 400, width: 200, seaLevel: 0 });

  it('ocean samples sit at sea level and fan out ~3x over ~40 m', () => {
    const trail = new RiverTrail();
    drive(trail, terrain, (d) => ({ x: 0, z: d }), {
      speed: 16,
      from: 10,
      to: 220,
      state: (d, ice) => {
        if (d > 100) {
          ice.inOcean = true;
          ice.grounded = false;
        }
      },
    });
    const s = trail.samples;
    const firstOcean = s.findIndex((x) => x.kind === 'ocean');
    expect(firstOcean).toBeGreaterThan(0);
    expect(trail.coastS).not.toBeNull();
    const lastLand = s[firstOcean - 1];
    for (let i = firstOcean; i < s.length; i++) {
      expect(s[i].kind).toBe('ocean');
      expect(s[i].y).toBeCloseTo(0.06, 6);
    }
    const coastS = trail.coastS ?? 0;
    const far = s.find((x) => x.kind === 'ocean' && x.s - coastS > 45);
    expect(far).toBeDefined();
    if (far) expect(far.width).toBeGreaterThan(2.5 * lastLand.width);
    for (let i = firstOcean + 1; i < s.length; i++) {
      expect(s[i].width).toBeGreaterThanOrEqual(s[i - 1].width - 1e-9);
    }
    const g = buildRiverChunk(s, firstOcean - 3, s.length - 1, terrain);
    expect(g.hasOcean).toBe(true);
    const f = trail.flowAt(0, 150);
    expect(f).not.toBeNull();
    if (f) expect(f.vz).toBeGreaterThan(0);
  });

  it('coastS stays at the first ocean entry when the trail beaches and re-enters the sea', () => {
    // The plume shader fades by distance past coastS. Moving it to a later entry would turn the
    // whole earlier (already faded) plume opaque again.
    const trail = new RiverTrail();
    const path: PathFn = (d) => ({ x: (d - 125) * 0.7, z: 100 - 30 * Math.sin(d / 25) });
    drive(trail, terrain, path, {
      speed: 16,
      from: 5,
      to: 250,
      state: (_d, ice) => {
        ice.inOcean = ice.pos.z > 100;
        ice.grounded = !ice.inOcean;
      },
    });
    const s = trail.samples;
    const entries: number[] = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i].kind === 'ocean' && s[i - 1].kind !== 'ocean') entries.push(i);
    }
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(trail.coastS).toBe(s[entries[0]].s);
    trail.reset();
    expect(trail.coastS).toBeNull();
  });
});

describe('budget and performance', () => {
  it('a 20 km trail stays under the sample cap with no gaps', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.05), length: 400, width: 120 });
    const trail = new RiverTrail();
    const path: PathFn = (d) => ({ x: 40 * Math.sin(d / 150), z: d });
    let maxCount = 0;
    const speed = 25;
    const ice = makeIceberg();
    let t = 0;
    for (let d = 0; d <= 20000; d += speed * DT) {
      const p = path(d);
      const q = path(d + 0.01);
      const l = Math.hypot(q.x - p.x, q.z - p.z);
      ice.pos.x = p.x;
      ice.pos.z = p.z;
      ice.vel.x = ((q.x - p.x) / l) * speed;
      ice.vel.z = ((q.z - p.z) / l) * speed;
      trail.record(ice, terrain, t);
      t += DT;
      if (trail.samples.length > maxCount) maxCount = trail.samples.length;
    }
    const s = trail.samples;
    expect(maxCount).toBeLessThanOrEqual(trail.options.maxSamples);
    expect(trail.structureVersion).toBeGreaterThan(0);
    let maxGap = 0;
    for (let i = 1; i < s.length; i++) {
      maxGap = Math.max(maxGap, horiz(s[i - 1], s[i]));
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
    }
    expect(maxGap).toBeLessThanOrEqual(24);
    // full detail near the iceberg
    for (let i = s.length - 300; i < s.length; i++) expect(horiz(s[i - 1], s[i])).toBeLessThan(1.7);
    expect(trail.length).toBeGreaterThan(20000);
    // the spatial hash was rebuilt after decimation: old and new water both answer
    expect(trail.flowAt(path(1000).x, path(1000).z)).not.toBeNull();
    expect(trail.flowAt(path(19990).x, path(19990).z)).not.toBeNull();
    console.log(
      `[river] 20 km: ${s.length} samples, max gap ${maxGap.toFixed(2)} m, ` +
        `${trail.stats.decimations} decimations`,
    );
  });

  it('holds the cap even when the whole trail zig-zags (no shape-based merge possible)', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.05), length: 3000, width: 120 });
    const trail = new RiverTrail({ maxSamples: 600, protectTail: 100 });
    // ±1.6 m triangle wave with a 2.6 m period: every sample turns by well over 0.8 rad
    const zigzag: PathFn = (d) => {
      const ph = (d / 2.6) % 1;
      return { x: 1.6 * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph), z: d * 0.6 };
    };
    let maxCount = 0;
    drive(trail, terrain, zigzag, {
      speed: 12,
      from: 0,
      to: 2500,
      state: () => {
        if (trail.samples.length > maxCount) maxCount = trail.samples.length;
      },
    });
    const s = trail.samples;
    expect(maxCount).toBeLessThanOrEqual(600);
    expect(s.length).toBeLessThanOrEqual(600);
    expect(trail.stats.decimations).toBeGreaterThan(0);
    for (let i = 1; i < s.length; i++) {
      expect(horiz(s[i - 1], s[i])).toBeLessThanOrEqual(24 + 1e-9);
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
    }
  });

  it('records 1000 samples and answers 200 flow queries per step quickly', () => {
    const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1), length: 1400, width: 200 });
    const path: PathFn = (d) => ({ x: 35 * Math.sin(d / 60), z: d * 0.9 });
    const trail = new RiverTrail();
    const ice = makeIceberg();
    const speed = 22;
    let steps = 0;
    const t0 = performance.now();
    for (let d = 5; trail.samples.length < 1000; d += speed * DT) {
      const p = path(d);
      ice.pos.x = p.x;
      ice.pos.z = p.z;
      ice.vel.z = speed;
      trail.record(ice, terrain, steps * DT);
      steps++;
    }
    const recordMs = performance.now() - t0;

    const bodies: { x: number; z: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const p = path(10 + i * 5.5);
      bodies.push({ x: p.x + ((i % 7) - 3), z: p.z + ((i % 5) - 2) });
    }
    // Timings take the fastest of several batches: other test files share the CPU, and one
    // preempted batch should not fail an algorithmic budget.
    const STEPS = 120;
    let hits = 0;
    let perStep = Infinity;
    for (let batch = 0; batch < 5; batch++) {
      hits = 0;
      const t1 = performance.now();
      for (let k = 0; k < STEPS; k++) {
        for (const b of bodies) if (trail.flowAt(b.x, b.z)) hits++;
      }
      perStep = Math.min(perStep, (performance.now() - t1) / STEPS);
    }

    let chunks = buildAll(trail, terrain);
    let buildMs = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const t2 = performance.now();
      chunks = buildAll(trail, terrain);
      buildMs = Math.min(buildMs, performance.now() - t2);
    }
    const n = trail.samples.length;
    const tail = riverChunkRange(riverChunkCount(n) - 1, n);
    const tailGeo = buildRiverChunk(trail.samples, tail.start, tail.end, terrain, createRiverChunkGeometry());
    let incMs = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const t3 = performance.now();
      for (let k = 0; k < 100; k++) {
        buildRiverChunk(trail.samples, tail.start, tail.end, terrain, tailGeo, undefined, tail.end - 6);
      }
      incMs = Math.min(incMs, (performance.now() - t3) / 100);
    }

    console.log(
      `[river] record ${trail.samples.length} samples (${steps} steps): ${recordMs.toFixed(2)} ms; ` +
        `flowAt 200 bodies/step: ${perStep.toFixed(4)} ms/step (${hits / STEPS} hits/step); ` +
        `full build ${chunks.length} chunks (warm): ${buildMs.toFixed(2)} ms; ` +
        `incremental tail rebuild: ${incMs.toFixed(4)} ms`,
    );
    expect(hits).toBeGreaterThan(0);
    expect(recordMs).toBeLessThan(150);
    expect(perStep).toBeLessThan(0.5);
    expect(buildMs).toBeLessThan(100);
    expect(incMs).toBeLessThan(1);
  });
});
