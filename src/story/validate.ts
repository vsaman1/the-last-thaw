/**
 * Deterministic checks of a generated narrative (an AI reflection or epilogue) against what really
 * happened. Shared by the agent service (the last gate before anything is shown, and the Historian's
 * validate/continuity tools) and the tests. Pure: no I/O, no model, same answer every time.
 *
 * The model is never trusted to be truthful. Every factual statement the Archivist makes must be declared
 * as a NarrativeClaim and every claim must match RunEvidence, the player's saved history, the story
 * bible, the fragments or an approved ClimateFact. The free text (title included) is then read against
 * the evidence itself, since true claims do not make the prose true: what it says of each landmark or
 * place it names ("still stands", "came down", "you saved Riverside"), counts of what broke, numbers
 * that came from nowhere, names that are not in the bible, characters or revelations before their
 * chapter, real science without a cited fact, casualty language or people inside buildings, and
 * anything that looks like a secret, a URL or the machinery behind the story. These prose readings are
 * heuristics over English, not a parser: they catch the contradictions they can tie to a name, and the
 * Historian reads the rest.
 *
 * Deliberately conservative: a false rejection costs one authored fallback reflection; a false
 * acceptance puts an invented death or a wrong count in front of the player.
 */

import type {
  ArchiveFragment,
  ChapterDef,
  ChapterId,
  ClimateFact,
  FragmentCondition,
  HistoryItem,
  LandmarkStatus,
  NarrativeClaim,
  RunEvidence,
  StoryBible,
  StructureCategory,
} from './types';
import { bareInitials, glossedWords } from './plainWords';
import { BUILT_CATEGORIES, CHAPTER_IDS } from './types';
import { BLAMES_PLAYER, EARLIER_RUNS, lookHas, WORLD_PATTERNS, WORLD_WORD, worldLookFor, type WorldLook } from './worldLook';

export type NarrativeMode = 'reflection' | 'epilogue';

/** The Archivist's structured output (also the shape the Historian reviews). */
export interface NarrativeDraft {
  readonly title: string;
  readonly text: string;
  readonly fragmentIds: readonly string[];
  readonly factIds: readonly string[];
  readonly claims: readonly NarrativeClaim[];
}

/** The trusted, authored story data (production: src/story modules; tests: small fixtures). */
export interface StoryData {
  readonly bible: StoryBible;
  readonly chapters: readonly ChapterDef[];
  readonly facts: readonly ClimateFact[];
}

export interface ValidationContext {
  readonly mode: NarrativeMode;
  readonly chapter: ChapterDef;
  readonly evidence: RunEvidence;
  /** Earlier chapters, oldest first (already validated against the story data). */
  readonly history: readonly HistoryItem[];
  readonly story: StoryData;
  /** Numbers from other trusted context the agents were shown (e.g. structures in the level). */
  readonly extraNumbers?: readonly number[];
  /** Names from other trusted context the agents were shown (e.g. the level's display name). */
  readonly extraNames?: readonly string[];
  /** Exact strings that must never appear in output (the API key, the canary). Never sent to a model. */
  readonly secrets?: readonly string[];
  /**
   * How the chapter's land looks (src/story/worldLook.ts), the same look get_run_summary gives the
   * agents. Computed from the chapter and the history when absent.
   */
  readonly world?: WorldLook;
}

/** Which tool reports an issue: the Historian's two checking tools split the work the same way. */
export type IssueGroup = 'form' | 'events' | 'continuity' | 'safety';

export interface ValidationIssue {
  readonly group: IssueGroup;
  readonly code: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly passed: boolean;
  /** Individual checks run (claims, ids and text scans), for the trace and NarrativeResult. */
  readonly checked: number;
  readonly issues: readonly ValidationIssue[];
}

/** Word bounds from the brief: reflections 60–180 words, the epilogue 150–250. */
export const WORD_LIMITS: Readonly<Record<NarrativeMode, readonly [number, number]>> = {
  reflection: [60, 180],
  epilogue: [150, 250],
};
export const TITLE_MAX_CHARS = 80;
export const MAX_FRAGMENT_IDS = 6;
export const MAX_FACT_IDS = 2;
export const MAX_CLAIMS = 24;
/** Peak mass claims may round: within 1 % or half a tonne, whichever is larger. */
const MASS_TOLERANCE_REL = 0.01;
const MASS_TOLERANCE_ABS = 0.5;
/** A run of this many words shared with a not-yet-revealed text counts as revealing it. */
const REVEAL_NGRAM = 5;

// -------------------------------------------------------------------------------------------------
// Chapter order and fragment conditions (also used by the agent tools)
// -------------------------------------------------------------------------------------------------

/** 0-based position of a chapter in the story; -1 for an unknown id. */
export const chapterOrder = (id: ChapterId | string): number => CHAPTER_IDS.indexOf(id as ChapterId);

const asArray = <T>(v: T | readonly T[]): readonly T[] => (Array.isArray(v) ? (v as readonly T[]) : [v as T]);

/** Placements broken in these categories (all categories when omitted). */
export function destroyedTotal(
  byCategory: Readonly<Partial<Record<StructureCategory, number>>>,
  categories?: readonly StructureCategory[],
): number {
  let n = 0;
  for (const [cat, count] of Object.entries(byCategory) as [StructureCategory, number | undefined][]) {
    if (!categories || categories.includes(cat)) n += count ?? 0;
  }
  return n;
}

/** A landmark absent from the evidence was never reached by the run. */
const landmarkStatus = (evidence: RunEvidence, id: string): LandmarkStatus =>
  evidence.landmarks.find((l) => l.id === id)?.status ?? 'notReached';

/**
 * Evaluates a fragment's condition against a run and the saved history. The same rule decides which
 * fragments the player is shown and which ones an agent may cite, so an AI reflection can never quote a
 * letter about a house the player left standing.
 */
export function fragmentApplies(
  cond: FragmentCondition,
  evidence: RunEvidence,
  history: readonly HistoryItem[],
): boolean {
  if ('always' in cond) return cond.always;
  if ('all' in cond) return cond.all.every((c) => fragmentApplies(c, evidence, history));
  if ('any' in cond) return cond.any.some((c) => fragmentApplies(c, evidence, history));
  if ('not' in cond) return !fragmentApplies(cond.not, evidence, history);
  if ('history' in cond) {
    const want = asArray(cond.history.status);
    return history.some((h) => h.landmarks.some((l) => l.id === cond.history.landmark && want.includes(l.status)));
  }
  if ('landmark' in cond) return asArray(cond.status).includes(landmarkStatus(evidence, cond.landmark));
  if ('outcome' in cond) return evidence.outcome === cond.outcome;
  if ('destroyedAtLeast' in cond) return destroyedTotal(evidence.destroyedByCategory, cond.categories) >= cond.destroyedAtLeast;
  if ('destroyedAtMost' in cond) return destroyedTotal(evidence.destroyedByCategory, cond.categories) <= cond.destroyedAtMost;
  if ('waterfallsAtLeast' in cond) return evidence.waterfallsCrossed >= cond.waterfallsAtLeast;
  if ('grewAtLeast' in cond) return evidence.startMass > 0 && evidence.peakMass / evidence.startMass >= cond.grewAtLeast;
  return false;
}

/** Every fragment in the story by id (chapters' fragments only: fallback reflections are not sources). */
export function allFragments(story: StoryData): ReadonlyMap<string, ArchiveFragment> {
  const m = new Map<string, ArchiveFragment>();
  for (const c of story.chapters) for (const f of c.fragments) m.set(f.id, f);
  return m;
}

/**
 * Why `fragmentId` may not be cited in this context, or null when it may: it must exist, be trusted,
 * and either belong to this chapter and apply to this run, or belong to an earlier chapter where the
 * saved history shows the player saw it.
 */
export function fragmentProblem(fragmentId: string, ctx: ValidationContext): string | null {
  const f = allFragments(ctx.story).get(fragmentId);
  if (!f) return `fragment "${fragmentId}" does not exist`;
  if (f.untrusted) return `fragment "${fragmentId}" is untrusted test data and can never be cited`;
  const cur = chapterOrder(ctx.chapter.id);
  const its = chapterOrder(f.chapterId);
  if (its > cur) return `fragment "${fragmentId}" belongs to a later chapter (${f.chapterId})`;
  if (its === cur) {
    return fragmentApplies(f.when, ctx.evidence, ctx.history)
      ? null
      : `fragment "${fragmentId}" does not apply to this run (its condition is not met)`;
  }
  const seen = ctx.history.find((h) => h.chapterId === f.chapterId)?.fragmentIds.includes(fragmentId);
  return seen ? null : `fragment "${fragmentId}" was not revealed in the player's ${f.chapterId} run`;
}

// -------------------------------------------------------------------------------------------------
// Claims
// -------------------------------------------------------------------------------------------------

const countLabel = (claim: Extract<NarrativeClaim, { type: 'count' }>): string =>
  claim.what === 'destroyed' ? `destroyed ${claim.category ?? 'structures (felled trees not counted)'}` : claim.what;

/**
 * Placements broken in the built categories: what "N structures destroyed" counts, in a count claim
 * with no category and in the agents' run summaries. Felled trees are counted apart ('trees').
 */
export const builtTotal = (byCategory: Readonly<Partial<Record<StructureCategory, number>>>): number =>
  destroyedTotal(byCategory, BUILT_CATEGORIES);

/** Why a claim is false or not allowed here, or null when it holds. */
export function claimProblem(claim: NarrativeClaim, ctx: ValidationContext): string | null {
  const ev = ctx.evidence;
  switch (claim.type) {
    case 'landmark': {
      const lm = ev.landmarks.find((l) => l.id === claim.landmarkId);
      if (!lm) return `landmark "${claim.landmarkId}" is not part of this chapter's run`;
      return lm.status === claim.status ? null : `landmark "${claim.landmarkId}" is ${lm.status}, not ${claim.status}`;
    }
    case 'count': {
      if (claim.category !== undefined && claim.what !== 'destroyed') return 'a category only applies to destroyed counts';
      const actual =
        claim.what === 'destroyed'
          ? claim.category
            ? destroyedTotal(ev.destroyedByCategory, [claim.category])
            : builtTotal(ev.destroyedByCategory)
          : claim.what === 'trees'
            ? ev.treesFelled
            : claim.what === 'waterfalls'
              ? ev.waterfallsCrossed
              : ev.collisions;
      return actual === claim.value ? null : `${countLabel(claim)} is ${actual}, not ${claim.value}`;
    }
    case 'outcome':
      return ev.outcome === claim.value ? null : `the run's outcome is ${ev.outcome}, not ${claim.value}`;
    case 'growth': {
      const tol = Math.max(MASS_TOLERANCE_ABS, ev.peakMass * MASS_TOLERANCE_REL);
      return Math.abs(ev.peakMass - claim.peakMass) <= tol
        ? null
        : `peak mass was ${round1(ev.peakMass)} t, not ${claim.peakMass} t`;
    }
    case 'fragment':
      return fragmentProblem(claim.fragmentId, ctx);
    case 'fact':
      return ctx.story.facts.some((f) => f.id === claim.factId) ? null : `climate fact "${claim.factId}" is not approved`;
    case 'history': {
      if (chapterOrder(claim.chapterId) < 0 || chapterOrder(claim.chapterId) >= chapterOrder(ctx.chapter.id)) {
        return `history claims must be about an earlier chapter (got ${claim.chapterId})`;
      }
      const item = ctx.history.find((h) => h.chapterId === claim.chapterId);
      if (!item) return `there is no saved record of ${claim.chapterId}`;
      const lm = item.landmarks.find((l) => l.id === claim.landmarkId);
      if (!lm) return `landmark "${claim.landmarkId}" is not recorded in ${claim.chapterId}`;
      return lm.status === claim.status
        ? null
        : `in ${claim.chapterId}, "${claim.landmarkId}" was ${lm.status}, not ${claim.status}`;
    }
    default:
      return `unknown claim type "${String((claim as { type?: unknown }).type)}"`;
  }
}

const CLAIM_GROUP: Readonly<Record<NarrativeClaim['type'], IssueGroup>> = {
  landmark: 'events',
  count: 'events',
  outcome: 'events',
  growth: 'events',
  fragment: 'continuity',
  fact: 'continuity',
  history: 'continuity',
};

// -------------------------------------------------------------------------------------------------
// Numbers
// -------------------------------------------------------------------------------------------------

const round1 = (v: number): number => Math.round(v * 10) / 10;
const numKey = (v: number): string => (Math.round(v * 1000) / 1000).toString();

const UNIT_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, dozen: 12,
};
const TEN_WORDS: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE_WORDS: Readonly<Record<string, number>> = { hundred: 100, thousand: 1000 };
const NUMBER_WORD = `(?:${[...Object.keys(UNIT_WORDS), ...Object.keys(TEN_WORDS), ...Object.keys(SCALE_WORDS)].join('|')})`;
const NUMBER_WORD_RUN = new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMBER_WORD})*\\b`, 'gi');
/**
 * Digits are read in runs exactly as src/story/science.ts lists a fact's `numbers` (and
 * science.test.ts checks them): digits joined by '.' or ',' as printed — '1.1', '2023' and '24' in
 * "1.1°C … 2023/24", '1,200'. So a faithful quote of a cited fact yields exactly that fact's numbers.
 */
const DIGIT_RUN = /\d+(?:[.,]\d+)*/g;
export const digitRuns = (text: string): string[] => text.match(DIGIT_RUN) ?? [];
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;

/** What a run states: "1,200" is 1200, "4.5" is 4.5, "3,4" a list (3, 4), "21.10.2031" a date (21, 10, 2031). */
export function runValues(run: string): number[] {
  if (THOUSANDS.test(run)) return [Number(run.replace(/,/g, ''))];
  return run.split(',').flatMap((part) => (DECIMAL.test(part) ? [Number(part)] : part.split('.').map(Number)));
}

export interface FoundNumber {
  /** As printed: the digit run (or the number words) it was read from. */
  readonly raw: string;
  readonly value: number;
}

/** "a few hundred", "several thousand": a vague size, not a count anyone could check. */
const VAGUE_BEFORE = /\b(?:a\s+few|few|several|some|many|a\s+couple\s+of)\s+$/i;
const SCALE_ONLY = new Set(['hundred', 'thousand', 'dozen']);

/**
 * Numbers written in the text: digits ("3", "1,200", "2031", "4.5") and number words ("two",
 * "twenty-three", "a hundred"). A lone "one" is skipped: "no one", "one morning" are not counts. So is
 * a bare scale word after a vague quantifier ("a few thousand small decisions", "a few hundred
 * people"): it states no number. "a hundred", "two thousand" and every digit still count.
 */
export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const run of digitRuns(text)) for (const value of runValues(run)) out.push({ raw: run, value });
  for (const m of text.matchAll(NUMBER_WORD_RUN)) {
    const words = m[0].toLowerCase().split(/[\s-]+/).filter((w) => w !== 'and');
    if (words.length === 1 && words[0] === 'one') continue;
    if (words.every((w) => SCALE_ONLY.has(w)) && VAGUE_BEFORE.test(text.slice(Math.max(0, (m.index ?? 0) - 20), m.index))) continue;
    let total = 0;
    let current = 0;
    for (const w of words) {
      if (w in UNIT_WORDS) current += UNIT_WORDS[w];
      else if (w in TEN_WORDS) current += TEN_WORDS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else if (w === 'thousand') {
        total += (current || 1) * 1000;
        current = 0;
      }
    }
    out.push({ raw: m[0], value: total + current });
  }
  return out;
}

/** Continuous measures may be rounded the way a person would write them. */
function addMeasure(set: Set<string>, v: number): void {
  if (!Number.isFinite(v)) return;
  for (const r of [v, Math.round(v), Math.floor(v), Math.ceil(v), round1(v)]) set.add(numKey(r));
  if (Math.abs(v) >= 100) {
    set.add(numKey(Math.round(v / 10) * 10));
    set.add(numKey(Math.round(v / 100) * 100));
  }
}
const addExact = (set: Set<string>, v: number | undefined): void => {
  if (v !== undefined && Number.isFinite(v)) set.add(numKey(v));
};
const addFromText = (set: Set<string>, text: string | undefined): void => {
  if (text) for (const n of extractNumbers(text)) set.add(numKey(n.value));
};

/** Every number the text may contain in this context. */
export function allowedNumbers(draft: NarrativeDraft, ctx: ValidationContext): ReadonlySet<string> {
  const s = new Set<string>();
  const ev = ctx.evidence;
  // The run: measures (rounded as written) and counts (exact).
  for (const v of [ev.time, ev.time / 60, ev.distance, ev.topSpeed, ev.topSpeed * 3.6, ev.startMass, ev.endMass, ev.peakMass, ev.absorbed]) {
    addMeasure(s, v);
  }
  addMeasure(s, ev.iceLeft * 100);
  if (ev.startMass > 0) addMeasure(s, ev.peakMass / ev.startMass);
  for (const v of [ev.waterfallsCrossed, ev.collisions, ev.treesFelled, ev.knockedDown, ev.buildingsDestroyed, ev.storyPoints]) addExact(s, v);
  for (const v of Object.values(ev.destroyedByCategory)) addExact(s, v);
  for (const v of Object.values(ev.destroyedByKind)) addExact(s, v);
  addExact(s, destroyedTotal(ev.destroyedByCategory));
  addExact(s, builtTotal(ev.destroyedByCategory));
  addExact(s, ev.landmarks.length);
  for (const st of ['destroyed', 'damaged', 'intact'] as const) addExact(s, ev.landmarks.filter((l) => l.status === st).length);
  for (const n of ev.notable) if (n.value !== undefined && n.type === 'landed') addMeasure(s, n.value);
  // The saved history: per chapter and accumulated with this run.
  const totals = new Map<string, number>();
  let points = ev.storyPoints;
  let built = builtTotal(ev.destroyedByCategory);
  for (const [cat, v] of Object.entries(ev.destroyedByCategory)) totals.set(cat, v ?? 0);
  for (const h of ctx.history) {
    addExact(s, h.storyPoints);
    points += h.storyPoints;
    for (const [cat, v] of Object.entries(h.destroyedByCategory)) {
      addExact(s, v);
      totals.set(cat, (totals.get(cat) ?? 0) + (v ?? 0));
    }
    addExact(s, destroyedTotal(h.destroyedByCategory));
    addExact(s, builtTotal(h.destroyedByCategory));
    built += builtTotal(h.destroyedByCategory);
  }
  addExact(s, points);
  for (const v of totals.values()) addExact(s, v);
  addExact(s, [...totals.values()].reduce((a, b) => a + b, 0));
  addExact(s, built);
  addExact(s, ctx.history.length);
  addExact(s, ctx.history.length + 1);
  addExact(s, ctx.chapter.index);
  addExact(s, ctx.story.chapters.length);
  // Cited records and facts, established fictional years, other trusted context.
  const frags = allFragments(ctx.story);
  for (const id of citedFragmentIds(draft)) {
    const f = frags.get(id);
    if (f && !f.untrusted) for (const t of [f.title, f.date, f.body]) addFromText(s, t);
  }
  for (const id of citedFactIds(draft)) {
    const f = ctx.story.facts.find((x) => x.id === id);
    if (!f) continue;
    // Its listed digit runs, and what the statement writes in words ("the last three complete decades").
    for (const n of f.numbers) addFromText(s, n);
    addFromText(s, f.statement);
  }
  const b = ctx.story.bible;
  for (const e of b.timeline) addExact(s, e.year);
  for (const d of b.decisions) addExact(s, d.year);
  for (const c of b.characters) addExact(s, c.born);
  // What the player has read by now (chapter cards, landmark signs) and the bible entries the agents
  // may look up at this chapter: "fifty-two notebooks" is a number from the record, not an invention.
  for (const t of visibleChapterText(ctx)) addFromText(s, t);
  for (const t of visibleBibleText(ctx)) addFromText(s, t);
  for (const v of ctx.extraNumbers ?? []) addExact(s, v);
  return s;
}

/** The chapter from which a character's NAME may appear: who they are can be revealed later than they appear. */
export const nameVisibleFrom = (c: StoryBible['characters'][number]): ChapterId => c.revealedIn ?? c.firstAppears;

/** Text the player has been shown on the chapter screens up to this chapter: intro cards, intro documents, captions, landmark signs. */
function visibleChapterText(ctx: ValidationContext): string[] {
  const out: string[] = [];
  for (const ch of ctx.story.chapters) {
    if (!isVisibleAt(ch.id, ctx)) continue;
    out.push(...ch.intro.lines);
    if (ch.intro.document) out.push(ch.intro.document.title, ch.intro.document.date ?? '', ch.intro.document.body);
    if (ch.caption) out.push(ch.caption);
    for (const lm of ch.landmarks) out.push(lm.name, lm.label ?? '');
  }
  return out.filter(Boolean);
}

/**
 * Bible text the agents can look up at this chapter (the same limits as the get_bible_entries tool):
 * characters who have appeared (their backstory only once revealed), places reached, timeline entries
 * and decisions involving only those.
 */
function visibleBibleText(ctx: ValidationContext): string[] {
  const b = ctx.story.bible;
  const chars = new Map(b.characters.map((c) => [c.id, c]));
  const charOk = (id: string): boolean => {
    const c = chars.get(id);
    return c === undefined || isVisibleAt(c.firstAppears, ctx);
  };
  const locs = new Map(b.locations.map((l) => [l.id, l]));
  const locOk = (id: string): boolean => {
    const l = locs.get(id);
    return l === undefined || isVisibleAt(l.chapterId, ctx);
  };
  const out: string[] = [];
  for (const c of b.characters) {
    if (!isVisibleAt(c.firstAppears, ctx)) continue;
    out.push(c.role, c.description);
    if (!c.revealedIn || isVisibleAt(c.revealedIn, ctx)) out.push(c.history);
  }
  for (const l of b.locations) if (isVisibleAt(l.chapterId, ctx)) out.push(l.description);
  for (const t of b.timeline) if ((t.characters ?? []).every(charOk) && (t.locations ?? []).every(locOk)) out.push(t.summary);
  for (const d of b.decisions) if (charOk(d.who)) out.push(d.decision, d.consequence);
  return out;
}

const citedFragmentIds = (d: NarrativeDraft): string[] => [
  ...new Set([...d.fragmentIds, ...d.claims.flatMap((c) => (c.type === 'fragment' ? [c.fragmentId] : []))]),
];
const citedFactIds = (d: NarrativeDraft): string[] => [
  ...new Set([...d.factIds, ...d.claims.flatMap((c) => (c.type === 'fact' ? [c.factId] : []))]),
];

// -------------------------------------------------------------------------------------------------
// Names and chapter gating
// -------------------------------------------------------------------------------------------------

/** Capitalised words that are not names: calendar words, honorifics, the story's own vocabulary. */
const COMMON_CAPITALS = new Set([
  'I', "I'm", "I'd", "I've", "I'll",
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Miss', 'St', 'Saint',
  'Archive', 'Chapter', 'Act',
]);
/** Calendar words also come in the plural ("on Saturdays", "fifty-two Septembers"). */
const CALENDAR_PLURAL = /^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days$|^(?:January|February|March|April|May|June|July|August|September|October|November|December)s$/;

const NAME_TOKEN = /[A-Za-z][A-Za-z'’]*/g;
const stripPossessive = (t: string): string => t.replace(/['’]s?$/, '');

/** Name-like tokens of a phrase: 'The Vey house on Mill Lane' → Vey, Mill, Lane (and the, house, on). */
function tokensOf(phrase: string | undefined): string[] {
  if (!phrase) return [];
  return [...phrase.matchAll(NAME_TOKEN)].map((m) => stripPossessive(m[0])).filter((t) => t.length > 0);
}

const isVisibleAt = (chapter: ChapterId, ctx: ValidationContext): boolean =>
  chapterOrder(chapter) <= chapterOrder(ctx.chapter.id);

/** Fragments the player has seen or may see by now (trusted only). */
function visibleFragments(ctx: ValidationContext): ArchiveFragment[] {
  const out: ArchiveFragment[] = [];
  for (const f of allFragments(ctx.story).values()) {
    if (!f.untrusted && fragmentProblem(f.id, ctx) === null) out.push(f);
  }
  return out;
}

/** Every token a name in the text may use at this point of the story. */
export function knownNameTokens(ctx: ValidationContext): ReadonlySet<string> {
  const b = ctx.story.bible;
  const known = new Set<string>(COMMON_CAPITALS);
  const add = (p: string | undefined): void => {
    for (const t of tokensOf(p)) known.add(t);
  };
  add(b.title);
  // A name only from the chapter that reveals who they are (the archivist appears in chapter 1 and is
  // named in chapter 8).
  for (const c of b.characters) if (isVisibleAt(nameVisibleFrom(c), ctx)) add(c.name);
  for (const l of b.locations) if (isVisibleAt(l.chapterId, ctx)) add(l.name);
  const characterIds = new Set(b.characters.map((c) => c.id));
  for (const d of b.decisions) if (!characterIds.has(d.who)) add(d.who);
  for (const ch of ctx.story.chapters) {
    if (!isVisibleAt(ch.id, ctx)) continue;
    add(ch.title);
    add(ch.actTitle);
  }
  for (const t of visibleChapterText(ctx)) add(t);
  for (const f of visibleFragments(ctx)) {
    add(f.title);
    add(f.body);
    if (f.author && !characterIds.has(f.author)) add(f.author);
  }
  for (const f of ctx.story.facts) {
    known.add(f.source.org);
    add(f.statement);
  }
  for (const n of ctx.extraNames ?? []) add(n);
  return known;
}

/** True when the token at `index` starts a sentence (or a quotation), where any word is capitalised. */
function isSentenceStart(text: string, index: number): boolean {
  if (index > 0 && /["“‘'(«]/.test(text[index - 1])) return true;
  let i = index - 1;
  while (i >= 0 && /[\s"“”'‘’(\[«—–-]/.test(text[i])) {
    if (text[i] === '\n') return true;
    i--;
  }
  return i < 0 || /[.!?:;…]/.test(text[i]);
}

/** Words of a text, lowercased, for n-gram overlap. */
const words = (t: string): string[] => t.toLowerCase().replace(/[^a-z0-9'’\s]/g, ' ').split(/\s+/).filter(Boolean);

function sharesRun(text: string, secret: string, n: number): boolean {
  const a = words(text);
  const b = words(secret);
  if (b.length < n || a.length < n) return false;
  const grams = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= a.length; i++) if (grams.has(a.slice(i, i + n).join(' '))) return true;
  return false;
}

/**
 * Every word the trusted story uses (bible, chapters, records, facts), lowercased. A capitalised word
 * at a sentence start or in a title is a name only if the story never uses it at all: names the story
 * does use stay gated by the early-character and early-location checks.
 */
const vocabularies = new WeakMap<StoryData, ReadonlySet<string>>();
function storyVocabulary(story: StoryData): ReadonlySet<string> {
  const cached = vocabularies.get(story);
  if (cached) return cached;
  const b = story.bible;
  const texts: string[] = [
    b.premise, b.theme, ...b.invariants, ...b.variables, b.style.voice, ...b.style.avoid,
    ...b.characters.flatMap((c) => [c.role, c.description, c.history]),
    ...b.timeline.map((t) => t.summary), ...b.locations.map((l) => l.description),
    ...b.decisions.flatMap((d) => [d.decision, d.consequence]), ...b.revelations.map((r) => r.text),
    ...story.facts.map((f) => f.statement),
  ];
  for (const ch of story.chapters) {
    texts.push(ch.title, ...ch.intro.lines, ch.caption ?? '', ...(ch.tutorial ?? []).flatMap((t) => [t.title, t.body]));
    if (ch.intro.document) texts.push(ch.intro.document.title, ch.intro.document.body);
    for (const lm of ch.landmarks) texts.push(lm.name, lm.label ?? '');
    for (const f of [...ch.fragments, ...ch.fallbackReflections]) if (!f.untrusted) texts.push(f.title, f.body);
  }
  const words = new Set<string>(COMMON_WORDS);
  for (const t of texts) for (const m of t.matchAll(NAME_TOKEN)) words.add(stripPossessive(m[0]).toLowerCase());
  vocabularies.set(story, words);
  return words;
}

/** Plain words a sentence may start with that a small story may never use (the real one uses most). */
const COMMON_WORDS = (
  'a an the and but or nor so yet if then than when while where after before since until once because ' +
  'although though unless whether i you he she it we they me him her us them my your his its our their ' +
  'this that these those there here what which who whom whose why how all any both each every either ' +
  'neither few many most much more less some such no not nobody none nothing nowhere somebody someone ' +
  'something somewhere anybody anyone anything anywhere everybody everyone everything everywhere also ' +
  'again already always never often sometimes perhaps maybe still just only even later earlier first ' +
  'next last finally afterwards instead meanwhile otherwise besides however indeed today tonight ' +
  'yesterday tomorrow now soon above below beside between beyond inside outside near along across behind ' +
  'beneath under over through toward towards upstream downstream at by for from in into of off on onto ' +
  'out to up with within without is are was were be been being have has had do does did will would ' +
  'shall should can could may might must yes oh well'
).split(' ');

/** A word of the story's vocabulary in some plain form: "Rooms" for "room", "Industries" for "industry". */
function inVocabulary(word: string, vocabulary: ReadonlySet<string>): boolean {
  const w = word.toLowerCase();
  const forms = [w, w.replace(/(?:es|s)$/, ''), w.replace(/ies$/, 'y'), w.replace(/y$/, 'ies'), w.replace(/(?:ed|ing|ly)$/, ''), `${w}s`];
  return forms.some((f) => f.length > 1 && vocabulary.has(f));
}

function continuityIssues(title: string, body: string, ctx: ValidationContext, issues: ValidationIssue[]): number {
  const known = knownNameTokens(ctx);
  const text = `${title}\n${body}`;
  let checked = 0;
  // 1. Unknown names: capitalised words that no trusted source uses; acronyms likewise. Mid-sentence a
  //    capital marks a name. At the start of a sentence, and anywhere in the Title Case title, every
  //    word is capitalised: there a word is a name only if neither the story nor this text ever writes
  //    it in lower case ("Margaret held the ladder" is caught, "Downstream, your route…" is not).
  checked++;
  const unknown = new Set<string>();
  const vocabulary = storyVocabulary(ctx.story);
  const own = new Set([...text.matchAll(/\b[a-z][a-z'’-]*/g)].map((m) => stripPossessive(m[0])));
  const ordinary = (tok: string): boolean => inVocabulary(tok, vocabulary) || own.has(tok.toLowerCase());
  const scan = (part: string, titleCase: boolean): void => {
    for (const m of part.matchAll(NAME_TOKEN)) {
      const tok = stripPossessive(m[0]);
      if (!/^[A-Z]/.test(tok) || tok.length < 2 || known.has(tok) || CALENDAR_PLURAL.test(m[0])) continue;
      const acronym = /^[A-Z]{2,}$/.test(tok);
      if (!acronym && (titleCase || isSentenceStart(part, m.index ?? 0)) && ordinary(tok)) continue;
      unknown.add(tok);
    }
  };
  scan(title, true);
  scan(body, false);
  for (const u of [...unknown].slice(0, 6)) {
    issues.push({ group: 'continuity', code: 'unknown-name', message: `"${u}" is not a name in the story bible, the landmarks or the records` });
  }
  // 2. Characters before their chapter: any distinctive token of a future character's name (or of a
  //    name the archive has not revealed yet, though the character has appeared).
  checked++;
  for (const c of ctx.story.bible.characters) {
    if (isVisibleAt(nameVisibleFrom(c), ctx)) continue;
    const distinctive = tokensOf(c.name).filter((t) => t.length >= 3 && /^[A-Z]/.test(t) && !known.has(t));
    const hit = distinctive.find((t) => new RegExp(`\\b${t}\\b`).test(text));
    if (hit) {
      // The chapter that reveals the NAME (the archivist appears from chapter 1, named from chapter 8).
      issues.push({ group: 'continuity', code: 'early-character', message: `"${hit}" is not named in the story until ${nameVisibleFrom(c)}` });
    }
  }
  // 3. Places before their chapter, unless a record or chapter card the player has already read names
  //    it (a chapter 3 bus timetable mentions Riverside, the town of chapter 4).
  checked++;
  const read = [...visibleChapterText(ctx), ...visibleFragments(ctx).flatMap((f) => [f.title, f.body, f.author ?? ''])].join('\n');
  for (const l of ctx.story.bible.locations) {
    if (!isVisibleAt(l.chapterId, ctx) && l.name.length > 3 && text.includes(l.name) && !read.includes(l.name)) {
      issues.push({ group: 'continuity', code: 'early-location', message: `"${l.name}" does not appear until ${l.chapterId}` });
    }
  }
  // 4. Revelations (and hidden backstories) before their chapter: a shared run of words gives it away.
  checked++;
  for (const r of ctx.story.bible.revelations) {
    if (!isVisibleAt(r.chapterId, ctx) && sharesRun(text, r.text, REVEAL_NGRAM)) {
      issues.push({ group: 'continuity', code: 'early-revelation', message: `the text reveals "${r.id}", which belongs to ${r.chapterId}` });
    }
  }
  for (const c of ctx.story.bible.characters) {
    if (c.revealedIn && !isVisibleAt(c.revealedIn, ctx) && sharesRun(text, c.history, REVEAL_NGRAM + 1)) {
      issues.push({ group: 'continuity', code: 'early-revelation', message: `the text reveals ${c.id}'s history before ${c.revealedIn}` });
    }
  }
  return checked;
}

// -------------------------------------------------------------------------------------------------
// Safety scans
// -------------------------------------------------------------------------------------------------

/** Deaths, injuries, bodies: never in this story (collisions never imply casualties). */
const CASUALTY =
  /\b(died|dies|dying|dead|death|deaths|killed|kill|kills|killing|corpses?|bodies|casualt(?:y|ies)|victims?|drown(?:ed|ing|s)?|perish(?:ed|es|ing)?|fatal(?:ity|ities)?|injur(?:ed|y|ies)|wounded|funerals?|buried alive|lives (?:were )?lost|lost (?:their|his|her) li(?:fe|ves)|never came home|went missing|reported missing|missing (?:persons?|people|children|residents)|(?:not\s+|un)accounted\s+for)\b/i;
/** Claims or implications that people were inside a structure when it broke. */
const PEOPLE_INSIDE = [
  /\b(?:was|were)\s+(?:still\s+)?(?:inside|indoors|asleep|sleeping|trapped|sheltering)\b/i,
  /\b(?:trapped|asleep|sleeping|sheltering|hiding)\s+(?:inside|in\s+(?:the|their|her|his)|within|under)\b/i,
  /\b(?:someone|anyone|people|families|family|children|residents|workers|they|she|he)\s+(?:was|were|had\s+been|stayed|remained|still)\s+(?:still\s+)?(?:in\s+there|in\s+it|inside|home|at\s+home)\b/i,
  /\binside\b[^.!?]{0,40}\bwhen\b[^.!?]{0,40}\b(?:hit|struck|broke|fell|came|arrived)\b/i,
  /\b(?:family|families|people|children|residents|workers|someone|anyone|everyone)\b[^.!?]{0,30}\b(?:inside|indoors)\b/i,
  // "Nobody got out", "she never made it out": someone was inside. ("All of them got out" is the
  // record, and passes.)
  /\b(?:nobody|no\s+one|none(?:\s+of\s+(?:them|us))?|not\s+everyone|not\s+all(?:\s+of\s+them)?)\s+(?:got|made\s+it|came|went)\s+out\b/i,
  /\b(?:did\s+not|didn't|never|could\s+not|couldn't)\s+(?:get|got|make\s+it|made\s+it|come|came)\s+out\b/i,
  /\b(?:was|were|been|still|stayed|remained)\s+(?:still\s+)?under\s+(?:the|that|this|their|her|his|its)\s+roof\b/i,
  /\bunder\s+(?:the|that|this|their|her|his|its)\s+roof\s+when\b/i,
  /\b(?:was|were)\s+(?:still\s+)?(?:at\s+)?home\s+when\b/i,
];
/**
 * Words that assert a structure survived. Each is tied to the landmark or place it is said of (see
 * proseIssues): that landmark must be intact in the run, that place whole.
 */
const SPARED =
  /\b(saved|spared|left standing|left (?:[\w.'-]+ ){1,4}(?:standing|intact|alone)|still stands|still standing|stands still|still there|survived|survives|untouched|unharmed|remains standing|remained standing|left intact|intact|stayed standing|kept standing|stood when you|stood in your run|(?:was|were) standing when|held when you|still held)\b/gi;
/**
 * Words that assert a structure broke. A bare "went" counts only where a clause ends on it or it goes
 * "with" / "into" / "under" something ("When No. 14 went,"), never "went past" or "went down the lane".
 */
const BROKE =
  /\b(broke|broken|destroyed|smashed|flattened|levell?ed|collapsed|toppled|breached|burst|damaged|came down|gave way|washed away|swept away|knocked down|went through|ploughed through|plowed through|tore through|took|was lost|were lost|(?:is|are|was|were|has|have|had) gone|went(?=\s*(?:[,.;:!?)]|$)|\s+(?:with|into|under|too|first|next|last)\b)|fell(?=\s*(?:[,.;:!?)]|$)|\s+(?:down|apart|in|into)\b))\b/gi;
/** A negation just before a status word turns it round ("was not spared", "nothing broke"). */
const NEGATED = /\b(?:not|never|no\s+longer|nothing|n't)\b[^.;!?]{0,12}$/i;
/**
 * Real-world science (as opposed to the story's own glacier and its fictional waste water): only ever
 * from a cited fact. Climate terms, and the pollution science of the four EPA and NOAA facts.
 */
const SCIENCE =
  /\b(sea[- ]levels?|seas?\s+(?:are|is|were|have\s+been)\s+rising|rising\s+seas|ice\s+sheets?|greenland|antarctic(?:a)?|global(?:ly)?\s+(?:warming|temperatures?|average|mean|emissions|heating)|greenhouse|carbon\s+dioxide|co2|climate\s+change|world'?s\s+glaciers|glaciers\s+(?:worldwide|around\s+the\s+world|across\s+the\s+world|everywhere)|pre-?industrial|degrees?\s+(?:celsius|fahrenheit)|parts\s+per\s+million|nonpoint[- ]source|particulate(?:\s+matter)?|marine\s+debris|stormwater|underground\s+storage\s+tanks?)\b|\d\s?°\s?[CF]\b/i;
const URL = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|io|ai|gov|edu)\b/i;
/** Secret-shaped strings and the names of the variables that hold them. */
const SECRET_SHAPES = /\bsk-[A-Za-z0-9_-]{8,}|PORTKEY|API[_ -]?KEY|SECRET[_ -]?CANARY|\bBearer\s+[A-Za-z0-9._-]{8,}|\.env\b/i;
/** The machinery behind the story must never show through. */
const META =
  /\b(get_[a-z_]+|validate_narrative_events|check_narrative_continuity|read_file|run_shell|system prompt|tool call|function call|as an ai|language model|instructions? (?:say|tell)|ignore (?:all |previous |the )?instructions)\b/i;

/**
 * "Asleep" on a train is not "asleep" in a house. The one exemption from PEOPLE_INSIDE: "was/were
 * asleep|sleeping" followed in the same clause by "on/in … train|van|carriage|coach|bus|boat" with no
 * word for a building, a bed or a relative position in between (the archivist "was asleep on four
 * boxes in a guard's van" when her house went: a real chapter 8 record). "were asleep in the house by
 * the train" and "were sleeping in their beds above the bus depot" are still rejected.
 */
const ASLEEP_AWAY =
  /\b(?:was|were)\s+(?:still\s+)?(?:asleep|sleeping)\s+(?:on|in|aboard)\b(?:(?!\b(?:house|home|homes|flat|flats|cottage|hut|chalet|building|church|chapel|school|hall|room|bedroom|beds?|attic|cellar|basement|kitchen|upstairs|downstairs|bothy|farm|mill|office|shop|cabin|barn|lodge|inn|hotel|station|depot|garage|above|below|beside|behind|near|by|next|opposite|over|under|beneath)\b)[^.!?;,])*?\b(?:train|van|carriage|coach|bus|boat|ferry)s?\b/gi;

function safetyIssues(draft: NarrativeDraft, ctx: ValidationContext, issues: ValidationIssue[]): number {
  const prose = `${draft.title}\n${draft.text}`;
  const everything = `${prose}\n${JSON.stringify({ f: draft.fragmentIds, x: draft.factIds, c: draft.claims })}`;
  const cas = CASUALTY.exec(prose);
  if (cas) issues.push({ group: 'safety', code: 'casualty', message: `"${cas[0]}": the story never describes deaths, injuries or bodies` });
  // Only the people-inside scan reads the text with "asleep on the train" taken out; every other scan
  // reads it whole.
  const insideProse = prose.replace(ASLEEP_AWAY, ' ');
  for (const p of PEOPLE_INSIDE) {
    const m = p.exec(insideProse);
    if (m) {
      issues.push({ group: 'safety', code: 'people-inside', message: `"${m[0]}": never say or imply that anyone was inside a structure` });
      break;
    }
  }
  if (URL.test(everything)) issues.push({ group: 'safety', code: 'url', message: 'the text contains a URL or web address' });
  const shape = SECRET_SHAPES.exec(everything);
  const exact = (ctx.secrets ?? []).some((s) => s.length >= 6 && everything.includes(s));
  if (shape || exact) {
    issues.push({ group: 'safety', code: 'secret', message: 'the output contains a secret, a key or a configuration name' });
  }
  const meta = META.exec(prose);
  if (meta) issues.push({ group: 'safety', code: 'meta', message: `"${meta[0]}": the text must not mention tools, prompts or the system` });
  return 5;
}

// -------------------------------------------------------------------------------------------------
// The prose against the evidence
// -------------------------------------------------------------------------------------------------
//
// True claims are not enough: "You broke the Pells' house; No. 14 still stands" declares two true
// claims on a run that broke both. So the prose itself is read, clause by clause, for what it says of
// each landmark and place it names (by name, label or a short form: "St Bride's", "No. 14", "the
// Pells' house"): a survival word ("still stands", "remained intact", "saved") needs THAT landmark
// intact in the run, or that place whole; a breaking word ("broke", "came down", "went through") needs
// it destroyed or damaged; "N houses" next to a breaking word must be a count the run or the history
// holds. Heuristic by design (a regex reading of English, tuned so the approved real texts in
// docs/evidence pass): what it cannot attach to a name is left to the claims and the Historian.

/** Curly quotes as straight ones, so "St Bride’s" reads as "St Bride's". */
const straightQuotes = (s: string): string => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

interface Clause {
  readonly text: string;
  readonly start: number;
}

/**
 * The text split at sentence ends, semicolons, line breaks and a comma before "and", "but", "then"…
 * ("the footbridge went first, and the gauge hut was left standing" says two things of two places);
 * "No. 14", "St." and "4.5" stay whole.
 */
function clausesOf(text: string): Clause[] {
  const out: Clause[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?;]+(?=["')\]]*(?:\s|$))|\n+|,(?=\s+(?:and|but|then|while|whereas|yet|so|though|although|until)\b)/g)) {
    const end = m.index ?? 0;
    if (m[0].startsWith('.') && /\b(?:No|St|Mr|Mrs|Ms|Dr|Mt)$/.test(text.slice(Math.max(0, end - 4), end))) continue;
    out.push({ text: text.slice(start, end), start });
    start = end + m[0].length;
  }
  if (start < text.length) out.push({ text: text.slice(start), start });
  return out.filter((c) => c.text.trim().length > 0);
}

/** A landmark or a place named in the prose. */
interface Mention {
  readonly start: number;
  readonly end: number;
  readonly landmark?: { readonly id: string; readonly name: string; readonly chapterId: ChapterId };
  /** A bible location (its chapter), or "the town", "the village": the chapter being reflected on. */
  readonly place?: { readonly name: string; readonly chapterId: ChapterId };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where an alias stops: "The shepherd's hut above the Leap" is "shepherd's hut", "St Bride's, the church on the hill" "St Bride's". */
const ALIAS_CUT = /,|\s(?:on|at|above|below|by|in|across|beside|before|after|over|under|near|off|from)\s/i;

/** The names a landmark goes by: its name and label, and short forms of the name. */
function aliasesOf(name: string, label: string | undefined): string[] {
  const n = straightQuotes(name);
  const out = new Set<string>([n, n.replace(/,/g, '')]);
  if (label) out.add(straightQuotes(label));
  const head = n.replace(/^the\s+/i, '').split(ALIAS_CUT)[0].trim();
  // A one-word short form only if it is a proper name ("Marit"); "the chalet" could be any chalet.
  if (head.includes(' ') || /^[A-Z][a-z]{3,}$/.test(head)) out.add(head);
  const no = /^No\. \d+/.exec(head);
  if (no) out.add(no[0]);
  const possessive = /^(\S+) (\S+)'s (.+)$/.exec(head); // "Tomas Lind's chalet": Tomas's, Lind's
  if (possessive) {
    out.add(`${possessive[1]}'s ${possessive[3]}`);
    out.add(`${possessive[2]}'s ${possessive[3]}`);
  }
  return [...out].filter((a) => a.length > 3);
}

const COMMUNITY =
  /\b(?:the|this|that|our|my|your|its)\s+(?:whole\s+)?(?:town|village|hamlet|glen|valley|mesa|canyon|community|neighbourhood|settlement)\b|\b(?:everything|all\s+of\s+it|the\s+whole\s+of\s+it|the\s+rest\s+of\s+it)\b/gi;

/** Every landmark and place the prose names, longest match first, none inside another. */
function mentionsIn(text: string, ctx: ValidationContext): Mention[] {
  const found: Mention[] = [];
  const visible = ctx.story.chapters.filter((ch) => chapterOrder(ch.id) <= chapterOrder(ctx.chapter.id));
  // Short forms two landmarks share name neither.
  const owners = new Map<string, Set<string>>();
  for (const ch of ctx.story.chapters) {
    for (const lm of ch.landmarks) {
      for (const a of aliasesOf(lm.name, lm.label)) owners.set(a.toLowerCase(), (owners.get(a.toLowerCase()) ?? new Set()).add(lm.id));
    }
  }
  for (const ch of visible) {
    for (const lm of ch.landmarks) {
      for (const a of aliasesOf(lm.name, lm.label)) {
        if ((owners.get(a.toLowerCase())?.size ?? 0) > 1) continue;
        for (const m of text.matchAll(new RegExp(`(?<![\\w'])${escapeRe(a)}(?:s|es)?(?![\\w])`, 'gi'))) {
          const start = m.index ?? 0;
          found.push({ start, end: start + m[0].length, landmark: { id: lm.id, name: lm.name, chapterId: ch.id } });
        }
      }
    }
  }
  for (const loc of ctx.story.bible.locations) {
    if (chapterOrder(loc.chapterId) > chapterOrder(ctx.chapter.id)) continue;
    for (const a of new Set([loc.name, loc.name.replace(/^The\s+/, '')])) {
      for (const m of text.matchAll(new RegExp(`(?<![\\w'])${escapeRe(a)}(?![\\w])`, 'g'))) {
        const start = m.index ?? 0;
        found.push({ start, end: start + m[0].length, place: { name: loc.name, chapterId: loc.chapterId } });
      }
    }
  }
  for (const m of text.matchAll(COMMUNITY)) {
    const start = m.index ?? 0;
    found.push({ start, end: start + m[0].length, place: { name: m[0], chapterId: ctx.chapter.id } });
  }
  const longestFirst = found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Mention[] = [];
  for (const m of longestFirst) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  return kept.sort((a, b) => a.start - b.start);
}

/** A landmark's status in this run (its chapter) or in the saved history (an earlier chapter). */
function statusOf(m: NonNullable<Mention['landmark']>, ctx: ValidationContext): LandmarkStatus {
  if (m.chapterId === ctx.chapter.id) return landmarkStatus(ctx.evidence, m.id);
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    const hit = ctx.history[i].landmarks.find((l) => l.id === m.id);
    if (hit) return hit.status;
  }
  return 'notReached';
}

/** Whether a place came through whole: every landmark of its chapter reached and intact, nothing built broken. */
function placeWhole(chapterId: ChapterId, ctx: ValidationContext): boolean {
  const ch = ctx.story.chapters.find((c) => c.id === chapterId);
  const record =
    chapterId === ctx.chapter.id
      ? { landmarks: ctx.evidence.landmarks, destroyed: ctx.evidence.destroyedByCategory }
      : (() => {
          const h = [...ctx.history].reverse().find((x) => x.chapterId === chapterId);
          return h ? { landmarks: h.landmarks, destroyed: h.destroyedByCategory } : undefined;
        })();
  if (!ch || !record) return false;
  const status = (id: string): LandmarkStatus => record.landmarks.find((l) => l.id === id)?.status ?? 'notReached';
  return ch.landmarks.every((l) => status(l.id) === 'intact') && destroyedTotal(record.destroyed, BUILT_CATEGORIES) === 0;
}

/** Mentions a status word in `text` speaks of: the nearest within reach in its clause, and the list it heads. */
function attached(text: string, word: { start: number; end: number }, inClause: readonly Mention[], landmarksOnly: boolean): Mention[] {
  const REACH = 60;
  const gap = (x: Mention): number => (x.end <= word.start ? word.start - x.end : x.start >= word.end ? x.start - word.end : 0);
  const candidates = inClause.filter((x) => (!landmarksOnly || x.landmark) && gap(x) <= REACH);
  if (candidates.length === 0) return [];
  const nearest = candidates.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  const out = [nearest];
  // "No. 14 and the Pells' house are still standing": a list joined by commas and "and" goes together.
  const LIST = /^\s*,?\s*(?:(?:and|or|nor|&|then)\s+)?(?:(?:the|both)\s+)?$/i;
  const ordered = inClause.filter((x) => !landmarksOnly || x.landmark);
  const at = ordered.indexOf(nearest);
  const step = nearest.end <= word.start ? -1 : nearest.start >= word.end ? 1 : 0;
  for (let i = at + step; step !== 0 && i >= 0 && i < ordered.length; i += step) {
    const [a, b] = step < 0 ? [ordered[i], ordered[i + 1]] : [ordered[i - 1], ordered[i]];
    if (!LIST.test(text.slice(a.end, b.start))) break;
    out.push(ordered[i]);
  }
  return out;
}

/** Count nouns the prose may put a number on, and where the evidence counts them. */
const COUNT_NOUNS: readonly { readonly re: RegExp; readonly kinds?: readonly string[]; readonly categories?: readonly StructureCategory[]; readonly stat?: (e: RunEvidence) => number }[] = [
  { re: /^homes?$/i, categories: ['home'] },
  { re: /^(?:houses?|cottages?)$/i, kinds: ['house'], categories: ['home'] },
  { re: /^chalets?$/i, kinds: ['chalet'] },
  { re: /^(?:buildings?|structures?)$/i, categories: BUILT_CATEGORIES, stat: (e) => e.buildingsDestroyed },
  { re: /^(?:trees?|pines?)$/i, kinds: ['pine', 'broadleaf'], categories: ['nature'], stat: (e) => e.treesFelled },
  { re: /^dams?$/i, kinds: ['dam'], categories: ['water'] },
  { re: /^(?:foot|road)?bridges?$/i, kinds: ['roadBridge', 'footbridge'] },
  { re: /^tanks?$/i, kinds: ['tank'] },
  { re: /^(?:wells?|pumpjacks?|wellheads?)$/i, kinds: ['pumpjack'] },
  { re: /^pipelines?$/i, kinds: ['pipeline'] },
  { re: /^turbines?$/i, kinds: ['windTurbine'] },
  { re: /^towers?$/i, kinds: ['coolingTower', 'waterTower'] },
  { re: /^wagons?$/i, kinds: ['railWagon'] },
  { re: /^cars?$/i, kinds: ['car'] },
  { re: /^trucks?$/i, kinds: ['truck'] },
  { re: /^fences?$/i, kinds: ['fence'] },
  { re: /^barns?$/i, kinds: ['barn'] },
  { re: /^(?:churches|church|chapels?|kirks?)$/i, kinds: ['church'] },
  { re: /^rigs?$/i, kinds: ['oilRig'] },
  { re: /^halls?$/i, kinds: ['factoryHall'] },
  { re: /^(?:blocks?|flats)$/i, kinds: ['apartmentBlock'] },
];

/** The counts "N <noun>" may state: this run's, each earlier chapter's, and the journey's so far. */
function countsFor(noun: (typeof COUNT_NOUNS)[number], ctx: ValidationContext): Set<number> {
  const ev = ctx.evidence;
  const out = new Set<number>();
  const kinds = ev.destroyedByKind as Readonly<Record<string, number | undefined>>;
  if (noun.kinds) {
    out.add(noun.kinds.reduce((n, k) => n + (kinds[k] ?? 0), 0));
    for (const k of noun.kinds) out.add(kinds[k] ?? 0);
  }
  if (noun.stat) out.add(noun.stat(ev));
  if (noun.categories) {
    const here = destroyedTotal(ev.destroyedByCategory, noun.categories);
    let journey = here;
    out.add(here);
    for (const h of ctx.history) {
      const n = destroyedTotal(h.destroyedByCategory, noun.categories);
      out.add(n);
      journey += n;
    }
    out.add(journey);
    out.add(journey - here);
  }
  return out;
}

const NUMBER_HERE = new RegExp(`\\b(?:\\d+|${NUMBER_WORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMBER_WORD})*)\\b`, 'gi');
/** "two (old) houses", "six of its homes": the noun a number counts, up to two words on. */
const COUNTED =
  /^\s+(?:of\s+(?:the\s+|its\s+|their\s+|[A-Z][\w']*\s+)?)?(?:(?!(?:in|at|on|by|to|from|for|with|was|were|is|are|had|has|have|and|or|but|then|that|which|who|it|they|of)\b)[A-Za-z'-]+\s+){0,2}?([A-Za-z]+)\b/;

function proseIssues(draft: NarrativeDraft, ctx: ValidationContext, issues: ValidationIssue[]): number {
  const text = straightQuotes(`${draft.title}\n${draft.text}`);
  const mentions = mentionsIn(text, ctx);
  const say = (code: string, message: string): void => {
    if (!issues.some((i) => i.code === code && i.message === message)) issues.push({ group: 'events', code, message });
  };
  // A survival word attached to no name keeps the old rule: some true intact landmark claim.
  const someIntactClaim = draft.claims.some(
    (c) => (c.type === 'landmark' || c.type === 'history') && c.status === 'intact' && claimProblem(c, ctx) === null,
  );
  for (const clause of clausesOf(text)) {
    const end = clause.start + clause.text.length;
    const inClause = mentions.filter((m) => m.start >= clause.start && m.end <= end);
    const negated = (at: number): boolean => NEGATED.test(text.slice(clause.start, at));
    let breaks = false;
    for (const m of clause.text.matchAll(SPARED)) {
      const word = { start: clause.start + (m.index ?? 0), end: clause.start + (m.index ?? 0) + m[0].length };
      const no = negated(word.start);
      const about = attached(text, word, inClause, false);
      if (about.length === 0) {
        if (!no && !someIntactClaim) say('spared', `"${m[0]}" needs a true landmark claim with status intact`);
        continue;
      }
      for (const x of about) {
        if (x.landmark) {
          const status = statusOf(x.landmark, ctx);
          const ok = no ? status === 'destroyed' || status === 'damaged' : status === 'intact';
          if (!ok) say('spared', `"${m[0]}" is said of ${x.landmark.name}, which is ${status} in ${x.landmark.chapterId === ctx.chapter.id ? 'this run' : `the ${x.landmark.chapterId} run`}`);
        } else if (x.place) {
          const whole = placeWhole(x.place.chapterId, ctx);
          if (whole === no) {
            say('spared', `"${m[0]}" is said of ${x.place.name}, but ${no ? 'nothing there broke' : 'the run broke some of it (or did not reach all of it)'}`);
          }
        }
      }
    }
    for (const m of clause.text.matchAll(BROKE)) {
      const word = { start: clause.start + (m.index ?? 0), end: clause.start + (m.index ?? 0) + m[0].length };
      const no = negated(word.start);
      if (!no) breaks = true;
      for (const x of attached(text, word, inClause, true)) {
        const status = statusOf(x.landmark!, ctx);
        const ok = no ? status !== 'destroyed' : status === 'destroyed' || status === 'damaged';
        if (!ok) say('broken', `"${m[0]}" is said of ${x.landmark!.name}, which is ${status} in ${x.landmark!.chapterId === ctx.chapter.id ? 'this run' : `the ${x.landmark!.chapterId} run`}`);
      }
    }
    // "Seven houses went": a count next to a breaking word is a count the record holds.
    if (!breaks) continue;
    for (const n of clause.text.matchAll(NUMBER_HERE)) {
      const at = n.index ?? 0;
      const before = clause.text.slice(0, at);
      if (/\b(?:of|of\s+the|of\s+its|of\s+their|No\.)\s*$/i.test(before)) continue; // "two of the three": a total
      const counted = COUNTED.exec(clause.text.slice(at + n[0].length));
      const noun = counted && COUNT_NOUNS.find((c) => c.re.test(counted[1]));
      if (!noun) continue;
      const values = extractNumbers(n[0]).map((v) => v.value);
      if (values.length !== 1 || values[0] >= 1000 || /^\d{4}$/.test(n[0])) continue; // years ("the 1952 dam")
      if (!countsFor(noun, ctx).has(values[0])) {
        say('prose-count', `"${n[0]} ${counted![1]}" is not a count of this run or the saved history`);
      }
    }
  }
  // A landmark named in the title or text must be declared, so its status is checked.
  const declared = new Set(draft.claims.flatMap((c) => (c.type === 'landmark' || c.type === 'history' ? [c.landmarkId] : [])));
  for (const m of mentions) {
    if (m.landmark && !declared.has(m.landmark.id)) {
      say('undeclared-landmark', `"${m.landmark.name}" is named but has no landmark claim`);
      declared.add(m.landmark.id);
    }
  }
  return 4;
}

// -------------------------------------------------------------------------------------------------
// The land's look against the world's condition
// -------------------------------------------------------------------------------------------------
//
// The player sees the valleys wear down chapter by chapter (src/story/environment.ts), and the agents
// get that look in words (get_run_summary's `world`, src/story/worldLook.ts). So the text may call the
// river brown or the sky grey only where the chapter's world is, and may blame the look on the
// player's earlier toppling only where their record added to it, for the places it names. The same
// heuristic reading as proseIssues: patterns over clauses, negation turns them off.

const LOOK_WORDS: Readonly<Record<keyof Pick<WorldLook, 'water' | 'sky' | 'grass' | 'trees' | 'snow'>, string>> = {
  water: 'its rivers and streams are',
  sky: 'its sky is',
  grass: 'its grass is',
  trees: 'its trees are',
  snow: 'its snow is',
};

function worldIssues(draft: NarrativeDraft, ctx: ValidationContext, issues: ValidationIssue[]): number {
  const look = ctx.world ?? worldLookFor(ctx.chapter.id, ctx.history);
  const text = straightQuotes(`${draft.title}\n${draft.text}`);
  const say = (message: string): void => {
    if (!issues.some((i) => i.code === 'world' && i.message === message)) issues.push({ group: 'events', code: 'world', message });
  };
  const here = chapterOrder(ctx.chapter.id);
  const earlierPlaces = ctx.story.bible.locations.filter((l) => chapterOrder(l.chapterId) >= 0 && chapterOrder(l.chapterId) < here);
  for (const clause of clausesOf(text)) {
    for (const p of WORLD_PATTERNS) {
      for (const m of clause.text.matchAll(p.re)) {
        if (NEGATED.test(clause.text.slice(0, m.index ?? 0))) continue;
        if (p.never || !lookHas(look, p.channel, p.needs)) {
          const is = p.never ?? (look[p.channel] === 'none' ? 'it has no snow' : `${LOOK_WORDS[p.channel]} ${look[p.channel]}`);
          say(`"${m[0].trim()}" is not how this chapter looks: ${is} (the world's condition)`);
        }
      }
    }
    if (!WORLD_WORD.test(clause.text) || !BLAMES_PLAYER.test(clause.text)) continue;
    const named = earlierPlaces.filter((l) => new RegExp(`(?<![\\w'])${escapeRe(l.name.replace(/^The\s+/, ''))}(?![\\w])`).test(clause.text));
    if (named.length === 0 && !EARLIER_RUNS.test(clause.text)) continue;
    if (look.fromYourRecord === 'none') {
      say(`"${clause.text.trim().slice(0, 80)}": nothing the player toppled in earlier chapters added to this chapter's look`);
    }
    for (const l of named) {
      if (!look.toppledIn.includes(l.chapterId)) {
        say(`"${clause.text.trim().slice(0, 80)}": the player toppled no extraction, industry or energy in ${l.name}`);
      }
    }
  }
  return 2;
}

// -------------------------------------------------------------------------------------------------
// The validator
// -------------------------------------------------------------------------------------------------

export const wordCount = (text: string): number => (text.match(/[A-Za-z0-9][A-Za-z0-9'’.,-]*/g) ?? []).length;

/**
 * Validates a draft against everything known. `groups` restricts the report to some issue groups (the
 * Historian's tools); the final gate always runs them all.
 */
export function validateNarrative(
  draft: NarrativeDraft,
  ctx: ValidationContext,
  groups: readonly IssueGroup[] = ['form', 'events', 'continuity', 'safety'],
): ValidationReport {
  const issues: ValidationIssue[] = [];
  let checked = 0;
  const want = (g: IssueGroup): boolean => groups.includes(g);

  if (want('form')) {
    checked += 4;
    const [lo, hi] = WORD_LIMITS[ctx.mode];
    const n = wordCount(draft.text);
    if (n < lo || n > hi) issues.push({ group: 'form', code: 'length', message: `the text has ${n} words; it must have ${lo}–${hi}` });
    if (!draft.title.trim() || draft.title.length > TITLE_MAX_CHARS) {
      issues.push({ group: 'form', code: 'title', message: `the title must be 1–${TITLE_MAX_CHARS} characters` });
    }
    if (draft.fragmentIds.length > MAX_FRAGMENT_IDS || draft.factIds.length > MAX_FACT_IDS || draft.claims.length > MAX_CLAIMS) {
      issues.push({ group: 'form', code: 'too-many', message: `at most ${MAX_FRAGMENT_IDS} fragments, ${MAX_FACT_IDS} facts, ${MAX_CLAIMS} claims` });
    }
    if (/[{}<>`]|\[\[|\]\]/.test(draft.text)) {
      issues.push({ group: 'form', code: 'markup', message: 'the text must be plain prose (no JSON, markup or code)' });
    }
    // The student's plain-English rules (src/story/plainWords.ts, the same patterns the authored text is
    // tested with): full names, never a bare initial; plain words, not ones a reader needs explained.
    checked += 2;
    const prose = `${draft.title}\n${draft.text}`;
    const initial = bareInitials(prose)[0];
    if (initial) {
      issues.push({ group: 'form', code: 'initial', message: `"${initial}": name the person in full (as the records do), never by an initial` });
    }
    const glossed = glossedWords(prose)[0];
    if (glossed) {
      issues.push({ group: 'form', code: 'plain-words', message: `"${glossed}": use a plain modern word that needs no explaining` });
    }
  }

  if (want('events') || want('continuity')) {
    draft.claims.forEach((claim, i) => {
      // An unknown claim type (never past the schema, but this module is shared) counts as an event
      // claim so it is reported rather than silently skipped.
      const g: IssueGroup = CLAIM_GROUP[claim.type] || 'events';
      if (!want(g)) return;
      checked++;
      const p = claimProblem(claim, ctx);
      if (p) issues.push({ group: g, code: `claim-${String(claim.type)}`, message: `claim ${i + 1}: ${p}` });
    });
  }

  if (want('continuity')) {
    const claimed = new Set(draft.claims.flatMap((c) => (c.type === 'fragment' ? [c.fragmentId] : [])));
    for (const fid of draft.fragmentIds) {
      if (claimed.has(fid)) continue;
      checked++;
      const p = fragmentProblem(fid, ctx);
      if (p) issues.push({ group: 'continuity', code: 'fragment', message: p });
    }
    const claimedFacts = new Set(draft.claims.flatMap((c) => (c.type === 'fact' ? [c.factId] : [])));
    for (const xid of draft.factIds) {
      if (claimedFacts.has(xid)) continue;
      checked++;
      if (!ctx.story.facts.some((f) => f.id === xid)) issues.push({ group: 'continuity', code: 'fact', message: `climate fact "${xid}" is not approved` });
    }
    checked += continuityIssues(draft.title, draft.text, ctx, issues);
    // Real climate science appears only as an approved, cited fact (the story's own glacier is fiction).
    checked++;
    const science = SCIENCE.exec(`${draft.title}\n${draft.text}`);
    if (science && citedFactIds(draft).length === 0) {
      issues.push({ group: 'continuity', code: 'uncited-science', message: `"${science[0]}": real climate science needs an approved fact, cited` });
    }
  }

  if (want('events')) {
    // Numbers: every one must come from the run, the history, a cited record or a cited fact.
    checked++;
    const allowed = allowedNumbers(draft, ctx);
    const bad = extractNumbers(`${draft.title}\n${draft.text}`).filter((n) => !allowed.has(numKey(n.value)));
    for (const n of bad.slice(0, 4)) {
      issues.push({ group: 'events', code: 'number', message: `"${n.raw}" is not a number from the run, the history, a cited record or a cited fact` });
    }
    // The prose, title included, against the run: survival and breaking words against the status of
    // the landmark or place they are said of, counts of what broke, every named landmark declared.
    checked += proseIssues(draft, ctx, issues);
    // The land's look (water, sky, grass, trees, snow) against the chapter's world, and blame for it.
    checked += worldIssues(draft, ctx, issues);
    // Something must be grounded in what the player did, so different routes read differently. The
    // epilogue may ground itself in the saved history (earlier chapters) as well as the last run.
    checked++;
    const grounding: readonly NarrativeClaim['type'][] =
      ctx.mode === 'epilogue' ? ['landmark', 'count', 'outcome', 'growth', 'history'] : ['landmark', 'count', 'outcome', 'growth'];
    if (!draft.claims.some((c) => grounding.includes(c.type))) {
      issues.push({ group: 'events', code: 'ungrounded', message: `the ${ctx.mode} makes no claim about what the player did (${grounding.join(', ')})` });
    }
  }

  if (want('safety')) checked += safetyIssues(draft, ctx, issues);

  return { passed: issues.length === 0, checked, issues };
}
