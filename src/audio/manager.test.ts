import { describe, expect, it } from 'vitest';
import type { MusicCue } from '../story/types';
import {
  ARCADE_MIX,
  CHAPTER_MIX,
  DUCK_PRESETS,
  GLOBAL_LIMITS,
  MOTIF_CALIB_DB,
  SOUND_IDS,
  SPACE,
  type AmbienceVoices,
  type AudioLevels,
  type CreateAmbienceVoices,
  type CreateNoiseBank,
  type SessionAudioInfo,
  type SliceScheduler,
} from './contract';
import { GATE_CLOSE_SEC } from './engine/graph';
import { START_TIMEOUT_MS, SUSPEND_DELAY_MS } from './engine/context';
import { createAudioManager, MAX_SESSION_ERRORS, NullAudioManager, WebAudioManager } from './manager';
import type { MusicPlayer } from './music';
import { DEFAULT_LEVELS } from './settings';
import { createFakeAudioContext, FakeAudioBufferSourceNode, type FakeHandle, type FakeResumeMode } from './testing/fakeAudioContext';
import { ManualTicker } from './testing/manualTicker';
import { ManualTimers } from './testing/manualTimers';
import { layer, request } from './testing/requests';
import { createToneBank, syncScheduler, type ToneBank } from './testing/toneBank';

class Player implements MusicPlayer {
  readonly calls: string[] = [];
  volume = 0.6;
  muted = false;
  cue: MusicCue | null = null;
  play(cue: MusicCue | null): void {
    this.cue = cue;
    this.calls.push(`play ${cue}`);
  }
  setVolume(v: number): void {
    this.volume = v;
    this.calls.push(`volume ${v.toFixed(4)}`);
  }
  setMuted(m: boolean): void {
    this.muted = m;
    this.calls.push(`muted ${m}`);
  }
  unlock(): void {
    this.calls.push('unlock');
  }
}

const fakeNoise: CreateNoiseBank = (ctx) => {
  const b = (): AudioBuffer => ctx.createBuffer(1, 4800, ctx.sampleRate);
  return { white: b(), pink: b(), brown: b(), control: [b(), b()] };
};

/** Ambience voices that start one looping source into out.ambience and stop it on stop(). */
function fakeAmbience(log: string[]): CreateAmbienceVoices {
  return (ctx, out, noise) => {
    const src = ctx.createBufferSource();
    src.buffer = noise.pink;
    src.loop = true;
    src.connect(out.ambience);
    src.start();
    const nothing = { update: (): void => undefined };
    let stopped = false;
    const voices: AmbienceVoices = {
      wind: nothing,
      scrape: nothing,
      water: nothing,
      falls: [nothing, nothing, nothing],
      ocean: { update: () => undefined, surge: () => undefined },
      flood: nothing,
      emitters: [nothing, nothing, nothing, nothing],
      setTimbre: (t) => log.push(`timbre ${t.wind.bandHz}`),
      stop: (fade) => {
        if (stopped) return;
        stopped = true;
        log.push(`stop ${fade}`);
        src.stop(ctx.currentTime + fade + 0.03);
      },
    };
    return voices;
  };
}

interface RigOptions {
  resume?: FakeResumeMode;
  activation?: boolean;
  synthesis?: boolean;
  /** The bank's slices (default: run at once). */
  scheduler?: SliceScheduler;
}

function rig(o: RigOptions = {}) {
  const fakes: FakeHandle[] = [];
  const target = new EventTarget();
  const state = { activation: o.activation ?? true };
  const timers = new ManualTimers();
  const ticker = new ManualTicker();
  const busTicker = new ManualTicker();
  const player = new Player();
  const log: string[] = [];
  const synthesis = o.synthesis === false;
  const m = new WebAudioManager({
    synthesis: synthesis
      ? { createSoundBank: null, createNoiseBank: null, createAmbienceVoices: null, generateSpaceIR: null }
      : {
          createSoundBank: (s, seed) => createToneBank(s, seed),
          createNoiseBank: fakeNoise,
          createAmbienceVoices: fakeAmbience(log),
          generateSpaceIR: () => [new Float32Array(64), new Float32Array(64)],
        },
    player,
    ticker,
    busTicker,
    timers,
    target,
    hasActivation: () => state.activation,
    scheduler: o.scheduler ?? syncScheduler,
    debug: true,
    createContext: () => {
      const h = createFakeAudioContext({ resume: o.resume ?? 'sync' });
      fakes.push(h);
      return h.ctx as unknown as AudioContext;
    },
  });
  const fake = (): FakeHandle => fakes[fakes.length - 1];
  /** Advance audio time, the timers and both tickers together. */
  const advance = (sec: number): void => {
    const steps = Math.max(1, Math.round(sec / 0.01));
    for (let i = 0; i < steps; i++) {
      fake()?.advance(sec / steps);
      timers.advance((sec / steps) * 1000);
      ticker.advance((sec / steps) * 1000, 10);
      busTicker.advance((sec / steps) * 1000, 10);
    }
  };
  const gesture = (type = 'pointerdown'): boolean => target.dispatchEvent(new Event(type));
  return { m, fakes, fake, target, state, timers, ticker, busTicker, player, log, advance, gesture };
}

const info = (over: Partial<SessionAudioInfo> = {}): SessionAudioInfo => ({
  levelId: 'riverside-town',
  mode: 'story',
  chapterId: 'ch4-people',
  attempt: 1,
  mix: CHAPTER_MIX['ch4-people'],
  ...over,
});

/** A running manager with the core and every level sound baked, and a playing session. */
function running(o: RigOptions = {}) {
  const r = rig(o);
  r.gesture();
  r.m.prepare({ sounds: [...SOUND_IDS], bells: ['st-brides', 'clachan-kirk'], motifs: [{ variant: 'act2', tempoScale: 1 }] });
  const s = r.m.beginSession(info());
  s.setPhase('playing', false);
  s.beginFrame(1);
  return { ...r, s };
}

const houseCollapse = () =>
  request([layer('house.collapse', { gainDb: -14 }), layer('glass.break', { gainDb: -20, delaySec: 0.06, optional: true })]);

describe('unlock and the context state machine', () => {
  it('constructs nothing before a gesture, and nothing for a gesture without user activation', () => {
    const r = rig({ activation: false });
    expect(r.fakes).toHaveLength(0);
    expect(r.m.status()).toBe('locked');
    r.gesture('keydown'); // e.g. Escape: no activation
    expect(r.fakes).toHaveLength(0);
    expect(r.m.controller.isArmed).toBe(true);
    r.state.activation = true;
    r.gesture('click');
    expect(r.fakes).toHaveLength(1);
    expect(r.m.status()).toBe('running');
    expect(r.m.controller.isArmed).toBe(false);
    expect(r.player.calls).toContain('unlock');
  });

  it('a double unlock() creates one context', () => {
    const r = rig();
    r.m.unlock();
    r.m.unlock();
    r.gesture();
    expect(r.fakes).toHaveLength(1);
  });

  it('a resume that never completes keeps the listeners armed, and the next gesture resumes the same context', () => {
    const r = rig({ resume: 'never' });
    r.gesture();
    expect(r.m.status()).toBe('starting');
    r.advance(START_TIMEOUT_MS / 1000 + 0.01);
    expect(r.m.status()).toBe('locked');
    expect(r.m.controller.isArmed).toBe(true);
    r.fake().fake.resumeMode = 'sync';
    r.gesture();
    expect(r.fakes).toHaveLength(1);
    expect(r.fake().fake.resumeCalls).toBe(2);
    expect(r.m.status()).toBe('running');
    expect(r.m.controller.isArmed).toBe(false);
  });

  it('a closed context re-arms and is rebuilt on the next gesture', () => {
    const r = rig();
    r.gesture();
    r.fake().setState('closed');
    expect(r.m.status()).toBe('locked');
    expect(r.m.graph()).toBe(null);
    r.gesture();
    expect(r.fakes).toHaveLength(2);
    expect(r.m.status()).toBe('running');
    expect(r.m.graph()).not.toBe(null);
  });

  it('builds the graph and strips once per context, within the node budget', () => {
    const r = rig();
    r.gesture();
    const nodes = r.fake().ops.filter((x) => x.op === 'create').length;
    // ~130 in the design; the analyser taps (debug) and the two send-gain mirrors add a few.
    expect(nodes).toBeGreaterThan(100);
    expect(nodes).toBeLessThan(170);
    expect(r.m.effects()!.strips).toHaveLength(GLOBAL_LIMITS.effectStrips);
    expect(r.m.bellVoices()!.strips).toHaveLength(GLOBAL_LIMITS.bellStrips);
    const strip = r.m.effects()!.strips[0].gain as unknown as { id: number };
    expect(r.fake().reachesDestination(strip.id)).toBe(true);
  });
});

describe('settings and channels', () => {
  it('bus gains equal the settings within 1e-3 after 100 ms; Mute all takes master to exactly 0', () => {
    const r = running();
    const lv: AudioLevels = { master: 0.7, music: 0.5, ambience: 0.4, effects: 0.3, musicMuted: false, soundMuted: false };
    r.m.applySettings(lv);
    r.advance(0.1);
    const b = r.m.state().buses;
    expect(b.master).toBeCloseTo(0.7, 3);
    expect(b.effects).toBeCloseTo(0.3, 3);
    expect(b.ambience).toBeCloseTo(0.4, 3);
    expect(b.music).toBeCloseTo(0.5, 3);
    expect(r.player.volume).toBeCloseTo(0.35, 3);
    r.m.applySettings({ ...lv, soundMuted: true });
    r.advance(0.05);
    expect(r.m.state().buses.master).toBe(0);
    expect(r.player.muted).toBe(true);
    // The real param, not only the model, is at 0.
    const master = r.m.graph()!.master.node.gain as unknown as { valueAt(t: number): number };
    expect(master.valueAt(r.fake().fake.currentTime)).toBe(0);
  });

  it('music mute silences the motif bus but not the world', () => {
    const r = running();
    r.m.applySettings({ ...DEFAULT_LEVELS, musicMuted: true });
    r.advance(0.1);
    expect(r.m.state().buses).toMatchObject({ music: 0, effects: 0.8, ambience: 0.8, master: 1 });
  });
});

describe('sessions', () => {
  it('the trace opens with the seed, and every session reports its stream seed', () => {
    const r = running();
    const t = r.m.traceRing.since();
    expect(t[0]).toMatchObject({ kind: 'lifecycle', note: expect.stringContaining('SEED 42') });
    expect(t.some((e) => e.note?.startsWith('session 1 begins: riverside-town story attempt 1 seed '))).toBe(true);
    expect(r.m.state().seed).toBe(42);
  });

  it('tokens increase per attempt; ended sessions drop later calls as stale', () => {
    const r = running();
    expect(r.s.token).toBe(1);
    const s2 = r.m.beginSession(info({ attempt: 2 }));
    expect(s2.token).toBe(2);
    r.s.end();
    expect(r.s.play(houseCollapse())).toEqual({ started: 0, reason: 'disabled' });
    expect(r.m.traceRing.since().some((e) => e.kind === 'drop' && e.note === 'stale')).toBe(true);
  });

  it('plays only while playing: loading and paused drop with their reasons; unavailable before unlock', () => {
    const r = rig();
    const early = r.m.beginSession(info());
    early.setPhase('playing', false);
    expect(early.play(houseCollapse()).reason).toBe('unavailable');
    r.gesture();
    r.m.prepare({ sounds: [...SOUND_IDS], bells: [], motifs: [] });
    const s = r.m.beginSession(info({ attempt: 2 }));
    s.beginFrame(1);
    expect(s.play(houseCollapse()).reason).toBe('loading');
    s.setPhase('intro', false);
    expect(s.play(houseCollapse()).started).toBe(2);
    s.setPhase('paused', false);
    s.beginFrame(2);
    expect(s.play(houseCollapse()).reason).toBe('paused');
  });

  it('nothing plays before the bank has baked: notReady, silently', () => {
    const r = running({ synthesis: false });
    expect(r.s.play(houseCollapse()).reason).toBe('notReady');
    expect(r.s.ambience).toBe(null);
  });

  it('the last attempt ending closes the shared space with its fade (no 2.2 s reverb tail on the menu), and it opens again', () => {
    const r = running();
    const ret = r.m.graph()!.spaceReturn.gain as unknown as { valueAt(t: number): number };
    const now = (): number => r.fake().fake.currentTime;
    const open = Math.pow(10, SPACE.returnDb / 20);
    expect(ret.valueAt(now())).toBeCloseTo(open, 9);
    r.s.end(0.12);
    r.advance(0.15);
    expect(ret.valueAt(now())).toBe(0);
    // Once the convolver has emptied, the return opens again (silently: nothing feeds it).
    r.advance(SPACE.irSeconds + 0.2);
    expect(ret.valueAt(now())).toBeCloseTo(open, 9);
    // Closed again by a second attempt's end, then opened at once by the next attempt.
    const s2 = r.m.beginSession(info({ attempt: 2 }));
    s2.end(0.12);
    r.advance(0.15);
    expect(ret.valueAt(now())).toBe(0);
    const s3 = r.m.beginSession(info({ attempt: 3 }));
    r.advance(0.1);
    expect(ret.valueAt(now())).toBeCloseTo(open, 9);
    // Retry: the next attempt begins before the old one ends, so the space never closes.
    const s4 = r.m.beginSession(info({ attempt: 4 }));
    s3.end(0.12);
    r.advance(0.15);
    expect(ret.valueAt(now())).toBeCloseTo(open, 9);
    s4.end(0.12);
  });

  it('end(): every voice, bell and loop of the session fades and stops within 150 ms; started = stopped', () => {
    const r = running();
    const h = r.fake();
    h.withOwner('s1', () => {
      r.s.play(houseCollapse());
      r.s.playBell({ slot: 0, voicing: 'st-brides', form: 'strike', when: h.fake.currentTime + 0.01, velocity: 1, gainLin: 0.1, lowpassHz: 4000, pan: 0.2 });
      expect(r.s.ambience).not.toBe(null);
    });
    r.advance(0.05);
    expect(h.liveSources('s1')).toBe(4); // 2 effect layers, 1 bell, 1 ambience loop
    const t0 = h.fake.currentTime;
    r.s.end();
    r.s.end(); // idempotent
    r.advance(0.16);
    expect(h.liveSources('s1')).toBe(0);
    expect(h.fake.currentTime - t0).toBeLessThan(0.2);
    const ids = new Set(h.fake.sources().filter((x) => x.owner === 's1').map((x) => x.id));
    const starts = h.ops.filter((x) => x.op === 'start' && ids.has(x.id)).length;
    const stops = h.fake.sources().filter((x) => x.owner === 's1' && x.ended).length;
    expect(starts).toBe(4);
    expect(stops).toBe(4);
    expect(r.log).toContain('stop 0.12');
    expect(r.m.state().session).toBe(null);
  });

  it('five throwing calls disable the session, with one trace entry', () => {
    const r = running();
    const broken = { family: 'hit', layerCount: 1 } as unknown as Parameters<typeof r.s.play>[0];
    for (let i = 0; i < MAX_SESSION_ERRORS; i++) expect(r.s.play(broken).reason).toBe('disabled');
    expect(r.s.play(houseCollapse()).reason).toBe('disabled');
    const notes = r.m.traceRing.since().filter((e) => e.kind === 'error' && e.note?.includes('disabled after'));
    expect(notes).toHaveLength(1);
  });

  it('a P0 start makes room: music -3 dB and ambience -4 dB, released by itself', () => {
    const r = running();
    r.s.play(houseCollapse());
    r.advance(0.1);
    expect(r.m.state().ducks.makeRoom).toMatchObject({ music: -3, ambience: -4 });
    expect(r.m.state().buses.ambience).toBeCloseTo(0.8 * Math.pow(10, -4 / 20), 2);
    r.advance(3);
    expect(r.m.state().ducks.makeRoom).toBeUndefined();
    expect(r.m.state().buses.ambience).toBeCloseTo(0.8, 3);
  });
});

describe('pause', () => {
  it('the pause gate reaches 0 within 0.12 s, music ducks -8 dB, and reopens on resume', () => {
    const r = running();
    r.m.music.setCue('cost');
    r.m.applySettings(DEFAULT_LEVELS);
    r.s.setPhase('paused', false);
    r.advance(GATE_CLOSE_SEC + 0.001);
    expect(r.m.state().buses.gate).toBe(0);
    expect(r.m.state().paused).toBe(true);
    r.advance(0.3);
    expect(r.m.music.state().duckDb).toBeCloseTo(-8, 3);
    r.s.setPhase('playing', false);
    r.advance(0.3);
    expect(r.m.state().buses.gate).toBe(1);
    expect(r.m.music.state().duckDb).toBe(0);
  });

  it('ten rapid toggles in one second end consistent', () => {
    const r = running();
    for (let i = 0; i < 10; i++) {
      r.s.setPhase(i % 2 === 0 ? 'paused' : 'playing', false);
      r.advance(0.1);
    }
    r.advance(0.5);
    expect(r.m.state().buses.gate).toBe(1);
    expect(r.m.state().paused).toBe(false);
    expect(r.m.music.state().duckDb).toBe(0);
    r.s.setPhase('paused', false);
    r.advance(0.5);
    expect(r.m.state().buses.gate).toBe(0);
  });

  it('quitting from the pause menu reopens the gate for the next attempt once its voices are gone', () => {
    const r = running();
    r.s.setPhase('paused', false);
    r.advance(0.2);
    r.s.end();
    expect(r.m.state().buses.gate).toBe(0);
    r.advance(0.25);
    expect(r.m.state().buses.gate).toBeGreaterThan(0);
    r.advance(0.3);
    expect(r.m.state().buses.gate).toBe(1);
    expect(r.m.music.state().duckDb).toBe(0);
  });

  it('a failed run ducks the music by the mode preset until the session ends', () => {
    const r = running();
    r.s.setPhase('failed', false);
    r.advance(2.1);
    expect(r.m.music.state().duckDb).toBeCloseTo(DUCK_PRESETS.fail.story!.music, 3);
    r.s.end();
    r.advance(2.1);
    expect(r.m.music.state().duckDb).toBe(0);
    const a = running();
    const arc = a.m.beginSession(info({ mode: 'arcade', chapterId: null, mix: ARCADE_MIX, attempt: 3 }));
    arc.setPhase('failed', false);
    a.advance(2.1);
    expect(a.m.music.state().duckDb).toBeCloseTo(DUCK_PRESETS.fail.arcade!.music, 3);
  });
});

describe('hidden tab', () => {
  it('master gate down, then suspended; on return running again and the gate back up; music paused meanwhile', () => {
    const r = running();
    r.m.applySettings(DEFAULT_LEVELS);
    r.m.setHidden(true);
    expect(r.player.muted).toBe(true);
    r.advance(SUSPEND_DELAY_MS / 1000 + 0.01);
    expect(r.fake().fake.state).toBe('suspended');
    expect(r.m.status()).toBe('suspended');
    r.m.setHidden(false);
    expect(r.m.status()).toBe('running');
    expect(r.player.muted).toBe(false);
    r.advance(0.2);
    const hg = r.m.graph()!.hiddenGate;
    expect(hg.valueAt(r.fake().fake.currentTime)).toBe(1);
  });

  it('if the context will not resume, the gestures re-arm', () => {
    const r = running();
    r.m.setHidden(true);
    r.advance(0.1);
    r.fake().fake.resumeMode = 'never';
    r.m.setHidden(false);
    r.timers.advance(START_TIMEOUT_MS + 10);
    expect(r.m.status()).toBe('locked');
    expect(r.m.controller.isArmed).toBe(true);
  });
});

describe('the warm-up before the gesture (lead decision L2)', () => {
  /** A rig whose slices run only when flushed, with warm steps that log when they run. */
  function warmRig() {
    const slices: ((deadline: number) => boolean)[] = [];
    const scheduler: SliceScheduler = (work) => void slices.push(work);
    const flush = (): void => {
      while (slices.length > 0) {
        const work = slices.shift()!;
        if (work(Number.POSITIVE_INFINITY)) slices.push(work);
      }
    };
    const log: string[] = [];
    const target = new EventTarget();
    let contexts = 0;
    const m = new WebAudioManager({
      synthesis: {
        createSoundBank: (s, seed) => createToneBank(s, seed),
        createNoiseBank: fakeNoise,
        createAmbienceVoices: null,
        generateSpaceIR: (rate) => (log.push(`ir at ${rate} during ${contexts > 0 ? 'the gesture' : 'idle'}`), [new Float32Array(8), new Float32Array(8)]),
        warmSteps: (_seed, rate) => [1, 2, 3].map((k) => () => void log.push(`step ${k} (${rate} Hz) ${contexts > 0 ? 'after' : 'before'} the context`)),
      },
      player: new Player(),
      ticker: new ManualTicker(),
      busTicker: new ManualTicker(),
      timers: new ManualTimers(),
      target,
      hasActivation: () => true,
      scheduler,
      createContext: () => {
        contexts++;
        return createFakeAudioContext({ resume: 'sync' }).ctx as unknown as AudioContext;
      },
    });
    return { m, log, flush, target };
  }

  it('asked for on the menu, the noise bank and the IR are made in idle slices before any context', () => {
    const r = warmRig();
    r.m.prepare({ sounds: ['hit.wood'], bells: [], motifs: [] });
    expect(r.log).toEqual([]); // nothing on prepare's own call stack
    r.flush();
    expect(r.log).toEqual(['step 1 (48000 Hz) before the context', 'step 2 (48000 Hz) before the context', 'step 3 (48000 Hz) before the context']);
    expect(r.m.bakeReport().warm).toMatchObject({ steps: 3, done: 3, complete: true });
    r.target.dispatchEvent(new Event('pointerdown'));
    expect(r.m.status()).toBe('running');
  });

  it('a gesture before the warm-up ends stops it: what is left is made with the context', () => {
    const r = warmRig();
    r.m.prepare({ sounds: ['hit.wood'], bells: [], motifs: [] });
    r.target.dispatchEvent(new Event('pointerdown'));
    r.flush();
    expect(r.log.filter((l) => l.startsWith('step'))).toEqual([]);
    expect(r.log).toContain('ir at 48000 during the gesture');
    expect(r.m.bakeReport().warm).toMatchObject({ done: 0, complete: false });
  });
});

describe('ducks, motif and bells', () => {
  it('an app-scoped reading duck lowers ambience and effects by its levels; null releases it', () => {
    const r = running();
    r.m.duck('reading', DUCK_PRESETS.reading.story, 'story');
    r.advance(DUCK_PRESETS.reading.attackSec + 0.1);
    expect(r.m.state().buses.effects).toBeCloseTo(0.8 * Math.pow(10, -12 / 20), 2);
    expect(r.m.state().buses.ambience).toBeCloseTo(0.8 * Math.pow(10, -8 / 20), 2);
    expect(r.m.music.state().duckDb).toBeCloseTo(-6, 3);
    r.m.duck('reading', null, 'story');
    r.advance(DUCK_PRESETS.reading.releaseSec + 0.1);
    expect(r.m.state().buses.effects).toBeCloseTo(0.8, 3);
    // Arcade has no reading duck: nothing happens.
    r.m.duck('reading', DUCK_PRESETS.reading.story, 'arcade');
    expect(r.m.state().ducks.reading).toBeUndefined();
  });

  it('a positive duck throws under tests', () => {
    const r = running();
    expect(() => r.m.duck('reading', { music: 2, ambience: 0, effects: 0 }, 'story')).toThrow(RangeError);
  });

  it('session ducks are released by end()', () => {
    const r = running();
    r.s.duck('scar', { music: -1.5, ambience: 0, effects: 0 });
    r.s.duck('church', DUCK_PRESETS.church.story);
    r.advance(4.1);
    expect(r.m.music.state().duckDb).toBeCloseTo(-15.5, 3);
    r.s.end();
    r.advance(10.1);
    expect(r.m.music.state().duckDb).toBe(0);
  });

  it("the aftermath's breath releases over the chapter's own time (Act I 2 s, Act II 4 s, Act III 6 s)", () => {
    for (const chapterId of ['ch1-beginning', 'ch4-people', 'ch7-escape'] as const) {
      const r = running();
      const mix = CHAPTER_MIX[chapterId];
      const s = r.m.beginSession(info({ chapterId, mix, attempt: 2 }));
      s.setPhase('playing', false);
      s.duck('aftermath', { music: mix.aftermathDb, ambience: 0, effects: 0 });
      const p = DUCK_PRESETS.aftermath;
      r.advance(p.attackSec + (p.holdSec as number));
      expect(r.m.music.state().ducks.aftermath, chapterId).toBeCloseTo(mix.aftermathDb, 1);
      r.advance(mix.aftermathReleaseSec / 2);
      expect(r.m.music.state().ducks.aftermath, chapterId).toBeCloseTo(mix.aftermathDb / 2, 1);
      r.advance(mix.aftermathReleaseSec / 2 - 0.05);
      expect(r.m.music.state().ducks.aftermath ?? 0, chapterId).toBeLessThan(0);
      r.advance(0.1);
      expect(r.m.music.state().ducks.aftermath ?? 0, chapterId).toBe(0);
    }
  });

  it("the motif plays at the moment's own trim (never above 0 dB), traced", () => {
    const r = running();
    const motifGain = (): number | undefined => (r.m as unknown as { motif: { gain: GainNode } | null }).motif?.gain.gain.value;
    r.m.playMotif({ variant: 'act2', tempoScale: 1 }, 1, -6.5);
    expect(motifGain()).toBeCloseTo(Math.pow(10, -6.5 / 20), 9);
    expect(r.m.traceRing.since(0).some((e) => e.kind === 'motif' && /act2@1 .* -6\.5 dB$/.test(e.note ?? ''))).toBe(true);
    r.m.playMotif({ variant: 'act2', tempoScale: 1 }, 1, 3);
    expect(motifGain()).toBe(1);
  });

  it('the motif: null when muted or not baked; one at a time; the hold ends by its end + 10 s', () => {
    const r = running();
    r.m.music.setCue('cost');
    r.m.music.hold('reveal');
    expect(r.m.playMotif({ variant: 'act1', tempoScale: 1 }, 4)).toBe(null); // not in this level's set
    const a = r.m.playMotif({ variant: 'act2', tempoScale: 1 }, 4)!;
    expect(a.startsAt).toBeCloseTo(r.fake().fake.currentTime + 4, 6);
    expect(a.endsAt - a.startsAt).toBeCloseTo((15 * 60) / 58 + 4, 1);
    const b = r.m.playMotif({ variant: 'act2', tempoScale: 1 }, 0.5)!;
    expect(b).not.toBe(null);
    r.advance(0.2);
    const motifSources = r.fake().fake.sources().filter((x) => x instanceof FakeAudioBufferSourceNode && (x.buffer?.duration ?? 0) > 15);
    expect(motifSources.filter((x) => x.stopTime !== null)).toHaveLength(1); // the first one fades out
    r.m.applySettings({ ...DEFAULT_LEVELS, musicMuted: true });
    expect(r.m.playMotif({ variant: 'act2', tempoScale: 1 }, 0)).toBe(null);
    // The hold may not outlive the motif's end + HOLD_SAFETY_SEC.
    r.advance(b.endsAt - r.fake().fake.currentTime + 10.2);
    expect(r.m.music.state().holds).toEqual([]);
  });

  it('bells: strikes on the ambience bus, at most two ringing per church; a clank on the effects bus; choke silences', () => {
    const r = running();
    const h = r.fake();
    const req = (when: number, form: 'strike' | 'clank' = 'strike') =>
      ({ slot: 0, voicing: 'st-brides', form, when, velocity: 1, gainLin: 0.12, lowpassHz: 3000, pan: -0.3 }) as const;
    const v1 = r.s.playBell(req(h.fake.currentTime + 0.01))!;
    r.advance(2.4);
    r.s.playBell(req(h.fake.currentTime + 0.01));
    r.advance(2.4);
    r.s.playBell(req(h.fake.currentTime + 0.01));
    r.advance(0.01);
    expect(r.m.bellVoices()!.active(h.fake.currentTime)).toBe(2);
    expect(v1.endsAt).toBeGreaterThan(8);
    const clank = r.s.playBell(req(h.fake.currentTime + 0.01, 'clank'));
    expect(clank).not.toBe(null);
    expect(r.m.effects()!.active(h.fake.currentTime)).toBe(1);
    v1.update(0.05, 2000, 0.1); // a choked or finished voice ignores updates
    expect(r.s.playBell({ ...req(0), voicing: 'fjord-chapel' })).toBe(null); // not baked for this level
  });

  it('prepare is idempotent; a new level set replaces the previous one', () => {
    const r = running();
    const bank = r.m.bank() as ReturnType<typeof createToneBank>;
    const before = bank.jobs.length;
    r.m.prepare({ sounds: [...SOUND_IDS], bells: ['st-brides', 'clachan-kirk'], motifs: [{ variant: 'act2', tempoScale: 1 }] });
    expect(bank.jobs.length).toBe(before);
    r.m.prepare({ sounds: ['hit.wood'], bells: [], motifs: [] });
    expect(bank.jobs.length).toBe(before + 1);
    expect(bank.ready('house.collapse')).toBe(false);
    expect(bank.ready('hit.stone.light')).toBe(true); // core stays
  });
});

describe('Settings preview (P1)', () => {
  it('effects: one stone hit at m 0.5 from 30 m, throttled to 0.4 s, with the preview duck on the music', () => {
    const r = running();
    r.s.end();
    r.advance(0.3);
    r.m.preview('effects');
    r.m.preview('effects'); // within 0.4 s: ignored
    r.advance(0.01);
    expect(r.m.effects()!.active(r.fake().fake.currentTime)).toBe(1);
    const strip = r.m.effects()!.strips.find((s) => s.level > 0)!;
    expect(20 * Math.log10(strip.level)).toBeCloseTo(-25, 6); // HIT_LREF -12 + 26·(0.5 - 1)
    expect(r.m.music.state().ducks.preview).toBeLessThan(0);
    r.advance(0.4);
    r.m.preview('effects');
    r.advance(0.01);
    expect(r.m.effects()!.active(r.fake().fake.currentTime)).toBe(2);
  });

  it("ambience: a church strike from 120 m, from a cold start too (the core keeps St Bride's); nothing while no bell is baked", () => {
    const r = running();
    r.m.preview('ambience');
    r.advance(0.01);
    expect(r.m.bellVoices()!.active(r.fake().fake.currentTime)).toBe(1);
    // A cold start: no level with a church was ever asked for, only the core.
    const q = rig();
    q.gesture();
    q.m.prepare({ sounds: ['hit.wood'], bells: [], motifs: [] });
    q.m.preview('ambience');
    q.advance(0.01);
    expect(q.m.bellVoices()!.active(q.fake().fake.currentTime)).toBe(1);
    expect(q.m.traceRing.since().some((e) => e.note === 'preview ambience')).toBe(true);
    // Nothing baked yet (the bank's slices have not run): no bell and no duck.
    const z = rig({ scheduler: () => undefined });
    z.gesture();
    z.m.preview('ambience');
    z.advance(0.01);
    expect(z.m.bellVoices()!.active(z.fake().fake.currentTime)).toBe(0);
    expect(z.m.music.state().ducks.preview).toBeUndefined();
  });
});

describe('the motif calibration (R7/R10)', () => {
  it('the motif plays at music × MOTIF_CALIB_DB; the music channel still reads the slider', () => {
    const r = running();
    r.m.applySettings({ ...DEFAULT_LEVELS, music: 0.5 });
    r.advance(0.1);
    expect(r.m.motifCalibDb).toBe(MOTIF_CALIB_DB);
    expect(r.m.graph()!.motifGain.target).toBeCloseTo(0.5 * Math.pow(10, MOTIF_CALIB_DB / 20), 9);
    expect(r.m.state().buses.music).toBeCloseTo(0.5, 6);
  });
});

describe('the bake: before the gesture, paced by the screen, what was missed', () => {
  it('prepare() on a menu bakes before any gesture, constructing no AudioContext; the context then gets the buffers', () => {
    const r = rig();
    r.m.prepare({ sounds: ['house.collapse'], bells: ['loch-kirk'], motifs: [] });
    expect(r.fakes).toHaveLength(0);
    const bank = r.m.bank() as ReturnType<typeof createToneBank>;
    expect(bank).not.toBeNull();
    expect(bank.jobs.map((j) => j.scope)).toEqual(['core', 'level']);
    expect(bank.attached()).toBeNull();
    r.gesture();
    expect(r.fakes).toHaveLength(1);
    expect(bank.attached()).toBe(r.fake().ctx);
    // The bank is not built twice, and the level set is not asked for again.
    expect(r.m.bank()).toBe(bank);
    expect(bank.jobs.map((j) => j.scope)).toEqual(['core', 'level']);
    expect(bank.ready('house.collapse')).toBe(true);
    expect(bank.bell('loch-kirk', 'strike')).not.toBeNull();
  });

  it('the pace: loading behind the overlay or while a session loads, play while one plays, idle otherwise', () => {
    const r = rig();
    r.gesture();
    expect(r.m.bakePace()).toBe('idle');
    r.m.setLoadingScreen(true);
    expect(r.m.bakePace()).toBe('loading');
    const s = r.m.beginSession(info());
    r.m.setLoadingScreen(false);
    expect(r.m.bakePace()).toBe('loading'); // the session is still loading
    s.setPhase('intro', false);
    expect(r.m.bakePace()).toBe('play');
    s.setPhase('playing', false);
    expect(r.m.bakePace()).toBe('play');
    s.setPhase('paused', false);
    expect(r.m.bakePace()).toBe('idle');
    s.setPhase('complete', false);
    expect(r.m.bakePace()).toBe('idle');
    s.setPhase('playing', false);
    s.end();
    expect(r.m.bakePace()).toBe('idle');
    expect(r.m.bakeReport()).toMatchObject({ pace: 'idle', loadingScreen: false, time: null });
  });

  it('a moment waiting for a motif still baking: the bank bakes it first, at the loading pace off play, until it is baked', () => {
    const r = rig({ scheduler: () => undefined }); // nothing ever bakes
    r.gesture();
    const bank = r.m.bank() as ToneBank;
    const act2 = { variant: 'act2', tempoScale: 1 } as const;
    r.m.prepare({ sounds: [], bells: [], motifs: [act2] });
    const s = r.m.beginSession(info());
    s.setPhase('complete', false);
    expect(r.m.bakePace()).toBe('idle');
    r.m.awaitMotif(act2);
    // A repeat is passed on (the bank re-raises an entry dropped and asked for again; StoryMoments
    // asks again only when the moment that wants it changes).
    r.m.awaitMotif(act2);
    expect(bank.prioritized).toEqual(['act2@1', 'act2@1']);
    expect(r.m.bakePace()).toBe('loading');
    expect(r.m.bakeReport().awaitedMotif).toBe('act2@1');
    // Never faster in play (a new attempt) than play allows.
    s.setPhase('playing', false);
    expect(r.m.bakePace()).toBe('play');
    s.setPhase('complete', false);
    expect(r.m.bakePace()).toBe('loading');
    r.m.awaitMotif(null);
    expect(bank.prioritized).toEqual(['act2@1', 'act2@1', null]);
    expect(r.m.bakePace()).toBe('idle');
    expect(r.m.bakeReport().awaitedMotif).toBe(null);
    expect(r.m.traceRing.since().filter((e) => /^bake: .*wanted by a moment/.test(e.note ?? '')).map((e) => e.note)).toEqual([
      'bake: motif act2@1 wanted by a moment: baked first, at the loading pace',
      'bake: motif act2@1 wanted by a moment: baked first, at the loading pace',
      'bake: no motif wanted by a moment',
    ]);
    // Once it is baked the pace is back to idle, even before the moment lets go.
    const done = rig();
    done.gesture();
    done.m.prepare({ sounds: [], bells: [], motifs: [act2] });
    done.m.awaitMotif(act2);
    expect(done.m.bakePace()).toBe('idle');
    expect(done.m.bakeReport().awaitedMotif).toBe(null);
  });

  it('counts every notReady drop by sound and bell, and sums them up in the trace when the session ends', () => {
    const r = rig({ scheduler: () => undefined }); // nothing ever bakes
    r.gesture();
    const s = r.m.beginSession(info());
    s.setPhase('playing', false);
    s.beginFrame(1);
    expect(s.play(houseCollapse()).reason).toBe('notReady');
    s.beginFrame(2);
    expect(s.play(request([layer('hit.wood', { gainDb: -20 })])).reason).toBe('notReady');
    expect(s.bellReady('st-brides')).toBe(false);
    expect(s.playBell({ slot: 0, voicing: 'st-brides', form: 'strike', when: 0, velocity: 1, gainLin: 0.1, lowpassHz: 8000, pan: 0 })).toBeNull();
    const rep = r.m.bakeReport();
    expect(rep.notReady).toEqual({ 'house.collapse': 1, 'hit.wood': 1, 'bell st-brides strike': 1 });
    expect(rep.bellsNotReady).toEqual({ 'st-brides strike': 1 });
    s.end();
    const last = r.m.traceRing.since().filter((e) => e.note?.includes('notReady drops'));
    expect(last.map((e) => e.note)).toEqual([`session ${s.token} notReady drops: house.collapse ×1, hit.wood ×1, bell st-brides strike ×1`]);
  });

  it('bellReady is true once the strike is baked, and always when nothing could ever ring', () => {
    const r = running();
    expect(r.s.bellReady('st-brides')).toBe(true);
    expect(r.s.bellReady('pass-chapel')).toBe(false);
    const n = rig({ synthesis: false });
    n.gesture();
    expect(n.m.beginSession(info()).bellReady('pass-chapel')).toBe(true);
  });
});

describe('without Web Audio', () => {
  it('the Null manager constructs nothing and still drives the music router', () => {
    const player = new Player();
    const m = createAudioManager({ available: false, player, ticker: new ManualTicker() });
    expect(m).toBeInstanceOf(NullAudioManager);
    expect(m.available).toBe(false);
    expect(m.status()).toBe('unavailable');
    m.unlock();
    m.applySettings({ ...DEFAULT_LEVELS, master: 0.5 });
    m.music.setCue('wonder');
    m.duck('pause', DUCK_PRESETS.pause.arcade, 'arcade');
    m.music.hold('card');
    expect(player.calls).toEqual(['unlock', 'muted false', 'volume 0.3000', 'play wonder', 'play null']);
    const s = m.beginSession(info());
    expect(s.play(houseCollapse())).toEqual({ started: 0, reason: 'unavailable' });
    expect(s.ambience).toBe(null);
    expect(s.playBell({ slot: 0, voicing: 'st-brides', form: 'strike', when: 0, velocity: 1, gainLin: 1, lowpassHz: 1, pan: 0 })).toBe(null);
    expect(m.playMotif({ variant: 'act1', tempoScale: 1 }, 0)).toBe(null);
    expect(m.state()).toMatchObject({ available: false, status: 'unavailable', session: null });
    s.end();
  });
});
