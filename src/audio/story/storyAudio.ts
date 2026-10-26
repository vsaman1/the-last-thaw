/**
 * Story Mode inside one attempt (DESIGN §8.3, §8.7 M4–M8): the music only ever lowers or leaves.
 *
 * - A loss that matters (≥ 100 story points, counted per structure as the HUD counts them) takes a
 *   breath out of the music 0.3 s after it falls, as deep as the chapter allows (Act I −2 dB … Act III
 *   −8 dB), and leaves a small permanent scar for the rest of the attempt: the breath comes back a
 *   little lower each time (capped per act).
 * - A Story landmark lowers it further (−10 dB, long), a church most of all (−14 dB, ten seconds of
 *   hold): the moment is the absence. Both override the ordinary breath.
 * - Chapter 9's sea takes the music down to let the water speak before the Archive.
 * - Act III enters late: no piano over the flyover and the calving, only wind, water and ice; the
 *   chapter's piece comes in under the opening caption's end, from −12 dB.
 *
 * Its own StoryPointsTracker (src/story/scoring.ts) sees the same events as the HUD's, so the losses
 * it hears are exactly the ones the player is shown. Nothing here touches the run.
 */
import type { GameEvent, GamePhase, LevelDef } from '../../core/types';
import { StoryPointsTracker, type BodyLookup } from '../../story/scoring';
import { landmarkIndex } from '../../story/storyLevel';
import type { ChapterDef } from '../../story/types';
import {
  AFTERMATH_DELAY_SEC,
  AFTERMATH_MIN_POINTS,
  DUCK_PRESETS,
  MOMENT_TIMING,
  type ChapterMix,
  type DuckKey,
  type DuckLevels,
  type DuckPreset,
  type MusicRouter,
  type SessionAudio,
} from '../contract';

const SEA_CHAPTER = 'ch9-last-thaw';

/** How long a duck's shape lasts (attack + hold + release): an override window for the aftermath. */
const spanOf = (p: DuckPreset): number => p.attackSec + (typeof p.holdSec === 'number' ? p.holdSec : 0) + p.releaseSec;

export interface StoryAudioOptions {
  readonly chapter: ChapterDef;
  /** The story level the session plays (base level plus overlay). */
  readonly level: LevelDef;
  readonly mix: ChapterMix;
  /** Narrative on: the opening caption is shown (Act III music enters after it). */
  readonly narrative: boolean;
  /** The music router (the act3Entry hold is app-level). */
  readonly music: MusicRouter;
  readonly lookup: BodyLookup;
  /** Session time (runtime.time) for the delayed aftermath. */
  readonly time: () => number;
}

export class StoryAudio {
  private readonly tracker: StoryPointsTracker;
  private readonly landmarks: ReadonlyMap<number, string>;
  private readonly mourned = new Set<number>();
  private readonly pending: number[] = [];
  private scarDb = 0;
  private overrideUntil = -Infinity;
  private playingSince = -1;
  private act3Held = false;
  private seaDone = false;
  private disposed = false;
  errors = 0;

  constructor(
    private readonly session: SessionAudio,
    private readonly options: StoryAudioOptions,
  ) {
    this.tracker = new StoryPointsTracker(options.lookup);
    this.landmarks = landmarkIndex(options.chapter);
    if (options.mix.musicEntry === 'afterCaption') {
      options.music.hold('act3Entry');
      this.act3Held = true;
    }
  }

  /** The session listener (rt.events.on): every event, in order. Never throws. */
  readonly listener = (e: GameEvent): void => {
    if (this.disposed) return;
    try {
      this.onEvent(e);
    } catch {
      this.errors++;
    }
  };

  /** A church tower fell silent (bells.ts): the church moment, once per church. */
  churchSilenced(placement: number): void {
    this.church(placement);
  }

  /** Per frame: the delayed aftermath and the Act III entry. */
  tick(phase: GamePhase): void {
    if (this.disposed) return;
    const now = this.options.time();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (now < this.pending[i]) continue;
      this.pending.splice(i, 1);
      if (now >= this.overrideUntil) this.duck('aftermath', { music: this.options.mix.aftermathDb, ambience: 0, effects: 0 });
    }
    if (this.act3Held) {
      if (phase === 'playing' && this.playingSince < 0) this.playingSince = now;
      const wait = this.options.narrative ? MOMENT_TIMING.captionSec : MOMENT_TIMING.act3EntryNoCaptionSec;
      const ended = phase === 'complete' || phase === 'failed';
      if (ended || (this.playingSince >= 0 && now - this.playingSince >= wait)) this.enterAct3();
    }
  }

  /** The attempt is over: let go of the hold if the caption never ended (ducks go with session.end). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.act3Held) {
      this.act3Held = false;
      this.options.music.release('act3Entry');
    }
  }

  get scar(): number {
    return this.scarDb;
  }

  private onEvent(e: GameEvent): void {
    if (e.type === 'enteredOcean') {
      if (this.options.chapter.id === SEA_CHAPTER && !this.seaDone) {
        this.seaDone = true;
        this.duck('seaCh9', DUCK_PRESETS.seaCh9.story);
      }
      return;
    }
    const unit = this.tracker.add(e);
    if (!unit) return;
    const big = unit.points >= AFTERMATH_MIN_POINTS;
    if (unit.kind === 'church') this.church(unit.placement);
    else if (unit.placement >= 0 && this.landmarks.has(unit.placement)) {
      this.overrideUntil = Math.max(this.overrideUntil, this.options.time() + spanOf(DUCK_PRESETS.landmark));
      this.duck('landmark', DUCK_PRESETS.landmark.story);
    } else if (big) {
      this.pending.push(this.options.time() + AFTERMATH_DELAY_SEC);
    }
    if (big || unit.kind === 'church' || (unit.placement >= 0 && this.landmarks.has(unit.placement))) this.addScar();
  }

  private church(placement: number): void {
    if (this.mourned.has(placement)) return;
    this.mourned.add(placement);
    this.overrideUntil = Math.max(this.overrideUntil, this.options.time() + spanOf(DUCK_PRESETS.church));
    this.duck('church', DUCK_PRESETS.church.story);
  }

  private addScar(): void {
    const { scarDb, scarMaxDb } = this.options.mix;
    const next = Math.min(scarMaxDb, this.scarDb + scarDb);
    if (next === this.scarDb) return;
    this.scarDb = next;
    this.duck('scar', { music: -next, ambience: 0, effects: 0 });
  }

  private enterAct3(): void {
    this.act3Held = false;
    this.options.music.release('act3Entry');
    // The piece comes in from −12 dB and rises over 6 s (the preset's release).
    this.duck('act3Entry', DUCK_PRESETS.act3Entry.story);
  }

  private duck(key: DuckKey, levels: DuckLevels | null): void {
    this.session.duck(key, levels);
  }
}
