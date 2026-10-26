/**
 * STORY MODE scoring: TOPPLE POINTS (Arcade's computeScore in src/core/session.ts is untouched).
 *
 * The Last Thaw opens as a light-hearted game: topple structures to earn points, and the big targets
 * are worth the most. That is all the player is told at first (the chapter 1 tutorial and the Points
 * guide in the pause menu and the chapter list). Behind the numbers, the weights follow the harm a
 * structure's failure does to the environment and to people: an offshore rig or a pipeline spills
 * into water and soil; a dam releases a reservoir; an apartment block is many homes at once. A fence
 * or a log pile is almost nothing. The story lets the player discover that later (chapter 6 says it in
 * so many words), so the weights must be honest about harm, not about size, and the early copy must
 * not give it away.
 *
 * Units of destruction: one STRUCTURE PLACEMENT counts once, however many bodies it breaks into or
 * consists of (a dam of several monoliths, a bridge's piers, a church's nave and tower). Bodies the
 * level did not place (auto-placed traffic lights, debris) count once per original body. The same
 * rule feeds the HUD, RunEvidence.storyPoints and the evidence's destroyed counts, so the number the
 * player watched is the number the archive records.
 */
import type { GameEvent, ObstacleKind } from '../core/types';
import type { StructureCategory } from './types';

/**
 * Human structures Story Mode adds that the engine does not have yet. Listed as string keys so this
 * table compiles before they exist; once they join ObstacleKind the union simply collapses.
 */
export type ComingStructureKind = 'apartmentBlock' | 'pumpjack' | 'oilRig' | 'pipeline' | 'monument';

/** Every kind Story Mode scores and categorises. */
export type StoryKind = ObstacleKind | ComingStructureKind;

/** Exactly one category per kind (see StructureCategory in ./types.ts). */
export const STRUCTURE_CATEGORY: Readonly<Record<StoryKind, StructureCategory>> = {
  // homes
  house: 'home',
  chalet: 'home',
  apartmentBlock: 'home',
  // community
  church: 'community',
  monument: 'community',
  waterTower: 'community',
  lighthouse: 'community',
  // transport
  car: 'transport',
  truck: 'transport',
  bus: 'transport',
  guardrail: 'transport',
  footbridge: 'transport',
  roadBridge: 'transport',
  railWagon: 'transport',
  boat: 'transport',
  trafficLight: 'transport',
  skiLiftPylon: 'transport',
  // water
  dam: 'water',
  // energy
  coolingTower: 'energy',
  smokestack: 'energy',
  pylon: 'energy',
  windTurbine: 'energy',
  // extraction
  pumpjack: 'extraction',
  oilRig: 'extraction',
  pipeline: 'extraction',
  tank: 'extraction',
  // industry
  factoryHall: 'industry',
  silo: 'industry',
  logPile: 'industry',
  // farm
  barn: 'farm',
  fence: 'farm',
  // nature
  rockSmall: 'nature',
  rockMedium: 'nature',
  boulder: 'nature',
  rockCluster: 'nature',
  pine: 'nature',
  broadleaf: 'nature',
  iceBlock: 'nature',
  iceField: 'nature',
  // a dry-stone wall: built, but neither a home, a farm building nor infrastructure that fails badly
  stoneBarrier: 'other',
};

/**
 * Story points per destroyed placement, weighted by the harm its failure does to the environment and
 * to people (spills, floods, lost homes), NOT by size or by how hard it is to break. The seven
 * highest are the brief's: oil rig, dam, pipeline, apartment block, cooling tower, pumpjack, tank.
 * Trees, fences and log piles are the lowest that still score. Rocks, glacier ice, parked cars and
 * dry-stone walls never break (they are pushed or absorbed: a car stands 'loose' with no break speed, a
 * wall's stones have an infinite one), so they score nothing and the Points guide leaves them out
 * (scoring.test.ts checks every guide row against the real bodies).
 */
export const STORY_POINTS: Readonly<Record<StoryKind, number>> = {
  // highest: failure poisons water and land, floods a valley, or takes many homes at once
  oilRig: 1000,
  dam: 900,
  pipeline: 800,
  apartmentBlock: 750,
  coolingTower: 700,
  pumpjack: 600,
  tank: 600,
  // industry and the grid
  factoryHall: 450,
  smokestack: 400,
  roadBridge: 350,
  pylon: 250,
  railWagon: 200,
  windTurbine: 150,
  // homes and shared places
  church: 300,
  house: 250,
  waterTower: 250,
  chalet: 200,
  monument: 200,
  lighthouse: 200,
  // vehicles, small infrastructure, farms
  bus: 150,
  silo: 150,
  barn: 120,
  truck: 120,
  boat: 120,
  footbridge: 100,
  skiLiftPylon: 60,
  trafficLight: 30,
  guardrail: 20,
  // lowest
  logPile: 15,
  fence: 10,
  pine: 5,
  broadleaf: 5,
  // never break: pushed, never toppled
  car: 0,
  stoneBarrier: 0,
  rockSmall: 0,
  rockMedium: 0,
  boulder: 0,
  rockCluster: 0,
  iceBlock: 0,
  iceField: 0,
};

const has = (kind: string): kind is StoryKind => Object.prototype.hasOwnProperty.call(STORY_POINTS, kind);

/** Category of any kind name ('other' for a kind this table does not know yet). */
export function categoryOf(kind: string): StructureCategory {
  return has(kind) ? STRUCTURE_CATEGORY[kind] : 'other';
}

/** Story points for one destroyed placement of `kind` (0 for unknown kinds). */
export function storyPointsFor(kind: string): number {
  return has(kind) ? STORY_POINTS[kind] : 0;
}

/** What scoring needs to know about a physics body (src/core/physics/world.ts ObstacleBody). */
export interface ScoredBody {
  readonly id: number;
  readonly originId: number;
  readonly kind: ObstacleKind;
  /** Index into level.obstacles; -1 for runtime spawns and debris. */
  readonly placement: number;
}

/** Bodies by id, as PhysicsWorld.getBody provides them. */
export type BodyLookup = (id: number) => ScoredBody | undefined;

/**
 * The unit a broken or felled body counts as: its level placement ('p12'), or its original body
 * when the level did not place it ('b40'). Pieces of one compound structure share the unit.
 */
export function destructionUnit(body: ScoredBody, lookup: BodyLookup): string {
  const origin = body.originId === body.id ? body : (lookup(body.originId) ?? body);
  return origin.placement >= 0 ? `p${origin.placement}` : `b${origin.id}`;
}

/** A destroyed unit: its key, kind, placement (-1 if none) and the points it scored. */
export interface DestroyedUnit {
  readonly unit: string;
  readonly kind: ObstacleKind;
  readonly placement: number;
  readonly points: number;
  /** Index of the event (in the log it was read from) that first destroyed it. */
  readonly event: number;
}

/**
 * Tallies Story points from a stream of game events, counting each destruction unit once. Feed it
 * events in order (live from session.events.on, or a whole log); read `points` at any time.
 */
export class StoryPointsTracker {
  private readonly seen = new Map<string, DestroyedUnit>();
  private index = 0;
  points = 0;

  constructor(private readonly lookup: BodyLookup) {}

  /** Returns the unit this event destroyed for the first time, or null. */
  add(e: GameEvent): DestroyedUnit | null {
    const i = this.index++;
    if (e.type !== 'obstacleBroken' && e.type !== 'treeFelled') return null;
    const body = this.lookup(e.obstacleId);
    if (!body) return null;
    const unit = destructionUnit(body, this.lookup);
    if (this.seen.has(unit)) return null;
    const origin = body.originId === body.id ? body : (this.lookup(body.originId) ?? body);
    const kind = e.type === 'obstacleBroken' ? e.kind : origin.kind;
    const d: DestroyedUnit = { unit, kind, placement: origin.placement, points: storyPointsFor(kind), event: i };
    this.seen.set(unit, d);
    this.points += d.points;
    return d;
  }

  /** Every unit destroyed so far, in the order they fell. */
  get destroyed(): readonly DestroyedUnit[] {
    return [...this.seen.values()];
  }
}

/** Story points and destroyed units of a whole event log. */
export function tallyStoryPoints(
  log: readonly GameEvent[],
  lookup: BodyLookup,
): { points: number; destroyed: readonly DestroyedUnit[] } {
  const t = new StoryPointsTracker(lookup);
  for (const e of log) t.add(e);
  return { points: t.points, destroyed: t.destroyed };
}

/** One band of the Points guide: a friendly heading and the kinds whose points reach `min`. */
export interface PointsTier {
  readonly title: string;
  readonly min: number;
}

/** The Points guide's bands, highest first (every kind that topples falls in exactly one). */
export const POINTS_TIERS: readonly PointsTier[] = [
  { title: 'The big ones', min: 600 },
  { title: 'Worth a lot', min: 200 },
  { title: 'Worth a bit', min: 50 },
  { title: 'Small change', min: 1 },
];

/** One line of the Points guide. */
export interface PointsGuideEntry {
  readonly kind: StoryKind;
  /** Capitalised display name ("Oil rig"). */
  readonly label: string;
  readonly points: number;
}

/**
 * The Points guide (pause menu, chapter list): every kind that can topple, with its real Topple
 * points, in POINTS_TIERS bands, highest first (ties by name). Rocks, glacier ice, parked cars and stone
 * walls never topple (they are pushed or absorbed), so they score nothing and are left out of the bands.
 */
export function pointsGuide(): readonly { readonly tier: PointsTier; readonly entries: readonly PointsGuideEntry[] }[] {
  const all = (Object.keys(STORY_POINTS) as StoryKind[])
    .filter((k) => STORY_POINTS[k] > 0)
    .map((k) => ({ kind: k, label: capitalise(KIND_LABEL[k]), points: STORY_POINTS[k] }))
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label));
  return POINTS_TIERS.map((tier, i) => {
    const above = i === 0 ? Infinity : POINTS_TIERS[i - 1].min;
    return { tier, entries: all.filter((e) => e.points >= tier.min && e.points < above) };
  }).filter((t) => t.entries.length > 0);
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain display names for the Points guide and the archive's run facts. */
export const KIND_LABEL: Readonly<Record<StoryKind, string>> = {
  rockSmall: 'small rock',
  rockMedium: 'rock',
  boulder: 'boulder',
  rockCluster: 'rocks',
  stoneBarrier: 'stone wall',
  pine: 'pine tree',
  broadleaf: 'leafy tree',
  house: 'house',
  iceBlock: 'glacier ice',
  iceField: 'glacier ice',
  car: 'car',
  truck: 'truck',
  bus: 'bus',
  fence: 'fence',
  guardrail: 'guardrail',
  footbridge: 'footbridge',
  roadBridge: 'road bridge',
  railWagon: 'rail wagon',
  boat: 'boat',
  dam: 'dam',
  church: 'church',
  waterTower: 'water tower',
  lighthouse: 'lighthouse',
  coolingTower: 'cooling tower',
  smokestack: 'smokestack',
  tank: 'storage tank',
  factoryHall: 'factory hall',
  pylon: 'power pylon',
  windTurbine: 'wind turbine',
  chalet: 'chalet',
  skiLiftPylon: 'ski-lift pylon',
  barn: 'barn',
  silo: 'silo',
  logPile: 'log pile',
  trafficLight: 'traffic light',
  apartmentBlock: 'apartment block',
  pumpjack: 'pumpjack',
  oilRig: 'oil rig',
  pipeline: 'pipeline',
  monument: 'monument',
};

export const kindLabel = (kind: string): string => (has(kind) ? KIND_LABEL[kind] : kind);

/** Display names of the categories (archive run facts). */
export const CATEGORY_LABEL: Readonly<Record<StructureCategory, string>> = {
  home: 'Homes',
  community: 'Shared places',
  transport: 'Transport',
  water: 'Water',
  energy: 'Energy',
  extraction: 'Extraction',
  industry: 'Industry',
  farm: 'Farms',
  nature: 'Trees and land',
  other: 'Other',
};
