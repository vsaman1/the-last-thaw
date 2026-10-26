/**
 * REAL headless story runs for the live agent evidence (docs/evidence/AGENT_RUNS.md): the real game
 * session (Rapier physics, the real terrain, the chapter's story level with its overlay) driven by the
 * game's own autopilot, optionally steered onto or away from named landmarks. The RunEvidence comes
 * from src/story/evidence.ts exactly as in the game. Tests and the live scripts only.
 */
import { autopilotSteer, lineOffsetAt, type AutopilotOptions } from '../../core/autopilot';
import { FIXED_DT, GameSession } from '../../core/session';
import { attachEventClock, buildRunEvidence } from '../../story/evidence';
import { fallbackReflection, selectFragments, toHistoryItem } from '../../story/select';
import { landmarkPlacement, storyLevel } from '../../story/storyLevel';
import type { ArchiveEntry, ChapterDef, HistoryItem, RunEvidence, StoredReflection } from '../../story/types';

/** How the autopilot is steered: its own line, or onto / away from landmarks of the chapter. */
export type SteerPlan =
  | { readonly kind: 'autopilot' }
  | { readonly kind: 'aim'; readonly landmarkIds: readonly string[] }
  | { readonly kind: 'avoid'; readonly landmarkIds: readonly string[]; readonly clearance?: number };

export interface PlayedRun {
  readonly chapterId: string;
  readonly plan: SteerPlan;
  readonly evidence: RunEvidence;
  /** Wall-clock seconds the headless run took. */
  readonly seconds: number;
}

const APPROACH = 90;

/**
 * Plays one chapter headless to the end (or `maxSeconds` of play) and returns its RunEvidence.
 * Aim: inside APPROACH m before a target landmark, steer (from the centreline, 'course' pursuit) to its
 * lateral offset; avoid: hold `clearance` m to the far side of it until just past it.
 */
export async function playChapter(chapter: ChapterDef, plan: SteerPlan, maxSeconds = 300): Promise<PlayedRun> {
  const t0 = Date.now();
  const level = storyLevel(chapter);
  const targets =
    plan.kind === 'autopilot'
      ? []
      : plan.landmarkIds.map((id) => {
          const lm = chapter.landmarks.find((l) => l.id === id);
          if (!lm) throw new Error(`no landmark ${id} in ${chapter.id}`);
          const o = level.obstacles[landmarkPlacement(chapter, lm)];
          if (!o) throw new Error(`landmark ${id} has no placement`);
          return { s: o.s, d: o.d };
        });
  const session = await GameSession.create({ level, skipIntro: true });
  try {
    const clock = attachEventClock(session);
    const line = session.terrain.level.line;
    const steps = Math.round(maxSeconds / FIXED_DT);
    for (let i = 0; i < steps && session.phase === 'playing'; i++) {
      const { s } = session.terrain.course.project(session.iceberg.pos.x, session.iceberg.pos.z);
      let opts: AutopilotOptions = {};
      const near = targets.find((t) => s > t.s - APPROACH && s < t.s + (plan.kind === 'avoid' ? 25 : 3));
      if (near && plan.kind === 'aim') opts = { followLine: false, pursuit: 'course', lane: near.d };
      if (near && plan.kind === 'avoid') {
        const clearance = plan.clearance ?? 22;
        const base = lineOffsetAt(line, near.s);
        // Pass on whichever side of the landmark the intended line is already on.
        opts = { followLine: false, pursuit: 'course', lane: base >= near.d ? near.d + clearance : near.d - clearance };
      }
      session.update(FIXED_DT, autopilotSteer(session.iceberg, session.terrain, opts));
    }
    const evidence = buildRunEvidence({ session, chapter, level, clock });
    return { chapterId: chapter.id, plan, evidence, seconds: (Date.now() - t0) / 1000 };
  } finally {
    session.dispose();
  }
}

/**
 * The archive entry the game would store for a run (src/state/storyStore.ts does the same with
 * selectFragments and either an approved AI reflection or the authored fallback).
 */
export function archiveEntry(
  chapter: ChapterDef,
  evidence: RunEvidence,
  history: readonly HistoryItem[],
  ai?: { readonly title?: string; readonly text: string; readonly fragmentIds: readonly string[]; readonly runId: string },
): ArchiveEntry {
  const reflection: StoredReflection = ai
    ? { source: 'ai', title: ai.title, text: ai.text, fragmentIds: ai.fragmentIds, factIds: [], validated: true, traceId: ai.runId }
    : fallbackReflection(chapter, evidence, history);
  return {
    chapterId: chapter.id,
    completedAt: new Date(0).toISOString(),
    attempts: 1,
    evidence,
    fragmentIds: selectFragments(chapter, evidence, history).map((f) => f.id),
    reflection,
  };
}

export { toHistoryItem };
