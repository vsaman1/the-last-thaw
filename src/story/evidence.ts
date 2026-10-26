/**
 * RunEvidence: everything the narrative may say about one run, computed from the REAL session — its
 * event log, sampled route, run statistics and physics bodies — never from what the player intended
 * or what a level was designed to make likely. The authored fragments are chosen from it
 * (./select.ts), the agents read it (src/server), and the deterministic validator checks their
 * claims against it, so every rule here is conservative:
 *
 * - A landmark is 'destroyed' only if a body of its placement broke (obstacleBroken / treeFelled, or
 *   a body left in state 'broken'); 'damaged' if a body of it was knocked from where it stood but none
 *   broke; 'intact' ONLY if the run reached it (the route passed its course position, or came within
 *   REACH_RADIUS of it) — a structure the iceberg never got near was not "spared", it was never at
 *   risk — and otherwise 'notReached'. A landmark of several placements (LandmarkDef.bind.also: the
 *   co-op's three turbines) is read as one structure: destroyed if any of them broke, damaged if one
 *   was knocked, intact only if every one was reached and stood, so "all three running" is never shown
 *   beside a broken turbine.
 * - Counts are of placements (see ./scoring.ts destructionUnit), so one church is one church.
 * - Nothing about people: the evidence has no field that could imply anyone was inside anything.
 *
 * Event times: GameEvent carries no timestamp, so attachEventClock() records the play time of every
 * event as it is emitted (the UI attaches it when the session is created). Without a clock each
 * event's time is ESTIMATED from the nearest route sample to where it happened (within one 0.25 s
 * route interval for anything at the iceberg; rougher for things broken by water or debris).
 */
import type { EventBus } from '../core/events';
import type {
  CourseFrame,
  FailReason,
  GameEvent,
  GamePhase,
  LevelDef,
  ObstacleKind,
  ObstacleState,
  PhysicsWorldApi,
  RoutePoint,
  RunStats,
  Vec3,
} from '../core/types';
import { categoryOf, StoryPointsTracker, type BodyLookup, type DestroyedUnit, type ScoredBody } from './scoring';
import { resolveBindings } from './storyLevel';
import type {
  ChapterDef,
  LandmarkOutcome,
  LandmarkStatus,
  NotableEvent,
  NotableEventType,
  RunEvidence,
  StructureCategory,
} from './types';

/** A run "reached" a landmark it came this close to (m, horizontal), even without passing its s. */
export const REACH_RADIUS = 60;
/** Most notable events kept (the contract's cap). */
export const MAX_NOTABLE = 30;
/** Most route points kept. */
export const MAX_ROUTE = 40;
/** A landing from at least this high (m) is notable (the session's waterfall rule uses 6 m too). */
export const BIG_DROP = 6;
/** A chip of at least this share of a full iceberg is notable. */
export const BIG_CHIP = 0.03;
/** Absorbs closer together than this (s) are one notable (an ice field merges block by block). */
const ABSORB_MERGE = 3;

/** What evidence reads of a physics body (src/core/physics/world.ts ObstacleBody). */
export interface EvidenceBody extends ScoredBody {
  readonly state: ObstacleState;
  /** Credited as knocked from its spawn (any piece of it moved > knockDistance). */
  readonly countedKnocked: boolean;
  readonly spawn: Vec3;
}

interface BodyWorld {
  readonly bodies: readonly EvidenceBody[];
  getBody(id: number): EvidenceBody | undefined;
}

const hasBodies = (p: unknown): p is BodyWorld =>
  typeof p === 'object' && p !== null && Array.isArray((p as Partial<BodyWorld>).bodies) &&
  typeof (p as Partial<BodyWorld>).getBody === 'function';

/** The parts of a GameSession evidence reads (GameSession satisfies it). */
export interface EvidenceSession {
  readonly terrain: { readonly course: CourseFrame; readonly level: LevelDef };
  readonly physics: PhysicsWorldApi;
  readonly events: { readonly log: readonly GameEvent[] };
  readonly route: readonly RoutePoint[];
  readonly stats: Readonly<RunStats>;
  readonly params: { readonly mass: number };
  readonly phase: GamePhase;
  readonly failReason: FailReason | null;
  readonly iceberg: { readonly pos: Vec3 };
  /** Inland water (streams, reservoirs); a dam breaking with it present breaches a reservoir. */
  readonly water?: unknown;
}

/** Play time of each event from `offset` on in the session's log (see attachEventClock). */
export interface EventClock {
  readonly offset: number;
  readonly times: readonly number[];
  dispose(): void;
}

/**
 * Start timing a session's events: every event emitted from now on gets the play time it was
 * emitted at (session.stats.time, i.e. to within one 1/60 s step). Attach before play starts.
 */
export function attachEventClock(session: {
  readonly events: Pick<EventBus, 'on' | 'log'>;
  readonly stats: Readonly<RunStats>;
}): EventClock {
  const offset = session.events.log.length;
  const times: number[] = [];
  const off = session.events.on(() => {
    times.push(session.stats.time);
  });
  return { offset, times, dispose: off };
}

export interface EvidenceInput {
  session: EvidenceSession;
  chapter: ChapterDef;
  /** The story level the session played (src/story/storyLevel.ts); placements index into it. */
  level: LevelDef;
  clock?: EventClock;
}

const r1 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const r3 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);

/** Horizontal distance from (px, pz) to the segment a–b. */
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

/** Where the iceberg went: the sampled route plus where it is now, in world x/z. */
function trackOf(session: EvidenceSession): { x: number; z: number; t: number }[] {
  const pts = session.route.map((p) => ({ x: p.x, z: p.z, t: p.t }));
  const pos = session.iceberg.pos;
  if (Number.isFinite(pos.x) && Number.isFinite(pos.z)) pts.push({ x: pos.x, z: pos.z, t: session.stats.time });
  return pts;
}

function closestApproach(track: readonly { x: number; z: number }[], x: number, z: number): number {
  if (track.length === 0) return Infinity;
  let best = Math.hypot(track[0].x - x, track[0].z - z);
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    best = Math.min(best, segmentDistance(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

const eventPos = (e: GameEvent): Vec3 | null => ('pos' in e ? e.pos : null);

/** Notable-event ranking for the 30-event cap: higher survives first. */
const RANK: Record<NotableEventType, number> = {
  broke: 60,
  damBreached: 80,
  enteredOcean: 90,
  waterfall: 70,
  landed: 50,
  absorbed: 40,
  chipped: 30,
  felled: 20,
};
/** Landmarks outrank everything; costly structures outrank cheap ones. */
const LANDMARK_RANK = 100;
const COSTLY_POINTS = 200;

interface Candidate {
  readonly n: NotableEvent;
  readonly rank: number;
  readonly order: number;
}

/**
 * Build the RunEvidence of a finished (or abandoned) run. Pure: reads the session, changes nothing.
 * Outcome: 'complete' when the session completed, otherwise 'failed' (with its failReason if any).
 */
export function buildRunEvidence({ session, chapter, level, clock }: EvidenceInput): RunEvidence {
  const course = session.terrain.course;
  const log = session.events.log;
  const world = hasBodies(session.physics) ? session.physics : null;
  const lookup: BodyLookup = (id) => world?.getBody(id);
  const stats = session.stats;
  const track = trackOf(session);

  // --- destruction (placements, once each) --------------------------------------------------
  const tracker = new StoryPointsTracker(lookup);
  for (const e of log) tracker.add(e);
  const destroyed = tracker.destroyed;
  const destroyedByCategory: Partial<Record<StructureCategory, number>> = {};
  const destroyedByKind: Partial<Record<ObstacleKind, number>> = {};
  for (const u of destroyed) {
    const c = categoryOf(u.kind);
    destroyedByCategory[c] = (destroyedByCategory[c] ?? 0) + 1;
    destroyedByKind[u.kind] = (destroyedByKind[u.kind] ?? 0) + 1;
  }

  // --- landmarks --------------------------------------------------------------------------------
  const overlayCount = chapter.overlay.obstacles.length;
  const baseCount = Math.max(0, level.obstacles.length - overlayCount);
  const destroyedPlacements = new Set(destroyed.filter((u) => u.placement >= 0).map((u) => u.placement));
  const originals = new Map<number, EvidenceBody[]>();
  for (const b of world?.bodies ?? []) {
    if (b.id !== b.originId || b.placement < 0) continue;
    const list = originals.get(b.placement);
    if (list) list.push(b);
    else originals.set(b.placement, [b]);
  }
  const projected = track.map((p) => course.project(p.x, p.z));
  const reachedS = projected.reduce((m, p) => Math.max(m, p.s), -Infinity);
  const landmarkOf = new Map<number, string>();
  const landmarks: LandmarkOutcome[] = chapter.landmarks.map((lm) => {
    // A landmark of several placements (a co-op's turbines, a tank farm) reads as one structure of
    // several bodies: destroyed if any of them broke, intact only if every one was reached and stood.
    const ps = resolveBindings(lm.bind, baseCount, overlayCount);
    const placements = ps.map((p) => (p >= 0 ? level.obstacles[p] : undefined));
    if (placements.some((placed) => !placed)) return { id: lm.id, status: 'notReached', closest: -1 };
    let closest = Infinity;
    let broke = false;
    let knocked = false;
    let reachedAll = true;
    ps.forEach((p, k) => {
      const placed = placements[k]!;
      if (!landmarkOf.has(p)) landmarkOf.set(p, lm.id);
      const bodies = originals.get(p) ?? [];
      // Distance to the nearest of its bodies as they stood (a dam's monoliths, a bridge's piers);
      // its course position when the physics world is not inspectable.
      let near = Infinity;
      if (bodies.length > 0) {
        for (const b of bodies) near = Math.min(near, closestApproach(track, b.spawn.x, b.spawn.z));
      } else {
        const w = course.toWorld(placed.s, placed.d);
        near = closestApproach(track, w.x, w.z);
      }
      closest = Math.min(closest, near);
      if (destroyedPlacements.has(p) || bodies.some((b) => b.state === 'broken')) broke = true;
      else if (bodies.some((b) => b.countedKnocked)) knocked = true;
      if (!(reachedS >= placed.s || near <= REACH_RADIUS)) reachedAll = false;
    });
    const status: LandmarkStatus = broke ? 'destroyed' : knocked ? 'damaged' : reachedAll ? 'intact' : 'notReached';
    return { id: lm.id, status, closest: Number.isFinite(closest) ? r1(closest) : -1 };
  });

  // --- notable events ---------------------------------------------------------------------------
  const timeOf = (i: number, e: GameEvent): number => {
    if (clock && i >= clock.offset && i - clock.offset < clock.times.length) return clock.times[i - clock.offset];
    const pos = eventPos(e);
    if (!pos || session.route.length === 0) return stats.time;
    let best = session.route[0];
    let bd = Infinity;
    for (const r of session.route) {
      const d = Math.hypot(r.x - pos.x, r.z - pos.z);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best.t;
  };
  const firstBreak = new Map<number, DestroyedUnit>();
  for (const u of destroyed) firstBreak.set(u.event, u);
  const reservoirs = session.water !== null && session.water !== undefined;
  const candidates: Candidate[] = [];
  const push = (n: NotableEvent, rank: number, order: number): void => {
    candidates.push({ n, rank, order });
  };
  let absorbing: { n: NotableEvent; order: number } | null = null;
  const flushAbsorb = (): void => {
    if (absorbing) push(absorbing.n, RANK.absorbed, absorbing.order);
    absorbing = null;
  };
  log.forEach((e, i) => {
    const pos = eventPos(e);
    if (!pos) return;
    const at = (): { t: number; s: number; d: number } => {
      const c = course.project(pos.x, pos.z);
      return { t: r1(timeOf(i, e)), s: r1(c.s), d: r1(c.d) };
    };
    switch (e.type) {
      case 'obstacleBroken':
      case 'treeFelled': {
        const u = firstBreak.get(i);
        if (!u) return;
        const landmarkId = u.placement >= 0 ? landmarkOf.get(u.placement) : undefined;
        const type: NotableEventType =
          e.type === 'treeFelled' ? 'felled' : u.kind === 'dam' && reservoirs ? 'damBreached' : 'broke';
        const rank = landmarkId
          ? LANDMARK_RANK
          : type === 'broke' && u.points >= COSTLY_POINTS
            ? RANK.damBreached
            : RANK[type];
        push(
          {
            ...at(),
            type,
            kind: u.kind,
            category: categoryOf(u.kind),
            ...(landmarkId ? { landmarkId } : {}),
            ...(u.points > 0 ? { value: u.points } : {}),
          },
          rank,
          i,
        );
        return;
      }
      case 'waterfallCrossed':
        push({ ...at(), type: 'waterfall', value: e.index }, RANK.waterfall, i);
        return;
      case 'enteredOcean':
        push({ ...at(), type: 'enteredOcean' }, RANK.enteredOcean, i);
        return;
      case 'landed': {
        // A landing that crossed a waterfall is reported as the waterfall (emitted right after it).
        if (e.drop < BIG_DROP || log[i + 1]?.type === 'waterfallCrossed') return;
        push({ ...at(), type: 'landed', value: r1(e.drop) }, RANK.landed, i);
        return;
      }
      case 'iceChipped':
        if (e.amount >= BIG_CHIP) push({ ...at(), type: 'chipped', value: r3(e.amount) }, RANK.chipped, i);
        return;
      case 'absorbed': {
        const here = at();
        const prev: { n: NotableEvent; order: number } | null = absorbing;
        if (prev && here.t - prev.n.t <= ABSORB_MERGE) {
          absorbing = { n: { ...prev.n, value: r1((prev.n.value ?? 0) + e.mass) }, order: prev.order };
        } else {
          flushAbsorb();
          absorbing = { n: { ...here, type: 'absorbed', value: r1(e.mass) }, order: i };
        }
        return;
      }
      default:
        return;
    }
  });
  flushAbsorb();
  const notable = candidates
    .slice()
    .sort((a, b) => b.rank - a.rank || a.n.t - b.n.t || a.order - b.order)
    .slice(0, MAX_NOTABLE)
    .sort((a, b) => a.n.t - b.n.t || a.order - b.order)
    .map((c) => c.n);

  // --- route ------------------------------------------------------------------------------------
  const routeAll = session.route.map((p) => course.project(p.x, p.z));
  const route: { s: number; d: number }[] = [];
  if (routeAll.length <= MAX_ROUTE) {
    for (const p of routeAll) route.push({ s: r1(p.s), d: r1(p.d) });
  } else {
    for (let k = 0; k < MAX_ROUTE; k++) {
      const p = routeAll[Math.round((k * (routeAll.length - 1)) / (MAX_ROUTE - 1))];
      route.push({ s: r1(p.s), d: r1(p.d) });
    }
  }

  const startMass = session.params.mass;
  const iceLeft = Number.isFinite(stats.iceLeft) ? Math.max(0, stats.iceLeft) : 0;
  const complete = session.phase === 'complete';
  return {
    version: 1,
    chapterId: chapter.id,
    levelId: chapter.levelId,
    outcome: complete ? 'complete' : 'failed',
    ...(!complete && session.failReason ? { failReason: session.failReason } : {}),
    time: r1(stats.time),
    distance: Math.round(stats.distance),
    topSpeed: r1(stats.topSpeed),
    startMass: r1(startMass),
    endMass: r1(startMass * iceLeft),
    peakMass: r1(stats.peakMass),
    absorbed: r1(stats.absorbed),
    iceLeft: r3(iceLeft),
    waterfallsCrossed: stats.waterfallsCrossed,
    collisions: stats.collisions,
    treesFelled: stats.treesFelled,
    knockedDown: stats.knockedDown,
    buildingsDestroyed: stats.buildingsDestroyed,
    storyPoints: tracker.points,
    destroyedByCategory,
    destroyedByKind,
    landmarks,
    notable,
    route,
    reachedS: Number.isFinite(reachedS) ? r1(reachedS) : r1(level.startS),
    coastS: level.coastS,
  };
}

/** Total placements destroyed in some categories (all categories when omitted). */
export function destroyedCount(
  evidence: Pick<RunEvidence, 'destroyedByCategory'>,
  categories?: readonly StructureCategory[],
): number {
  let n = 0;
  for (const [c, v] of Object.entries(evidence.destroyedByCategory) as [StructureCategory, number][]) {
    if (!categories || categories.includes(c)) n += v;
  }
  return n;
}
