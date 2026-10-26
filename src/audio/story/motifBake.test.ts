/**
 * The S11E race (docs/evidence/AUDIO_RUNS.md, "Epilogue motif bake"): a moment comes while its motif
 * is still baking. StoryMoments, the real engine, the real bank and the browser's paced scheduler run
 * on a simulated main thread where the river view keeps rendering behind the panel, so an idle
 * callback never finds idle time: it comes only on its timeout, with nothing left of it (1 ms of
 * bake), the way the Revelation starved the bake in the browser. A timer slice runs once per frame.
 */
import { describe, expect, it } from 'vitest';
import { MOMENT_TIMING, REVELATION_MOTIF, type SoundId } from '../contract';
import { levelSoundSet } from '../game/levelSet';
import { WebAudioManager } from '../manager';
import type { MusicPlayer } from '../music';
import { createSoundBank, pacedScheduler, type PacerTimers } from '../synth/bank';
import { createFakeAudioContext, type FakeHandle } from '../testing/fakeAudioContext';
import { ManualTicker } from '../testing/manualTicker';
import { ManualTimers } from '../testing/manualTimers';
import { EPILOGUE_MOTIF_WAIT_SEC, motifWaitSec, StoryMoments, type MomentInputs } from './moments';

/** The river view's frame (ms of main thread before any task runs). */
const FRAME_MS = 16;
/** One recipe step of the bake (each look at the bank's clock is this much work). */
const STEP_MS = 1;

const silentPlayer: MusicPlayer = { play: () => undefined, setVolume: () => undefined, setMuted: () => undefined, unlock: () => undefined };

/** A main thread: the frame renders, then the tasks that were due when it began run, in order. */
function mainThread() {
  let t = 0;
  let seq = 0;
  let tasks: { at: number; seq: number; fn: () => void }[] = [];
  const post = (fn: () => void, ms: number): void => void tasks.push({ at: t + ms, seq: seq++, fn });
  const timers: PacerTimers = {
    now: () => t,
    setTimeout: (fn, ms) => post(fn, ms),
    requestIdle: (fn, o) => post(() => fn({ timeRemaining: () => 0, didTimeout: true }), o.timeout),
  };
  const frame = (): void => {
    t += FRAME_MS;
    const due = tasks.filter((x) => x.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq);
    tasks = tasks.filter((x) => !due.includes(x));
    for (const x of due) x.fn();
  };
  return { timers, frame, now: () => t, work: () => (t += STEP_MS) };
}

const human = { kind: 'letter' as const, author: 'ruth-vey', title: 'Note left on the kitchen table' };
const ch9: MomentInputs = {
  screen: 'game',
  mode: 'story',
  chapterId: 'ch9-last-thaw',
  narrative: true,
  viewingRiver: false,
  phase: 'playing',
  outcome: null,
  epilogue: null,
};

/** The real engine, bank and paced scheduler on the simulated main thread, unlocked, with StoryMoments. */
function rig() {
  const main = mainThread();
  const timers = new ManualTimers();
  const momentTimers = new ManualTimers();
  const ticker = new ManualTicker();
  const busTicker = new ManualTicker();
  let fake: FakeHandle | null = null;
  // eslint-disable-next-line prefer-const
  let m: WebAudioManager;
  const paced = pacedScheduler(() => m.bakePace(), main.timers);
  m = new WebAudioManager({
    synthesis: {
      createSoundBank: (s, seed) => createSoundBank(s, seed, { now: main.work }),
      createNoiseBank: null,
      createAmbienceVoices: null,
      generateSpaceIR: null,
    },
    player: silentPlayer,
    ticker,
    busTicker,
    timers,
    target: null,
    hasActivation: () => true,
    scheduler: paced,
    debug: true,
    createContext: () => {
      fake = createFakeAudioContext({ resume: 'sync' });
      return fake.ctx as unknown as AudioContext;
    },
  });
  m.unlock();
  expect(m.status()).toBe('running');
  let last = 0;
  const frame = (): void => {
    main.frame();
    const dt = main.now() - last;
    last = main.now();
    timers.advance(dt);
    ticker.advance(dt, 10);
    busTicker.advance(dt, 10);
    fake?.advance(dt / 1000);
    momentTimers.advance(dt);
  };
  const moments = new StoryMoments(() => m, { set: (fn, ms) => momentTimers.setTimeout(fn, ms) as number, clear: (id) => momentTimers.clearTimeout(id) });
  return { main, m, paced, frame, moments };
}

describe('a moment whose motif is still baking', () => {
  it('raises the motif to the front of the bake and the pace to timer slices, and plays it once baked inside the wait', () => {
    const { main, m, paced, frame, moments } = rig();

    // Chapter 9's set asked for, and the run completes before the bake has got anywhere.
    const set = levelSoundSet('', 'ch9-last-thaw');
    m.prepare(set);
    for (let i = 0; i < 3; i++) frame();
    const bank = m.bank()!;
    const motif = REVELATION_MOTIF['ch9-last-thaw'];
    expect(bank.motif(motif)).toBeNull();
    moments.update(ch9);
    moments.update({ ...ch9, phase: 'complete', outcome: { chapterId: 'ch9-last-thaw', completedAt: 'x', fragments: [human] } });

    // The moment waits for it: its motif first, at the loading pace.
    expect(m.music.state().holds).toContain('reveal');
    expect(m.bakeReport().awaitedMotif).toBe('act3-bare@1');
    expect(m.bakePace()).toBe('loading');

    const played = (): boolean => m.traceRing.since().some((e) => e.kind === 'motif' && /^motif act3-bare@1 at/.test(e.note ?? ''));
    const t0 = main.now();
    const waitMs = motifWaitSec('reveal', MOMENT_TIMING.revealMotifAtSec) * 1000;
    let bakedAt = -1;
    let leftThen: SoundId[] = [];
    while (!played() && main.now() - t0 < waitMs + 1000) {
      frame();
      if (bakedAt < 0 && bank.motif(motif) !== null) {
        bakedAt = main.now() - t0;
        leftThen = set.sounds.filter((id) => !bank.ready(id));
      }
    }
    // Baked inside the wait, ahead of the rest of the set (the level's sounds, the epilogue).
    expect(bakedAt).toBeGreaterThan(0);
    expect(bakedAt).toBeLessThan(waitMs);
    expect(leftThen.length).toBeGreaterThan(set.sounds.length / 2);
    expect(bank.motif({ variant: 'epilogue', tempoScale: 1 })).toBeNull();
    expect(paced.stats().slices.loading).toBeGreaterThan(0);
    // It played, the music still held out for it.
    expect(played()).toBe(true);
    expect(m.music.state().holds).toContain('reveal');
    // Chapter 9: the epilogue comes next, so its motif is asked for now, first and at the same pace.
    expect(m.bakeReport().awaitedMotif).toBe('epilogue@1');
    expect(m.bakePace()).toBe('loading');
    const notes = m.traceRing.since().filter((e) => /^bake: .*wanted by a moment|^motif act3-bare/.test(e.note ?? '')).map((e) => e.note);
    expect(notes.slice(0, 2)).toEqual(['motif act3-bare@1: not baked', 'bake: motif act3-bare@1 wanted by a moment: baked first, at the loading pace']);
    expect(notes.at(-2)).toMatch(/^motif act3-bare@1 at \+/);
    expect(notes.at(-1)).toBe('bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace');
    // The run ends (the app leaves the screen): nothing is asked for, the pace is idle again.
    moments.dispose();
    expect(m.bakeReport().awaitedMotif).toBeNull();
    expect(m.bakePace()).toBe('idle');
  });

  it("edge case A (EPI's worst case): the epilogue's motif dropped from the set and asked for again as the epilogue starts is still baked first, and the epilogue asks for it itself", () => {
    const { main, m, frame, moments } = rig();
    const set = levelSoundSet('', 'ch9-last-thaw');
    const epilogue = { variant: 'epilogue', tempoScale: 1 } as const;
    m.prepare(set);
    frame();
    const bank = m.bank()!;
    // Chapter 9 completes (no human document: no Revelation motif); the epilogue's motif comes next.
    moments.update(ch9);
    moments.update({ ...ch9, phase: 'complete', outcome: { chapterId: 'ch9-last-thaw', completedAt: 'x', fragments: [] } });
    expect(m.bakeReport().awaitedMotif).toBe('epilogue@1');
    expect(m.bakeReport().bank.awaited).toBe('epilogue@1');
    // A new set without it and the set again (a prepare() that drops and re-adds it), and the epilogue
    // starts in the same task: nothing of it baked, everything else of the set still pending too.
    const mark = m.traceRing.lastSeq;
    m.prepare({ ...set, motifs: [REVELATION_MOTIF['ch9-last-thaw']] });
    m.prepare(set);
    moments.update({ ...ch9, phase: 'complete', outcome: { chapterId: 'ch9-last-thaw', completedAt: 'x', fragments: [] }, epilogue: {} });
    expect(bank.motif(epilogue)).toBeNull();
    expect(m.music.state().holds).toContain('epilogue');
    // The bank still has it first (bakeReport names what the bank really does), at the loading pace,
    // and the epilogue's own ask is on the trace.
    expect(m.bakeReport().bank.awaited).toBe('epilogue@1');
    expect(m.bakeReport().awaitedMotif).toBe('epilogue@1');
    expect(m.bakePace()).toBe('loading');
    expect(m.traceRing.since(mark).filter((e) => /^bake: /.test(e.note ?? '')).map((e) => e.note)).toEqual([
      'bake: motif epilogue@1 wanted by a moment: baked first, at the loading pace',
    ]);
    const played = (): boolean => m.traceRing.since(mark).some((e) => e.kind === 'motif' && /^motif epilogue@1 at/.test(e.note ?? ''));
    const t0 = main.now();
    // Dropped and asked for again once more while the epilogue waits (nobody asks again then): the
    // bank's own memory of the request keeps it first.
    for (let i = 0; i < 10; i++) frame();
    expect(bank.motif(epilogue)).toBeNull();
    const mark2 = m.traceRing.lastSeq;
    m.prepare({ ...set, motifs: [] });
    m.prepare(set);
    expect(m.traceRing.since(mark2).filter((e) => /^bake: .*wanted/.test(e.note ?? ''))).toEqual([]);
    expect(m.bakeReport().bank.awaited).toBe('epilogue@1');
    let leftThen = -1;
    while (!played() && main.now() - t0 < EPILOGUE_MOTIF_WAIT_SEC * 1000 + 1000) {
      frame();
      if (leftThen < 0 && bank.motif(epilogue) !== null) leftThen = set.sounds.filter((id) => !bank.ready(id)).length;
    }
    // Baked ahead of the level's sounds, and played inside the epilogue's wait.
    expect(leftThen).toBeGreaterThan(set.sounds.length / 2);
    expect(played()).toBe(true);
    expect(main.now() - t0).toBeLessThan(EPILOGUE_MOTIF_WAIT_SEC * 1000);
  });
});
