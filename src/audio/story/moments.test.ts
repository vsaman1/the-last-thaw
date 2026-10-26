import { beforeEach, describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../story/chapters';
import type { ChapterId } from '../../story/types';
import {
  CARD_MOTIF,
  CHAPTER_MIX,
  DUCK_PRESETS,
  EPILOGUE_MOTIF,
  HOLD_MAX_SEC,
  MOMENT_TIMING,
  MOTIF_CALIB_DB,
  MOTIF_MOMENT_TRIM_DB,
  MOTIF_RENDER_LUFS,
  MOTIF_UNDER_RECORDING_LU,
  PLAY_DUCK_FLOOR_DB,
  REVELATION_MOTIF,
  type DuckKey,
  type MotifRequest,
} from '../contract';
import { CUE_PLAYLISTS, CUE_TRACKS, MUSIC_TARGET_LUFS, recordingGainDb } from '../tracks';
import { motifSeconds, RecordingAudioManager } from '../game/testing/recording';
import { motifTimeline } from '../synth/piano';
import {
  EPILOGUE_MOTIF_WAIT_SEC,
  MOTIF_RETRY_MS,
  MOTIF_WAIT_MIN_SEC,
  motifWaitSec,
  PERSISTENT_DUCKS,
  RELEASE_RECHECK_MS,
  resetCardMemory,
  StoryMoments,
  type MomentInputs,
  type MomentTimers,
} from './moments';

/** A manual clock for setTimeout-style timers. */
class ManualTimers implements MomentTimers {
  now = 0;
  private next = 1;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): number {
    const id = this.next++;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(id: number): void {
    this.due.delete(id);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.due].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > this.now) continue;
      this.due.delete(id);
      t.fn();
    }
  }
}

const human = { kind: 'letter' as const, author: 'ruth-vey', title: 'Note left on the kitchen table' };
const notice = { kind: 'notice' as const, author: 'Riverside Street Wardens', title: 'Street wardens' };

const base: MomentInputs = {
  screen: 'game',
  mode: 'story',
  chapterId: 'ch4-people',
  narrative: true,
  viewingRiver: false,
  phase: 'playing',
  outcome: null,
  epilogue: null,
};

function setup(options: { motifs?: boolean } = {}) {
  const engine = new RecordingAudioManager({ motifs: options.motifs ?? true });
  const timers = new ManualTimers();
  const moments = new StoryMoments(() => engine, timers);
  const advance = (sec: number): void => {
    engine.clock += sec;
    timers.advance(sec * 1000);
  };
  /** Advance in 10 ms steps, so timers set by timers run in the same span. */
  const run = (sec: number): void => {
    for (let i = 0; i < Math.round(sec / 0.01); i++) advance(0.01);
  };
  return { engine, timers, moments, advance, run };
}

type Doc = NonNullable<MomentInputs['outcome']>['fragments'][number];
const complete = (fragments: readonly Doc[] = [human], completedAt = '2026-10-22T10:00:00Z'): Partial<MomentInputs> => ({
  phase: 'complete',
  outcome: { chapterId: 'ch4-people', completedAt, fragments },
});

beforeEach(() => resetCardMemory());

describe('M1, the Archive Revelation', () => {
  it('the music leaves at t0, the motif at +4 s, back under the reading level 4 s after it ends', () => {
    const { engine, moments, advance } = setup();
    moments.update(base);
    moments.update({ ...base, ...complete() });
    expect(engine.music.calls).toContain('hold reveal');
    expect(engine.motifs).toHaveLength(1);
    expect(engine.motifs[0].motif).toEqual({ variant: 'act2', tempoScale: 1 });
    expect(engine.motifs[0].delaySec).toBe(MOMENT_TIMING.revealMotifAtSec);
    expect(engine.ducks.at(-1)).toEqual({ key: 'reading', levels: DUCK_PRESETS.reading.story, mode: 'story' });
    const length = MOMENT_TIMING.revealMotifAtSec + motifSeconds({ variant: 'act2', tempoScale: 1 });
    advance(length + MOMENT_TIMING.revealSilenceAfterSec - 0.1);
    expect(engine.music.holds.has('reveal')).toBe(true);
    advance(0.2);
    expect(engine.music.holds.has('reveal')).toBe(false);
  });

  it('"View the river" swaps the reading level for the lighter one; toggling twice plays no second motif', () => {
    const { engine, moments } = setup();
    moments.update(base);
    const done = { ...base, ...complete() };
    moments.update(done);
    moments.update({ ...done, viewingRiver: true });
    moments.update({ ...done, viewingRiver: false });
    moments.update({ ...done, viewingRiver: true });
    expect(engine.motifs).toHaveLength(1);
    const keys = engine.ducks.map((d) => `${d.key}:${d.levels === null ? 'off' : 'on'}`);
    expect(keys).toEqual(['reading:on', 'reading:off', 'readingRiver:on', 'readingRiver:off', 'reading:on', 'reading:off', 'readingRiver:on']);
  });

  it('no human document, or narrative off: no motif and no hold, only the reading level', () => {
    for (const inputs of [
      { ...base, ...complete([notice]) },
      { ...base, narrative: false, ...complete() },
    ]) {
      const { engine, moments } = setup();
      moments.update(base);
      moments.update(inputs);
      expect(engine.motifs).toHaveLength(0);
      expect(engine.music.calls.filter((c) => c.startsWith('hold'))).toHaveLength(0);
      expect(engine.ducks.map((d) => d.key)).toEqual(['reading']);
    }
  });

  it('a motif that cannot play (no running context) releases the hold at once (the music is never left out without it)', () => {
    const { engine, moments } = setup({ motifs: false });
    moments.update(base);
    moments.update({ ...base, ...complete() });
    expect(engine.music.calls).toEqual(['hold reveal', 'release reveal']);
  });

  it('a motif still baking is waited for: it starts on time if baked by then, late if baked a little later', () => {
    const { engine, moments, run } = setup({ motifs: false });
    engine.unlock();
    moments.update(base);
    moments.update({ ...base, ...complete() });
    expect(engine.music.calls).toEqual(['hold reveal']);
    run(1.1); // baked a second in: still on time (+4.0 s from the trigger)
    engine.motifsReady = true;
    run(MOTIF_RETRY_MS / 1000);
    expect(engine.motifs).toHaveLength(1);
    expect(engine.motifs[0].delaySec).toBeCloseTo(MOMENT_TIMING.revealMotifAtSec - 1.25, 6);
    expect(engine.music.calls).toEqual(['hold reveal']);
  });

  it("the chapter 8 card waits for its motif up to MOTIF_WAIT_MIN_SEC + the late margin; past that the music comes back", () => {
    const late = setup({ motifs: false });
    late.engine.unlock();
    late.moments.update({ ...base, screen: 'story' });
    late.moments.update({ ...base, screen: 'storyIntro', chapterId: 'ch8-remains' });
    late.run(2.1);
    late.engine.motifsReady = true;
    late.run(MOTIF_RETRY_MS / 1000);
    // Baked 2.25 s in, after its +1.2 s: it starts at once (late, not lost).
    expect(late.engine.motifs.map((m) => [m.motif.variant, m.delaySec])).toEqual([['ch8', 0.005]]);
    resetCardMemory();
    const never = setup({ motifs: false });
    never.engine.unlock();
    never.moments.update({ ...base, screen: 'story' });
    never.moments.update({ ...base, screen: 'storyIntro', chapterId: 'ch8-remains' });
    never.run(MOTIF_WAIT_MIN_SEC + MOMENT_TIMING.motifLateReleaseSec + 0.5);
    expect(never.engine.motifs).toHaveLength(0);
    expect(never.engine.music.calls.filter((c) => /card/.test(c))).toEqual(['hold card', 'release card']);
  });

  it('muted, nothing is waited for', () => {
    const { engine, moments } = setup({ motifs: false });
    engine.unlock();
    engine.applySettings({ master: 1, music: 0.6, ambience: 0.8, effects: 0.8, musicMuted: true, soundMuted: false });
    moments.update(base);
    moments.update({ ...base, ...complete() });
    expect(engine.music.calls.filter((c) => /reveal/.test(c))).toEqual(['hold reveal', 'release reveal']);
  });

  it('a panel that remounts (the same completedAt) replays nothing; leaving mid-motif fades and releases', () => {
    const { engine, moments } = setup();
    const done = { ...base, ...complete() };
    moments.update(done); // first look: the outcome was already there
    expect(engine.motifs).toHaveLength(0);
    moments.update({ ...done, ...complete([human], 'later') });
    expect(engine.motifs).toHaveLength(1);
    moments.update({ ...done, ...complete([human], 'later'), screen: 'story' });
    expect(engine.motifs[0].stopped).toBe(MOMENT_TIMING.motifFadeOnLeaveSec);
    expect(engine.music.holds.size).toBe(0);
    expect(engine.ducks.at(-1)).toEqual({ key: 'reading', levels: null, mode: 'story' });
  });
});

describe('a motif still baking when its moment comes', () => {
  const ch9 = { ...base, chapterId: 'ch9-last-thaw' as const };
  const ch9Done = (fragments: readonly Doc[]): MomentInputs => ({ ...ch9, phase: 'complete', outcome: { chapterId: 'ch9-last-thaw', completedAt: 'x', fragments } });

  it('the moment asks the engine for it (first, faster) once, and lets go when it plays, gives up or ends', () => {
    // Baked inside the wait: asked for, then let go as it starts.
    const late = setup({ motifs: false });
    late.engine.unlock();
    late.moments.update(base);
    late.moments.update({ ...base, ...complete() });
    expect(late.engine.awaited).toEqual(['act2@1']);
    late.run(1.1);
    late.engine.motifsReady = true;
    late.run(MOTIF_RETRY_MS / 1000);
    expect(late.engine.motifs).toHaveLength(1);
    expect(late.engine.awaited).toEqual(['act2@1', null]);
    // Never baked: let go when the moment gives up (and the music comes back).
    const never = setup({ motifs: false });
    never.engine.unlock();
    never.moments.update(base);
    never.moments.update({ ...base, ...complete() });
    never.run(motifWaitSec('reveal', MOMENT_TIMING.revealMotifAtSec) + 0.5);
    expect(never.engine.awaited).toEqual(['act2@1', null]);
    expect(never.engine.music.calls).toEqual(['hold reveal', 'release reveal']);
    // Leaving while it waits.
    const left = setup({ motifs: false });
    left.engine.unlock();
    left.moments.update(base);
    left.moments.update({ ...base, ...complete() });
    left.moments.update({ ...base, screen: 'mainMenu', phase: 'loading', outcome: null });
    expect(left.engine.awaited).toEqual(['act2@1', null]);
    // Baked in time: nothing asked for.
    const ready = setup();
    ready.moments.update(base);
    ready.moments.update({ ...base, ...complete() });
    expect(ready.engine.awaited).toEqual([]);
  });

  it('the epilogue waits up to EPILOGUE_MOTIF_WAIT_SEC for its motif, the music held meanwhile; the revelation keeps its own wait', () => {
    expect(motifWaitSec('reveal', MOMENT_TIMING.revealMotifAtSec)).toBe(MOMENT_TIMING.revealMotifAtSec + MOMENT_TIMING.motifLateReleaseSec);
    expect(motifWaitSec('card', MOMENT_TIMING.cardMotifAtSec)).toBe(MOTIF_WAIT_MIN_SEC + MOMENT_TIMING.motifLateReleaseSec);
    expect(motifWaitSec('epilogue', MOMENT_TIMING.epilogueMotifAtSec)).toBe(EPILOGUE_MOTIF_WAIT_SEC);
    // No human document: no revelation motif, so the epilogue's own wait is all there is.
    const late = setup({ motifs: false });
    late.engine.unlock();
    late.moments.update(ch9);
    late.moments.update(ch9Done([notice]));
    late.moments.update({ ...ch9Done([notice]), epilogue: {} });
    late.run(EPILOGUE_MOTIF_WAIT_SEC - 1);
    expect(late.engine.music.holds.has('epilogue')).toBe(true);
    expect(late.engine.motifs).toHaveLength(0);
    late.engine.motifsReady = true;
    late.run(MOTIF_RETRY_MS / 1000);
    // Baked 14 s in: it starts at once (late, not lost), and the music stays out for it.
    expect(late.engine.motifs.map((m) => [m.motif.variant, m.delaySec])).toEqual([['epilogue', 0.005]]);
    expect(late.engine.music.holds.has('epilogue')).toBe(true);
    // Asked for as the next motif on the Revelation, then by the epilogue itself (its own ask, which
    // re-raises an entry dropped and asked for again meanwhile), and let go once it plays.
    expect(late.engine.awaited).toEqual(['epilogue@1', 'epilogue@1', null]);
    const never = setup({ motifs: false });
    never.engine.unlock();
    never.moments.update(ch9);
    never.moments.update(ch9Done([notice]));
    never.moments.update({ ...ch9Done([notice]), epilogue: {} });
    never.run(EPILOGUE_MOTIF_WAIT_SEC - 0.3);
    expect(never.engine.music.holds.has('epilogue')).toBe(true);
    never.run(0.6);
    expect(never.engine.music.holds.has('epilogue')).toBe(false);
    expect(never.engine.awaited).toEqual(['epilogue@1', 'epilogue@1', null]);
  });

  it("chapter 9's Revelation asks for the epilogue's motif (it plays next) until the epilogue starts or the run ends; no other chapter does", () => {
    // Its own motif baked: the epilogue's is asked for from the run's end, and let go once it plays.
    const { engine, moments } = setup();
    engine.unlock();
    moments.update(ch9);
    moments.update(ch9Done([human]));
    expect(engine.motifs.map((m) => m.motif.variant)).toEqual(['act3-bare']);
    expect(engine.awaited).toEqual(['epilogue@1']);
    moments.update({ ...ch9Done([human]), viewingRiver: true });
    expect(engine.awaited).toEqual(['epilogue@1']);
    moments.update({ ...ch9Done([human]), viewingRiver: true, epilogue: {} });
    expect(engine.motifs.map((m) => m.motif.variant)).toEqual(['act3-bare', 'epilogue']);
    expect(engine.awaited).toEqual(['epilogue@1', null]);
    // The Revelation's own motif still baking: it comes first, then the epilogue's.
    const late = setup({ motifs: false });
    late.engine.unlock();
    late.moments.update(ch9);
    late.moments.update(ch9Done([human]));
    expect(late.engine.awaited).toEqual(['act3-bare@1']);
    late.engine.motifsReady = true;
    late.run(MOTIF_RETRY_MS / 1000);
    expect(late.engine.awaited).toEqual(['act3-bare@1', 'epilogue@1']);
    // Replay chapter on the Revelation: the run is gone, so is the ask.
    late.moments.update({ ...ch9Done([human]), outcome: null, phase: 'loading' });
    expect(late.engine.awaited).toEqual(['act3-bare@1', 'epilogue@1', null]);
    // Another chapter's Revelation with its motif baked asks for nothing.
    const ch4 = setup();
    ch4.moments.update(base);
    ch4.moments.update({ ...base, ...complete() });
    expect(ch4.engine.awaited).toEqual([]);
  });

  it("the epilogue's latest start, its motif and the silence after it fit inside the router's HOLD_MAX_SEC", () => {
    const epilogueSec = motifTimeline({ variant: EPILOGUE_MOTIF, tempoScale: 1 }).totalSec;
    expect(EPILOGUE_MOTIF_WAIT_SEC + epilogueSec + MOMENT_TIMING.epilogueSilenceAfterSec).toBeLessThan(HOLD_MAX_SEC);
  });
});

describe('a new attempt on the same screen ends the revelation (Replay chapter, R, Continue with narrative off)', () => {
  const reading = (engine: RecordingAudioManager) => engine.ducks.filter((d) => d.key === 'reading').at(-1)?.levels ?? null;

  it('Replay chapter / R: the outcome resets and the phase goes back to loading: motif faded, hold and reading released', () => {
    const { engine, moments, advance } = setup();
    moments.update(base);
    const done = { ...base, ...complete() };
    moments.update(done);
    advance(1); // the panel has been open a second: the motif is scheduled, not started
    expect(engine.music.holds.has('reveal')).toBe(true);
    expect(reading(engine)).toEqual(DUCK_PRESETS.reading.story);
    // restartAttempt: the store bumps the attempt, attachStorySession nulls the outcome, the phase loads.
    moments.update({ ...done, outcome: null });
    moments.update({ ...done, outcome: null, phase: 'loading' });
    expect(engine.motifs[0].stopped).toBe(MOMENT_TIMING.motifFadeOnLeaveSec);
    expect(engine.music.holds.size).toBe(0);
    expect(reading(engine)).toBeNull();
    moments.update({ ...base, phase: 'playing' });
    advance(60);
    expect(engine.ducks.filter((d) => d.levels !== null).map((d) => d.key)).toEqual(['reading']);
    expect(engine.music.holds.size).toBe(0);
  });

  it('the phase leaving complete for play ends it even if the outcome lingers a frame', () => {
    const { engine, moments } = setup();
    moments.update(base);
    const done = { ...base, ...complete() };
    moments.update(done);
    moments.update({ ...done, phase: 'playing' });
    expect(engine.music.holds.size).toBe(0);
    expect(reading(engine)).toBeNull();
  });

  it('Continue to chapter N with narrative off: the next chapter loads on the same screen with nothing held', () => {
    const { engine, moments } = setup();
    const off = { ...base, narrative: false };
    moments.update(off);
    moments.update({ ...off, ...complete() });
    expect(reading(engine)).toEqual(DUCK_PRESETS.reading.story);
    moments.update({ ...off, chapterId: 'ch5-denial', phase: 'loading', outcome: null });
    expect(reading(engine)).toBeNull();
    moments.update({ ...off, chapterId: 'ch5-denial', phase: 'playing' });
    expect(reading(engine)).toBeNull();
    expect(engine.ducks.map((d) => `${d.key}:${d.levels === null ? 'off' : 'on'}`)).toEqual(['reading:on', 'reading:off']);
  });

  it('R in the river view after the epilogue ends the epilogue (its motif, hold and reading level)', () => {
    const { engine, moments } = setup();
    const ch9 = { ...base, chapterId: 'ch9-last-thaw' as const };
    moments.update(ch9);
    const done = { ...ch9, phase: 'complete' as const, outcome: { chapterId: 'ch9-last-thaw' as const, completedAt: 'x', fragments: [human] } };
    moments.update(done);
    moments.update({ ...done, viewingRiver: true, epilogue: {} });
    expect(engine.music.holds.has('epilogue')).toBe(true);
    moments.update({ ...ch9, phase: 'loading', outcome: null, epilogue: null });
    expect(engine.motifs.every((m) => m.stopped === MOMENT_TIMING.motifFadeOnLeaveSec)).toBe(true);
    expect(engine.music.holds.size).toBe(0);
    const last = new Map(engine.ducks.map((d) => [d.key, d.levels]));
    expect(last.get('epilogueReading')).toBeNull();
    expect(last.get('reading') ?? null).toBeNull();
  });

  it('a pause on the revelation (a hidden tab pauses the game) keeps it', () => {
    const { engine, moments } = setup();
    moments.update(base);
    const done = { ...base, ...complete() };
    moments.update(done);
    moments.update({ ...done, phase: 'paused' });
    moments.update(done);
    expect(engine.music.holds.has('reveal')).toBe(true);
    expect(engine.motifs[0].stopped).toBeNull();
  });
});

describe('the music comes back on the audio clock (a hidden tab suspends it)', () => {
  it('a hidden tab mid-motif: the hold stays until the audio clock passes the motif and its silence', () => {
    const { engine, moments, timers, advance } = setup();
    moments.update(base);
    moments.update({ ...base, ...complete() });
    advance(MOMENT_TIMING.revealMotifAtSec + 3); // 3 s into the motif
    // Hidden: the context is suspended, so the audio clock stops while wall time runs on for 20 s.
    for (let i = 0; i < 80; i++) timers.advance(250);
    expect(engine.music.holds.has('reveal')).toBe(true);
    expect(engine.music.calls).not.toContain('release reveal');
    // Shown again: the clock resumes where it stopped.
    const left = MOMENT_TIMING.revealMotifAtSec + motifSeconds({ variant: 'act2', tempoScale: 1 }) + MOMENT_TIMING.revealSilenceAfterSec - engine.clock;
    for (let t = 0; t < left - 0.3; t += 0.05) advance(0.05);
    expect(engine.music.holds.has('reveal')).toBe(true);
    for (let t = 0; t < 0.6; t += 0.05) advance(0.05);
    expect(engine.music.holds.has('reveal')).toBe(false);
  });

  it('a slow audio clock (headless Chrome runs it at about 0.84x) releases on audio time, not early', () => {
    const { engine, moments, timers } = setup();
    moments.update(base);
    moments.update({ ...base, ...complete() });
    const due = MOMENT_TIMING.revealMotifAtSec + motifSeconds({ variant: 'act2', tempoScale: 1 }) + MOMENT_TIMING.revealSilenceAfterSec;
    let released = -1;
    for (let wall = 0; wall < 60 && released < 0; wall += 0.05) {
      engine.clock += 0.05 * 0.84;
      timers.advance(50);
      if (!engine.music.holds.has('reveal')) released = engine.clock;
    }
    expect(released).toBeGreaterThanOrEqual(due - 1e-9);
    expect(released).toBeLessThan(due + RELEASE_RECHECK_MS / 1000 + 0.05);
  });
});

describe("the motif's level (lead decision L1)", () => {
  it("each moment's trim goes to the engine; the attempt's scar lowers the motif by as much (its target)", () => {
    const { engine, moments } = setup();
    moments.update(base);
    moments.update({ ...base, ...complete() });
    expect(engine.motifs[0].gainDb).toBe(MOTIF_MOMENT_TRIM_DB.reveal['ch4-people']);
    // A scarred attempt in chapter 7: the recording sits 3 dB lower for the rest of it, and so does the motif.
    const scarred = setup();
    scarred.engine.music.duck('scar', -3);
    const ch7 = { ...base, chapterId: 'ch7-escape' as const };
    scarred.moments.update(ch7);
    scarred.moments.update({ ...ch7, phase: 'complete', outcome: { chapterId: 'ch7-escape', completedAt: 'y', fragments: [human] } });
    expect(scarred.engine.motifs[0].gainDb).toBe(MOTIF_MOMENT_TRIM_DB.reveal['ch7-escape'] - 3);
  });

  it('the chapter 8 card and the epilogue use their own trims', () => {
    const { engine, moments } = setup();
    moments.update({ ...base, screen: 'story' });
    moments.update({ ...base, screen: 'storyIntro', chapterId: 'ch8-remains', phase: 'loading' });
    expect(engine.motifs[0].gainDb).toBe(MOTIF_MOMENT_TRIM_DB.card['ch8-remains']);
    const epi = setup();
    const ch9 = { ...base, chapterId: 'ch9-last-thaw' as const };
    epi.moments.update(ch9);
    const done = { ...ch9, phase: 'complete' as const, outcome: { chapterId: 'ch9-last-thaw' as const, completedAt: 'x', fragments: [human] } };
    epi.moments.update(done);
    epi.moments.update({ ...done, epilogue: {} });
    expect(epi.engine.motifs.map((m) => m.gainDb)).toEqual([MOTIF_MOMENT_TRIM_DB.reveal['ch9-last-thaw'], MOTIF_MOMENT_TRIM_DB.epilogue]);
  });
});

describe('M2, the epilogue', () => {
  it('plays once, its own variant, and fades the revelation motif first', () => {
    const { engine, moments } = setup();
    moments.update({ ...base, chapterId: 'ch9-last-thaw' });
    const done = { ...base, chapterId: 'ch9-last-thaw' as const, phase: 'complete' as const, outcome: { chapterId: 'ch9-last-thaw' as const, completedAt: 'x', fragments: [human] } };
    moments.update(done);
    expect(engine.motifs[0].motif.variant).toBe('act3-bare');
    const epi = { ...done, viewingRiver: true, epilogue: {} };
    moments.update(epi);
    moments.update({ ...epi });
    expect(engine.motifs.map((m) => m.motif.variant)).toEqual(['act3-bare', 'epilogue']);
    expect(engine.motifs[0].stopped).toBe(MOMENT_TIMING.motifFadeOnLeaveSec);
    expect(engine.motifs[1].delaySec).toBe(MOMENT_TIMING.epilogueMotifAtSec);
    expect(engine.music.holds.has('epilogue')).toBe(true);
    expect(engine.music.holds.has('reveal')).toBe(false);
    expect(engine.ducks.filter((d) => d.levels !== null).at(-1)?.key).toBe('epilogueReading');
  });
});

describe('M3, the chapter 8 card', () => {
  const card: MomentInputs = { ...base, screen: 'storyIntro', chapterId: 'ch8-remains', phase: 'loading' };

  it('plays once per app session (StrictMode and a second visit play nothing more)', () => {
    const { engine, moments } = setup();
    moments.update({ ...base, screen: 'story' });
    moments.update(card);
    moments.update(card);
    const again = new StoryMoments(() => engine);
    again.update({ ...base, screen: 'story' });
    again.update(card);
    expect(engine.motifs).toHaveLength(1);
    expect(engine.motifs[0]).toMatchObject({ motif: { variant: 'ch8', tempoScale: 1 }, delaySec: MOMENT_TIMING.cardMotifAtSec });
  });

  it('only chapter 8, only with narrative; Begin pressed early fades it and lets the music in', () => {
    const { engine, moments } = setup();
    moments.update({ ...base, screen: 'story' });
    moments.update({ ...card, chapterId: 'ch7-escape' });
    moments.update({ ...base, screen: 'story' });
    moments.update({ ...card, narrative: false });
    expect(engine.motifs).toHaveLength(0);
    moments.update({ ...base, screen: 'story' });
    moments.update(card);
    expect(engine.music.holds.has('card')).toBe(true);
    moments.update({ ...card, screen: 'game' });
    expect(engine.motifs[0].stopped).toBe(MOMENT_TIMING.motifFadeOnLeaveSec);
    expect(engine.music.holds.has('card')).toBe(false);
  });

  it('nothing plays on the Archive or Science screens', () => {
    const { engine, moments } = setup();
    for (const screen of ['archive', 'science', 'epilogue'] as const) moments.update({ ...base, screen, ...complete() });
    expect(engine.motifs).toHaveLength(0);
  });
});

describe("L1: no moment's motif sits louder than its chapter's recording at that moment", () => {
  type Kind = 'revelation' | 'card' | 'epilogue';
  /** The moment's own reading level on the recording (dB): -6 under the panel, -8 for the epilogue, none on the card. */
  const momentDuck = (kind: Kind): number =>
    kind === 'revelation' ? DUCK_PRESETS.reading.story!.music : kind === 'epilogue' ? DUCK_PRESETS.epilogueReading.story!.music : 0;
  /** What the real StoryMoments passes to playMotif for the moment, with these ducks on the recording. */
  const playedGain = (chapterId: ChapterId, kind: Kind, ducks: Partial<Record<DuckKey, number>>): { motif: MotifRequest; gainDb: number } => {
    resetCardMemory();
    const { engine, moments } = setup();
    for (const [key, db] of Object.entries(ducks)) engine.music.duck(key as DuckKey, db);
    const at = { ...base, chapterId };
    if (kind === 'card') {
      moments.update({ ...at, screen: 'story' });
      moments.update({ ...at, screen: 'storyIntro', phase: 'loading' });
    } else {
      moments.update(at);
      const done = { ...at, phase: 'complete' as const, outcome: { chapterId, completedAt: 't', fragments: [human] } };
      moments.update(done);
      if (kind === 'epilogue') moments.update({ ...done, epilogue: {} });
    }
    const m = engine.motifs.at(-1)!;
    return { motif: m.motif, gainDb: m.gainDb };
  };
  /**
   * The chapter's recording at the moment (LUFS-I at music 1): the quietest file of the cue's playlist
   * as heard (whichever plays), the bed (0 on the card, a Story screen), the moment's reading level and
   * the ducks still on it, their sum floored by the router at PLAY_DUCK_FLOOR_DB.
   */
  const recordingAt = (chapterId: ChapterId, kind: Kind, ducks: Partial<Record<DuckKey, number>>): number => {
    const cue = CHAPTERS.find((c) => c.id === chapterId)!.music;
    const heard = Math.min(...CUE_PLAYLISTS[cue].map((f) => CUE_TRACKS[f].lufsI + recordingGainDb(f)));
    const bed = kind === 'card' ? 0 : CHAPTER_MIX[chapterId].musicBedDb;
    const duckSum = Object.values(ducks).reduce((a, b) => a + b, momentDuck(kind));
    return heard + bed + Math.max(PLAY_DUCK_FLOOR_DB, duckSum);
  };
  const motifLufs = (m: MotifRequest, gainDb: number): number => MOTIF_RENDER_LUFS[`${m.variant}@${m.tempoScale}`] + MOTIF_CALIB_DB + gainDb;
  /** Every moment of the story: nine Revelations, the chapter 8 card, the epilogue. */
  const MOMENTS: readonly { chapterId: ChapterId; kind: Kind }[] = [
    ...CHAPTERS.map((c) => ({ chapterId: c.id, kind: 'revelation' as const })),
    ...(Object.keys(MOTIF_MOMENT_TRIM_DB.card) as ChapterId[]).map((chapterId) => ({ chapterId, kind: 'card' as const })),
    { chapterId: 'ch9-last-thaw', kind: 'epilogue' },
  ];
  /** The ducks always on the recording at the moment: the game completes a run only in the sea. */
  const always = (chapterId: ChapterId, kind: Kind): Partial<Record<DuckKey, number>> =>
    chapterId === 'ch9-last-thaw' && kind !== 'card' ? { seaCh9: DUCK_PRESETS.seaCh9.story!.music } : {};
  const rows = (scarred: boolean) =>
    MOMENTS.map(({ chapterId, kind }) => {
      // A scarred attempt carries the chapter's deepest scar (the card is outside any attempt).
      const scar = scarred && kind !== 'card' ? { scar: -CHAPTER_MIX[chapterId].scarMaxDb } : {};
      // The sea is on the recording when the moment comes, but the motif keeps its chapter's level
      // (L1b): it is measured against the recording without the sea.
      const { motif, gainDb } = playedGain(chapterId, kind, { ...always(chapterId, kind), ...scar });
      return { moment: `${chapterId} ${kind}${scarred ? ' (scarred)' : ''}`, motif: motifLufs(motif, gainDb), recording: recordingAt(chapterId, kind, scar) };
    });
  const over = (rs: ReturnType<typeof rows>) =>
    rs.filter((r) => r.motif > r.recording - MOTIF_UNDER_RECORDING_LU + 1e-9).map((r) => `${r.moment}: motif ${r.motif.toFixed(2)} vs recording ${r.recording.toFixed(2)}`);

  it('every variant at its moment is at least MOTIF_UNDER_RECORDING_LU under the recording (bed, reading level and the scar)', () => {
    expect(rows(false)).toHaveLength(CHAPTERS.length + 2);
    // The rows are the moments' own motifs (the card's is chapter 8's, the Revelations' their chapter's).
    expect(playedGain('ch8-remains', 'card', {}).motif.variant).toBe(CARD_MOTIF['ch8-remains']);
    for (const c of CHAPTERS) expect(playedGain(c.id, 'revelation', {}).motif, c.id).toEqual(REVELATION_MOTIF[c.id]);
    expect(over(rows(false))).toEqual([]);
    expect(over(rows(true))).toEqual([]);
  });

  it('chapter 9 (L1b): the motifs keep their level under the sea duck, and the epilogue lowers the world instead', () => {
    const sea = DUCK_PRESETS.seaCh9.story!.music;
    expect(sea).toBeLessThan(0);
    // The sea is on the recording at the Revelation and the epilogue; the motif does not follow it.
    expect(playedGain('ch9-last-thaw', 'revelation', { seaCh9: sea }).gainDb).toBe(MOTIF_MOMENT_TRIM_DB.reveal['ch9-last-thaw']);
    expect(playedGain('ch9-last-thaw', 'epilogue', { seaCh9: sea }).gainDb).toBe(MOTIF_MOMENT_TRIM_DB.epilogue);
    // The epilogue takes the ambience (the waves) down further than any other reading level does.
    const epi = DUCK_PRESETS.epilogueReading.story!;
    expect(epi.ambience).toBeLessThanOrEqual(-14);
    expect(epi.ambience).toBeLessThan(DUCK_PRESETS.reading.story!.ambience);
    expect(Math.max(epi.music, epi.ambience, epi.effects)).toBeLessThan(0);
  });

  it('the router floors the ducks at PLAY_DUCK_FLOOR_DB, so the motif is lowered no further than the recording is', () => {
    // Epilogue: -8 reading and a -14 scar would be -22; the recording stops at -20, so the motif is lowered
    // 12. The sea's -10 dB on top changes nothing (L1b).
    const { gainDb } = playedGain('ch9-last-thaw', 'epilogue', { seaCh9: -10, scar: -14 });
    expect(gainDb).toBe(MOTIF_MOMENT_TRIM_DB.epilogue + (PLAY_DUCK_FLOOR_DB - DUCK_PRESETS.epilogueReading.story!.music));
    // A duck that releases by itself (a landmark) is gone when the recording comes back: not counted.
    expect(playedGain('ch7-escape', 'revelation', { landmark: -10 }).gainDb).toBe(MOTIF_MOMENT_TRIM_DB.reveal['ch7-escape']);
  });

  it('every trim is a cut, every render has a measured loudness, and the trims are not deeper than needed (within 0.5 dB)', () => {
    for (const r of rows(false)) expect(r.recording - r.motif, r.moment).toBeLessThan(MOTIF_UNDER_RECORDING_LU + 0.5 + 1e-9 + (r.moment.includes(' card') ? 99 : 0));
    for (const t of [...Object.values(MOTIF_MOMENT_TRIM_DB.reveal), ...Object.values(MOTIF_MOMENT_TRIM_DB.card), MOTIF_MOMENT_TRIM_DB.epilogue]) expect(t).toBeLessThanOrEqual(0);
    for (const m of [...Object.values(REVELATION_MOTIF), { variant: EPILOGUE_MOTIF, tempoScale: 1 }]) expect(MOTIF_RENDER_LUFS[`${m.variant}@${m.tempoScale}`], m.variant).toBeLessThan(0);
    expect(PERSISTENT_DUCKS).toEqual(['scar']);
  });

  it("MOTIF_CALIB_DB is DESIGN §8.5's rule against the matched recordings: 3 LU under them, at the renders' median", () => {
    const renders = Object.values(MOTIF_RENDER_LUFS).sort((a, b) => a - b);
    const median = renders[Math.floor(renders.length / 2)];
    expect(MOTIF_CALIB_DB).toBeCloseTo(MUSIC_TARGET_LUFS - 3 - median, 1);
  });
});
