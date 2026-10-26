import { describe, expect, it, vi } from 'vitest';
import {
  BANK_BUDGET_BYTES,
  CARD_MOTIF,
  CHURCH_BELLS,
  EMITTER_FOR_KIND,
  EMITTER_LOOP,
  EPILOGUE_MOTIF,
  KIND_SOUNDS,
  REVELATION_MOTIF,
  SEED,
  SOUND_DEFS,
  type BellVoicingId,
  type LevelSoundSet,
  type MotifRequest,
  type SliceScheduler,
  type SoundBank,
  type SoundId,
} from '../contract';
import type { ObstacleKind as Kind } from '../../core/types';

type ObstacleKind = Kind;
import { LEVELS } from '../../core/levels';
import { CHAPTERS } from '../../story/chapters';
import { storyLevel } from '../../story/storyLevel';
import { createFakeContext, type FakeAudioBuffer } from '../voices/fakeContext.testkit';
import {
  BAKE_PACE,
  BELL_FORMS,
  CORE_SOUNDS,
  PREVIEW_BELL,
  bellBytes,
  bellStrikeBytes,
  coreBytes,
  createSoundBank,
  levelSetBytes,
  motifBytes,
  pacedScheduler,
  soundBytes,
  type BakePace,
  type PacerTimers,
} from './bank';
import { bakeBell } from './bell';
import { runMotifJob } from './motifJob';
import type { MotifRender, MotifRenderer } from './motifRenderer';
import { renderMotif } from './piano';
import { bakeSound } from './recipes';

const MiB = 1024 * 1024;

// -------------------------------------------------------------------------------------------------
// Level sets the way package C builds them (§9: kinds, overlay kinds, churches, motifs)
// -------------------------------------------------------------------------------------------------

function soundsForKinds(kinds: Iterable<Kind>, story: boolean): SoundId[] {
  const out = new Set<SoundId>();
  const all = new Set<Kind>(kinds);
  // Traffic lights are placed at signalised junctions at runtime; count them everywhere.
  all.add('trafficLight');
  for (const k of all) {
    const s = KIND_SOUNDS[k as ObstacleKind];
    out.add(s.hit);
    if (s.hitHeavy) out.add(s.hitHeavy);
    if (s.brk) out.add(s.brk);
    for (const l of s.brkLayers) out.add(l);
    if (s.paneAbove !== null) out.add('glass.pane');
    const em = EMITTER_FOR_KIND[k as ObstacleKind];
    if (em) out.add(EMITTER_LOOP[em]);
    if (k === 'stoneBarrier') out.add('stone.scatter');
    if (k === 'iceBlock' || k === 'iceField') out.add('ice.absorb');
  }
  if (story) out.add('debris.settle');
  return [...out];
}

function setsForGame(): { name: string; set: LevelSoundSet }[] {
  const sets: { name: string; set: LevelSoundSet }[] = [];
  for (const level of LEVELS) {
    const bells = CHURCH_BELLS.filter((b) => b.levelId === level.id).map((b) => b.voicing);
    sets.push({ name: `arcade ${level.id}`, set: { sounds: soundsForKinds(level.obstacles.map((o) => o.kind), false), bells, motifs: [] } });
  }
  for (const ch of CHAPTERS) {
    const level = storyLevel(ch);
    const bells = CHURCH_BELLS.filter((b) => b.levelId === ch.levelId).map((b) => b.voicing);
    const motifs: MotifRequest[] = [REVELATION_MOTIF[ch.id]];
    const card = CARD_MOTIF[ch.id];
    if (card && !motifs.some((m) => m.variant === card)) motifs.push({ variant: card, tempoScale: 1 });
    sets.push({ name: `story ${ch.id}`, set: { sounds: soundsForKinds(level.obstacles.map((o) => o.kind), true), bells, motifs } });
  }
  // The epilogue screen prepares its own set (a new set replaces the chapter's).
  sets.push({ name: 'epilogue', set: { sounds: [], bells: [], motifs: [{ variant: EPILOGUE_MOTIF, tempoScale: 1 }] } });
  return sets;
}

// -------------------------------------------------------------------------------------------------
// Schedulers and helpers
// -------------------------------------------------------------------------------------------------

/** A scheduler the test pumps by hand: one call of pump() runs one slice. */
function manualScheduler(): { schedule: SliceScheduler; pump(deadline: number): boolean; pending(): boolean } {
  let work: ((deadline: number) => boolean) | null = null;
  return {
    schedule: (w) => {
      work = w;
    },
    pump(deadline) {
      if (!work) return false;
      const more = work(deadline);
      if (!more) work = null;
      return more;
    },
    pending: () => work !== null,
  };
}

/** Runs every slice to the end (a generous deadline each time). */
function drain(s: ReturnType<typeof manualScheduler>, clock: { t: number }): number {
  let slices = 0;
  while (s.pending()) {
    s.pump(clock.t + 4);
    slices++;
  }
  return slices;
}

const ATTACHED = (bank: SoundBank): ReturnType<typeof createFakeContext> => {
  const fake = createFakeContext();
  bank.attach(fake.ctx as BaseAudioContext);
  return fake;
};

// -------------------------------------------------------------------------------------------------

describe('budgets (from SOUND_DEFS arithmetic)', () => {
  it('core ≤ 6 MiB; every level set ≤ 10 MiB of sounds, ≤ 3 MiB of bells, ≤ 4 MiB of motifs; the peak ≤ 22 MiB', () => {
    const core = coreBytes();
    expect(core).toBeLessThanOrEqual(BANK_BUDGET_BYTES.core);
    let peak = 0;
    const report: string[] = [];
    for (const { name, set } of setsForGame()) {
      const b = levelSetBytes(set);
      expect(b.sounds, name).toBeLessThanOrEqual(BANK_BUDGET_BYTES.level);
      expect(b.bells, name).toBeLessThanOrEqual(BANK_BUDGET_BYTES.bells);
      expect(b.motifs, name).toBeLessThanOrEqual(BANK_BUDGET_BYTES.motif);
      peak = Math.max(peak, core + b.total);
      report.push(`${name}: ${(b.sounds / MiB).toFixed(2)} + ${(b.bells / MiB).toFixed(2)} + ${(b.motifs / MiB).toFixed(2)} MiB`);
    }
    expect(peak).toBeLessThanOrEqual(BANK_BUDGET_BYTES.total);
    expect(report.length).toBe(9 + 9 + 1);
    // BANK_REPORT=1 prints the table (sounds + bells + motifs per set).
    if (process.env.BANK_REPORT) console.log(`core ${(core / MiB).toFixed(2)} MiB, peak ${(peak / MiB).toFixed(2)} MiB\n${report.join('\n')}`);
  });

  it('the arithmetic matches what a bank really holds after baking', () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
    const set: LevelSoundSet = { sounds: ['house.collapse', 'hit.masonry', 'glass.break'], bells: ['st-brides', 'loch-kirk'], motifs: [{ variant: 'act2', tempoScale: 1 }] };
    bank.request({ scope: 'level', set });
    bank.request({ scope: 'core' });
    drain(s, clock);
    expect(bank.stats().bytes).toBe(coreBytes() + levelSetBytes(set).total);
    // St Bride's strike is the core's (the Settings preview): the level adds its shiver and clank only.
    expect(levelSetBytes(set).total).toBe(
      soundBytes('house.collapse') + soundBytes('hit.masonry') + soundBytes('glass.break') + 2 * bellBytes() - bellStrikeBytes() + motifBytes({ variant: 'act2', tempoScale: 1 }),
    );
  });
});

describe('the bank', () => {
  it('is notReady before baking, ready after, and serves the baked buffers once attached', () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
    expect(bank.ready('hit.ice')).toBe(false);
    expect(bank.buffer('hit.ice', 0)).toBeNull();
    bank.request({ scope: 'core' });
    expect(bank.ready('hit.ice')).toBe(false);
    drain(s, clock);
    for (const id of CORE_SOUNDS) expect(bank.ready(id), id).toBe(true);
    // Baked but not attached: no AudioBuffer yet (still notReady for the engine).
    expect(bank.buffer('hit.ice', 0)).toBeNull();
    ATTACHED(bank);
    const buf = bank.buffer('hit.ice', 1) as unknown as FakeAudioBuffer;
    expect(buf).not.toBeNull();
    expect(buf.sampleRate).toBe(SOUND_DEFS['hit.ice'].sampleRate);
    const want = bakeSound('hit.ice', 1, SEED).data;
    expect(Buffer.from(buf.getChannelData(0).buffer).equals(Buffer.from(want.buffer))).toBe(true);
  });

  it('wraps each bake as soon as it finishes once attached', () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
    ATTACHED(bank);
    bank.request({ scope: 'level', set: { sounds: ['timber.break.light'], bells: [], motifs: [] } });
    drain(s, clock);
    expect(bank.buffer('timber.break.light', 2)).not.toBeNull();
  });

  it('respects the slice deadline: a slice overruns it by at most one step', () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    // Every look at the clock costs 1 ms of "work".
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1) });
    bank.request({ scope: 'level', set: { sounds: ['house.collapse'], bells: [], motifs: [] } });
    let slices = 0;
    while (s.pending()) {
      const start = clock.t;
      s.pump(start + 4);
      expect(clock.t - start).toBeLessThanOrEqual(5);
      slices++;
    }
    expect(slices).toBeGreaterThan(10);
    expect(bank.ready('house.collapse')).toBe(true);
  });

  it("bakes in priority order: the level's bell strikes and a card's motif, the level's collision sounds, the core (the preview strike first), the level's other sounds (structural first), the shiver and clank, then the other motifs", () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
    ATTACHED(bank);
    const motif: MotifRequest = { variant: 'act1', tempoScale: 1 };
    const card: MotifRequest = { variant: 'ch8', tempoScale: 1 };
    bank.request({ scope: 'level', set: { sounds: ['timber.break.light', 'house.collapse', 'hit.metal.panel', 'ice.absorb'], bells: ['pass-chapel'], motifs: [motif, card] } });
    bank.request({ scope: 'core' });
    const order: string[] = [];
    const seen = new Set<string>();
    const note = (k: string, done: boolean): void => {
      if (done && !seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
    };
    while (s.pending()) {
      s.pump(clock.t);
      note('preview', bank.bell(PREVIEW_BELL, 'strike') !== null);
      for (const id of [...CORE_SOUNDS, 'house.collapse', 'timber.break.light', 'hit.metal.panel', 'ice.absorb'] as SoundId[]) note(id, bank.ready(id));
      for (const f of BELL_FORMS) note(`bell:${f}`, bank.bell('pass-chapel', f) !== null);
      note('card', bank.motif(card) !== null);
      note('motif', bank.motif(motif) !== null);
    }
    const rank = (k: string): number =>
      k === 'bell:strike' || k === 'card'
        ? 0
        : k === 'hit.metal.panel' || k === 'ice.absorb'
          ? 0.5
          : k === 'preview'
          ? 1
          : CORE_SOUNDS.includes(k as SoundId)
            ? 2
            : k === 'house.collapse'
              ? 3
              : k === 'timber.break.light'
                ? 4
                : k.startsWith('bell')
                  ? 5
                  : 6;
    expect(order[0]).toBe('bell:strike');
    for (let i = 1; i < order.length; i++) expect(rank(order[i]), `${order[i - 1]} -> ${order[i]}`).toBeGreaterThanOrEqual(rank(order[i - 1]));
    expect(order[order.length - 1]).toBe('motif');
  });

  it('prioritize: the motif a moment waits for bakes next, ahead of everything pending (a bake in progress set aside); null puts it back', () => {
    const motif: MotifRequest = { variant: 'act3-bare', tempoScale: 1 };
    const set: LevelSoundSet = { sounds: ['ice.absorb', 'house.collapse'], bells: ['pass-chapel'], motifs: [motif] };
    const s = manualScheduler();
    const clock = { t: 0 };
    // Every look at the clock is 1 ms of work: a slice is a few recipe steps.
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1) });
    ATTACHED(bank);
    bank.request({ scope: 'level', set });
    bank.request({ scope: 'core' });
    s.pump(clock.t + 1); // the first step of the chapel's strike, first of the set
    expect(bank.bell('pass-chapel', 'strike')).toBeNull();
    bank.prioritize({ variant: 'act1', tempoScale: 1 }); // not in the set: nothing to move
    bank.prioritize(motif);
    while (bank.motif(motif) === null) s.pump(clock.t + 4);
    // The strike in progress was set aside: the motif came first, everything else still waits.
    expect(bank.bell('pass-chapel', 'strike')).toBeNull();
    for (const id of ['ice.absorb', 'house.collapse', ...CORE_SOUNDS] as SoundId[]) expect(bank.ready(id), id).toBe(false);
    expect(bank.bell(PREVIEW_BELL, 'strike')).toBeNull();
    bank.prioritize(motif); // already baked: nothing to do
    // The strike resumes where it stopped, sample for sample what an uninterrupted bake gives.
    while (bank.bell('pass-chapel', 'strike') === null) s.pump(clock.t + 4);
    const strike = (bank.bell('pass-chapel', 'strike') as unknown as FakeAudioBuffer).getChannelData(0);
    expect(Buffer.from(strike.buffer).equals(Buffer.from(bakeBell('pass-chapel', 'strike', SEED).data.buffer))).toBe(true);
    // null puts a waiting motif back in its place (the motifs bake last).
    const s2 = manualScheduler();
    const back = createSoundBank(s2.schedule, SEED, { now: () => (clock.t += 1) });
    ATTACHED(back);
    back.request({ scope: 'level', set });
    back.prioritize(motif);
    back.prioritize(null);
    while (!back.ready('ice.absorb')) s2.pump(clock.t + 4);
    expect(back.motif(motif)).toBeNull();
    // A level change that drops the waiting motif: it is not baked (the request stands, for the
    // entry asked for again: the next test).
    back.prioritize(motif);
    back.request({ scope: 'level', set: { ...set, motifs: [] } });
    while (s2.pending()) s2.pump(clock.t + 4);
    expect(back.motif(motif)).toBeNull();
    expect(back.ready('house.collapse')).toBe(true);
  });

  it('edge case A: the awaited motif dropped from the set and asked for again keeps its priority (the request stands by key)', () => {
    const motif: MotifRequest = { variant: 'act3-bare', tempoScale: 1 };
    const set: LevelSoundSet = { sounds: ['ice.absorb', 'house.collapse'], bells: ['pass-chapel'], motifs: [motif] };
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1) });
    ATTACHED(bank);
    bank.request({ scope: 'level', set });
    bank.prioritize(motif);
    expect(bank.stats().awaited).toBe('act3-bare@1');
    // A new set without it, then the set again (EPI's worst case; a prepare() that drops and re-adds it).
    bank.request({ scope: 'level', set: { ...set, motifs: [] } });
    expect(bank.stats().awaited).toBeNull();
    bank.request({ scope: 'level', set });
    expect(bank.stats().awaited).toBe('act3-bare@1');
    while (bank.motif(motif) === null) s.pump(clock.t + 4);
    // The new entry came first: nothing else of the set is baked yet.
    expect(bank.bell('pass-chapel', 'strike')).toBeNull();
    for (const id of ['ice.absorb', 'house.collapse'] as SoundId[]) expect(bank.ready(id), id).toBe(false);
    expect(bank.stats().awaited).toBeNull();
    // Let go: the request is gone, so the next time it is asked for again it waits its turn.
    bank.prioritize(null);
    bank.request({ scope: 'level', set: { ...set, motifs: [] } });
    bank.request({ scope: 'level', set });
    expect(bank.stats().awaited).toBeNull();
  });

  it("edge case B: prioritize(null) sets a part-baked motif aside again: the queue's own order resumes before the rest of it, sample for sample the same", () => {
    const motif: MotifRequest = { variant: 'epilogue', tempoScale: 1 };
    const set: LevelSoundSet = { sounds: ['ice.absorb', 'house.collapse'], bells: ['pass-chapel'], motifs: [motif] };
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1) });
    ATTACHED(bank);
    bank.request({ scope: 'level', set });
    // Asked for (a Revelation on chapter 9), part-baked, then let go (Replay chapter).
    bank.prioritize(motif);
    for (let i = 0; i < 20; i++) s.pump(clock.t + 4);
    expect(bank.motif(motif)).toBeNull();
    expect(bank.bell('pass-chapel', 'strike')).toBeNull();
    bank.prioritize(null);
    // The level's sounds and bells first, in the queue's order; the motif after them.
    let slices = 0;
    while (!(bank.ready('ice.absorb') && bank.ready('house.collapse') && bank.bell('pass-chapel', 'clank') !== null)) {
      s.pump(clock.t + 4);
      slices++;
      expect(bank.motif(motif), `slice ${slices}`).toBeNull();
    }
    drain(s, clock);
    const data = (bank.motif(motif) as unknown as FakeAudioBuffer).getChannelData(0);
    expect(Buffer.from(data.buffer).equals(Buffer.from(renderMotif(motif, SEED).data.buffer))).toBe(true);
  });

  it("keeps St Bride's strike with the core: baked first of the core, never evicted by a level change", () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
    ATTACHED(bank);
    // The level set asks for St Bride's before the core does: the core still keeps the strike.
    bank.request({ scope: 'level', set: { sounds: [], bells: ['st-brides'], motifs: [] } });
    bank.request({ scope: 'core' });
    while (bank.bell(PREVIEW_BELL, 'strike') === null) s.pump(clock.t);
    expect(CORE_SOUNDS.some((id) => bank.ready(id))).toBe(false);
    drain(s, clock);
    bank.request({ scope: 'level', set: { sounds: ['dam.break'], bells: [], motifs: [] } });
    expect(bank.bell(PREVIEW_BELL, 'strike')).not.toBeNull();
    expect(bank.bell(PREVIEW_BELL, 'shiver')).toBeNull();
    bank.releaseLevel();
    expect(bank.bell(PREVIEW_BELL, 'strike')).not.toBeNull();
    expect(bank.stats().bytes).toBe(coreBytes());
  });

  it('has a stable checksum: two banks agree whatever order they were asked in', () => {
    const run = (first: 'core' | 'level'): string => {
      const s = manualScheduler();
      const clock = { t: 0 };
      const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
      const level = { scope: 'level' as const, set: { sounds: ['hit.metal.panel', 'glass.pane'] as SoundId[], bells: ['loch-kirk' as BellVoicingId], motifs: [] } };
      if (first === 'core') {
        bank.request({ scope: 'core' });
        bank.request(level);
      } else {
        bank.request(level);
        bank.request({ scope: 'core' });
      }
      drain(s, clock);
      return bank.stats().checksum;
    };
    const a = run('core');
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(run('level')).toBe(a);
  });

  it("R9's node checksum: the core plus S13's set bakes to 74a0ca9e (the browser's S13 compares against it)", () => {
    // scripts/audio-e2e.mjs S13 builds the same set in Chrome with a synchronous scheduler and checks
    // its checksum equals this one (NODE_BANK_CHECKSUM there). Changing a recipe changes both.
    const bank = createSoundBank((w) => {
      while (w(Infinity)) {
        // run every slice at once
      }
    }, 42);
    bank.request({ scope: 'core' });
    bank.request({ scope: 'level', set: { sounds: ['house.collapse', 'dam.break', 'glass.break'], bells: ['clachan-kirk'], motifs: [] } });
    expect(bank.stats().checksum).toBe('74a0ca9e');
  });

  it('replaces one level set with the next (core stays) and frees it on releaseLevel', () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t });
    ATTACHED(bank);
    bank.request({ scope: 'core' });
    bank.request({ scope: 'level', set: { sounds: ['house.collapse', 'hit.masonry'], bells: ['st-brides'], motifs: [] } });
    drain(s, clock);
    const coreOnly = coreBytes();
    expect(bank.stats().bytes).toBe(coreOnly + soundBytes('house.collapse') + soundBytes('hit.masonry') + bellBytes() - bellStrikeBytes());
    bank.request({ scope: 'level', set: { sounds: ['hit.masonry', 'dam.break'], bells: [], motifs: [] } });
    // The overlap stays baked; the rest of the old set is gone at once (St Bride's strike is the core's).
    expect(bank.ready('hit.masonry')).toBe(true);
    expect(bank.ready('house.collapse')).toBe(false);
    expect(bank.bell('st-brides', 'shiver')).toBeNull();
    expect(bank.bell('st-brides', 'strike')).not.toBeNull();
    drain(s, clock);
    expect(bank.ready('dam.break')).toBe(true);
    bank.releaseLevel();
    expect(bank.stats().bytes).toBe(coreOnly);
    expect(bank.ready('dam.break')).toBe(false);
    for (const id of CORE_SOUNDS) expect(bank.ready(id), id).toBe(true);
  });

  it('never bakes a cut sound, and a bake that fails is reported once and left out', () => {
    const s = manualScheduler();
    const clock = { t: 0 };
    const warn = vi.fn();
    const bank = createSoundBank(s.schedule, SEED, { now: () => clock.t, warn });
    const broken = { variant: 'no-such-variant', tempoScale: 1 } as unknown as MotifRequest;
    bank.request({ scope: 'level', set: { sounds: ['piano.strings', 'glass.pane'], bells: [], motifs: [broken] } });
    expect(() => drain(s, clock)).not.toThrow();
    expect(bank.ready('piano.strings')).toBe(false);
    expect(bank.ready('glass.pane')).toBe(true);
    expect(bank.motif(broken)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(bank.stats().pending).toBe(0);
  });

  it('asks for a new slice only when it has work, and never two at once', () => {
    let calls = 0;
    let queued: ((d: number) => boolean) | null = null;
    const bank = createSoundBank(
      (w) => {
        calls++;
        queued = w;
      },
      SEED,
      { now: () => 0 },
    );
    bank.request({ scope: 'level', set: { sounds: [], bells: [], motifs: [] } });
    expect(calls).toBe(0);
    bank.request({ scope: 'level', set: { sounds: ['glass.pane'], bells: [], motifs: [] } });
    bank.request({ scope: 'level', set: { sounds: ['glass.pane', 'ice.absorb'], bells: [], motifs: [] } });
    expect(calls).toBe(1);
    while (queued && (queued as (d: number) => boolean)(1)) {
      /* run to the end */
    }
    bank.request({ scope: 'level', set: { sounds: ['glass.pane', 'ice.absorb'], bells: [], motifs: [] } });
    expect(calls).toBe(1);
  });
});

describe('motifs off the main thread (a MotifRenderer: the Web Worker in the browser)', () => {
  /** A renderer that answers when the test says (a worker's reply is a later task), with the worker's own job. */
  function laterRenderer() {
    const queue: { motif: MotifRequest; seed: number; done: (r: MotifRender | Error) => void }[] = [];
    const sent: string[] = [];
    const renderer: MotifRenderer = {
      render: (motif, seed, done) => {
        sent.push(`${motif.variant}@${motif.tempoScale}`);
        queue.push({ motif, seed, done });
      },
    };
    const answer = (): boolean => {
      const j = queue.shift();
      if (!j) return false;
      const r = runMotifJob({ id: 1, motif: j.motif, seed: j.seed });
      j.done(r.ok ? { sampleRate: r.sampleRate, data: r.data, hash: r.hash, ms: r.ms } : new Error(r.error));
      return true;
    };
    const fail = (message: string): void => queue.shift()?.done(new Error(message));
    return { renderer, sent, queue, answer, fail };
  }
  const ch9Motifs: MotifRequest[] = [REVELATION_MOTIF['ch9-last-thaw'], { variant: EPILOGUE_MOTIF, tempoScale: 1 }];
  const ch9Like: LevelSoundSet = { sounds: ['ice.absorb', 'glass.pane'], bells: ['pass-chapel'], motifs: ch9Motifs };

  it('sends the motifs as soon as the set is asked for, one at a time, the awaited first; the main thread never renders one; the same samples and checksum', () => {
    const w = laterRenderer();
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1), motifRenderer: w.renderer });
    ATTACHED(bank);
    bank.request({ scope: 'level', set: ch9Like });
    // The Revelation's motif went out at once (the bank's order), one job at a time.
    expect(w.sent).toEqual(['act3-bare@1']);
    bank.prioritize({ variant: EPILOGUE_MOTIF, tempoScale: 1 });
    expect(bank.stats().awaited).toBe('epilogue@1');
    // The main thread bakes everything else and never a motif.
    drain(s, clock);
    expect(bank.ready('ice.absorb') && bank.ready('glass.pane')).toBe(true);
    expect(bank.stats().pending).toBe(2);
    expect(bank.stats().offThread).toEqual({ renders: 0, ms: 0, failed: false, busy: true });
    // The reply comes in; the awaited motif is sent next.
    w.answer();
    expect(w.sent).toEqual(['act3-bare@1', 'epilogue@1']);
    w.answer();
    expect(bank.stats().pending).toBe(0);
    expect(bank.stats().offThread).toMatchObject({ renders: 2, failed: false, busy: false });
    for (const m of ch9Motifs) {
      const data = (bank.motif(m) as unknown as FakeAudioBuffer).getChannelData(0);
      expect(Buffer.from(data.buffer).equals(Buffer.from(renderMotif(m, SEED).data.buffer)), m.variant).toBe(true);
    }
    // A bank without a renderer bakes the same set to the same checksum.
    const s2 = manualScheduler();
    const here = createSoundBank(s2.schedule, SEED, { now: () => (clock.t += 1) });
    here.request({ scope: 'level', set: ch9Like });
    drain(s2, clock);
    expect(here.stats().offThread).toBeNull();
    expect(here.stats().checksum).toBe(bank.stats().checksum);
  });

  it("a chapter card's motif bakes on the main thread with the strikes, even while the worker has not answered; the long motifs are the worker's", () => {
    // On two cores the card's motif once took 3.1 s to come back from a worker still starting during a
    // page load, and the card (it plays at +1.2 s) missed it (docs/evidence/AUDIO_RUNS.md, "Slow computers").
    const w = laterRenderer();
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1), motifRenderer: w.renderer });
    ATTACHED(bank);
    const card: MotifRequest = { variant: CARD_MOTIF['ch8-remains']!, tempoScale: 1 };
    expect(REVELATION_MOTIF['ch8-remains']).toEqual(card);
    const long: MotifRequest = { variant: 'act3', tempoScale: 1 };
    const set: LevelSoundSet = { sounds: ['ice.absorb', 'house.collapse'], bells: ['pass-chapel'], motifs: [card, long] };
    bank.request({ scope: 'level', set });
    // Only the long motif goes out, although the card's is first in the bank's order.
    expect(w.sent).toEqual(['act3@1']);
    // The worker never answers here: the card's motif is baked by the main thread's slices alone, with
    // the strike, before the level's collision sounds.
    const order: string[] = [];
    while (s.pending()) {
      s.pump(clock.t + 4);
      for (const [k, done] of [['strike', bank.bell('pass-chapel', 'strike') !== null], ['card', bank.motif(card) !== null], ['ice.absorb', bank.ready('ice.absorb')]] as const) {
        if (done && !order.includes(k)) order.push(k);
      }
    }
    expect(order).toEqual(['strike', 'card', 'ice.absorb']);
    const data = (bank.motif(card) as unknown as FakeAudioBuffer).getChannelData(0);
    expect(Buffer.from(data.buffer).equals(Buffer.from(renderMotif(card, SEED).data.buffer))).toBe(true);
    expect(bank.motif(long)).toBeNull();
    expect(bank.stats()).toMatchObject({ pending: 1, offThread: { renders: 0, busy: true } });
    // Dropped, asked for again and awaited (the card is open): it bakes here again; nothing more goes out.
    bank.request({ scope: 'level', set: { ...set, motifs: [long] } });
    bank.request({ scope: 'level', set });
    bank.prioritize(card);
    expect(bank.stats().awaited).toBe('ch8@1');
    while (bank.motif(card) === null && s.pending()) s.pump(clock.t + 4);
    expect(bank.motif(card)).not.toBeNull();
    expect(w.sent).toEqual(['act3@1']);
    w.answer();
    drain(s, clock);
    expect(bank.stats()).toMatchObject({ pending: 0, offThread: { renders: 1, failed: false, busy: false } });
    // The same checksum as a bank without a renderer.
    const s2 = manualScheduler();
    const here = createSoundBank(s2.schedule, SEED, { now: () => (clock.t += 1) });
    here.request({ scope: 'level', set });
    drain(s2, clock);
    expect(here.stats().checksum).toBe(bank.stats().checksum);
  });

  it('a renderer that fails: the motif it had and the rest bake on the main thread from then on, the same samples', () => {
    const w = laterRenderer();
    const warn = vi.fn();
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1), motifRenderer: w.renderer, warn });
    ATTACHED(bank);
    bank.request({ scope: 'level', set: ch9Like });
    drain(s, clock);
    expect(bank.stats().pending).toBe(2);
    w.fail('worker script did not load');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/motif renderer failed \(worker script did not load\): motifs bake on the main thread/);
    expect(bank.stats().offThread).toMatchObject({ failed: true, busy: false });
    drain(s, clock);
    expect(w.sent).toEqual(['act3-bare@1']);
    expect(bank.stats().pending).toBe(0);
    for (const m of ch9Motifs) {
      const data = (bank.motif(m) as unknown as FakeAudioBuffer).getChannelData(0);
      expect(Buffer.from(data.buffer).equals(Buffer.from(renderMotif(m, SEED).data.buffer)), m.variant).toBe(true);
    }
  });

  it('a render that comes back for a dropped motif is dropped; for one dropped and asked for again it fills the new entry', () => {
    const w = laterRenderer();
    const s = manualScheduler();
    const clock = { t: 0 };
    const bank = createSoundBank(s.schedule, SEED, { now: () => (clock.t += 1), motifRenderer: w.renderer });
    ATTACHED(bank);
    const revelation = REVELATION_MOTIF['ch9-last-thaw'];
    bank.request({ scope: 'level', set: ch9Like });
    expect(w.sent).toEqual(['act3-bare@1']);
    // Dropped while it renders: the reply finds no entry, and the next motif goes out.
    bank.request({ scope: 'level', set: { ...ch9Like, motifs: [ch9Motifs[1]] } });
    w.answer();
    expect(bank.motif(revelation)).toBeNull();
    expect(w.sent).toEqual(['act3-bare@1', 'epilogue@1']);
    // Dropped and asked for again while it renders: the reply fills the new entry.
    bank.request({ scope: 'level', set: { ...ch9Like, motifs: [] } });
    bank.request({ scope: 'level', set: ch9Like });
    w.answer();
    expect(bank.motif(ch9Motifs[1])).not.toBeNull();
    expect(w.sent).toEqual(['act3-bare@1', 'epilogue@1', 'act3-bare@1']);
    w.answer();
    expect(bank.motif(revelation)).not.toBeNull();
    drain(s, clock);
    expect(bank.stats().pending).toBe(0);
    expect(w.queue).toHaveLength(0);
  });
});

describe("pacedScheduler (the browser's slices, paced by the screen)", () => {
  /** Timers the test drives: the queued timeout and idle callbacks, and a clock that work() advances. */
  function fakeTimers() {
    const clock = { t: 1000 };
    const timeouts: (() => void)[] = [];
    const idles: { fn: (d: { timeRemaining(): number; didTimeout?: boolean }) => void; timeout: number }[] = [];
    const timers: PacerTimers = {
      now: () => clock.t,
      setTimeout: (fn) => timeouts.push(fn),
      requestIdle: (fn, o) => idles.push({ fn, timeout: o.timeout }),
    };
    return { clock, timeouts, idles, timers };
  }

  it('gives each slice the deadline its pace allows, and counts the time per pace', () => {
    const f = fakeTimers();
    let pace: BakePace = 'idle';
    const sched = pacedScheduler(() => pace, f.timers);
    const deadlines: number[] = [];
    let left = 6;
    sched((deadline) => {
      deadlines.push(deadline - f.clock.t);
      f.clock.t += 3; // each slice costs 3 ms
      return --left > 0;
    });
    // idle: idle time only, up to 12 ms of what the browser reports
    expect(f.idles).toHaveLength(1);
    expect(f.idles[0].timeout).toBe(BAKE_PACE.idleTimeoutMs);
    f.idles.shift()!.fn({ timeRemaining: () => 40 });
    expect(deadlines.at(-1)).toBe(BAKE_PACE.idleSliceMs);
    f.idles.shift()!.fn({ timeRemaining: () => 5 });
    expect(deadlines.at(-1)).toBe(5);
    // loading: a timer slice of 14 ms, no idle callback
    pace = 'loading';
    f.idles.shift()!.fn({ timeRemaining: () => 0 }); // queued before the overlay came up: runs as loading
    expect(deadlines.at(-1)).toBe(BAKE_PACE.loadingSliceMs);
    expect(f.timeouts).toHaveLength(1);
    f.timeouts.shift()!();
    expect(deadlines.at(-1)).toBe(BAKE_PACE.loadingSliceMs);
    // play: at most 4 ms (a timer slice queued behind the overlay runs at the pace of its moment)
    pace = 'play';
    f.timeouts.shift()!();
    expect(deadlines.at(-1)).toBe(BAKE_PACE.playSliceMs);
    expect(f.idles[0].timeout).toBe(BAKE_PACE.playTimeoutMs);
    f.idles.shift()!.fn({ timeRemaining: () => 30 });
    expect(deadlines.at(-1)).toBe(BAKE_PACE.playSliceMs);
    expect(left).toBe(0);
    expect(f.idles).toHaveLength(0);
    expect(f.timeouts).toHaveLength(0);
    const st = sched.stats();
    expect(st.slices).toEqual({ idle: 2, loading: 2, play: 2 });
    expect(st.ms.loading).toBe(6);
    expect(st.maxMs.play).toBe(3);
  });

  it('in play, a slice that only came on its timeout still gets playMinMs (progress in a busy game)', () => {
    const f = fakeTimers();
    const sched = pacedScheduler(() => 'play', f.timers);
    const deadlines: number[] = [];
    sched((deadline) => {
      deadlines.push(deadline - f.clock.t);
      return false;
    });
    f.idles.shift()!.fn({ timeRemaining: () => 0, didTimeout: true });
    expect(deadlines).toEqual([BAKE_PACE.playMinMs]);
    expect(f.idles).toHaveLength(0);
  });

  it('without requestIdleCallback every pace runs on timer slices of its own size', () => {
    const f = fakeTimers();
    const timers: PacerTimers = { ...f.timers, requestIdle: null };
    let pace: BakePace = 'play';
    const sched = pacedScheduler(() => pace, timers);
    const deadlines: number[] = [];
    let n = 3;
    sched((deadline) => {
      deadlines.push(deadline - f.clock.t);
      return --n > 0;
    });
    f.timeouts.shift()!();
    pace = 'idle';
    f.timeouts.shift()!();
    pace = 'loading';
    f.timeouts.shift()!();
    expect(deadlines).toEqual([BAKE_PACE.playSliceMs, BAKE_PACE.idleSliceMs, BAKE_PACE.loadingSliceMs]);
  });

  it('drives the real bank to the end, one slice queued at a time', () => {
    const f = fakeTimers();
    const sched = pacedScheduler(() => 'loading', f.timers);
    const bank = createSoundBank(sched, SEED, { now: () => f.clock.t });
    bank.request({ scope: 'level', set: { sounds: ['glass.pane'], bells: ['pass-chapel'], motifs: [] } });
    let slices = 0;
    while (f.timeouts.length > 0) {
      expect(f.timeouts).toHaveLength(1);
      f.timeouts.shift()!();
      f.clock.t += 20;
      slices++;
    }
    expect(slices).toBeGreaterThan(0);
    expect(bank.stats().pending).toBe(0);
    expect(bank.ready('glass.pane')).toBe(true);
  });
});
