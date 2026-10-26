import { ALL_OBSTACLE_KINDS } from '../core/terrain/validate';
import type {
  ChapterDef,
  ChapterId,
  EpilogueRequest,
  HistoryItem,
  ReflectRequest,
  RunEvidence,
  StructureCategory,
} from '../story/types';
import { CHAPTER_IDS } from '../story/types';
import { chapterOrder, MAX_CLAIMS, MAX_FACT_IDS, MAX_FRAGMENT_IDS, TITLE_MAX_CHARS, type StoryData } from '../story/validate';
import { arr, id, int, num, obj, oneOfStrings, str, validate, type RecordSchema, type Schema } from './schema';

/**
 * Schemas and semantic checks for everything that crosses a trust boundary: the browser's request bodies
 * (RunEvidence and the saved history are UNTRUSTED: a modified client can send anything) and the agents'
 * JSON replies. Shapes are checked by schema (types, ranges, sizes, enums, id format); meaning is
 * checked against the trusted story data (the chapter exists, the landmarks and fragments are that
 * chapter's own, the history is earlier and in order).
 */

export const STRUCTURE_CATEGORIES: readonly StructureCategory[] = [
  'home', 'community', 'transport', 'water', 'energy', 'extraction', 'industry', 'farm', 'nature', 'other',
];
const LANDMARK_STATUSES = ['destroyed', 'damaged', 'intact', 'notReached'] as const;
const NOTABLE_TYPES = ['broke', 'felled', 'waterfall', 'absorbed', 'chipped', 'landed', 'enteredOcean', 'damBreached'] as const;
const FAIL_REASONS = ['stuck', 'melted', 'outOfBounds', 'fell'] as const;

/** Generous ceilings: real runs are far below them; they only stop absurd or hostile values. */
const COUNT = int(0, 100_000);
const SECONDS = num(0, 36_000);
const METRES = num(-1_000_000, 1_000_000);
const TONNES = num(0, 100_000_000);
const MAX_LANDMARKS = 40;
const MAX_HISTORY = CHAPTER_IDS.length - 1;
export const MAX_EXCERPT_CHARS = 300;

const record = (keys: readonly string[], value: Schema): RecordSchema => ({
  type: 'object',
  propertyNames: { enum: keys },
  additionalProperties: value,
  maxProperties: keys.length,
});

const landmarkOutcome = obj(
  { id: id(), status: oneOfStrings(LANDMARK_STATUSES), closest: num(0, 1_000_000) },
  ['id', 'status', 'closest'],
);
const byCategory = record(STRUCTURE_CATEGORIES, COUNT);

export const RUN_EVIDENCE_SCHEMA = obj(
  {
    version: int(1, 1),
    chapterId: oneOfStrings(CHAPTER_IDS),
    levelId: id(),
    outcome: oneOfStrings(['complete', 'failed']),
    failReason: oneOfStrings(FAIL_REASONS),
    time: SECONDS,
    distance: num(0, 1_000_000),
    topSpeed: num(0, 1000),
    startMass: TONNES,
    endMass: TONNES,
    peakMass: TONNES,
    absorbed: TONNES,
    iceLeft: num(0, 100),
    waterfallsCrossed: COUNT,
    collisions: COUNT,
    treesFelled: COUNT,
    knockedDown: COUNT,
    buildingsDestroyed: COUNT,
    storyPoints: int(0, 1_000_000_000),
    destroyedByCategory: byCategory,
    destroyedByKind: record(ALL_OBSTACLE_KINDS, COUNT),
    landmarks: arr(landmarkOutcome, MAX_LANDMARKS),
    notable: arr(
      obj(
        {
          t: SECONDS,
          type: oneOfStrings(NOTABLE_TYPES),
          kind: oneOfStrings(ALL_OBSTACLE_KINDS),
          category: oneOfStrings(STRUCTURE_CATEGORIES),
          landmarkId: id(),
          s: METRES,
          d: METRES,
          value: num(-1_000_000_000, 1_000_000_000),
        },
        ['t', 'type', 's', 'd'],
      ),
      30,
    ),
    route: arr(obj({ s: METRES, d: METRES }, ['s', 'd']), 40),
    reachedS: METRES,
    coastS: METRES,
  },
  [
    'version', 'chapterId', 'levelId', 'outcome', 'time', 'distance', 'topSpeed', 'startMass', 'endMass', 'peakMass',
    'absorbed', 'iceLeft', 'waterfallsCrossed', 'collisions', 'treesFelled', 'knockedDown', 'buildingsDestroyed',
    'storyPoints', 'destroyedByCategory', 'destroyedByKind', 'landmarks', 'notable', 'route', 'reachedS', 'coastS',
  ],
);

export const HISTORY_ITEM_SCHEMA = obj(
  {
    chapterId: oneOfStrings(CHAPTER_IDS),
    outcome: oneOfStrings(['complete', 'failed']),
    storyPoints: int(0, 1_000_000_000),
    destroyedByCategory: byCategory,
    // Optional (older clients): the world's condition weighs earlier toppling by kind.
    destroyedByKind: record(ALL_OBSTACLE_KINDS, COUNT),
    landmarks: arr(landmarkOutcome, MAX_LANDMARKS),
    fragmentIds: arr(id(), 40),
    reflectionExcerpt: str({ maxLength: MAX_EXCERPT_CHARS }),
  },
  ['chapterId', 'outcome', 'storyPoints', 'destroyedByCategory', 'landmarks', 'fragmentIds', 'reflectionExcerpt'],
);

/** The player's model: id-shaped here; the handler checks it against the allowlist and availability. */
const REQUESTED_MODEL = id('The model to run on (optional; the server default otherwise).');

export const REFLECT_REQUEST_SCHEMA = obj(
  {
    chapterId: oneOfStrings(CHAPTER_IDS),
    evidence: RUN_EVIDENCE_SCHEMA,
    history: arr(HISTORY_ITEM_SCHEMA, MAX_HISTORY),
    model: REQUESTED_MODEL,
  },
  ['chapterId', 'evidence', 'history'],
);

export const EPILOGUE_REQUEST_SCHEMA = obj(
  { evidence: RUN_EVIDENCE_SCHEMA, history: arr(HISTORY_ITEM_SCHEMA, MAX_HISTORY), model: REQUESTED_MODEL },
  ['evidence', 'history'],
);

// -------------------------------------------------------------------------------------------------
// The agents' replies
// -------------------------------------------------------------------------------------------------

const claimOf = (type: string, props: Record<string, Schema>, required: readonly string[]): Schema =>
  obj({ type: oneOfStrings([type]), ...props }, ['type', ...required]);

export const CLAIM_SCHEMA: Schema = {
  description: 'One factual claim the text makes, so it can be checked.',
  anyOf: [
    claimOf('landmark', { landmarkId: id(), status: oneOfStrings(LANDMARK_STATUSES) }, ['landmarkId', 'status']),
    claimOf(
      'count',
      { what: oneOfStrings(['destroyed', 'trees', 'waterfalls', 'collisions']), category: oneOfStrings(STRUCTURE_CATEGORIES), value: COUNT },
      ['what', 'value'],
    ),
    claimOf('outcome', { value: oneOfStrings(['complete', 'failed']) }, ['value']),
    claimOf('growth', { peakMass: TONNES }, ['peakMass']),
    claimOf('fragment', { fragmentId: id() }, ['fragmentId']),
    claimOf('fact', { factId: id() }, ['factId']),
    claimOf('history', { chapterId: oneOfStrings(CHAPTER_IDS), landmarkId: id(), status: oneOfStrings(LANDMARK_STATUSES) }, [
      'chapterId',
      'landmarkId',
      'status',
    ]),
  ],
};

export const DRAFT_SCHEMA = obj(
  {
    title: str({ minLength: 1, maxLength: TITLE_MAX_CHARS }),
    text: str({ minLength: 1, maxLength: 2400 }),
    fragmentIds: arr(id(), MAX_FRAGMENT_IDS),
    factIds: arr(id(), MAX_FACT_IDS),
    claims: arr(CLAIM_SCHEMA, MAX_CLAIMS),
  },
  ['title', 'text', 'fragmentIds', 'factIds', 'claims'],
);

export const REVIEW_SCHEMA = obj(
  {
    verdict: oneOfStrings(['approve', 'revise']),
    issues: arr(str({ minLength: 1, maxLength: 300 }), 10),
  },
  ['verdict', 'issues'],
);

// -------------------------------------------------------------------------------------------------
// Semantic checks of untrusted request data against the story
// -------------------------------------------------------------------------------------------------

export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

/** The evidence must be a run of this chapter, mentioning only this chapter's landmarks. */
export function evidenceProblems(e: RunEvidence, chapter: ChapterDef): string[] {
  const errors: string[] = [];
  if (e.chapterId !== chapter.id) errors.push(`evidence.chapterId is ${e.chapterId}, expected ${chapter.id}`);
  if (e.levelId !== chapter.levelId) errors.push(`evidence.levelId does not match ${chapter.id}`);
  const known = new Set(chapter.landmarks.map((l) => l.id));
  const seen = new Set<string>();
  for (const l of e.landmarks) {
    if (!known.has(l.id)) errors.push(`evidence.landmarks: "${l.id}" is not a landmark of ${chapter.id}`);
    if (seen.has(l.id)) errors.push(`evidence.landmarks: "${l.id}" is listed twice`);
    seen.add(l.id);
  }
  for (const n of e.notable) {
    if (n.landmarkId !== undefined && !known.has(n.landmarkId)) errors.push(`evidence.notable: unknown landmark "${n.landmarkId}"`);
  }
  for (let i = 1; i < e.notable.length; i++) {
    if (e.notable[i].t < e.notable[i - 1].t) {
      errors.push('evidence.notable must be in time order');
      break;
    }
  }
  return errors.slice(0, 8);
}

/** History must be earlier chapters, oldest first, each naming only its own landmarks and fragments. */
export function historyProblems(history: readonly HistoryItem[], before: ChapterId, story: StoryData): string[] {
  const errors: string[] = [];
  let last = -1;
  for (const h of history) {
    const order = chapterOrder(h.chapterId);
    if (order >= chapterOrder(before)) errors.push(`history: ${h.chapterId} is not earlier than ${before}`);
    if (order <= last) errors.push('history must be oldest first with one item per chapter');
    last = Math.max(last, order);
    const ch = story.chapters.find((c) => c.id === h.chapterId);
    if (!ch) {
      errors.push(`history: unknown chapter ${h.chapterId}`);
      continue;
    }
    const lms = new Set(ch.landmarks.map((l) => l.id));
    for (const l of h.landmarks) if (!lms.has(l.id)) errors.push(`history ${h.chapterId}: "${l.id}" is not one of its landmarks`);
    const frags = new Set(ch.fragments.filter((f) => !f.untrusted).map((f) => f.id));
    for (const f of h.fragmentIds) if (!frags.has(f)) errors.push(`history ${h.chapterId}: fragment "${f}" is not one of its fragments`);
  }
  return errors.slice(0, 8);
}

function parseWith<T>(schema: Schema, body: unknown, what: string): Checked<T> {
  const errors = validate(schema, body, what);
  return errors.length ? { ok: false, errors } : { ok: true, value: body as T };
}

export interface CheckedRequest {
  readonly chapter: ChapterDef;
  readonly evidence: RunEvidence;
  readonly history: readonly HistoryItem[];
  /** The model the request asked for (id-shaped; checked against the allowlist by the handler). */
  readonly model?: string;
}

const checked = (chapter: ChapterDef, v: ReflectRequest | EpilogueRequest): CheckedRequest => ({
  chapter,
  evidence: v.evidence,
  history: v.history,
  ...(v.model === undefined ? {} : { model: v.model }),
});

export function checkReflectRequest(body: unknown, story: StoryData): Checked<CheckedRequest> {
  const p = parseWith<ReflectRequest>(REFLECT_REQUEST_SCHEMA, body, 'body');
  if (!p.ok) return p;
  const chapter = story.chapters.find((c) => c.id === p.value.chapterId);
  if (!chapter) return { ok: false, errors: [`unknown chapter ${p.value.chapterId}`] };
  const errors = [...evidenceProblems(p.value.evidence, chapter), ...historyProblems(p.value.history, chapter.id, story)];
  return errors.length ? { ok: false, errors } : { ok: true, value: checked(chapter, p.value) };
}

/** The epilogue follows the last chapter's run. */
export function checkEpilogueRequest(body: unknown, story: StoryData): Checked<CheckedRequest> {
  const p = parseWith<EpilogueRequest>(EPILOGUE_REQUEST_SCHEMA, body, 'body');
  if (!p.ok) return p;
  const last = CHAPTER_IDS[CHAPTER_IDS.length - 1];
  if (p.value.evidence.chapterId !== last) return { ok: false, errors: [`the epilogue needs the ${last} run`] };
  const chapter = story.chapters.find((c) => c.id === last);
  if (!chapter) return { ok: false, errors: [`unknown chapter ${last}`] };
  const errors = [...evidenceProblems(p.value.evidence, chapter), ...historyProblems(p.value.history, chapter.id, story)];
  return errors.length ? { ok: false, errors } : { ok: true, value: checked(chapter, p.value) };
}
