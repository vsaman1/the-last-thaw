/**
 * The score rules of "No. 14" (docs/AUDIO_DESIGN.md §8.4), on the data in the contract, and the
 * lengths the timeline gives them.
 */
import { describe, expect, it } from 'vitest';
import { CARD_MOTIF, EPILOGUE_MOTIF, MOTIF_SCORES, REVELATION_MOTIF, type MotifVariantId } from '../contract';
import { beatTime, motifTimeline } from './piano';

const VARIANTS = Object.keys(MOTIF_SCORES) as MotifVariantId[];
/** F G A B♭ C D E as pitch classes. */
const SCALE = new Set([5, 7, 9, 10, 0, 2, 4]);
const melody = (v: MotifVariantId) => MOTIF_SCORES[v].notes.filter((n) => n.hand === 'R').sort((a, b) => a.beat - b.beat);

describe('score rules', () => {
  it('is in 3/4 and fills whole bars', () => {
    for (const v of VARIANTS) {
      const s = MOTIF_SCORES[v];
      expect(s.beatsPerBar, v).toBe(3);
      expect(s.totalBeats % 3, v).toBe(0);
    }
  });

  it('bars add up: the melody never overlaps itself and ends within the score; left-hand chords sit on bar lines', () => {
    for (const v of VARIANTS) {
      const s = MOTIF_SCORES[v];
      const r = melody(v);
      for (let i = 1; i < r.length; i++) expect(r[i - 1].beat + r[i - 1].beats, `${v} #${i}`).toBeLessThanOrEqual(r[i].beat);
      const last = r[r.length - 1];
      expect(last.beat + last.beats, v).toBe(s.totalBeats);
      for (const n of s.notes.filter((x) => x.hand === 'L')) {
        expect(n.beat % 3, `${v} LH at ${n.beat}`).toBe(0);
        expect(n.beat + n.beats, `${v} LH at ${n.beat}`).toBeLessThanOrEqual(s.totalBeats);
      }
    }
  });

  it('uses only F G A B♭ C D E', () => {
    for (const v of VARIANTS) for (const n of MOTIF_SCORES[v].notes) expect(SCALE.has(n.midi % 12), `${v} MIDI ${n.midi}`).toBe(true);
  });

  it('opens every variant with the cell F4 A4 E5 | D5', () => {
    for (const v of VARIANTS) {
      const r = melody(v).slice(0, 4);
      expect(r.map((n) => [n.beat, n.midi]), v).toEqual([
        [0, 65],
        [1, 69],
        [2, 76],
        [3, 74],
      ]);
      expect(r[3].beats, v).toBe(3);
    }
  });

  it('only the epilogue comes home to F; Act III and ch8 never resolve', () => {
    for (const v of VARIANTS) {
      const r = melody(v);
      const endsOnF = r[r.length - 1].midi % 12 === 5;
      expect(endsOnF, v).toBe(v === 'epilogue');
    }
    for (const v of ['act3', 'act3-bare', 'ch8'] as const) expect(melody(v)[melody(v).length - 1].midi % 12, v).not.toBe(5);
  });

  it('keeps velocities in the felt range (pp 0.15 .. mp 0.55)', () => {
    for (const v of VARIANTS) {
      for (const n of MOTIF_SCORES[v].notes) {
        expect(n.vel, v).toBeGreaterThanOrEqual(0.15);
        expect(n.vel, v).toBeLessThanOrEqual(0.55);
      }
    }
  });

  it('the moments ask only for variants that exist', () => {
    for (const m of Object.values(REVELATION_MOTIF)) expect(MOTIF_SCORES[m.variant]).toBeDefined();
    for (const v of Object.values(CARD_MOTIF)) expect(MOTIF_SCORES[v!]).toBeDefined();
    expect(MOTIF_SCORES[EPILOGUE_MOTIF]).toBeDefined();
  });
});

describe('lengths (§8.4, within 0.05 s)', () => {
  const cases: [MotifVariantId, number, number, number][] = [
    ['act1', 1, 10.909, 3],
    ['act1', 0.94, 10.909 / 0.94, 3],
    ['act2', 1, 15.517, 4],
    ['act3', 1, 14.4, 5],
    ['act3-bare', 1, 14.4, 5],
    ['ch8', 1, 14.4, 4],
    ['epilogue', 1, 29.2, 5],
  ];
  for (const [variant, tempoScale, score, tail] of cases) {
    it(`${variant} at ${tempoScale}: ${score.toFixed(1)} s + ${tail} s`, () => {
      const tl = motifTimeline({ variant, tempoScale });
      expect(Math.abs(tl.scoreSec - score)).toBeLessThan(0.05);
      expect(Math.abs(tl.totalSec - score - tail)).toBeLessThan(0.05);
    });
  }

  it('the epilogue slows from beat 15: each beat after it longer than the one before, ending at 40 bpm', () => {
    const s = MOTIF_SCORES.epilogue;
    const beat = (b: number): number => beatTime(s, 1, b + 1) - beatTime(s, 1, b);
    expect(beat(10)).toBeCloseTo(60 / 48, 6);
    for (let b = 15; b < 20; b++) expect(beat(b + 1)).toBeGreaterThan(beat(b));
    expect(Math.abs(beat(20.999) - 60 / 40)).toBeLessThan(0.05);
  });

  it('holds the pedal through Act III\'s empty bar: D5 rings until the lift at beat 9', () => {
    const tl = motifTimeline({ variant: 'act3', tempoScale: 1 });
    const i = MOTIF_SCORES.act3.notes.findIndex((n) => n.midi === 74);
    expect(tl.releases[i]).toBeCloseTo(beatTime(MOTIF_SCORES.act3, 1, 9), 6);
  });
});
