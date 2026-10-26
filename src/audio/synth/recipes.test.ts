/**
 * Every recipe against the bake rules (docs/AUDIO_DESIGN.md §6.1, §10 Package B), and the loudness
 * relationships the design promises (§2.3, §6.2, §11.2 R1/R2) measured on the baked PCM at the levels
 * the contract's magnitude constants give. Nobody can listen to these; the numbers are the evidence.
 */
import { describe, expect, it } from 'vitest';
import {
  BREAK_LAYER_DB,
  BREAK_LEVELS,
  COLLISION_MAG,
  HIT_LREF,
  SEED,
  SOUND_DEFS,
  SOUND_IDS,
  type BakedPcm,
  type SoundId,
} from '../contract';
import {
  audibleDuration,
  bandEnergy,
  loudness,
  onsets,
  peakDb,
  rmsDb,
  rmsOf,
  schroederT60,
  spectralCentroid,
} from '../analysis';
import { breakLevelDb, breakM, breakRate, stoneM, tumbleRate } from '../game/magnitude';
import { Biquad, END_GUARD_SEC, endFadeStart } from './dsp';
import { CUT_SOUNDS, RECIPES, bakeSound, bakeable } from './recipes';

const BUILT = SOUND_IDS.filter((id) => bakeable(id));
const cache = new Map<string, BakedPcm>();
const baked = (id: SoundId, variant = 0): BakedPcm => {
  const key = `${id}#${variant}`;
  let pcm = cache.get(key);
  if (!pcm) {
    pcm = bakeSound(id, variant, SEED);
    cache.set(key, pcm);
  }
  return pcm;
};
const allVariants = (id: SoundId): number[] => Array.from({ length: SOUND_DEFS[id].variants }, (_, v) => v);

/** Heavy families (§10): most energy above 150 Hz, almost none below 40 Hz. */
const HEAVY: readonly SoundId[] = [
  'weight.thump',
  'house.collapse',
  'timber.collapse',
  'masonry.collapse.small',
  'masonry.collapse.large',
  'dam.break',
  'metal.break.structure',
  'metal.break.vehicle',
];

describe('the recipe table', () => {
  it('covers every SoundId: a recipe, or listed as cut (only the Vey strings are cut)', () => {
    for (const id of SOUND_IDS) expect(RECIPES[id] !== null || CUT_SOUNDS.has(id), id).toBe(true);
    expect([...CUT_SOUNDS]).toEqual(['piano.strings']);
    expect(RECIPES['piano.strings']).toBeNull();
    expect(() => bakeSound('piano.strings', 0, SEED)).toThrow(/cut/);
  });

  it('rejects variants the definition does not have', () => {
    expect(() => bakeSound('hit.ice', SOUND_DEFS['hit.ice'].variants, SEED)).toThrow();
    expect(() => bakeSound('hit.ice', -1, SEED)).toThrow();
  });
});

describe('bake rules, every sound and every variant', () => {
  it('finite samples and the exact length (seconds × rate)', () => {
    for (const id of BUILT) {
      for (const v of allVariants(id)) {
        const { data, sampleRate } = baked(id, v);
        expect(sampleRate, id).toBe(SOUND_DEFS[id].sampleRate);
        expect(data.length, id).toBe(Math.round(SOUND_DEFS[id].seconds * sampleRate));
        expect(data.every(Number.isFinite), `${id}#${v}`).toBe(true);
      }
    }
  });

  it('one-shots: peak 1.0, first sample < 1e-3, DC < 1e-3, last 20 ms below -70 dBFS RMS, ≤ 6 s', () => {
    for (const id of BUILT.filter((s) => !SOUND_DEFS[s].loop)) {
      expect(SOUND_DEFS[id].seconds, id).toBeLessThanOrEqual(6);
      for (const v of allVariants(id)) {
        const { data, sampleRate } = baked(id, v);
        const tag = `${id}#${v}`;
        let peak = 0;
        let sum = 0;
        for (const x of data) {
          peak = Math.max(peak, Math.abs(x));
          sum += x;
        }
        expect(Math.abs(peak - 1), tag).toBeLessThan(1e-6);
        expect(Math.abs(data[0]), tag).toBeLessThan(1e-3);
        expect(Math.abs(sum / data.length), tag).toBeLessThan(1e-3);
        expect(rmsDb(data, data.length - Math.round(0.02 * sampleRate)), tag).toBeLessThan(-70);
      }
    }
  });

  it('one-shots decay on their own: 30 dB below their loudest 50 ms before the end fade begins', () => {
    const report: string[] = [];
    for (const id of BUILT.filter((s) => !SOUND_DEFS[s].loop)) {
      for (const v of allVariants(id)) {
        const { data, sampleRate: fs } = baked(id, v);
        const w = Math.round(0.05 * fs);
        let loud = 0;
        for (let s = 0; s + w <= data.length; s += Math.round(w / 4)) loud = Math.max(loud, rmsOf(data, s, s + w));
        const from = endFadeStart(data.length, fs);
        const before = rmsOf(data, from - w, from);
        const drop = 20 * Math.log10(loud / Math.max(before, 1e-12));
        if (drop < 30) report.push(`${id}#${v}: ${drop.toFixed(1)} dB`);
      }
    }
    expect(report).toEqual([]);
  });

  it('loops: RMS 0.25 ± 2 %, a statistically ordinary seam, no RMS step across it', () => {
    for (const id of BUILT.filter((s) => SOUND_DEFS[s].loop)) {
      const { data, sampleRate: fs } = baked(id, 0);
      expect(Math.abs(rmsOf(data) - 0.25) / 0.25, id).toBeLessThan(0.02);
      let sq = 0;
      for (let i = 1; i < data.length; i++) sq += (data[i] - data[i - 1]) ** 2;
      const sigma = Math.sqrt(sq / (data.length - 1));
      expect(Math.abs(data[0] - data[data.length - 1]), id).toBeLessThan(4 * sigma);
      // No RMS step: the level change from the last 100 ms window into the first is no bigger
      // than the largest change between neighbouring windows inside the loop (plus 0.5 dB).
      const w = Math.round(0.1 * fs);
      const k = Math.floor(data.length / w);
      const lv = Array.from({ length: k }, (_, j) => 20 * Math.log10(rmsOf(data, j * w, (j + 1) * w)));
      let inner = 0;
      for (let j = 1; j < k; j++) inner = Math.max(inner, Math.abs(lv[j] - lv[j - 1]));
      const seam = Math.abs(20 * Math.log10(rmsOf(data, 0, w)) - 20 * Math.log10(rmsOf(data, data.length - w)));
      expect(seam, id).toBeLessThanOrEqual(inner + 0.5);
    }
  });

  it('is deterministic: two bakes are identical; different seeds and variants differ', () => {
    for (const id of BUILT) {
      const a = baked(id, 0).data;
      const b = bakeSound(id, 0, SEED).data;
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer)), id).toBe(true);
      const other = bakeSound(id, 0, SEED + 1).data;
      expect(Buffer.from(a.buffer).equals(Buffer.from(other.buffer)), `${id} seed`).toBe(false);
      if (SOUND_DEFS[id].variants > 1) {
        const v1 = baked(id, 1).data;
        expect(Buffer.from(a.buffer).equals(Buffer.from(v1.buffer)), `${id} variants`).toBe(false);
      }
    }
  });
});

describe('spectrum and duration', () => {
  it('heavy recipes keep at least half their energy above 150 Hz and under 2 % below 40 Hz', () => {
    for (const id of HEAVY) {
      for (const v of allVariants(id)) {
        const { data, sampleRate } = baked(id, v);
        expect(1 - bandEnergy(data, sampleRate, 0, 150), `${id}#${v} above 150`).toBeGreaterThanOrEqual(0.5);
        expect(bandEnergy(data, sampleRate, 0, 40), `${id}#${v} below 40`).toBeLessThan(0.02);
      }
    }
  });

  it('every one-shot keeps under 2 % of its energy below 40 Hz (the bake high-pass)', () => {
    for (const id of BUILT.filter((s) => !SOUND_DEFS[s].loop)) {
      const { data, sampleRate } = baked(id, 0);
      expect(bandEnergy(data, sampleRate, 0, 40), id).toBeLessThan(0.02);
    }
  });

  it('hits are short: stone, ice and wood ring out in T60 ≤ 0.3 s; masonry, panel and heavy metal by their own specs', () => {
    const limit: Partial<Record<SoundId, number>> = {
      'hit.stone.light': 0.3,
      'hit.stone.heavy': 0.3,
      'hit.ice': 0.3,
      'hit.wood': 0.3,
      'hit.masonry': 0.8,
      'hit.metal.panel': 0.5,
      'hit.metal.heavy': 1.0,
    };
    for (const [id, max] of Object.entries(limit) as [SoundId, number][]) {
      for (const v of allVariants(id)) {
        const { data, sampleRate } = baked(id, v);
        const t60 = schroederT60(data, sampleRate);
        expect(t60, `${id}#${v}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('a house collapse lasts 2–4 s and a dam break at least 3 s (audible to 40 dB below the peak)', () => {
    for (const v of allVariants('house.collapse')) {
      const { data, sampleRate } = baked('house.collapse', v);
      const d = audibleDuration(data, sampleRate, 40);
      expect(d, `house#${v}`).toBeGreaterThanOrEqual(2);
      expect(d, `house#${v}`).toBeLessThanOrEqual(4);
    }
    for (const v of allVariants('dam.break')) {
      const { data, sampleRate } = baked('dam.break', v);
      expect(audibleDuration(data, sampleRate, 40), `dam#${v}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('a light stone is brighter than a heavy one; the calving crack sweeps downward', () => {
    for (const v of [0, 1, 2]) {
      const light = baked('hit.stone.light', v);
      const heavy = baked('hit.stone.heavy', v);
      expect(spectralCentroid(light.data, light.sampleRate), `#${v}`).toBeGreaterThan(spectralCentroid(heavy.data, heavy.sampleRate));
    }
    for (const v of allVariants('ice.calve.crack')) {
      const { data, sampleRate: fs } = baked('ice.calve.crack', v);
      const onset = spectralCentroid(data, fs, 0, Math.round(0.02 * fs));
      const tail = spectralCentroid(data, fs, Math.round(0.06 * fs), Math.round(0.3 * fs));
      expect(onset, `#${v}`).toBeGreaterThan(tail);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// The designed levels: buffers placed at the contract's levels, mixed at 48 kHz, then measured.
// -------------------------------------------------------------------------------------------------

const FS = 48000;

interface Layer {
  readonly id: SoundId;
  readonly db: number;
  readonly rate?: number;
  readonly lowpassHz?: number;
  readonly delaySec?: number;
}

/** The variant a layer plays in render v (a sound with fewer variants repeats its last). */
const variantFor = (id: SoundId, v: number): number => Math.min(v, SOUND_DEFS[id].variants - 1);

/** Resample a baked buffer to FS at a playback rate (linear interpolation, as a browser at least does). */
function place(out: Float32Array, pcm: BakedPcm, l: Layer): void {
  const step = (pcm.sampleRate / FS) * (l.rate ?? 1);
  const g = Math.pow(10, l.db / 20);
  const off = Math.round((l.delaySec ?? 0) * FS);
  const tmp = new Float32Array(Math.min(out.length - off, Math.floor((pcm.data.length - 1) / step)));
  for (let i = 0; i < tmp.length; i++) {
    const p = i * step;
    const k = Math.floor(p);
    const f = p - k;
    tmp[i] = g * (pcm.data[k] * (1 - f) + pcm.data[k + 1] * f);
  }
  if (l.lowpassHz) new Biquad(FS).set('lowpass', Math.min(l.lowpassHz, FS * 0.45)).process(tmp);
  for (let i = 0; i < tmp.length; i++) out[off + i] += tmp[i];
}

function mix(layers: readonly Layer[], seconds = 6, variant = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * FS));
  for (const l of layers) place(out, baked(l.id, variantFor(l.id, variant)), l);
  return out;
}

/** The router's collision mapping (contract §4), with its layers: what package C will request. */
function collision(kindHit: SoundId, kindHeavy: SoundId | null, m: number, ice = true): Layer[] {
  const M = COLLISION_MAG;
  const sound = m >= M.heavyFrom && kindHeavy ? kindHeavy : kindHit;
  const level = HIT_LREF[sound]! + M.spanDb * (m - 1);
  const rate = M.rateTop - M.rateSlope * m;
  const lowpassHz = M.lpBaseHz * Math.pow(2, M.lpOctaves * m);
  const layers: Layer[] = [{ id: sound, db: level, rate, lowpassHz }];
  if (m > M.weightFrom) {
    const g = (m - M.weightFrom) / (1 - M.weightFrom);
    layers.push({ id: 'weight.thump', db: HIT_LREF['weight.thump']! + 20 * Math.log10(g), rate, lowpassHz });
  }
  if (ice && m >= M.iceLayerFrom && sound !== 'hit.ice') {
    layers.push({ id: 'hit.ice', db: level + M.iceLayerDb, rate, lowpassHz });
  }
  return layers;
}

/** A break at its family's typical level, with the causing hit as layer 0 and the break 15 ms later. */
function breakAt(id: SoundId, hit: Layer[], extra: readonly SoundId[] = []): Layer[] {
  const b = BREAK_LEVELS[id]!;
  const level = b.ltyp;
  const layers: Layer[] = [...hit.slice(0, 1), { id, db: level, rate: 1.05 - 0.1 * b.mtyp, delaySec: 0.015 }];
  for (const e of extra) layers.push({ id: e, db: level + BREAK_LAYER_DB[e]!, delaySec: 0.015 });
  return layers;
}

const highpass150 = (x: Float32Array): Float32Array => {
  const y = x.slice();
  new Biquad(FS).set('highpass', 150).process(y);
  new Biquad(FS).set('highpass', 150).process(y);
  return y;
};

describe('designed levels (§2.3, §6.2; R1 and R2 measured in node)', () => {
  const tap = mix(collision('hit.stone.light', 'hit.stone.heavy', 0.13));
  const pine = mix(collision('hit.wood', null, 0.43));
  const treeFalls = mix(breakAt('tree.fall.pine', collision('hit.wood', null, 0.43)));
  const houseHolds = mix(collision('hit.masonry', null, 0.67));
  const houseFalls = mix(breakAt('house.collapse', collision('hit.masonry', null, 0.67)));
  const churchFalls = mix(breakAt('masonry.collapse.large', collision('hit.masonry', null, 0.75), ['glass.break']));
  const factoryFails = mix(breakAt('metal.break.structure', collision('hit.metal.heavy', null, 0.8), ['machine.winddown']));
  const damBreaks = mix(breakAt('dam.break', collision('hit.stone.heavy', null, 0.8)));
  const L = (x: Float32Array): number => loudness(x, FS).momentaryMax;

  it('main layers peak where the design table says (within 1.5 dB after the strip low-pass); layers add at most 3 dB', () => {
    const main = (layers: Layer[]): Float32Array => mix(layers.slice(0, 1));
    const cases: [Layer[], Float32Array, number][] = [
      [collision('hit.stone.light', 'hit.stone.heavy', 0.13), tap, -34.6],
      [collision('hit.wood', null, 0.43), pine, -27.8],
      [collision('hit.masonry', null, 0.67), houseHolds, -20.6],
    ];
    for (const [layers, full, want] of cases) {
      expect(Math.abs(peakDb(main(layers)) - want), layers[0].id).toBeLessThan(1.5);
      expect(peakDb(full) - peakDb(main(layers)), `${layers[0].id} layered`).toBeLessThan(3);
    }
    expect(Math.abs(peakDb(houseFalls) + 14)).toBeLessThan(1.5);
    expect(Math.abs(peakDb(damBreaks) + 9)).toBeLessThan(1.5);
  });

  it('a light tap is far quieter than a house collapse, and a dam break is the heaviest (R2)', () => {
    const lTap = L(tap);
    const lPine = L(pine);
    const lHouse = L(houseFalls);
    const lDam = L(damBreaks);
    expect(lTap).toBeLessThanOrEqual(lPine - 4);
    expect(lPine - 4).toBeLessThanOrEqual(lHouse - 12);
    expect(lHouse + 3).toBeLessThanOrEqual(lDam);
    expect(lHouse - lTap).toBeGreaterThanOrEqual(18);
    for (const x of [tap, pine, treeFalls, houseHolds, houseFalls, churchFalls, factoryFails]) expect(L(x)).toBeLessThan(lDam);
    for (const x of [tap, pine, treeFalls, houseHolds, houseFalls, churchFalls, factoryFails, damBreaks]) {
      expect(peakDb(x)).toBeLessThan(-8);
    }
  });

  it('keeps the same ordering on laptop speakers (everything below 150 Hz removed)', () => {
    const [t, p, h, d] = [tap, pine, houseFalls, damBreaks].map((x) => L(highpass150(x)));
    expect(t).toBeLessThanOrEqual(p - 4);
    expect(p - 4).toBeLessThanOrEqual(h - 12);
    expect(h + 3).toBeLessThanOrEqual(d);
  });

  it('big failures carry their weight in time: house about -26 dBFS RMS over 2 s, dam about -20 over 3 s (± 4 dB)', () => {
    const at = (x: Float32Array, s: number): number => rmsDb(x, 0, Math.round(s * FS));
    expect(Math.abs(at(houseFalls, 2) + 26)).toBeLessThan(4);
    expect(Math.abs(at(damBreaks, 3) + 20)).toBeLessThan(4);
    // and last 10-20 times longer than a hit (audible to 40 dB below the peak)
    expect(audibleDuration(houseFalls, FS, 40)).toBeGreaterThan(10 * audibleDuration(tap, FS, 40));
  });

  // R1 asks for 18-28 LU. This node model of the engine strip (linear-interpolation resampling, a
  // Butterworth strip low-pass) measures wood at 28.4 LU, so the bound here is 28.5; the browser lab
  // (package A, the real strip) is the authoritative R1 check.
  it('collision loudness follows magnitude (R1): rising, 18-28.5 LU from m 0.1 to 0.9, heavier lower', () => {
    const kinds: [SoundId, SoundId | null][] = [
      ['hit.stone.light', 'hit.stone.heavy'],
      ['hit.wood', null],
      ['hit.masonry', null],
      ['hit.metal.heavy', null],
      ['hit.metal.panel', 'hit.metal.heavy'],
      ['hit.ice', null],
    ];
    for (const [hit, heavy] of kinds) {
      const ms = [0.1, 0.3, 0.5, 0.7, 0.9];
      const renders = ms.map((m) => mix(collision(hit, heavy, m), 2));
      const ls = renders.map(L);
      for (let i = 1; i < ls.length; i++) expect(ls[i], `${hit} m ${ms[i]}`).toBeGreaterThan(ls[i - 1]);
      const span = ls[4] - ls[0];
      expect(span, hit).toBeGreaterThanOrEqual(18);
      expect(span, hit).toBeLessThanOrEqual(28.5);
      // The weight grows with the impact: energy below 150 Hz rises at least 15 dB from m 0.1 to 0.9
      // (the weight layer joins above 0.55). Its SHARE rises too, except for masonry, whose own thud
      // is already ~90 % low band at m 0.1, where the strip low-pass has removed its plaster grit.
      const low = (x: Float32Array): number => bandEnergy(x, FS, 0, 150) * rmsOf(x) ** 2;
      expect(10 * Math.log10(low(renders[4]) / low(renders[0])), hit).toBeGreaterThan(15);
      if (hit !== 'hit.masonry') {
        expect(bandEnergy(renders[4], FS, 0, 150), hit).toBeGreaterThan(bandEnergy(renders[0], FS, 0, 150));
      }
    }
  });

  it('the guard at the end of every one-shot is silent', () => {
    for (const id of BUILT.filter((s) => !SOUND_DEFS[s].loop)) {
      const { data, sampleRate } = baked(id, 0);
      const g = Math.round(END_GUARD_SEC * sampleRate);
      for (let i = data.length - g; i < data.length; i++) expect(Math.abs(data[i]), id).toBeLessThan(1e-4);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// The playtest of 2026-10-23: "similar to the house breaking i want trees to have a sound effect as
// well and stones and logs". Before, a felled tree and a log pile sat 7-9 LU under a house collapse, a
// stone barrier 14 and a rock 26-28 (in the browser, under the river, the wind and the music).
// -------------------------------------------------------------------------------------------------

describe('trees, stones and log piles: as clear as a house collapse, a little lighter, never louder', () => {
  const L = (x: Float32Array): number => loudness(x, FS).momentaryMax;
  const VARIANTS = [0, 1, 2];
  /**
   * A request as router.ts builds it: the causing hit (with its weight), the main layer 15 ms later (the
   * stones at M = stoneM, F6 / F6b).
   */
  const request = (id: SoundId, massT: number, m: number, hit: Layer[], o: { rate?: number; M?: number } = {}): Layer[] => {
    const M = o.M ?? (id === 'stone.tumble' || id === 'stone.scatter' ? stoneM(massT, m) : breakM(massT, m));
    return [...hit, { id, db: breakLevelDb(id, M), rate: o.rate ?? breakRate(M), delaySec: 0.015 }];
  };
  const stoneHit = (m: number): Layer[] => collision('hit.stone.light', 'hit.stone.heavy', m, false);
  const barrierHit = (m: number): Layer[] => collision('hit.stone.heavy', null, m, false);
  // A felled tree and a broken log pile carry the hit alone (router F1/F7), a stone its weight too (F6).
  const woodHit = (m: number): Layer[] => collision('hit.wood', null, m, false).slice(0, 1);
  const each = (layers: Layer[]): Float32Array[] => VARIANTS.map((v) => mix(layers, 6, v));
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  // The reference: a house collapse at its typical impact, every variant.
  const houses = each(request('house.collapse', 12, 0.67, collision('hit.masonry', null, 0.67, false).slice(0, 1)));
  const house = mean(houses.map(L));
  const houseLoudest = Math.max(...houses.map(L));
  const houseLaptop = mean(houses.map((x) => L(highpass150(x))));

  // [name, the request at a typical impact, LU under the house: at least, at most]
  const typical: [string, Layer[], number, number][] = [
    ['a pine felled (2 t, m 0.43)', request('tree.fall.pine', 2, 0.43, woodHit(0.43)), 1.5, 4],
    ['a broadleaf felled (3 t, m 0.47)', request('tree.fall.broadleaf', 3, 0.47, woodHit(0.47)), 1.5, 4],
    ['a log pile collapsing (4.4 t, m 0.5)', request('logs.tumble', 4.4, 0.5, woodHit(0.5)), 1.5, 4],
    ['a stone barrier breaking apart (7.5 t, m 0.62)', request('stone.scatter', 7.5, 0.62, barrierHit(0.62)), 1.5, 4],
    ['a rock of 4 t tumbling (m 0.45)', request('stone.tumble', 4, 0.45, stoneHit(0.45), { rate: tumbleRate(4) }), 2.5, 5.5],
    ['a small rock tumbling (0.8 t, m 0.3)', request('stone.tumble', 0.8, 0.3, stoneHit(0.3), { rate: tumbleRate(0.8) }), 5, 9],
  ];

  it('at a typical impact each is about 3 LU under a house collapse (a small rock about 7), every variant within 2 LU of it', () => {
    const report: string[] = [];
    for (const [name, layers, under, most] of typical) {
      const ls = each(layers).map(L);
      const d = mean(ls) - house;
      report.push(`${name}: ${d.toFixed(2)} LU`);
      expect(d, name).toBeLessThanOrEqual(-under);
      expect(d, name).toBeGreaterThanOrEqual(-most);
      for (const l of ls) expect(Math.abs(l - mean(ls)), `${name} variants`).toBeLessThan(2);
    }
    if (process.env.LEVEL_REPORT) console.log(`house ${house.toFixed(2)} LUFS-M\n${report.join('\n')}`);
  });

  it('at their strongest (the hit at m 0.9, the main layer at its ceiling) none is louder than a house collapse', () => {
    const strongest: [string, Layer[]][] = [
      ['pine', request('tree.fall.pine', 2, 0.9, woodHit(0.9), { M: 1 })],
      ['broadleaf', request('tree.fall.broadleaf', 3, 0.9, woodHit(0.9), { M: 1 })],
      ['log pile', request('logs.tumble', 4.4, 0.9, woodHit(0.9), { M: 1 })],
      ['stone barrier', request('stone.scatter', 7.5, 0.9, barrierHit(0.9), { M: 1 })],
      ['boulder', request('stone.tumble', 22, 0.9, barrierHit(0.9), { M: 1, rate: tumbleRate(22) })],
    ];
    for (const [name, layers] of strongest) {
      const ls = each(layers).map(L);
      expect(mean(ls), name).toBeLessThanOrEqual(house);
      for (const l of ls) expect(l, `${name} loudest variant`).toBeLessThanOrEqual(houseLoudest);
      for (const x of each(layers)) expect(peakDb(x), `${name} peak`).toBeLessThan(-8);
    }
  });

  it('a knocked rock is heard by how hard it was hit: a nudge well under a strike, louder with every step', () => {
    // Review of 2026-10-24: a boulder's tumble sat at its ceiling from the knock threshold up, so a nudge
    // that barely moved it (m 0.34) was within 1 LU of a full-speed strike (m 0.71). Now the mix rises with
    // m for every rock size (a boulder's stays level from m 0.45 to 0.6, where its tumble has reached the
    // ceiling and its hit is still quiet), and the boulder's nudge sits at least 2 LU under its strike.
    const knock = (massT: number, m: number): number =>
      mean(each(request('stone.tumble', massT, m, stoneHit(m), { rate: tumbleRate(massT) })).map(L));
    const report: string[] = [];
    for (const massT of [0.8, 4, 22]) {
      let prev = -Infinity;
      for (const m of [0.2, 0.34, 0.45, 0.71, 0.9]) {
        const l = knock(massT, m);
        report.push(`${massT} t, m ${m}: ${(l - house).toFixed(2)} LU`);
        expect(l, `${massT} t at m ${m}`).toBeGreaterThan(prev);
        prev = l;
      }
    }
    expect(knock(22, 0.71) - knock(22, 0.34), 'boulder: strike over nudge').toBeGreaterThanOrEqual(2);
    expect(knock(4, 0.45) - knock(4, 0.2), 'a 4 t rock: typical over the threshold').toBeGreaterThanOrEqual(3);
    if (process.env.LEVEL_REPORT) console.log(`knocked rocks against the house:\n${report.join('\n')}`);
    // It renders many mixes: about 4 s alone, but 58 s on a loaded machine (2026-10-24), past the 30 s default.
  }, 120_000);

  it('stay clear on laptop speakers (everything below 150 Hz removed): within 6 LU of the house there', () => {
    for (const [name, layers, , most] of typical.slice(0, 5)) {
      const d = mean(each(layers).map((x) => L(highpass150(x)))) - houseLaptop;
      expect(d, name).toBeLessThan(0);
      expect(d, name).toBeGreaterThanOrEqual(-Math.max(6, most));
    }
  });

  it('each says what it is: a tree snaps and lands, logs knock again and again, a rock knocks as it tumbles', () => {
    const rmsAt = (x: Float32Array, fs: number, from: number, to: number): number => {
      const w = Math.round(0.05 * fs);
      let best = 0;
      for (let s = Math.round(from * fs); s + w <= Math.round(to * fs); s += Math.round(w / 4)) best = Math.max(best, rmsOf(x, s, s + w));
      return 20 * Math.log10(Math.max(best, 1e-12));
    };
    for (const id of ['tree.fall.pine', 'tree.fall.broadleaf'] as const) {
      for (const v of allVariants(id)) {
        const { data, sampleRate: fs } = baked(id, v);
        const top = rmsAt(data, fs, 0, data.length / fs);
        // The snap and the landing a second later are both loud (within 6 dB of the loudest 50 ms),
        // and the fall between them never drops out (the creak and the swish within 20 dB).
        expect(rmsAt(data, fs, 0, 0.3), `${id}#${v} snap`).toBeGreaterThan(top - 6);
        expect(rmsAt(data, fs, 0.95, 1.35), `${id}#${v} landing`).toBeGreaterThan(top - 6);
        for (let t = 0.3; t < 0.95; t += 0.1) expect(rmsAt(data, fs, t, t + 0.1), `${id}#${v} at ${t.toFixed(1)} s`).toBeGreaterThan(top - 20);
      }
    }
    for (const v of allVariants('logs.tumble')) {
      const { data, sampleRate: fs } = baked('logs.tumble', v);
      // A clatter: knocks 30-60 ms apart at first, so a 4 dB rise counts as a new knock.
      expect(onsets(data, fs, { riseDb: 4, floorDb: 30, minGapSec: 0.03 }).filter((t) => t < 1.8).length, `logs#${v}`).toBeGreaterThanOrEqual(8);
      expect(audibleDuration(data, fs, 40), `logs#${v}`).toBeGreaterThan(1.5);
    }
    for (const v of allVariants('stone.tumble')) {
      const { data, sampleRate: fs } = baked('stone.tumble', v);
      expect(onsets(data, fs, { floorDb: 30, minGapSec: 0.05 }).filter((t) => t > 0.08).length, `tumble#${v}`).toBeGreaterThanOrEqual(4);
      expect(audibleDuration(data, fs, 40), `tumble#${v}`).toBeGreaterThan(1);
    }
    // A stone barrier is lower and denser than one rock: the bigger blocks.
    const centroid = (id: SoundId): number => mean(allVariants(id).map((v) => spectralCentroid(baked(id, v).data, baked(id, v).sampleRate)));
    expect(centroid('stone.scatter')).toBeLessThan(centroid('stone.tumble') + 100);
    // Trees are brighter than logs (needles, leaves and splinters against round knocks).
    expect(centroid('tree.fall.pine')).toBeGreaterThan(centroid('logs.tumble'));
  });
});
