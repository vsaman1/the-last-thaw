import { describe, expect, it } from 'vitest';
import {
  BANK_BUDGET_BYTES,
  CARD_MOTIF,
  EPILOGUE_MOTIF,
  FELT_PIANO,
  MOTIF_SCORES,
  MOTIF_TUNING,
  REVELATION_MOTIF,
  SEED,
  type MotifRequest,
} from '../contract';
import { autocorrelation, cents, envelope, onsets, peakDb, rmsDb, spectralCentroid, spectralPeaks, yinPitch } from '../analysis';
import { Biquad } from './dsp';
import { motifTimeline, pianoNoteHz, renderMotif, renderNote, unisonBeatHz } from './piano';

const FS = FELT_PIANO.sampleRate;
const NOTES = [...new Set(Object.values(MOTIF_SCORES).flatMap((s) => s.notes.map((n) => n.midi)))].sort((a, b) => a - b);
const UNTUNED = Object.keys(MOTIF_TUNING.untunedKeys).map(Number);

/** Every motif the game asks for: the revelations (ch3 at 0.94), the ch8 card, the epilogue. */
const REQUESTS: MotifRequest[] = (() => {
  const all = [
    ...Object.values(REVELATION_MOTIF),
    ...Object.values(CARD_MOTIF).map((variant) => ({ variant: variant!, tempoScale: 1 })),
    { variant: EPILOGUE_MOTIF, tempoScale: 1 },
  ];
  const seen = new Set<string>();
  return all.filter((m) => {
    const k = `${m.variant}@${m.tempoScale}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
})();

/** Beat rate of a rendered note from its fundamental's envelope (autocorrelation peak). */
function measuredBeatHz(midi: number): number {
  const x = renderNote(midi, 0.3, 6, 6);
  const f = pianoNoteHz(midi);
  new Biquad(FS).set('bandpass', f, 40).process(x);
  new Biquad(FS).set('bandpass', f, 40).process(x);
  const env = envelope(x, FS, 0.01);
  // Divide out the decay so the beat stands alone.
  const smooth = env.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - 60); k < Math.min(env.length, i + 60); k++) {
      s += env[k];
      n++;
    }
    return s / n;
  });
  const flat = env.map((v, i) => v / (smooth[i] || 1)).subarray(20, 500);
  const ac = autocorrelation(flat, 150);
  let best = 20;
  for (let lag = 20; lag <= 150; lag++) if (ac[lag] > ac[best]) best = lag;
  return 1 / (best * 0.01);
}

describe('the felt piano', () => {
  it('plays every motif note within 2 cents of the 10-cent-flat tuning (YIN)', () => {
    for (const midi of NOTES) {
      const x = renderNote(midi, 0.35, 1.5, 1.6);
      const window = midi < 50 ? 4096 : 2048;
      const f = yinPitch(x, FS, { start: Math.round(0.12 * FS), window, minHz: 40, maxHz: 1500 });
      const want = 440 * Math.pow(2, (midi - 69) / 12) * Math.pow(2, -10 / 1200);
      expect(Math.abs(cents(f, want)), `MIDI ${midi}`).toBeLessThan(2);
    }
  });

  it('the untuned D5 wavers at 2.7 ± 0.3 Hz, D4 at about half that; every other unison beats under 0.7 Hz', () => {
    expect(Math.abs(measuredBeatHz(74) - 2.7)).toBeLessThan(0.3);
    expect(Math.abs(measuredBeatHz(62) - 1.35)).toBeLessThan(0.25);
    expect(Math.abs(unisonBeatHz(74) - 2.7)).toBeLessThan(0.05);
    for (const midi of NOTES.filter((m) => !UNTUNED.includes(m))) {
      expect(unisonBeatHz(midi), `MIDI ${midi}`).toBeLessThan(0.7);
      expect(unisonBeatHz(midi), `MIDI ${midi}`).toBeGreaterThan(0);
    }
  });

  it('is darker when played softly: centroid at v 0.3 below v 0.6', () => {
    for (const midi of [65, 69, 74]) {
      const soft = renderNote(midi, 0.3, 1, 1.2);
      const firm = renderNote(midi, 0.6, 1, 1.2);
      expect(spectralCentroid(soft, FS, 0, Math.round(0.5 * FS)), `MIDI ${midi}`).toBeLessThan(
        spectralCentroid(firm, FS, 0, Math.round(0.5 * FS)),
      );
    }
  });

  it('a released note dies away: 40 dB down within 1.5 s of the damper', () => {
    const x = renderNote(65, 0.4, 0.5, 3);
    const at = (s: number): number => rmsDb(x, Math.round(s * FS), Math.round((s + 0.1) * FS));
    expect(at(2.0) - at(0.1)).toBeLessThan(-40);
  });
});

describe('renderMotif', () => {
  const renders = new Map(REQUESTS.map((m) => [`${m.variant}@${m.tempoScale}`, renderMotif(m, SEED)]));

  it('peaks at -14 ± 0.5 dBFS, has the timeline length, a silent start and a silent end', () => {
    for (const m of REQUESTS) {
      const { data, sampleRate } = renders.get(`${m.variant}@${m.tempoScale}`)!;
      expect(sampleRate).toBe(FS);
      expect(Math.abs(peakDb(data) - FELT_PIANO.peakDb), m.variant).toBeLessThan(0.5);
      expect(data.length, m.variant).toBe(Math.round(motifTimeline(m).totalSec * FS));
      expect(Math.abs(data[0])).toBeLessThan(1e-3);
      expect(rmsDb(data, data.length - Math.round(0.02 * FS))).toBeLessThan(-70);
    }
  });

  it('puts every onset within 5 ms of the score, tempo, ritardando and ch3 slowing included', () => {
    for (const m of REQUESTS) {
      const { data } = renders.get(`${m.variant}@${m.tempoScale}`)!;
      const want = motifTimeline(m).uniqueOnsets;
      const found = onsets(data, FS, { floorDb: 60, riseDb: 4 });
      for (const t of want) {
        const near = found.reduce((best, f) => (Math.abs(f - t) < Math.abs(best - t) ? f : best), Infinity);
        expect(Math.abs(near - t) * 1000, `${m.variant}@${m.tempoScale} onset ${t.toFixed(3)}`).toBeLessThan(5);
      }
      for (const f of found) {
        const near = want.reduce((best, t) => (Math.abs(f - t) < Math.abs(best - f) ? t : best), Infinity);
        expect(Math.abs(near - f) * 1000, `${m.variant} extra onset at ${f.toFixed(3)}`).toBeLessThan(5);
      }
    }
  });

  it('is deterministic, and slower at ch3 rather than resampled', () => {
    const a = renderMotif({ variant: 'act1', tempoScale: 1 }, SEED).data;
    expect(Buffer.from(a.buffer).equals(Buffer.from(renders.get('act1@1')!.data.buffer))).toBe(true);
    const slow = renders.get('act1@0.94')!.data;
    expect(slow.length).toBeGreaterThan(a.length);
    // The same pitch at the slower tempo (a resampled copy would sit 107 cents flat): the opening F4
    // is F4 in both.
    const f4 = (x: Float32Array): number =>
      spectralPeaks(x, FS, { minHz: 320, maxHz: 380, end: Math.round(0.8 * FS), floorDb: 20, window: 'decay' })[0].hz;
    expect(Math.abs(cents(f4(slow), f4(a)))).toBeLessThan(5);
    expect(Math.abs(cents(f4(a), pianoNoteHz(65)))).toBeLessThan(10);
  });

  it('fits the motif budget, the longest (the epilogue) included', () => {
    for (const m of REQUESTS) {
      expect(renders.get(`${m.variant}@${m.tempoScale}`)!.data.byteLength, m.variant).toBeLessThanOrEqual(BANK_BUDGET_BYTES.motif);
    }
  });
});
