/**
 * The AudioManager (contract §14, DESIGN §3–§4): one app-lifetime object with three channels (music,
 * ambience, effects), master volume and mute, the pause, hidden-tab and loading gates, ducks, the
 * motif, and one SessionAudio per attempt.
 *
 *   audio (singleton) ── NullAudioManager where there is no Web Audio (node, jsdom, ?audio=off):
 *                        constructs nothing, logs nothing; only the music router still works, so
 *                        volume, mute, holds and ducks keep driving the recorded music.
 *                    └─ WebAudioManager: the context is created on the first user gesture with
 *                        activation (./engine/context.ts); the graph, strips and voice pool are built
 *                        on it; package B's bank, noise and ambience voices are attached when it runs.
 *
 * Package B's synthesis comes in through SynthesisFactories (./synthesis.ts). Until it is wired, the
 * bank is absent and every play() is dropped as 'notReady': silence, never an error.
 *
 * Audio only listens: nothing here reads or writes game state. Every SessionAudio method is wrapped
 * so it never throws; after five errors a session disables itself (one console.warn, one trace entry).
 */
import {
  AFTERMATH_MAX_HOLD_SEC,
  BELL_PATTERN,
  BELL_VARIATION,
  COLLISION_MAG,
  HIT_LREF,
  SOUND_DEFS,
  SPATIAL,
  BELL_VOICINGS,
  DUCK_PRESETS,
  GLOBAL_LIMITS,
  MOMENT_TIMING,
  MOTIF_CALIB_DB,
  SEED,
  SPACE,
  type AmbienceVoices,
  type AudioLevels,
  type AudioManager,
  type AudioState,
  type BankStats,
  type BellRequest,
  type BellVoicingId,
  type ContextStatus,
  type DuckKey,
  type DuckLevels,
  type LevelSoundSet,
  type ListenerPose,
  type MotifHandle,
  type MotifRequest,
  type PlayResult,
  type PositionalVoice,
  type RngStream,
  type SessionAudio,
  type SessionAudioInfo,
  type SliceScheduler,
  type SoundBank,
  type NoiseBank,
  type SoundRequest,
  type TraceEntry,
  type TraceKind,
} from './contract';
import type { GameMode } from '../state/appStore';
import type { GamePhase } from '../core/types';
import { debugEnabled, installAudioDebug } from './debug';
import { dbToGain, DuckMixer } from './ducks';
import { audioAvailable, audioContextClass } from './env';
import { AudioGraph, RampedGain } from './engine/graph';
import { browserActivation, ContextController, realTimers, type ContextTimers } from './engine/context';
import { BellVoices, createPlayDetail, dropped, EffectVoices, VoiceSession, type PlayDetail } from './engine/voicePool';
import { musicPlayer, type FadeTicker, type MusicPlayer } from './music';
import { createMusicRouter, intervalTicker, type MusicRouterImpl } from './musicRouter';
import { signed, streamRng, streamSeed } from './rng';
import { DEFAULT_LEVELS, sameLevels } from './settings';
import { airLowpassHz, copyPose, createListenerPose, distanceGain } from './spatial';
import { SYNTHESIS, type SynthesisFactories } from './synthesis';
import { pacedScheduler, type BakePace, type BakeTimeStats, type PacedScheduler } from './synth/bank';
import { TraceRing } from './trace';

/** Session ambience fades in over this once loading ends (DESIGN §4, intro). */
export const AMBIENCE_FADE_IN_SEC = 1.5;
/** Five errors and a session goes quiet. */
export const MAX_SESSION_ERRORS = 5;
/** Space send of a bell strike (DESIGN §7.7). */
export const BELL_SEND = 0.25;
/** Settings preview (P1): at most one every 0.4 s; the hit from 30 m, the bell from 120 m. */
export const PREVIEW_THROTTLE_SEC = 0.4;
const PREVIEW_HIT_M = 30;
const PREVIEW_BELL_M = 120;
/** The session's ambience/scrape nodes are disconnected this long after end(). */
const END_DISCONNECT_MS = 200;
/** Cap on the bus-step ticker period: ducks on ambience and effects are stepped at 20 Hz. */
const BUS_TICK_SEC = 0.05;
/**
 * The sample rate the context will most likely have (Chrome's usual output rate): the space IR is made
 * for it on the menu, before the gesture. A context at another rate makes its own IR when it is built.
 */
export const WARM_SAMPLE_RATE = 48000;

export interface AudioManagerOptions {
  readonly synthesis?: SynthesisFactories;
  /** The recorded-music player (default: the music.ts singleton). */
  readonly player?: MusicPlayer;
  /** Clocks for the music router and for the bus duck stepper (tests pass manual tickers). */
  readonly ticker?: FadeTicker;
  readonly busTicker?: FadeTicker;
  /** AudioContext construction (default: new AudioContext({ latencyHint: 'balanced' })). */
  readonly createContext?: () => AudioContext;
  /** Gesture listeners' target (default: window; null = none). */
  readonly target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  readonly hasActivation?: () => boolean;
  readonly timers?: ContextTimers;
  /**
   * Bake slices (default: package B's pacedScheduler, paced by what is on screen: timer slices while
   * the loading overlay is up, idle time on menus, at most 4 ms in play; contract SliceScheduler).
   */
  readonly scheduler?: SliceScheduler;
  /** Force the Null manager (true = detect: Web Audio present and not jsdom / ?audio=off). */
  readonly available?: boolean;
  /** Trace and meters from the start (the debug API turns them on later otherwise). */
  readonly debug?: boolean;
  readonly seed?: number;
  /** Limiter makeup compensation (dB); default LIMITER.makeupCompDb (measured: see docs). */
  readonly makeupDb?: number;
  /** The motif's calibration against the recordings (dB); default MOTIF_CALIB_DB (measured, R7/R10). */
  readonly motifCalibDb?: number;
}

/** What the debug API, the lab and the tests reach behind the contract. */
export interface ManagerInternals {
  readonly traceRing: TraceRing;
  readonly router: MusicRouterImpl;
  readonly synthesis: SynthesisFactories;
  graph(): AudioGraph | null;
  context(): BaseAudioContext | null;
  bank(): SoundBank | null;
  effects(): EffectVoices | null;
  /** Turn tracing (and the meters, built with the next graph) on or off. */
  setTracing(on: boolean): void;
  /** Jitter and shuffled variants (the lab switches them off). */
  setVariation(on: boolean): void;
  /** Play one bank sound now through the live graph (lab, labelled 'injected' in the trace). */
  fire(id: SoundRequest['layers'][number]['sound'], o: { gainDb: number; rate: number; lowpassHz: number; distM: number }): boolean;
  /** The bake's pace now, its main-thread time per pace, and every sound or bell dropped as notReady. */
  bakeReport(): BakeReport;
  /** The makeup and motif calibration in use (the lab builds the same graph offline). */
  readonly makeupDb: number | undefined;
  readonly motifCalibDb: number;
}

export type EngineAudioManager = AudioManager & ManagerInternals;

export interface BakeReport {
  readonly pace: BakePace | null;
  readonly loadingScreen: boolean;
  /** The motif a moment waits for or comes next with, while it is still baking ('variant@tempo', awaitMotif), or null. */
  readonly awaitedMotif: string | null;
  /** Null when the scheduler is a test's own. */
  readonly time: BakeTimeStats | null;
  readonly bank: BankStats;
  /** Requests dropped because their sound was not baked yet, by the first layer's sound id. */
  readonly notReady: Readonly<Record<string, number>>;
  /** Bell strikes (or shivers, clanks) dropped as not baked, by 'voicing form'. */
  readonly bellsNotReady: Readonly<Record<string, number>>;
  /** The noise bank and space IR made before the gesture: steps done of all, main-thread ms. */
  readonly warm: { readonly steps: number; readonly done: number; readonly ms: number; readonly complete: boolean } | null;
}

const EMPTY_BANK: BankStats = { ready: 0, pending: 0, bytes: 0, checksum: '' };

const presetLevels = (key: DuckKey, mode: GameMode): DuckLevels | null => DUCK_PRESETS[key][mode];

const wallNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

// =================================================================================================
// The shared part: the music router, levels, ducks on the recording
// =================================================================================================

abstract class BaseManager {
  readonly seed: number;
  readonly router: MusicRouterImpl;
  readonly traceRing = new TraceRing();
  readonly synthesis: SynthesisFactories;
  protected levels: AudioLevels = DEFAULT_LEVELS;
  protected hidden = false;
  protected tracingOn: boolean;
  private warned = false;

  constructor(protected readonly options: AudioManagerOptions) {
    this.seed = options.seed ?? SEED;
    this.synthesis = options.synthesis ?? SYNTHESIS;
    // Subclasses turn tracing on (options.debug) once they are fully built.
    this.tracingOn = false;
    this.router = createMusicRouter({
      player: options.player ?? musicPlayer,
      ticker: options.ticker ?? intervalTicker(),
      onNote: (kind, note) => {
        if (kind === 'error') this.warnOnce(note);
        if (this.tracingOn) this.traceRaw(kind === 'hold' ? 'hold' : kind === 'duck' ? 'duck' : kind === 'error' ? 'error' : 'music', note);
      },
    });
  }

  get music(): MusicRouterImpl {
    return this.router;
  }

  get tracing(): boolean {
    return this.tracingOn;
  }

  setTracing(on: boolean): void {
    const was = this.tracingOn;
    this.tracingOn = on;
    if (on && !was) this.traceHeader();
  }

  /** The trace's first entry: the seed every stream descends from (AGENTS.md: report the seed). */
  protected traceHeader(): void {
    this.traceRaw('lifecycle', `trace on: SEED ${this.seed}, ${this.available ? 'Web Audio' : 'no Web Audio (null manager)'}`);
  }

  abstract readonly available: boolean;

  abstract now(): number;

  traceRaw(kind: TraceKind, note: string, token = 0): void {
    this.traceRing.push({ t: this.now(), gt: 0, token, frame: 0, kind, cause: -1, note });
  }

  protected warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    if (import.meta.env.MODE !== 'test') console.warn(`[audio] ${message}`);
  }
}

// =================================================================================================
// No Web Audio
// =================================================================================================

class NullSession implements SessionAudio {
  readonly ambience = null;
  readonly tracing = false;
  constructor(
    readonly token: number,
    readonly info: SessionAudioInfo,
    private readonly seed: number,
  ) {}
  rng(stream: RngStream): () => number {
    return streamRng(this.info.levelId, this.info.attempt, stream, this.seed);
  }
  play(): PlayResult {
    return dropped('unavailable');
  }
  playBell(): PositionalVoice | null {
    return null;
  }
  bellReady(): boolean {
    // Nothing will ever play: never hold the scheduler back.
    return true;
  }
  setListener(): void {}
  setPhase(): void {}
  beginFrame(): void {}
  duck(): void {}
  trace(): void {}
  reportBells(): void {}
  end(): void {}
}

export class NullAudioManager extends BaseManager implements EngineAudioManager {
  readonly available = false;
  private token = 0;

  constructor(options: AudioManagerOptions = {}) {
    super(options);
    if (options.debug === true) this.setTracing(true);
  }

  status(): ContextStatus {
    return 'unavailable';
  }
  unlock(): void {
    this.router.unlock();
  }
  applySettings(levels: AudioLevels): void {
    this.levels = levels;
    this.router.setLevels(levels);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.router.setHidden(hidden);
  }
  duck(key: DuckKey, levels: DuckLevels | null, mode: GameMode): void {
    applyMusicDuck(this.router, key, levels, mode);
  }
  playMotif(): MotifHandle | null {
    return null;
  }
  stopMotif(): void {}
  awaitMotif(): void {}
  preview(): void {}
  prepare(): void {}
  setLoadingScreen(): void {}
  beginSession(info: SessionAudioInfo): SessionAudio {
    return new NullSession(++this.token, info, this.seed);
  }
  now(): number {
    return 0;
  }
  state(): AudioState {
    return {
      available: false,
      status: 'unavailable',
      seed: this.seed,
      sampleRate: 0,
      hidden: this.hidden,
      paused: false,
      levels: this.levels,
      buses: { master: 0, music: 0, ambience: 0, effects: 0, gate: 0 },
      ducks: {},
      voices: { active: 0, peak: 0, byFamily: {} },
      bells: [],
      bank: EMPTY_BANK,
      session: null,
      music: this.router.state(),
      perf: { frameMsMedian: 0, frameMsP99: 0 },
    };
  }
  async dispose(): Promise<void> {
    this.router.dispose();
  }
  graph(): AudioGraph | null {
    return null;
  }
  context(): BaseAudioContext | null {
    return null;
  }
  bank(): SoundBank | null {
    return null;
  }
  effects(): EffectVoices | null {
    return null;
  }
  setVariation(): void {}
  fire(): boolean {
    return false;
  }
  bakeReport(): BakeReport {
    return { pace: null, loadingScreen: false, awaitedMotif: null, time: null, bank: EMPTY_BANK, notReady: {}, bellsNotReady: {}, warm: null };
  }
  get makeupDb(): number | undefined {
    return this.options.makeupDb;
  }
  get motifCalibDb(): number {
    return this.options.motifCalibDb ?? MOTIF_CALIB_DB;
  }
}

/**
 * The recording's part of a duck (both managers): timing from DUCK_PRESETS, levels from the caller,
 * the release from the caller when it has its own (the aftermath's comes from the chapter).
 */
function applyMusicDuck(router: MusicRouterImpl, key: DuckKey, levels: DuckLevels | null, mode: GameMode, releaseSec = DUCK_PRESETS[key].releaseSec): void {
  const preset = DUCK_PRESETS[key];
  if (presetLevels(key, mode) === null) return;
  if (levels === null) {
    router.unduck(key, releaseSec);
    return;
  }
  const hold = preset.holdSec === 'untilRelease' ? Infinity : preset.holdSec;
  router.duckFor(key, levels.music, preset.attackSec, hold, releaseSec, duckOptions(key));
}

/**
 * A duck's release: the preset's, except the aftermath's, which is the chapter's own
 * (CHAPTER_MIX.aftermathReleaseSec: Act I 2 s, Act II 4 s, Act III 6 s; DESIGN §8.3).
 */
function releaseOf(key: DuckKey, owner: { readonly info: SessionAudioInfo } | null): number {
  const preset = DUCK_PRESETS[key].releaseSec;
  if (key !== 'aftermath' || owner === null) return preset;
  const own = owner.info.mix.aftermathReleaseSec;
  return Number.isFinite(own) && own > 0 ? own : preset;
}

const duckOptions = (key: DuckKey) => (key === 'aftermath' ? { deepest: true, maxHoldSec: AFTERMATH_MAX_HOLD_SEC } : undefined);

// =================================================================================================
// Web Audio
// =================================================================================================

interface SessionNodes {
  readonly ambience: RampedGain;
  readonly effects: RampedGain;
  readonly space: RampedGain;
}

class WebSession implements SessionAudio {
  readonly started = wallNow();
  phase: GamePhase = 'loading';
  loading = true;
  ended = false;
  disabled = false;
  errors = 0;
  /** Keys this session ducked (released by end()). */
  readonly ducks = new Set<DuckKey>();
  gateClosed = false;
  bells: AudioState['bells'] = [];
  private voice: VoiceSession | null = null;
  private amb: AmbienceVoices | null = null;
  nodes: SessionNodes | null = null;
  private readonly pose: ListenerPose = createListenerPose();
  private readonly rngs = new Map<RngStream, () => number>();
  private readonly detail: PlayDetail = createPlayDetail();
  private frame = 0;
  private frameMs = 0;

  constructor(
    readonly token: number,
    readonly info: SessionAudioInfo,
    private readonly m: WebAudioManager,
  ) {}

  get tracing(): boolean {
    return this.m.tracing;
  }

  rng(stream: RngStream): () => number {
    let r = this.rngs.get(stream);
    if (!r) {
      r = streamRng(this.info.levelId, this.info.attempt, stream, this.m.seed);
      this.rngs.set(stream, r);
    }
    return r;
  }

  /** The admission state on the current context's pool (rebuilt if the context was rebuilt). */
  voiceSession(): VoiceSession {
    if (this.voice === null) {
      this.voice = new VoiceSession(this.token, this.rng('sfx'), this.pose);
      this.voice.spaceSend = this.info.mix.spaceSend;
      this.voice.frame.begin(this.frame);
    }
    return this.voice;
  }

  play(req: SoundRequest): PlayResult {
    if (this.ended) {
      if (this.m.tracing) this.traceDrop(req, 'disabled', 'stale');
      return dropped('disabled');
    }
    if (this.disabled) return dropped('disabled');
    const t0 = this.m.tracing ? performance.now() : 0;
    let r: PlayResult;
    try {
      const fx = this.m.effects();
      if (fx === null || this.m.status() !== 'running') r = dropped('unavailable');
      else if (this.loading) r = dropped('loading');
      else if (this.phase === 'paused') r = dropped('paused');
      else {
        r = fx.play(req, this.voiceSession(), this.detail);
        if (r.started > 0 && req.priority === 0) this.m.makeRoom(this);
      }
      if (r.started === 0 && r.reason === 'notReady') this.m.countNotReady(req.layerCount > 0 ? req.layers[0].sound : 'none', this.token);
      if (this.m.tracing) {
        if (r.started > 0) this.tracePlay(req);
        else this.traceDrop(req, r.reason ?? 'quiet');
        this.frameMs += performance.now() - t0;
      }
      return r;
    } catch (err) {
      this.error('play', err);
      return dropped('disabled');
    }
  }

  playBell(req: BellRequest): PositionalVoice | null {
    if (this.ended || this.disabled) return null;
    try {
      const ctx = this.m.context();
      const bank = this.m.bank();
      if (ctx === null || bank === null || this.m.status() !== 'running' || this.loading) return null;
      const buffer = bank.bell(req.voicing, req.form);
      if (buffer === null) {
        this.m.countBellNotReady(`${req.voicing} ${req.form}`, this.token);
        if (this.m.tracing) this.traceBell(req, 'notReady');
        return null;
      }
      const rng = this.rng('bells');
      const rate = Math.pow(2, (signed(rng) * BELL_VARIATION.rateCents) / 1200);
      const scale = req.velocity * dbToGain(BELL_VOICINGS[req.voicing].trimDb + signed(rng) * BELL_VARIATION.gainDb);
      let voice: PositionalVoice | null;
      if (req.form === 'clank') {
        // The buried clank sits under the collapse, on the effects channel (DESIGN §7.7 step 6).
        const fx = this.m.effects();
        const v = fx?.playRaw(buffer, {
          token: this.token,
          family: 'breakStructure',
          priority: 1,
          sound: 'masonry.collapse.small',
          when: req.when,
          gain: Math.max(0, req.gainLin) * scale,
          lowpassHz: req.lowpassHz,
          pan: req.pan,
          send: this.info.mix.spaceSend,
          rate,
        });
        voice = v
          ? {
              endsAt: v.endAt,
              update: (g, lp, pan) => v.strip.glide(ctx.currentTime, Math.max(0, g) * scale, lp, pan, 0.05),
              choke: (tau) => {
                v.strip.choke(ctx.currentTime, tau);
                try {
                  v.source.stop(ctx.currentTime + Math.max(0.02, tau * 7));
                } catch {
                  // already stopped
                }
              },
            }
          : null;
      } else voice = this.m.bellVoices()?.play(this.token, req, buffer, scale, rate, BELL_SEND) ?? null;
      if (this.m.tracing) this.traceBell(req, voice === null ? 'cap' : null);
      return voice;
    } catch (err) {
      this.error('playBell', err);
      return null;
    }
  }

  bellReady(voicing: BellVoicingId): boolean {
    if (this.ended || this.disabled) return true;
    try {
      const bank = this.m.bank();
      // No bank at all (no synthesis): nothing could ever ring, so never hold the scheduler back.
      return bank === null ? this.m.synthesis.createSoundBank === null : bank.bell(voicing, 'strike') !== null;
    } catch (err) {
      this.error('bellReady', err);
      return true;
    }
  }

  get ambience(): AmbienceVoices | null {
    if (this.ended || this.disabled) return null;
    if (this.amb !== null) return this.amb;
    try {
      const built = this.m.buildAmbience(this);
      if (built !== null) {
        this.amb = built;
        if (this.m.tracing) this.m.traceRaw('ambience', 'ambience voices built', this.token);
      }
    } catch (err) {
      this.error('ambience', err);
    }
    return this.amb;
  }

  setListener(pose: Readonly<ListenerPose>): void {
    try {
      copyPose(pose, this.pose);
    } catch (err) {
      this.error('setListener', err);
    }
  }

  setPhase(phase: GamePhase, loading: boolean): void {
    if (this.ended || this.disabled) return;
    try {
      const wasLoading = this.loading;
      this.phase = phase;
      this.loading = loading;
      if (wasLoading !== loading) this.m.sessionLoading(this, loading);
      const paused = phase === 'paused';
      if (paused !== this.gateClosed) {
        this.gateClosed = paused;
        this.m.updatePauseGate();
        this.duck('pause', paused ? presetLevels('pause', this.info.mode) : null);
      }
      const failed = phase === 'failed';
      if (failed !== this.ducks.has('fail')) this.duck('fail', failed ? presetLevels('fail', this.info.mode) : null);
    } catch (err) {
      this.error('setPhase', err);
    }
  }

  beginFrame(frame: number): void {
    this.frame = frame;
    this.voice?.frame.begin(frame);
    if (this.m.tracing) {
      this.m.recordFrameMs(this.frameMs);
      this.frameMs = 0;
    }
  }

  duck(key: DuckKey, levels: DuckLevels | null): void {
    if (this.ended || this.disabled) return;
    try {
      this.m.applyDuck(key, levels, this.info.mode, this);
    } catch (err) {
      this.error('duck', err);
    }
  }

  trace(entry: TraceEntry): void {
    if (this.m.tracing) this.m.traceRing.push(entry);
  }

  reportBells(bells: AudioState['bells']): void {
    this.bells = bells;
  }

  end(fadeSec = 0.12): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.m.endSession(this, Math.max(0.005, fadeSec), this.amb);
    } catch (err) {
      this.error('end', err);
    }
    this.amb = null;
  }

  /** The context was closed and rebuilt: drop what was built on the old one. */
  detach(): void {
    this.voice = null;
    this.amb = null;
    this.nodes = null;
  }

  private error(where: string, err: unknown): void {
    this.errors++;
    if (this.m.tracing) this.m.traceRaw('error', `${where}: ${String(err)}`, this.token);
    if (this.errors >= MAX_SESSION_ERRORS && !this.disabled) {
      this.disabled = true;
      if (import.meta.env.MODE !== 'test') console.warn(`[audio] session ${this.token} disabled after ${this.errors} errors (last in ${where}: ${String(err)})`);
      this.m.traceRaw('error', `session disabled after ${this.errors} errors`, this.token);
      try {
        this.m.endSession(this, 0.12, this.amb);
      } catch {
        // nothing more to do
      }
    }
  }

  private tracePlay(req: SoundRequest): void {
    const d = this.detail;
    const now = this.m.now();
    for (let i = 0; i < d.count; i++) {
      const layer = req.layers[d.layer[i]];
      this.m.traceRing.push({
        t: now,
        gt: wallNow() - this.started,
        token: this.token,
        frame: this.frame,
        kind: 'play',
        cause: req.cause,
        sound: layer.sound,
        family: req.family,
        variant: d.variant[i],
        gainDb: d.gainDb[i],
        requestDb: layer.gainDb,
        rate: d.rate[i],
        lowpassHz: d.lowpassHz[i],
        pan: d.pan,
        distM: d.distM,
        priority: req.priority,
        activeVoices: d.active,
        note: i === 0 && (d.stole > 0 || d.trimmed > 0) ? `stole=${d.stole} trimmed=${d.trimmed}` : undefined,
      });
    }
  }

  private traceDrop(req: SoundRequest, reason: NonNullable<PlayResult['reason']>, note?: string): void {
    this.m.traceRing.push({
      t: this.m.now(),
      gt: wallNow() - this.started,
      token: this.token,
      frame: this.frame,
      kind: 'drop',
      cause: req.cause,
      sound: req.layerCount > 0 ? req.layers[0].sound : undefined,
      family: req.family,
      priority: req.priority,
      reason,
      activeVoices: this.detail.active,
      distM: this.detail.distM || undefined,
      note,
    });
  }

  private traceBell(req: BellRequest, reason: 'notReady' | 'cap' | null): void {
    this.m.traceRing.push({
      t: this.m.now(),
      gt: wallNow() - this.started,
      token: this.token,
      frame: this.frame,
      kind: 'bell',
      cause: -1,
      reason: reason ?? undefined,
      note: `${req.voicing} ${req.form} slot=${req.slot} v=${req.velocity.toFixed(2)} at=${req.when.toFixed(3)}`,
    });
  }
}

export class WebAudioManager extends BaseManager implements EngineAudioManager {
  readonly available = true;
  private readonly ctl: ContextController;
  private graphNodes: AudioGraph | null = null;
  /** Bumped whenever the space return is closed or opened, so a stale reopening timer does nothing. */
  private spaceGen = 0;
  private fx: EffectVoices | null = null;
  private bellPool: BellVoices | null = null;
  private soundBank: SoundBank | null = null;
  private noise: NoiseBank | null = null;
  private noiseCtx: BaseAudioContext | null = null;
  private attachedCtx: BaseAudioContext | null = null;
  private readonly mixer: DuckMixer;
  private readonly busTicker: FadeTicker;
  private busTicking = false;
  private readonly sessions = new Set<WebSession>();
  private latest: WebSession | null = null;
  private token = 0;
  private motif: { source: AudioBufferSourceNode; gain: GainNode; startsAt: number; endsAt: number } | null = null;
  private preparedKey = '';
  private prepared: LevelSoundSet | null = null;
  private variation = true;
  private readonly timers: ContextTimers;
  private readonly frameMs = new Float64Array(600);
  private frameCount = 0;
  private readonly hasActivation: () => boolean;
  private lastPreview = -Infinity;
  private previewCount = 0;
  private loadingScreen = false;
  /** The motif a moment waits for or comes next with (awaitMotif). */
  private awaited: MotifRequest | null = null;
  private pacer: PacedScheduler | null = null;
  /** The bank's slice scheduler (also runs the warm-up steps). */
  private scheduler: SliceScheduler | null = null;
  private warmStarted = false;
  /** Main-thread ms the warm-up took and how far it got (the debug API reports it). */
  readonly warmStats = { steps: 0, done: 0, ms: 0, complete: false };
  private readonly notReady = new Map<string, number>();
  private readonly bellsNotReady = new Map<string, number>();
  /** notReady drops per session token, summarised in the trace when the session ends. */
  private readonly sessionNotReady = new Map<number, Map<string, number>>();

  constructor(options: AudioManagerOptions = {}) {
    super(options);
    this.timers = options.timers ?? realTimers;
    this.hasActivation = options.hasActivation ?? browserActivation;
    this.mixer = new DuckMixer({ onInvalid: (m) => this.warnOnce(m) });
    this.busTicker = options.busTicker ?? intervalTicker(BUS_TICK_SEC * 1000);
    const Ctor = audioContextClass();
    const create =
      options.createContext ??
      ((): AudioContext => {
        if (Ctor === null) throw new Error('no AudioContext');
        return new Ctor({ latencyHint: 'balanced' });
      });
    this.ctl = new ContextController({
      target: options.target !== undefined ? options.target : typeof window !== 'undefined' ? window : null,
      create,
      hasActivation: this.hasActivation,
      timers: this.timers,
      onCreated: (ctx) => this.onCreated(ctx),
      onRunning: (ctx) => this.onRunning(ctx),
      onHide: (ctx) => this.graphNodes?.setHiddenGate(false, ctx.currentTime),
      onShow: (ctx) => this.graphNodes?.setHiddenGate(true, ctx.currentTime),
      onClosed: () => this.onClosed(),
      onGesture: () => {
        if (this.hasActivation()) this.router.unlock();
      },
      onStatus: (status, note) => {
        if (this.tracingOn) this.traceRaw('lifecycle', `context ${status}: ${note}`);
      },
    });
    if (options.debug === true) this.setTracing(true);
  }

  // ---- AudioManager -----------------------------------------------------------------------------

  status(): ContextStatus {
    return this.ctl.status;
  }

  unlock(): void {
    this.router.unlock();
    this.ctl.unlock();
  }

  applySettings(levels: AudioLevels): void {
    const same = sameLevels(levels, this.levels);
    this.levels = levels;
    this.router.setLevels(levels);
    if (!same) this.applyBuses();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.router.setHidden(hidden);
    this.ctl.setHidden(hidden);
  }

  duck(key: DuckKey, levels: DuckLevels | null, mode: GameMode): void {
    this.applyDuck(key, levels, mode, null);
  }

  playMotif(motif: MotifRequest, delaySec: number, gainDb = 0): MotifHandle | null {
    const ctx = this.ctl.ctx;
    const g = this.graphNodes;
    const bank = this.soundBank;
    if (ctx === null || g === null || bank === null || this.ctl.status !== 'running') return null;
    if (this.levels.musicMuted || this.levels.soundMuted) return null;
    const buffer = bank.motif(motif);
    if (buffer === null) {
      if (this.tracingOn) this.traceRaw('motif', `motif ${motif.variant}@${motif.tempoScale}: not baked`);
      return null;
    }
    this.stopMotif(MOMENT_TIMING.motifFadeOnLeaveSec);
    const now = ctx.currentTime;
    const startsAt = now + Math.max(0.005, delaySec);
    // The moment's own trim (MOTIF_MOMENT_TRIM_DB and the attempt's scar): never above 0 dB.
    const trimDb = Number.isFinite(gainDb) ? Math.min(0, gainDb) : 0;
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(trimDb);
    gain.connect(g.motifBus);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(startsAt);
    const endsAt = startsAt + buffer.duration;
    const entry = { source, gain, startsAt, endsAt };
    this.motif = entry;
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // already disconnected
      }
      if (this.motif === entry) this.motif = null;
    };
    // The moment's hold must not outlive the motif by more than HOLD_SAFETY_SEC.
    this.router.limitHolds(endsAt - now);
    if (this.tracingOn) this.traceRaw('motif', `motif ${motif.variant}@${motif.tempoScale} at +${(startsAt - now).toFixed(2)} s, ${buffer.duration.toFixed(1)} s, ${trimDb.toFixed(1)} dB`);
    return {
      startsAt,
      endsAt,
      stop: (fadeSec: number) => {
        if (this.motif === entry) this.stopMotif(fadeSec);
      },
    };
  }

  stopMotif(fadeSec: number): void {
    const m = this.motif;
    const ctx = this.ctl.ctx;
    if (m === null || ctx === null) return;
    this.motif = null;
    const now = ctx.currentTime;
    const fade = Math.max(0.005, fadeSec);
    m.gain.gain.cancelScheduledValues(now);
    m.gain.gain.setValueAtTime(m.gain.gain.value, now);
    m.gain.gain.linearRampToValueAtTime(0, now + fade);
    try {
      m.source.stop(Math.max(now + fade + 0.02, m.startsAt));
    } catch {
      // never started or already stopped
    }
    if (this.tracingOn) this.traceRaw('motif', `motif stopped over ${fade.toFixed(2)} s`);
  }

  /**
   * A moment waits for this motif or comes next with it (null: none): the bank bakes it first
   * (prioritize) and, off play, at the loading pace until it is baked (bakePace). The epilogue's motif
   * is 34 s of piano: 3.1-3.7 s of main-thread work in headless Chrome before the render was made
   * cheaper, about 0.8 s after, and none where the motifs render in a Web Worker
   * (docs/evidence/AUDIO_RUNS.md, "Epilogue motif bake" and "Slow computers"). Every call is passed on
   * and traced, a repeat of the same motif too: the epilogue, waiting for the motif chapter 9's
   * Revelation asked for as the next one, asks for it itself. The callers ask only when what they want
   * changes, and the bank keeps the request while the motif is dropped and asked for again.
   */
  awaitMotif(motif: MotifRequest | null): void {
    this.awaited = motif;
    this.soundBank?.prioritize(motif);
    if (this.tracingOn) this.traceRaw('lifecycle', motif === null ? 'bake: no motif wanted by a moment' : `bake: motif ${motif.variant}@${motif.tempoScale} wanted by a moment: baked first, at the loading pace`);
  }

  /**
   * P1, Settings preview on slider release (DESIGN §5), throttled to PREVIEW_THROTTLE_SEC. Effects: a
   * stone hit at m 0.5 from 30 m. Ambience: a church strike from 120 m, St Bride's if it is baked,
   * else any baked bell, else nothing (a preview never requests a bake: that would evict the level's
   * set). The music dips by the 'preview' duck meanwhile. Only the main menu opens Settings, so no
   * session's pause gate is ever closed under a preview.
   */
  preview(kind: 'effects' | 'ambience'): void {
    const ctx = this.ctl.ctx;
    const bank = this.soundBank;
    if (ctx === null || bank === null || this.ctl.status !== 'running') return;
    const t = this.busNow();
    if (t - this.lastPreview < PREVIEW_THROTTLE_SEC) return;
    const now = ctx.currentTime;
    // The previews send to the shared space, which is closed for 2.3 s after an attempt ends.
    this.openSpace();
    let ok = false;
    if (kind === 'effects') {
      const m = 0.5;
      const buffer = bank.buffer('hit.stone.heavy', this.previewCount++ % SOUND_DEFS['hit.stone.heavy'].variants);
      ok =
        buffer !== null &&
        this.fx?.playRaw(buffer, {
          token: 0,
          family: 'hit',
          priority: 2,
          sound: 'hit.stone.heavy',
          when: now + 0.005,
          gain: dbToGain((HIT_LREF['hit.stone.heavy'] ?? -12) + COLLISION_MAG.spanDb * (m - 1)) * distanceGain(PREVIEW_HIT_M, SPATIAL.effects),
          lowpassHz: Math.min(COLLISION_MAG.lpBaseHz * Math.pow(2, COLLISION_MAG.lpOctaves * m), airLowpassHz(PREVIEW_HIT_M, SPATIAL.effects.refM)),
          pan: 0,
          send: 0.1,
          rate: COLLISION_MAG.rateTop - COLLISION_MAG.rateSlope * m,
        }) != null;
    } else {
      const order = ['st-brides', ...(Object.keys(BELL_VOICINGS) as BellVoicingId[]).filter((v) => v !== 'st-brides')] as BellVoicingId[];
      const voicing = order.find((v) => bank.bell(v, 'strike') !== null);
      const buffer = voicing !== undefined ? bank.bell(voicing, 'strike') : null;
      if (voicing !== undefined && buffer !== null) {
        const req: BellRequest = {
          slot: GLOBAL_LIMITS.bellStrips - 1,
          voicing,
          form: 'strike',
          when: now + 0.005,
          velocity: 1,
          gainLin: dbToGain(BELL_PATTERN.strikeDbAt40m) * distanceGain(PREVIEW_BELL_M, SPATIAL.bells),
          lowpassHz: airLowpassHz(PREVIEW_BELL_M, SPATIAL.bells.refM),
          pan: 0,
        };
        ok = this.bellPool?.play(0, req, buffer, dbToGain(BELL_VOICINGS[voicing].trimDb), 1, BELL_SEND) != null;
      }
    }
    if (!ok) return;
    this.lastPreview = t;
    this.applyDuck('preview', presetLevels('preview', 'arcade'), 'arcade', null);
    if (this.tracingOn) this.traceRaw('play', `preview ${kind}`);
  }

  prepare(set: LevelSoundSet): void {
    const key = JSON.stringify(set);
    if (key === this.preparedKey) return;
    this.preparedKey = key;
    this.prepared = set;
    // The bank bakes without a context: a set asked for on a menu starts baking at once, before the
    // first gesture, and is wrapped into AudioBuffers when the context runs.
    // (A bank built just now asks for the prepared set itself.)
    const existed = this.soundBank !== null;
    const bank = this.ensureBank();
    if (bank !== null && existed) this.requestLevel(bank, set);
    this.warm();
    if (this.tracingOn) this.traceRaw('lifecycle', `bake set: ${set.sounds.length} sounds, bells [${set.bells.join(', ')}], motifs [${set.motifs.map((m) => m.variant).join(', ')}]`);
  }

  setLoadingScreen(on: boolean): void {
    if (on === this.loadingScreen) return;
    this.loadingScreen = on;
    if (this.tracingOn) this.traceRaw('lifecycle', `bake pace: loading screen ${on ? 'up' : 'gone'}`);
  }

  /**
   * How much of the main thread the bake may take now (src/audio/synth/bank.ts BakePace): bigger timer
   * slices behind the loading overlay, idle time on menus and in a paused or finished run, at most
   * 4 ms in play. Off play, while a moment waits for (or comes next with) a motif still baking
   * (awaitMotif), the loading overlay's timer slices: the player is reading a panel then.
   */
  bakePace(): BakePace {
    if (this.loadingScreen) return 'loading';
    let playing = false;
    for (const s of this.sessions) {
      if (s.ended) continue;
      if (s.loading) return 'loading';
      if (s.phase === 'playing' || s.phase === 'intro') playing = true;
    }
    if (playing) return 'play';
    return this.awaitingMotif() ? 'loading' : 'idle';
  }

  /** A moment waits for a motif the bank cannot hand out yet. */
  private awaitingMotif(): boolean {
    const m = this.awaited;
    return m !== null && this.soundBank !== null && this.soundBank.motif(m) === null;
  }

  beginSession(info: SessionAudioInfo): SessionAudio {
    const s = new WebSession(++this.token, info, this);
    this.sessions.add(s);
    this.latest = s;
    const ctx = this.ctl.ctx;
    if (ctx !== null) this.graphNodes?.setShelfDb(info.mix.effectsShelfDb, ctx.currentTime);
    this.openSpace();
    if (this.tracingOn) this.traceRaw('lifecycle', `session ${s.token} begins: ${info.levelId} ${info.mode} attempt ${info.attempt} seed ${streamSeed(info.levelId, info.attempt, 'sfx', this.seed)}`, s.token);
    return s;
  }

  now(): number {
    return this.ctl.ctx?.currentTime ?? 0;
  }

  state(): AudioState {
    const ctx = this.ctl.ctx;
    const now = ctx?.currentTime ?? 0;
    const t = this.busNow();
    const mix = this.mixer.snapshot(t);
    const music = this.router.state();
    const ducks: Partial<Record<DuckKey, DuckLevels>> = {};
    const keys = new Set<DuckKey>([...(Object.keys(mix) as DuckKey[]), ...(Object.keys(music.ducks) as DuckKey[])]);
    for (const k of keys) ducks[k] = { music: music.ducks[k] ?? 0, ambience: mix[k]?.ambience ?? 0, effects: mix[k]?.effects ?? 0 };
    const sorted = Array.from(this.frameMs.subarray(0, Math.min(this.frameCount, this.frameMs.length))).sort((a, b) => a - b);
    const pct = (p: number): number => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
    const live = this.latest !== null && !this.latest.ended ? this.latest : null;
    return {
      available: true,
      status: this.ctl.status,
      seed: this.seed,
      sampleRate: ctx?.sampleRate ?? 0,
      hidden: this.hidden,
      paused: [...this.sessions].some((s) => s.gateClosed && !s.ended),
      levels: this.levels,
      buses: this.graphNodes?.values(now) ?? { master: 0, music: 0, ambience: 0, effects: 0, gate: 0 },
      ducks,
      voices: {
        active: (this.fx?.active(now) ?? 0) + (this.bellPool?.active(now) ?? 0),
        peak: this.fx?.peak ?? 0,
        byFamily: this.fx?.byFamily(now) ?? {},
      },
      bells: live?.bells ?? [],
      bank: this.soundBank?.stats() ?? EMPTY_BANK,
      session: live?.token ?? null,
      music,
      perf: { frameMsMedian: pct(0.5), frameMsP99: pct(0.99) },
    };
  }

  async dispose(): Promise<void> {
    for (const s of [...this.sessions]) s.end(0.01);
    this.stopMotif(0.01);
    this.router.dispose();
    if (this.busTicking) this.busTicker.stop();
    this.busTicking = false;
    this.fx?.dispose();
    this.bellPool?.dispose();
    this.graphNodes?.dispose();
    this.graphNodes = null;
    this.fx = null;
    this.bellPool = null;
    await this.ctl.dispose();
  }

  // ---- ManagerInternals ---------------------------------------------------------------------------

  graph(): AudioGraph | null {
    return this.graphNodes;
  }
  context(): BaseAudioContext | null {
    return this.ctl.ctx;
  }
  bank(): SoundBank | null {
    return this.soundBank;
  }
  effects(): EffectVoices | null {
    return this.fx;
  }
  bellVoices(): BellVoices | null {
    return this.bellPool;
  }
  get controller(): ContextController {
    return this.ctl;
  }
  get makeupDb(): number | undefined {
    return this.options.makeupDb;
  }
  get motifCalibDb(): number {
    return this.options.motifCalibDb ?? MOTIF_CALIB_DB;
  }
  setVariation(on: boolean): void {
    this.variation = on;
    if (this.fx) this.fx.variation = on;
  }

  fire(id: SoundRequest['layers'][number]['sound'], o: { gainDb: number; rate: number; lowpassHz: number; distM: number }): boolean {
    const ctx = this.ctl.ctx;
    const fx = this.fx;
    const buffer = this.soundBank?.buffer(id, 0) ?? null;
    if (ctx === null || fx === null || buffer === null || this.ctl.status !== 'running') return false;
    const d = Math.max(0, o.distM);
    const dist = d > 40 ? 40 / d : 1;
    const v = fx.playRaw(buffer, {
      token: 0,
      family: 'hit',
      priority: 2,
      sound: id,
      when: ctx.currentTime + 0.005,
      gain: dbToGain(o.gainDb) * dist,
      lowpassHz: o.lowpassHz,
      pan: 0,
      send: 0.1,
      rate: o.rate,
    });
    if (this.tracingOn) this.traceRaw('play', `injected ${id} ${o.gainDb} dB at ${d} m`);
    return v !== null;
  }

  bakeReport(): BakeReport {
    return {
      pace: this.bakePace(),
      loadingScreen: this.loadingScreen,
      awaitedMotif: this.awaited !== null && this.awaitingMotif() ? `${this.awaited.variant}@${this.awaited.tempoScale}` : null,
      time: this.pacer?.stats() ?? null,
      bank: this.soundBank?.stats() ?? EMPTY_BANK,
      notReady: Object.fromEntries(this.notReady),
      bellsNotReady: Object.fromEntries(this.bellsNotReady),
      warm: this.warmStarted ? { ...this.warmStats } : null,
    };
  }

  // ---- used by sessions ---------------------------------------------------------------------------

  countNotReady(sound: string, token: number): void {
    this.notReady.set(sound, (this.notReady.get(sound) ?? 0) + 1);
    let per = this.sessionNotReady.get(token);
    if (!per) this.sessionNotReady.set(token, (per = new Map()));
    per.set(sound, (per.get(sound) ?? 0) + 1);
  }

  countBellNotReady(what: string, token: number): void {
    this.bellsNotReady.set(what, (this.bellsNotReady.get(what) ?? 0) + 1);
    this.countNotReady(`bell ${what}`, token);
  }

  /** Duck timing from DUCK_PRESETS[key]; levels from the caller; null = release. */
  applyDuck(key: DuckKey, levels: DuckLevels | null, mode: GameMode, owner: WebSession | null): void {
    const preset = DUCK_PRESETS[key];
    if (presetLevels(key, mode) === null) return; // not in this mode (e.g. Arcade has no aftermath)
    const t = this.busNow();
    const releaseSec = releaseOf(key, owner);
    if (levels === null) {
      this.mixer.release(key, releaseSec, t);
      owner?.ducks.delete(key);
    } else {
      const hold = preset.holdSec === 'untilRelease' ? Infinity : preset.holdSec;
      this.mixer.set(key, levels, preset.attackSec, hold, releaseSec, t, duckOptions(key));
      owner?.ducks.add(key);
    }
    applyMusicDuck(this.router, key, levels, mode, releaseSec);
    if (this.tracingOn) {
      const what = levels === null ? 'release' : `${levels.music}/${levels.ambience}/${levels.effects} dB`;
      this.traceRaw('duck', `${key} ${what}`, owner?.token ?? 0);
    }
    this.stepBuses();
  }

  /** M11: a P0 voice started; music -3 dB, ambience -4 dB for a moment (both modes). */
  makeRoom(s: WebSession): void {
    this.applyDuck('makeRoom', presetLevels('makeRoom', s.info.mode), s.info.mode, s);
  }

  updatePauseGate(): void {
    const ctx = this.ctl.ctx;
    if (ctx === null || this.graphNodes === null) return;
    const closed = [...this.sessions].some((s) => s.gateClosed && !s.ended);
    this.graphNodes.setGate(!closed, ctx.currentTime);
    if (this.tracingOn) this.traceRaw('lifecycle', closed ? 'pause gate closed' : 'pause gate open');
  }

  sessionLoading(s: WebSession, loading: boolean): void {
    const ctx = this.ctl.ctx;
    if (ctx === null || s.nodes === null) return;
    const now = ctx.currentTime;
    for (const n of [s.nodes.ambience, s.nodes.effects, s.nodes.space]) n.rampTo(loading ? 0 : 1, now, loading ? 0.05 : AMBIENCE_FADE_IN_SEC);
  }

  /** The session's ambience voices, when the context runs and the bank's core set and noise are ready. */
  buildAmbience(s: WebSession): AmbienceVoices | null {
    const ctx = this.ctl.ctx;
    const g = this.graphNodes;
    const bank = this.soundBank;
    const factory = this.synthesis.createAmbienceVoices;
    if (ctx === null || g === null || bank === null || factory === null || this.ctl.status !== 'running') return null;
    const noise = this.noiseBank(ctx);
    if (noise === null || !bank.ready('scrape.grit')) return null;
    if (s.nodes === null) {
      const level = s.loading ? 0 : 1;
      const mk = (to: AudioNode): RampedGain => {
        const r = new RampedGain(ctx, 0);
        r.node.connect(to);
        r.rampTo(level, ctx.currentTime, level > 0 ? AMBIENCE_FADE_IN_SEC : 0);
        return r;
      };
      s.nodes = { ambience: mk(g.ambienceIn), effects: mk(g.effectsIn), space: mk(g.ambSendIn) };
    }
    const voices = factory(ctx, { ambience: s.nodes.ambience.node, effects: s.nodes.effects.node, space: s.nodes.space.node }, noise, bank, streamSeed(s.info.levelId, s.info.attempt, 'amb', this.seed));
    voices.setTimbre({ wind: s.info.mix.wind, waterTopDb: s.info.mix.waterTopDb });
    return voices;
  }

  /** Open the shared space's return (it was closed when the last attempt ended). */
  private openSpace(): void {
    this.spaceGen++;
    const ctx = this.ctl.ctx;
    if (ctx !== null) this.graphNodes?.setSpaceOpen(true, ctx.currentTime, 0.05);
  }

  endSession(s: WebSession, fadeSec: number, amb: AmbienceVoices | null): void {
    this.sessions.delete(s);
    const ctx = this.ctl.ctx;
    const now = ctx?.currentTime ?? 0;
    const voices = this.fx?.endSession(s.token, fadeSec, now) ?? 0;
    this.bellPool?.endSession(s.token, fadeSec, now);
    if (amb !== null) amb.stop(fadeSec);
    const nodes = s.nodes;
    if (nodes !== null && ctx !== null) {
      for (const n of [nodes.ambience, nodes.effects, nodes.space]) n.rampTo(0, now, fadeSec);
      this.timers.setTimeout(() => {
        for (const n of [nodes.ambience, nodes.effects, nodes.space]) {
          try {
            n.node.disconnect();
          } catch {
            // already disconnected
          }
        }
      }, Math.max(END_DISCONNECT_MS, fadeSec * 1000 + 80));
    }
    s.nodes = null;
    for (const key of [...s.ducks]) this.applyDuck(key, null, s.info.mode, s);
    // The Act III entry hold belongs to the attempt; a newer live attempt may hold it for itself.
    if (![...this.sessions].some((o) => !o.ended)) this.router.release('act3Entry');
    if (s.gateClosed) {
      s.gateClosed = false;
      // Reopen once this session's voices have stopped, so nothing of it is heard on the way up.
      this.timers.setTimeout(() => this.updatePauseGate(), END_DISCONNECT_MS);
    }
    if (this.latest === s) this.latest = null;
    // The last live attempt is gone (the menu, a results screen): close the shared space's return with
    // the attempt's own fade, so its reverb tail does not ring on for 2.2 s, and open it once the
    // convolver has emptied (or at once when the next attempt begins, or for a Settings preview).
    if (ctx !== null && ![...this.sessions].some((o) => !o.ended)) {
      this.graphNodes?.setSpaceOpen(false, now, Math.max(0.005, fadeSec));
      const gen = ++this.spaceGen;
      this.timers.setTimeout(() => {
        if (gen === this.spaceGen) this.openSpace();
      }, (SPACE.irSeconds + fadeSec) * 1000 + 100);
    }
    if (this.tracingOn) this.traceRaw('lifecycle', `session ${s.token} ends: ${voices} voices faded over ${fadeSec.toFixed(3)} s`, s.token);
    // What this attempt asked for and could not play because its buffer was not baked yet.
    const missed = this.sessionNotReady.get(s.token);
    this.sessionNotReady.delete(s.token);
    if (missed && missed.size > 0 && this.tracingOn) {
      const list = [...missed].map(([k, n]) => `${k} ×${n}`).join(', ');
      this.traceRaw('lifecycle', `session ${s.token} notReady drops: ${list}`, s.token);
    }
  }

  recordFrameMs(ms: number): void {
    this.frameMs[this.frameCount % this.frameMs.length] = ms;
    this.frameCount++;
  }

  // ---- context lifecycle --------------------------------------------------------------------------

  private onCreated(ctx: AudioContext): void {
    const ir = this.synthesis.generateSpaceIR?.(ctx.sampleRate, SPACE.irSeconds, this.seed) ?? null;
    const g = new AudioGraph(ctx, {
      spaceIR: ir,
      meters: this.tracingOn,
      makeupDb: this.options.makeupDb,
      motifCalibDb: this.motifCalibDb,
    });
    this.graphNodes = g;
    this.fx = new EffectVoices(ctx, g.effectsIn, g.fxSendIn, () => this.soundBank);
    this.fx.variation = this.variation;
    this.bellPool = new BellVoices(ctx, g.ambienceIn, g.ambSendIn);
    g.applyLevels(this.levels, this.mixer.sum('ambience', this.busNow()), this.mixer.sum('effects', this.busNow()), ctx.currentTime, 0);
    if (this.hidden) g.setHiddenGate(false, ctx.currentTime);
    if (this.latest !== null) g.setShelfDb(this.latest.info.mix.effectsShelfDb, ctx.currentTime);
    this.ensureBank();
    if (this.tracingOn) this.traceRaw('lifecycle', `graph built: ${g.nodeCount + (GLOBAL_LIMITS.effectStrips + GLOBAL_LIMITS.bellStrips) * 4} nodes at ${ctx.sampleRate} Hz`);
  }

  private onRunning(ctx: AudioContext): void {
    if (this.soundBank !== null && this.attachedCtx !== ctx) {
      this.soundBank.attach(ctx);
      this.attachedCtx = ctx;
    }
    this.noiseBank(ctx);
    this.applyBuses();
    this.updatePauseGate();
  }

  private onClosed(): void {
    this.fx?.dispose();
    this.bellPool?.dispose();
    this.graphNodes?.dispose();
    this.graphNodes = null;
    this.fx = null;
    this.bellPool = null;
    this.noise = null;
    this.noiseCtx = null;
    this.attachedCtx = null;
    this.motif = null;
    for (const s of this.sessions) s.detach();
  }

  private noiseBank(ctx: BaseAudioContext): NoiseBank | null {
    if (this.noiseCtx === ctx) return this.noise;
    const make = this.synthesis.createNoiseBank;
    if (make === null) return null;
    this.noise = make(ctx, this.seed);
    this.noiseCtx = ctx;
    return this.noise;
  }

  /** The bank's slice scheduler, made once (package B's pacedScheduler unless a test passes its own). */
  private sliceScheduler(): SliceScheduler {
    if (this.scheduler !== null) return this.scheduler;
    let scheduler = this.options.scheduler;
    if (scheduler === undefined) {
      this.pacer = pacedScheduler(() => this.bakePace());
      scheduler = this.pacer;
    }
    this.scheduler = scheduler;
    return scheduler;
  }

  /**
   * Before the first gesture, in the bake's idle slices on the menu: the noise bank's samples and the
   * space IR (at WARM_SAMPLE_RATE), which need no context. The gesture that builds the context then
   * only wraps them (lead decision L2: the click's main-thread task was 0.5-0.56 s, 0.1 s of it the
   * noise bank and 0.04-0.05 s the IR). Stops once a context exists: anything left is made then.
   */
  private warm(): void {
    if (this.warmStarted || this.ctl.ctx !== null) return;
    const make = this.synthesis.warmSteps;
    if (!make) return;
    this.warmStarted = true;
    const steps = make(this.seed, WARM_SAMPLE_RATE);
    const st = this.warmStats;
    st.steps = steps.length;
    const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.sliceScheduler()((deadlineMs) => {
      if (this.ctl.ctx !== null) return false;
      // At least one step a slice; a step (5-25 ms) may overrun the slice, as a bake recipe may.
      do {
        const t0 = clock();
        steps[st.done++]();
        st.ms += clock() - t0;
      } while (st.done < steps.length && clock() < deadlineMs);
      if (st.done < steps.length) return true;
      st.complete = true;
      if (this.tracingOn) this.traceRaw('lifecycle', `warm: noise bank and space IR (${WARM_SAMPLE_RATE} Hz) made before the gesture, ${st.ms.toFixed(0)} ms in ${steps.length} steps`);
      return false;
    });
  }

  /**
   * The bank, created on the first prepare() or with the first context, whichever comes first, with
   * the core requested at once. Baking needs no context; buffers are wrapped once one runs.
   */
  private ensureBank(): SoundBank | null {
    if (this.soundBank !== null || this.synthesis.createSoundBank === null) return this.soundBank;
    this.soundBank = this.synthesis.createSoundBank(this.sliceScheduler(), this.seed);
    this.soundBank.request({ scope: 'core' });
    if (this.prepared !== null) this.requestLevel(this.soundBank, this.prepared);
    // A motif asked for before there was a bank is still wanted.
    if (this.awaited !== null) this.soundBank.prioritize(this.awaited);
    const ctx = this.ctl.ctx;
    if (ctx !== null && this.ctl.status === 'running' && this.attachedCtx !== ctx) {
      this.soundBank.attach(ctx);
      this.attachedCtx = ctx;
    }
    return this.soundBank;
  }

  /** The bank replaces its level set by difference: what the old and new sets share stays baked. */
  private requestLevel(bank: SoundBank, set: LevelSoundSet): void {
    bank.request({ scope: 'level', set });
  }

  // ---- buses and ducks ----------------------------------------------------------------------------

  private busNow(): number {
    return this.busTicker.now() / 1000;
  }

  /** Push the levels and the current duck sums to the bus gains (30 ms ramps: at most 30 ms behind). */
  private applyBuses(): void {
    const ctx = this.ctl.ctx;
    const g = this.graphNodes;
    if (ctx === null || g === null) return;
    const t = this.busNow();
    g.applyLevels(this.levels, this.mixer.sum('ambience', t), this.mixer.sum('effects', t), ctx.currentTime);
  }

  /** Follow the duck ramps on ambience and effects at 20 Hz while anything moves. */
  private stepBuses(): void {
    this.applyBuses();
    const moving = !this.mixer.settled(this.busNow());
    if (moving && !this.busTicking) {
      this.busTicking = true;
      this.busTicker.start(() => {
        this.applyBuses();
        if (this.mixer.settled(this.busNow())) {
          this.applyBuses();
          this.busTicking = false;
          this.busTicker.stop();
        }
      });
    }
  }
}

// =================================================================================================
// The singleton
// =================================================================================================

export function createAudioManager(options: AudioManagerOptions = {}): EngineAudioManager {
  const available = options.available ?? audioAvailable();
  return available ? new WebAudioManager(options) : new NullAudioManager(options);
}

export const audio: EngineAudioManager = createAudioManager();

if (debugEnabled()) installAudioDebug(audio);

// Vite HMR (development only): the engine cannot be swapped in place. Without this, an edit here or
// below propagated to the React refresh boundaries, which re-evaluated this module (a second
// AudioContext, a second bank) while Vite ran only those boundaries' dispose hooks, never this one:
// every edit left the previous context running. So this module accepts its own updates (and those of
// the modules under it): Vite then disposes the live engine here, and the page reloads with one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => void audio.dispose());
  import.meta.hot.accept(() => window.location.reload());
}
