/**
 * Story Mode progress and the Archive (zustand + localStorage), kept apart from Arcade progress
 * (src/state/progress.ts): a story completion never touches arcade records and vice versa.
 *
 * Everything read from storage is repaired field by field (like progress.ts): unknown chapters,
 * malformed entries and oversized text are dropped, so a corrupted or hand-edited save degrades to
 * less progress, never to a crash or to text the game did not write. Replaying a chapter REPLACES its
 * archive entry (the Archive records the latest run of each chapter, as the contract says).
 */
import { create } from 'zustand';
import {
  CHAPTER_IDS,
  DEFAULT_STORY_MODEL,
  isStoryModel,
  type AiPreference,
  type ArchiveEntry,
  type ChapterId,
  type LandmarkOutcome,
  type LandmarkStatus,
  type RunEvidence,
  type StoredReflection,
  type StoryProgress,
} from '../story/types';
import { loadJson, saveJson } from './storage';

export const STORY_KEY = 'iceberg-river.story.v1';
/** Longest stored text (characters): reflections are ~100–250 words; anything far longer is not ours. */
const MAX_TEXT = 4000;
const MAX_IDS = 32;
const STATUSES: readonly LandmarkStatus[] = ['destroyed', 'damaged', 'intact', 'notReached'];
const AI_PREFS: readonly AiPreference[] = ['selected', 'all', 'off'];

export const emptyStoryProgress = (): StoryProgress => ({
  version: 1,
  completed: [],
  archive: [],
  epilogue: null,
  settings: { narrative: true, ai: 'selected', model: DEFAULT_STORY_MODEL },
});

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isChapterId = (v: unknown): v is ChapterId => typeof v === 'string' && (CHAPTER_IDS as readonly string[]).includes(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 120).slice(0, MAX_IDS) : [];
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v)) if (finite(n) && n >= 0 && k.length <= 40) out[k] = Math.floor(n);
  return out;
};

export function sanitizeReflection(v: unknown): StoredReflection | null {
  if (!isObj(v) || (v.source !== 'ai' && v.source !== 'authored')) return null;
  if (typeof v.text !== 'string' || v.text.trim() === '' || v.text.length > MAX_TEXT) return null;
  const review = isObj(v.review) && (v.review.verdict === 'approved' || v.review.verdict === 'corrected') && finite(v.review.rounds)
    ? { verdict: v.review.verdict as 'approved' | 'corrected', rounds: v.review.rounds as number }
    : undefined;
  return {
    source: v.source,
    ...(typeof v.title === 'string' && v.title.length <= 200 ? { title: v.title } : {}),
    text: v.text,
    fragmentIds: ids(v.fragmentIds),
    factIds: ids(v.factIds),
    ...(review ? { review } : {}),
    ...(typeof v.validated === 'boolean' ? { validated: v.validated } : {}),
    ...(typeof v.traceId === 'string' && v.traceId.length <= 120 ? { traceId: v.traceId } : {}),
  };
}

const NUMERIC: readonly (keyof RunEvidence)[] = [
  'time', 'distance', 'topSpeed', 'startMass', 'endMass', 'peakMass', 'absorbed', 'iceLeft',
  'waterfallsCrossed', 'collisions', 'treesFelled', 'knockedDown', 'buildingsDestroyed', 'storyPoints',
  'reachedS', 'coastS',
];

/** RunEvidence as stored, or null when it is not one (a different version, a missing number…). */
export function sanitizeEvidence(v: unknown, chapterId: ChapterId): RunEvidence | null {
  if (!isObj(v) || v.version !== 1 || v.chapterId !== chapterId || typeof v.levelId !== 'string') return null;
  if (v.outcome !== 'complete' && v.outcome !== 'failed') return null;
  if (!NUMERIC.every((k) => finite(v[k]))) return null;
  const landmarks: LandmarkOutcome[] = Array.isArray(v.landmarks)
    ? v.landmarks
        .filter((l): l is Obj => isObj(l) && typeof l.id === 'string' && STATUSES.includes(l.status as LandmarkStatus))
        .slice(0, 64)
        .map((l) => ({ id: l.id as string, status: l.status as LandmarkStatus, closest: finite(l.closest) ? l.closest : -1 }))
    : [];
  const route = Array.isArray(v.route)
    ? v.route.filter((p): p is Obj => isObj(p) && finite(p.s) && finite(p.d)).slice(0, 40).map((p) => ({ s: p.s as number, d: p.d as number }))
    : [];
  const notable = Array.isArray(v.notable)
    ? (v.notable.filter((n) => isObj(n) && typeof n.type === 'string' && finite(n.t) && finite(n.s) && finite(n.d)).slice(0, 30) as unknown as RunEvidence['notable'])
    : [];
  const num = (k: keyof RunEvidence): number => v[k] as number;
  return {
    version: 1,
    chapterId,
    levelId: v.levelId,
    outcome: v.outcome,
    ...(typeof v.failReason === 'string' ? { failReason: v.failReason as RunEvidence['failReason'] } : {}),
    time: num('time'),
    distance: num('distance'),
    topSpeed: num('topSpeed'),
    startMass: num('startMass'),
    endMass: num('endMass'),
    peakMass: num('peakMass'),
    absorbed: num('absorbed'),
    iceLeft: num('iceLeft'),
    waterfallsCrossed: num('waterfallsCrossed'),
    collisions: num('collisions'),
    treesFelled: num('treesFelled'),
    knockedDown: num('knockedDown'),
    buildingsDestroyed: num('buildingsDestroyed'),
    storyPoints: num('storyPoints'),
    destroyedByCategory: counts(v.destroyedByCategory),
    destroyedByKind: counts(v.destroyedByKind),
    landmarks,
    notable,
    route,
    reachedS: num('reachedS'),
    coastS: num('coastS'),
  };
}

export function sanitizeEntry(v: unknown): ArchiveEntry | null {
  if (!isObj(v) || !isChapterId(v.chapterId)) return null;
  if (typeof v.completedAt !== 'string' || Number.isNaN(Date.parse(v.completedAt))) return null;
  const evidence = sanitizeEvidence(v.evidence, v.chapterId);
  const reflection = sanitizeReflection(v.reflection);
  if (!evidence || !reflection) return null;
  return {
    chapterId: v.chapterId,
    completedAt: v.completedAt,
    attempts: finite(v.attempts) && v.attempts >= 1 ? Math.min(999, Math.floor(v.attempts)) : 1,
    evidence,
    fragmentIds: ids(v.fragmentIds),
    reflection,
  };
}

/** Field-by-field repair of stored story progress. Never throws. */
export function sanitizeStoryProgress(v: unknown): StoryProgress {
  const d = emptyStoryProgress();
  if (!isObj(v) || v.version !== 1) return d;
  const archiveBy = new Map<ChapterId, ArchiveEntry>();
  for (const raw of Array.isArray(v.archive) ? v.archive : []) {
    const e = sanitizeEntry(raw);
    if (!e) continue;
    const prev = archiveBy.get(e.chapterId);
    if (!prev || Date.parse(e.completedAt) >= Date.parse(prev.completedAt)) archiveBy.set(e.chapterId, e);
  }
  const done = new Set(Array.isArray(v.completed) ? v.completed.filter(isChapterId) : []);
  for (const id of archiveBy.keys()) done.add(id);
  const s = isObj(v.settings) ? v.settings : {};
  return {
    version: 1,
    completed: CHAPTER_IDS.filter((id) => done.has(id)),
    archive: CHAPTER_IDS.map((id) => archiveBy.get(id)).filter((e): e is ArchiveEntry => e !== undefined),
    epilogue: sanitizeReflection(v.epilogue),
    settings: {
      narrative: typeof s.narrative === 'boolean' ? s.narrative : d.settings.narrative,
      ai: AI_PREFS.includes(s.ai as AiPreference) ? (s.ai as AiPreference) : d.settings.ai,
      // Only an offered model; anything else (older saves included) is the default, gpt-6-luna.
      model: isStoryModel(s.model) ? s.model : d.settings.model,
    },
  };
}

/** Is a chapter playable: the first always, later ones once the one before is completed. */
export function isChapterUnlocked(progress: Pick<StoryProgress, 'completed'>, id: ChapterId, unlockAll = false): boolean {
  const i = CHAPTER_IDS.indexOf(id);
  if (i < 0) return false;
  return unlockAll || i === 0 || progress.completed.includes(CHAPTER_IDS[i - 1]);
}

/** The chapter to continue with: the first unlocked one not completed, else the last chapter. */
export function nextChapter(progress: Pick<StoryProgress, 'completed'>): ChapterId {
  return CHAPTER_IDS.find((id) => !progress.completed.includes(id)) ?? CHAPTER_IDS[CHAPTER_IDS.length - 1];
}

export const archiveEntry = (progress: StoryProgress, id: ChapterId): ArchiveEntry | undefined =>
  progress.archive.find((e) => e.chapterId === id);

/** progress with `entry` recorded: its chapter completed, its archive entry replaced. */
export function withEntry(progress: StoryProgress, entry: ArchiveEntry): StoryProgress {
  const completed = new Set([...progress.completed, entry.chapterId]);
  const archive = [...progress.archive.filter((e) => e.chapterId !== entry.chapterId), entry];
  return {
    ...progress,
    completed: CHAPTER_IDS.filter((id) => completed.has(id)),
    archive: CHAPTER_IDS.map((id) => archive.find((e) => e.chapterId === id)).filter((e): e is ArchiveEntry => e !== undefined),
  };
}

const isPresent = (v: unknown): v is NonNullable<unknown> => v !== null && v !== undefined;
/** Stored progress, or null when nothing (valid JSON) is stored or storage is unavailable. */
const loadStored = (): StoryProgress | null => {
  const raw = loadJson<unknown>(STORY_KEY, null, isPresent);
  return raw === null ? null : sanitizeStoryProgress(raw);
};
const load = (): StoryProgress => loadStored() ?? emptyStoryProgress();

/**
 * Failed attempts per chapter since its last completion, kept under their own key (StoryProgress is a
 * shared contract): a reload between failures and the completion no longer forgets them.
 */
export const STORY_FAILURES_KEY = 'iceberg-river.story.failures.v1';
export type FailureCounts = Partial<Record<ChapterId, number>>;
/** ArchiveEntry.attempts is capped at 999 (sanitizeEntry); failures stay one below it. */
const MAX_FAILURES = 998;

/** Known chapters with a positive whole count only, capped; anything else is dropped. Never throws. */
export function sanitizeFailures(v: unknown): FailureCounts {
  const out: FailureCounts = {};
  if (!isObj(v)) return out;
  for (const id of CHAPTER_IDS) {
    const n = v[id];
    if (finite(n) && n >= 1) out[id] = Math.min(MAX_FAILURES, Math.floor(n));
  }
  return out;
}
const loadStoredFailures = (): FailureCounts | null => {
  const raw = loadJson<unknown>(STORY_FAILURES_KEY, null, isPresent);
  return raw === null ? null : sanitizeFailures(raw);
};

interface StoryState {
  progress: StoryProgress;
  /** Failed attempts per chapter since its last completion (persisted, see STORY_FAILURES_KEY). */
  failures: FailureCounts;
  /** Record a completed chapter; returns the stored entry. */
  recordChapter: (entry: Omit<ArchiveEntry, 'attempts'>) => ArchiveEntry;
  /** Count a failed attempt (the next completion's `attempts` includes it). */
  recordFailure: (id: ChapterId) => void;
  /** Swap in a reflection that arrived later (the agents'), if the entry is still that completion. */
  updateReflection: (id: ChapterId, completedAt: string, reflection: StoredReflection) => void;
  setEpilogue: (epilogue: StoredReflection | null) => void;
  updateStorySettings: (patch: Partial<StoryProgress['settings']>) => void;
  /** Forget all story progress and the Archive (settings are kept). */
  resetStory: () => void;
}

/**
 * Every write re-reads storage first: another tab may have saved since this one loaded. With nothing
 * stored (first write, or storage unavailable) it builds on this tab's state, so settings chosen in a
 * private window are not reset by the next write.
 */
function commit(
  get: () => StoryState,
  set: (p: Partial<StoryState>) => void,
  change: (p: StoryProgress) => StoryProgress,
): StoryProgress {
  const progress = change(loadStored() ?? get().progress);
  saveJson(STORY_KEY, progress);
  set({ progress });
  return progress;
}

/** The same re-read-then-write for the failure counts. */
function commitFailures(
  get: () => StoryState,
  set: (p: Partial<StoryState>) => void,
  change: (f: FailureCounts) => FailureCounts,
): FailureCounts {
  const failures = sanitizeFailures(change(loadStoredFailures() ?? get().failures));
  saveJson(STORY_FAILURES_KEY, failures);
  set({ failures });
  return failures;
}

const without = (f: FailureCounts, id: ChapterId): FailureCounts => {
  const out = { ...f };
  delete out[id];
  return out;
};

export const useStoryStore = create<StoryState>((set, get) => ({
  progress: load(),
  failures: loadStoredFailures() ?? {},
  recordChapter: (e) => {
    const failed = (loadStoredFailures() ?? get().failures)[e.chapterId] ?? 0;
    const entry: ArchiveEntry = { ...e, attempts: failed + 1 };
    commit(get, set, (p) => withEntry(p, entry));
    commitFailures(get, set, (f) => without(f, e.chapterId));
    return entry;
  },
  recordFailure: (id) => {
    commitFailures(get, set, (f) => ({ ...f, [id]: (f[id] ?? 0) + 1 }));
  },
  updateReflection: (id, completedAt, reflection) => {
    commit(get, set, (p) => {
      const entry = archiveEntry(p, id);
      return entry && entry.completedAt === completedAt ? withEntry(p, { ...entry, reflection }) : p;
    });
  },
  setEpilogue: (epilogue) => {
    commit(get, set, (p) => ({ ...p, epilogue }));
  },
  updateStorySettings: (patch) => {
    commit(get, set, (p) => sanitizeStoryProgress({ ...p, settings: { ...p.settings, ...patch } }));
  },
  resetStory: () => {
    commit(get, set, (p) => ({ ...emptyStoryProgress(), settings: p.settings }));
    commitFailures(get, set, () => ({}));
  },
}));

function onStorage(e: StorageEvent): void {
  if (e.key === null || e.key === STORY_KEY) useStoryStore.setState({ progress: load() });
  if (e.key === null || e.key === STORY_FAILURES_KEY) useStoryStore.setState({ failures: loadStoredFailures() ?? {} });
}

if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
