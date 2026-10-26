/**
 * The live voices (docs/AUDIO_DESIGN.md §7, §10 ambience) on a recording fake context: they start
 * silent, issue no param ops for unchanged inputs and one setTargetAtTime for a single change, stop
 * and disconnect cleanly, follow their inputs, and land on §2.3's levels. Levels are measured by
 * rendering the very graph the voices build (renderGraph, a node model of the browser).
 */
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_MIX,
  SEED,
  type AmbienceVoices,
  type EmitterSlotInputs,
  type FallSlotInputs,
  type FloodInputs,
  type OceanInputs,
  type ScrapeInputs,
  type SoundBank,
  type SoundId,
  type WaterInputs,
  type WindInputs,
} from '../contract';
import { autocorrelation, envelope, rmsOf } from '../analysis';
import { Biquad, NOISE_RMS } from '../synth/dsp';
import { bakeSound } from '../synth/recipes';
import { createAmbienceVoices } from './ambience';
import { createFakeContext, renderGraph, type FakeContext, type FakeNode } from './fakeContext.testkit';
import { CONTROL_RATE, CONTROL_SECONDS, NOISE_RATES, NOISE_SECONDS, createNoiseBank, noiseBankData, noiseBankSteps } from './noiseBank';

const FS = 48000;

/** A bank stub holding just the baked loops the voices read. */
function loopBank(fake: FakeContext): SoundBank {
  const cache = new Map<SoundId, AudioBuffer>();
  const ctx = fake.ctx as BaseAudioContext;
  const get = (id: SoundId): AudioBuffer => {
    let b = cache.get(id);
    if (!b) {
      const pcm = bakeSound(id, 0, SEED);
      b = ctx.createBuffer(1, pcm.data.length, pcm.sampleRate);
      b.copyToChannel(pcm.data as Float32Array<ArrayBuffer>, 0);
      cache.set(id, b);
    }
    return b;
  };
  return {
    attach: () => {},
    request: () => {},
    releaseLevel: () => {},
    ready: () => true,
    buffer: (id) => (id === 'scrape.grit' || id.startsWith('emitter.') ? get(id) : null),
    bell: () => null,
    motif: () => null,
    prioritize: () => {},
    stats: () => ({ ready: 0, pending: 0, bytes: 0, checksum: '0' }),
  };
}

interface Rig {
  fake: FakeContext;
  voices: AmbienceVoices;
  ambience: FakeNode;
  effects: FakeNode;
}

function rig(): Rig {
  const fake = createFakeContext(FS);
  const ctx = fake.ctx as BaseAudioContext;
  const ambience = ctx.createGain() as unknown as FakeNode;
  const effects = ctx.createGain() as unknown as FakeNode;
  const space = ctx.createGain();
  const noise = createNoiseBank(ctx, SEED);
  const voices = createAmbienceVoices(ctx, { ambience: ambience as unknown as AudioNode, effects: effects as unknown as AudioNode, space }, noise, loopBank(fake), SEED);
  return { fake, voices, ambience, effects };
}

/** RMS (dBFS) over both channels of a render of `node` from t0. */
function levelDb(node: FakeNode, t0: number, seconds = 2, fs = FS): number {
  const { left, right } = renderGraph(node, t0, seconds, fs);
  let s = 0;
  for (let i = 0; i < left.length; i++) s += left[i] * left[i] + right[i] * right[i];
  return 10 * Math.log10(s / (2 * left.length) + 1e-24);
}

const wind = (amount: number, airSpeed = 0): WindInputs => ({ amount, airSpeed });
const scrape = (speed: number, o: Partial<ScrapeInputs> = {}): ScrapeInputs => ({
  onLand: true,
  airborne: false,
  wading: false,
  speed,
  massT: 30,
  radius: 4,
  ground: 'rock',
  ...o,
});
const water = (level: number, o: Partial<WaterInputs> = {}): WaterInputs => ({ level, flowSpeed: 6, turbulence: 0.5, pan: 0, afloat: false, ...o });
const fall = (o: Partial<FallSlotInputs> = {}): FallSlotInputs => ({ active: true, strength: 1, distGain: 1, airLowpassHz: 16000, pan: 0, near: 0.625, ...o });
const ocean = (o: Partial<OceanInputs> = {}): OceanInputs => ({ proximity: 1, atSea: false, pan: 0, bob: 0, ...o });
const flood = (o: Partial<FloodInputs> = {}): FloodInputs => ({ rush: 1, distGain: 1, airLowpassHz: 16000, pan: 0, ...o });
const emitter = (o: Partial<EmitterSlotInputs> = {}): EmitterSlotInputs => ({ kind: 'factory', running: true, distGain: 1, airLowpassHz: 16000, pan: 0, ...o });

describe('lifecycle', () => {
  it('every voice starts silent', () => {
    const r = rig();
    r.fake.advance(1);
    expect(levelDb(r.ambience, 1, 0.5)).toBeLessThan(-120);
    expect(levelDb(r.effects, 1, 0.5)).toBeLessThan(-120);
  });

  it('an unchanged input issues no param ops; a single change over 1 % issues exactly one setTargetAtTime', () => {
    const r = rig();
    const v = r.voices;
    const inputs = {
      w: wind(0.4),
      s: scrape(10),
      wa: water(0.6),
      f: fall(),
      o: ocean(),
      fl: flood(),
      e: emitter(),
    };
    const all = (): void => {
      v.wind.update(inputs.w);
      v.scrape.update(inputs.s);
      v.water.update(inputs.wa);
      v.falls[0].update(inputs.f);
      v.ocean.update(inputs.o);
      v.flood.update(inputs.fl);
      v.emitters[0].update(inputs.e);
    };
    all();
    const mark = r.fake.ops.length;
    all();
    expect(r.fake.since(mark)).toEqual([]);
    // One input that drives one param.
    inputs.wa.pan = 0.3;
    let m = r.fake.ops.length;
    v.water.update(inputs.wa);
    const ops = r.fake.since(m).filter((o) => o.op === 'param');
    expect(ops.length).toBe(1);
    expect(ops[0]).toMatchObject({ method: 'setTargetAtTime', param: 'pan' });
    // A change under 1 % issues nothing.
    inputs.w.amount = 0.4;
    v.wind.update(inputs.w);
    m = r.fake.ops.length;
    inputs.w.amount = 0.4004;
    v.wind.update(inputs.w);
    expect(r.fake.since(m)).toEqual([]);
    inputs.w.amount = 0.45;
    v.wind.update(inputs.w);
    expect(r.fake.since(m).filter((o) => o.op === 'param' && o.method === 'setTargetAtTime').length).toBe(1);
  });

  it('stop() fades, stops and disconnects every source; it is idempotent and later updates do nothing', () => {
    const r = rig();
    const v = r.voices;
    v.wind.update(wind(0.6));
    v.scrape.update(scrape(12));
    v.water.update(water(1));
    v.falls[1].update(fall());
    v.ocean.update(ocean());
    v.flood.update(flood());
    v.emitters[2].update(emitter({ kind: 'pumpjack' }));
    r.fake.advance(3);
    expect(r.fake.liveSources()).toBeGreaterThan(20);
    expect(levelDb(r.ambience, 3, 0.5)).toBeGreaterThan(-40);
    v.stop(0.12);
    // The fade: 60 dB down within 0.25 s, then silence once the sources have stopped.
    expect(levelDb(r.ambience, 3 + 0.25, 0.1)).toBeLessThan(levelDb(r.ambience, 3, 0.1) - 40);
    const mark = r.fake.ops.length;
    v.stop(0.12);
    v.wind.update(wind(0.9));
    v.water.update(water(0.2));
    v.ocean.surge();
    expect(r.fake.since(mark)).toEqual([]);
    r.fake.advance(0.3);
    expect(r.fake.liveSources()).toBe(0);
    const created = r.fake.ops.filter((o) => o.op === 'create' && o.node === 'AudioBufferSource').map((o) => (o as { id: number }).id);
    const stopped = new Set(r.fake.ops.filter((o) => o.op === 'stop').map((o) => (o as { id: number }).id));
    const disconnected = new Set(r.fake.ops.filter((o) => o.op === 'disconnect').map((o) => (o as { from: number }).from));
    for (const id of created) {
      expect(stopped.has(id), `source ${id} stopped`).toBe(true);
      expect(disconnected.has(id), `source ${id} disconnected`).toBe(true);
    }
  });

  it('builds the flood voice on its first non-zero update, not before', () => {
    const r = rig();
    const before = r.fake.ops.filter((o) => o.op === 'create').length;
    r.voices.flood.update(flood({ rush: 0 }));
    expect(r.fake.ops.filter((o) => o.op === 'create').length).toBe(before);
    r.voices.flood.update(flood({ rush: 0.2 }));
    expect(r.fake.ops.filter((o) => o.op === 'create').length).toBeGreaterThan(before);
  });
});

describe('the scrape', () => {
  const at = (inputs: ScrapeInputs): number => {
    const r = rig();
    r.voices.scrape.update(inputs);
    r.fake.advance(2);
    r.voices.scrape.update(inputs);
    return levelDb(r.effects, 2, 1);
  };

  it('rises with speed and is silent when airborne or afloat', () => {
    const levels = [2, 6, 12, 22].map((v) => at(scrape(v)));
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    expect(at(scrape(0.5))).toBeLessThan(-100);
    expect(at(scrape(15, { airborne: true }))).toBeLessThan(-100);
    expect(at(scrape(15, { onLand: false }))).toBeLessThan(-100);
  });

  it('at 22 m/s on rock with a 30 t iceberg sits at about -25 dBFS RMS (≤ -22)', () => {
    const db = at(scrape(22));
    expect(db).toBeLessThanOrEqual(-22);
    expect(Math.abs(db + 25)).toBeLessThan(1);
  });

  it('cuts fast on a launch: 30 dB down within 0.15 s of going airborne', () => {
    const r = rig();
    r.voices.scrape.update(scrape(15));
    r.fake.advance(2);
    const flying = scrape(15, { airborne: true });
    r.voices.scrape.update(flying);
    expect(levelDb(r.effects, 2.15, 0.05)).toBeLessThan(levelDb(r.effects, 1.9, 0.05) - 30);
  });
});

describe('levels (§2.3)', () => {
  it('wind: -44 + 10·amount dBFS RMS over 30 s of gusts (± 1.5 dB), louder when airborne', () => {
    for (const amount of [0.4, 0.9]) {
      const r = rig();
      r.voices.wind.update(wind(amount));
      r.fake.advance(3);
      r.voices.wind.update(wind(amount));
      expect(Math.abs(levelDb(r.ambience, 3, 30, 16000) - (-44 + 10 * amount)), `amount ${amount}`).toBeLessThan(1.5);
    }
    const r = rig();
    r.voices.wind.update(wind(0.6, 30));
    r.fake.advance(3);
    expect(levelDb(r.ambience, 3, 30, 16000)).toBeGreaterThan(-44 + 6 + 4);
  });

  it('river: level 1 at -24 and level 0.25 at -36 dBFS RMS (± 1 dB)', () => {
    for (const [lvl, want] of [
      [1, -24],
      [0.25, -36],
    ] as const) {
      const r = rig();
        r.voices.water.update(water(lvl));
      r.fake.advance(3);
      expect(Math.abs(levelDb(r.ambience, 3, 3) - want), `level ${lvl}`).toBeLessThan(1);
    }
  });

  it('a waterfall at 20 m sits at about -22 dBFS RMS (± 1 dB) and fades out when its slot is reassigned', () => {
    const r = rig();
    r.voices.falls[0].update(fall());
    r.fake.advance(3);
    expect(Math.abs(levelDb(r.ambience, 3, 2) + 22)).toBeLessThan(1);
    r.voices.falls[0].update(fall({ active: false }));
    expect(levelDb(r.ambience, 3 + 2, 0.5)).toBeLessThan(levelDb(r.ambience, 2.5, 0.5) - 30);
  });

  it('the flood near the breach sits at about -18 dBFS RMS (± 1 dB)', () => {
    const r = rig();
    r.voices.flood.update(flood());
    r.fake.advance(3);
    expect(Math.abs(levelDb(r.ambience, 3, 2) + 18)).toBeLessThan(1);
  });

  it('the sea peaks at about -22 dBFS RMS at a wave and rests about 10 dB lower between waves', () => {
    const r = rig();
    r.voices.ocean.update(ocean());
    // Run the wave scheduler for 30 s, then find the loudest and quietest second.
    for (let t = 0; t < 30; t += 0.1) {
      r.fake.advance(0.1);
      r.voices.ocean.update(ocean());
    }
    const { left, right } = renderGraph(r.ambience, 5, 24, 16000);
    const sec = 16000;
    const per: number[] = [];
    for (let s = 0; s + sec <= left.length; s += sec / 4) {
      let e = 0;
      for (let i = s; i < s + sec; i++) e += left[i] * left[i] + right[i] * right[i];
      per.push(10 * Math.log10(e / (2 * sec)));
    }
    const peak = Math.max(...per);
    const floor = Math.min(...per);
    expect(Math.abs(peak + 22)).toBeLessThan(1.5);
    expect(peak - floor).toBeGreaterThan(7);
  });

  it('the Act III timbre darkens the water: its top band 4 dB lower', () => {
    const top = (db: number): number => {
      const r = rig();
        r.voices.setTimbre({ wind: CHAPTER_MIX['ch7-escape'].wind, waterTopDb: db });
      r.voices.water.update(water(1, { turbulence: 1 }));
      r.fake.advance(3);
      const { left } = renderGraph(r.ambience, 3, 2);
      // The top band (3.4 kHz) alone: a narrow band-pass, run twice.
      const hp = new Biquad(FS).set('bandpass', 3400, 4);
      const hp2 = new Biquad(FS).set('bandpass', 3400, 4);
      let e = 0;
      for (let i = 0; i < left.length; i++) {
        const y = hp2.tick(hp.tick(left[i]));
        e += y * y;
      }
      return 10 * Math.log10(e);
    };
    expect(Math.abs(top(0) - top(-4) - 4)).toBeLessThan(1);
  });
});

describe('no audible loop (R8)', () => {
  /** The highest local peak of the 50 ms RMS envelope's autocorrelation at lags of 1-30 s. */
  const worstPeak = (node: FakeNode, t0: number): number => {
    const { left } = renderGraph(node, t0, 40, 8000);
    const ac = autocorrelation(envelope(left, 8000, 0.05), 601);
    let worst = 0;
    for (let lag = 20; lag <= 600; lag++) if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1]) worst = Math.max(worst, ac[lag]);
    return worst;
  };
  const cases: [string, (v: AmbienceVoices) => void, boolean][] = [
    ['wind', (v) => v.wind.update(wind(0.6)), false],
    ['scrape at a steady 12 m/s', (v) => v.scrape.update(scrape(12)), true],
    ['river', (v) => v.water.update(water(0.8)), false],
    ['waterfall', (v) => v.falls[0].update(fall()), false],
    ['flood', (v) => v.flood.update(flood({ rush: 0.8 })), false],
  ];
  for (const [name, drive, fx] of cases) {
    it(`${name}: 40 s with no envelope repetition (no autocorrelation peak above 0.5)`, () => {
      const r = rig();
      drive(r.voices);
      r.fake.advance(3);
      drive(r.voices);
      expect(worstPeak(fx ? r.effects : r.ambience, 3)).toBeLessThan(0.5);
    });
  }
});

describe('machines (P1)', () => {
  it('a running machine plays its loop; when it stops standing it runs down and never restarts', () => {
    const r = rig();
    const slot = r.voices.emitters[0];
    slot.update(emitter({ kind: 'turbine' }));
    r.fake.advance(2);
    const running = levelDb(r.ambience, 2, 1);
    expect(running).toBeGreaterThan(-50);
    slot.update(emitter({ kind: 'turbine', running: false }));
    r.fake.advance(5);
    slot.update(emitter({ kind: 'turbine', running: true }));
    expect(levelDb(r.ambience, 7, 1)).toBeLessThan(-100);
    const src = r.fake.ops.filter((o) => o.op === 'stop');
    expect(src.length).toBe(1);
  });
});

describe('the noise bank', () => {
  const d = noiseBankData(SEED);

  it('holds seamless noise loops at their rates, each at the noise RMS', () => {
    for (const [name, x, rate] of [
      ['white', d.white, NOISE_RATES.white],
      ['pink', d.pink, NOISE_RATES.pink],
      ['brown', d.brown, NOISE_RATES.brown],
    ] as const) {
      expect(x.length, name).toBe(NOISE_SECONDS * rate);
      expect(rmsOf(x), name).toBeCloseTo(NOISE_RMS, 4);
      let sq = 0;
      for (let i = 1; i < x.length; i++) sq += (x[i] - x[i - 1]) ** 2;
      expect(Math.abs(x[0] - x[x.length - 1]), name).toBeLessThan(4 * Math.sqrt(sq / (x.length - 1)));
    }
  });

  it('holds smooth 0..1 control walks of 30 s that join up at the seam', () => {
    expect(d.control.length).toBe(4);
    for (const c of d.control) {
      expect(c.length).toBe(CONTROL_SECONDS * CONTROL_RATE);
      let lo = Infinity;
      let hi = -Infinity;
      let maxStep = 0;
      for (let i = 0; i < c.length; i++) {
        lo = Math.min(lo, c[i]);
        hi = Math.max(hi, c[i]);
        if (i > 0) maxStep = Math.max(maxStep, Math.abs(c[i] - c[i - 1]));
      }
      expect(lo).toBeCloseTo(0, 6);
      expect(hi).toBeCloseTo(1, 6);
      expect(Math.abs(c[0] - c[c.length - 1])).toBeLessThanOrEqual(maxStep * 1.5);
    }
  });

  it('is deterministic per seed', () => {
    const again = noiseBankData(SEED);
    expect(Buffer.from(again.pink.buffer).equals(Buffer.from(d.pink.buffer))).toBe(true);
    expect(Buffer.from(noiseBankData(SEED + 1).pink.buffer).equals(Buffer.from(d.pink.buffer))).toBe(false);
  });

  it('made ahead in idle steps (before any context) or all at once, the samples are the same', () => {
    const seed = SEED + 11;
    const steps = noiseBankSteps(seed);
    expect(steps.length).toBe(6);
    for (const step of steps) step();
    const ahead = noiseBankData(seed);
    // The context wraps the prepared parts and lets go of them; made again from nothing, they match.
    const fake = createFakeContext(FS);
    const wrapped = createNoiseBank(fake.ctx as unknown as BaseAudioContext, seed);
    expect(wrapped.pink.length).toBe(ahead.pink.length);
    const fresh = noiseBankData(seed);
    expect(fresh.pink).not.toBe(ahead.pink);
    for (const k of ['white', 'pink', 'brown'] as const) expect(Buffer.from(fresh[k].buffer).equals(Buffer.from(ahead[k].buffer)), k).toBe(true);
    for (let i = 0; i < 4; i++) expect(Buffer.from(fresh.control[i].buffer).equals(Buffer.from(ahead.control[i].buffer)), `control ${i}`).toBe(true);
  });
});
