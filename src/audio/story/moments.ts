/**
 * The Archive's moments (DESIGN §8.7 M1–M3): where the music lowers or leaves, never where it swells.
 *
 * - M1, the Archive Revelation: when a run completes with at least one human document surfaced (and
 *   narrative on), the chapter's piece fades out, four seconds of quiet, then "No. 14" alone on its
 *   felt piano, four more seconds, and the piece returns under the reading level. With no human
 *   document, or no motif to play, the music only lowers to the reading level.
 * - M2, the epilogue: whatever is playing makes way; the motif's only full close, then Träumerei.
 * - M3, chapter 8's card (Callum's letter names Mara): the motif starts and stops after two notes.
 *   Once per app session; pressing Begin early fades it.
 *
 * The triggers are store changes (the outcome's completedAt, not a panel mounting: "View the river"
 * remounts the panel), so StrictMode and remounts never replay a moment. Pure apart from the engine
 * and injected timers.
 *
 * A revelation and an epilogue belong to the run they follow. When that run is gone they end (the
 * motif fades over 1.5 s, the hold is released, the reading level lifts), whether the player leaves
 * the game screen or starts again on it: Replay chapter, R on the revelation, or "Continue to chapter
 * N" with narrative off all keep the game screen up and only reset the outcome and the phase.
 *
 * The music comes back on the audio clock: the hold is released once engine.now() passes the motif's
 * end plus the moment's silence. A hidden tab suspends the context, so the motif waits where it
 * stopped and so does the release (a wall-clock timeout would let the recording in over it).
 *
 * The motif's level (lead decision L1): MOTIF_MOMENT_TRIM_DB puts each moment's motif at least
 * MOTIF_UNDER_RECORDING_LU under its chapter's recording at that moment (the bed and the moment's own
 * reading level), and the attempt's scar, which stays on the recording until the attempt ends
 * (PERSISTENT_DUCKS), lowers the motif by as much, so a loss leaves the motif lower too.
 *
 * Chapter 9's sea duck is the exception (lead decision L1b, 2026-10-23). Following it as well put the
 * epilogue's motif, the story's only resolution, about 18 dB under the waves (S11E, second fix round:
 * -55.6 dBFS RMS on the music bus against -37.2 for the ambience). The motif keeps its chapter's level
 * instead, and the epilogue lowers the world around it (epilogueReading takes the ambience down 14 dB,
 * not 6): the moment still gets quieter, never louder.
 *
 * A motif still baking when its moment comes is waited for (MOMENT_TIMING.motifLateReleaseSec: "not
 * baked by its start time, it is skipped and the hold releases"): the moment asks again every
 * MOTIF_RETRY_MS until the motif's start time plus that margin, never sooner than MOTIF_WAIT_MIN_SEC
 * (the chapter 8 card's motif starts at +1.2 s and may need a little longer from a cold start); the
 * epilogue waits up to EPILOGUE_MOTIF_WAIT_SEC. Meanwhile the engine bakes that motif ahead of
 * everything else, at the loading pace (AudioManager.awaitMotif). It then starts on time, or late by
 * the wait, or not at all and the music comes back. Muted, locked or without Web Audio nothing is
 * waited for. From chapter 9's Revelation until its epilogue starts, when no moment waits, the engine
 * is asked for the epilogue's motif the same way: it plays next and it is the longest bake (34 s of
 * piano). The epilogue, if it then waits for it, asks for it itself (a new ask, its own trace line).
 * Once a motif is baked the engine stops pressing. Where the browser can run a Web Worker the motifs
 * render there as soon as the chapter's set is asked for, so on this laptop, even with the main thread
 * twice as slow, they were ready before any moment came (docs/evidence/AUDIO_RUNS.md, "Slow computers").
 */
import type { GamePhase } from '../../core/types';
import type { GameMode, Screen } from '../../state/appStore';
import type { ArchiveDocument, ChapterId } from '../../story/types';
import {
  CARD_MOTIF,
  DUCK_PRESETS,
  EPILOGUE_MOTIF,
  MOMENT_TIMING,
  MOTIF_MOMENT_TRIM_DB,
  PLAY_DUCK_FLOOR_DB,
  REVELATION_MOTIF,
  type AudioManager,
  type DuckKey,
  type MotifHandle,
  type MotifRequest,
  type MusicHoldKey,
} from '../contract';
import { LAST_CHAPTER } from '../game/levelSet';
import { anyHuman } from './human';

export interface MomentInputs {
  readonly screen: Screen;
  readonly mode: GameMode;
  readonly chapterId: ChapterId | null;
  readonly narrative: boolean;
  readonly viewingRiver: boolean;
  readonly phase: GamePhase;
  /** useStoryRun.outcome (the completed run on screen). */
  readonly outcome: {
    readonly chapterId: ChapterId;
    readonly completedAt: string;
    readonly fragments: readonly Pick<ArchiveDocument, 'kind' | 'author' | 'title'>[];
  } | null;
  /** useStoryRun.epilogue (non-null once started after chapter 9). */
  readonly epilogue: object | null;
}

export interface MomentTimers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export const windowTimers: MomentTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

/** Chapter cards that have played their motif in this app session (module lifetime, so a StrictMode
 * remount or a second visit to the card never plays it twice). */
const cardsPlayed = new Set<ChapterId>();
/** How often a moment asks again for a motif that is still baking. */
export const MOTIF_RETRY_MS = 250;
/** A moment waits for its motif at least this long (plus motifLateReleaseSec). */
export const MOTIF_WAIT_MIN_SEC = 3;
/**
 * The epilogue waits longer for its motif (from its start; the others wait their start time plus
 * motifLateReleaseSec). Its motif is the longest bake, 34 s of felt piano, and S11E (chapter 9 on
 * the autopilot at double speed) began the epilogue with part of it still to bake; its text takes
 * minutes to read and the music stays held meanwhile. The latest start, the motif and the silence
 * after it stay inside the router's HOLD_MAX_SEC, so the safety limit never cuts the moment short.
 */
export const EPILOGUE_MOTIF_WAIT_SEC = 15;
/**
 * The hold's release is checked on the audio clock: while the clock stands still (a hidden tab
 * suspends the context) or runs slow, the check comes back for the rest, never sooner than this.
 */
export const RELEASE_RECHECK_MS = 250;
/**
 * Ducks that stay on the recording until the attempt ends and that a moment's motif follows: the scar
 * of its losses ('untilRelease', released only when the session ends), so the motif is lowered by as
 * much (lead decision L1). Chapter 9's sea duck also stays on, but the motif does not follow it (L1b:
 * see the header).
 */
export const PERSISTENT_DUCKS: readonly DuckKey[] = ['scar'];
/** Tests: forget which cards played. */
export const resetCardMemory = (): void => cardsPlayed.clear();

type Reading = 'none' | 'reading' | 'readingRiver' | 'epilogueReading';

interface Held {
  key: MusicHoldKey;
  /** The motif the moment plays. */
  request: MotifRequest;
  /** Null while it waits for the motif's bake. */
  motif: MotifHandle | null;
  timer: number;
}

const EPILOGUE_REQUEST: MotifRequest = { variant: EPILOGUE_MOTIF, tempoScale: 1 };
const motifId = (m: MotifRequest | null): string | null => (m === null ? null : `${m.variant}@${m.tempoScale}`);

/** The completed run a revelation or epilogue belongs to. */
interface RunKey {
  readonly chapterId: ChapterId;
  readonly completedAt: string;
}

/** Phases of a new attempt: the run the revelation followed is gone. */
const NEW_ATTEMPT: ReadonlySet<GamePhase> = new Set(['loading', 'intro', 'playing']);

export class StoryMoments {
  private prev: MomentInputs | null = null;
  private reading: Reading = 'none';
  private held: Held | null = null;
  /** The run whose revelation (or epilogue) is in progress; null when none is. */
  private run: RunKey | null = null;
  /** The motif the engine was last asked to bake first (awaitMotif) and by whom, as 'moment:variant@tempo'. */
  private asked: string | null = null;

  constructor(
    private readonly engine: () => AudioManager,
    private readonly timers: MomentTimers = windowTimers,
  ) {}

  update(inp: MomentInputs): void {
    this.step(inp);
    this.askForMotif();
  }

  private step(inp: MomentInputs): void {
    const prev = this.prev;
    this.prev = inp;
    const inStoryGame = inp.screen === 'game' && inp.mode === 'story';

    // Leaving the game screen ends the revelation and the epilogue (their holds, motif and reading),
    // and so does a new attempt on it: the outcome reset, the phase back to loading or play, or
    // another chapter (Replay chapter, R, Continue with narrative off).
    if (!inStoryGame || this.runGone(inp, prev)) this.endRun();

    // M3: the chapter card. Leaving the card early fades the motif and lets the music in.
    if (this.held?.key === 'card' && inp.screen !== 'storyIntro') this.letGo(true);
    if (inp.screen === 'storyIntro' && prev?.screen !== 'storyIntro' && inp.chapterId && inp.narrative) this.card(inp.chapterId);

    if (!prev) return; // the first look only records where things stand (never replays a moment)

    // M2: the epilogue starts.
    if (inStoryGame && inp.epilogue !== null && prev.epilogue === null) {
      this.epilogue(inp);
      return;
    }
    // M1: a run completed (a new completedAt; a remounted panel keeps the old one).
    const done = inp.outcome?.completedAt ?? null;
    if (inStoryGame && inp.outcome && done !== (prev.outcome?.completedAt ?? null)) this.reveal(inp);

    // While the revelation panel is open: reading level, or the lighter one over "View the river"
    // (only for the run the revelation belongs to: a stale outcome from before a restart sets nothing).
    const open = this.run !== null && inp.outcome?.completedAt === this.run.completedAt;
    if (inStoryGame && open && inp.phase === 'complete' && this.reading !== 'epilogueReading') {
      this.setReading(inp.viewingRiver ? 'readingRiver' : 'reading');
    }
  }

  /** App teardown (tests): release everything held. */
  dispose(): void {
    this.letGo(true);
    this.setReading('none');
    this.run = null;
    this.prev = null;
    this.askForMotif();
  }

  /**
   * Ask the engine to bake first (AudioManager.awaitMotif) the motif a moment is waiting for; else,
   * from chapter 9's Revelation until its epilogue starts, the epilogue's; else none.
   */
  private askForMotif(): void {
    let want: MotifRequest | null = null;
    let by = '';
    if (this.held !== null && this.held.motif === null) {
      want = this.held.request;
      by = this.held.key;
    } else if (this.run?.chapterId === LAST_CHAPTER && this.reading !== 'epilogueReading') {
      want = EPILOGUE_REQUEST;
      by = 'next';
    }
    // Asked again when the moment changes, the same motif too: the epilogue waiting for the motif
    // chapter 9's Revelation asked for as the next one asks for it itself.
    const id = want === null ? null : `${by}:${motifId(want)}`;
    if (id === this.asked) return;
    this.asked = id;
    this.engine().awaitMotif(want);
  }

  /** Is the run the revelation or epilogue belongs to gone, the game screen still up? */
  private runGone(inp: MomentInputs, prev: MomentInputs | null): boolean {
    const run = this.run;
    if (run === null) return false;
    if (inp.outcome === null || inp.chapterId !== run.chapterId || inp.outcome.chapterId !== run.chapterId) return true;
    return prev?.phase === 'complete' && NEW_ATTEMPT.has(inp.phase);
  }

  /** End the revelation or epilogue in progress (the chapter card's motif is the card's own). */
  private endRun(): void {
    if (this.held && this.held.key !== 'card') this.letGo(true);
    if (this.reading !== 'none') this.setReading('none');
    this.run = null;
  }

  private reveal(inp: MomentInputs): void {
    const e = this.engine();
    const outcome = inp.outcome!;
    this.letGo(true);
    this.run = { chapterId: outcome.chapterId, completedAt: outcome.completedAt };
    this.setReading(inp.viewingRiver ? 'readingRiver' : 'reading');
    // M1′: no narrative, no human voice among the documents, or no Web Audio: only the reading level.
    if (!inp.narrative || !e.available || !anyHuman(outcome.fragments)) return;
    const gainDb = MOTIF_MOMENT_TRIM_DB.reveal[outcome.chapterId] + this.persistentDb(DUCK_PRESETS.reading.story!.music);
    this.hold('reveal', REVELATION_MOTIF[outcome.chapterId], gainDb, MOMENT_TIMING.revealMotifAtSec, MOMENT_TIMING.revealSilenceAfterSec);
  }

  private epilogue(inp: MomentInputs): void {
    this.letGo(true);
    if (inp.outcome) this.run = { chapterId: inp.outcome.chapterId, completedAt: inp.outcome.completedAt };
    this.setReading('epilogueReading');
    const gainDb = MOTIF_MOMENT_TRIM_DB.epilogue + this.persistentDb(DUCK_PRESETS.epilogueReading.story!.music);
    this.hold('epilogue', EPILOGUE_REQUEST, gainDb, MOMENT_TIMING.epilogueMotifAtSec, MOMENT_TIMING.epilogueSilenceAfterSec);
  }

  private card(chapterId: ChapterId): void {
    const variant = CARD_MOTIF[chapterId];
    if (!variant) return;
    if (cardsPlayed.has(chapterId)) return;
    cardsPlayed.add(chapterId);
    if (!this.engine().available) return;
    const gainDb = MOTIF_MOMENT_TRIM_DB.card[chapterId] ?? 0;
    this.hold('card', { variant, tempoScale: 1 }, gainDb, MOMENT_TIMING.cardMotifAtSec, MOMENT_TIMING.cardSilenceAfterSec);
  }

  /**
   * The persistent ducks on the recording (dB, <= 0) at their targets (a scar still ramping in counts
   * in full), as far as the router's floor lets the recording go under the moment's own reading level
   * `momentDb`: the motif is lowered by as much.
   */
  private persistentDb(momentDb: number): number {
    const targets = this.engine().music.state().targets;
    let sum = 0;
    for (const key of PERSISTENT_DUCKS) {
      const v = targets[key] ?? 0;
      if (Number.isFinite(v)) sum += Math.min(0, v);
    }
    return Math.max(Math.min(0, PLAY_DUCK_FLOOR_DB - momentDb), sum);
  }

  /**
   * Take the music out (the router's own 3 s fade), play the motif `atSec` later at `gainDb`, and let
   * the music back `afterSec` after the motif ends, on the audio clock. A motif that cannot play (not
   * baked yet, muted, no audio) releases the hold at once: the music is never left out without the
   * motif in its place.
   */
  private hold(key: MusicHoldKey, motif: MotifRequest, gainDb: number, atSec: number, afterSec: number): void {
    const e = this.engine();
    e.music.hold(key);
    this.startMotif(key, motif, gainDb, atSec, afterSec, 0);
  }

  /** Play the moment's motif `atSec` after its trigger, `waitedMs` of which have passed waiting for the bake. */
  private startMotif(key: MusicHoldKey, motif: MotifRequest, gainDb: number, atSec: number, afterSec: number, waitedMs: number): void {
    const e = this.engine();
    const handle = e.playMotif(motif, Math.max(0.005, atSec - waitedMs / 1000), gainDb);
    if (!handle) {
      if (!canWaitForMotif(e) || waitedMs + MOTIF_RETRY_MS > motifWaitSec(key, atSec) * 1000) {
        this.held = null;
        e.music.release(key);
        this.askForMotif();
        return;
      }
      // Still baking: the engine bakes it first, and faster, while the moment waits.
      const retry = this.timers.set(() => {
        if (this.held?.timer !== retry) return;
        this.startMotif(key, motif, gainDb, atSec, afterSec, waitedMs + MOTIF_RETRY_MS);
      }, MOTIF_RETRY_MS);
      this.held = { key, request: motif, motif: null, timer: retry };
      this.askForMotif();
      return;
    }
    const held: Held = { key, request: motif, motif: handle, timer: 0 };
    this.held = held;
    this.askForMotif();
    this.armRelease(held, handle.endsAt + afterSec);
  }

  /**
   * Release the hold once the audio clock reaches `due` (context seconds). The timer only wakes the
   * check: each time it fires the clock is read again, and while the context is suspended (a hidden
   * tab) or runs slower than wall time, the check comes back for the rest.
   */
  private armRelease(held: Held, due: number): void {
    const e = this.engine();
    const check = (): void => {
      if (this.held !== held) return;
      const left = due - e.now();
      if (left > 0.001) {
        held.timer = this.timers.set(check, Math.max(RELEASE_RECHECK_MS, left * 1000));
        return;
      }
      this.held = null;
      e.music.release(held.key);
    };
    held.timer = this.timers.set(check, Math.max(0, (due - e.now()) * 1000));
  }

  /** End the moment in progress: stop its motif (1.5 s fade) and release its hold. */
  private letGo(fade: boolean): void {
    const h = this.held;
    if (!h) return;
    this.held = null;
    this.timers.clear(h.timer);
    if (fade) h.motif?.stop(MOMENT_TIMING.motifFadeOnLeaveSec);
    this.engine().music.release(h.key);
  }

  private setReading(next: Reading): void {
    if (next === this.reading) return;
    const e = this.engine();
    const was = this.reading;
    this.reading = next;
    if (was !== 'none') e.duck(was as DuckKey, null, 'story');
    if (next !== 'none') e.duck(next, DUCK_PRESETS[next].story, 'story');
  }
}

/** How long (s from its trigger) a moment waits for a motif still baking. */
export function motifWaitSec(key: MusicHoldKey, atSec: number): number {
  return key === 'epilogue' ? EPILOGUE_MOTIF_WAIT_SEC : Math.max(atSec, MOTIF_WAIT_MIN_SEC) + MOMENT_TIMING.motifLateReleaseSec;
}

/** A motif can only be still baking where one could play at all: Web Audio running, nothing muted. */
function canWaitForMotif(e: AudioManager): boolean {
  if (!e.available || e.status() !== 'running') return false;
  const levels = e.state().levels;
  return !levels.musicMuted && !levels.soundMuted;
}
