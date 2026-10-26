/**
 * The sound bank (docs/AUDIO_DESIGN.md §6.1): bakes every buffer the engine plays, in short slices,
 * in priority order, and hands them out as AudioBuffers once a context is attached. The order (after
 * the integrated smoke run, where a level's bell was still unbaked a minute into play):
 *
 *   1. the level's bell strikes, and the motif a chapter card plays (both are needed first and are
 *      small or few: a strike is 70-80 ms of work); then the level's own collision sounds (a car's
 *      panel, a wagon, masonry, a barrier's scatter, an ice field's absorb: about 60 ms of work in all,
 *      and the first collisions of a run come seconds into play, long before its first collapse;
 *      measured in Chrome, Power Valley's first panel hits were still dropped as notReady when they
 *      baked last of the set);
 *   2. the core sounds, St Bride's strike first (it is kept with the core for the Settings preview);
 *   3. the rest of the level set's sounds, structural failures (priority 0) first;
 *   4. the bells' shiver and clank;
 *   5. the other motifs (they play after a run).
 *
 * A motif a moment waits for (or comes next with) goes ahead of all of these (prioritize: the engine's
 * awaitMotif) until it is baked; a bake in progress is set aside and resumed after it (a recipe's
 * generator holds its own state, so the result is the same sample for sample). The request is kept by
 * key, so an entry dropped and asked for again (a new level set) keeps its priority; null puts the
 * motif back in its place, and a bake of it in progress is set aside too, so the queue's own order
 * resumes before the rest of it.
 *
 * Motifs off the main thread: given a MotifRenderer (the browser's Web Worker, motifRenderer.ts), the
 * bank sends it the set's motifs one at a time, in the same order (the awaited one first), as soon as
 * the set is asked for, and only wraps what comes back. A chapter card's motif is the exception: it
 * bakes here with the strikes, as it always did. It is due 1.2 s after the card opens, often seconds
 * after the page loads, and costs about 0.2 s of work. A worker's first answer includes the worker's
 * own start, and on a machine with few cores it competes for one: on two cores the card's motif took
 * 3.1 s to come back from the worker during a page load and was missed in one run of four
 * (docs/evidence/AUDIO_RUNS.md, "Slow computers").
 * The long motifs, needed after a run, are the worker's. Where there is no renderer, or it fails, every
 * motif bakes here in slices like everything else. Same code, same seed: the samples (and the
 * checksum) are identical either way.
 *
 * - Slicing: work runs through the injected SliceScheduler until its deadline, one recipe step at a
 *   time (a step is at most a few milliseconds); it asks for another slice while work remains. In the
 *   browser the slices are paced by what is on screen (pacedScheduler, below).
 * - Baking needs no AudioContext: a level set asked for on a menu bakes before the first gesture, and
 *   the buffers are wrapped once a context is attached.
 * - Memory: PCM is held only until a context is attached; then it is wrapped into an AudioBuffer once
 *   and freed. A new level set replaces the previous one (core stays); releaseLevel frees it.
 * - Never a glitch: buffer() returns null until every variant of a sound is baked (the engine drops
 *   the request as notReady), a cut sound is never baked, and a bake that throws is logged once and
 *   left out.
 * - Determinism: every buffer's seed is hash(SEED, id, variant), and stats().checksum is FNV-1a over
 *   every baked sample (as Int16), combined in key order, so two banks agree whatever order they baked in.
 */
import {
  BELL_BAKE,
  CARD_MOTIF,
  FELT_PIANO,
  SOUND_DEFS,
  SOUND_IDS,
  type BakeJob,
  type BakedPcm,
  type BankStats,
  type BellForm,
  type BellVoicingId,
  type CreateSoundBank,
  type LevelSoundSet,
  type MotifRequest,
  type SliceScheduler,
  type SoundBank,
  type SoundFamily,
  type SoundId,
} from '../contract';
import { bakeBellSteps } from './bell';
import { pcmHash } from './dsp';
import type { MotifRender, MotifRenderer } from './motifRenderer';
import { motifTimeline, renderMotifSteps } from './piano';
import { bakeSteps, bakeable } from './recipes';

export { pcmHash };

export const BELL_FORMS: readonly BellForm[] = ['strike', 'shiver', 'clank'];

/** Bake order: lower first (see the header). */
const GROUP = { first: 0, core: 1, level: 2, bells: 3, motifs: 4 } as const;
/** The rank of the motif a moment waits for (prioritize): ahead of every group. */
const AWAITED_RANK = -1;
type Group = keyof typeof GROUP;

/**
 * The bell strike kept with the core (Settings' Ambience preview plays it, so it must be there from a
 * cold start); the reference voicing, also the default for an unnamed church.
 */
export const PREVIEW_BELL: BellVoicingId = 'st-brides';

/**
 * A level's collision sounds (hits, a stone barrier's scatter, an ice field's absorb): about 60 ms of
 * work for a whole level, needed from the first seconds of play, so baked right after the strikes.
 */
const EARLY_FAMILIES: ReadonlySet<SoundFamily> = new Set<SoundFamily>(['hit', 'scatter', 'absorb']);

/** Motifs a chapter card plays within seconds of opening: baked with the strikes, ahead of the rest. */
const CARD_VARIANTS: ReadonlySet<string> = new Set(Object.values(CARD_MOTIF));

const soundKey = (id: SoundId, v: number): string => `s:${id}#${v}`;
const bellKey = (voicing: BellVoicingId, form: BellForm): string => `b:${voicing}:${form}`;
export const motifKey = (m: MotifRequest): string => `m:${m.variant}@${Math.round(m.tempoScale * 1000) / 1000}`;

// -------------------------------------------------------------------------------------------------
// Byte arithmetic (Float32 PCM, from the definitions; the budget test checks these)
// -------------------------------------------------------------------------------------------------

export const soundBytes = (id: SoundId): number =>
  bakeable(id) ? SOUND_DEFS[id].variants * Math.round(SOUND_DEFS[id].seconds * SOUND_DEFS[id].sampleRate) * 4 : 0;
export const bellStrikeBytes = (): number => Math.round(BELL_BAKE.strikeSec * BELL_BAKE.sampleRate) * 4;
export const bellBytes = (): number =>
  bellStrikeBytes() + (Math.round(BELL_BAKE.shiverSec * BELL_BAKE.sampleRate) + Math.round(BELL_BAKE.clankSec * BELL_BAKE.sampleRate)) * 4;
export const motifBytes = (m: MotifRequest): number => Math.round(motifTimeline(m).totalSec * FELT_PIANO.sampleRate) * 4;

/** The core sounds: baked at unlock, always kept. */
export const CORE_SOUNDS: readonly SoundId[] = SOUND_IDS.filter((id) => SOUND_DEFS[id].set === 'core' && bakeable(id));

export interface SetBytes {
  readonly sounds: number;
  readonly bells: number;
  readonly motifs: number;
  readonly total: number;
}

/** The bytes a level set adds on top of the core (core sounds and the preview strike cost nothing extra). */
export function levelSetBytes(set: LevelSoundSet): SetBytes {
  const sounds = [...new Set(set.sounds)].filter((id) => SOUND_DEFS[id].set !== 'core').reduce((a, id) => a + soundBytes(id), 0);
  const voicings = new Set(set.bells);
  const bells = voicings.size * bellBytes() - (voicings.has(PREVIEW_BELL) ? bellStrikeBytes() : 0);
  const motifs = [...new Map(set.motifs.map((m) => [motifKey(m), m])).values()].reduce((a, m) => a + motifBytes(m), 0);
  return { sounds, bells, motifs, total: sounds + bells + motifs };
}

/** The core: its sounds and the preview strike. */
export const coreBytes = (): number => CORE_SOUNDS.reduce((a, id) => a + soundBytes(id), 0) + bellStrikeBytes();

// -------------------------------------------------------------------------------------------------
// The bank
// -------------------------------------------------------------------------------------------------

interface Entry {
  readonly key: string;
  /** Mutable once: an entry a level set added is kept with the core when the core asks for it too. */
  group: Group;
  /** Bake order: group, then priority, then arrival (compared in that order, never summed). */
  rank: number;
  readonly priority: number;
  readonly seq: number;
  /** The motif this entry renders (null for every other sound): what a MotifRenderer is sent. */
  readonly motif: MotifRequest | null;
  readonly make: () => Generator<void, BakedPcm, void>;
  /** A bake set aside for an awaited motif (prioritize), resumed when its turn comes again. */
  parked: Generator<void, BakedPcm, void> | null;
  pcm: Float32Array | null;
  sampleRate: number;
  buffer: AudioBuffer | null;
  bytes: number;
  hash: number;
  state: 'pending' | 'baking' | 'done' | 'failed';
}

export interface SoundBankOptions {
  /** Milliseconds clock the slice deadline is measured against (default performance.now). */
  readonly now?: () => number;
  /** Where a failed bake is reported (default console.warn, once per key). */
  readonly warn?: (message: string) => void;
  /** Renders motifs off the main thread (the browser's Web Worker); null or absent: they bake here. */
  readonly motifRenderer?: MotifRenderer | null;
}

const before = (a: Entry, b: Entry): boolean =>
  a.rank !== b.rank ? a.rank < b.rank : a.priority !== b.priority ? a.priority < b.priority : a.seq < b.seq;

class Bank implements SoundBank {
  private readonly entries = new Map<string, Entry>();
  private ctx: BaseAudioContext | null = null;
  private scheduled = false;
  private current: { entry: Entry; gen: Generator<void, BakedPcm, void> } | null = null;
  private counter = 0;
  private levelKeys = new Set<string>();
  /**
   * The motif a moment waits for (prioritize), by key: it stands while its entry is dropped and asked
   * for again (a new level set), so the new entry is raised as it is added.
   */
  private awaitedKey: string | null = null;
  /** The awaited motif's entry while it is in the bank, and the rank it had before. */
  private awaited: { entry: Entry; rank: number } | null = null;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  /** Motifs go here while it works (null once it has failed: they bake on the main thread). */
  private renderer: MotifRenderer | null;
  private readonly offThreadStats: { renders: number; ms: number; failed: boolean } | null;
  /** The motif the renderer is working on (one at a time, so the bank's order holds there too). */
  private sent: Entry | null = null;

  constructor(
    private readonly schedule: SliceScheduler,
    private readonly seed: number,
    options: SoundBankOptions,
  ) {
    this.now = options.now ?? (() => performance.now());
    this.warn = options.warn ?? ((m) => console.warn(m));
    this.renderer = options.motifRenderer ?? null;
    this.offThreadStats = this.renderer !== null ? { renders: 0, ms: 0, failed: false } : null;
  }

  attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    for (const e of this.entries.values()) if (e.state === 'done' && !e.buffer) this.wrap(e);
  }

  request(job: BakeJob): void {
    if (job.scope === 'core') {
      // Ahead of every core sound (priority -1): the Ambience preview's strike.
      this.add(bellKey(PREVIEW_BELL, 'strike'), 'core', -1, () => bakeBellSteps(PREVIEW_BELL, 'strike', this.seed));
      for (const id of CORE_SOUNDS) this.addSound(id, 'core');
    } else {
      this.replaceLevel(job.set);
    }
    this.kick();
    this.sendMotif();
  }

  releaseLevel(): void {
    for (const key of this.levelKeys) this.remove(key);
    this.levelKeys = new Set();
  }

  ready(id: SoundId): boolean {
    if (!bakeable(id)) return false;
    for (let v = 0; v < SOUND_DEFS[id].variants; v++) {
      if (this.entries.get(soundKey(id, v))?.state !== 'done') return false;
    }
    return true;
  }

  buffer(id: SoundId, variant: number): AudioBuffer | null {
    if (!this.ready(id)) return null;
    return this.entries.get(soundKey(id, variant))?.buffer ?? null;
  }

  bell(voicing: BellVoicingId, form: BellForm): AudioBuffer | null {
    const e = this.entries.get(bellKey(voicing, form));
    return e?.state === 'done' ? e.buffer : null;
  }

  motif(m: MotifRequest): AudioBuffer | null {
    const e = this.entries.get(motifKey(m));
    return e?.state === 'done' ? e.buffer : null;
  }

  prioritize(m: MotifRequest | null): void {
    const key = m === null ? null : motifKey(m);
    const was = this.awaited;
    if (was !== null && was.entry.key !== key) this.lower(was);
    this.awaitedKey = key;
    const e = key === null ? undefined : this.entries.get(key);
    if (e) this.raise(e);
    this.kick();
    this.sendMotif();
  }

  stats(): BankStats {
    let ready = 0;
    let pending = 0;
    let bytes = 0;
    const parts: string[] = [];
    for (const e of this.entries.values()) {
      if (e.state === 'done') {
        ready++;
        bytes += e.bytes;
        parts.push(`${e.key}=${e.hash.toString(16)}`);
      } else if (e.state === 'pending' || e.state === 'baking') pending++;
    }
    parts.sort();
    let h = 0x811c9dc5;
    for (const p of parts) for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p.charCodeAt(i), 0x01000193) >>> 0;
    const aw = this.awaited?.entry;
    const off = this.offThreadStats;
    return {
      ready,
      pending,
      bytes,
      checksum: h.toString(16).padStart(8, '0'),
      awaited: aw !== undefined && (aw.state === 'pending' || aw.state === 'baking') ? aw.key.slice(2) : null,
      offThread: off === null ? null : { renders: off.renders, ms: Math.round(off.ms), failed: off.failed, busy: this.sent !== null },
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  private addSound(id: SoundId, group: Group): void {
    if (!bakeable(id)) return;
    const def = SOUND_DEFS[id];
    for (let v = 0; v < def.variants; v++) {
      this.add(soundKey(id, v), group, def.priority, () => bakeSteps(id, v, this.seed));
    }
  }

  private add(key: string, group: Group, priority: number, make: () => Generator<void, BakedPcm, void>, motif: MotifRequest | null = null): void {
    const had = this.entries.get(key);
    if (had) {
      if (group === 'core') had.group = 'core';
      return;
    }
    const e: Entry = {
      key,
      group,
      rank: GROUP[group],
      priority,
      seq: this.counter++,
      motif,
      make,
      parked: null,
      pcm: null,
      sampleRate: 0,
      buffer: null,
      bytes: 0,
      hash: 0,
      state: 'pending',
    };
    this.entries.set(key, e);
    // The awaited motif dropped and asked for again (a new level set): still first.
    if (key === this.awaitedKey) this.raise(e);
  }

  private remove(key: string): void {
    const e = this.entries.get(key);
    if (!e || e.group === 'core') return;
    if (this.current?.entry === e) this.current = null;
    // The entry goes; the request (awaitedKey) stands for an entry asked for again.
    if (this.awaited?.entry === e) this.awaited = null;
    this.entries.delete(key);
  }

  /**
   * The awaited motif's entry goes ahead of everything still to bake. A bake in progress on the main
   * thread is set aside (resumed when its turn comes again), unless the motif bakes off it.
   */
  private raise(e: Entry): void {
    if (this.awaited?.entry === e || (e.state !== 'pending' && e.state !== 'baking')) return;
    this.awaited = { entry: e, rank: e.rank };
    e.rank = AWAITED_RANK;
    if (this.offThread(e)) return;
    const cur = this.current;
    if (cur !== null && cur.entry !== e) {
      cur.entry.parked = cur.gen;
      this.current = null;
    }
  }

  /**
   * The awaited motif goes back in its place (prioritize: null or another motif). A bake of it in
   * progress is set aside like any other, so the queue's own order resumes (the level's sounds before
   * the motifs) and the rest of it bakes when its turn comes again, sample for sample the same.
   */
  private lower(was: { entry: Entry; rank: number }): void {
    was.entry.rank = was.rank;
    this.awaited = null;
    const cur = this.current;
    if (cur !== null && cur.entry === was.entry) {
      was.entry.parked = cur.gen;
      this.current = null;
    }
  }

  /**
   * The renderer's motifs while it works: they never bake on the main thread. A card's motif is not one
   * of them (see the header): it bakes here, whatever the renderer.
   */
  private offThread(e: Entry): boolean {
    return e.motif !== null && this.renderer !== null && !CARD_VARIANTS.has(e.motif.variant);
  }

  /** Send the renderer the first of its motifs still to bake (in the bank's order), one at a time. */
  private sendMotif(): void {
    const r = this.renderer;
    if (r === null || this.sent !== null) return;
    let best: Entry | null = null;
    for (const e of this.entries.values()) if (this.offThread(e) && e.state === 'pending' && (!best || before(e, best))) best = e;
    if (best === null) return;
    const e = best;
    e.state = 'baking';
    this.sent = e;
    r.render(e.motif!, this.seed, (res) => this.received(e, res));
  }

  /**
   * A render came back. It belongs to whichever entry has its key now: the one sent, or one that
   * replaced it (the same key is the same render). Dropped if the key has gone. An error means the
   * renderer is gone for good: motifs bake on the main thread from then on.
   */
  private received(sent: Entry, res: MotifRender | Error): void {
    this.sent = null;
    const e = this.entries.get(sent.key);
    const stats = this.offThreadStats!;
    if (res instanceof Error) {
      this.renderer = null;
      stats.failed = true;
      this.warn(`[audio] motif renderer failed (${res.message}): motifs bake on the main thread`);
      if (e !== undefined && e.state === 'baking' && e.parked === null && this.current?.entry !== e) e.state = 'pending';
      this.kick();
      return;
    }
    stats.renders++;
    stats.ms += res.ms;
    if (e !== undefined && (e.state === 'pending' || e.state === 'baking')) this.store(e, res, res.hash);
    this.sendMotif();
  }

  private store(e: Entry, pcm: BakedPcm, hash: number): void {
    e.pcm = pcm.data;
    e.sampleRate = pcm.sampleRate;
    e.bytes = pcm.data.byteLength;
    e.hash = hash;
    e.state = 'done';
    this.wrap(e);
  }

  private replaceLevel(set: LevelSoundSet): void {
    const next = new Set<string>();
    for (const id of new Set(set.sounds)) {
      if (!bakeable(id)) continue;
      // A core sound in a level set is baked as core (and kept), even before the core job arrives.
      if (SOUND_DEFS[id].set === 'core') {
        this.addSound(id, 'core');
        continue;
      }
      for (let v = 0; v < SOUND_DEFS[id].variants; v++) next.add(soundKey(id, v));
    }
    for (const voicing of new Set(set.bells)) for (const form of BELL_FORMS) next.add(bellKey(voicing, form));
    for (const m of set.motifs) next.add(motifKey(m));
    for (const key of this.levelKeys) if (!next.has(key)) this.remove(key);
    for (const voicing of new Set(set.bells)) {
      for (const [i, form] of BELL_FORMS.entries()) {
        // The strike first of all (bells are background: a strike that is not ready waits, and the
        // level's bells must not wait behind its heavy sounds); the shiver and the clank after them.
        this.add(bellKey(voicing, form), form === 'strike' ? 'first' : 'bells', i, () => bakeBellSteps(voicing, form, this.seed));
      }
    }
    for (const m of set.motifs) {
      this.add(motifKey(m), CARD_VARIANTS.has(m.variant) ? 'first' : 'motifs', 0, () => renderMotifSteps(m, this.seed), m);
    }
    // The level's collision sounds right after its strikes (priority 2-3 within 'first', so after the
    // strikes and the card's motif at 0): cheap, and needed from the first seconds of play.
    for (const id of new Set(set.sounds)) {
      if (bakeable(id) && SOUND_DEFS[id].set !== 'core') this.addSound(id, EARLY_FAMILIES.has(SOUND_DEFS[id].family) ? 'first' : 'level');
    }
    this.levelKeys = next;
  }

  private wrap(e: Entry): void {
    if (!this.ctx || !e.pcm) return;
    const buf = this.ctx.createBuffer(1, e.pcm.length, e.sampleRate);
    buf.copyToChannel(e.pcm as Float32Array<ArrayBuffer>, 0);
    e.buffer = buf;
    e.pcm = null;
  }

  /** The main thread's next bake (motifs are the renderer's while it works). */
  private next(): Entry | null {
    let best: Entry | null = null;
    for (const e of this.entries.values()) {
      const waiting = e.state === 'pending' || (e.state === 'baking' && e.parked !== null);
      if (waiting && !this.offThread(e) && (!best || before(e, best))) best = e;
    }
    return best;
  }

  private kick(): void {
    if (this.scheduled || (!this.current && !this.next())) return;
    this.scheduled = true;
    this.schedule((deadline) => this.work(deadline));
  }

  /** Runs recipe steps until the deadline; true while work remains. */
  private work(deadlineMs: number): boolean {
    do {
      if (!this.current) {
        const e = this.next();
        if (!e) break;
        if (e.parked !== null) {
          this.current = { entry: e, gen: e.parked };
          e.parked = null;
        } else {
          e.state = 'baking';
          this.current = { entry: e, gen: e.make() };
        }
      }
      const { entry, gen } = this.current;
      try {
        const s = gen.next();
        if (s.done) {
          this.current = null;
          this.store(entry, s.value, pcmHash(s.value.data));
        }
      } catch (err) {
        this.current = null;
        entry.state = 'failed';
        this.warn(`[audio] bake failed for ${entry.key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } while (this.now() < deadlineMs);
    const more = this.current !== null || this.next() !== null;
    if (!more) this.scheduled = false;
    return more;
  }
}

/**
 * The contract's CreateSoundBank, plus optional injections for tests (a clock, a warning sink).
 * Request 'core' at unlock and the level set as soon as a level or chapter is chosen.
 */
export const createSoundBank = ((schedule: SliceScheduler, seed: number, options: SoundBankOptions = {}): SoundBank =>
  new Bank(schedule, seed, options)) satisfies CreateSoundBank;

/**
 * The first browser scheduler (kept for reference and tests): requestIdleCallback with a 4 ms budget
 * (falling back to setTimeout(0)), repeating while the work reports more to do. Under a busy main
 * thread it gets one step per 250 ms timeout: in the integrated smoke run Riverside Town's set was
 * still baking a minute into play. The engine now uses pacedScheduler.
 */
export const idleScheduler: SliceScheduler = (work) => {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
  };
  const run = (budget: number): void => {
    const more = work(performance.now() + Math.min(4, Math.max(1, budget)));
    if (more) next();
  };
  const next = (): void => {
    if (g.requestIdleCallback) g.requestIdleCallback((d) => run(d.timeRemaining()), { timeout: 250 });
    else setTimeout(() => run(4), 0);
  };
  next();
};

// -------------------------------------------------------------------------------------------------
// Pacing by what is on screen
// -------------------------------------------------------------------------------------------------

/**
 * What the bake may take from the main thread right now:
 *  - 'loading': the loading overlay covers the screen (nothing to drop a frame of): back-to-back timer
 *    slices of BAKE_PACE.loadingSliceMs, yielding between them so the loading itself keeps going. The
 *    loading is mostly a few long tasks (terrain, shaders) with gaps between them, and each gap gets one
 *    slice, which the load then waits for. Measured in headless Chrome from a cold start (three runs of
 *    four flows against ?audio=off, docs/evidence/AUDIO_RUNS.md): 40 ms slices baked 75-405 ms during a
 *    load and made it 0.17-0.43 s longer; 16 ms slices bake 0-169 ms, the load is 0.08 s longer on
 *    average (within the run-to-run spread), and nothing was dropped as notReady either way, since the
 *    strikes and collision sounds bake first, mostly on the menus. The engine also uses it off play
 *    while a moment waits for a motif still baking (AudioManager.awaitMotif): behind the Revelation's
 *    river view it baked 0.67-0.72 s of work a second against 0.12-0.19 s at the idle pace, at about 9 %
 *    fewer frames (docs/evidence/AUDIO_RUNS.md, "Epilogue motif bake");
 *  - 'idle': a menu, a chapter card, a paused or finished run: idle time only, up to idleSliceMs of
 *    each idle period the browser reports (it knows when the next frame is due);
 *  - 'play': at most playSliceMs, in idle time; when no idle time has come for playTimeoutMs, a slice
 *    of playMinMs anyway, so leftover work still finishes in a busy game.
 */
export type BakePace = 'loading' | 'idle' | 'play';

export const BAKE_PACE = {
  loadingSliceMs: 16,
  idleSliceMs: 12,
  idleTimeoutMs: 250,
  playSliceMs: 4,
  playMinMs: 2,
  playTimeoutMs: 100,
} as const;

/** Where the bake's main-thread time went, per pace (the debug API reports it). */
export interface BakeTimeStats {
  readonly slices: Record<BakePace, number>;
  /** Milliseconds spent inside work(), per pace. */
  readonly ms: Record<BakePace, number>;
  /** The longest single slice, per pace (a recipe step can overrun the deadline by one step). */
  readonly maxMs: Record<BakePace, number>;
}

export interface PacedScheduler extends SliceScheduler {
  stats(): BakeTimeStats;
}

interface IdleDeadlineLike {
  timeRemaining(): number;
  readonly didTimeout?: boolean;
}

export interface PacerTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  /** Null where the browser has no requestIdleCallback. */
  requestIdle: ((fn: (d: IdleDeadlineLike) => void, opts: { timeout: number }) => unknown) | null;
}

const browserPacerTimers = (): PacerTimers => {
  const g = globalThis as unknown as { requestIdleCallback?: (cb: (d: IdleDeadlineLike) => void, o?: { timeout: number }) => number };
  return {
    now: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    requestIdle: typeof g.requestIdleCallback === 'function' ? (fn, o) => g.requestIdleCallback!(fn, o) : null,
  };
};

/**
 * The engine's slice scheduler: each slice asks `pace()` what the screen allows (see BakePace). One
 * slice is queued at a time; the deadline handed to work() is absolute (performance.now() ms).
 */
export function pacedScheduler(pace: () => BakePace, timers: PacerTimers = browserPacerTimers()): PacedScheduler {
  const zero = (): Record<BakePace, number> => ({ loading: 0, idle: 0, play: 0 });
  const st = { slices: zero(), ms: zero(), maxMs: zero() };
  const schedule = ((work: (deadlineMs: number) => boolean): void => {
    const run = (p: BakePace, budgetMs: number): void => {
      const t0 = timers.now();
      const more = work(t0 + budgetMs);
      const spent = timers.now() - t0;
      st.slices[p]++;
      st.ms[p] += spent;
      if (spent > st.maxMs[p]) st.maxMs[p] = spent;
      if (more) next();
    };
    const next = (): void => {
      const p = pace();
      const idle = timers.requestIdle;
      if (p === 'loading' || idle === null) {
        timers.setTimeout(() => {
          const now = pace();
          run(now, now === 'loading' ? BAKE_PACE.loadingSliceMs : now === 'idle' ? BAKE_PACE.idleSliceMs : BAKE_PACE.playSliceMs);
        }, 0);
        return;
      }
      const timeout = p === 'idle' ? BAKE_PACE.idleTimeoutMs : BAKE_PACE.playTimeoutMs;
      idle((d) => {
        // The pace may have changed while this slice waited (the overlay came up, or play began).
        const now = pace();
        const left = d.timeRemaining();
        const budget =
          now === 'loading'
            ? BAKE_PACE.loadingSliceMs
            : now === 'idle'
              ? Math.min(BAKE_PACE.idleSliceMs, Math.max(1, left))
              : Math.min(BAKE_PACE.playSliceMs, Math.max(BAKE_PACE.playMinMs, left));
        run(now, budget);
      }, { timeout });
    };
    next();
  }) as PacedScheduler;
  schedule.stats = () => ({ slices: { ...st.slices }, ms: { ...st.ms }, maxMs: { ...st.maxMs } });
  return schedule;
}
