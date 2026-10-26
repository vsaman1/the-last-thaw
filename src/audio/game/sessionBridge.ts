/**
 * One attempt's sound (DESIGN §2.1 package C): everything between a running GameSession and its
 * SessionAudio, without React, so the same object runs in the 3D view (src/render/GameAudio.tsx) and
 * headless in tests (listenOnly, integration).
 *
 * Per animation frame, after the session has stepped and the camera has moved:
 *   listener pose → the intro's calving → the ring's events resolved into sounds (and bells told
 *   about falling towers) → the terrain wall detector → the ambience inputs (scrape 30 Hz, the rest
 *   10 Hz) → waterfalls, flood and the dam moment → the bells → Story's losses and the Act III entry.
 *
 * Audio only listens. The bridge subscribes to session.events (two listeners: the ring and, in Story,
 * the points tracker) and reads state; it never writes to the session, its bodies or its events, and
 * a test proves the run is bit-identical with and without it. It never throws: after
 * MAX_BRIDGE_ERRORS it goes quiet for the rest of the attempt (one console.warn).
 */
import type { GameRuntime } from '../../core/runtime';
import type { GamePhase } from '../../core/types';
import type { GameMode } from '../../state/appStore';
import type { ChapterDef } from '../../story/types';
import {
  ARCADE_MIX,
  AUDIO_LEVEL_IDS,
  CHAPTER_MIX,
  DUCK_PRESETS,
  type AudioLevelId,
  type AudioManager,
  type ChapterMix,
  type SessionAudio,
} from '../contract';
import { StoryAudio } from '../story/storyAudio';
import { AmbienceInputs, AMBIENCE_HZ, WallDetector } from './ambienceInputs';
import { baseLevelId, BellDriver } from './bells';
import { CalvingSounds } from './calving';
import { EventRing, hasBodies } from './eventRing';
import { FrameResolver } from './router';
import { createListenerPose, listenerFromMatrix } from '../spatial';
import { DamWatch, FallSources, FloodSource } from './waterSources';

export const MAX_BRIDGE_ERRORS = 5;

export interface BridgeOptions {
  readonly engine: AudioManager;
  readonly mode: GameMode;
  /** Story Mode: the chapter this attempt plays (null in Arcade). */
  readonly chapter: ChapterDef | null;
  readonly attempt: number;
  /** Story narrative on (the opening caption is shown). */
  readonly narrative: boolean;
}

const isAudioLevel = (id: string): id is AudioLevelId => (AUDIO_LEVEL_IDS as readonly string[]).includes(id);

export class SessionBridge {
  readonly session: SessionAudio;
  readonly ring: EventRing;
  readonly resolver: FrameResolver;
  readonly inputs: AmbienceInputs;
  readonly falls: FallSources;
  readonly flood: FloodSource | null;
  readonly dam: DamWatch | null;
  readonly bells: BellDriver;
  readonly calving: CalvingSounds;
  readonly story: StoryAudio | null;
  readonly mix: ChapterMix;
  private readonly wall = new WallDetector();
  private readonly pose = createListenerPose();
  private readonly offs: (() => void)[] = [];
  private frameNo = 1;
  private phase: GamePhase | null = null;
  private loading = true;
  private timbred = false;
  private slowClock = Infinity;
  private lastTime: number;
  private errors = 0;
  private quiet = false;
  private ended = false;

  constructor(
    private readonly rt: GameRuntime,
    private readonly options: BridgeOptions,
  ) {
    const base = baseLevelId(rt.level.id);
    const levelId: AudioLevelId = isAudioLevel(base) ? base : 'mountain-valley';
    const chapter = options.mode === 'story' ? options.chapter : null;
    this.mix = chapter ? CHAPTER_MIX[chapter.id] : ARCADE_MIX;
    this.session = options.engine.beginSession({
      levelId,
      mode: options.mode,
      chapterId: chapter?.id ?? null,
      attempt: options.attempt,
      mix: this.mix,
    });
    this.ring = new EventRing(rt, undefined, (err, disabled) => this.fault('ring', err, disabled));
    this.ring.frame = this.frameNo;
    this.resolver = new FrameResolver(this.session, { settleTails: this.mix.settleTails });
    this.inputs = new AmbienceInputs(rt, levelId);
    const water = rt.water ?? null;
    this.falls = new FallSources(rt.river, water);
    this.flood = water ? new FloodSource(water) : null;
    this.dam = water ? new DamWatch(water, options.mode === 'story') : null;
    const physics = rt.physics;
    this.story = chapter
      ? new StoryAudio(this.session, {
          chapter,
          level: rt.level,
          mix: this.mix,
          narrative: options.narrative,
          music: options.engine.music,
          lookup: (id) => (hasBodies(physics) ? physics.getBody(id) : undefined),
          time: () => rt.time,
        })
      : null;
    this.bells = new BellDriver(rt, this.session, {
      hourStrokes: this.mix.hourStrokes,
      now: () => options.engine.now(),
      onSilenced: this.story ? (placement) => this.story?.churchSilenced(placement) : undefined,
    });
    this.calving = new CalvingSounds(rt, this.session);
    this.lastTime = rt.time;
    this.offs.push(rt.events.on(this.ring.listener));
    if (this.story) this.offs.push(rt.events.on(this.story.listener));
  }

  /** The store's phase changed (loading overlay, pause, fail): the engine gates and ducks. */
  setPhase(storePhase: GamePhase): void {
    if (this.ended) return;
    const loading = storePhase === 'loading';
    const phase = loading ? this.rt.phase : storePhase;
    if (phase === this.phase && loading === this.loading) return;
    this.phase = phase;
    this.loading = loading;
    this.session.setPhase(phase, loading);
  }

  /**
   * One animation frame. `camera` is the camera's matrixWorld elements (null: keep the last pose).
   * `dt` is the frame's wall-clock delta; game-time windows use the session's own clock.
   */
  frame(dt: number, camera: ArrayLike<number> | null): void {
    if (this.ended || this.quiet) return;
    try {
      this.step(dt, camera);
    } catch (err) {
      this.fault('frame', err, false);
    }
  }

  /** The attempt is over (retry, level change, leaving, an error dialog): everything stops within 0.15 s. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.story?.dispose();
    this.session.end(0.12);
  }

  private step(dt: number, camera: ArrayLike<number> | null): void {
    const rt = this.rt;
    const s = this.session;
    if (rt.phase !== this.phase && !this.loading) this.setPhase(rt.phase);
    s.beginFrame(this.frameNo);
    if (camera) {
      listenerFromMatrix(camera, this.pose);
      s.setListener(this.pose);
    }
    const now = rt.time;
    const gameDt = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    if (this.loading) {
      this.ring.clear();
    } else {
      this.calving.frame();
      this.bells.observe(this.ring);
      let contact = false;
      for (let i = 0; i < this.ring.count && !contact; i++) {
        const t = this.ring.slots[i].type;
        contact = t === 'collision' || t === 'landed';
      }
      const ice = rt.iceberg;
      const wall = this.wall.step(ice.impact, gameDt, contact);
      const report = this.resolver.resolve(this.ring, now, wall, ice.pos.x, ice.pos.y, ice.pos.z);
      const voices = s.ambience;
      if (voices && !this.timbred) {
        this.timbred = true;
        voices.setTimbre({ wind: this.mix.wind, waterTopDb: this.mix.waterTopDb });
      }
      if (report.enteredOcean) voices?.ocean.surge();
      this.inputs.update(dt, this.pose, voices);
      const falls = this.falls.update(dt, this.pose);
      this.slowClock += dt;
      if (this.slowClock >= 1 / AMBIENCE_HZ - 1e-6) {
        this.slowClock = 0;
        if (voices) for (let k = 0; k < voices.falls.length && k < falls.length; k++) voices.falls[k].update(falls[k]);
        if (this.flood) {
          const f = this.flood.update(this.pose);
          voices?.flood.update(f);
        }
      }
      const dam = this.dam?.update(gameDt) ?? null;
      if (dam === 'breach') s.duck('dam', DUCK_PRESETS.dam[this.options.mode]);
      else if (dam === 'subside') s.duck('dam', null);
      this.bells.frame(dt, rt.phase === 'playing', this.pose, false);
      this.story?.tick(rt.phase);
    }
    this.frameNo++;
    this.ring.frame = this.frameNo;
  }

  private fault(where: string, err: unknown, disabled: boolean): void {
    this.errors++;
    if (this.session.tracing) {
      this.session.trace({ seq: 0, t: 0, gt: this.rt.time, token: this.session.token, frame: this.frameNo, kind: 'error', cause: -1, note: `${where}: ${String(err)}` });
    }
    if (!disabled && this.errors < MAX_BRIDGE_ERRORS) return;
    if (this.quiet) return;
    this.quiet = true;
    if (import.meta.env.MODE !== 'test') console.warn(`[audio] the sound bridge stopped for this attempt after ${this.errors} errors (last in ${where}: ${String(err)})`);
    this.end();
  }
}
