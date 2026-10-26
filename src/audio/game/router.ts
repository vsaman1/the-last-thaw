/**
 * The frame resolver (DESIGN §2.4 step 2, §6.3): once per animation frame it reads the events the
 * ring caught, merges what belongs together, and asks the session for at most a handful of sounds.
 *
 *   F1  a hit and the break it caused (same frame) are one request: the hit, then the break 15 ms
 *       later, then the material layers (glass, machinery, spill) and, in Story, the settle tail
 *   F2  the bodies of one placement breaking together are one break (mass summed); later bodies of
 *       an already broken placement add at most two small add-ons
 *   F3  a landing and the waterfall it crossed are one plunge
 *   F4  a chip rides on the hit that caused it (or is masked under a big one)
 *   F5  splashes merge (i = 1 − Π(1 − iₖ)) into at most two voices a frame, 30 m apart
 *   F6  a stone barrier "breaks apart" when its first stone is hit hard: the hit, then stone.scatter
 *   F6b a rock (or a barrier stone) knocked moving tumbles away: the hit, then stone.tumble, once per
 *       placement in 1.5 s and at most three stone breaks a second (the rest are their plain hits);
 *       a graze, or a boulder that barely moved, is the hit alone
 *   F7  a felled tree carries its hit; from the third tree in a second only the crack plays
 *   F8  absorbs merge
 *   F9  a gone body's 'rockSmall' is corrected by the ring
 *   F10 the world stays alive after the run: drift collisions and splashes still play
 *   F11 every event ends in the trace: played (by the engine), coalesced, or dropped with a reason
 *
 * Requests come from a fixed pool and are sorted by priority weight × linear gain before play(), so
 * when the engine admits only four in a fastForward frame it admits the four that matter most. The
 * pool, the per-frame scratch and the layers are reused: nothing is allocated per event.
 */
import type { ObstacleKind } from '../../core/types';
import {
  BREAK_LAYER_DB,
  BREAK_MAG,
  COLLISION_MAG,
  EVENT_MAG,
  FAMILY_LIMITS,
  GLOBAL_LIMITS,
  KIND_SOUNDS,
  PRIORITY_WEIGHT,
  SOUND_DEFS,
  type DropReason,
  type Priority,
  type QueuedEvent,
  type SessionAudio,
  type SoundFamily,
  type SoundId,
  type SoundRequest,
  type TraceEntry,
  type TraceKind,
  type VoiceLayer,
} from '../contract';
import type { EventRing } from './eventRing';
import {
  absorbLevelDb,
  breakLevelDb,
  breakM,
  breakRate,
  chipLevelDb,
  collisionM,
  dbToGain,
  hitLevelDb,
  hitLowpassHz,
  hitRate,
  hitSound,
  isQuietHit,
  knocksLoose,
  landingLevelDb,
  landingM,
  mergeIntensity,
  oceanLevelDb,
  plungeLevelDb,
  splashLevelDb,
  splashSound,
  stoneM,
  tumbleRate,
  wallLevelDb,
  wantsIceLayer,
  weightLevelDb,
} from './magnitude';

/** Requests a frame can build (the engine admits four; the rest are traced as frameCap). */
export const REQUEST_POOL = 24;
/** The break plays this long after the hit that caused it (events carry no timestamps). */
export const BREAK_AFTER_HIT_SEC = 0.015;
/** Dam monoliths coalesce over a longer window (DESIGN §6.3 F2). */
export const DAM_COALESCE_SEC = 2;
/** A stone barrier scatters at most once per placement in this window (FAMILY_LIMITS.scatter). */
export const SCATTER_WINDOW_SEC = 2;
/** F6b: a rock (a cluster, a barrier) tumbles at most once per placement in this window. */
export const TUMBLE_WINDOW_SEC = 1.5;
/** F6b: the kinds that tumble when knocked moving (they never break). */
export const TUMBLE_KINDS: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(['rockSmall', 'rockMedium', 'boulder', 'rockCluster', 'stoneBarrier']);
/** F7: trees counted for the level-of-detail rule. */
export const TREE_LOD_WINDOW_SEC = 1;
export const TREE_LOD_DB = -6;
/** The settle tail starts once the collapse itself is mostly down. */
export const SETTLE_DELAY_SEC = 1.2;
/** Material layers follow the crack. */
export const LAYER_DELAY_SEC = 0.05;
/** A chip rides 10 ms behind its hit. */
export const CHIP_DELAY_SEC = 0.01;
/** Machine run-down speed per kind: a pumpjack is slow and heavy, a turbine light and fast. */
export const WINDDOWN_RATE: Readonly<Partial<Record<ObstacleKind, number>>> = {
  pumpjack: 0.8,
  factoryHall: 1.0,
  windTurbine: 1.3,
  oilRig: 0.7,
};

const OPEN_LOWPASS = 16000;
const SETTLE_SOUNDS: ReadonlySet<SoundId> = new Set([
  'house.collapse',
  'timber.collapse',
  'masonry.collapse.small',
  'masonry.collapse.large',
]);

/**
 * The add-on a later body of an already broken placement plays (F2), in the same material: a church
 * tower falling after its nave, a second dam monolith. null = it just coalesces.
 */
export function addOnFor(brk: SoundId): SoundId | null {
  switch (brk) {
    case 'house.collapse':
    case 'masonry.collapse.small':
    case 'masonry.collapse.large':
    case 'dam.break':
      return 'masonry.collapse.small';
    case 'timber.collapse':
    case 'timber.break.medium':
      return 'timber.break.medium';
    case 'metal.break.structure':
    case 'metal.break.vehicle':
      return 'metal.break.light';
    default:
      return null;
  }
}

/** The kind's break sound, or null when its breaking is heard as a hard hit (cars have no break). */
export const breakSoundOf = (kind: ObstacleKind): SoundId | null => KIND_SOUNDS[kind].brk;

interface BrokenPlacement {
  t: number;
  level: number;
  addOns: number;
  addOn: SoundId | null;
  window: number;
  cause: number;
}

interface RecentHit {
  m: number;
  t: number;
}

interface SplashWindow {
  t: number;
  x: number;
  z: number;
}

const newRequest = (): SoundRequest => ({
  family: 'hit',
  priority: 3,
  layerCount: 0,
  layers: Array.from({ length: GLOBAL_LIMITS.maxLayers }, (): VoiceLayer => ({
    sound: 'hit.stone.light',
    variant: -1,
    gainDb: -60,
    rate: 1,
    lowpassHz: OPEN_LOWPASS,
    delaySec: 0,
    optional: false,
  })),
  positional: true,
  x: 0,
  y: 0,
  z: 0,
  key: -1,
  cause: -1,
  startDelaySec: 0,
});

export interface ResolverOptions {
  /** Story: debris.settle tails on structural failures (ChapterMix.settleTails). */
  readonly settleTails: boolean;
}

/** What one frame produced, for the bridge (bells, ambience) and tests. */
export interface FrameReport {
  /** Requests handed to the session this frame, and how many it started. */
  requests: number;
  started: number;
  /** enteredOcean was heard this frame (the ocean voice moves its next wave). */
  enteredOcean: boolean;
  /** Any collision or landing this frame (the wall-scrape detector stays quiet then). */
  contact: boolean;
}

export class FrameResolver {
  private readonly pool: SoundRequest[] = Array.from({ length: REQUEST_POOL }, newRequest);
  private used = 0;
  private readonly score = new Float64Array(REQUEST_POOL);
  private readonly order = new Int32Array(REQUEST_POOL);
  /** Per ring slot this frame: collision m, the request it became (-1), and whether it was merged. */
  private readonly m: Float64Array;
  private readonly reqOf: Int32Array;
  private readonly done: Uint8Array;
  private readonly lastHit = new Map<number, RecentHit>();
  private readonly broken = new Map<number, BrokenPlacement>();
  private readonly scattered = new Map<number, number>();
  private readonly tumbled = new Map<number, number>();
  /** Game times of the last scatters and tumbles (a ring of FAMILY_LIMITS.scatter.ratePerSec), oldest at stoneHead. */
  private readonly stones = new Float64Array(FAMILY_LIMITS.scatter.ratePerSec).fill(-Infinity);
  private stoneHead = 0;
  private readonly trees = new Float64Array(8);
  private treeHead = 0;
  private readonly splashes: SplashWindow[] = [
    { t: -Infinity, x: 0, z: 0 },
    { t: -Infinity, x: 0, z: 0 },
  ];
  private absorbAt = -Infinity;
  private oceanPlayed = false;
  private frame = 0;
  readonly report: FrameReport = { requests: 0, started: 0, enteredOcean: false, contact: false };

  constructor(
    private readonly session: SessionAudio,
    private readonly options: ResolverOptions,
    capacity: number = GLOBAL_LIMITS.eventRing,
  ) {
    this.m = new Float64Array(capacity);
    this.reqOf = new Int32Array(capacity);
    this.done = new Uint8Array(capacity);
    this.trees.fill(-Infinity);
  }

  /**
   * Resolve the ring's events for this frame and play them. `now` is game time (runtime.time);
   * `wall` is the terrain wall-hit magnitude the ambience detector measured this frame (< 0: none),
   * at the iceberg (wx, wy, wz). Clears the ring.
   */
  resolve(ring: EventRing, now: number, wall = -1, wx = 0, wy = 0, wz = 0): FrameReport {
    const r = this.report;
    r.requests = 0;
    r.started = 0;
    r.enteredOcean = false;
    r.contact = false;
    this.used = 0;
    this.frame = ring.frame;
    const n = ring.count;
    const s = ring.slots;
    if (ring.overflow > 0) this.traceNote('drop', -1, `ring overflow: ${ring.overflow} events not kept`, 'overflow');
    for (let i = 0; i < n; i++) {
      this.reqOf[i] = -1;
      this.done[i] = 0;
      this.m[i] = 0;
      const q = s[i];
      if (this.session.tracing) this.traceEvent(q);
      if (q.type === 'collision') {
        const m = collisionM(q.impulse, q.relSpeed);
        this.m[i] = m;
        this.lastHit.set(placementKey(q), { m, t: ring.times[i] });
        r.contact = true;
      } else if (q.type === 'landed') {
        r.contact = true;
      }
    }

    for (let i = 0; i < n; i++) if (s[i].type === 'obstacleBroken' && !this.done[i]) this.breakGroup(ring, i, now);
    for (let i = 0; i < n; i++) if (s[i].type === 'treeFelled' && !this.done[i]) this.tree(ring, i, now);
    this.landings(ring);
    for (let i = 0; i < n; i++) if (s[i].type === 'collision' && !this.done[i]) this.hit(ring, i, now);
    for (let i = 0; i < n; i++) if (s[i].type === 'iceChipped' && !this.done[i]) this.chip(ring, i);
    this.splashFrame(ring, now);
    this.absorbFrame(ring, now);
    for (let i = 0; i < n; i++) {
      const q = s[i];
      if (q.type === 'enteredOcean' && !this.done[i]) {
        this.done[i] = 1;
        r.enteredOcean = true;
        if (this.oceanPlayed) {
          this.traceNote('coalesce', q.seq, 'ocean.entry plays once per attempt');
          continue;
        }
        this.oceanPlayed = true;
        const req = this.take('ocean', 1, q, -1);
        if (req) this.layer(req, 'ocean.entry', oceanLevelDb(q.massT), 1, OPEN_LOWPASS, 0, false);
      } else if (!this.done[i] && (q.type === 'airborne' || q.type === 'complete' || q.type === 'failed')) {
        // No one-shot by design: the scrape cuts on take-off; the phases drive the ducks.
        this.done[i] = 1;
      }
    }
    if (wall >= 0 && !r.contact) {
      const req = this.takeAt('wallScrape', 3, -1, -1, wx, wy, wz);
      if (req) this.layer(req, 'ice.wallScrape', wallLevelDb(wall), 1, hitLowpassHz(wall), 0, false);
    }
    this.flush();
    ring.clear();
    return r;
  }

  // --- the rules ---------------------------------------------------------------------------------

  /** F1 + F2: every body of one placement that broke this frame, as one break (or add-ons). */
  private breakGroup(ring: EventRing, first: number, now: number): void {
    const s = ring.slots;
    const q = s[first];
    const pk = placementKey(q);
    let mass = 0;
    for (let i = first; i < ring.count; i++) {
      const o = s[i];
      if (o.type !== 'obstacleBroken' || this.done[i] || placementKey(o) !== pk) continue;
      mass += o.massT;
      if (i !== first) {
        this.done[i] = 1;
        this.traceNote('coalesce', o.seq, `body of p${o.placement} into #${q.seq}`);
      }
    }
    this.done[first] = 1;
    const kind = q.kind ?? 'rockSmall';
    const brk = breakSoundOf(kind);
    const prev = this.broken.get(pk);
    if (prev && now - prev.t <= prev.window) {
      // F2: a later body of a placement already heard breaking.
      if (prev.addOn === null || prev.addOns >= BREAK_MAG.maxSettleAddOns) {
        this.traceNote('coalesce', q.seq, `p${q.placement} already broken (#${prev.cause})`);
        return;
      }
      prev.addOns++;
      const req = this.take(SOUND_DEFS[prev.addOn].family, SOUND_DEFS[prev.addOn].priority, q, -1);
      if (req) this.layer(req, prev.addOn, prev.level + BREAK_MAG.settleAddOnDb, breakRate(0.5), OPEN_LOWPASS, 0, false);
      return;
    }
    const hitSlot = this.sameFrameHit(ring, q, pk);
    const recent = this.lastHit.get(pk);
    const mHit = hitSlot >= 0 ? this.m[hitSlot] : recent && now - recent.t <= BREAK_MAG.hitWindowSec ? recent.m : 0;
    const M = breakM(mass, mHit);
    if (brk === null) {
      // Kinds with no break of their own (a car) are heard as the hardest hit of their material.
      const req = this.take('hit', SOUND_DEFS[KIND_SOUNDS[kind].hit].priority, q, placementKey(q));
      if (!req) return;
      if (hitSlot >= 0) this.consume(ring, hitSlot, q.seq);
      const sound = hitSound(kind, M);
      this.layer(req, sound, hitLevelDb(sound, M), hitRate(M), hitLowpassHz(M), 0, false);
      const pane = KIND_SOUNDS[kind].paneAbove;
      if (pane !== null && M > pane) this.layer(req, 'glass.pane', hitLevelDb(sound, M) + (BREAK_LAYER_DB['glass.pane'] ?? -8), 1, OPEN_LOWPASS, LAYER_DELAY_SEC, true);
      return;
    }
    const def = SOUND_DEFS[brk];
    const req = this.take(def.family, def.priority, q, placementKey(q));
    if (!req) return;
    const level = breakLevelDb(brk, M);
    const window = kind === 'dam' ? DAM_COALESCE_SEC : BREAK_MAG.coalesceSec;
    this.broken.set(pk, { t: now, level, addOns: 0, addOn: addOnFor(brk), window, cause: q.seq });
    let delay = 0;
    if (hitSlot >= 0) {
      this.consume(ring, hitSlot, q.seq);
      this.hitLayer(req, ring.slots[hitSlot], this.m[hitSlot]);
      delay = BREAK_AFTER_HIT_SEC;
    }
    this.layer(req, brk, level, breakRate(M), OPEN_LOWPASS, delay, false);
    for (const extra of KIND_SOUNDS[kind].brkLayers) {
      const rate = extra === 'machine.winddown' ? (WINDDOWN_RATE[kind] ?? 1) : 1;
      this.layer(req, extra, level + (BREAK_LAYER_DB[extra] ?? -8), rate, OPEN_LOWPASS, delay + LAYER_DELAY_SEC, extra === 'glass.break' || extra === 'glass.pane');
    }
    if (this.options.settleTails && SETTLE_SOUNDS.has(brk)) {
      this.layer(req, 'debris.settle', level + (BREAK_LAYER_DB['debris.settle'] ?? -14), 1, OPEN_LOWPASS, delay + SETTLE_DELAY_SEC, true);
    }
  }

  /** F7: a felled tree carrying the hit that felled it; the crack only, once trees fall in numbers. */
  private tree(ring: EventRing, i: number, now: number): void {
    const q = ring.slots[i];
    this.done[i] = 1;
    const kind = q.kind === 'broadleaf' ? 'broadleaf' : 'pine';
    const brk = breakSoundOf(kind) ?? 'tree.fall.pine';
    let recent = 0;
    for (let k = 0; k < this.trees.length; k++) if (now - this.trees[k] <= TREE_LOD_WINDOW_SEC) recent++;
    this.trees[this.treeHead] = now;
    this.treeHead = (this.treeHead + 1) % this.trees.length;
    const req = this.take('tree', SOUND_DEFS[brk].priority, q, placementKey(q));
    if (!req) return;
    const pk = placementKey(q);
    const hitSlot = this.sameFrameHit(ring, q, pk);
    const recentHit = this.lastHit.get(pk);
    const mHit = hitSlot >= 0 ? this.m[hitSlot] : recentHit && now - recentHit.t <= BREAK_MAG.hitWindowSec ? recentHit.m : 0;
    const M = breakM(q.massT, mHit);
    let delay = 0;
    if (hitSlot >= 0) {
      this.consume(ring, hitSlot, q.seq);
      this.hitLayer(req, ring.slots[hitSlot], this.m[hitSlot]);
      delay = BREAK_AFTER_HIT_SEC;
    }
    const level = breakLevelDb(brk, M);
    if (recent >= EVENT_MAG.treeLodAfter) {
      // The third tree within a second: the crack alone, quieter, no ground whump.
      this.layer(req, 'timber.break.light', level + TREE_LOD_DB, breakRate(M), OPEN_LOWPASS, delay, false);
    } else {
      this.layer(req, brk, level, breakRate(M), OPEN_LOWPASS, delay, false);
    }
  }

  /** F3: a landing becomes a plunge when the same frame crossed a waterfall. */
  private landings(ring: EventRing): void {
    const s = ring.slots;
    let fall = -1;
    let drop = 0;
    for (let i = 0; i < ring.count; i++) {
      if (s[i].type === 'waterfallCrossed' && fall < 0) fall = i;
      if (s[i].type === 'landed') drop = Math.max(drop, s[i].drop);
    }
    if (fall >= 0) {
      const q = s[fall];
      this.done[fall] = 1;
      for (let i = 0; i < ring.count; i++) {
        if (s[i].type === 'landed') {
          this.done[i] = 1;
          this.traceNote('coalesce', s[i].seq, `landing into the plunge #${q.seq}`);
        } else if (s[i].type === 'waterfallCrossed' && i !== fall) {
          this.done[i] = 1;
          this.traceNote('coalesce', s[i].seq, `into the plunge #${q.seq}`);
        }
      }
      const req = this.take('plunge', SOUND_DEFS['water.plunge'].priority, q, q.index);
      if (req) this.layer(req, 'water.plunge', plungeLevelDb(drop > 0 ? drop : 6), 1, OPEN_LOWPASS, 0, false);
      return;
    }
    for (let i = 0; i < ring.count; i++) {
      const q = s[i];
      if (q.type !== 'landed') continue;
      this.done[i] = 1;
      const mL = landingM(q.massT, q.drop);
      if (!(mL > 0)) {
        this.traceNote('drop', q.seq, `drop ${q.drop.toFixed(2)} m`, 'quiet');
        continue;
      }
      const sound = ring.wet[i] ? 'ice.land.water' : 'ice.land.ground';
      const req = this.take('land', q.drop >= 6 ? 1 : 2, q, -1);
      // A heavier landing is a little lower, as a heavier hit is (rate 1.04 down to 0.96).
      if (req) this.layer(req, sound, landingLevelDb(mL), 1.04 - 0.08 * mL, OPEN_LOWPASS, 0, false);
    }
  }

  /** A collision that is its own sound: F6 stone barriers, F6b rocks, the hit with its weight, ice and glass. */
  private hit(ring: EventRing, i: number, now: number): void {
    const q = ring.slots[i];
    this.done[i] = 1;
    const m = this.m[i];
    if (isQuietHit(m)) {
      this.traceNote('drop', q.seq, `m ${m.toFixed(3)}`, 'quiet');
      return;
    }
    const kind = q.kind ?? 'rockSmall';
    if (kind === 'stoneBarrier' && m >= EVENT_MAG.scatterFrom && q.placement >= 0 && this.stoneRoom(now)) {
      const last = this.scattered.get(q.placement);
      if (last === undefined || now - last > SCATTER_WINDOW_SEC) {
        this.scattered.set(q.placement, now);
        this.stoneBreak(i, q, m, 'stone.scatter', q.placement, breakRate(stoneM(q.massT, m)), now);
        return;
      }
    }
    if (TUMBLE_KINDS.has(kind) && knocksLoose(m, q.impulse, q.massT) && this.stoneRoom(now)) {
      const pk = placementKey(q);
      const last = this.tumbled.get(pk);
      const scattered = q.placement >= 0 ? this.scattered.get(q.placement) : undefined;
      if ((last === undefined || now - last > TUMBLE_WINDOW_SEC) && (scattered === undefined || now - scattered > SCATTER_WINDOW_SEC)) {
        this.tumbled.set(pk, now);
        this.stoneBreak(i, q, m, 'stone.tumble', pk, tumbleRate(q.massT), now);
        return;
      }
    }
    const sound = hitSound(kind, m);
    const req = this.take('hit', SOUND_DEFS[sound].priority, q, q.obstacleId);
    if (!req) return;
    this.reqOf[i] = this.used - 1;
    this.hitLayer(req, q, m);
    const weight = weightLevelDb(m);
    if (weight !== null) this.layer(req, 'weight.thump', weight, hitRate(m), OPEN_LOWPASS, 0, false);
    const level = hitLevelDb(sound, m);
    if (wantsIceLayer(kind, m)) this.layer(req, 'hit.ice', level + COLLISION_MAG.iceLayerDb, hitRate(m), hitLowpassHz(m), 0, true);
    const pane = KIND_SOUNDS[kind].paneAbove;
    if (pane !== null && m > pane) this.layer(req, 'glass.pane', level + (BREAK_LAYER_DB['glass.pane'] ?? -8), 1, OPEN_LOWPASS, LAYER_DELAY_SEC, true);
  }

  /**
   * F6 / F6b: the stone hit with its weight, then the barrier breaking apart or the rock tumbling away 15 ms
   * later, at its break level for M = stoneM(the stone's mass, m); the iceberg's own ice last (optional).
   */
  private stoneBreak(i: number, q: QueuedEvent, m: number, sound: 'stone.scatter' | 'stone.tumble', key: number, rate: number, now: number): void {
    this.stones[this.stoneHead] = now;
    this.stoneHead = (this.stoneHead + 1) % this.stones.length;
    const req = this.take('scatter', SOUND_DEFS[sound].priority, q, key);
    if (!req) return;
    this.reqOf[i] = this.used - 1;
    this.hitLayer(req, q, m);
    const weight = weightLevelDb(m);
    if (weight !== null) this.layer(req, 'weight.thump', weight, hitRate(m), OPEN_LOWPASS, 0, false);
    this.layer(req, sound, breakLevelDb(sound, stoneM(q.massT, m)), rate, OPEN_LOWPASS, BREAK_AFTER_HIT_SEC, false);
    const kind = q.kind ?? 'rockSmall';
    if (wantsIceLayer(kind, m)) {
      const level = hitLevelDb(hitSound(kind, m), m);
      this.layer(req, 'hit.ice', level + COLLISION_MAG.iceLayerDb, hitRate(m), hitLowpassHz(m), 0, true);
    }
  }

  /**
   * Room for one more scatter or tumble: fewer than the 'scatter' family's requests a second in the last
   * second. Beyond that a knocked rock is its plain hit (the engine's bucket would refuse the whole
   * request, the hit with it: a cluster ploughed through at speed must not go silent).
   */
  private stoneRoom(now: number): boolean {
    return now - this.stones[this.stoneHead] >= 1;
  }

  /** F4: the chip on the hit it came from (same contact point), masked under a heavy hit. */
  private chip(ring: EventRing, i: number): void {
    const q = ring.slots[i];
    this.done[i] = 1;
    const s = ring.slots;
    let hit = -1;
    for (let k = 0; k < ring.count; k++) {
      const o = s[k];
      if (o.type === 'collision' && o.x === q.x && o.y === q.y && o.z === q.z) {
        hit = k;
        break;
      }
    }
    if (hit >= 0 && this.m[hit] > EVENT_MAG.chipMaskedAbove) {
      this.traceNote('drop', q.seq, `under the hit #${s[hit].seq}`, 'masked');
      return;
    }
    const level = chipLevelDb(q.amount);
    const into = hit >= 0 ? this.reqOf[hit] : -1;
    if (into >= 0 && this.pool[into].layerCount < GLOBAL_LIMITS.maxLayers) {
      this.layer(this.pool[into], 'ice.chip', level, 1, OPEN_LOWPASS, CHIP_DELAY_SEC, true);
      this.traceNote('coalesce', q.seq, `chip layer on #${s[hit].seq}`);
      return;
    }
    const req = this.take('chip', SOUND_DEFS['ice.chip'].priority, q, -1);
    if (req) this.layer(req, 'ice.chip', level, 1, OPEN_LOWPASS, 0, false);
  }

  /** F5: this frame's splashes in at most two clusters 30 m apart; a cluster near one heard < 120 ms ago merges. */
  private splashFrame(ring: EventRing, now: number): void {
    const s = ring.slots;
    // Two clusters: first slot, merged intensity, intensity-weighted centroid.
    let a = -1;
    let b = -1;
    let ia = 0;
    let ib = 0;
    let wa = 0;
    let wb = 0;
    let ax = 0;
    let az = 0;
    let ay = 0;
    let bx = 0;
    let bz = 0;
    let by = 0;
    const apart = EVENT_MAG.splashApartM;
    for (let i = 0; i < ring.count; i++) {
      const q = s[i];
      if (q.type !== 'splash' || this.done[i]) continue;
      this.done[i] = 1;
      const w = Math.max(1e-3, q.intensity);
      const da = a < 0 ? Infinity : Math.hypot(q.x - ax / wa, q.z - az / wa);
      const db = b < 0 ? Infinity : Math.hypot(q.x - bx / wb, q.z - bz / wb);
      // A second cluster only for a splash more than 30 m from the first; after that, the nearer one.
      const toA = a < 0 || (b < 0 ? da <= apart : da <= db);
      if (toA) {
        if (a < 0) a = i;
        else this.traceNote('coalesce', q.seq, `splash into #${s[a].seq}`);
        ia = mergeIntensity(ia, q.intensity);
        wa += w;
        ax += q.x * w;
        ay += q.y * w;
        az += q.z * w;
      } else {
        if (b < 0) b = i;
        else this.traceNote('coalesce', q.seq, `splash into #${s[b].seq}`);
        ib = mergeIntensity(ib, q.intensity);
        wb += w;
        bx += q.x * w;
        by += q.y * w;
        bz += q.z * w;
      }
    }
    if (a >= 0) this.splashOut(s[a], ia, ax / wa, ay / wa, az / wa, now);
    if (b >= 0) this.splashOut(s[b], ib, bx / wb, by / wb, bz / wb, now);
  }

  private splashOut(q: QueuedEvent, i: number, x: number, y: number, z: number, now: number): void {
    const apart = EVENT_MAG.splashApartM;
    for (const w of this.splashes) {
      if (now - w.t <= EVENT_MAG.splashMergeSec && Math.hypot(x - w.x, z - w.z) <= apart) {
        this.traceNote('coalesce', q.seq, 'splash within 120 ms of the last one there');
        return;
      }
    }
    const slot = this.splashes[0].t <= this.splashes[1].t ? this.splashes[0] : this.splashes[1];
    slot.t = now;
    slot.x = x;
    slot.z = z;
    const sound = splashSound(i);
    const req = this.takeAt('splash', SOUND_DEFS[sound].priority, q.seq, -1, x, y, z);
    if (req) this.layer(req, sound, splashLevelDb(i), 1, OPEN_LOWPASS, 0, false);
  }

  /** F8: the frame's absorbs as one crunch (summed mass); within 100 ms of the last one they merge. */
  private absorbFrame(ring: EventRing, now: number): void {
    const s = ring.slots;
    let first = -1;
    let mass = 0;
    for (let i = 0; i < ring.count; i++) {
      const q = s[i];
      if (q.type !== 'absorbed' || this.done[i]) continue;
      this.done[i] = 1;
      mass += q.massT;
      if (first < 0) first = i;
      else this.traceNote('coalesce', q.seq, `absorb into #${s[first].seq}`);
    }
    if (first < 0) return;
    const q = s[first];
    if (now - this.absorbAt <= EVENT_MAG.absorbMergeSec) {
      this.traceNote('coalesce', q.seq, 'absorb within 100 ms of the last one');
      return;
    }
    this.absorbAt = now;
    const req = this.take('absorb', SOUND_DEFS['ice.absorb'].priority, q, -1);
    if (req) this.layer(req, 'ice.absorb', absorbLevelDb(mass), 1, OPEN_LOWPASS, 0, false);
  }

  // --- helpers ----------------------------------------------------------------------------------

  /**
   * The collision in this frame that caused a break: the hardest on the same body, else the hardest
   * on the same placement; -1 when the break came from elsewhere (a flood, debris, an earlier frame).
   */
  private sameFrameHit(ring: EventRing, q: QueuedEvent, pk: number): number {
    const s = ring.slots;
    let body = -1;
    let place = -1;
    for (let i = 0; i < ring.count; i++) {
      const o = s[i];
      if (o.type !== 'collision' || this.done[i]) continue;
      if (o.obstacleId === q.obstacleId) {
        if (body < 0 || this.m[i] > this.m[body]) body = i;
      } else if (q.placement >= 0 && placementKey(o) === pk && (place < 0 || this.m[i] > this.m[place])) {
        place = i;
      }
    }
    return body >= 0 ? body : place;
  }

  private consume(ring: EventRing, slot: number, into: number): void {
    this.done[slot] = 1;
    this.traceNote('coalesce', ring.slots[slot].seq, `the hit is layer 0 of #${into}`);
  }

  private hitLayer(req: SoundRequest, q: QueuedEvent, m: number): void {
    const sound = hitSound(q.kind ?? 'rockSmall', m);
    this.layer(req, sound, hitLevelDb(sound, m), hitRate(m), hitLowpassHz(m), 0, false);
  }

  private take(family: SoundFamily, priority: Priority, q: QueuedEvent, key: number): SoundRequest | null {
    return this.takeAt(family, priority, q.seq, key, q.x, q.y, q.z);
  }

  private takeAt(
    family: SoundFamily,
    priority: Priority,
    cause: number,
    key: number,
    x: number,
    y: number,
    z: number,
  ): SoundRequest | null {
    if (this.used >= REQUEST_POOL) {
      this.traceNote('drop', cause, 'more requests than one frame can carry', 'frameCap');
      return null;
    }
    const req = this.pool[this.used++];
    req.family = family;
    req.priority = priority;
    req.layerCount = 0;
    req.positional = true;
    req.x = x;
    req.y = y;
    req.z = z;
    req.key = key;
    req.cause = cause;
    req.startDelaySec = 0;
    return req;
  }

  private layer(
    req: SoundRequest,
    sound: SoundId,
    gainDb: number,
    rate: number,
    lowpassHz: number,
    delaySec: number,
    optional: boolean,
  ): void {
    if (req.layerCount >= GLOBAL_LIMITS.maxLayers) return;
    const l = req.layers[req.layerCount++];
    l.sound = sound;
    l.variant = -1;
    l.gainDb = gainDb;
    l.rate = rate;
    l.lowpassHz = lowpassHz;
    l.delaySec = delaySec;
    l.optional = optional;
  }

  /** Sort this frame's requests by priority weight × the loudest layer's gain, then play them. */
  private flush(): void {
    const n = this.used;
    for (let i = 0; i < n; i++) {
      const req = this.pool[i];
      let peak = 0;
      for (let k = 0; k < req.layerCount; k++) peak = Math.max(peak, dbToGain(req.layers[k].gainDb));
      this.score[i] = PRIORITY_WEIGHT[req.priority] * peak;
      // Insertion sort: a frame has a handful of requests.
      let j = i;
      while (j > 0 && this.score[this.order[j - 1]] < this.score[i]) {
        this.order[j] = this.order[j - 1];
        j--;
      }
      this.order[j] = i;
    }
    for (let k = 0; k < n; k++) {
      const req = this.pool[this.order[k]];
      if (req.layerCount === 0) continue;
      this.report.requests++;
      this.report.started += this.session.play(req).started;
    }
  }

  // --- trace --------------------------------------------------------------------------------------

  private traceEvent(q: QueuedEvent): void {
    const kind: TraceKind = 'event';
    this.session.trace({
      seq: 0,
      t: 0,
      gt: 0,
      token: this.session.token,
      frame: q.frame,
      kind,
      ev: q.type ?? undefined,
      cause: q.seq,
      placement: q.placement >= 0 ? q.placement : undefined,
      input: inputOf(q),
      note: q.type === 'airborne' || q.type === 'complete' || q.type === 'failed' ? 'no sound by design' : (q.kind ?? undefined),
    } satisfies TraceEntry);
  }

  private traceNote(kind: TraceKind, cause: number, note: string, reason?: DropReason): void {
    if (!this.session.tracing) return;
    this.session.trace({ seq: 0, t: 0, gt: 0, token: this.session.token, frame: this.frame, kind, cause, reason, note });
  }
}

/** Per-structure state key: the placement, or (bodies the level did not place) the original body. */
function placementKey(q: QueuedEvent): number {
  return q.placement >= 0 ? q.placement : 1_000_000 + Math.max(0, q.obstacleId);
}

function inputOf(q: QueuedEvent): TraceEntry['input'] {
  switch (q.type) {
    case 'collision':
      return { relSpeed: q.relSpeed, impulse: q.impulse, m: collisionM(q.impulse, q.relSpeed) };
    case 'obstacleBroken':
    case 'treeFelled':
    case 'absorbed':
      return { massT: q.massT };
    case 'splash':
      return { intensity: q.intensity };
    case 'landed':
      return { drop: q.drop, massT: q.massT };
    case 'iceChipped':
      return { amount: q.amount };
    default:
      return undefined;
  }
}
