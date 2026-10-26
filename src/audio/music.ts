/**
 * Background music by cue (src/story/types.ts MusicCue; recordings in ./tracks.ts). Safe to call at any
 * time and in any environment: the UI calls play/setVolume/setMuted from React effects and unlock()
 * from the first click or key press (src/ui/story/music.ts).
 *
 * WHY HTMLAudioElement and not decoded WebAudio buffers: the tracks are 3–6 minute recordings, and
 * decodeAudioData would hold each one as raw float PCM (tens of MB per track); a media element streams
 * the mp3 instead. Crossfades are volume ramps on the elements, stepped by a ticker, so the whole state
 * machine runs against a fake backend and a manual clock in tests.
 *
 * Browser autoplay rules: play() only works after a user gesture, so a cue asked for before unlock()
 * is remembered and started inside the unlock() call (still on the gesture's call stack). If the
 * browser rejects it anyway (NotAllowedError) the player relocks and the next unlock() retries.
 *
 * Lazy loading: a track's element (and so its download) is created the first time its cue must
 * actually sound: never before unlock, never while muted. Elements are then kept, so going back to
 * an earlier cue resumes it rather than fetching again.
 *
 * Never silent: each cue plays a playlist (./tracks.ts CUE_PLAYLISTS), its own recording first. When a
 * recording ends the next fades in and the list wraps round; a recording that fails to load is skipped
 * for the next (once round the list at most, until the cue changes). A one-track playlist simply loops.
 *
 * Loudness: each recording plays at the volume it is given times its own cut (gainFor, by default
 * ./tracks.ts recordingGain), so every file is heard at the same integrated loudness and moving on to
 * the next file of a playlist never makes the music louder.
 *
 * Nothing is persisted here: the settings screen owns volume and mute and pushes them in.
 */
import type { MusicCue } from '../story/types';
import { playlistUrls, recordingGain } from './tracks';

export interface MusicPlayer {
  /** Cross-fade to a cue; null fades out. */
  play(cue: MusicCue | null): void;
  /** 0..1 */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Call from a user gesture (click/keydown) to unlock audio. */
  unlock(): void;
}

/** One recording as the player drives it. HTMLAudioElement satisfies this as is. */
export interface AudioVoice {
  volume: number;
  muted: boolean;
  /** Loop natively (a cue whose playlist has only this recording). */
  loop?: boolean;
  /** A promise that may reject (autoplay blocked, file missing), or nothing in older engines. */
  play(): Promise<void> | void;
  pause(): void;
}

/** How a voice is made: whether it loops itself, and what to call when it ends or fails to load. */
export interface VoiceOptions {
  readonly loop: boolean;
  readonly onEnded: () => void;
  readonly onError: () => void;
}

export interface AudioBackend {
  /** A not yet playing voice for a URL. Called lazily, at most once per recording. */
  create(url: string, options?: VoiceOptions): AudioVoice;
}

/** Steps the crossfade. start() calls onTick repeatedly until stop(); now() is in milliseconds. */
export interface FadeTicker {
  now(): number;
  start(onTick: () => void): void;
  stop(): void;
}

/** Crossfade length. 3 s sits inside the 2–4 s the design asks for: slow enough to feel like one
 *  piece handing over to the next, quick enough that a chapter's music has arrived by its first line. */
export const CROSSFADE_MS = 3000;
/** Same as the settings default (src/state/appStore.ts), used until the settings push theirs in. */
export const DEFAULT_VOLUME = 0.6;
/** 20 Hz volume steps: 60 steps per crossfade, inaudible as steps. Background tabs throttle the
 *  interval, but each step uses elapsed time, so a fade still ends on schedule. */
const TICK_MS = 50;

interface Voice {
  /** The cue that first asked for this recording (a recording can be in several playlists). */
  readonly cue: MusicCue;
  readonly url: string;
  readonly el: AudioVoice;
  /** Fade position, 0 silent .. 1 full. The element's volume follows an equal-power curve of it. */
  level: number;
  target: 0 | 1;
  playing: boolean;
  /** Which play() call is current, so a late rejection from an older call is ignored. */
  attempt: number;
}

export interface VoiceState {
  readonly cue: MusicCue;
  readonly level: number;
  readonly target: 0 | 1;
  readonly playing: boolean;
  readonly volume: number;
}

export interface MusicPlayerState {
  readonly unlocked: boolean;
  /** The cue asked for last (queued while locked or muted). */
  readonly cue: MusicCue | null;
  readonly volume: number;
  readonly muted: boolean;
  readonly fading: boolean;
  readonly voices: readonly VoiceState[];
}

export interface MusicPlayerOptions {
  /** null when the environment has no audio: every call is then a safe no-op. */
  readonly backend: AudioBackend | null;
  readonly ticker: FadeTicker;
  readonly fadeMs?: number;
  /** The recordings of a cue, in order (default: ./tracks.ts playlistUrls). */
  readonly playlistFor?: (cue: MusicCue) => readonly string[];
  /** One recording per cue, looping (tests and simple setups); ignored when playlistFor is given. */
  readonly urlFor?: (cue: MusicCue) => string;
  /**
   * A recording's own gain (linear, 0..1) on top of the volume: its loudness match. Default: 1 when a
   * playlistFor or urlFor is given (tests), else ./tracks.ts recordingGain.
   */
  readonly gainFor?: (url: string) => number;
  /**
   * Called (once per block) when the browser refuses play() despite unlock(): retry() should run on
   * the next user gesture. Needed because the UI unlocks on the first pointerdown, which counts as
   * a gesture for a mouse but not for touch, and it does not listen again afterwards.
   */
  readonly onBlocked?: (retry: () => void) => void;
}

/** Equal-power curve: an outgoing voice at x and an incoming one at 1−x keep a constant loudness. */
function equalPower(level: number): number {
  return Math.sin((Math.min(1, Math.max(0, level)) * Math.PI) / 2);
}

export class CrossfadeMusicPlayer implements MusicPlayer {
  private readonly backend: AudioBackend | null;
  private readonly ticker: FadeTicker;
  private readonly fadeMs: number;
  private readonly playlistFor: (cue: MusicCue) => readonly string[];
  private readonly gainFor: (url: string) => number;
  /** Voices by recording URL. */
  private readonly voices = new Map<string, Voice>();
  /** Where each cue is in its playlist, and its failures in a row (reset when the cue changes). */
  private readonly position = new Map<MusicCue, number>();
  private readonly failures = new Map<MusicCue, number>();
  private cue: MusicCue | null = null;
  private volume = DEFAULT_VOLUME;
  private muted = false;
  private unlocked = false;
  private fading = false;
  private lastTick = 0;
  private readonly onBlocked: ((retry: () => void) => void) | undefined;
  private retryPending = false;

  constructor(options: MusicPlayerOptions) {
    this.backend = options.backend;
    this.ticker = options.ticker;
    this.fadeMs = Math.max(0, options.fadeMs ?? CROSSFADE_MS);
    const urlFor = options.urlFor;
    this.playlistFor = options.playlistFor ?? (urlFor ? (cue) => [urlFor(cue)] : playlistUrls);
    this.gainFor = options.gainFor ?? (options.playlistFor || urlFor ? () => 1 : recordingGain);
    this.onBlocked = options.onBlocked;
  }

  play(cue: MusicCue | null): void {
    if (cue !== this.cue && cue !== null) this.failures.delete(cue);
    this.cue = cue;
    this.apply();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.min(1, Math.max(0, volume));
    for (const v of this.voices.values()) this.applyVolume(v);
  }

  /** Muting pauses everything at once (no fade, and no downloads while muted); unmuting fades the
   *  current cue back in. */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) {
      for (const v of this.voices.values()) {
        v.level = 0;
        v.target = 0;
        this.stopVoice(v);
        this.applyVolume(v);
      }
      this.stopTicker();
    } else {
      for (const v of this.voices.values()) this.applyVolume(v);
      this.apply();
    }
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.apply();
  }

  /** Snapshot for tests and debugging. */
  state(): MusicPlayerState {
    return {
      unlocked: this.unlocked,
      cue: this.cue,
      volume: this.volume,
      muted: this.muted,
      fading: this.fading,
      voices: [...this.voices.values()].map((v) => ({
        cue: v.cue,
        level: v.level,
        target: v.target,
        playing: v.playing,
        volume: v.el.volume,
      })),
    };
  }

  /** The recording that should sound now (null: silence). */
  private wanted(): { cue: MusicCue; url: string } | null {
    if (this.muted || this.cue === null) return null;
    const list = this.playlistFor(this.cue);
    if (list.length === 0) return null;
    if ((this.failures.get(this.cue) ?? 0) >= list.length) return null; // every recording failed
    return { cue: this.cue, url: list[(this.position.get(this.cue) ?? 0) % list.length] };
  }

  /** Point every voice at its target and start the one that should sound. */
  private apply(): void {
    if (!this.unlocked) return;
    const want = this.wanted();
    for (const v of this.voices.values()) v.target = v.url === want?.url ? 1 : 0;
    if (want !== null) {
      const v = this.voices.get(want.url) ?? this.createVoice(want.cue, want.url);
      if (v && !v.playing) this.startVoice(v);
    }
    if (this.voices.size > 0) this.startTicker();
  }

  /** On to the next recording of the current cue's playlist (wrapping round). */
  private advance(): void {
    if (this.cue === null) return;
    const n = this.playlistFor(this.cue).length;
    this.position.set(this.cue, ((this.position.get(this.cue) ?? 0) + 1) % Math.max(1, n));
  }

  private createVoice(cue: MusicCue, url: string): Voice | null {
    if (!this.backend) return null;
    const loop = this.playlistFor(cue).length <= 1;
    let v: Voice | null = null;
    let el: AudioVoice;
    try {
      el = this.backend.create(url, {
        loop,
        onEnded: () => {
          if (v) this.onEnded(v);
        },
        onError: () => {
          if (v) this.onLoadFailed(v);
        },
      });
    } catch {
      return null;
    }
    v = { cue, url, el, level: 0, target: 1, playing: false, attempt: 0 };
    this.voices.set(url, v);
    this.applyVolume(v);
    return v;
  }

  /** A recording reached its end (it does not loop): the next of the playlist fades in. */
  private onEnded(v: Voice): void {
    v.playing = false;
    v.level = 0;
    this.applyVolume(v);
    if (this.wanted()?.url !== v.url) return; // it was fading out anyway
    if (this.cue !== null) this.failures.delete(this.cue); // it played: the list works
    this.advance();
    this.apply();
  }

  /** A recording would not load or play: forget its element and skip to the next of the playlist. */
  private onLoadFailed(v: Voice): void {
    if (this.voices.get(v.url) !== v) return; // already handled (error event and play() rejection)
    const current = this.wanted()?.url === v.url;
    this.voices.delete(v.url);
    v.playing = false;
    if (!current || this.cue === null) return;
    const n = this.playlistFor(this.cue).length;
    if (n <= 1) return; // a later play() of this cue tries afresh
    this.failures.set(this.cue, (this.failures.get(this.cue) ?? 0) + 1);
    this.advance();
    this.apply();
  }

  private startVoice(v: Voice): void {
    v.playing = true;
    const attempt = ++v.attempt;
    let result: Promise<void> | void;
    try {
      result = v.el.play();
    } catch (err) {
      this.onPlayFailed(v, attempt, err);
      return;
    }
    if (result && typeof result.catch === 'function') {
      result.catch((err: unknown) => this.onPlayFailed(v, attempt, err));
    }
  }

  private onPlayFailed(v: Voice, attempt: number, err: unknown): void {
    if (attempt !== v.attempt) return; // superseded by a newer play() or a pause()
    v.playing = false;
    const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
    if (name === 'NotAllowedError') {
      // The gesture did not count (or audio was relocked): queue again for the next unlock().
      this.unlocked = false;
      if (this.onBlocked && !this.retryPending) {
        this.retryPending = true;
        this.onBlocked(() => {
          this.retryPending = false;
          this.unlock();
        });
      }
      return;
    }
    // Missing or undecodable file: drop the voice (a later play() tries afresh) and play the backup.
    this.onLoadFailed(v);
  }

  private stopVoice(v: Voice): void {
    if (!v.playing) return;
    v.playing = false;
    v.attempt++; // the pending play() may now reject with AbortError; ignore it
    try {
      v.el.pause();
    } catch {
      // nothing useful to do; the voice is silent anyway
    }
  }

  private applyVolume(v: Voice): void {
    try {
      v.el.muted = this.muted;
      const own = this.gainFor(v.url);
      const gain = Number.isFinite(own) ? Math.min(1, Math.max(0, own)) : 1;
      v.el.volume = this.muted ? 0 : this.volume * gain * equalPower(v.level);
    } catch {
      // some engines (iOS Safari) make volume read-only; mute and pause still work there
    }
  }

  private startTicker(): void {
    if (this.fading) return;
    this.fading = true;
    this.lastTick = this.ticker.now();
    this.ticker.start(() => this.tick());
  }

  private stopTicker(): void {
    if (!this.fading) return;
    this.fading = false;
    this.ticker.stop();
  }

  /** One fade step: move each voice toward its target by the elapsed share of the crossfade. */
  private tick(): void {
    const now = this.ticker.now();
    const step = this.fadeMs > 0 ? Math.max(0, now - this.lastTick) / this.fadeMs : 1;
    this.lastTick = now;
    let moving = false;
    for (const v of this.voices.values()) {
      if (v.level < v.target) v.level = Math.min(v.target, v.level + step);
      else if (v.level > v.target) v.level = Math.max(v.target, v.level - step);
      if (v.level !== v.target) moving = true;
      else if (v.target === 0) this.stopVoice(v);
      this.applyVolume(v);
    }
    if (!moving) this.stopTicker();
  }
}

export function createMusicPlayer(options: MusicPlayerOptions): CrossfadeMusicPlayer {
  return new CrossfadeMusicPlayer(options);
}

/** The browser's media elements, or null where there is no playable audio: node (no Audio) and jsdom,
 *  which has Audio but logs "Not implemented" for every play()/pause() in the UI tests. */
function browserBackend(): AudioBackend | null {
  if (typeof Audio === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  return {
    create(url: string, options?: VoiceOptions): AudioVoice {
      const el = new Audio();
      el.loop = options?.loop ?? true;
      el.preload = 'auto';
      if (options) {
        el.addEventListener('ended', () => options.onEnded());
        el.addEventListener('error', () => options.onError());
      }
      el.src = url;
      return el;
    },
  };
}

function intervalTicker(): FadeTicker {
  let id: ReturnType<typeof setInterval> | null = null;
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    start(onTick: () => void): void {
      if (id === null) id = setInterval(onTick, TICK_MS);
    },
    stop(): void {
      if (id !== null) clearInterval(id);
      id = null;
    },
  };
}

/** Events that grant user activation on every input type (pointerdown does not, for touch). Capture
 *  phase, so a handler that stops propagation cannot swallow the retry. */
const GESTURE_EVENTS = ['click', 'touchend', 'keydown'] as const;

function retryOnNextGesture(retry: () => void): void {
  if (typeof window === 'undefined') return;
  const once = (): void => {
    for (const e of GESTURE_EVENTS) window.removeEventListener(e, once, true);
    retry();
  };
  for (const e of GESTURE_EVENTS) window.addEventListener(e, once, true);
}

export const musicPlayer = createMusicPlayer({
  backend: browserBackend(),
  ticker: intervalTicker(),
  onBlocked: retryOnNextGesture,
});
export const music: MusicPlayer = musicPlayer;
