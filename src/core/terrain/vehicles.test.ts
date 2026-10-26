import { describe, expect, it } from 'vitest';
import type { LevelDef, ObstaclePlacement, TerrainFeature } from '../types';
import { createTerrain } from './terrain';
import { parkingAt, roadLineAt } from './roads';
import { trafficLines } from '../obstacles/bridges';
import {
  validateLevel,
  validateVehiclePlacements,
  VEHICLE_RULES,
  vehicleCorners,
  vehiclePose,
  vehiclePoses,
  vehicleProblems,
} from './validate';
import { getTerrain } from '../session';
import { getLevel } from '../levels';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import { createPhysicsWorld, TRAFFIC_WORLD } from '../physics/world';

/**
 * The vehicle placement rule (validateVehiclePlacements): a car, truck or bus stands with its whole
 * footprint on a road, street or parking area and does not lean sideways, at the pose it really has
 * when the run starts (its spawn pose, or its lane pose when it drives in the road traffic). The old
 * rule judged the placement's centre point only, so a bus half on the verge, or parked across a
 * steep car park, passed it.
 *
 * Synthetic valleys (s = z, d = −x): the town valley of streets.test.ts (floor slope ≈ 0.087) and a
 * steep one (0.2).
 */

const level = (drop: number, features: TerrainFeature[], obstacles: ObstaclePlacement[]): LevelDef => ({
  id: `vehicles-${drop}`,
  index: 99,
  name: 'Vehicles',
  subtitle: 'test',
  seed: 7,
  bounds: { minX: -130, maxX: 130, minZ: -60, maxZ: 640 },
  cellSize: 2,
  seaLevel: -100,
  course: [
    { x: 0, z: 0, floor: 200, halfWidth: 40 },
    { x: 0, z: 300, floor: 200 - 300 * drop, halfWidth: 40 },
    { x: 0, z: 600, floor: 200 - 600 * drop, halfWidth: 40 },
  ],
  cliffs: [],
  wallHeight: 20,
  wallRamp: 15,
  startS: 20,
  coastS: 540,
  finishS: 570,
  obstacles,
  decor: { sceneryTreeDensity: 0, bushDensity: 0, grassTuftDensity: 0, pebbleDensity: 0 },
  features,
  theme: 'town',
});

const MAIN: TerrainFeature = { type: 'road', s0: 60, s1: 480, d: 0, width: 8 };

describe('vehicle placements: footprint and tilt', () => {
  it('wants the whole footprint on the paving, not just the centre', () => {
    const lot: TerrainFeature = { type: 'parking', s: 300, d: -25, length: 24, width: 10 };
    const obstacles: ObstaclePlacement[] = [
      { kind: 'bus', s: 150, d: -2, yaw: 0, parked: true }, // 0 at the kerb: fine
      // 1 centre 0.4 m past the edge (the old rule's margin is 0.5 m): half on the verge
      { kind: 'bus', s: 200, d: 4.4, yaw: 0, parked: true },
      // 2 at the car park's end: its front half beyond it
      { kind: 'car', s: 312, d: -25, yaw: 0, parked: true },
      { kind: 'truck', s: 300, d: -25, yaw: Math.PI / 2 }, // 3 across the car park (7.6 m of its 10 m): fine
      { kind: 'car', s: 250, d: 3.9, yaw: 0 }, // 4 drives: the traffic puts it on its lane, d +2
    ];
    const t = createTerrain(level(0.087, [MAIN, lot], obstacles));
    const issues = validateVehiclePlacements(t);
    expect(issues.map((i) => i.index)).toEqual([1, 2]);
    // (+d is right of travel down the course.)
    expect(issues[0].problem).toMatch(
      /^front right and rear right corners off the road or parking area \(up to 1\.\d m past/,
    );
    expect(issues[1].problem).toMatch(/^front left and front right corners off the road or parking area/);
    // The old rule (the centre within VEHICLE_RULES.margin of the paving) passed both.
    const lines = trafficLines(t);
    for (const i of issues) {
      const m = VEHICLE_RULES.margin;
      expect(roadLineAt(lines, i.s, i.d, m) >= 0 || parkingAt(t.level, i.s, i.d, m) >= 0).toBe(true);
    }
    // validateLevel reports them too.
    expect(validateLevel(t).filter((i) => i.area === 'obstacle').map((i) => i.index)).toEqual([1, 2]);
    // The driving car's pose is the traffic's, on its lane (right of travel: d ≈ +2).
    const pose = vehiclePoses(t)[4]!;
    expect(pose.driving).toBe(true);
    expect(t.course.project(pose.x, pose.z).d).toBeCloseTo(2, 0);
  });

  it('does not let a vehicle lean across a steep car park', () => {
    // The car park is levelled across and follows the 20 % valley along its length.
    const lot: TerrainFeature = { type: 'parking', s: 200, d: -20, length: 30, width: 16 };
    const obstacles: ObstaclePlacement[] = [
      { kind: 'bus', s: 200, d: -20, yaw: Math.PI / 2, parked: true }, // 0 across the slope: leans ≈ 0.5 m
      { kind: 'bus', s: 200, d: -20, yaw: 0, parked: true }, // 1 down the slope: level side to side
      { kind: 'car', s: 190, d: -25, yaw: Math.PI / 2 + 0.3 }, // 2 across the slope: leans ≈ 0.35 m
    ];
    const t = createTerrain(level(0.2, [lot], obstacles));
    const issues = validateVehiclePlacements(t);
    expect(issues.map((i) => i.index)).toEqual([0, 2]);
    expect(issues[0].problem).toMatch(
      /^tilts sideways: the ground falls 0\.\d\d m across its 2\.6 m width \(\d\d\.\d % > 12 %/,
    );
    // Measured on the footprint's corners at the bus's real pose.
    const bus = vehiclePoses(t)[0]!;
    const [fl, fr, rl, rr] = vehicleCorners(bus).map((k) => t.heightAt(k.x, k.z));
    const roll = Math.abs(fl + rl - fr - rr) / 2;
    expect(roll / (bus.maxX - bus.minX)).toBeGreaterThan(0.15);
    // The bus down the slope pitches (allowed: mountain roads are steep) but does not lean.
    const along = vehiclePoses(t)[1]!;
    const h = vehicleCorners(along).map((k) => t.heightAt(k.x, k.z));
    expect(Math.abs(h[0] + h[2] - h[1] - h[3]) / 2).toBeLessThan(0.05);
    expect(Math.abs(h[0] + h[1] - h[2] - h[3]) / 2).toBeGreaterThan(1.5);
  });

  it('judges each axle on its own, so twisted ground cannot hide behind an average', () => {
    // Alpine Pass's gorge lay-by, where a truck once stood on three wheels: level across its front
    // axle, about 20 % across its rear. The average of the two (the first version of this rule) passed it.
    const terrain = getTerrain(getLevel('alpine-pass'));
    const truck: ObstaclePlacement = { kind: 'truck', s: 454.5, d: 111.25, yaw: Math.PI };
    const pose = vehiclePose(terrain, truck, 69)!;
    const [fl, fr, rl, rr] = vehicleCorners(pose).map((k) => terrain.heightAt(k.x, k.z));
    const width = pose.maxX - pose.minX;
    expect(Math.abs(rl - rr) / width).toBeGreaterThan(VEHICLE_RULES.maxRoll);
    expect(Math.abs(fl + rl - fr - rr) / 2 / width).toBeLessThan(VEHICLE_RULES.maxRoll);
    expect(vehicleProblems(terrain, truck).some((p) => p.startsWith('tilts sideways'))).toBe(true);
  });
});

describe('vehicle poses agree with the physics world', () => {
  // The traffic test's analytic valley: a 0.03 slope, a main road along the course and a cross street.
  const CROSS: TerrainFeature = { type: 'street', points: [{ s: 200, d: -60 }, { s: 200, d: 60 }], width: 8 };
  const obstacles: ObstaclePlacement[] = [
    { kind: 'car', s: 120, d: 2, yaw: 0 }, // drives up the course
    { kind: 'truck', s: 280, d: -2.6, yaw: Math.PI - 0.2 }, // drives down it, snapped onto its lane
    { kind: 'car', s: 60, d: -2, yaw: Math.PI, parked: true }, // parked
    { kind: 'bus', s: 200, d: -40, yaw: -Math.PI / 2 }, // drives along the cross street
    { kind: 'car', s: 100, d: 40 }, // in a field, no yaw: stands as the seed turns it
    { kind: 'truck', s: 330, d: 2, parked: true }, // parked on the road, no yaw
  ];
  const terrain = createAnalyticTerrain({
    height: (_x, z) => 60 - 0.03 * z,
    halfWidth: 70,
    width: 200,
    length: 420,
    cellSize: 2,
    level: { obstacles, features: [{ type: 'road', s0: 30, s1: 380, d: 0, width: 8 }, CROSS], theme: 'town' },
  });

  it('mirrors setupTraffic: which vehicles drive and where the traffic puts them', async () => {
    expect(VEHICLE_RULES.driveMargin).toBe(TRAFFIC_WORLD.roadMargin);
    expect(VEHICLE_RULES.laneReach).toBe(TRAFFIC_WORLD.laneReach);
    const poses = vehiclePoses(terrain);
    const w = await createPhysicsWorld(terrain, { seed: terrain.level.seed });
    const vehicles = w.bodies.filter((b) => b.placement >= 0 && ['car', 'truck', 'bus'].includes(b.kind));
    expect(vehicles).toHaveLength(obstacles.length);
    expect(vehicles.filter((b) => b.driven).map((b) => b.placement)).toEqual([0, 1, 3]);
    for (const b of vehicles) {
      const pose = poses[b.placement]!;
      expect(pose.driving, `placement ${b.placement}`).toBe(Boolean(b.driven));
      // Driving: the traffic's pose. Standing: where it spawned, settled in warm-up (a few cm).
      expect(Math.hypot(pose.x - b.pos.x, pose.z - b.pos.z), `placement ${b.placement}`).toBeLessThan(0.3);
      const q = b.quat;
      const hx = 2 * (q.x * q.z + q.w * q.y);
      const hz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const facing = (pose.hx * hx + pose.hz * hz) / Math.hypot(hx, hz);
      expect(facing, `placement ${b.placement}`).toBeGreaterThan(0.999);
    }
    w.dispose();
  });
});
