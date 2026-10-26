/**
 * The cheaper motif render (docs/evidence/AUDIO_RUNS.md, "Slow computers"): the per-sample loops of
 * the felt piano and its room moved out of the generators into plain functions (and a twinned
 * partial's two strings into one loop). The measured tolerance against the old render is zero: every
 * motif the game plays renders to the samples it rendered before (pcmHash pinned from the old code,
 * Node 24 and Chrome 155 alike), and the note loop is checked sample for sample against the old one,
 * kept here, which it must beat by at least 2x (about 6-7x measured here; the whole epilogue render
 * went from 3.8 s to 0.7 s under node and from 3.1-3.7 s of main-thread work to about 0.8 s in Chrome).
 */
import { describe, expect, it } from 'vitest';
import { FELT_PIANO, MOTIF_SCORES, SEED, type MotifRequest } from '../contract';
import type { Steps } from './blocks';
import { Biquad, OnePole, TAU, bakeSeed, clamp, dbToLin, pcmHash, peakAbs, seededRng, type Rng } from './dsp';
import { motifTimeline, noteSteps, renderMotif, stringFundamentalHz, unisonOffsetCents, type PianoNote } from './piano';

const FS = FELT_PIANO.sampleRate;

/** pcmHash of every motif the game plays, rendered by the code before the change (HEAD cd4357b). */
const PINNED: [MotifRequest, string][] = [
  [{ variant: 'act1', tempoScale: 1 }, 'de157a25'],
  [{ variant: 'act1', tempoScale: 0.94 }, '1c8cd626'],
  [{ variant: 'act2', tempoScale: 1 }, '0e6cf86b'],
  [{ variant: 'act3', tempoScale: 1 }, 'b996e105'],
  [{ variant: 'act3-bare', tempoScale: 1 }, 'b8aadbda'],
  [{ variant: 'ch8', tempoScale: 1 }, '546a9fc9'],
  [{ variant: 'epilogue', tempoScale: 1 }, '336c5177'],
];

/** The note loop as it was (cd4357b): the per-sample loop inside the generator, one string at a time. */
function* oldNoteSteps(out: Float32Array, n: PianoNote, r: Rng): Steps {
  const f0 = stringFundamentalHz(n.midi);
  const B = n.midi < 48 ? FELT_PIANO.inharmonicity[0] : n.midi <= 72 ? FELT_PIANO.inharmonicity[1] : FELT_PIANO.inharmonicity[2];
  const v = n.vel;
  const level = v;
  const start = Math.round(n.onset * FS);
  const attack = Math.round(((FELT_PIANO.attackMs[1] - (FELT_PIANO.attackMs[1] - FELT_PIANO.attackMs[0]) * clamp((v - 0.15) / 0.4, 0, 1)) / 1000) * FS);
  const cutoff = FELT_PIANO.feltBaseHz + FELT_PIANO.feltVelHz * v;
  const rel = Number.isFinite(n.release) ? Math.round(n.release * FS) : Infinity;
  const relDecay = Math.exp(-1 / (n.releaseTau * FS));
  const detune = unisonOffsetCents(n.midi);
  for (let k = 1; k <= FELT_PIANO.maxPartials; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk >= FELT_PIANO.maxPartialHz) break;
    const ak = Math.pow(k, -1.5) * Math.abs(Math.sin((Math.PI * k) / FELT_PIANO.strikePoint)) * Math.exp((-k * f0) / cutoff);
    if (ak < 1e-5) continue;
    const tau1 = (0.45 * Math.pow(262 / f0, 0.5)) / (1 + 0.15 * (k - 1));
    const tau2 = (3.2 * Math.pow(262 / f0, 0.6)) / (1 + 0.2 * (k - 1));
    const d1 = Math.exp(-1 / (tau1 * FS));
    const d2 = Math.exp(-1 / (tau2 * FS));
    const strings = k <= 4 ? [-detune, detune] : [0];
    for (const c of strings) {
      const w = (TAU * fk * Math.pow(2, c / 1200)) / FS;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const ph = r() * TAU;
      let s = Math.sin(ph);
      let co = Math.cos(ph);
      let e1 = 0.7;
      let e2 = 0.3;
      let damp = 1;
      const a = (level * ak) / strings.length;
      for (let i = 0; start + i < out.length; i++) {
        if (i >= rel - start) {
          damp *= relDecay;
          if (damp < 1e-5) break;
        }
        const env = (e1 + e2) * damp * (i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1);
        if (env < 1e-6 && i > attack) break;
        out[start + i] += a * env * s;
        if ((i & 16383) === 16383) yield;
        const ns = s * cw + co * sw;
        co = co * cw - s * sw;
        s = ns;
        e1 *= d1;
        e2 *= d2;
      }
    }
    yield;
  }
  const thump = new Float32Array(Math.round(0.03 * FS));
  for (let i = 0; i < thump.length; i++) {
    const t = i / FS;
    thump[i] = (r() * 2 - 1) * (t < 0.012 ? Math.sin((Math.PI * t) / 0.012) : 0);
  }
  new Biquad(FS).set('lowpass', FELT_PIANO.thumpLowpassHz, 0.7).process(thump);
  const a1 = level * Math.abs(Math.sin(Math.PI / FELT_PIANO.strikePoint)) * Math.exp(-f0 / cutoff);
  const tp = peakAbs(thump) || 1;
  const clickLen = Math.round(0.0012 * FS);
  const click = new Float32Array(clickLen);
  const lp = new OnePole(FS, 2000);
  for (let i = 0; i < clickLen; i++) click[i] = lp.tick(r() * 2 - 1) * Math.sin((Math.PI * i) / clickLen);
  const cp = peakAbs(click) || 1;
  const gThump = (a1 * dbToLin(FELT_PIANO.thumpDb)) / tp;
  const gClick = (a1 * dbToLin(FELT_PIANO.keyClickDb)) / cp;
  for (let i = 0; i < thump.length && start + i < out.length; i++) {
    out[start + i] += gThump * thump[i] + (i < clickLen ? gClick * click[i] : 0);
  }
}

/** Every note of a motif through `steps` (the order and the random draws of renderMotifSteps). */
function notesOf(m: MotifRequest, steps: typeof noteSteps): { out: Float32Array; ms: number } {
  const score = MOTIF_SCORES[m.variant];
  const tl = motifTimeline(m);
  const out = new Float32Array(Math.round(tl.totalSec * FS));
  const r = seededRng(bakeSeed(SEED, `motif:${m.variant}`, Math.round(m.tempoScale * 1000)));
  const t0 = performance.now();
  for (let i = 0; i < score.notes.length; i++) {
    const note = score.notes[i];
    const spread = note.hand === 'L' ? (r() * 2 - 1) * 0.002 : 0;
    const g = steps(out, { midi: note.midi, vel: note.vel, onset: Math.max(0, tl.onsets[i] + spread), release: tl.releases[i], releaseTau: tl.releaseTaus[i] }, r);
    while (!g.next().done) {
      // every step
    }
  }
  return { out, ms: performance.now() - t0 };
}

describe('the cheaper motif render', () => {
  it('renders every motif the game plays to the very samples it rendered before (pcmHash pinned from the old code)', () => {
    for (const [m, hash] of PINNED) expect(pcmHash(renderMotif(m, SEED).data).toString(16).padStart(8, '0'), `${m.variant}@${m.tempoScale}`).toBe(hash);
  });

  it('the note loop gives the old per-sample loop sample for sample, at least twice as fast', () => {
    const m: MotifRequest = { variant: 'act3', tempoScale: 1 };
    // Warm both (the engine compiles each loop), then the faster of two runs each.
    const runs = (steps: typeof noteSteps) => [notesOf(m, steps), notesOf(m, steps), notesOf(m, steps)];
    const oldRuns = runs(oldNoteSteps);
    const newRuns = runs(noteSteps);
    expect(Buffer.from(newRuns[0].out.buffer).equals(Buffer.from(oldRuns[0].out.buffer))).toBe(true);
    const best = (xs: { ms: number }[]) => Math.min(...xs.slice(1).map((x) => x.ms));
    const ratio = best(newRuns) / best(oldRuns);
    expect(ratio, `new ${best(newRuns).toFixed(0)} ms, old ${best(oldRuns).toFixed(0)} ms`).toBeLessThan(0.5);
  });
});
