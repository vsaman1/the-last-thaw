import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import type { TerrainFeature } from '../types';
import { buildTrafficNetwork, laneOffset, nearestLane, type TrafficNetwork } from './network';
import { signalState, timeToGreen } from './signals';
import { TRAFFIC_TUNING, TrafficSystem, type TrafficEnv, type VehicleKind } from './traffic';

/**
 * Analytic flat terrain: the course runs along +z from z = 0, so s = z and d = -x (right of travel
 * is -x). Roads only need the level's features here (the traffic reads geometry, not the carving).
 */
function terrainWith(features: TerrainFeature[], height = (_x: number, _z: number): number => 0) {
  return createAnalyticTerrain({
    height,
    halfWidth: 80,
    width: 240,
    length: 600,
    cellSize: 2,
    level: { features, theme: 'town' },
  });
}

const MAIN: TerrainFeature = { type: 'road', s0: 40, s1: 560, d: 0, width: 8 };
const CROSS: TerrainFeature = { type: 'street', points: [{ s: 300, d: -70 }, { s: 300, d: 70 }], width: 8 };

const flatEnv: TrafficEnv = { support: () => 0 };

/** Spawns vehicles on lanes at the given world points (heading along +z unless given). */
function spawn(
  net: TrafficNetwork,
  list: { x: number; z: number; kind?: VehicleKind; hx?: number; hz?: number }[],
  env: TrafficEnv = flatEnv,
): TrafficSystem {
  const spawns = list.map((p, k) => {
    const lane = nearestLane(net, p.x, p.z, p.hx ?? 0, p.hz ?? 1, 6);
    if (!lane) throw new Error(`no lane near ${p.x}, ${p.z}`);
    return { body: k, kind: p.kind ?? 'car', path: lane.path, arc: lane.arc, seed: 1000 + k };
  });
  return new TrafficSystem(net, spawns, env);
}

describe('traffic network', () => {
  it('splits a road crossed by a street into a signalised four-way junction with right-hand lanes', () => {
    const net = buildTrafficNetwork(terrainWith([MAIN, CROSS]));
    expect(net.junctions).toHaveLength(1);
    const J = net.junctions[0];
    expect(J.x).toBeCloseTo(0, 6);
    expect(J.z).toBeCloseTo(300, 6);
    expect(J.legs).toHaveLength(4);
    expect(J.signalised).toBe(true);
    expect(J.groups).toBe(2);
    // Opposite legs share a phase: the main road's pair is phase 0 (both lines are 8 m: by angle).
    const byGroup = [0, 1].map((g) => J.legs.filter((l) => l.group === g));
    for (const legs of byGroup) {
      expect(legs).toHaveLength(2);
      expect(legs[0].dirX * legs[1].dirX + legs[0].dirZ * legs[1].dirZ).toBeCloseTo(-1, 6);
    }
    // A lane driving +z on the main road keeps to the right of travel (-x), laneOffset out.
    const up = nearestLane(net, -2, 200, 0, 1, 5)!;
    const p = net.paths[up.path];
    expect(p.kind).toBe('lane');
    expect(p.xs[0]).toBeCloseTo(-laneOffset(8), 6);
    // It stops at its stop line (junction radius 4 + 2 m before the centre) and turns 3 ways.
    expect(p.zs[p.zs.length - 1]).toBeCloseTo(300 - J.radius, 6);
    expect(p.succ).toHaveLength(3);
    expect(p.junction).toBe(0);
    // Turns from different approaches that cross each other conflict; right turns from opposite
    // approaches do not.
    const turns = net.paths.filter((t) => t.kind === 'turn');
    expect(turns).toHaveLength(12);
    expect(turns.every((t) => t.conflicts.length > 0)).toBe(true);
  });

  it('finds T- and L-junctions where an end meets another line, and turns round at dead ends', () => {
    const T: TerrainFeature = { type: 'street', points: [{ s: 300, d: 0 }, { s: 300, d: 60 }], width: 8 };
    const tNet = buildTrafficNetwork(terrainWith([MAIN, T]));
    expect(tNet.junctions).toHaveLength(1);
    expect(tNet.junctions[0].legs).toHaveLength(3);
    expect(tNet.junctions[0].signalised).toBe(true);
    // The stem's far end is a dead end: its lane turns round into the opposite one.
    const uturns = tNet.paths.filter((p) => p.kind === 'uturn');
    expect(uturns).toHaveLength(3); // the stem's end and both ends of the main road
    const L1: TerrainFeature = { type: 'street', points: [{ s: 100, d: 0 }, { s: 200, d: 0 }], width: 6 };
    const L2: TerrainFeature = { type: 'street', points: [{ s: 200, d: 0 }, { s: 200, d: 50 }], width: 6 };
    const lNet = buildTrafficNetwork(terrainWith([L1, L2]));
    expect(lNet.junctions).toHaveLength(1);
    expect(lNet.junctions[0].legs).toHaveLength(2);
    expect(lNet.junctions[0].signalised).toBe(false);
    // A gravel crossroads is not signalised; a street can force lights on.
    const gravel = buildTrafficNetwork(terrainWith([{ ...MAIN, surface: 'gravel' }, CROSS]));
    expect(gravel.junctions[0].signalised).toBe(false);
    const forcedCross: TerrainFeature = { ...CROSS, signals: true } as TerrainFeature;
    const forced = buildTrafficNetwork(terrainWith([{ ...MAIN, surface: 'gravel' }, forcedCross]));
    expect(forced.junctions[0].signalised).toBe(true);
  });

  it('reads a straight road shorter than it is wide as a cross street', () => {
    const strip: TerrainFeature = { type: 'road', s0: 296, s1: 304, d: 0, width: 120 };
    const net = buildTrafficNetwork(terrainWith([MAIN, strip]));
    expect(net.junctions).toHaveLength(1);
    expect(net.junctions[0].legs).toHaveLength(4);
  });

  it('cycles each signal phase green, amber, red with an all-red clearance', () => {
    const J = buildTrafficNetwork(terrainWith([MAIN, CROSS])).junctions[0];
    let greens = 0;
    for (let t = 0; t < J.cycle; t += 0.05) {
      const a = signalState(J, 0, t);
      const b = signalState(J, 1, t);
      expect(a === 'red' || b === 'red').toBe(true);
      if (a === 'green' || b === 'green') greens++;
    }
    expect(greens * 0.05).toBeCloseTo(J.greens[0] + J.greens[1], 0);
    const t0 = 5;
    const wait = timeToGreen(J, 1, t0);
    expect(signalState(J, 1, t0 + wait + 0.01)).toBe('green');
    if (wait > 0.1) expect(signalState(J, 1, t0 + wait - 0.05)).not.toBe('green');
  });
});

describe('traffic', () => {
  const net = buildTrafficNetwork(terrainWith([MAIN, CROSS]));
  const J = net.junctions[0];

  it('is deterministic: the same vehicles on the same network drive the same poses', () => {
    const run = (): number[] => {
      const t = spawn(net, [
        { x: -2, z: 60 },
        { x: -2, z: 120, kind: 'truck' },
        { x: 2, z: 500, hz: -1 },
        { x: 40, z: 302, hx: -1, hz: 0 },
        { x: -40, z: 298, hx: 1, hz: 0, kind: 'bus' },
      ]);
      for (let k = 0; k < 60 * 90; k++) t.step(1 / 60);
      return [...t.x, ...t.z, ...t.qy, ...t.v];
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.every(Number.isFinite)).toBe(true);
  });

  it('drives at plausible speeds: cars 10-14 m/s, trucks and buses slower', () => {
    const t = spawn(net, [
      { x: -2, z: 45 },
      { x: 2, z: 555, hz: -1, kind: 'truck' },
    ]);
    let carTop = 0;
    let truckTop = 0;
    for (let k = 0; k < 60 * 20; k++) {
      t.step(1 / 60);
      carTop = Math.max(carTop, t.v[0]);
      truckTop = Math.max(truckTop, t.v[1]);
    }
    expect(carTop).toBeGreaterThan(10);
    expect(carTop).toBeLessThan(14);
    expect(truckTop).toBeGreaterThan(8);
    expect(truckTop).toBeLessThanOrEqual(10.01);
  });

  it('queues behind the vehicle ahead and stops at a red light, going on green', () => {
    // Three cars driving +z toward the junction; find a time its phase turns red.
    const up = net.paths[nearestLane(net, -2, 200, 0, 1, 5)!.path];
    const group = J.legs[up.leg].group;
    const t = spawn(net, [{ x: -2, z: 262 }, { x: -2, z: 250 }, { x: -2, z: 238 }]);
    // Run the clock to just after this phase turns red.
    t.time = (J.cycle * 4 - J.offset) % J.cycle;
    while (signalState(J, group, t.time) !== 'red') t.time += 0.1;
    let stopped = false;
    let minGap = Infinity;
    for (let k = 0; k < 60 * 60 && !stopped; k++) {
      t.step(1 / 60);
      for (let i = 0; i + 1 < 3; i++) {
        if (t.path[i] === t.path[i + 1]) minGap = Math.min(minGap, t.arc[i] - t.arc[i + 1] - 4.2);
      }
      const red = signalState(J, group, t.time) === 'red';
      // (They start from rest: wait until they have driven up to the line.)
      if (k > 120 && red && t.v.every((v) => v < 0.05) && t.path.every((p) => p === up.id)) stopped = true;
    }
    expect(stopped).toBe(true);
    // The first car waits at its stop line, the others queue behind it, all on the lane.
    expect(up.length - t.arc[0]).toBeLessThan(4.2 / 2 + TRAFFIC_TUNING.stopLineGap + 1.5);
    expect(t.arc[0] - t.arc[1]).toBeGreaterThan(4.2 + 1.5);
    expect(t.arc[0] - t.arc[1]).toBeLessThan(4.2 + 4);
    expect(minGap).toBeGreaterThan(0.5);
    // Green: they all go through.
    const wait = timeToGreen(J, group, t.time);
    for (let k = 0; k < (wait + 25) * 60; k++) t.step(1 / 60);
    expect(t.path.every((p) => p !== up.id)).toBe(true);
  });

  it('turns round at a dead end and comes back on the other lane', () => {
    const t = spawn(net, [{ x: -2, z: 520 }]);
    const start = t.path[0];
    let uturned = false;
    for (let k = 0; k < 60 * 30; k++) {
      t.step(1 / 60);
      if (net.paths[t.path[0]].kind === 'uturn') uturned = true;
    }
    expect(uturned).toBe(true);
    expect(t.path[0]).not.toBe(start);
    // Heading back down-course (-z) now.
    expect(t.vz[0]).toBeLessThan(0);
  });

  it('brakes for an obstacle in its lane and stops short of it', () => {
    const env: TrafficEnv = {
      support: () => 0,
      scan: (_i, xs, _ys, zs, n) => {
        for (let k = 0; k < n; k++) if (Math.hypot(xs[k] + 2, zs[k] - 150) < 2) return k;
        return -1;
      },
    };
    const t = spawn(net, [{ x: -2, z: 60 }], env);
    let stopped = -1;
    for (let k = 0; k < 60 * 30 && stopped < 0; k++) {
      t.step(1 / 60);
      if (k > 60 && t.v[0] < 0.05) stopped = k;
    }
    expect(stopped).toBeGreaterThan(0);
    expect(t.z[0]).toBeLessThan(150 - 2.1 - TRAFFIC_TUNING.obstacleGap + 1);
    expect(t.z[0]).toBeGreaterThan(150 - 2.1 - TRAFFIC_TUNING.obstacleGap - 4);
    // It stands there until it turns round (turnBackAfter s).
    for (let k = 0; k < 60 * (TRAFFIC_TUNING.turnBackAfter - 1); k++) t.step(1 / 60);
    expect(t.v[0]).toBeLessThan(0.05);
    expect(t.turning[0]).toBe(0);
  });

  it('turns round before something that stays in its lane, backing away from it, and drives back', () => {
    // A lane blocked for good at z 150 (the iceberg's river across the road, fallen ice); a second car
    // queues behind the first.
    const env: TrafficEnv = {
      support: () => 0,
      scan: (_i, xs, _ys, zs, n) => {
        for (let k = 0; k < n; k++) if (Math.abs(zs[k] - 150) < 2 && xs[k] < 0) return k;
        return -1;
      },
    };
    const t = spawn(net, [{ x: -2, z: 100 }, { x: -2, z: 80 }], env);
    const up = t.path[0];
    let nearest = Infinity;
    let maxZ = -Infinity;
    let turnedAt = -1;
    let backedTo = Infinity;
    const wentBack = [false, false];
    for (let k = 0; k < 60 * 40; k++) {
      t.step(1 / 60);
      nearest = Math.min(nearest, Math.hypot(t.x[0] - t.x[1], t.z[0] - t.z[1]));
      maxZ = Math.max(maxZ, t.z[0], t.z[1]);
      if (t.turning[0] && turnedAt < 0) turnedAt = k / 60;
      if (t.turning[0]) backedTo = Math.min(backedTo, t.z[0]);
      for (const i of [0, 1]) if (t.path[i] !== up && !t.turning[i] && t.vz[i] < -1) wentBack[i] = true;
    }
    // The first turned round after standing turnBackAfter s, its half circle behind where it stood.
    expect(turnedAt).toBeGreaterThan(TRAFFIC_TUNING.turnBackAfter);
    expect(backedTo).toBeLessThan(150 - 2.1 - TRAFFIC_TUNING.obstacleGap - 1);
    // Neither ever reached the obstacle, and they never came closer than cars passing in opposite lanes.
    expect(maxZ).toBeLessThan(150 - 2.1);
    expect(nearest).toBeGreaterThan(3);
    // Both drove back down-course on the other lane.
    expect(wentBack).toEqual([true, true]);
  });

  it('two cars stopped either side of the same fallen ice both turn round (neither waits)', () => {
    // Ice across the whole road at z 150: one car comes up the course to it, one down.
    const env: TrafficEnv = {
      support: () => 0,
      scan: (_i, _xs, _ys, zs, n) => {
        for (let k = 0; k < n; k++) if (Math.abs(zs[k] - 150) < 2) return k;
        return -1;
      },
    };
    const t = spawn(net, [{ x: -2, z: 110 }, { x: 2, z: 190, hz: -1 }], env);
    const start = [t.path[0], t.path[1]];
    const turned = [false, false];
    const away = [false, false];
    for (let k = 0; k < 60 * 25; k++) {
      t.step(1 / 60);
      for (const i of [0, 1]) {
        if (t.turning[i]) turned[i] = true;
        // Heading back the way it came, away from the ice, on the other lane.
        const back = i === 0 ? t.vz[i] < -1 : t.vz[i] > 1;
        if (turned[i] && !t.turning[i] && t.path[i] !== start[i] && back) away[i] = true;
      }
    }
    expect(turned).toEqual([true, true]);
    expect(away).toEqual([true, true]);
  });

  it('never turns round into something standing in the road, and gives up rather than wait for good', () => {
    // Its lane blocked at z 150, and a bus lying across the other lane beside where it stops (x 0..5,
    // z 136..152; the Alpine Pass gorge route: the bus the iceberg knocks onto the pass road). Before,
    // the car turned round into the bus, found itself blocked inside it and turned back, every ~9 s.
    const asked: { x: number; z: number }[] = [];
    const env: TrafficEnv = {
      support: () => 0,
      scan: (_i, xs, _ys, zs, n) => {
        for (let k = 0; k < n; k++) if (Math.abs(zs[k] - 150) < 2 && xs[k] < 0) return k;
        return -1;
      },
      roomFor: (_i, x, z, hx, hz) => {
        asked.push({ x, z });
        // The car's box (4.2 × 1.8) against the bus's footprint, both axis-aligned enough here: test
        // the box's four corners and centre.
        const pts = [[0, 0], [2.1, 0.9], [2.1, -0.9], [-2.1, 0.9], [-2.1, -0.9]];
        return !pts.some(([a, c]) => {
          const px = x + a * hx + c * hz;
          const pz = z + a * hz - c * hx;
          return px > 0 && px < 5 && pz > 136 && pz < 152;
        });
      },
    };
    const t = spawn(net, [{ x: -2, z: 110 }], env);
    let stoppedAt = -1;
    let turned = false;
    let gaveUpAt = -1;
    for (let k = 0; k < 60 * 60 && gaveUpAt < 0; k++) {
      t.step(1 / 60);
      if (stoppedAt < 0 && k > 60 && t.v[0] < 0.05) stoppedAt = k / 60;
      if (t.turning[0]) turned = true;
      if (!t.active[0]) gaveUpAt = k / 60;
    }
    expect(turned).toBe(false);
    // It asked about points round its half circle (beside where it stood, between the two lanes).
    expect(asked.length).toBeGreaterThan(0);
    for (const p of asked) {
      expect(Math.abs(p.x)).toBeLessThan(2.1);
      expect(Math.abs(p.z - t.z[0])).toBeLessThan(2.1);
    }
    expect(t.gaveUp[0]).toBe(1);
    expect(gaveUpAt - stoppedAt).toBeGreaterThan(TRAFFIC_TUNING.giveUpAfter - 1);
    expect(gaveUpAt - stoppedAt).toBeLessThan(TRAFFIC_TUNING.giveUpAfter + 1);
    // Where it stopped, short of what blocks its lane.
    expect(t.z[0]).toBeLessThan(150 - 2.1 - TRAFFIC_TUNING.obstacleGap + 1);
  });

  it('turns round past something standing in the road when the half circle has room', () => {
    // The same lane blocked at z 150, a parked car on the other lane 20 m back (x 1..3, z 120..125).
    const env: TrafficEnv = {
      support: () => 0,
      scan: (_i, xs, _ys, zs, n) => {
        for (let k = 0; k < n; k++) if (Math.abs(zs[k] - 150) < 2 && xs[k] < 0) return k;
        return -1;
      },
      roomFor: (_i, x, z) => !(x > -1 && x < 5 && z > 118 && z < 127),
    };
    const t = spawn(net, [{ x: -2, z: 110 }], env);
    let turned = false;
    for (let k = 0; k < 60 * 20; k++) {
      t.step(1 / 60);
      if (t.turning[0]) turned = true;
    }
    expect(turned).toBe(true);
    expect(t.active[0]).toBe(1);
  });

  it('does not turn into a closed road while another way on is open', () => {
    // A T: the main road goes on up-course past the junction, the stem turns off to the right.
    const T: TerrainFeature = { type: 'street', points: [{ s: 300, d: 0 }, { s: 300, d: 60 }], width: 8 };
    const tNet = buildTrafficNetwork(terrainWith([MAIN, T]));
    const ahead = tNet.paths[nearestLane(tNet, -2, 400, 0, 1, 5)!.path];
    const stem = tNet.paths[nearestLane(tNet, -30, 302, -1, 0, 5)!.path];
    const cars = [0, 1, 2, 3, 4].map((k) => ({ x: -2, z: 250 - 14 * k }));
    /** The lane each car takes after the junction. */
    const after = (env: TrafficEnv): number[] => {
      const t = spawn(tNet, cars, env);
      const first = cars.map(() => -1);
      for (let k = 0; k < 90 * 60; k++) {
        t.step(1 / 60);
        for (let i = 0; i < t.count; i++) {
          const p = t.path[i];
          if (first[i] < 0 && (p === ahead.id || p === stem.id)) first[i] = p;
        }
      }
      return first;
    };
    const open = after(flatEnv);
    expect(open.every((p) => p >= 0)).toBe(true);
    expect(open.filter((p) => p === ahead.id).length).toBeGreaterThan(0);
    // Something stands in the main road beyond the junction: everyone takes the stem.
    const shut = after({ support: () => 0, closed: (p) => p.id === ahead.id });
    expect(shut).toEqual(cars.map(() => stem.id));
    // With every way on closed they still pick one (the usual weighted choice), never none.
    const all = after({ support: () => 0, closed: (p) => p.id === ahead.id || p.id === stem.id });
    expect(all).toEqual(open);
  });

  it('enters a lane shorter than a car once it is empty (junctions a few metres apart)', () => {
    // Two cross streets 17.5 m apart: the main road's lane between them is 5.5 m long (each junction
    // takes 6 m), less than a car needs (4.2 m + the 2 m gap). Only the first junction has lights.
    const near: TerrainFeature = {
      type: 'street',
      points: [
        { s: 317.5, d: -70 },
        { s: 317.5, d: 70 },
      ],
      width: 8,
    };
    const n2 = buildTrafficNetwork(terrainWith([MAIN, CROSS, near]));
    const link = n2.paths[nearestLane(n2, -2, 308.75, 0, 1, 3)!.path];
    expect(link.kind).toBe('lane');
    expect(link.length).toBeLessThan(4.2 + TRAFFIC_TUNING.minGap);
    const cars = [0, 1, 2, 3, 4, 5].map((k) => ({ x: -2, z: 280 - 14 * k }));
    const t = spawn(n2, cars);
    const still = cars.map(() => 0);
    let longest = 0;
    let through = 0;
    for (let k = 0; k < 120 * 60; k++) {
      t.step(1 / 60);
      for (let i = 0; i < t.count; i++) {
        still[i] = t.v[i] < 0.2 ? still[i] + 1 / 60 : 0;
        longest = Math.max(longest, still[i]);
      }
      if (t.path.some((p) => p === link.id)) through++;
    }
    // Cars went on through the short lane, and nobody waited at the first junction for good.
    expect(through).toBeGreaterThan(0);
    expect(longest).toBeLessThan(45);
  });

  it('follows slopes: pitched to the road and standing on it', () => {
    const slope = 0.08;
    const hill = terrainWith([MAIN], (_x, z) => 50 - slope * z);
    const env: TrafficEnv = { support: (x, z) => hill.heightAt(x, z) };
    const t = spawn(buildTrafficNetwork(hill), [{ x: -2, z: 100 }], env);
    for (let k = 0; k < 60 * 5; k++) t.step(1 / 60);
    expect(t.y[0]).toBeCloseTo(hill.heightAt(t.x[0], t.z[0]), 1);
    // Driving downhill (+z): the front is lower, so the velocity points down.
    expect(t.vy[0]).toBeLessThan(0);
    expect(t.vy[0] / Math.hypot(t.vx[0], t.vz[0])).toBeCloseTo(-slope, 2);
  });
});
