import { len2 } from './math';
import type { IntroKind, IntroStage } from './intro';
import type { GameSession } from './session';
import type { FailReason, GameEvent, GamePhase, RoutePoint, RunStats, Vec3 } from './types';

/**
 * A read-only, serialisable view of a running level — the interface future tools/agents use to
 * inspect gameplay without reaching into renderer or physics internals.
 */
export interface GameSnapshot {
  levelId: string;
  phase: GamePhase;
  /** Seconds of active play. */
  time: number;
  position: Vec3;
  velocity: Vec3;
  /** Horizontal speed (m/s). */
  speed: number;
  /** Mass × speed (tonne·m/s). */
  momentum: number;
  heading: number;
  steeringInput: { steer: number; source: string };
  appliedSteer: number;
  grounded: boolean;
  inOcean: boolean;
  /** Terrain slope magnitude under the iceberg (rise/run). */
  slope: number;
  /** 0..1 how close the stuck timer is to failing the run. */
  stuck: number;
  /** 0..1 from start to finish line. */
  progress: number;
  /** Course coordinates of the iceberg. */
  course: { s: number; d: number };
  distance: number;
  stats: RunStats;
  outcome: 'inProgress' | 'won' | 'lost';
  failReason: FailReason | null;
  riverLength: number;
  riverSamples: number;
  /**
   * Ice relative to the level's starting iceberg: 1 as spawned, lower as it melts or chips (0 =
   * melted away), above 1 after absorbing glacier ice (up to params.maxIce).
   */
  ice: number;
  /** Size multiplier (minSize..1 melting, cbrt(ice) grown) on visuals, collision radius, river width. */
  size: number;
  /** Current mass (t) = params.mass × ice. */
  mass: number;
  /** Current horizontal collision radius (m) = params.radius × size. */
  radius: number;
  /** Tonnes of glacier ice absorbed so far, and the heaviest the iceberg has been (t). */
  absorbed: number;
  peakMass: number;
  /** The level-start sequence (flyover, calving off the glacier): kind, stage, seconds in, length. */
  intro: { kind: IntroKind; stage: IntroStage; time: number; total: number };
}

export function getSnapshot(session: GameSession): GameSnapshot {
  const ice = session.iceberg;
  const speed = len2(ice.vel.x, ice.vel.z);
  const g = session.terrain.gradientAt(ice.pos.x, ice.pos.z);
  const stuck = session.params.stuckTime > 0 ? Math.min(1, ice.stuckTimer / session.params.stuckTime) : 0;
  return {
    levelId: session.level.id,
    phase: session.phase,
    time: session.stats.time,
    position: { ...ice.pos },
    velocity: { ...ice.vel },
    speed,
    momentum: ice.mass * speed,
    heading: ice.heading,
    steeringInput: { ...session.lastInput },
    appliedSteer: ice.steer,
    grounded: ice.grounded,
    inOcean: ice.inOcean,
    slope: len2(g.dx, g.dz),
    stuck,
    progress: session.progress,
    course: session.terrain.course.project(ice.pos.x, ice.pos.z),
    distance: session.stats.distance,
    stats: { ...session.stats },
    outcome: session.phase === 'complete' ? 'won' : session.phase === 'failed' ? 'lost' : 'inProgress',
    failReason: session.failReason,
    riverLength: session.river.length,
    riverSamples: session.river.samples.length,
    ice: ice.ice,
    size: ice.size,
    mass: ice.mass,
    radius: ice.radius,
    absorbed: session.stats.absorbed,
    peakMass: session.stats.peakMass,
    intro: {
      kind: session.introTimeline.kind,
      stage: session.introStage,
      time: session.introTime,
      total: session.introTimeline.total,
    },
  };
}

export interface RunLog {
  route: readonly RoutePoint[];
  events: readonly GameEvent[];
}

/** Full route and event history of the run (larger; for post-run analysis). */
export function getRunLog(session: GameSession): RunLog {
  return { route: session.route, events: session.events.log };
}
