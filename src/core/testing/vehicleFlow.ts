import type { CourseCoord, LevelDef } from '../types';
import { autopilotSteer } from '../autopilot';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { createPhysicsWorld, type ObstacleBody, type PhysicsWorld } from '../physics/world';

/**
 * Measures what a player sees of a level's road vehicles in the real physics world (the level's
 * own seed, traffic on, no iceberg near): whether any two vehicles' collider boxes overlap (spawned
 * inside each other, driven into each other, or turned round into one the iceberg knocked over), and whether the traffic keeps moving (each driving
 * vehicle's longest standstill). Used by the vehicle tests of the levels and of the story chapters.
 */

const VEHICLE_KINDS = new Set(['car', 'truck', 'bus']);

/** A vehicle is standing still below this speed (m/s). */
const STILL = 0.2;

export interface VehicleOverlap {
  /** Seconds into the run. */
  readonly t: number;
  /** Level placements of the two vehicles and how far their footprints overlap (m). */
  readonly a: number;
  readonly b: number;
  readonly depth: number;
}

export interface VehicleStop {
  readonly placement: number;
  readonly kind: string;
  /** Longest time (s) it stood still, where (course s, d), and whether something stood in its lane. */
  readonly longest: number;
  readonly s: number;
  readonly d: number;
  readonly obstacle: boolean;
  /** Metres it drove in the run. */
  readonly driven: number;
  /** It gave up (stood before something in its lane with no way round) and was parked. */
  readonly gaveUp: boolean;
}

export interface VehicleFlowReport {
  readonly vehicles: number;
  readonly driving: number;
  /** Seconds measured, and how a played run ended (null: the physics world alone). */
  readonly seconds: number;
  readonly phase: string | null;
  readonly overlaps: readonly VehicleOverlap[];
  /** Smallest gap (m) between any two vehicles' footprints at each of `checkpoints` (s). */
  readonly minGap: Readonly<Record<number, number>>;
  /** Vehicles moving faster than STILL at each checkpoint. */
  readonly moving: Readonly<Record<number, number>>;
  readonly stops: readonly VehicleStop[];
}

type V3 = [number, number, number];

/** A body's collider box as it stands: centre, unit axes (local x, y, z in world) and half extents. */
interface Box {
  readonly c: V3;
  readonly u: readonly [V3, V3, V3];
  readonly h: V3;
}

/** The oriented box of a body's collider bounds (localMin/localMax × renderScale) in its full pose. */
function boxOf(b: ObstacleBody): Box {
  const { x, y, z, w } = b.quat;
  const r = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const k = b.renderScale;
  const lo = b.localMin;
  const hi = b.localMax;
  const lc: V3 = [((lo.x + hi.x) / 2) * k, ((lo.y + hi.y) / 2) * k, ((lo.z + hi.z) / 2) * k];
  const h: V3 = [((hi.x - lo.x) / 2) * k, ((hi.y - lo.y) / 2) * k, ((hi.z - lo.z) / 2) * k];
  const p = [b.pos.x, b.pos.y, b.pos.z];
  const c = [0, 1, 2].map((i) => p[i] + r[i][0] * lc[0] + r[i][1] * lc[1] + r[i][2] * lc[2]) as V3;
  const u = [0, 1, 2].map((j) => [r[0][j], r[1][j], r[2][j]] as V3) as unknown as [V3, V3, V3];
  return { c, u, h };
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const reach = (x: Box, L: V3): number =>
  x.h[0] * Math.abs(dot(x.u[0], L)) + x.h[1] * Math.abs(dot(x.u[1], L)) + x.h[2] * Math.abs(dot(x.u[2], L));

/**
 * Separation of two oriented boxes along the 15 separating axes (each box's three face normals and
 * the nine cross products of their edges): positive = apart by at least that much (m), negative =
 * overlapping at least that deep. Exact for any orientation: a vehicle the iceberg knocked onto its
 * side is judged as it lies (the yaw-only plan footprint this replaced misjudged a toppled bus).
 */
export function boxSeparation(a: Box, b: Box): number {
  const d: V3 = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]];
  const axes: V3[] = [...a.u, ...b.u];
  for (const p of a.u) {
    for (const q of b.u) {
      const c: V3 = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const l = Math.hypot(c[0], c[1], c[2]);
      if (l > 1e-6) axes.push([c[0] / l, c[1] / l, c[2] / l]);
    }
  }
  let best = -Infinity;
  for (const L of axes) {
    const ra = reach(a, L);
    const rb = reach(b, L);
    best = Math.max(best, Math.abs(dot(d, L)) - ra - rb);
  }
  return best;
}

/** boxSeparation of two bodies' collider boxes as they stand. */
export function bodySeparation(a: ObstacleBody, b: ObstacleBody): number {
  return boxSeparation(boxOf(a), boxOf(b));
}

/**
 * Runs the level's physics world for `seconds` and reports overlaps (checked every quarter second)
 * and standstills (every step). `play`: a real session instead, the autopilot riding the level's line
 * (the iceberg on the course, its meltwater river across the roads it crosses) until the run ends or
 * `seconds` pass; `route`: the same along another route (course points) than the line.
 */
export async function measureVehicleFlow(
  level: LevelDef,
  opts: {
    seconds?: number;
    checkpoints?: readonly number[];
    play?: boolean;
    route?: readonly CourseCoord[];
  } = {},
): Promise<VehicleFlowReport> {
  const seconds = opts.seconds ?? 120;
  const checkpoints = opts.checkpoints ?? [0, 10, 30, 60, 120];
  const terrain = getTerrain(level);
  // Another route than the line: the autopilot steers along it (the world is the level's own).
  const route = opts.route;
  const steerBy = route ? { ...terrain, level: { ...terrain.level, line: [...route] } } : terrain;
  const session =
    opts.play || route ? await GameSession.create({ level, skipIntro: true, terrain: steerBy }) : null;
  const w = session
    ? (session.physics as PhysicsWorld)
    : await createPhysicsWorld(terrain, { seed: level.seed });
  const advance = (): boolean => {
    if (!session) {
      w.step(FIXED_DT);
      return true;
    }
    if (session.phase !== 'playing') return false;
    session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain));
    return true;
  };
  const t = w.traffic;
  const vehicles = w.bodies.filter((b) => b.placement >= 0 && VEHICLE_KINDS.has(b.kind));
  const overlaps: VehicleOverlap[] = [];
  const minGap: Record<number, number> = {};
  const moving: Record<number, number> = {};
  const n = t ? t.count : 0;
  const run = new Float64Array(n);
  const longest = new Float64Array(n);
  const driven = new Float64Array(n);
  const at: { s: number; d: number; obstacle: boolean }[] = Array.from({ length: n }, () => ({
    s: NaN,
    d: NaN,
    obstacle: false,
  }));

  const check = (time: number): void => {
    const boxes = vehicles.map((b) => (b.active ? boxOf(b) : null));
    let gap = Infinity;
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const ba = boxes[i];
        const bb = boxes[j];
        if (!ba || !bb) continue;
        const a = vehicles[i];
        const b = vehicles[j];
        const apart = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
        if (apart > a.boundingRadius + b.boundingRadius + 2) continue;
        const sep = boxSeparation(ba, bb);
        gap = Math.min(gap, sep);
        if (sep < 0) overlaps.push({ t: time, a: a.placement, b: b.placement, depth: -sep });
      }
    }
    if (checkpoints.includes(time)) {
      minGap[time] = gap;
      let k = 0;
      if (t) for (let i = 0; i < n; i++) if (t.active[i] && t.v[i] > STILL) k++;
      moving[time] = k;
    }
  };

  check(0);
  let steps = 0;
  outer: for (let sec = 1; sec <= seconds; sec++) {
    for (let k = 0; k < 60; k++) {
      if (!advance()) break outer;
      steps++;
      if (k % 15 === 14 && k !== 59) check(steps / 60);
      if (!t) continue;
      for (let i = 0; i < n; i++) {
        if (!t.active[i]) continue;
        driven[i] += t.v[i] * FIXED_DT;
        if (t.v[i] >= STILL) {
          run[i] = 0;
          continue;
        }
        run[i] += FIXED_DT;
        if (run[i] > longest[i]) {
          longest[i] = run[i];
          const c = terrain.course.project(t.x[i], t.z[i]);
          at[i] = { s: c.s, d: c.d, obstacle: Number.isFinite(t.blocked[i]) };
        }
      }
    }
    check(sec);
  }
  const stops: VehicleStop[] = [];
  for (let i = 0; i < n; i++) {
    const b = w.bodies[t!.body[i]];
    stops.push({
      placement: b.placement,
      kind: b.kind,
      longest: longest[i],
      ...at[i],
      driven: driven[i],
      gaveUp: t!.gaveUp[i] === 1,
    });
  }
  const report = {
    vehicles: vehicles.length,
    driving: n,
    seconds: steps / 60,
    phase: session?.phase ?? null,
    overlaps,
    minGap,
    moving,
    stops,
  };
  if (session) session.dispose();
  else w.dispose();
  return report;
}

/** Longest a driving vehicle may stand still (s): a red light and the queue behind it. */
export const MAX_STANDSTILL = 45;

/** Vehicles that stood still longer than MAX_STANDSTILL. */
export function longStops(r: VehicleFlowReport): VehicleStop[] {
  return r.stops.filter((s) => s.longest > MAX_STANDSTILL);
}

/** One line per vehicle that stood still longer than `limit` s (for test messages). */
export function describeStops(r: { stops: readonly VehicleStop[] }, limit: number): string {
  return r.stops
    .filter((s) => s.longest > limit)
    .map(
      (s) =>
        `#${s.placement} ${s.kind} stood ${s.longest.toFixed(1)} s at s ${s.s.toFixed(0)} ` +
        `d ${s.d.toFixed(0)}${s.obstacle ? ' (something in its lane)' : ''}, drove ${s.driven.toFixed(0)} m`,
    )
    .join('; ');
}
