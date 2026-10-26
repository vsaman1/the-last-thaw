/**
 * The bridge between a running GameSession and Story Mode. GameView hands every story session to
 * attachStorySession(), which
 * - times events as they happen (attachEventClock) and keeps the live story points for the HUD,
 * - on completion builds RunEvidence from the real session, selects the authored fragments, records
 *   the Archive entry AT ONCE with the authored reflection (progress survives quitting), and — when
 *   the narrative is on and the player's AI preference asks for this chapter — requests the agents'
 *   reflection, swapping it in only if it comes back approved and validated,
 * - on failure counts the attempt and picks the one document written for a failed run, if the chapter has
 *   one, for the fail panel (shown, never archived: nothing is until a run reaches the sea).
 * The epilogue after chapter 9 is started from the revelation panel (startEpilogue).
 *
 * Nothing here touches the session's simulation; it only listens.
 */
import { create } from 'zustand';
import type { GameSession } from '../../core/session';
import { useStoryStore } from '../../state/storyStore';
import { CHAPTERS } from '../../story/chapters';
import { reflectionFor, requestEpilogue, storedFromResult, wantsAi } from '../../story/client';
import { attachEventClock, buildRunEvidence } from '../../story/evidence';
import { StoryPointsTracker, type ScoredBody } from '../../story/scoring';
import { composeEpilogue, failedRunDocument, fallbackReflection, historyBefore, selectFragments } from '../../story/select';
import { landmarkIndex } from '../../story/storyLevel';
import type {
  ArchiveFragment,
  ChapterDef,
  NarrativeFailure,
  NarrativeResponse,
  NarrativeResult,
  HistoryItem,
  RunEvidence,
  StoredReflection,
  StoryModelId,
} from '../../story/types';
import type { LevelDef } from '../../core/types';

/** A reflection or epilogue as the panels show it. */
export interface NarrativeState {
  readonly status: 'pending' | 'ready';
  /** The text shown now: the authored one until (unless) the agents' arrives. */
  readonly reflection: StoredReflection;
  readonly result?: NarrativeResult;
  readonly failure?: NarrativeFailure;
}

export interface RunOutcome {
  readonly chapterId: ChapterDef['id'];
  readonly completedAt: string;
  readonly evidence: RunEvidence;
  readonly fragments: readonly ArchiveFragment[];
  readonly narrative: NarrativeState;
}

/**
 * A named place of the chapter that just broke in the run on screen: the in-run notice
 * (StoryGame.tsx StoryLandmarkNotice) names it, with its label, the first time any of its placements
 * breaks. `seq` counts the notices of the run, so the same place never shows twice and a new one
 * replaces the last. `until` is when it goes (Date.now() ms), kept here rather than in the notice's
 * own state, so a notice that remounts (a pause, playtest 2 follow-up: the shepherd's hut came back
 * over a factory hall 860 m later) never shows an old place again.
 */
export interface LandmarkNotice {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly seq: number;
  readonly until: number;
}

/** How long a landmark notice stays (ms); CSS fades it in and out within this. */
export const LANDMARK_NOTICE_MS = 4500;

interface StoryRunState {
  /** Live story points of the run on screen (HUD). */
  points: number;
  /** The last named place that broke in this run (in-run notice), or null. */
  landmark?: LandmarkNotice | null;
  /** The completed run, once the session completes. */
  outcome: RunOutcome | null;
  /** The epilogue, once started after chapter 9. */
  epilogue: NarrativeState | null;
  /** After a failed run: the chapter's document written for a failure, for the fail panel (not archived). */
  failedDocument: ArchiveFragment | null;
}

export const useStoryRun = create<StoryRunState>(() => ({ points: 0, outcome: null, epilogue: null, failedDocument: null }));

interface BodyWorld {
  getBody(id: number): ScoredBody | undefined;
}
const hasGetBody = (p: unknown): p is BodyWorld =>
  typeof p === 'object' && p !== null && typeof (p as Partial<BodyWorld>).getBody === 'function';

/** Watch a story session; returns the cleanup GameView calls when the attempt ends. */
export function attachStorySession(session: GameSession, chapter: ChapterDef, level: LevelDef): () => void {
  useStoryRun.setState({ points: 0, outcome: null, epilogue: null, failedDocument: null, landmark: null });
  const clock = attachEventClock(session);
  const physics = session.physics;
  const body = (id: number): ScoredBody | undefined => (hasGetBody(physics) ? physics.getBody(id) : undefined);
  const tracker = new StoryPointsTracker(body);
  // Placement → landmark, for the in-run notice (playtest 2 review: the Calder processing plant broke
  // in the first three seconds with nothing on screen but "-2% ice" and the knocked count).
  const named = landmarkIndex(chapter);
  const announced = new Set<string>();
  let seq = 0;
  const offEvents = session.events.on((e) => {
    if (tracker.add(e)) useStoryRun.setState({ points: tracker.points });
    if (e.type !== 'obstacleBroken') return;
    const placement = body(e.obstacleId)?.placement ?? -1;
    const id = placement >= 0 ? named.get(placement) : undefined;
    const lm = id ? chapter.landmarks.find((l) => l.id === id) : undefined;
    if (!lm || announced.has(lm.id)) return;
    announced.add(lm.id);
    useStoryRun.setState({
      landmark: {
        id: lm.id,
        name: lm.name,
        ...(lm.label ? { label: lm.label } : {}),
        seq: ++seq,
        until: Date.now() + LANDMARK_NOTICE_MS,
      },
    });
  });
  const offPhase = session.onPhaseChange((phase) => {
    if (phase === 'complete') completeRun(session, chapter, level, clock);
    else if (phase === 'failed') failRun(session, chapter, level, clock);
  });
  return () => {
    offEvents();
    offPhase();
    clock.dispose();
  };
}

function failRun(session: GameSession, chapter: ChapterDef, level: LevelDef, clock: ReturnType<typeof attachEventClock>): void {
  const store = useStoryStore.getState();
  store.recordFailure(chapter.id);
  // Never in the way of the fail panel: a document that cannot be chosen is simply not shown.
  try {
    const evidence = buildRunEvidence({ session, chapter, level, clock });
    const doc = failedRunDocument(chapter, evidence, historyBefore(store.progress.archive, chapter.id));
    useStoryRun.setState({ failedDocument: doc ?? null });
  } catch {
    useStoryRun.setState({ failedDocument: null });
  }
}

function completeRun(
  session: GameSession,
  chapter: ChapterDef,
  level: LevelDef,
  clock: ReturnType<typeof attachEventClock>,
): void {
  const evidence = buildRunEvidence({ session, chapter, level, clock });
  const store = useStoryStore.getState();
  const { settings } = store.progress;
  const history = historyBefore(store.progress.archive, chapter.id);
  const fragments = selectFragments(chapter, evidence, history);
  const completedAt = new Date().toISOString();
  const askAi = settings.narrative && wantsAi(chapter, settings.ai);
  const authoredOnly = fallbackReflection(chapter, evidence, history);
  store.recordChapter({
    chapterId: chapter.id,
    completedAt,
    evidence,
    fragmentIds: fragments.map((f) => f.id),
    reflection: authoredOnly,
  });
  useStoryRun.setState({
    points: evidence.storyPoints,
    outcome: {
      chapterId: chapter.id,
      completedAt,
      evidence,
      fragments,
      narrative: { status: askAi ? 'pending' : 'ready', reflection: authoredOnly },
    },
  });
  // The epilogue is asked for as soon as the last chapter is done, so the agents work while the player
  // reads this chapter's revelation: on real gameplay an epilogue took 3.3 minutes (three Historian
  // reviews, lt-20261021-171905-232d7e). It needs only this run's evidence and the chapters before it.
  epiloguePrefetch = null;
  if (isLastChapter(chapter) && settings.narrative && settings.ai !== 'off') prefetchEpilogue(completedAt, evidence, history, settings.model);
  if (!askAi) return;
  void reflectionFor(chapter, evidence, history, settings).then((r) => {
    if (r.result) useStoryStore.getState().updateReflection(chapter.id, completedAt, r.reflection);
    const current = useStoryRun.getState().outcome;
    if (current?.completedAt !== completedAt) return; // the player moved on to another run
    useStoryRun.setState({
      outcome: {
        ...current,
        narrative: {
          status: 'ready',
          reflection: r.reflection,
          ...(r.result ? { result: r.result } : {}),
          ...(r.failure ? { failure: r.failure } : {}),
        },
      },
    });
  });
}

/** Counts started epilogues, so only the latest one's late answer is kept. */
let epilogueSeq = 0;

/** The epilogue request started when the last chapter completed (see completeRun), for that completion. */
let epiloguePrefetch: { completedAt: string; response: Promise<NarrativeResponse> } | null = null;

/** The story's last chapter (the epilogue follows it). */
export const isLastChapter = (chapter: ChapterDef): boolean => chapter.id === CHAPTERS[CHAPTERS.length - 1].id;

/**
 * Ask the agents now for the epilogue of the chapter 9 completion at completedAt, on the player's model
 * (by default the one in their settings now); startEpilogue picks the answer up.
 */
export function prefetchEpilogue(
  completedAt: string,
  evidence: RunEvidence,
  history: readonly HistoryItem[],
  model: StoryModelId = useStoryStore.getState().progress.settings.model,
): void {
  epiloguePrefetch = { completedAt, response: requestEpilogue({ evidence, history, model }) };
}

/**
 * Start the epilogue over the river view after chapter 9: the composed authored text at once, the
 * agents' personalised one instead if the preference allows and it comes back approved. Stored in the
 * Archive either way. The agents can take minutes; an answer for an epilogue that a later one has
 * replaced (chapter 9 replayed and finished again) is dropped, in the panel and in the Archive.
 */
export function startEpilogue(): void {
  const outcome = useStoryRun.getState().outcome;
  if (!outcome || useStoryRun.getState().epilogue) return;
  const seq = ++epilogueSeq;
  const store = useStoryStore.getState();
  const history = historyBefore(store.progress.archive, outcome.chapterId);
  const authored = composeEpilogue(outcome.evidence, history);
  const { narrative, ai, model } = store.progress.settings;
  const askAi = narrative && ai !== 'off';
  store.setEpilogue(authored);
  const started: NarrativeState = { status: askAi ? 'pending' : 'ready', reflection: authored };
  useStoryRun.setState({ epilogue: started });
  if (!askAi) return;
  const prefetched = epiloguePrefetch?.completedAt === outcome.completedAt ? epiloguePrefetch.response : null;
  epiloguePrefetch = null;
  void (prefetched ?? requestEpilogue({ evidence: outcome.evidence, history, model })).then((res) => {
    if (seq !== epilogueSeq) return; // a newer epilogue was started meanwhile
    const reflection = res.ok ? storedFromResult(res) : authored;
    if (res.ok) useStoryStore.getState().setEpilogue(reflection);
    if (useStoryRun.getState().epilogue !== started) return; // the panel has moved on to another run
    useStoryRun.setState({
      epilogue: { status: 'ready', reflection, ...(res.ok ? { result: res } : { failure: res }) },
    });
  });
}
