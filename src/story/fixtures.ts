/**
 * Small hand-written Story Mode fixtures for unit and UI tests (no physics; see ./testkit.ts for real
 * headless runs). Only tests import this module.
 */
import type { RunEvidence } from './types';

/** A plausible completed chapter 1 run: one landmark destroyed, one reached and intact, one not reached. */
export function evidenceFixture(patch: Partial<RunEvidence> = {}): RunEvidence {
  return {
    version: 1,
    chapterId: 'ch1-beginning',
    levelId: 'mountain-valley',
    outcome: 'complete',
    time: 80,
    distance: 900,
    topSpeed: 20,
    startMass: 30,
    endMass: 24,
    peakMass: 30,
    absorbed: 0,
    iceLeft: 0.8,
    waterfallsCrossed: 1,
    collisions: 4,
    treesFelled: 2,
    knockedDown: 3,
    buildingsDestroyed: 1,
    storyPoints: 260,
    destroyedByCategory: { home: 1, nature: 2 },
    destroyedByKind: { house: 1, pine: 2 },
    landmarks: [
      { id: 'mill', status: 'destroyed', closest: 2 },
      { id: 'chapel', status: 'intact', closest: 40 },
      { id: 'far-hut', status: 'notReached', closest: 300 },
    ],
    notable: [],
    route: [{ s: 0, d: 0 }],
    reachedS: 900,
    coastS: 950,
    ...patch,
  };
}
