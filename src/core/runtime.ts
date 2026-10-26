import type { EventBus } from './events';
import { INTRO_TIMING, type IntroTimeline } from './intro';
import type { WaterSystem } from './water/system';
import type {
  FxEmitter,
  GamePhase,
  IcebergState,
  LevelDef,
  PhysicsWorldApi,
  RiverTrailApi,
  RoutePoint,
  RunStats,
  Terrain,
} from './types';

/**
 * Everything a running level exposes to renderers. Implemented by GameSession (src/core/session.ts).
 * One runtime per attempt: restarting a level builds a new runtime, so components keyed on it
 * remount cleanly. All fields are live — read them inside useFrame, never copy into React state.
 */
export interface GameRuntime {
  readonly level: LevelDef;
  readonly terrain: Terrain;
  /** Mutated in place every fixed step. */
  readonly iceberg: IcebergState;
  readonly river: RiverTrailApi;
  /** Streams, reservoirs, floods and captured rivers (src/core/water); null / absent: none. */
  readonly water?: WaterSystem | null;
  readonly physics: PhysicsWorldApi;
  readonly events: EventBus;
  /** Game clock (s). Advances in every phase except 'paused'; drives shader animation. */
  readonly time: number;
  readonly phase: GamePhase;
  /** Seconds since the current phase began. */
  readonly phaseTime: number;
  /**
   * 0..1 progress through the intro (flyover + calving; 1 once it completes, frozen where it was if
   * it was skipped).
   */
  readonly introProgress: number;
  /** This attempt's intro (flyover and calving lengths; see src/core/intro.ts). */
  readonly introTimeline: IntroTimeline;
  /**
   * Seconds into the intro (frozen while paused). introTimeline.total once play has begun, however
   * it began: the calving pose offsets read it, so they are 0 from the hand-off on.
   */
  readonly introTime: number;
  /** 0..1 progress from start to finish line along the course. */
  readonly progress: number;
  readonly stats: RunStats;
  readonly route: readonly RoutePoint[];
  /** The particle system registers itself here on mount; the session emits through it. */
  fx: FxEmitter | null;
}

/** Full intro length in seconds: course flyover + the iceberg calving off the glacier (Space skips). */
export const INTRO_DURATION = INTRO_TIMING.flyover + INTRO_TIMING.calving;
