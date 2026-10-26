/**
 * Deterministic narrative selection: which authored fragments a run reveals, which authored
 * reflection stands in when the agents are off or fail, and the composed fallback epilogue. Pure
 * functions of (chapter, RunEvidence, history): the same run always reveals the same documents, so
 * the Archive is reproducible and tests can pin it. Works offline; the agents only ever ADD a
 * reflection on top of this.
 *
 * Conditions read the evidence conservatively (see ./evidence.ts): a landmark condition on 'intact'
 * only matches a landmark the run actually reached, because the evidence never marks an unreached
 * one intact. A condition on a landmark the evidence does not list is false, never "probably".
 */
import { BIBLE } from './bible';
import { CHAPTERS } from './chapters';
import { EPILOGUE_PARTS, type EpiloguePart } from './epilogueText';
import { destroyedCount } from './evidence';
import {
  CHAPTER_IDS,
  type ArchiveEntry,
  type ArchiveFragment,
  type ChapterDef,
  type ChapterId,
  type FragmentCondition,
  type HistoryItem,
  type LandmarkStatus,
  type RunEvidence,
  type StoredReflection,
  type StoryBible,
} from './types';

/** Most fragments shown after one completion (more would bury the reflection). */
export const MAX_FRAGMENTS = 4;
/** Target length of the composed epilogue, in words. */
export const EPILOGUE_WORDS = { min: 150, max: 250 } as const;
/** HistoryItem.reflectionExcerpt length (characters). */
export const EXCERPT_CHARS = 240;
/** Deepest nesting of all / any / not evaluated (stored or hand-written data can be malformed). */
const MAX_DEPTH = 8;

/** The bible's theme line: the last-resort reflection when a chapter has no authored one that fits. */
export const THEME_LINE = 'You cannot undo the river behind you. You can still decide where it goes next.';

const statusMatches = (actual: LandmarkStatus | undefined, want: LandmarkStatus | readonly LandmarkStatus[]): boolean =>
  actual !== undefined && (Array.isArray(want) ? want.includes(actual) : actual === want);

/**
 * The status a landmark had in the saved history: the LATEST item that lists it wins (a replayed
 * chapter's archive entry replaces the old one, but history may be assembled from several sources).
 */
function historyStatus(history: readonly HistoryItem[], landmark: string): LandmarkStatus | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const hit = history[i].landmarks.find((l) => l.id === landmark);
    if (hit) return hit.status;
  }
  return undefined;
}

/**
 * Does `cond` hold for this run (and, for `history` conditions, the earlier chapters)? Unknown or
 * malformed conditions are false.
 */
export function evaluateCondition(
  cond: FragmentCondition,
  evidence: RunEvidence,
  history: readonly HistoryItem[] = [],
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH || typeof cond !== 'object' || cond === null) return false;
  const c = cond;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if ('always' in c) return c.always === true;
  if ('all' in c) return Array.isArray(c.all) && c.all.every((x) => evaluateCondition(x, evidence, history, depth + 1));
  if ('any' in c) return Array.isArray(c.any) && c.any.some((x) => evaluateCondition(x, evidence, history, depth + 1));
  if ('not' in c) return !evaluateCondition(c.not, evidence, history, depth + 1);
  if ('history' in c) {
    const h = c.history;
    return typeof h === 'object' && h !== null && statusMatches(historyStatus(history, h.landmark), h.status ?? []);
  }
  if ('landmark' in c) {
    return statusMatches(evidence.landmarks.find((l) => l.id === c.landmark)?.status, c.status);
  }
  if ('outcome' in c) return evidence.outcome === c.outcome;
  if ('destroyedAtLeast' in c) return num(c.destroyedAtLeast) && destroyedCount(evidence, c.categories) >= c.destroyedAtLeast;
  if ('destroyedAtMost' in c) return num(c.destroyedAtMost) && destroyedCount(evidence, c.categories) <= c.destroyedAtMost;
  if ('waterfallsAtLeast' in c) return num(c.waterfallsAtLeast) && evidence.waterfallsCrossed >= c.waterfallsAtLeast;
  if ('grewAtLeast' in c) {
    return num(c.grewAtLeast) && evidence.startMass > 0 && evidence.peakMass / evidence.startMass >= c.grewAtLeast;
  }
  return false;
}

/** Items sorted by priority, highest first; ties keep their authored order (stable). */
function byPriority<T extends { readonly priority: number }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.priority - a.item.priority || a.i - b.i)
    .map((x) => x.item);
}

/**
 * The fragments this run reveals, in display order (priority, then authored order), at most `max`.
 * Untrusted test entries are never shown.
 */
export function selectFragments(
  chapter: ChapterDef,
  evidence: RunEvidence,
  history: readonly HistoryItem[] = [],
  max = MAX_FRAGMENTS,
): ArchiveFragment[] {
  const fits = chapter.fragments.filter((f) => !f.untrusted && evaluateCondition(f.when, evidence, history));
  return byPriority(fits).slice(0, max);
}

/** Does the condition require a failed run (an `outcome: 'failed'` that must hold, alone or in an `all`)? */
function requiresFailure(c: FragmentCondition): boolean {
  if (typeof c !== 'object' || c === null) return false;
  if ('outcome' in c) return c.outcome === 'failed';
  if ('all' in c) return Array.isArray(c.all) && c.all.some(requiresFailure);
  return false;
}

/**
 * The one document a FAILED run shows, on the fail panel: the best fragment written for a failure (its
 * condition requires outcome 'failed') whose condition holds. It is not archived (nothing is until a run
 * reaches the sea), so it never enters selectFragments' four or the history. Undefined for a completed
 * run and for a chapter with no such document.
 */
export function failedRunDocument(
  chapter: ChapterDef,
  evidence: RunEvidence,
  history: readonly HistoryItem[] = [],
): ArchiveFragment | undefined {
  if (evidence.outcome !== 'failed') return undefined;
  const fits = chapter.fragments.filter((f) => !f.untrusted && requiresFailure(f.when) && evaluateCondition(f.when, evidence, history));
  return byPriority(fits)[0];
}

/**
 * The authored reflection for this run: the best fallback whose condition holds, else the chapter's
 * best fallback regardless (it is written to stand on its own), else the theme line.
 */
export function fallbackReflection(
  chapter: ChapterDef,
  evidence: RunEvidence,
  history: readonly HistoryItem[] = [],
): StoredReflection {
  const usable = byPriority(chapter.fallbackReflections.filter((f) => !f.untrusted));
  const pick = usable.find((f) => evaluateCondition(f.when, evidence, history)) ?? usable[0];
  if (!pick) return { source: 'authored', title: chapter.title, text: THEME_LINE, fragmentIds: [], factIds: [] };
  return { source: 'authored', title: pick.title, text: pick.body, fragmentIds: [pick.id], factIds: [] };
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const SLOTS: readonly EpiloguePart['slot'][] = ['opening', 'journey', 'people', 'closing'];

/**
 * The authored epilogue for the whole journey (chapter 9's run plus the archive of chapters 1–8):
 * the best fitting part of each slot, then more fitting parts while the text is under
 * EPILOGUE_WORDS.min, never past EPILOGUE_WORDS.max; joined in slot order, one paragraph per part.
 * Falls back to the theme line when no part fits.
 */
export function composeEpilogue(
  evidence: RunEvidence,
  history: readonly HistoryItem[],
  parts: readonly EpiloguePart[] = EPILOGUE_PARTS,
): StoredReflection {
  const fitting = parts.filter((p) => evaluateCondition(p.when, evidence, history));
  const chosen = new Set<EpiloguePart>();
  let words = 0;
  const take = (p: EpiloguePart): boolean => {
    const n = wordCount(p.text);
    if (chosen.has(p) || words + n > EPILOGUE_WORDS.max) return false;
    chosen.add(p);
    words += n;
    return true;
  };
  // One per slot first (the best that still fits the budget), then top up in slot order.
  for (const slot of SLOTS) {
    for (const p of byPriority(fitting.filter((x) => x.slot === slot))) if (take(p)) break;
  }
  for (const slot of SLOTS) {
    if (words >= EPILOGUE_WORDS.min) break;
    for (const p of byPriority(fitting.filter((x) => x.slot === slot))) {
      if (words >= EPILOGUE_WORDS.min) break;
      take(p);
    }
  }
  const ordered = SLOTS.flatMap((slot) => parts.filter((p) => p.slot === slot && chosen.has(p)));
  if (ordered.length === 0) {
    return { source: 'authored', title: 'The Last Thaw', text: THEME_LINE, fragmentIds: [], factIds: [] };
  }
  return {
    source: 'authored',
    title: 'The Last Thaw',
    text: ordered.map((p) => p.text.trim()).join('\n\n'),
    fragmentIds: ordered.map((p) => p.id),
    factIds: [],
  };
}

/** The compact memory of one archive entry sent to the agents (and used by history conditions). */
export function toHistoryItem(entry: ArchiveEntry): HistoryItem {
  const text = entry.reflection.text.replace(/\s+/g, ' ').trim();
  return currentHistoryItem({
    chapterId: entry.chapterId,
    outcome: entry.evidence.outcome,
    storyPoints: entry.evidence.storyPoints,
    destroyedByCategory: entry.evidence.destroyedByCategory,
    destroyedByKind: entry.evidence.destroyedByKind,
    landmarks: entry.evidence.landmarks,
    fragmentIds: entry.fragmentIds,
    reflectionExcerpt: text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1)}…` : text,
  });
}

/**
 * A history item as the current story knows it: landmarks and fragments its chapter no longer has are
 * left out. An archive saved by an earlier version of the story (chapter 8's Gorge bridge and post van
 * log, before the power station replaced them) would otherwise name ids the agents' request check
 * rejects (src/server/contracts.ts historyProblems), and every later AI reflection would fail on it.
 * What a removed landmark did is no longer part of the story, so nothing true is lost.
 */
export function currentHistoryItem(item: HistoryItem, chapters: readonly ChapterDef[] = CHAPTERS): HistoryItem {
  const ch = chapters.find((c) => c.id === item.chapterId);
  if (!ch) return item;
  const landmarks = new Set(ch.landmarks.map((l) => l.id));
  const fragments = new Set(ch.fragments.filter((f) => !f.untrusted).map((f) => f.id));
  return {
    ...item,
    landmarks: item.landmarks.filter((l) => landmarks.has(l.id)),
    fragmentIds: item.fragmentIds.filter((id) => fragments.has(id)),
  };
}

/** History for a chapter: archive entries of the chapters BEFORE it, oldest chapter first. */
export function historyBefore(archive: readonly ArchiveEntry[], chapterId: ChapterId): HistoryItem[] {
  const limit = CHAPTER_IDS.indexOf(chapterId);
  return CHAPTER_IDS.slice(0, Math.max(0, limit))
    .map((id) => archive.find((e) => e.chapterId === id))
    .filter((e): e is ArchiveEntry => e !== undefined)
    .map(toHistoryItem);
}

/** Every authored document by id (fragments and fallback reflections of all chapters). */
export function findDocument(id: string, chapters: readonly ChapterDef[] = CHAPTERS): ArchiveFragment | undefined {
  for (const c of chapters) {
    const hit = c.fragments.find((f) => f.id === id) ?? c.fallbackReflections.find((f) => f.id === id);
    if (hit && !hit.untrusted) return hit;
  }
  return undefined;
}

/** What a document shows as its author while the story has not yet revealed who wrote it. */
export const UNSIGNED_AUTHOR = 'Unsigned';
const ID_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * A document's author as the reader sees it, never a raw id: a bible character's display name ("Tomas
 * Lind" for 'tomas-lind'), an institution as written ("Vell Valley Water Board"). The same name gating
 * as the agents' (src/story/validate.ts): before the chapter where the story reveals a character's
 * name, their documents read as unsigned. An unknown id-like author (data from an older version) is
 * left out rather than shown raw.
 */
export function documentAuthor(
  author: string | undefined,
  chapterId?: ChapterId,
  bible: Pick<StoryBible, 'characters'> = BIBLE,
): string | undefined {
  if (!author) return undefined;
  const c = bible.characters.find((x) => x.id === author);
  if (!c) return ID_LIKE.test(author) ? undefined : author;
  const namedFrom = CHAPTER_IDS.indexOf(c.revealedIn ?? c.firstAppears);
  if (chapterId && CHAPTER_IDS.indexOf(chapterId) < namedFrom) return UNSIGNED_AUTHOR;
  return c.name;
}
