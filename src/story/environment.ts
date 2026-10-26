/**
 * STORY MODE: the condition of the world each chapter is played in (Arcade never reads this).
 *
 * The valleys age with the story. Act I (chapters 1-3) is the world as it was: green, clear water,
 * clean air. Act II (4-6) shows the first signs: grass yellowing in places, a light haze, slightly
 * murkier water. Act III (7-9) is clearly worn: brown grass, dead and bare trees among the living,
 * a brownish river and thicker haze. On top of the chapter's place on that arc, the world answers the
 * player's own record: the more extraction, industry and energy structures the Archive says they
 * toppled in EARLIER chapters (by the harm weights of ./scoring.ts), the further it goes, within
 * limits (TOLL_BOOST).
 *
 * This is a look, nothing else: the renderer (src/render/worldCondition.ts) turns it into colours,
 * fog and material tints. Terrain heights, obstacles, physics and scoring never see it.
 *
 * Everything here is pure and deterministic, so the same chapter and Archive always give the same
 * world, in the browser and in tests.
 */
import { categoryOf, storyPointsFor } from './scoring';
import { CHAPTER_IDS, type Act, type ArchiveEntry, type ChapterId, type StructureCategory } from './types';

export interface WorldCondition {
  readonly chapterId: ChapterId;
  readonly act: Act;
  /** The chapter's own place on the story's arc, before the player's record (0 healthy .. 1). */
  readonly arc: number;
  /** Harm-weighted points of the extraction, industry and energy toppled in earlier chapters. */
  readonly tollPoints: number;
  /** That record as 0..1 (saturating: TOLL_SCALE points is about two thirds of the way). */
  readonly toll: number;
  /** How worn the world looks overall: arc + TOLL_BOOST[act] × toll, at most 1. */
  readonly severity: number;
  readonly grass: {
    /** How far grass dries where it does (0 green .. 1 fully dry). */
    readonly dry: number;
    /** How much of the ground dries (0 none .. 1 all of it), in large patches. */
    readonly cover: number;
    /** Dry grass from straw yellow (0) to dead brown (1). */
    readonly brown: number;
  };
  readonly trees: {
    /** Share of trees standing dead, brown or bare grey (0 .. MAX_DEAD_TREES). */
    readonly dead: number;
    /** How far living foliage yellows (0 .. 0.6). */
    readonly fade: number;
  };
  /** Rivers, streams and lakes from clear blue (0) to brown and murky (1); the sea takes half. */
  readonly water: { readonly murk: number };
  /** Haze: the fog closes in and turns grey-brown, the sky and the sun dull (0 clear .. 1). */
  readonly air: { readonly haze: number };
  /** Snow dulled grey by soot (0 clean .. 0.6). */
  readonly snow: { readonly soot: number };
}

/** The chapter's place on the arc, in chapter order: healthy in Act I, worn by Act III. */
export const WORLD_ARC: Readonly<Record<ChapterId, number>> = {
  'ch1-beginning': 0,
  'ch2-measurements': 0,
  'ch3-warning': 0,
  'ch4-people': 0.3,
  'ch5-denial': 0.36,
  'ch6-price': 0.42,
  'ch7-escape': 0.62,
  'ch8-remains': 0.72,
  'ch9-last-thaw': 0.8,
};

/** The most the player's record can add to a chapter's arc, by act (Act I stays all but healthy). */
export const TOLL_BOOST: Readonly<Record<Act, number>> = { 1: 0.1, 2: 0.18, 3: 0.2 };

/** Toll points at which the record counts 1 − 1/e (≈ 0.63): a heavy Power Valley is about 1.5 of these. */
export const TOLL_SCALE = 6000;

/** The categories whose toppling the world remembers as pollution. */
export const TOLL_CATEGORIES: readonly StructureCategory[] = ['extraction', 'industry', 'energy'];

/**
 * Kinds of those categories the toll leaves out: a woodpile is firewood, not a works (playtest 2
 * review: one log pile on the Red Canyon line named "the Red Canyon" as a source of chapter 6's haze).
 */
export const TOLL_EXCLUDED_KINDS: readonly string[] = ['logPile'];

export const MAX_DEAD_TREES = 0.45;

/** Colours the renderer blends toward (sRGB hex); every one is a muted, natural tone. */
export const WORLD_PALETTE = {
  /** Dry grass: pale straw, then dead brown. */
  straw: '#B9A777',
  brownGrass: '#7C6040',
  /** Dead conifer needles (rust brown) and long-dead bare wood (grey). */
  deadRust: '#7A5236',
  deadGrey: '#7E776D',
  /** Haze: fog, horizon and zenith it pulls toward; the sun it warms toward. */
  smog: '#B7B09E',
  smogHorizon: '#CFC8B4',
  smogTop: '#8A98A6',
  hazeSun: '#FFD7A0',
  hazeCloud: '#BDB8AE',
  hazeCloudGlow: '#8E8A84',
  /** Light: sky fill and the bounce from dry ground. */
  hazeSkyFill: '#C9C3B4',
  dryBounce: '#7A6A48',
  hazeAmbient: '#E8E0D0',
  /** Murky water (river and streams). */
  murkDeep: '#4A3B1E',
  murkMid: '#7A6438',
  murkLight: '#A89660',
  murkPlume: '#806C44',
  murkFoam: '#E8E0C4',
  murkFoamShade: '#BDB08C',
  /** Murky sea near the coast. */
  seaDeep: '#24343A',
  seaMid: '#46584E',
  seaShallow: '#7E8458',
  /** Snow multiplied toward this by its soot. */
  soot: '#B8B2A8',
} as const;

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** The act a chapter belongs to (three chapters each, in order). */
export function actOf(chapterId: ChapterId): Act {
  const i = CHAPTER_IDS.indexOf(chapterId);
  return i < 3 ? 1 : i < 6 ? 2 : 3;
}

/**
 * One earlier chapter as the toll reads it: an Archive entry's evidence, or the compact history item
 * the agents receive (src/story/types.ts HistoryItem), which carries the same counts by kind.
 */
export interface TollRecord {
  readonly chapterId: ChapterId;
  readonly destroyedByKind?: Readonly<Partial<Record<string, number>>>;
}

/** Harm-weighted points of the extraction, industry and energy one record toppled. */
export function tollPointsOf(record: TollRecord): number {
  let points = 0;
  for (const [kind, n] of Object.entries(record.destroyedByKind ?? {})) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || TOLL_EXCLUDED_KINDS.includes(kind)) continue;
    if (TOLL_CATEGORIES.includes(categoryOf(kind))) points += n * storyPointsFor(kind);
  }
  return points;
}

/** The toll of the records before `chapterId` (later chapters and the chapter itself never count). */
export function tollBefore(chapterId: ChapterId, records: readonly TollRecord[]): number {
  const before = CHAPTER_IDS.indexOf(chapterId);
  let points = 0;
  for (const r of records) if (CHAPTER_IDS.indexOf(r.chapterId) < before) points += tollPointsOf(r);
  return points;
}

/**
 * The player's record before `chapterId`: harm-weighted story points of every extraction, industry
 * and energy structure the Archive says they toppled in an earlier chapter (each chapter's latest
 * run, as the Archive keeps it). Later chapters and the chapter itself never count, so replaying a
 * chapter cannot change its own world.
 */
export function industrialToll(chapterId: ChapterId, archive: readonly ArchiveEntry[]): number {
  return tollBefore(
    chapterId,
    archive.map((e) => ({ chapterId: e.chapterId, destroyedByKind: e.evidence.destroyedByKind })),
  );
}

/** The world a chapter is played in, given the Archive so far. */
export function worldCondition(chapterId: ChapterId, archive: readonly ArchiveEntry[] = []): WorldCondition {
  return conditionFromToll(chapterId, industrialToll(chapterId, archive));
}

/**
 * The same world from the compact history the agents receive (the browser builds that history from
 * the same Archive entries, counts by kind included, so both sides see one world). A history item
 * without counts by kind (an older client) adds nothing.
 */
export function worldConditionFromHistory(chapterId: ChapterId, history: readonly TollRecord[]): WorldCondition {
  return conditionFromToll(chapterId, tollBefore(chapterId, history));
}

function conditionFromToll(chapterId: ChapterId, tollPoints: number): WorldCondition {
  const toll = 1 - Math.exp(-tollPoints / TOLL_SCALE);
  return conditionAt(chapterId, actOf(chapterId), WORLD_ARC[chapterId] ?? 0, tollPoints, toll);
}

/** The channels of a severity (exported for tests and for previewing a level at any point of the arc). */
export function conditionAt(chapterId: ChapterId, act: Act, arc: number, tollPoints: number, toll: number): WorldCondition {
  const s = clamp01(arc + TOLL_BOOST[act] * clamp01(toll));
  return {
    chapterId,
    act,
    arc,
    tollPoints,
    toll,
    severity: s,
    grass: {
      // Quick to show where it does (Act II's patches read as dry), full by Act III.
      dry: clamp01(1.15 * Math.sqrt(s)),
      cover: clamp01((s - 0.12) / 0.55),
      brown: clamp01((s - 0.42) / 0.5),
    },
    trees: {
      dead: MAX_DEAD_TREES * clamp01((s - 0.45) / 0.55),
      fade: 0.6 * clamp01((s - 0.12) / 0.88),
    },
    // Slow through Act II (a little greyer), then quickly brown in Act III.
    water: { murk: smooth(0.1, 0.75, s) },
    air: { haze: clamp01(s / 0.9) },
    snow: { soot: 0.6 * clamp01((s - 0.5) / 0.5) },
  };
}

/** Below this, a channel changes nothing a player could see (a 1 % tint at most). */
const UNSEEN = 0.01;

/** True when the condition changes nothing a player could see (the renderer then patches nothing). */
export function isHealthy(c: WorldCondition): boolean {
  return (
    c.grass.dry * c.grass.cover < UNSEEN &&
    c.trees.dead < UNSEEN &&
    c.trees.fade < UNSEEN &&
    c.water.murk < UNSEEN &&
    c.air.haze < UNSEEN &&
    c.snow.soot < UNSEEN
  );
}

/**
 * Debugging and side-by-side checks through the page URL (?world=…): 'off' plays the chapter in its
 * healthy world; a chapter number 1-9 or id shows that chapter's arc instead (the player's record
 * still applies). Anything else, or no parameter, is the chapter's own world. Returns null for 'off'.
 */
export function resolveWorldCondition(
  chapterId: ChapterId,
  archive: readonly ArchiveEntry[],
  search = '',
): WorldCondition | null {
  const want = new URLSearchParams(search).get('world');
  if (want === 'off') return null;
  const n = want !== null && /^[1-9]$/.test(want) ? CHAPTER_IDS[Number(want) - 1] : undefined;
  const asId = (CHAPTER_IDS as readonly string[]).includes(want ?? '') ? (want as ChapterId) : undefined;
  const look = n ?? asId;
  if (!look) return worldCondition(chapterId, archive);
  const own = worldCondition(chapterId, archive);
  return conditionAt(chapterId, actOf(look), WORLD_ARC[look], own.tollPoints, own.toll);
}
