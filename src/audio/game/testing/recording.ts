/**
 * Test doubles for the bridge (DESIGN §9: "C tests its router against its own RecordingSessionAudio").
 * They implement the contract's SessionAudio and AudioManager, record every call as plain data and
 * play nothing. The session applies the engine's per-frame admission cap (4 requests) so tests can
 * check what would have been admitted; everything else the engine does is left out on purpose.
 */
import { createRng } from '../../../core/rng';
import type { GameMode } from '../../../state/appStore';
import {
  GLOBAL_LIMITS,
  MOTIF_SCORES,
  SEED,
  type AmbienceTimbre,
  type AmbienceVoices,
  type AudioLevels,
  type AudioManager,
  type AudioState,
  type BellRequest,
  type BellVoicingId,
  type ContextStatus,
  type DuckKey,
  type DuckLevels,
  type EmitterSlotInputs,
  type FallSlotInputs,
  type FloodInputs,
  type LevelSoundSet,
  type ListenerPose,
  type MotifHandle,
  type MotifRequest,
  type MusicHoldKey,
  type MusicRouter,
  type MusicRouterState,
  type OceanInputs,
  type PlayResult,
  type PositionalVoice,
  type RngStream,
  type ScrapeInputs,
  type SessionAudio,
  type SessionAudioInfo,
  type SoundRequest,
  type TraceEntry,
  type VoiceLayer,
  type WaterInputs,
  type WindInputs,
} from '../../contract';
import type { GamePhase } from '../../../core/types';
import type { MusicCue } from '../../../story/types';

/** FNV-1a over the parts: the same seed derivation idea as the engine's streams (contract §0). */
export function fakeStreamSeed(...parts: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = `${String(p)}\u001f`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** One admitted or refused play() call, copied (the router reuses its request objects). */
export interface RecordedPlay {
  readonly frame: number;
  readonly family: SoundRequest['family'];
  readonly priority: SoundRequest['priority'];
  readonly layers: readonly VoiceLayer[];
  readonly positional: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly key: number;
  readonly cause: number;
  readonly startDelaySec: number;
  readonly send: number | undefined;
  readonly reason: PlayResult['reason'];
}

export interface RecordedBell extends BellRequest {
  readonly frame: number;
  updates: number;
  choked: number | null;
}

/** Records every ambience update (counts and the last inputs) without making a sound. */
export class RecordingAmbience implements AmbienceVoices {
  readonly counts = { wind: 0, scrape: 0, water: 0, falls: 0, ocean: 0, flood: 0, emitters: 0, surge: 0 };
  last: {
    wind?: WindInputs;
    scrape?: ScrapeInputs;
    water?: WaterInputs;
    ocean?: OceanInputs;
    flood?: FloodInputs;
    falls: (FallSlotInputs | undefined)[];
  } = { falls: [] };
  timbre: AmbienceTimbre | null = null;
  stopped: number | null = null;
  readonly scrapeLog: ScrapeInputs[] = [];
  keepScrapeLog = false;

  readonly wind = { update: (i: WindInputs): void => void (this.counts.wind++, (this.last.wind = { ...i })) };
  readonly scrape = {
    update: (i: ScrapeInputs): void => {
      this.counts.scrape++;
      this.last.scrape = { ...i };
      if (this.keepScrapeLog) this.scrapeLog.push({ ...i });
    },
  };
  readonly water = { update: (i: WaterInputs): void => void (this.counts.water++, (this.last.water = { ...i })) };
  readonly falls = [0, 1, 2].map((k) => ({
    update: (i: FallSlotInputs): void => {
      this.counts.falls++;
      this.last.falls[k] = { ...i };
    },
  }));
  readonly ocean = {
    update: (i: OceanInputs): void => void (this.counts.ocean++, (this.last.ocean = { ...i })),
    surge: (): void => void this.counts.surge++,
  };
  readonly flood = { update: (i: FloodInputs): void => void (this.counts.flood++, (this.last.flood = { ...i })) };
  readonly emitters = [0, 1, 2, 3].map(() => ({ update: (_i: EmitterSlotInputs): void => void this.counts.emitters++ }));

  setTimbre(t: AmbienceTimbre): void {
    this.timbre = t;
  }

  stop(fadeSec: number): void {
    this.stopped = fadeSec;
  }
}

export interface RecordingSessionOptions {
  /** Ambience voices to hand out (default: a RecordingAmbience). null = never ready. */
  readonly ambience?: AmbienceVoices | null;
  /** Context clock (defaults to a manual one owned by the session). */
  readonly now?: () => number;
  readonly tracing?: boolean;
  /** Which voicings' strikes are baked (default: all). Tests flip it to exercise the deferral. */
  readonly bellReady?: (voicing: BellVoicingId) => boolean;
}

export class RecordingSessionAudio implements SessionAudio {
  readonly plays: RecordedPlay[] = [];
  readonly bells: RecordedBell[] = [];
  readonly ducks: { key: DuckKey; levels: DuckLevels | null; frame: number }[] = [];
  readonly phases: { phase: GamePhase; loading: boolean }[] = [];
  readonly traces: TraceEntry[] = [];
  readonly listener: ListenerPose = { px: 0, py: 0, pz: 0, rightX: 1, rightZ: 0, fwdX: 0, fwdZ: -1 };
  reported: unknown = null;
  frame = 0;
  admittedThisFrame = 0;
  maxAdmittedInFrame = 0;
  ended: number | null = null;
  endCalls = 0;
  readonly tracing: boolean;
  private readonly amb: AmbienceVoices | null;
  private readonly rngs = new Map<RngStream, () => number>();
  private clock = 0;
  private readonly nowFn: () => number;

  constructor(
    readonly token: number,
    readonly info: SessionAudioInfo,
    options: RecordingSessionOptions = {},
  ) {
    this.amb = options.ambience === undefined ? new RecordingAmbience() : options.ambience;
    this.nowFn = options.now ?? (() => this.clock);
    this.tracing = options.tracing ?? true;
    if (options.bellReady) this.bellReadyFn = options.bellReady;
  }

  /** Advance the session's own context clock (when it owns one). */
  advance(seconds: number): void {
    this.clock += seconds;
  }

  now(): number {
    return this.nowFn();
  }

  get ambience(): AmbienceVoices | null {
    return this.ended === null ? this.amb : null;
  }

  rng(stream: RngStream): () => number {
    let r = this.rngs.get(stream);
    if (!r) {
      r = createRng(fakeStreamSeed(SEED, this.info.levelId, this.info.attempt, stream));
      this.rngs.set(stream, r);
    }
    return r;
  }

  play(req: SoundRequest): PlayResult {
    let reason: PlayResult['reason'] = null;
    if (this.ended !== null) reason = 'disabled';
    else if (this.admittedThisFrame >= GLOBAL_LIMITS.maxRequestsPerFrame) reason = 'frameCap';
    const layers: VoiceLayer[] = [];
    for (let i = 0; i < req.layerCount; i++) layers.push({ ...req.layers[i] });
    this.plays.push({
      frame: this.frame,
      family: req.family,
      priority: req.priority,
      layers,
      positional: req.positional,
      x: req.x,
      y: req.y,
      z: req.z,
      key: req.key,
      cause: req.cause,
      startDelaySec: req.startDelaySec,
      send: req.send,
      reason,
    });
    if (reason === null) {
      this.admittedThisFrame++;
      this.maxAdmittedInFrame = Math.max(this.maxAdmittedInFrame, this.admittedThisFrame);
    }
    if (this.tracing) {
      this.traces.push({
        seq: this.traces.length + 1,
        t: this.now(),
        gt: 0,
        token: this.token,
        frame: this.frame,
        kind: reason === null ? 'play' : 'drop',
        cause: req.cause,
        sound: req.layerCount > 0 ? req.layers[0].sound : undefined,
        family: req.family,
        priority: req.priority,
        gainDb: req.layerCount > 0 ? req.layers[0].gainDb : undefined,
        reason: reason ?? undefined,
      });
    }
    return reason === null ? { started: req.layerCount, reason: null } : { started: 0, reason };
  }

  /** Calls of bellReady, by voicing (what the scheduler asked). */
  readonly bellReadyAsks = new Map<BellVoicingId, number>();
  bellReadyFn: (voicing: BellVoicingId) => boolean = () => true;

  bellReady(voicing: BellVoicingId): boolean {
    this.bellReadyAsks.set(voicing, (this.bellReadyAsks.get(voicing) ?? 0) + 1);
    return this.ended !== null || this.bellReadyFn(voicing);
  }

  playBell(req: BellRequest): PositionalVoice | null {
    if (this.ended !== null) return null;
    const rec: RecordedBell = { ...req, frame: this.frame, updates: 0, choked: null };
    this.bells.push(rec);
    const length = req.form === 'strike' ? 9 : req.form === 'shiver' ? 4 : 1.5;
    return {
      endsAt: req.when + length,
      update: () => {
        rec.updates++;
      },
      choke: (tau) => {
        rec.choked = tau;
      },
    };
  }

  setListener(pose: Readonly<ListenerPose>): void {
    Object.assign(this.listener, pose);
  }

  setPhase(phase: GamePhase, loading: boolean): void {
    this.phases.push({ phase, loading });
  }

  beginFrame(frame: number): void {
    this.frame = frame;
    this.admittedThisFrame = 0;
  }

  duck(key: DuckKey, levels: DuckLevels | null): void {
    this.ducks.push({ key, levels: levels === null ? null : { ...levels }, frame: this.frame });
  }

  trace(entry: TraceEntry): void {
    if (this.tracing) this.traces.push({ ...entry, seq: this.traces.length + 1 });
  }

  reportBells(bells: AudioState['bells']): void {
    this.reported = bells;
  }

  end(fadeSec = 0.12): void {
    this.endCalls++;
    if (this.ended === null) this.ended = fadeSec;
  }

  /** Requests admitted (not refused by the frame cap or after end()). */
  get admitted(): RecordedPlay[] {
    return this.plays.filter((p) => p.reason === null);
  }
}

/** Seconds a motif lasts at a tempo (onsets, ritardando, fermata and ring-out), for the fake handle. */
export function motifSeconds(m: MotifRequest): number {
  const s = MOTIF_SCORES[m.variant];
  const beatSec = (bpm: number): number => 60 / (bpm * m.tempoScale);
  let t = 0;
  for (let b = 0; b < s.totalBeats; b++) {
    const r = s.ritardando;
    const bpm = r && b >= r.fromBeat ? s.bpm + ((r.toBpm - s.bpm) * (b - r.fromBeat + 1)) / (s.totalBeats - r.fromBeat) : s.bpm;
    t += beatSec(bpm);
  }
  const lastBpm = s.ritardando ? s.ritardando.toBpm : s.bpm;
  return t + s.fermataBeats * beatSec(lastBpm) + s.tailSec;
}

export class RecordingRouter implements MusicRouter {
  readonly calls: string[] = [];
  cue: MusicCue | null = null;
  trimDb = 0;
  levels: AudioLevels | null = null;
  hidden = false;
  readonly holds = new Set<MusicHoldKey>();
  readonly ducks = new Map<DuckKey, number>();
  unlocked = 0;

  setCue(cue: MusicCue | null): void {
    this.calls.push(`cue ${cue}`);
    this.cue = cue;
  }
  setLevels(levels: AudioLevels): void {
    this.levels = levels;
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }
  setTrim(db: number): void {
    this.calls.push(`trim ${db}`);
    this.trimDb = db;
  }
  hold(key: MusicHoldKey): void {
    this.calls.push(`hold ${key}`);
    this.holds.add(key);
  }
  release(key: MusicHoldKey): void {
    this.calls.push(`release ${key}`);
    this.holds.delete(key);
  }
  duck(key: DuckKey, db: number): void {
    this.ducks.set(key, db);
  }
  unduck(key: DuckKey): void {
    this.ducks.delete(key);
  }
  unlock(): void {
    this.unlocked++;
  }
  state(): MusicRouterState {
    return {
      cue: this.cue,
      playing: this.holds.size > 0 ? null : this.cue,
      holds: [...this.holds],
      ducks: Object.fromEntries(this.ducks),
      // The recorder's ducks have no ramps: each is at its target.
      targets: Object.fromEntries(this.ducks),
      duckDb: 0,
      trimDb: this.trimDb,
      volume: 0,
      muted: false,
      hidden: this.hidden,
    };
  }
}

export interface RecordedMotif {
  readonly motif: MotifRequest;
  readonly delaySec: number;
  /** The moment's trim passed to playMotif (0 when none was). */
  readonly gainDb: number;
  readonly at: number;
  stopped: number | null;
}

export interface RecordingManagerOptions {
  readonly available?: boolean;
  /** null from playMotif (not baked, muted): exercises the no-motif paths. */
  readonly motifs?: boolean;
  readonly session?: RecordingSessionOptions;
}

export class RecordingAudioManager implements AudioManager {
  readonly available: boolean;
  readonly seed = SEED;
  readonly music = new RecordingRouter();
  readonly sessions: RecordingSessionAudio[] = [];
  readonly prepared: LevelSoundSet[] = [];
  readonly ducks: { key: DuckKey; levels: DuckLevels | null; mode: GameMode }[] = [];
  readonly motifs: RecordedMotif[] = [];
  readonly settings: AudioLevels[] = [];
  readonly calls: string[] = [];
  hidden = false;
  unlocks = 0;
  statusValue: ContextStatus;
  clock = 0;
  /** False: playMotif returns null (not baked, muted). Tests flip it to bake a motif late. */
  motifsReady: boolean;

  constructor(private readonly options: RecordingManagerOptions = {}) {
    this.available = options.available ?? true;
    this.statusValue = this.available ? 'locked' : 'unavailable';
    this.motifsReady = options.motifs ?? true;
  }

  status(): ContextStatus {
    return this.statusValue;
  }
  unlock(): void {
    this.unlocks++;
    this.music.unlock();
    if (this.available) this.statusValue = 'running';
  }
  applySettings(levels: AudioLevels): void {
    this.settings.push(levels);
    this.music.setLevels(levels);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.music.setHidden(hidden);
  }
  duck(key: DuckKey, levels: DuckLevels | null, mode: GameMode): void {
    this.ducks.push({ key, levels: levels === null ? null : { ...levels }, mode });
  }
  playMotif(motif: MotifRequest, delaySec: number, gainDb = 0): MotifHandle | null {
    if (!this.available || !this.motifsReady) return null;
    const rec: RecordedMotif = { motif: { ...motif }, delaySec, gainDb, at: this.clock, stopped: null };
    for (const m of this.motifs) if (m.stopped === null) m.stopped = 1.5;
    this.motifs.push(rec);
    const startsAt = this.clock + delaySec;
    return {
      startsAt,
      endsAt: startsAt + motifSeconds(motif),
      stop: (fade) => {
        if (rec.stopped === null) rec.stopped = fade;
      },
    };
  }
  stopMotif(fadeSec: number): void {
    this.calls.push(`stopMotif ${fadeSec}`);
    for (const m of this.motifs) if (m.stopped === null) m.stopped = fadeSec;
  }
  /** Every awaitMotif call, as 'variant@tempo' or null, in order. */
  readonly awaited: (string | null)[] = [];
  awaitMotif(motif: MotifRequest | null): void {
    this.awaited.push(motif === null ? null : `${motif.variant}@${motif.tempoScale}`);
  }
  preview(kind: 'effects' | 'ambience'): void {
    this.calls.push(`preview ${kind}`);
  }
  prepare(set: LevelSoundSet): void {
    this.prepared.push(set);
  }
  /** Every setLoadingScreen call, in order. */
  readonly loadingScreens: boolean[] = [];
  setLoadingScreen(on: boolean): void {
    this.loadingScreens.push(on);
  }
  beginSession(info: SessionAudioInfo): SessionAudio {
    const s = new RecordingSessionAudio(this.sessions.length + 1, info, { now: () => this.clock, ...this.options.session });
    this.sessions.push(s);
    return s;
  }
  now(): number {
    return this.clock;
  }
  state(): AudioState {
    return {
      available: this.available,
      status: this.statusValue,
      seed: SEED,
      sampleRate: 48000,
      hidden: this.hidden,
      paused: false,
      levels: this.settings[this.settings.length - 1] ?? {
        master: 1,
        music: 0.6,
        ambience: 0.8,
        effects: 0.8,
        musicMuted: false,
        soundMuted: false,
      },
      buses: { master: 1, music: 1, ambience: 1, effects: 1, gate: 1 },
      ducks: {},
      voices: { active: 0, peak: 0, byFamily: {} },
      bells: [],
      bank: { ready: 0, pending: 0, bytes: 0, checksum: '' },
      session: this.sessions.length > 0 ? this.sessions[this.sessions.length - 1].token : null,
      music: this.music.state(),
      perf: { frameMsMedian: 0, frameMsP99: 0 },
    };
  }
  async dispose(): Promise<void> {}

  /** The latest session (tests). */
  get session(): RecordingSessionAudio {
    const s = this.sessions[this.sessions.length - 1];
    if (!s) throw new Error('no session begun');
    return s;
  }
}
