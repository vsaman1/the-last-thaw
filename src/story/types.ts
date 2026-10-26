/**
 * THE LAST THAW — shared contracts for Story Mode (src/story), the Archive, the gameplay evidence the
 * browser sends to the agent service, and the agent service's API (src/server). Pure types: imported by
 * the browser (story UI, authored fallbacks), the server (agent tools, validation) and tests alike.
 *
 * Ground rules every module follows (see docs/STORY_MODE.md):
 * - Story Mode reuses the nine levels and their physics unchanged. A chapter only ADDS placements
 *   (StoryOverlay) and narrative; it never edits a level's terrain, line or existing obstacles.
 * - Gameplay claims come from RunEvidence, which is computed from the session's real events and
 *   physics bodies. Nothing narrative may assert an event the evidence does not contain.
 * - Fiction (the story bible, archive fragments) and fact (ClimateFact, with a citation) are kept in
 *   separate data and shown in separate UI. Collisions with structures never imply casualties.
 */

import type { FailReason, ObstacleKind, ObstaclePlacement, TerrainFeature } from '../core/types';

// -------------------------------------------------------------------------------------------------
// Chapters
// -------------------------------------------------------------------------------------------------

/** One chapter per level, in level order. */
export type ChapterId =
  | 'ch1-beginning'
  | 'ch2-measurements'
  | 'ch3-warning'
  | 'ch4-people'
  | 'ch5-denial'
  | 'ch6-price'
  | 'ch7-escape'
  | 'ch8-remains'
  | 'ch9-last-thaw';

export const CHAPTER_IDS: readonly ChapterId[] = [
  'ch1-beginning',
  'ch2-measurements',
  'ch3-warning',
  'ch4-people',
  'ch5-denial',
  'ch6-price',
  'ch7-escape',
  'ch8-remains',
  'ch9-last-thaw',
];

export type Act = 1 | 2 | 3;

/** Background music mood per chapter (src/audio): bright and moving early, sparse piano late. */
export type MusicCue = 'wonder' | 'unease' | 'cost' | 'reckoning' | 'remains' | 'thaw';

/**
 * Kinds of archive material. Short by design: during play nothing is shown but an optional caption;
 * documents appear before a level, after it, or in the Archive.
 */
export type DocumentKind =
  | 'letter'
  | 'notice'
  | 'report'
  | 'newspaper'
  | 'memory'
  | 'record'
  | 'caption'
  | 'reflection';

export interface ArchiveDocument {
  /** Stable id, unique across the whole story (e.g. 'ch4-vey-kitchen-letter'). */
  readonly id: string;
  readonly kind: DocumentKind;
  readonly title: string;
  /** In-world date as written on the document (fiction), e.g. 'March 2031'. */
  readonly date?: string;
  /** Who wrote or recorded it: a StoryBible character id or an institution named in the bible. */
  readonly author?: string;
  /** The text. Keep it short: 40–140 words for documents, 1–2 lines for captions. */
  readonly body: string;
  /** Character ids mentioned (must exist in the bible). */
  readonly characters?: readonly string[];
}

/** Outcome of one landmark in a run (see RunEvidence.landmarks). */
export type LandmarkStatus = 'destroyed' | 'damaged' | 'intact' | 'notReached';

/**
 * When an archive fragment applies. Evaluated deterministically against RunEvidence (and, where
 * stated, the story history) by src/story/select.ts.
 */
export type FragmentCondition =
  | { readonly always: true }
  | { readonly landmark: string; readonly status: LandmarkStatus | readonly LandmarkStatus[] }
  | { readonly outcome: 'complete' | 'failed' }
  /**
   * At least `min` placements of these categories destroyed (all categories when omitted, felled trees
   * included: the authored story always names its categories, see BUILT_CATEGORIES).
   */
  | { readonly destroyedAtLeast: number; readonly categories?: readonly StructureCategory[] }
  /** At most `max` placements of these categories destroyed. */
  | { readonly destroyedAtMost: number; readonly categories?: readonly StructureCategory[] }
  | { readonly waterfallsAtLeast: number }
  | { readonly grewAtLeast: number } // peakMass / startMass
  /** A landmark from an EARLIER chapter had this status in the saved archive. */
  | { readonly history: { readonly landmark: string; readonly status: LandmarkStatus | readonly LandmarkStatus[] } }
  | { readonly all: readonly FragmentCondition[] }
  | { readonly any: readonly FragmentCondition[] }
  | { readonly not: FragmentCondition };

export interface ArchiveFragment extends ArchiveDocument {
  readonly chapterId: ChapterId;
  readonly when: FragmentCondition;
  /** Higher shows first; ties keep authored order. */
  readonly priority: number;
  /**
   * TEST DATA ONLY: an untrusted entry (e.g. the prompt-injection fixture). Never shown in the game and
   * always passed to agents as quoted data, never as instructions.
   */
  readonly untrusted?: boolean;
}

/**
 * Broad groups for scoring, conditions and narrative. Every ObstacleKind maps to exactly one category
 * (src/story/scoring.ts STRUCTURE_CATEGORY).
 */
export type StructureCategory =
  | 'home' // house, chalet, apartmentBlock
  | 'community' // church, monument, waterTower, lighthouse, school-like halls
  | 'transport' // roads' bridges, footbridges, rail wagons, vehicles, guardrails
  | 'water' // dams
  | 'energy' // power plant parts, pylons, wind turbines
  | 'extraction' // pumpjack, oilRig, pipeline, tank
  | 'industry' // factory halls, silos, log piles
  | 'farm' // barns, fences
  | 'nature' // trees, rocks, ice
  | 'other';

/**
 * Every category of structure people built (all but 'nature'). Felled trees score and count as
 * destroyed placements, but the archive never counts them as losses: a condition that licenses
 * wording about how much a run broke counts these categories (or a narrower list), never 'nature'.
 */
export const BUILT_CATEGORIES: readonly StructureCategory[] = [
  'home',
  'community',
  'transport',
  'water',
  'energy',
  'extraction',
  'industry',
  'farm',
  'other',
];

/**
 * A named structure the story refers to. Binds a story name to one obstacle placement, or to a few
 * placements that are one thing in the story (a co-op's three turbines, a tank farm's tanks).
 */
export interface LandmarkDef {
  /** Stable id used by conditions, evidence and the agents (e.g. 'vey-house'). */
  readonly id: string;
  /** Display name (fiction), e.g. 'The Vey house on Mill Lane'. */
  readonly name: string;
  readonly category: StructureCategory;
  /**
   * 'base' = an index into the level's own obstacles; 'overlay' = into the chapter's overlay. `index`
   * is the placement the story points at (the label, the autopilot's aim); `also` lists the other
   * placements of the same source that belong to it. A landmark of several placements reads like one
   * structure of several bodies (a dam of monoliths): 'destroyed' if any of them broke, 'damaged' if
   * none broke but one was knocked, 'intact' only if the run reached every one and all stood.
   */
  readonly bind: { readonly source: 'base' | 'overlay'; readonly index: number; readonly also?: readonly number[] };
  /** Bible ids (characters, locations, decisions) this landmark relates to. */
  readonly bibleRefs: readonly string[];
  /** Optional short label shown near the structure in Story Mode (environmental storytelling). */
  readonly label?: string;
}

/** Extra human structures a chapter adds to its level (never removes or moves anything). */
export interface StoryOverlay {
  readonly obstacles: readonly ObstaclePlacement[];
  /** Roads/streets/parking so added buildings and vehicles satisfy the world-logic rules. */
  readonly features?: readonly TerrainFeature[];
}

export interface TutorialCard {
  readonly title: string;
  readonly body: string;
}

export interface ChapterDef {
  readonly id: ChapterId;
  /** 1..9, equal to the level's index. */
  readonly index: number;
  /** LevelDef.id of the level this chapter plays (src/core/levels). */
  readonly levelId: string;
  readonly act: Act;
  readonly actTitle: string; // 'The Wonder' | 'The Cost' | 'The Reckoning'
  readonly title: string; // e.g. 'The Beginning'
  /** Shown on the chapter card before the level: 1–4 short lines, then an optional document. */
  readonly intro: { readonly lines: readonly string[]; readonly document?: ArchiveDocument };
  /** Chapter 1 explains Topple points here, light-heartedly (the hook the story later turns around). */
  readonly tutorial?: readonly TutorialCard[];
  /** At most one short caption, shown at the start of play and fading within seconds. */
  readonly caption?: string;
  readonly landmarks: readonly LandmarkDef[];
  readonly overlay: StoryOverlay;
  readonly fragments: readonly ArchiveFragment[];
  /** Authored reflections used when the AI is off or fails (chosen by condition, best first). */
  readonly fallbackReflections: readonly ArchiveFragment[];
  /** True for the chapters that ask the agents for a reflection by default (1, 4, 6, 9). */
  readonly aiReflection: boolean;
  readonly music: MusicCue;
}

// -------------------------------------------------------------------------------------------------
// Story bible (authored; agents may retell it, never rewrite it)
// -------------------------------------------------------------------------------------------------

export interface Character {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly born?: number;
  /** Appearance and manner (how the archive describes them). */
  readonly description: string;
  readonly history: string;
  readonly locations: readonly string[];
  /** Chapter where the player can first learn of them (agents must not mention them earlier). */
  readonly firstAppears: ChapterId;
  /** Chapter where the archive reveals who they are, if later than firstAppears. */
  readonly revealedIn?: ChapterId;
}

export interface TimelineEvent {
  readonly id: string;
  readonly year: number;
  readonly summary: string;
  readonly characters?: readonly string[];
  readonly locations?: readonly string[];
}

export interface StoryLocation {
  readonly id: string;
  readonly name: string;
  readonly chapterId: ChapterId;
  readonly description: string;
  readonly landmarkIds: readonly string[];
}

export interface HistoricalDecision {
  readonly id: string;
  readonly year: number;
  /** Who decided (character id or institution). */
  readonly who: string;
  readonly decision: string;
  readonly consequence: string;
  /** Where responsibility sat; the story never treats all actors as equally responsible. */
  readonly responsibility: 'household' | 'local' | 'regional' | 'national' | 'industry' | 'global';
}

export interface Relationship {
  readonly a: string;
  readonly b: string;
  readonly kind: string;
}

export interface Revelation {
  readonly id: string;
  readonly chapterId: ChapterId;
  readonly text: string;
}

export interface StoryBible {
  readonly title: string;
  readonly premise: string;
  readonly theme: string; // "You cannot undo the river behind you. You can still decide where it goes next."
  readonly characters: readonly Character[];
  readonly timeline: readonly TimelineEvent[];
  readonly locations: readonly StoryLocation[];
  readonly decisions: readonly HistoricalDecision[];
  readonly relationships: readonly Relationship[];
  readonly revelations: readonly Revelation[];
  /** Facts that must stay consistent in every retelling. */
  readonly invariants: readonly string[];
  /** Details that may change with the player's actions (and how). */
  readonly variables: readonly string[];
  /** Voice and things the writing never does. */
  readonly style: { readonly voice: string; readonly avoid: readonly string[] };
}

// -------------------------------------------------------------------------------------------------
// Science (real, cited; kept apart from the fiction)
// -------------------------------------------------------------------------------------------------

export type SourceOrg = 'NASA' | 'NOAA' | 'IPCC' | 'WMO' | 'EPA' | 'USGS';

export interface ClimateFact {
  readonly id: string;
  /** Approved wording. Agents quote or closely paraphrase this; nothing beyond it. */
  readonly statement: string;
  readonly source: {
    readonly org: SourceOrg;
    readonly title: string;
    readonly url: string;
    /** ISO date the page was checked. */
    readonly accessed: string;
  };
  readonly themes: readonly string[];
  /** Numbers (as written) the statement contains; the validator allows only these in generated text. */
  readonly numbers: readonly string[];
}

/** Where the game is metaphor, not simulation (shown in "Science Behind the Story"). */
export interface MetaphorNote {
  readonly id: string;
  readonly gameElement: string;
  readonly explanation: string;
}

// -------------------------------------------------------------------------------------------------
// Run evidence (computed in the browser from the real session; validated again on the server)
// -------------------------------------------------------------------------------------------------

export interface LandmarkOutcome {
  readonly id: string;
  readonly status: LandmarkStatus;
  /** Closest horizontal approach of the iceberg's route to the structure (m). */
  readonly closest: number;
}

export type NotableEventType =
  | 'broke' // a structure placement broke (its first body)
  | 'felled' // a tree went down
  | 'waterfall'
  | 'absorbed'
  | 'chipped'
  | 'landed' // a big drop
  | 'enteredOcean'
  | 'damBreached';

export interface NotableEvent {
  /** Seconds of play. */
  readonly t: number;
  readonly type: NotableEventType;
  readonly kind?: ObstacleKind;
  readonly category?: StructureCategory;
  readonly landmarkId?: string;
  /** Course position. */
  readonly s: number;
  readonly d: number;
  /** Type-specific magnitude (drop m, absorbed t, chip share…). */
  readonly value?: number;
}

/**
 * Everything the narrative may say about one run, compact enough for an LLM request (a few KB).
 * Built by src/story/evidence.ts from GameSession events, route and physics bodies.
 */
export interface RunEvidence {
  readonly version: 1;
  readonly chapterId: ChapterId;
  readonly levelId: string;
  readonly outcome: 'complete' | 'failed';
  readonly failReason?: FailReason;
  /** Seconds of play, metres travelled, m/s. */
  readonly time: number;
  readonly distance: number;
  readonly topSpeed: number;
  /** Tonnes. */
  readonly startMass: number;
  readonly endMass: number;
  readonly peakMass: number;
  readonly absorbed: number;
  /** Ice left (1 = as spawned). */
  readonly iceLeft: number;
  readonly waterfallsCrossed: number;
  readonly collisions: number;
  readonly treesFelled: number;
  readonly knockedDown: number;
  readonly buildingsDestroyed: number;
  /** Story Mode Topple points (src/story/scoring.ts). */
  readonly storyPoints: number;
  /** Placements broken, by category (counts). */
  readonly destroyedByCategory: Readonly<Partial<Record<StructureCategory, number>>>;
  /** Placements broken, by kind (counts). */
  readonly destroyedByKind: Readonly<Partial<Record<ObstacleKind, number>>>;
  /** Every landmark of the chapter with its outcome. */
  readonly landmarks: readonly LandmarkOutcome[];
  /** Up to 30 notable events in time order. */
  readonly notable: readonly NotableEvent[];
  /** The route, downsampled to at most 40 course points. */
  readonly route: readonly { readonly s: number; readonly d: number }[];
  /** Furthest course position reached (m) and the level's coast position. */
  readonly reachedS: number;
  readonly coastS: number;
}

// -------------------------------------------------------------------------------------------------
// The Archive (persisted in the browser)
// -------------------------------------------------------------------------------------------------

export interface StoredReflection {
  readonly source: 'ai' | 'authored';
  readonly title?: string;
  readonly text: string;
  /** Fragment ids the reflection drew on. */
  readonly fragmentIds: readonly string[];
  /** ClimateFact ids cited (AI reflections only). */
  readonly factIds: readonly string[];
  /** AI only: the Historian's verdict and the deterministic validation result. */
  readonly review?: { readonly verdict: 'approved' | 'corrected'; readonly rounds: number };
  readonly validated?: boolean;
  readonly traceId?: string;
}

export interface ArchiveEntry {
  readonly chapterId: ChapterId;
  /** ISO timestamp of the completion this entry records. */
  readonly completedAt: string;
  /** Attempts it took (failed tries count). */
  readonly attempts: number;
  readonly evidence: RunEvidence;
  /** Fragments revealed by this run (ids, in display order). */
  readonly fragmentIds: readonly string[];
  readonly reflection: StoredReflection;
}

export type AiPreference = 'selected' | 'all' | 'off';

/**
 * The models the player may choose for the agents. The course rule: gpt-6-luna only on the course key
 * (PORTKEY_API_KEY); any other model only on the player's own key, paid by them. The server maps each
 * one to exactly one provider (MODEL_PROVIDERS in src/server/config.ts) and never switches between them.
 */
export const STORY_MODELS = ['gpt-6-luna', 'gpt-6-sol'] as const;
export type StoryModelId = (typeof STORY_MODELS)[number];
/** The default, on the course key. */
export const DEFAULT_STORY_MODEL: StoryModelId = 'gpt-6-luna';
export const isStoryModel = (v: unknown): v is StoryModelId => (STORY_MODELS as readonly unknown[]).includes(v);

/** 'course': Portkey with PORTKEY_API_KEY (gpt-6-luna only). 'own-key': OpenAI directly with OPENAI_API_KEY. */
export type ModelProvider = 'course' | 'own-key';

export interface StoryProgress {
  readonly version: 1;
  /** Completed chapters (the next one unlocks). */
  readonly completed: readonly ChapterId[];
  /** Latest completion per chapter (replays replace the entry). */
  readonly archive: readonly ArchiveEntry[];
  readonly epilogue: StoredReflection | null;
  readonly settings: {
    /** Chapter cards and post-level revelations (off = gameplay only, still recorded). */
    readonly narrative: boolean;
    /** Which chapters ask the agents (default 'selected' = chapters with aiReflection). */
    readonly ai: AiPreference;
    /** Which model the agents run on (default gpt-6-luna, the course key); sent with every request. */
    readonly model: StoryModelId;
  };
}

/** Compact per-chapter memory sent to the agents for later chapters and the epilogue. */
export interface HistoryItem {
  readonly chapterId: ChapterId;
  readonly outcome: 'complete' | 'failed';
  readonly storyPoints: number;
  readonly destroyedByCategory: RunEvidence['destroyedByCategory'];
  /**
   * Placements broken, by kind: the world's condition (src/story/environment.ts) weighs the extraction,
   * industry and energy toppled in earlier chapters by kind, so the agents see the world the player sees.
   * Optional: a history from an older client lacks it, and then adds nothing to the world.
   */
  readonly destroyedByKind?: RunEvidence['destroyedByKind'];
  readonly landmarks: readonly LandmarkOutcome[];
  readonly fragmentIds: readonly string[];
  /** First ~240 characters of the stored reflection. */
  readonly reflectionExcerpt: string;
}

// -------------------------------------------------------------------------------------------------
// Agent service API (src/server; mounted on the Vite dev/preview server under /api/story)
// -------------------------------------------------------------------------------------------------

/**
 * A factual claim the Archivist makes about the run or the record. The deterministic validator checks
 * every claim against RunEvidence, the bible, the fragments and the approved facts before display.
 */
export type NarrativeClaim =
  | { readonly type: 'landmark'; readonly landmarkId: string; readonly status: LandmarkStatus }
  /** 'destroyed' with no category counts built structures (BUILT_CATEGORIES); felled trees are 'trees'. */
  | { readonly type: 'count'; readonly what: 'destroyed' | 'trees' | 'waterfalls' | 'collisions'; readonly category?: StructureCategory; readonly value: number }
  | { readonly type: 'outcome'; readonly value: 'complete' | 'failed' }
  | { readonly type: 'growth'; readonly peakMass: number }
  | { readonly type: 'fragment'; readonly fragmentId: string }
  | { readonly type: 'fact'; readonly factId: string }
  | { readonly type: 'history'; readonly chapterId: ChapterId; readonly landmarkId: string; readonly status: LandmarkStatus };

export interface ReflectRequest {
  readonly chapterId: ChapterId;
  readonly evidence: RunEvidence;
  /** Earlier chapters, oldest first. */
  readonly history: readonly HistoryItem[];
  /** The player's chosen model (the browser client always sends it; absent = the server's default). */
  readonly model?: StoryModelId;
}

export interface EpilogueRequest {
  readonly evidence: RunEvidence; // the chapter 9 run
  readonly history: readonly HistoryItem[]; // chapters 1–8
  readonly model?: StoryModelId;
}

export interface ToolCallRecord {
  readonly agent: AgentName;
  readonly tool: string;
  /** Arguments as the model sent them (after validation), truncated for logs. */
  readonly args: unknown;
  readonly ok: boolean;
  /** Error text for rejected calls (unknown tool, bad arguments, budget). */
  readonly error?: string;
  readonly ms: number;
}

export type AgentName = 'archivist' | 'historian';

export interface UsageRecord {
  readonly ts: string;
  readonly runId: string;
  readonly agent: AgentName;
  readonly model: string;
  /** Which key paid for it (records before gpt-6-sol was added lack it: they are all 'course'). */
  readonly provider?: ModelProvider;
  /** From the API response's usage object; never estimated. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  /** Input tokens written to the prompt cache (input_tokens_details.cache_write_tokens), priced at their own rate. */
  readonly cacheWriteTokens?: number;
  readonly outputTokens: number;
  readonly reasoningTokens?: number;
  readonly requests: number;
  /**
   * Requests sent whose usage is unknown: they timed out or were cancelled after leaving, or the reply
   * was unreadable or carried no usage object. The provider may have billed them; their tokens are not
   * in the counts above (and never estimated), so the counts are a lower bound when this is above 0.
   */
  readonly unmeteredRequests?: number;
  readonly toolCalls: number;
  readonly durationMs: number;
  /** USD at the verified price table (src/server/pricing.ts), or null when no price is known. */
  readonly costUsd: number | null;
  readonly ok: boolean;
}

export interface HistorianReview {
  readonly verdict: 'approve' | 'revise';
  /** Specific problems, each pointing at a sentence or claim. */
  readonly issues: readonly string[];
}

export interface AgentTraceStep {
  readonly agent: AgentName;
  readonly kind: 'request' | 'tool' | 'draft' | 'review' | 'validation' | 'final' | 'error';
  readonly at: number; // ms since run start
  readonly summary: string;
  readonly data?: unknown;
}

export interface NarrativeResult {
  readonly ok: true;
  readonly source: 'ai';
  readonly runId: string;
  readonly title?: string;
  readonly text: string;
  readonly fragmentIds: readonly string[];
  readonly factIds: readonly string[];
  readonly claims: readonly NarrativeClaim[];
  readonly review: { readonly verdict: 'approved' | 'corrected'; readonly rounds: number; readonly issues: readonly string[] };
  readonly validation: { readonly passed: true; readonly checked: number };
  readonly toolCalls: readonly ToolCallRecord[];
  readonly usage: readonly UsageRecord[];
}

export interface NarrativeFailure {
  readonly ok: false;
  readonly runId: string;
  /** 'unavailable' (no key / disabled), 'budget', 'rejected' (failed validation), 'error'. */
  readonly reason: 'unavailable' | 'budget' | 'rejected' | 'error';
  readonly message: string;
  /** The client shows authored material instead. */
  readonly fallback: true;
  readonly usage: readonly UsageRecord[];
}

export type NarrativeResponse = NarrativeResult | NarrativeFailure;

export interface StatusResponse {
  /** Whether the default model (`model`) can run now. */
  readonly aiAvailable: boolean;
  /** The server's default model (used for a request that names none). */
  readonly model: string;
  /** Why not, when unavailable (e.g. 'PORTKEY_API_KEY not set'). Never contains the key. */
  readonly reason?: string;
  /** Every model the server offers, each with its provider and whether it can run now. */
  readonly models: readonly ModelStatus[];
}

export interface ModelStatus {
  readonly id: string;
  readonly provider: ModelProvider;
  /** The only thing the browser learns about a key: whether its model can run. */
  readonly available: boolean;
  /** Why not, when unavailable (no key, disabled, today's spending limit reached). Never a value. */
  readonly reason?: string;
}
