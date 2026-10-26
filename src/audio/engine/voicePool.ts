/**
 * The effect voice pool (DESIGN §2.4 steps 3–5, §6.5, §6.6): admission, caps, stealing, shuffle bags,
 * jitter and density compensation, on strips built once (./strips.ts). It runs on any
 * BaseAudioContext, the live one or the lab's OfflineAudioContext, and its only clock is
 * ctx.currentTime, so tests drive it with the fake context's advance().
 *
 * Admission order for one request (each refusal is a DropReason, traced by the caller):
 *   1. frameCap   at most 4 requests per animation frame (per session);
 *   2. culled     beyond SPATIAL.effects.maxM;
 *   3. rate       the global bucket (voices, 40/s, burst 12) and the family bucket (requests);
 *                 a P0 request may take the global bucket into a small debt (one request's layers),
 *                 so a structural failure is never refused because minor hits spent the tokens;
 *   4. perKey     the family's minimum interval per obstacle or placement;
 *   5. busy       at >= 12 active voices only P0–P2 are admitted, and optional layers are dropped;
 *   6. notReady   no layer's buffer is baked yet (silence, never a glitch);
 *   7. cap        family and global voice caps: a voice whose loudness·priority score is more than
 *                 1.5x the quietest active voice's takes over its slot (that voice fades in 25 ms on
 *                 its own strip); a P0 voice is only ever stolen by another P0.
 * Layers are kept in order of importance (non-optional first, then louder first) and trimmed from
 * the least important when tokens, caps or strips run short.
 */
import {
  AIR_LOWPASS,
  FAMILY_LIMITS,
  GLOBAL_LIMITS,
  PRIORITY_WEIGHT,
  SOUND_DEFS,
  SOUND_IDS,
  SPATIAL,
  VARIATION,
  type BellRequest,
  type DropReason,
  type ListenerPose,
  type PlayResult,
  type PositionalVoice,
  type Priority,
  type SoundBank,
  type SoundFamily,
  type SoundId,
  type SoundRequest,
} from '../contract';
import { dbToGain } from '../ducks';
import { signed } from '../rng';
import { createSpatialOut, spatialize } from '../spatial';
import { FrameCap, PerKeyLimiter, RateLimits } from './limits';
import { createStrips, type Strip } from './strips';

/** What the pool reads from the bank. */
export type BufferLookup = Pick<SoundBank, 'buffer' | 'ready'>;

/** A request starts this long after "now", so its first sample is never in the past. */
export const START_LEAD_SEC = 0.005;
/** Extra time a strip stays reserved after its voice stops. */
const STRIP_MARGIN_SEC = 0.02;
/** A P0 request may take the global bucket this far below zero. */
const P0_DEBT = -GLOBAL_LIMITS.maxLayers;
/** Session end: voices are stopped this long after the fade starts (DESIGN §3). */
export const END_STOP_SEC = 0.15;

const dropResults = new Map<DropReason, PlayResult>();
/** Shared, frozen results for drops (no allocation on the refusal path). */
export function dropped(reason: DropReason): PlayResult {
  let r = dropResults.get(reason);
  if (!r) {
    r = Object.freeze({ started: 0, reason });
    dropResults.set(reason, r);
  }
  return r;
}

const SOUND_INDEX = Object.fromEntries(SOUND_IDS.map((id, i) => [id, i])) as Readonly<Record<SoundId, number>>;

/** Seconds of the loudness estimate's decay for a sound (a stealing score, not a measurement). */
const tauOf = (id: SoundId): number => Math.max(0.05, SOUND_DEFS[id].seconds / 6);

/**
 * Shuffle bags per sound: every variant plays once before any repeats, a refill never starts with the
 * variant that ended the previous bag, and the same variant never starts twice within 40 ms.
 */
export class ShuffleBags {
  private readonly bags = new Map<SoundId, { order: number[]; pos: number; last: number }>();
  /** Last start per (sound, variant), keyed by soundIndex·64 + variant (no string per lookup). */
  private readonly lastStart = new Map<number, number>();

  constructor(private readonly rng: () => number) {}

  /** The next variant (or the explicit one when free), or -1 when every variant started within 40 ms. */
  next(sound: SoundId, variants: number, when: number, explicit = -1): number {
    if (explicit >= 0) {
      const v = explicit % Math.max(1, variants);
      if (!this.recent(sound, v, when)) return this.mark(sound, v, when);
    }
    if (variants <= 1) return this.recent(sound, 0, when) ? -1 : this.mark(sound, 0, when);
    let bag = this.bags.get(sound);
    if (!bag) {
      bag = { order: [], pos: 0, last: -1 };
      this.bags.set(sound, bag);
    }
    for (let pass = 0; pass < 2; pass++) {
      if (bag.pos >= bag.order.length) this.refill(bag, variants);
      for (let j = bag.pos; j < bag.order.length; j++) {
        const v = bag.order[j];
        if (this.recent(sound, v, when)) continue;
        bag.order[j] = bag.order[bag.pos];
        bag.order[bag.pos] = v;
        bag.pos++;
        bag.last = v;
        return this.mark(sound, v, when);
      }
      if (bag.pos < bag.order.length) return -1; // the rest of this bag all just started
    }
    return -1;
  }

  private refill(bag: { order: number[]; pos: number; last: number }, n: number): void {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order[0] === bag.last) {
      const j = 1 + Math.floor(this.rng() * (n - 1));
      [order[0], order[j]] = [order[j], order[0]];
    }
    bag.order = order;
    bag.pos = 0;
  }

  private recent(sound: SoundId, v: number, when: number): boolean {
    const t = this.lastStart.get(SOUND_INDEX[sound] * 64 + v);
    return t !== undefined && Math.abs(when - t) < GLOBAL_LIMITS.sameVariantSec;
  }

  private mark(sound: SoundId, v: number, when: number): number {
    this.lastStart.set(SOUND_INDEX[sound] * 64 + v, when);
    return v;
  }
}

/** Per-session admission state (one per SessionAudio, and one for the lab). */
export class VoiceSession {
  readonly bags: ShuffleBags;
  readonly perKey = new PerKeyLimiter();
  readonly frame = new FrameCap();
  /** Effects strips' space send for this session's act (ChapterMix.spaceSend). */
  spaceSend = 0.1;

  constructor(
    readonly token: number,
    /** The 'sfx' stream: variants and jitter. */
    readonly rng: () => number,
    readonly pose: ListenerPose,
  ) {
    this.bags = new ShuffleBags(rng);
  }
}

/** What one play() did, written into a reused object for the trace (no allocation). */
export interface PlayDetail {
  count: number;
  readonly layer: Int8Array;
  readonly variant: Int16Array;
  readonly gainDb: Float64Array;
  readonly rate: Float64Array;
  readonly lowpassHz: Float64Array;
  readonly when: Float64Array;
  pan: number;
  distM: number;
  /** Active effect voices after the request. */
  active: number;
  stole: number;
  trimmed: number;
}

export function createPlayDetail(): PlayDetail {
  const n = GLOBAL_LIMITS.maxLayers;
  return {
    count: 0,
    layer: new Int8Array(n),
    variant: new Int16Array(n),
    gainDb: new Float64Array(n),
    rate: new Float64Array(n),
    lowpassHz: new Float64Array(n),
    when: new Float64Array(n),
    pan: 0,
    distM: 0,
    active: 0,
    stole: 0,
    trimmed: 0,
  };
}

export interface PoolVoice {
  readonly strip: Strip;
  readonly family: SoundFamily;
  readonly priority: Priority;
  readonly sound: SoundId;
  readonly variant: number;
  /** Linear gain it started at (after jitter, distance and density). */
  readonly gain: number;
  readonly startAt: number;
  readonly endAt: number;
  readonly tau: number;
  readonly token: number;
  readonly source: AudioBufferSourceNode;
  /** Set when stolen or ended by its session: the time it stops sounding. */
  stopAt: number | null;
}

export class EffectVoices {
  readonly strips: Strip[];
  readonly limits: RateLimits;
  /** Jitter and shuffled variants on (the lab switches them off for identical renders). */
  variation = true;
  /** Most effect voices ever sounding at once. */
  peak = 0;
  private voices: PoolVoice[] = [];
  private readonly sp = createSpatialOut();
  /** Scratch for one request (no allocation): layer order, reserved strips, chosen layers. */
  private readonly order = new Int8Array(GLOBAL_LIMITS.maxLayers);
  private readonly reserved: (Strip | null)[] = new Array<Strip | null>(GLOBAL_LIMITS.maxLayers).fill(null);
  private readonly chosen = new Int8Array(GLOBAL_LIMITS.maxLayers);

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    sendOut: AudioNode,
    private readonly bank: () => BufferLookup | null,
    strips: number = GLOBAL_LIMITS.effectStrips,
  ) {
    this.strips = createStrips(ctx, strips, out, sendOut);
    this.limits = new RateLimits(ctx.currentTime);
  }

  play(req: SoundRequest, s: VoiceSession, d: PlayDetail): PlayResult {
    const now = this.ctx.currentTime;
    d.count = 0;
    d.stole = 0;
    d.trimmed = 0;
    d.pan = 0;
    d.distM = 0;
    this.reap(now);
    d.active = this.active(now);
    if (s.frame.full) return dropped('frameCap');
    const nLayers = Math.min(req.layerCount, GLOBAL_LIMITS.maxLayers, req.layers.length);
    if (!(nLayers > 0)) return dropped('quiet');

    let distGain = 1;
    let airHz: number = AIR_LOWPASS.hzAtRef;
    let pan = 0;
    if (req.positional) {
      spatialize(s.pose, req.x, req.y, req.z, SPATIAL.effects, this.sp);
      d.distM = this.sp.distM;
      if (this.sp.culled) return dropped('culled');
      distGain = this.sp.gain;
      airHz = this.sp.lowpassHz;
      pan = this.sp.pan;
    }

    const p0 = req.priority === 0;
    const tokens = this.limits.global.available(now);
    if (tokens < 1 && !(p0 && tokens > P0_DEBT)) return dropped('rate');
    const famBucket = this.limits.family(req.family);
    if (famBucket.available(now) < 1) return dropped('rate');
    const fl = FAMILY_LIMITS[req.family];
    if (!s.perKey.allowed(req.family, req.key, fl.perKeySec, now)) return dropped('perKey');

    const busy = d.active >= GLOBAL_LIMITS.busyVoices;
    if (busy && req.priority > 2) return dropped('busy');

    // Candidate layers: optional ones go when busy; unbaked ones are skipped.
    const bank = this.bank();
    let cand = 0;
    let skippedOptional = false;
    for (let i = 0; i < nLayers; i++) {
      const layer = req.layers[i];
      if (busy && layer.optional) {
        skippedOptional = true;
        continue;
      }
      if (bank === null || !bank.ready(layer.sound)) continue;
      this.order[cand++] = i;
    }
    if (cand === 0) return dropped(skippedOptional && bank !== null ? 'busy' : 'notReady');
    // Most important first: non-optional before optional, then louder before quieter.
    for (let i = 1; i < cand; i++) {
      const x = this.order[i];
      let j = i - 1;
      while (j >= 0 && this.lessImportant(req, this.order[j], x)) {
        this.order[j + 1] = this.order[j];
        j--;
      }
      this.order[j + 1] = x;
    }

    let newScore = 0;
    for (let k = 0; k < cand; k++) newScore = Math.max(newScore, dbToGain(req.layers[this.order[k]].gainDb) * distGain);
    newScore *= PRIORITY_WEIGHT[req.priority];

    const maxStart = p0 ? cand : Math.min(cand, Math.floor(tokens));
    const famBefore = this.familyActive(req.family, now);
    let famActive = famBefore;
    let globalActive = d.active;
    let n = 0;
    for (let k = 0; k < maxStart; k++) {
      const strip = this.freeStrip(now, n);
      if (strip === null) break;
      let ok = true;
      while (famActive >= fl.maxVoices || globalActive >= GLOBAL_LIMITS.maxEffectVoices) {
        const familyFull = famActive >= fl.maxVoices;
        const v = this.victim(familyFull ? req.family : null, req.priority, newScore, now);
        if (v === null) {
          ok = false;
          break;
        }
        this.steal(v, now);
        d.stole++;
        if (v.family === req.family) famActive--;
        globalActive--;
      }
      if (!ok) break;
      this.reserved[n] = strip;
      this.chosen[n] = this.order[k];
      n++;
      famActive++;
      globalActive++;
    }
    if (n === 0) return dropped('cap');
    d.trimmed = cand - n;

    // Admitted: spend the limits.
    s.frame.admit();
    this.limits.global.take(n, now, p0 ? P0_DEBT : 0);
    famBucket.take(1, now);
    s.perKey.record(req.family, req.key, now);

    const density = 1 / Math.sqrt(1 + GLOBAL_LIMITS.densityK * famBefore);
    const vr = VARIATION[req.family];
    const jit = this.variation;
    const panJ = jit ? signed(s.rng) * vr.pan : 0;
    d.pan = Math.max(-1, Math.min(1, pan + panJ));
    const base = now + START_LEAD_SEC + Math.max(0, req.startDelaySec);
    const send = req.send !== undefined && Number.isFinite(req.send) ? Math.max(0, Math.min(1, req.send)) : s.spaceSend;
    let started = 0;
    let variantsBusy = false;
    for (let c = 0; c < n; c++) {
      const li = this.chosen[c];
      const layer = req.layers[li];
      const strip = this.reserved[c]!;
      this.reserved[c] = null;
      const def = SOUND_DEFS[layer.sound];
      const delay = Math.max(0, layer.delaySec);
      const when = Math.max(now, base + delay + (jit && delay > 0 ? (signed(s.rng) * vr.layerMs) / 1000 : 0));
      const variant = jit ? s.bags.next(layer.sound, def.variants, when, layer.variant) : Math.max(0, layer.variant) % def.variants;
      if (variant < 0) {
        variantsBusy = true;
        continue;
      }
      const buf = bank!.buffer(layer.sound, variant);
      if (buf === null) continue;
      const gDb = layer.gainDb + (jit ? signed(s.rng) * vr.gainDb : 0);
      const gain = dbToGain(gDb) * distGain * density;
      const rate = Math.max(0.05, layer.rate) * (jit ? Math.pow(2, (signed(s.rng) * vr.rateCents) / 1200) : 1);
      const lp = Math.min(layer.lowpassHz * (jit ? 1 + (signed(s.rng) * vr.lowpassPct) / 100 : 1), airHz);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      strip.prepare(now, gain, lp, d.pan, send);
      src.connect(strip.gain);
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          // already disconnected
        }
      };
      src.start(when);
      const endAt = when + buf.duration / rate;
      strip.busyUntil = endAt + STRIP_MARGIN_SEC;
      this.voices.push({
        strip,
        family: req.family,
        priority: req.priority,
        sound: layer.sound,
        variant,
        gain,
        startAt: when,
        endAt,
        tau: tauOf(layer.sound),
        token: s.token,
        source: src,
        stopAt: null,
      });
      d.layer[started] = li;
      d.variant[started] = variant;
      d.gainDb[started] = 20 * Math.log10(Math.max(1e-12, gain));
      d.rate[started] = rate;
      d.lowpassHz[started] = lp;
      d.when[started] = when;
      started++;
    }
    d.count = started;
    d.active = this.active(now);
    this.peak = Math.max(this.peak, d.active);
    // Every chosen layer's variants had just started (40 ms rule), or a buffer vanished mid-request.
    if (started === 0) return dropped(variantsBusy ? 'cap' : 'notReady');
    return { started, reason: null };
  }

  /**
   * Play one buffer outside the request path (the bell clank, the lab's fire()): no rate limits, but
   * the caps and stealing still apply. Returns the voice, or null.
   */
  playRaw(
    buffer: AudioBuffer,
    o: { token: number; family: SoundFamily; priority: Priority; sound: SoundId; when: number; gain: number; lowpassHz: number; pan: number; send: number; rate?: number },
  ): PoolVoice | null {
    const now = this.ctx.currentTime;
    this.reap(now);
    const strip = this.freeStrip(now, 0);
    if (strip === null) return null;
    if (this.active(now) >= GLOBAL_LIMITS.maxEffectVoices) {
      const v = this.victim(null, o.priority, o.gain * PRIORITY_WEIGHT[o.priority], now);
      if (v === null) return null;
      this.steal(v, now);
    }
    const rate = o.rate ?? 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    strip.prepare(now, o.gain, o.lowpassHz, o.pan, o.send);
    src.connect(strip.gain);
    src.onended = () => {
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
    };
    const when = Math.max(now, o.when);
    src.start(when);
    const endAt = when + buffer.duration / rate;
    strip.busyUntil = endAt + STRIP_MARGIN_SEC;
    const v: PoolVoice = {
      strip,
      family: o.family,
      priority: o.priority,
      sound: o.sound,
      variant: 0,
      gain: o.gain,
      startAt: when,
      endAt,
      tau: tauOf(o.sound),
      token: o.token,
      source: src,
      stopAt: null,
    };
    this.voices.push(v);
    this.peak = Math.max(this.peak, this.active(now));
    return v;
  }

  /** Voices sounding or scheduled (not stolen, not ended). */
  active(now: number): number {
    let n = 0;
    for (const v of this.voices) if (v.stopAt === null && now < v.endAt) n++;
    return n;
  }

  familyActive(family: SoundFamily, now: number): number {
    let n = 0;
    for (const v of this.voices) if (v.family === family && v.stopAt === null && now < v.endAt) n++;
    return n;
  }

  byFamily(now: number): Partial<Record<SoundFamily, number>> {
    const out: Partial<Record<SoundFamily, number>> = {};
    for (const v of this.voices) if (v.stopAt === null && now < v.endAt) out[v.family] = (out[v.family] ?? 0) + 1;
    return out;
  }

  /** Voices of one session that have not stopped (tests and state()). */
  liveOf(token: number, now: number): number {
    let n = 0;
    for (const v of this.voices) if (v.token === token && (v.stopAt === null ? now < v.endAt : now < v.stopAt)) n++;
    return n;
  }

  /** Fade every voice of a session over fadeSec and stop it (session end). Returns how many. */
  endSession(token: number, fadeSec: number, now: number): number {
    let n = 0;
    const stopAt = now + Math.max(END_STOP_SEC, fadeSec + 0.03);
    for (const v of this.voices) {
      if (v.token !== token || v.stopAt !== null || now >= v.endAt) continue;
      v.strip.fadeOut(now, fadeSec);
      this.stopSource(v, stopAt);
      n++;
    }
    return n;
  }

  /** Stop everything at once (context closed, dispose). */
  stopAll(now: number): void {
    for (const v of this.voices) if (v.stopAt === null && now < v.endAt) this.stopSource(v, now);
  }

  dispose(): void {
    this.voices = [];
    for (const s of this.strips) s.disconnect();
  }

  private lessImportant(req: SoundRequest, a: number, b: number): boolean {
    const la = req.layers[a];
    const lb = req.layers[b];
    if (la.optional !== lb.optional) return la.optional;
    return la.gainDb < lb.gainDb;
  }

  private reap(now: number): void {
    let w = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const gone = (v.stopAt ?? v.endAt) + STRIP_MARGIN_SEC <= now;
      if (!gone) this.voices[w++] = v;
    }
    this.voices.length = w;
  }

  private freeStrip(now: number, reservedCount: number): Strip | null {
    outer: for (const s of this.strips) {
      if (s.busyUntil > now) continue;
      for (let i = 0; i < reservedCount; i++) if (this.reserved[i] === s) continue outer;
      return s;
    }
    return null;
  }

  private victim(family: SoundFamily | null, priority: Priority, newScore: number, now: number): PoolVoice | null {
    let best: PoolVoice | null = null;
    let bestScore = Infinity;
    for (const v of this.voices) {
      if (v.stopAt !== null || now >= v.endAt) continue;
      if (family !== null && v.family !== family) continue;
      if (v.priority === 0 && priority !== 0) continue;
      const age = Math.max(0, now - v.startAt);
      const score = v.gain * Math.exp(-age / v.tau) * PRIORITY_WEIGHT[v.priority];
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best !== null && newScore > GLOBAL_LIMITS.stealRatio * bestScore ? best : null;
  }

  private steal(v: PoolVoice, now: number): void {
    v.strip.fadeOut(now, GLOBAL_LIMITS.stealFadeSec);
    this.stopSource(v, now + GLOBAL_LIMITS.stealFadeSec + 0.005);
  }

  private stopSource(v: PoolVoice, at: number): void {
    v.stopAt = at;
    v.strip.busyUntil = at + STRIP_MARGIN_SEC;
    try {
      v.source.stop(at);
    } catch {
      // never started or already stopped
    }
  }
}

/**
 * Bell strikes and shivers (ambience bus, 4 strips, at most 2 ringing per church). A strike rings for
 * seconds, so the third of one church chokes that church's oldest, and a full set chokes the oldest.
 */
export class BellVoices {
  readonly strips: Strip[];
  private voices: { strip: Strip; slot: number; token: number; startAt: number; endAt: number; source: AudioBufferSourceNode; stopAt: number | null; gain: number }[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    sendOut: AudioNode,
    count: number = GLOBAL_LIMITS.bellStrips,
  ) {
    this.strips = createStrips(ctx, count, out, sendOut);
  }

  /** Start a bell buffer; `scale` multiplies every later update (velocity, voicing trim, jitter). */
  play(token: number, req: BellRequest, buffer: AudioBuffer, scale: number, rate: number, send: number): PositionalVoice | null {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => (v.stopAt ?? v.endAt) + STRIP_MARGIN_SEC > now);
    const ringing = this.voices.filter((v) => v.stopAt === null && now < v.endAt);
    const sameSlot = ringing.filter((v) => v.slot === req.slot);
    if (sameSlot.length >= 2) this.chokeVoice(sameSlot[0], now, 0.15);
    const strip = this.strips.find((s) => s.busyUntil <= now) ?? null;
    if (strip === null) {
      // Every strip still rings (or is still being choked): damp the oldest so the next strike has
      // room, and skip this one rather than cut a voice mid-sample. Never reached with <= 2 churches
      // a level and their phrases kept 20 s apart.
      const oldest = this.voices.filter((v) => v.stopAt === null).sort((a, b) => a.startAt - b.startAt)[0];
      if (oldest) this.chokeVoice(oldest, now, 0.05);
      return null;
    }
    const when = Math.max(now + START_LEAD_SEC, req.when);
    const gain = Math.max(0, req.gainLin) * scale;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    strip.prepare(now, gain, req.lowpassHz, req.pan, send);
    src.connect(strip.gain);
    src.onended = () => {
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
    };
    src.start(when);
    const endAt = when + buffer.duration / rate;
    strip.busyUntil = endAt + STRIP_MARGIN_SEC;
    const v = { strip, slot: req.slot, token, startAt: when, endAt, source: src, stopAt: null as number | null, gain };
    this.voices.push(v);
    const ctx = this.ctx;
    const choke = (tau: number): void => this.chokeVoice(v, ctx.currentTime, tau);
    return {
      endsAt: endAt,
      update(gainLin: number, lowpassHz: number, pan: number): void {
        if (v.stopAt !== null) return;
        v.gain = Math.max(0, gainLin) * scale;
        strip.glide(ctx.currentTime, v.gain, lowpassHz, pan, 0.05);
      },
      choke,
    };
  }

  active(now: number): number {
    return this.voices.filter((v) => v.stopAt === null && now < v.endAt).length;
  }

  endSession(token: number, fadeSec: number, now: number): void {
    const stopAt = now + Math.max(END_STOP_SEC, fadeSec + 0.03);
    for (const v of this.voices) {
      if (v.token !== token || v.stopAt !== null || now >= v.endAt) continue;
      v.strip.fadeOut(now, fadeSec);
      v.stopAt = stopAt;
      v.strip.busyUntil = stopAt + STRIP_MARGIN_SEC;
      try {
        v.source.stop(stopAt);
      } catch {
        // already stopped
      }
    }
  }

  liveOf(token: number, now: number): number {
    return this.voices.filter((v) => v.token === token && (v.stopAt === null ? now < v.endAt : now < v.stopAt)).length;
  }

  dispose(): void {
    this.voices = [];
    for (const s of this.strips) s.disconnect();
  }

  private chokeVoice(v: { strip: Strip; stopAt: number | null; endAt: number; source: AudioBufferSourceNode }, now: number, tau: number): void {
    if (v.stopAt !== null || now >= v.endAt) return;
    v.strip.choke(now, tau);
    const at = now + Math.max(0.02, tau * 7);
    v.stopAt = at;
    v.strip.busyUntil = at + STRIP_MARGIN_SEC;
    try {
      v.source.stop(at);
    } catch {
      // already stopped
    }
  }
}
