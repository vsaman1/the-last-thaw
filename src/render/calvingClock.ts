import type { GameRuntime } from '../core/runtime';
import { INTRO_TIMING, calvingTimeAt } from '../core/intro';
import {
  type CalvingKeys,
  type CalvingState,
  calvingKeys,
  calvingStateAt,
  createCalvingState,
} from '../core/glacier/calving';
import type { GlacierPlacement } from '../core/glacier/glacier';

/** The calving as one renderer sees it this frame (each renderer keeps its own, allocation-free). */
export interface CalvingClock {
  /** The intro is not over yet: the calving is still to come or under way. */
  active: boolean;
  /** Seconds into the calving (0 during the flyover). */
  t: number;
  keys: CalvingKeys;
  state: CalvingState;
}

export function createCalvingClock(): CalvingClock {
  return { active: false, t: 0, keys: calvingKeys(INTRO_TIMING.calving), state: createCalvingState() };
}

/** Reads the runtime's intro clock into `clock` (the placement doubles as the slide geometry). */
export function readCalving(rt: GameRuntime, g: GlacierPlacement, clock: CalvingClock): CalvingClock {
  const tl = rt.introTimeline;
  clock.active = tl.calving > 0 && rt.introTime < tl.total;
  clock.t = calvingTimeAt(tl, rt.introTime);
  const duration = tl.calving > 0 ? tl.calving : INTRO_TIMING.calving;
  if (clock.keys.duration !== duration) clock.keys = calvingKeys(duration);
  calvingStateAt(clock.keys, clock.active ? clock.t : Infinity, g, clock.state);
  return clock;
}
