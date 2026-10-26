/**
 * Church bells (DESIGN §7.7): a turret clock, never a toll.
 *
 * - Background phrases of 2–4 strokes (never one) every 45–75 s while the listener is within 1500 m,
 *   the first 6–14 s into the attempt (usually over the flyover: it establishes the place); two
 *   churches of one level keep at least 20 s apart.
 * - The hour, once per church per attempt, struck as the iceberg approaches during play so it is heard
 *   before the church is reached: six in Story (ten past six on the morning of the twelfth was when
 *   the chalk went up, ch4), three in Arcade. It waits for a phrase in progress, and never starts once
 *   the church is behind.
 * - A tower that holds a hit shivers (the bell resonates; nobody rang it). A tower that falls goes
 *   silent for the rest of the attempt, in both modes: its ringing strikes are choked, a dull buried
 *   clank sounds 1.1 s later under the collapse, and nothing replaces it. Mid-hour the clock just
 *   stops at, say, four. Story lowers the music for it (the moment is the absence).
 *
 * - A phrase or the hour whose strike is not baked yet waits until it is (SessionAudio.bellReady):
 *   bells are background, so late is fine and lost is not. An hour asked for in time still strikes
 *   when its strike arrives, even if the iceberg has passed the church by then. The trace says so
 *   once each way: `bell-deferred p44 st-brides hour (strike not baked)`, then `bell-ready p44
 *   st-brides after 3.2 s`.
 *
 * The scheduler is pure (session time in, strokes out: pausing freezes it, a fastForward skips ahead
 * without catching up); the driver reads the towers, the iceberg's approach and the listener, and
 * plays strokes through SessionAudio.playBell on the context clock with a 0.25 s lookahead.
 */
import type { GameRuntime } from '../../core/runtime';
import type { CourseProjection } from '../../core/terrain/course';
import { isGeneratedTerrain } from '../../core/terrain/terrain';
import type { CourseSample, LevelDef, ObstacleKind } from '../../core/types';
import {
  BELL_PATTERN,
  BELL_VARIATION,
  BELL_VOICINGS,
  CHURCH_BELLS,
  SPATIAL,
  towerStanding,
  type AudioBodyView,
  type AudioState,
  type BellForm,
  type BellVoicingId,
  type ListenerPose,
  type PositionalVoice,
  type SessionAudio,
} from '../contract';
import type { EventRing } from './eventRing';
import { dbToGain } from './magnitude';
import { airLowpassHz, distanceGain, distanceTo, panFor } from '../spatial';

/** An overlay or future church with no voicing of its own rings like St Bride's (the reference bell). */
export const DEFAULT_VOICING: BellVoicingId = 'st-brides';
/** A tower hit this hard (shake amplitude) shivers. */
const SHIVER_MAX_GAIN = 0.6;
/** Two phrases of one church never run straight into the hour: at least this many stroke gaps. */
const HOUR_GAP_STROKES = 2;
/** While the iceberg is within this many hour radii of the church, no new background phrase starts. */
const APPROACH_HOLD = 1.5;
const BELL_HZ = 10;
const REPORT_HZ = 2;

/** The id of a story level's base level ('riverside-town~ch4-people' → 'riverside-town'). */
export const baseLevelId = (id: string): string => id.split('~')[0];

export interface ChurchPlacement {
  readonly placement: number;
  readonly voicing: BellVoicingId;
  readonly scale: number;
}

/** Every church a level places (base and overlay), with its voicing (CHURCH_BELLS, else the default). */
export function churchesOf(level: LevelDef): ChurchPlacement[] {
  const base = baseLevelId(level.id);
  const out: ChurchPlacement[] = [];
  level.obstacles.forEach((p, placement) => {
    if (p.kind !== 'church') return;
    const def = CHURCH_BELLS.find((c) => c.levelId === base && c.placement === placement);
    out.push({ placement, voicing: def?.voicing ?? DEFAULT_VOICING, scale: p.scale ?? 1 });
  });
  return out;
}

// =================================================================================================
// The scheduler (pure)
// =================================================================================================

export interface Stroke {
  /** Session time of the stroke. */
  readonly t: number;
  readonly velocity: number;
  readonly hour: boolean;
}

interface Church {
  readonly slot: number;
  readonly voicing: BellVoicingId;
  readonly strokeSec: number;
  readonly queue: Stroke[];
  nextPhraseAt: number;
  lastPhraseAt: number;
  /** Session time the last scheduled stroke falls at (phrase or hour). */
  busyUntil: number;
  silenced: boolean;
  hourDone: boolean;
  hourPending: boolean;
  approaching: boolean;
  strikes: number;
  hourStrikes: number;
  hourActive: boolean;
  /** What is waiting for the strike to be baked (null: nothing), and since when (session time). */
  deferred: 'phrase' | 'hour' | null;
  deferredSince: number;
  /** Times a phrase or the hour had to wait for the bake. */
  deferrals: number;
}

/** A stroke due now, as tick() hands it out (reused objects). */
export interface DueStroke {
  slot: number;
  /** Seconds from now (session time; ≥ −skipLateSec). */
  inSec: number;
  velocity: number;
  hour: boolean;
}

export class BellScheduler {
  readonly churches: Church[];
  /** Strokes skipped because they fell more than skipLateSec in the past (no catch-up). */
  skipped = 0;
  private readonly due: DueStroke[] = [];
  private dueCount = 0;

  constructor(
    voicings: readonly BellVoicingId[],
    private readonly hourStrokes: number,
    private readonly rng: () => number,
    /** Is church `slot`'s strike baked? (Default: always.) Phrases and the hour wait for it. */
    private readonly ready: (slot: number) => boolean = () => true,
  ) {
    this.churches = voicings.map((voicing, slot) => ({
      slot,
      voicing,
      strokeSec: BELL_VOICINGS[voicing].strokeSec,
      queue: [],
      nextPhraseAt: 0,
      lastPhraseAt: -Infinity,
      busyUntil: -Infinity,
      silenced: false,
      hourDone: false,
      hourPending: false,
      approaching: false,
      strikes: 0,
      hourStrikes: 0,
      hourActive: false,
      deferred: null,
      deferredSince: 0,
      deferrals: 0,
    }));
    const [a, b] = BELL_PATTERN.firstPhraseSec;
    let prev = -Infinity;
    for (const c of this.churches) {
      const t = a + (b - a) * this.rng();
      c.nextPhraseAt = Math.max(t, prev + BELL_PATTERN.churchOffsetSec);
      prev = c.nextPhraseAt;
    }
  }

  /** The hour's length plus its lead and anything still sounding (the approach trigger uses it). */
  hourLeadSec(slot: number, now: number): number {
    const c = this.churches[slot];
    const busy = Math.max(0, c.busyUntil + HOUR_GAP_STROKES * c.strokeSec - now);
    return this.hourStrokes * c.strokeSec + BELL_PATTERN.hourLeadSec + busy;
  }

  /** The driver's view of the approach: hold back new phrases while the church is close ahead. */
  setApproaching(slot: number, on: boolean): void {
    this.churches[slot].approaching = on;
  }

  /** The church is behind the iceberg (or the attempt ended): its hour will not strike. */
  passed(slot: number): void {
    this.churches[slot].hourDone = true;
  }

  /** Strike the hour now, or as soon as the phrase in progress has ended (and the strike is baked). Once per attempt. */
  startHour(slot: number, now: number): void {
    const c = this.churches[slot];
    if (c.silenced || c.hourDone || c.hourPending) return;
    c.hourPending = true;
    if (this.readyNow(c, 'hour', now)) this.scheduleHour(c, now);
  }

  /** The tower stopped standing: no stroke of this church sounds again in this attempt. */
  silence(slot: number): void {
    const c = this.churches[slot];
    c.silenced = true;
    c.queue.length = 0;
  }

  /**
   * Advance to session time `now`. Strokes due within `lookahead` come out of `strokes()` (until the
   * next tick); `inRange(slot)` says whether the listener can hear that church (phrases start only
   * then).
   */
  tick(now: number, inRange: (slot: number) => boolean, lookahead: number = BELL_PATTERN.lookaheadSec): void {
    this.dueCount = 0;
    for (const c of this.churches) {
      if (c.silenced) continue;
      if (c.hourPending && c.queue.length === 0 && this.readyNow(c, 'hour', now)) this.scheduleHour(c, now);
      if (c.queue.length === 0 && !c.hourPending && now >= c.nextPhraseAt) {
        const blocked = c.approaching && !c.hourDone;
        // A phrase whose strike is not baked keeps its time and is tried again next tick.
        if (!blocked && inRange(c.slot)) {
          if (this.readyNow(c, 'phrase', now)) this.schedulePhrase(c, now);
        } else c.nextPhraseAt = now + this.gap();
      }
      while (c.queue.length > 0 && c.queue[0].t <= now + lookahead) {
        const s = c.queue.shift()!;
        if (s.t < now - BELL_PATTERN.skipLateSec) {
          this.skipped++;
          continue;
        }
        c.strikes++;
        if (s.hour) {
          c.hourStrikes++;
          c.hourActive = c.queue.length > 0;
        }
        this.emit(c.slot, s.t - now, s.velocity, s.hour);
      }
    }
  }

  /** Is the strike baked? If not, note what waits for it (counted once per wait). */
  private readyNow(c: Church, what: 'phrase' | 'hour', now: number): boolean {
    if (this.ready(c.slot)) {
      c.deferred = null;
      return true;
    }
    if (c.deferred !== what) {
      if (c.deferred === null) c.deferredSince = now;
      c.deferred = what;
      c.deferrals++;
    }
    return false;
  }

  /** The strokes the last tick() let out. */
  strokes(): readonly DueStroke[] {
    return this.due.slice(0, this.dueCount);
  }

  get dueStrokes(): number {
    return this.dueCount;
  }

  dueAt(i: number): DueStroke {
    return this.due[i];
  }

  private emit(slot: number, inSec: number, velocity: number, hour: boolean): void {
    let d = this.due[this.dueCount];
    if (!d) {
      d = { slot, inSec, velocity, hour };
      this.due.push(d);
    } else {
      d.slot = slot;
      d.inSec = inSec;
      d.velocity = velocity;
      d.hour = hour;
    }
    this.dueCount++;
  }

  private gap(): number {
    const [a, b] = BELL_PATTERN.phraseGapSec;
    return a + (b - a) * this.rng();
  }

  private jitter(): number {
    return (this.rng() * 2 - 1) * BELL_VARIATION.strokeJitterSec;
  }

  /** A background phrase of 2–4 strokes at t0, kept clear of the other churches. */
  private schedulePhrase(c: Church, t0: number): void {
    let t = t0;
    for (const o of this.churches) {
      if (o === c || o.silenced) continue;
      if (Math.abs(t - o.lastPhraseAt) < BELL_PATTERN.churchOffsetSec) t = o.lastPhraseAt + BELL_PATTERN.churchOffsetSec;
    }
    if (t > t0 + 1e-9) {
      // Too close to the other church: wait for the gap instead of crowding it.
      c.nextPhraseAt = t;
      return;
    }
    const span = BELL_PATTERN.phraseStrokesMax - BELL_PATTERN.phraseStrokesMin + 1;
    const n = BELL_PATTERN.phraseStrokesMin + Math.min(span - 1, Math.floor(this.rng() * span));
    for (let i = 0; i < n; i++) {
      const v = i === 0 ? 1 : BELL_PATTERN.laterVelocity + (this.rng() * 2 - 1) * BELL_PATTERN.laterVelocityJitter;
      c.queue.push({ t: t + i * c.strokeSec + (i === 0 ? 0 : this.jitter()), velocity: v, hour: false });
    }
    c.lastPhraseAt = t;
    c.busyUntil = t + (n - 1) * c.strokeSec;
    c.nextPhraseAt = c.busyUntil + this.gap();
  }

  /** The hour's strokes, after whatever is still sounding (at least two stroke gaps after a phrase). */
  private scheduleHour(c: Church, now: number): void {
    if (c.queue.length > 0) return; // a phrase is still striking: tick() retries when it is done
    const t0 = Math.max(now, c.busyUntil + HOUR_GAP_STROKES * c.strokeSec);
    for (let i = 0; i < this.hourStrokes; i++) {
      const v = 0.95 + (this.rng() * 2 - 1) * 0.03;
      c.queue.push({ t: t0 + i * c.strokeSec + (i === 0 ? 0 : this.jitter()), velocity: v, hour: true });
    }
    c.hourPending = false;
    c.hourDone = true;
    c.hourActive = true;
    c.busyUntil = t0 + (this.hourStrokes - 1) * c.strokeSec;
    c.nextPhraseAt = Math.max(c.nextPhraseAt, c.busyUntil + this.gap());
  }
}

// =================================================================================================
// The driver
// =================================================================================================

/** What the driver reads of the physics world (PhysicsWorld, duck-typed). */
interface BodyList {
  readonly bodies: readonly AudioBodyView[];
  readonly structureVersion: number;
}
const hasBodyList = (p: unknown): p is BodyList =>
  typeof p === 'object' && p !== null && Array.isArray((p as Partial<BodyList>).bodies) && typeof (p as Partial<BodyList>).structureVersion === 'number';

interface Tower {
  readonly placement: number;
  readonly voicing: BellVoicingId;
  readonly scale: number;
  x: number;
  y: number;
  z: number;
  /** Course arc length of the church. */
  s: number;
  body: AudioBodyView | null;
  standing: boolean;
  silencedAt: number | null;
  lastShakeT0: number;
  shiverReadyAt: number;
  nextStrikeAt: number | null;
}

interface Ringing {
  slot: number;
  voice: PositionalVoice;
}

export interface BellDriverOptions {
  readonly hourStrokes: number;
  /** The context clock (AudioManager.now). */
  readonly now: () => number;
  /** Story: a church fell silent (the music lowers for it). */
  readonly onSilenced?: (placement: number) => void;
}

export class BellDriver {
  readonly scheduler: BellScheduler;
  readonly towers: Tower[];
  private readonly ringing: Ringing[] = [];
  private readonly clanks: { slot: number; at: number }[] = [];
  private readonly bodies: BodyList | null;
  private structureVersion = -1;
  private pollClock = Infinity;
  private reportClock = Infinity;
  /** The bridge's frame number (from the ring each frame), so bell trace entries line up with plays. */
  private traceFrame = 0;
  private reportKey = '';
  /** What each church was waiting for at the last tick (to trace each wait once, and its end). */
  private waiting: ('phrase' | 'hour' | null)[] = [];
  private readonly pose: ListenerPose = { px: 0, py: 0, pz: 0, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: -1 };
  private readonly proj: CourseProjection = { s: 0, sExt: 0, d: 0 };
  private readonly at: CourseSample = { s: 0, x: 0, z: 0, dirX: 0, dirZ: 1, floor: 0, halfWidth: 0 };
  /** Can the listener hear church `slot` (built once: tick() calls it every frame). */
  private readonly inRange = (slot: number): boolean => {
    const t = this.towers[slot];
    return distanceTo(this.pose, t.x, t.y, t.z) <= SPATIAL.bells.maxM;
  };

  /** Strokes of the approach hour (the mode's mix: three in Arcade, six in Story). */
  get hourStrokes(): number {
    return this.options.hourStrokes;
  }

  constructor(
    private readonly rt: GameRuntime,
    private readonly session: SessionAudio,
    private readonly options: BellDriverOptions,
  ) {
    const churches = churchesOf(rt.level);
    this.towers = churches.map((c) => {
      const p = rt.level.obstacles[c.placement];
      const w = rt.terrain.course.toWorld(p.s, p.d);
      return {
        placement: c.placement,
        voicing: c.voicing,
        scale: c.scale,
        x: w.x,
        y: w.y + BELL_PATTERN.belfryM * c.scale,
        z: w.z,
        s: p.s,
        body: null,
        standing: true,
        silencedAt: null,
        lastShakeT0: 0,
        shiverReadyAt: 0,
        nextStrikeAt: null,
      };
    });
    this.scheduler = new BellScheduler(
      this.towers.map((t) => t.voicing),
      options.hourStrokes,
      session.rng('bells'),
      (slot) => session.bellReady(this.towers[slot].voicing),
    );
    this.waiting = this.towers.map(() => null);
    this.bodies = hasBodyList(rt.physics) ? rt.physics : null;
    this.findTowers();
  }

  /** Read the frame's events before the resolver clears them: a tower body that broke goes silent now. */
  observe(ring: EventRing): void {
    this.traceFrame = ring.frame;
    if (this.towers.length === 0) return;
    for (let i = 0; i < ring.count; i++) {
      const q = ring.slots[i];
      if (q.type !== 'obstacleBroken' || q.kind !== 'church') continue;
      for (let k = 0; k < this.towers.length; k++) {
        const t = this.towers[k];
        if (t.body !== null && t.body.id === q.obstacleId && t.standing) this.silence(k);
      }
    }
  }

  /**
   * One frame: session time, whether the run is in play (the hour strikes only then), the listener.
   * Strokes are scheduled every frame (lookahead 0.25 s); voices, towers and the report at 10 / 2 Hz.
   */
  frame(dt: number, playing: boolean, pose: Readonly<ListenerPose>, loading: boolean): void {
    if (this.towers.length === 0 || loading) return;
    const now = this.rt.time;
    this.pollClock += dt;
    this.reportClock += dt;
    const poll = this.pollClock >= 1 / BELL_HZ - 1e-6;
    if (poll) {
      this.pollClock = 0;
      this.findTowers();
      this.pollTowers(now, pose);
      if (playing) this.approach(now);
    }
    Object.assign(this.pose, pose);
    this.scheduler.tick(now, this.inRange);
    if (this.session.tracing) this.traceWaits(now);
    const ctx = this.options.now();
    for (let i = 0; i < this.scheduler.dueStrokes; i++) {
      const d = this.scheduler.dueAt(i);
      this.strike(d.slot, 'strike', ctx + Math.max(0.005, d.inSec), d.velocity, pose);
    }
    for (let i = this.clanks.length - 1; i >= 0; i--) {
      const c = this.clanks[i];
      if (now < c.at) continue;
      this.clanks.splice(i, 1);
      this.strike(c.slot, 'clank', ctx + 0.005, dbToGain(BELL_PATTERN.clankDb), pose);
    }
    if (poll) this.updateVoices(ctx, pose);
    if (this.reportClock >= 1 / REPORT_HZ - 1e-6) {
      this.reportClock = 0;
      this.report();
    }
  }

  private strike(slot: number, form: BellForm, when: number, velocity: number, pose: Readonly<ListenerPose>): void {
    const t = this.towers[slot];
    const d = distanceTo(pose, t.x, t.y, t.z);
    if (d > SPATIAL.bells.maxM) return;
    const voice = this.session.playBell({
      slot,
      voicing: t.voicing,
      form,
      when,
      velocity,
      gainLin: dbToGain(BELL_PATTERN.strikeDbAt40m) * distanceGain(d, SPATIAL.bells),
      lowpassHz: Math.min(form === 'clank' ? 2500 : 16000, airLowpassHz(d, SPATIAL.bells.refM)),
      pan: panFor(pose, t.x, t.z, SPATIAL.bells.panLimit),
    });
    if (voice && form !== 'clank') this.ringing.push({ slot, voice });
  }

  /** Bodies are scanned once, and again whenever the world's structure changes. */
  private findTowers(): void {
    const w = this.bodies;
    if (!w || w.structureVersion === this.structureVersion) return;
    this.structureVersion = w.structureVersion;
    for (const t of this.towers) {
      if (t.body !== null) continue;
      const b = w.bodies.find((x) => x.kind === ('church' satisfies ObstacleKind) && x.part === 'churchTower' && x.placement === t.placement);
      if (!b) continue;
      t.body = b;
      t.x = b.spawn.x;
      t.y = b.spawn.y + BELL_PATTERN.belfryM * t.scale;
      t.z = b.spawn.z;
      t.lastShakeT0 = b.shake.t0;
    }
  }

  private pollTowers(now: number, pose: Readonly<ListenerPose>): void {
    for (let k = 0; k < this.towers.length; k++) {
      const t = this.towers[k];
      const b = t.body;
      if (!b || !t.standing) continue;
      if (!towerStanding(b)) {
        this.silence(k);
        continue;
      }
      // Struck but standing: the bell resonates with the blow (no clapper), once per cooldown.
      if (b.shake.t0 !== t.lastShakeT0) {
        t.lastShakeT0 = b.shake.t0;
        if (b.shake.amp >= BELL_PATTERN.shiverFromAmp && now >= t.shiverReadyAt) {
          t.shiverReadyAt = now + BELL_PATTERN.shiverCooldownSec;
          this.strike(k, 'shiver', this.options.now() + 0.005, Math.min(SHIVER_MAX_GAIN, 0.25 + 0.5 * b.shake.amp), pose);
        }
      }
    }
  }

  /** The hour: when the iceberg is due at the church within the hour's length (radius 120–600 m). */
  private approach(now: number): void {
    const ice = this.rt.iceberg;
    const terrain = this.rt.terrain;
    let s: number;
    let c: CourseSample;
    if (isGeneratedTerrain(terrain)) {
      s = terrain.course.projectInto(ice.pos.x, ice.pos.z, this.proj).s;
      c = terrain.course.sampleInto(s, this.at);
    } else {
      s = terrain.course.project(ice.pos.x, ice.pos.z).s;
      c = terrain.course.sampleAt(s);
    }
    const v = Math.max(1, ice.vel.x * c.dirX + ice.vel.z * c.dirZ);
    for (let k = 0; k < this.towers.length; k++) {
      const t = this.towers[k];
      const ch = this.scheduler.churches[k];
      if (!t.standing || ch.hourDone) continue;
      const ds = t.s - s;
      if (ds < 0) {
        this.scheduler.passed(k);
        continue;
      }
      const radius = Math.min(BELL_PATTERN.hourRadiusM[1], Math.max(BELL_PATTERN.hourRadiusM[0], v * this.scheduler.hourLeadSec(k, now)));
      this.scheduler.setApproaching(k, ds <= APPROACH_HOLD * radius);
      if (ds <= radius) {
        // Traced once, when the hour is asked for: while a phrase finishes it stays pending (and
        // this branch runs every frame until it is scheduled).
        const first = !ch.hourPending;
        this.scheduler.startHour(k, now);
        if (first && this.session.tracing) this.note(`bell-hour p${t.placement} ${t.voicing} strokes=${this.options.hourStrokes} ds=${ds.toFixed(0)}m`);
      }
    }
  }

  /** `bell-deferred` when a phrase or the hour starts waiting for its strike, `bell-ready` when it stops. */
  private traceWaits(now: number): void {
    const churches = this.scheduler.churches;
    for (let k = 0; k < churches.length; k++) {
      const c = churches[k];
      const was = this.waiting[k];
      if (c.deferred === was) continue;
      const t = this.towers[k];
      if (c.deferred !== null) this.note(`bell-deferred p${t.placement} ${t.voicing} ${c.deferred} (strike not baked)`);
      else if (was !== null) this.note(`bell-ready p${t.placement} ${t.voicing} after ${(now - c.deferredSince).toFixed(1)} s`);
      this.waiting[k] = c.deferred;
    }
  }

  private silence(k: number): void {
    const t = this.towers[k];
    if (!t.standing) return;
    t.standing = false;
    const now = this.rt.time;
    t.silencedAt = now;
    const ch = this.scheduler.churches[k];
    const strikes = ch.hourActive ? ch.hourStrikes : ch.strikes;
    this.scheduler.silence(k);
    for (let i = this.ringing.length - 1; i >= 0; i--) {
      if (this.ringing[i].slot !== k) continue;
      this.ringing[i].voice.choke(BELL_PATTERN.chokeTauSec);
      this.ringing.splice(i, 1);
    }
    this.clanks.push({ slot: k, at: now + BELL_PATTERN.clankDelaySec });
    if (this.session.tracing) this.note(`bell-silenced p${t.placement} strikes=${strikes}${ch.hourActive ? ' (mid-hour)' : ''}`);
    this.options.onSilenced?.(t.placement);
  }

  private updateVoices(ctx: number, pose: Readonly<ListenerPose>): void {
    for (let i = this.ringing.length - 1; i >= 0; i--) {
      const r = this.ringing[i];
      if (r.voice.endsAt < ctx) {
        this.ringing.splice(i, 1);
        continue;
      }
      const t = this.towers[r.slot];
      const d = distanceTo(pose, t.x, t.y, t.z);
      r.voice.update(
        dbToGain(BELL_PATTERN.strikeDbAt40m) * (d > SPATIAL.bells.maxM ? 0 : distanceGain(d, SPATIAL.bells)),
        airLowpassHz(d, SPATIAL.bells.refM),
        panFor(pose, t.x, t.z, SPATIAL.bells.panLimit),
      );
    }
  }

  private report(): void {
    const sch = this.scheduler;
    const bells: AudioState['bells'] = this.towers.map((t, k) => {
      const c = sch.churches[k];
      return {
        placement: t.placement,
        voicing: t.voicing,
        standing: t.standing,
        strikes: c.strikes,
        nextStrikeAt: c.queue.length > 0 ? c.queue[0].t : t.standing ? c.nextPhraseAt : null,
        silencedAt: t.silencedAt,
      };
    });
    const key = bells.map((b) => `${b.placement}:${b.standing}:${b.strikes}`).join('|');
    if (key === this.reportKey) return;
    this.reportKey = key;
    this.session.reportBells(bells);
  }

  private note(note: string): void {
    this.session.trace({ seq: 0, t: this.options.now(), gt: this.rt.time, token: this.session.token, frame: this.traceFrame, kind: 'bell', cause: -1, note });
  }
}
