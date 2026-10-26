/**
 * The felt piano and the Archive motif "No. 14" (docs/AUDIO_DESIGN.md §8.4, §8.5).
 *
 * The instrument is the untuned piano at No. 14 Church Lane: the whole of it 10 cents flat
 * (A4 = 437.47 Hz), two strings per note beating gently, and the D4 and D5 keys gone further (±4
 * cents, a 2.7 Hz waver on D5). Felt hammers: a soft attack, strike point at 1/8, a cutoff that opens
 * with velocity, a little thump and key-bed click, and a small, close front room baked in.
 *
 * Each note is additive: up to 12 stretched partials (f_n = n·f0·√(1 + B·n²)) under a two-stage decay,
 * the lowest four doubled into two strings. Notes are released at the first pedal lift at or after
 * their written end (the dampers close with τ 0.35 s); a key struck again while still sounding is
 * damped with τ 0.12 s first, since one string cannot ring twice. renderMotif reads MOTIF_SCORES, so the
 * score is data and this renderer could be swapped for a sampled one without touching the moments.
 *
 * One deliberate departure: the contract's ±0.8 cent unisons would beat at 0.72 Hz on G5. Unisons are
 * set by ear to beat no faster than 0.65 Hz, so each note's offset is min(0.8 cents, what gives
 * 0.65 Hz); the untuned D keys keep their ±4 cents.
 */
import {
  FELT_PIANO,
  MOTIF_SCORES,
  MOTIF_TUNING,
  type BakedPcm,
  type MotifRequest,
  type MotifScore,
  type RenderMotif,
} from '../contract';
import { type Steps, runSteps } from './blocks';
import {
  Biquad,
  END_GUARD_SEC,
  OnePole,
  TAU,
  bakeSeed,
  clamp,
  dbToLin,
  fadeIn,
  highpass4Steps,
  peakAbs,
  processSteps,
  removeDcWindowed,
  scale,
  seededRng,
  type Rng,
} from './dsp';

const FS = FELT_PIANO.sampleRate;
/** Beat rate no unison (other than the untuned keys) exceeds. */
const UNISON_MAX_BEAT_HZ = 0.65;
/** The final cosine fade of a rendered phrase (closing 20 ms before its end). */
const TAIL_FADE_SEC = 1.5;

/** The flat instrument's fundamental for a MIDI note (equal temperament from A4 = 437.47 Hz). */
export const pianoNoteHz = (midi: number): number => MOTIF_TUNING.a4Hz * Math.pow(2, (midi - 69) / 12);

/** Each of a note's two strings sits this many cents either side of the note. */
export function unisonOffsetCents(midi: number): number {
  const untuned = MOTIF_TUNING.untunedKeys[midi];
  if (untuned !== undefined) return untuned;
  const f = pianoNoteHz(midi);
  const capped = (1200 * Math.log2(1 + UNISON_MAX_BEAT_HZ / f)) / 2;
  return Math.min(MOTIF_TUNING.unisonCents, capped);
}

/** The beat between a note's two strings (Hz). */
export const unisonBeatHz = (midi: number): number =>
  pianoNoteHz(midi) * (Math.pow(2, (2 * unisonOffsetCents(midi)) / 1200) - 1);

const inharmonicity = (midi: number): number =>
  midi < 48 ? FELT_PIANO.inharmonicity[0] : midi <= 72 ? FELT_PIANO.inharmonicity[1] : FELT_PIANO.inharmonicity[2];

/**
 * The string's fundamental: a tuner sets a note by its partials, not its fundamental, and stretched
 * partials (f_n = n·f0·√(1 + B·n²)) carry the pitch higher, so each fundamental sits a little flat of
 * the note (by the stretch at partial 3 below middle C, 2 up to B4, 1.5 above) and the note heard is
 * in tune (YIN within 2 cents, tested).
 */
export const stringFundamentalHz = (midi: number): number => {
  const k = midi < 60 ? 3 : midi < 72 ? 2 : 1.5;
  return pianoNoteHz(midi) / Math.sqrt(1 + inharmonicity(midi) * k * k);
};

export interface PianoNote {
  readonly midi: number;
  readonly vel: number;
  /** Onset (s) in the buffer. */
  readonly onset: number;
  /** When the damper starts to close (s), Infinity to ring to the end. */
  readonly release: number;
  readonly releaseTau: number;
}

/** A partial's string yields every this many samples + 1 (16384): a fraction of a millisecond. */
const OSC_BLOCK_MASK = 16383;

/**
 * A partial's per-sample loop over samples [i0, i1) of the note (sample start + i of out), kept out
 * of the generator so the engine compiles it as a plain function (inside the generator the same loop
 * ran three to four times slower). The envelope is the same for both strings of a twinned partial, so
 * they share one loop (each string's sample is added to out in the order the strings were written:
 * the same float32 sums, sample for sample). `st` carries the oscillators between blocks: the two
 * decay stages, the damper, then sin and cos of each string. Returns the sample it stopped at: i1, or
 * earlier where the damper or the decay has taken the partial out of hearing.
 */
function oscillate(
  out: Float32Array,
  start: number,
  i0: number,
  i1: number,
  a: number,
  attack: number,
  relAt: number,
  relDecay: number,
  d1: number,
  d2: number,
  cw: number,
  sw: number,
  st: Float64Array,
): number {
  let e1 = st[0];
  let e2 = st[1];
  let damp = st[2];
  let s = st[3];
  let co = st[4];
  let i = i0;
  for (; i < i1; i++) {
    if (i >= relAt) {
      damp *= relDecay;
      if (damp < 1e-5) break;
    }
    const env = (e1 + e2) * damp * (i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1);
    if (env < 1e-6 && i > attack) break;
    out[start + i] += a * env * s;
    const ns = s * cw + co * sw;
    co = co * cw - s * sw;
    s = ns;
    e1 *= d1;
    e2 *= d2;
  }
  st[0] = e1;
  st[1] = e2;
  st[2] = damp;
  st[3] = s;
  st[4] = co;
  return i;
}

/** oscillate for a twinned partial: the two strings (sin, cos at st[3..4] and st[5..6]) in one loop. */
function oscillateTwin(
  out: Float32Array,
  start: number,
  i0: number,
  i1: number,
  a: number,
  attack: number,
  relAt: number,
  relDecay: number,
  d1: number,
  d2: number,
  cw: number,
  sw: number,
  cw2: number,
  sw2: number,
  st: Float64Array,
): number {
  let e1 = st[0];
  let e2 = st[1];
  let damp = st[2];
  let s = st[3];
  let co = st[4];
  let s2 = st[5];
  let co2 = st[6];
  let i = i0;
  for (; i < i1; i++) {
    if (i >= relAt) {
      damp *= relDecay;
      if (damp < 1e-5) break;
    }
    const env = (e1 + e2) * damp * (i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1);
    if (env < 1e-6 && i > attack) break;
    const ae = a * env;
    out[start + i] += ae * s;
    out[start + i] += ae * s2;
    const ns = s * cw + co * sw;
    co = co * cw - s * sw;
    s = ns;
    const ns2 = s2 * cw2 + co2 * sw2;
    co2 = co2 * cw2 - s2 * sw2;
    s2 = ns2;
    e1 *= d1;
    e2 *= d2;
  }
  st[0] = e1;
  st[1] = e2;
  st[2] = damp;
  st[3] = s;
  st[4] = co;
  st[5] = s2;
  st[6] = co2;
  return i;
}

/**
 * Adds one note into out (additive, stretched partials, two-stage decay, twin strings, thump and
 * click), yielding after each partial.
 */
export function* noteSteps(out: Float32Array, n: PianoNote, r: Rng): Steps {
  const osc = new Float64Array(7);
  const f0 = stringFundamentalHz(n.midi);
  const B = inharmonicity(n.midi);
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
    // Two strings for the lowest four partials (they beat), one above. Each string's phase is drawn
    // in that order, the lower string first.
    const twin = k <= 4;
    const w = (TAU * fk * Math.pow(2, (twin ? -detune : 0) / 1200)) / FS;
    const ph = r() * TAU;
    osc[0] = 0.7;
    osc[1] = 0.3;
    osc[2] = 1;
    osc[3] = Math.sin(ph);
    osc[4] = Math.cos(ph);
    const w2 = twin ? (TAU * fk * Math.pow(2, detune / 1200)) / FS : 0;
    if (twin) {
      const ph2 = r() * TAU;
      osc[5] = Math.sin(ph2);
      osc[6] = Math.cos(ph2);
    }
    const a = (level * ak) / (twin ? 2 : 1);
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const cw2 = Math.cos(w2);
    const sw2 = Math.sin(w2);
    const end = out.length - start;
    for (let i = 0; i < end; ) {
      const to = Math.min(end, (i | OSC_BLOCK_MASK) + 1);
      const j = twin
        ? oscillateTwin(out, start, i, to, a, attack, rel - start, relDecay, d1, d2, cw, sw, cw2, sw2, osc)
        : oscillate(out, start, i, to, a, attack, rel - start, relDecay, d1, d2, cw, sw, osc);
      if (j < to) break;
      i = j;
      if (((i - 1) & OSC_BLOCK_MASK) === OSC_BLOCK_MASK) yield;
    }
    yield;
  }
  // The felt thump (12 ms, low-passed at 350 Hz) and the key-bed click.
  const thump = new Float32Array(Math.round(0.03 * FS));
  for (let i = 0; i < thump.length; i++) {
    const t = i / FS;
    thump[i] = (r() * 2 - 1) * (t < 0.012 ? Math.sin((Math.PI * t) / 0.012) : 0);
  }
  new Biquad(FS).set('lowpass', FELT_PIANO.thumpLowpassHz, 0.7).process(thump);
  // Both relative to the note's fundamental: the thump at -24 dB, the click at -32 dB.
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

/** One note rendered alone, dry (no room), for tests: held `holdSec` then released with τ 0.35 s. */
export function renderNote(midi: number, vel: number, holdSec: number, seconds: number, seed = 42): Float32Array {
  const out = new Float32Array(Math.round(seconds * FS));
  runSteps(noteSteps(out, { midi, vel, onset: 0.01, release: 0.01 + holdSec, releaseTau: FELT_PIANO.pedalLiftTauSec }, seededRng(seed)));
  return out;
}

// -------------------------------------------------------------------------------------------------
// The score's clock
// -------------------------------------------------------------------------------------------------

/** Seconds from the start to `beat`, with the score's tempo, tempoScale and linear ritardando. */
export function beatTime(score: MotifScore, tempoScale: number, beat: number): number {
  const b0 = score.bpm * tempoScale;
  const rit = score.ritardando;
  if (!rit || beat <= rit.fromBeat) return (beat * 60) / b0;
  const b1 = rit.toBpm * tempoScale;
  const span = score.totalBeats - rit.fromBeat;
  const x = Math.min(beat, score.totalBeats) - rit.fromBeat;
  const t0 = (rit.fromBeat * 60) / b0;
  const bpmAt = b0 + ((b1 - b0) * x) / span;
  const t = b1 === b0 ? (x * 60) / b0 : ((60 * span) / (b1 - b0)) * Math.log(bpmAt / b0);
  // Past the end of the ritardando, time runs on at its final tempo.
  return t0 + t + (beat > score.totalBeats ? ((beat - score.totalBeats) * 60) / b1 : 0);
}

/** The tempo (bpm) at the end of the score, after any ritardando. */
const finalBpm = (score: MotifScore, tempoScale: number): number => (score.ritardando?.toBpm ?? score.bpm) * tempoScale;

export interface MotifTimeline {
  /** Per note of the score, in score order. */
  readonly onsets: readonly number[];
  /** When each note's damper starts closing (s); Infinity = rings to the end. */
  readonly releases: readonly number[];
  readonly releaseTaus: readonly number[];
  /** The distinct onset times, ascending. */
  readonly uniqueOnsets: readonly number[];
  /** The end of the last beat plus the fermata (s). */
  readonly scoreSec: number;
  /** scoreSec + tailSec: the rendered length. */
  readonly totalSec: number;
}

/** When every note of a motif starts and stops, and how long the phrase is. */
export function motifTimeline(m: MotifRequest): MotifTimeline {
  const score = MOTIF_SCORES[m.variant];
  const s = m.tempoScale;
  const lastOnset = Math.max(...score.notes.map((n) => n.beat));
  const fermataSec = (score.fermataBeats * 60) / finalBpm(score, s);
  const scoreSec = beatTime(score, s, score.totalBeats) + fermataSec;
  const onsets = score.notes.map((n) => beatTime(score, s, n.beat));
  const releases: number[] = [];
  const taus: number[] = [];
  score.notes.forEach((n) => {
    const writtenEnd = n.beat + n.beats;
    const lift = score.pedalLifts.find((b) => b >= writtenEnd - 1e-9 && b > n.beat);
    let rel = lift === undefined || n.beat === lastOnset ? Infinity : beatTime(score, s, lift);
    let tau: number = FELT_PIANO.pedalLiftTauSec;
    // The same key struck again while this one still sounds: damp it as the hammer comes back.
    const again = score.notes.find((o) => o.midi === n.midi && o.beat > n.beat);
    if (again) {
      const t = beatTime(score, s, again.beat);
      if (t < rel) {
        rel = t;
        tau = FELT_PIANO.damperTauSec;
      }
    }
    releases.push(rel);
    taus.push(tau);
  });
  const uniqueOnsets = [...new Set(onsets.map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
  return { onsets, releases, releaseTaus: taus, uniqueOnsets, scoreSec, totalSec: scoreSec + score.tailSec };
}

// -------------------------------------------------------------------------------------------------
// The room and the render
// -------------------------------------------------------------------------------------------------

/** The room's samples between two yields (as the loops inside the generator had them). */
const ROOM_BLOCK = 8192;

/**
 * The small front room: 4 parallel combs and 2 series all-passes (Schroeder), RT60 1.3 s, the wet
 * signal low-passed at 4 kHz and mixed at -14 dB. In place, in steps of about 0.4 s.
 */
function* roomSteps(x: Float32Array): Steps {
  const n = x.length;
  const wet = new Float32Array(n);
  const combsMs = [29.7, 37.1, 41.1, 43.7];
  for (const ms of combsMs) {
    const d = Math.round((ms / 1000) * FS);
    const g = Math.pow(10, (-3 * (ms / 1000)) / FELT_PIANO.roomRt60Sec);
    const buf = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < n; i += ROOM_BLOCK) {
      p = comb(x, wet, i, Math.min(n, i + ROOM_BLOCK), buf, p, g, combsMs.length);
      yield;
    }
  }
  for (const [ms, g] of [
    [5.0, 0.7],
    [1.7, 0.7],
  ] as const) {
    const d = Math.round((ms / 1000) * FS);
    const buf = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < n; i += ROOM_BLOCK) {
      p = allpass(wet, i, Math.min(n, i + ROOM_BLOCK), buf, p, g);
      yield;
    }
  }
  yield* processSteps(new Biquad(FS).set('lowpass', FELT_PIANO.roomLowpassHz, 0.7), wet);
  yield;
  const g = dbToLin(FELT_PIANO.roomWetDb);
  for (let i = 0; i < n; i += 4 * ROOM_BLOCK) {
    mixWet(x, wet, i, Math.min(n, i + 4 * ROOM_BLOCK), g);
    yield;
  }
}

/** One comb of the room over x[i0..i1) into wet (plain functions: see oscillate). Returns the write position. */
function comb(x: Float32Array, wet: Float32Array, i0: number, i1: number, buf: Float32Array, p0: number, g: number, combs: number): number {
  const d = buf.length;
  let p = p0;
  for (let i = i0; i < i1; i++) {
    const y = buf[p];
    buf[p] = x[i] + g * y;
    wet[i] += y / combs;
    p = p + 1 === d ? 0 : p + 1;
  }
  return p;
}

/** One all-pass of the room over wet[i0..i1), in place. Returns the write position. */
function allpass(wet: Float32Array, i0: number, i1: number, buf: Float32Array, p0: number, g: number): number {
  const d = buf.length;
  let p = p0;
  for (let i = i0; i < i1; i++) {
    const bv = buf[p];
    const y = -g * wet[i] + bv;
    buf[p] = wet[i] + g * y;
    wet[i] = y;
    p = p + 1 === d ? 0 : p + 1;
  }
  return p;
}

function mixWet(x: Float32Array, wet: Float32Array, i0: number, i1: number, g: number): void {
  for (let i = i0; i < i1; i++) x[i] += g * wet[i];
}

/** Renders a motif in steps (a few per note, the room in blocks): for the bank's slices. */
export function* renderMotifSteps(m: MotifRequest, seed: number): Steps<BakedPcm> {
  const score = MOTIF_SCORES[m.variant];
  const tl = motifTimeline(m);
  const out = new Float32Array(Math.round(tl.totalSec * FS));
  const r = seededRng(bakeSeed(seed, `motif:${m.variant}`, Math.round(m.tempoScale * 1000)));
  for (let i = 0; i < score.notes.length; i++) {
    const note = score.notes[i];
    // Chord notes a hair apart (±2 ms, seeded); the melody exactly on its beat.
    const spread = note.hand === 'L' ? (r() * 2 - 1) * 0.002 : 0;
    yield* noteSteps(out, { midi: note.midi, vel: note.vel, onset: Math.max(0, tl.onsets[i] + spread), release: tl.releases[i], releaseTau: tl.releaseTaus[i] }, r);
  }
  yield* roomSteps(out);
  yield* highpass4Steps(out, FS, 40);
  fadeIn(out, FS, 0.001);
  const guard = Math.round(END_GUARD_SEC * FS);
  const span = Math.round(TAIL_FADE_SEC * FS);
  const from = out.length - guard - span;
  for (let i = Math.max(0, from); i < out.length; i++) {
    const k = i - from;
    out[i] *= k < span ? 0.5 + 0.5 * Math.cos((Math.PI * (k + 1)) / span) : 0;
  }
  yield;
  removeDcWindowed(out, out.length - guard);
  yield;
  const p = peakAbs(out);
  yield;
  if (p > 0) scale(out, dbToLin(FELT_PIANO.peakDb) / p);
  return { sampleRate: FS, data: out };
}

/** The contract's RenderMotif: the phrase peaks at FELT_PIANO.peakDb (-14 dBFS). */
export const renderMotif: RenderMotif = (m, seed) => runSteps(renderMotifSteps(m, seed));
