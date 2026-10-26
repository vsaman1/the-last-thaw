/**
 * The live voices (docs/AUDIO_DESIGN.md §7): wind, the iceberg's scrape, the river, three waterfall
 * slots, the sea, the flood after a dam breach, and four machine slots (P1). Package C polls the game
 * into reused input objects and calls update() at 10–30 Hz; everything else moves by itself on the
 * audio thread: noise loops run continuously and control walks (noiseBank.ts) are wired straight into
 * gain params, so gusts, babble and swells cost no JavaScript per frame.
 *
 * Rules every voice keeps:
 * - It starts silent and fades in from its first update.
 * - update() never allocates, and calls setTargetAtTime only when a target moves by more than 1 %
 *   (Target below); it never uses cancelAndHoldAtTime.
 * - Rarely-used voices (falls, sea, flood, machines) are built on their first audible update.
 * - stop(fade) ramps every output to 0, stops every source after the fade and disconnects every node
 *   when the last source has ended. It is idempotent, and later updates do nothing.
 *
 * Levels are pinned by trims (below) so the design's reference points land on §2.3's targets; the
 * ambience test recomputes them from the actual noise and checks them within 1 dB.
 */
import {
  EMITTER_LOOP,
  SURFACE_SCRAPE,
  type AmbienceOutputs,
  type AmbienceTimbre,
  type AmbienceVoiceFactory,
  type AmbienceVoices,
  type EmitterKind,
  type EmitterSlotInputs,
  type FallSlotInputs,
  type FloodInputs,
  type NoiseBank,
  type OceanInputs,
  type ScrapeInputs,
  type SoundBank,
  type WaterInputs,
  type WindCharacter,
  type WindInputs,
} from '../contract';
import { Biquad, NOISE_RMS, bakeSeed, clamp, dbToLin, range, seededRng, type Rng } from '../synth/dsp';
import { CONTROL, CONTROL_PACE_SEC } from './noiseBank';

/** Web Audio reads lowpass/highpass Q in dB: this is Butterworth (Q 0.707). */
export const BUTTERWORTH_Q_DB = -3.0103;
/** Brown-noise chains are high-passed here: rumble without sub-bass boom. */
const SUB_CUT_HZ = 45;
/** τ of the fade-in on a voice's first update (~1.5 s to full). */
const FIRST_TAU = 0.5;

/**
 * Trims that put each voice's reference point on its §2.3 target (see the ambience test, which
 * renders every chain in node and checks these):
 * - wind: -44 + 10·amount dBFS RMS over a 30 s window of gusts (the band's RMS is measured on the
 *   noise itself at setTimbre, so its trim is 1);
 * - scrape: 22 m/s on rock, 30 t, radius 4 m → -25 dBFS RMS (target ≤ -22);
 * - water: level 1 → -24 dBFS RMS (level 0.25 → -36);
 * - falls: strength 1 at 20 m (distGain 1, near 0.625) → -22 dBFS RMS;
 * - flood: rush 1 at the breach → -18 dBFS RMS;
 * - sea: proximity 1 at a wave's peak → -22 dBFS RMS (the floor between waves ~ -34).
 */
export const TRIM = {
  wind: 1,
  scrape: 3.525,
  water: 24.64,
  falls: 7.117,
  flood: 4.996,
  ocean: 0.452,
} as const;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A param target that moves only when the value changes by more than 1 % (and more than eps). */
export class Target {
  private last = Number.NaN;
  constructor(
    private readonly ctx: BaseAudioContext,
    readonly param: AudioParam,
    private readonly eps: number,
    private readonly relative = true,
  ) {}
  /** True when it issued a setTargetAtTime. */
  set(v: number, tau: number): boolean {
    const l = this.last;
    if (l === l) {
      const d = Math.abs(v - l);
      if (d <= this.eps) return false;
      if (this.relative && d <= 0.01 * Math.max(Math.abs(v), Math.abs(l))) return false;
    }
    this.param.setTargetAtTime(v, this.ctx.currentTime, tau);
    this.last = v;
    return true;
  }
  get current(): number {
    return this.last === this.last ? this.last : 0;
  }
}

/** Every node of the voices, for stop(). */
class Graph {
  readonly sources: AudioBufferSourceNode[] = [];
  readonly nodes: AudioNode[] = [];
  readonly outs: GainNode[] = [];
  constructor(
    readonly ctx: BaseAudioContext,
    readonly r: Rng,
  ) {}
  /**
   * A looping source from a seeded point in its buffer. Noise loops default to a seeded rate within
   * ±4 %, so no two chains (or two runs of one 6 s loop) line up into an audible period.
   */
  loop(buffer: AudioBuffer, rate = range(this.r, 0.96, 1.04)): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.ctx.currentTime, this.r() * buffer.duration);
    this.sources.push(s);
    this.nodes.push(s);
    return s;
  }
  /**
   * A noise bed that never repeats: two loops of the buffer at rates at least 3 % apart (seeded),
   * each at 0.707, summed. One 6 s loop under a long river or flood is a period the ear finds;
   * two incommensurate ones are not. Their sources are pushed onto `collect` when given.
   */
  noise(buffer: AudioBuffer, collect?: AudioBufferSourceNode[]): GainNode {
    const sum = this.gain(1);
    for (const rate of [range(this.r, 0.955, 0.985), range(this.r, 1.015, 1.045)]) {
      const s = this.loop(buffer, rate);
      collect?.push(s);
      chain(s, this.gain(Math.SQRT1_2), sum);
    }
    return sum;
  }
  gain(v = 0, out = false): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    if (out) this.outs.push(g);
    return g;
  }
  filter(type: BiquadFilterType, f: number, q: number, gainDb = 0): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = gainDb;
    this.nodes.push(b);
    return b;
  }
  panner(): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = 0;
    this.nodes.push(p);
    return p;
  }
}

/** a → b → c ...: connects a chain and returns its last node. */
function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
  return nodes[nodes.length - 1];
}

/** RMS gain (re NOISE_RMS) of a noise buffer through a band-pass, measured on its own samples. */
function bandRms(buffer: AudioBuffer, f: number, q: number): number {
  const d = buffer.getChannelData(0);
  const bq = new Biquad(buffer.sampleRate, true).set('bandpass', Math.min(f, buffer.sampleRate * 0.45), q);
  const n = Math.min(d.length, Math.round(buffer.sampleRate * 1.5));
  const skip = Math.round(buffer.sampleRate * 0.1);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const y = bq.tick(d[i]);
    if (i >= skip) s += y * y;
  }
  return Math.sqrt(s / Math.max(1, n - skip)) / NOISE_RMS || 1;
}

// -------------------------------------------------------------------------------------------------
// Wind (§7.1): the room tone
// -------------------------------------------------------------------------------------------------

class Wind {
  private readonly bp: BiquadFilterNode;
  private readonly whistleBp: BiquadFilterNode;
  private readonly gust: GainNode;
  private readonly depth: GainNode;
  private readonly linW: GainNode;
  private readonly trW: GainNode;
  private readonly whistle: GainNode;
  private readonly level: GainNode;
  private readonly gustSrc: AudioBufferSourceNode;
  private readonly troughSrc: AudioBufferSourceNode;
  private readonly tLevel: Target;
  private readonly tBand: Target;
  private readonly tWhistle: Target;
  private readonly tWhistleBand: Target;
  private readonly tQ: Target;
  private readonly tGust: Target;
  private readonly tDepth: Target;
  private readonly tLin: Target;
  private readonly tTr: Target;
  private readonly tGustRate: Target;
  private readonly tTrRate: Target;
  private char: WindCharacter;
  private norm = 1;
  /** The band's RMS an octave up (where it sits at full airborne speed). */
  private normUp = 1;
  private whistleNorm = 1;
  private started = false;

  constructor(
    g: Graph,
    private readonly noise: NoiseBank,
    out: AudioNode,
    char: WindCharacter,
  ) {
    const { ctx } = g;
    this.bp = g.filter('bandpass', char.bandHz, char.q);
    this.whistleBp = g.filter('bandpass', char.bandHz * 2, 1.5);
    this.gust = g.gain(1);
    this.depth = g.gain(0);
    this.linW = g.gain(1);
    this.trW = g.gain(0);
    this.whistle = g.gain(0);
    this.level = g.gain(0, true);
    chain(g.noise(noise.brown), g.filter('highpass', SUB_CUT_HZ, BUTTERWORTH_Q_DB), this.bp, this.gust);
    chain(g.noise(noise.pink), this.whistleBp, this.whistle, this.gust);
    chain(this.gust, this.level, out);
    this.gustSrc = g.loop(noise.control[CONTROL.gust]);
    this.troughSrc = g.loop(noise.control[CONTROL.gustTroughs]);
    chain(this.gustSrc, this.linW, this.depth);
    chain(this.troughSrc, this.trW, this.depth);
    this.depth.connect(this.gust.gain);
    this.tLevel = new Target(ctx, this.level.gain, 1e-6);
    this.tBand = new Target(ctx, this.bp.frequency, 0.5);
    this.tWhistleBand = new Target(ctx, this.whistleBp.frequency, 0.5);
    this.tQ = new Target(ctx, this.bp.Q, 0.001);
    this.tWhistle = new Target(ctx, this.whistle.gain, 1e-6);
    this.tGust = new Target(ctx, this.gust.gain, 1e-6);
    this.tDepth = new Target(ctx, this.depth.gain, 1e-6);
    this.tLin = new Target(ctx, this.linW.gain, 1e-6, false);
    this.tTr = new Target(ctx, this.trW.gain, 1e-6, false);
    this.tGustRate = new Target(ctx, this.gustSrc.playbackRate, 0.001);
    this.tTrRate = new Target(ctx, this.troughSrc.playbackRate, 0.001);
    this.char = char;
    this.setCharacter(char);
  }

  /** The act's colour: band, Q, gust depth and pace, troughs. Measures the band's RMS for the level. */
  setCharacter(c: WindCharacter): void {
    this.char = c;
    this.norm = bandRms(this.noise.brown, c.bandHz, c.q);
    this.normUp = bandRms(this.noise.brown, c.bandHz * 2, c.q);
    this.whistleNorm = bandRms(this.noise.pink, c.bandHz * 2, 1.5);
    this.tBand.set(c.bandHz, 0.5);
    this.tWhistleBand.set(c.bandHz * 2, 0.5);
    this.tQ.set(c.q, 0.5);
    // The gust gain swings lo..hi around a mean of 1 (troughs sink to -20 dB).
    const hi = dbToLin(c.gustDb);
    const lo = c.troughs ? dbToLin(-20) : dbToLin(-c.gustDb);
    const mean = (hi + lo) / 2;
    this.tGust.set(lo / mean, 0.5);
    this.tDepth.set((hi - lo) / mean, 0.5);
    this.tLin.set(c.troughs ? 0 : 1, 0.5);
    this.tTr.set(c.troughs ? 1 : 0, 0.5);
    const rate = CONTROL_PACE_SEC[CONTROL.gust] / Math.max(0.5, c.gustSec);
    this.tGustRate.set(rate, 0.5);
    this.tTrRate.set(rate, 0.5);
  }

  update(i: WindInputs): void {
    const air = Math.min(1, Math.max(0, i.airSpeed) / 30);
    const db = -44 + 10 * clamp(i.amount, 0, 1) + 6 * air;
    const tau = this.started ? 0.4 : FIRST_TAU;
    // The band rises with the speed and brown noise thins as it rises: measure the level where it is.
    const norm = this.norm * Math.pow(this.normUp / this.norm, air);
    this.tLevel.set((TRIM.wind * dbToLin(db)) / (NOISE_RMS * norm), tau);
    this.tBand.set(this.char.bandHz * Math.pow(2, air), 0.3);
    this.tWhistle.set(i.amount >= 0.7 ? (dbToLin(-12) * this.norm) / this.whistleNorm : 0, tau);
    this.started = true;
  }
}

// -------------------------------------------------------------------------------------------------
// Scrape (§7.2): the iceberg sliding, on the effects channel
// -------------------------------------------------------------------------------------------------

class Scrape {
  private readonly hissBp: BiquadFilterNode;
  private readonly hiss: GainNode;
  private readonly rumbleLp: BiquadFilterNode;
  private readonly rumble: GainNode;
  private readonly gritLp: BiquadFilterNode;
  private readonly grit: GainNode;
  private readonly gritDepth: GainNode;
  private readonly wade: GainNode;
  private gritSrc: AudioBufferSourceNode[] | null = null;
  private tGritRate: Target[] = [];
  private readonly gritFactor: readonly number[];
  private readonly t: {
    hiss: Target;
    hissHz: Target;
    hissQ: Target;
    rumble: Target;
    rumbleHz: Target;
    grit: Target;
    gritDepth: Target;
    gritLp: Target;
    wade: Target;
  };

  constructor(
    private readonly g: Graph,
    noise: NoiseBank,
    private readonly bank: SoundBank,
    out: AudioNode,
  ) {
    const { ctx } = g;
    const sum = g.gain(1, true);
    sum.connect(out);
    this.hissBp = g.filter('bandpass', 1500, 1.4);
    this.hiss = g.gain(0);
    chain(g.noise(noise.white), this.hissBp, this.hiss, sum);
    this.rumbleLp = g.filter('lowpass', 200, BUTTERWORTH_Q_DB);
    this.rumble = g.gain(0);
    chain(g.noise(noise.brown), g.filter('highpass', SUB_CUT_HZ, BUTTERWORTH_Q_DB), this.rumbleLp, this.rumble, sum);
    this.gritLp = g.filter('lowpass', 20000, BUTTERWORTH_Q_DB);
    this.grit = g.gain(0);
    chain(this.gritLp, this.grit, sum);
    // The grinding comes and goes: the babble walk moves the grit level (0.4 + 1.2 x walk, mean 1).
    this.gritDepth = g.gain(0);
    chain(g.loop(noise.control[CONTROL.babble], 0.6), this.gritDepth);
    this.gritDepth.connect(this.grit.gain);
    this.wade = g.gain(0);
    chain(g.noise(noise.pink), g.filter('bandpass', 800, 0.7), g.filter('lowpass', 2000, BUTTERWORTH_Q_DB), this.wade, sum);
    this.gritFactor = [range(g.r, 0.93, 0.96), range(g.r, 1.04, 1.07)];
    this.t = {
      hiss: new Target(ctx, this.hiss.gain, 1e-6),
      hissHz: new Target(ctx, this.hissBp.frequency, 0.5),
      hissQ: new Target(ctx, this.hissBp.Q, 0.001),
      rumble: new Target(ctx, this.rumble.gain, 1e-6),
      rumbleHz: new Target(ctx, this.rumbleLp.frequency, 0.5),
      grit: new Target(ctx, this.grit.gain, 1e-6),
      gritDepth: new Target(ctx, this.gritDepth.gain, 1e-6),
      gritLp: new Target(ctx, this.gritLp.frequency, 0.5),
      wade: new Target(ctx, this.wade.gain, 1e-6),
    };
    this.attachGrit();
  }

  /**
   * The grit loop is a baked core sound, wired as soon as the bank has it: two copies at rates 9 %
   * apart, so its 2 s period never shows at a steady speed.
   */
  private attachGrit(): void {
    if (this.gritSrc) return;
    const buf = this.bank.buffer('scrape.grit', 0);
    if (!buf) return;
    this.gritSrc = this.gritFactor.map((k) => {
      const s = this.g.loop(buf, 0.7 * k);
      chain(s, this.g.gain(Math.SQRT1_2), this.gritLp);
      this.tGritRate.push(new Target(this.g.ctx, s.playbackRate, 0.001));
      return s;
    });
  }

  update(i: ScrapeInputs): void {
    if (!this.gritSrc) this.attachGrit();
    const v = Math.max(0, i.speed);
    const contact = (i.onLand || i.wading) && !i.airborne;
    const drive = contact ? smoothstep(0.8, 5, v) * (0.35 + 0.65 * Math.min(1, v / 22)) * (0.8 + 0.2 * Math.min(1, i.massT / 100)) : 0;
    const surf = SURFACE_SCRAPE[i.ground];
    const k = TRIM.scrape;
    const hiss = 0.08 * drive * k;
    const rumble = 0.08 * drive * clamp(Math.sqrt(Math.max(0, i.massT) / 30), 0.6, 2) * smoothstep(2, 20, v) * k;
    const grit = i.wading ? 0 : 0.06 * drive * surf.grit * k;
    const wade = i.wading ? 0.06 * drive * k : 0;
    // Rising τ 0.08 s, falling 0.15 s; a launch cuts it in 0.03 s, going afloat fades it over ~1 s.
    const fall = i.airborne ? 0.03 : contact ? 0.15 : 0.25;
    const t = this.t;
    t.hiss.set(hiss, hiss > t.hiss.current ? 0.08 : fall);
    t.rumble.set(rumble, rumble > t.rumble.current ? 0.08 : fall);
    t.grit.set(0.4 * grit, 0.4 * grit > t.grit.current ? 0.08 : fall);
    t.gritDepth.set(1.2 * grit, 1.2 * grit > t.gritDepth.current ? 0.08 : fall);
    t.wade.set(wade, wade > t.wade.current ? 0.08 : fall);
    t.hissHz.set(clamp((500 + 60 * v) * Math.pow(6 / Math.max(0.5, i.radius), 0.3), 300, 2600), 0.08);
    t.hissQ.set(surf.q, 0.2);
    t.rumbleHz.set(90 + 6 * v, 0.08);
    t.gritLp.set(surf.lowpassHz > 0 ? surf.lowpassHz : 20000, 0.2);
    for (let k = 0; k < this.tGritRate.length; k++) this.tGritRate[k].set((0.7 + v / 40) * this.gritFactor[k], 0.08);
  }
}

// -------------------------------------------------------------------------------------------------
// River and flowing water (§7.3)
// -------------------------------------------------------------------------------------------------

const WATER_BANDS = [320, 760, 1650, 3400] as const;
/** The bands' babble walks run at unrelated rates, so their 30 s walks never line up. */
const BAND_RATE = [1, 1.137, 1.291, 1.414] as const;

class Water {
  private readonly bandRate: Target[] = [];
  private readonly babble: GainNode;
  private readonly low: GainNode;
  private readonly swellDepth: GainNode;
  private readonly top: GainNode;
  private readonly lap: GainNode;
  private readonly t: { babble: Target; low: Target; swell: Target; top: Target; pan: Target };
  private topDb = 0;
  private started = false;
  private nextLap = 0;
  private lapLevel = 0;

  constructor(
    private readonly g: Graph,
    noise: NoiseBank,
    out: AudioNode,
  ) {
    const { ctx } = g;
    const pan = g.panner();
    const sum = g.gain(1, true);
    chain(sum, pan, out);
    this.babble = g.gain(0);
    this.babble.connect(sum);
    this.top = g.gain(1);
    WATER_BANDS.forEach((f, k) => {
      // Each band its own pink loop at its own seeded rate: no shared period for the ear to find.
      const pink = g.loop(noise.pink);
      const bp = g.filter('bandpass', f, 1.5);
      // Each band's level follows its own stretch of the babble walk: intrinsic 0.25 + 0.75 x walk.
      const bandGain = g.gain(0.25);
      const ctl = g.loop(noise.control[CONTROL.babble]);
      const depth = g.gain(0.75);
      chain(ctl, depth);
      depth.connect(bandGain.gain);
      if (k === WATER_BANDS.length - 1) chain(pink, bp, bandGain, this.top, this.babble);
      else chain(pink, bp, bandGain, this.babble);
      this.bandRate.push(new Target(ctx, ctl.playbackRate, 0.001));
    });
    this.low = g.gain(0);
    chain(g.noise(noise.brown), g.filter('highpass', SUB_CUT_HZ, BUTTERWORTH_Q_DB), g.filter('lowpass', 140, BUTTERWORTH_Q_DB), this.low, sum);
    // Afloat: the low layer swells at about 0.5 Hz (the slow walk, sped up).
    this.swellDepth = g.gain(0);
    chain(g.loop(noise.control[CONTROL.swell], CONTROL_PACE_SEC[CONTROL.swell] / 2), this.swellDepth);
    this.swellDepth.connect(this.low.gain);
    // Laps against the ice: 60 ms bursts of 600 Hz-low-passed noise, scheduled 0.5 s ahead.
    this.lap = g.gain(0);
    chain(g.loop(noise.brown), g.filter('lowpass', 600, BUTTERWORTH_Q_DB), this.lap, sum);
    this.t = {
      babble: new Target(ctx, this.babble.gain, 1e-6),
      low: new Target(ctx, this.low.gain, 1e-6),
      swell: new Target(ctx, this.swellDepth.gain, 1e-6),
      top: new Target(ctx, this.top.gain, 1e-4),
      pan: new Target(ctx, pan.pan, 0.01, false),
    };
  }

  setTopDb(db: number): void {
    this.topDb = db;
  }

  update(i: WaterInputs): void {
    const level = clamp(i.level, 0, 1);
    const tau = this.started ? 0.3 : FIRST_TAU;
    const k = TRIM.water;
    const lowBase = 0.03 * level * k * (i.afloat ? dbToLin(3) : 1);
    this.t.babble.set(0.02 * level * k, tau);
    this.t.low.set(lowBase, tau);
    this.t.swell.set(i.afloat ? lowBase * 0.4 : 0, 0.5);
    this.t.top.set(dbToLin(this.topDb) * (0.6 + 0.4 * clamp(i.turbulence, 0, 1)), 0.3);
    this.t.pan.set(clamp(i.pan, -1, 1), 0.2);
    const rate = 0.5 + Math.max(0, i.flowSpeed) / 12;
    for (let b = 0; b < this.bandRate.length; b++) this.bandRate[b].set(rate * BAND_RATE[b], 0.5);
    this.lapLevel = i.afloat ? 0.05 * level * k : 0;
    if (i.afloat) this.scheduleLaps();
    this.started = true;
  }

  private scheduleLaps(): void {
    const now = this.g.ctx.currentTime;
    if (this.nextLap < now) this.nextLap = now + range(this.g.r, 0.1, 0.4);
    while (this.nextLap < now + 0.5) {
      const t = this.nextLap;
      const p = this.lap.gain;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(this.lapLevel, t + 0.008);
      p.setTargetAtTime(0, t + 0.01, 0.015);
      this.nextLap = t + range(this.g.r, 0.7, 1.5);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Waterfalls (§7.4): three slots, built on first use
// -------------------------------------------------------------------------------------------------

class FallSlot {
  private built = false;
  private t: { main: Target; lp: Target; thunder: Target; spray: Target; pan: Target } | null = null;
  private started = false;

  constructor(
    private readonly g: Graph,
    private readonly noise: NoiseBank,
    private readonly out: AudioNode,
  ) {}

  private build(): void {
    const { g, noise } = this;
    const pan = g.panner();
    const sum = g.gain(1, true);
    chain(sum, pan, this.out);
    const lp = g.filter('lowpass', 2500, BUTTERWORTH_Q_DB);
    const main = g.gain(0);
    const body = g.gain(1);
    chain(g.noise(noise.brown), g.filter('highpass', SUB_CUT_HZ, BUTTERWORTH_Q_DB), body);
    const half = g.gain(0.5);
    chain(g.noise(noise.pink), half, body);
    chain(body, g.filter('peaking', 250, 1, 4), lp, main, sum);
    const thunder = g.gain(0);
    chain(g.noise(noise.brown), g.filter('highpass', SUB_CUT_HZ, BUTTERWORTH_Q_DB), g.filter('lowpass', 120, BUTTERWORTH_Q_DB), thunder, sum);
    const spray = g.gain(0);
    chain(g.noise(noise.white), g.filter('highpass', 3000, BUTTERWORTH_Q_DB), spray, sum);
    const { ctx } = g;
    this.t = {
      main: new Target(ctx, main.gain, 1e-6),
      lp: new Target(ctx, lp.frequency, 0.5),
      thunder: new Target(ctx, thunder.gain, 1e-6),
      spray: new Target(ctx, spray.gain, 1e-6),
      pan: new Target(ctx, pan.pan, 0.01, false),
    };
    this.built = true;
  }

  update(i: FallSlotInputs): void {
    if (!this.built) {
      if (!i.active || i.strength * i.distGain <= 0) return;
      this.build();
    }
    const t = this.t!;
    const s = i.active ? clamp(i.strength, 0, 1) * Math.max(0, i.distGain) * TRIM.falls : 0;
    const near = clamp(i.near, 0, 1);
    // An active slot follows in 0.3 s; a reassigned one fades out over ~1.5 s.
    const tau = !this.started ? FIRST_TAU : i.active ? 0.3 : 0.5;
    t.main.set(0.08 * s, tau);
    t.thunder.set(0.05 * s * near, tau);
    t.spray.set(0.04 * s * near, tau);
    t.lp.set(Math.min(2500, Math.max(200, i.airLowpassHz)), 0.3);
    t.pan.set(clamp(i.pan, -1, 1), 0.2);
    this.started = true;
  }
}

// -------------------------------------------------------------------------------------------------
// The sea (§7.6): bed, scheduled waves, laps at sea
// -------------------------------------------------------------------------------------------------

interface WaveChain {
  readonly lp: BiquadFilterNode;
  readonly gain: GainNode;
  readonly foam: GainNode;
}

class Ocean {
  private built = false;
  private waves: WaveChain[] = [];
  private nextWave = 0;
  private which = 0;
  private atSea = false;
  private level: Target | null = null;
  private pan: Target | null = null;
  private lap: GainNode | null = null;
  private nextLap = 0;
  private lapLevel = 0;
  private started = false;

  constructor(
    private readonly g: Graph,
    private readonly noise: NoiseBank,
    private readonly out: AudioNode,
  ) {}

  private build(): void {
    const { g, noise } = this;
    const pan = g.panner();
    const level = g.gain(0, true);
    chain(level, pan, this.out);
    // The surf floor between waves: 25 % of a wave's peak.
    chain(g.noise(noise.pink), g.filter('lowpass', 600, BUTTERWORTH_Q_DB), g.gain(0.25), level);
    for (let k = 0; k < 2; k++) {
      const lp = g.filter('lowpass', 300, BUTTERWORTH_Q_DB);
      const gain = g.gain(0);
      chain(g.loop(noise.pink), lp, gain, level);
      const foam = g.gain(0);
      chain(g.loop(noise.white), g.filter('highpass', 3000, BUTTERWORTH_Q_DB), foam, level);
      this.waves.push({ lp, gain, foam });
    }
    this.lap = g.gain(0);
    chain(g.loop(noise.brown), g.filter('lowpass', 600, BUTTERWORTH_Q_DB), this.lap, level);
    this.level = new Target(g.ctx, level.gain, 1e-6);
    this.pan = new Target(g.ctx, pan.pan, 0.01, false);
    this.nextWave = g.ctx.currentTime + range(g.r, 0.5, 2.5);
    this.built = true;
  }

  /** One wave on the next free chain: a 2.4 s swell, the break, a 3.5 s wash drawing back. */
  private wave(t0: number): void {
    const w = this.waves[this.which];
    this.which = (this.which + 1) % this.waves.length;
    const f = w.lp.frequency;
    f.setValueAtTime(300, t0);
    f.exponentialRampToValueAtTime(1500, t0 + 2.4);
    f.exponentialRampToValueAtTime(450, t0 + 5.9);
    const gn = w.gain.gain;
    gn.setValueAtTime(0, t0);
    gn.linearRampToValueAtTime(1, t0 + 2.4);
    gn.linearRampToValueAtTime(0.25, t0 + 5.9);
    gn.setTargetAtTime(0, t0 + 5.9, 0.8);
    const fo = w.foam.gain;
    fo.setValueAtTime(0, t0 + 2.3);
    fo.linearRampToValueAtTime(this.atSea ? 0.25 : 0.5, t0 + 2.45);
    fo.setTargetAtTime(0, t0 + 2.45, 0.6);
  }

  update(i: OceanInputs): void {
    if (!this.built) {
      if (i.proximity <= 0) return;
      this.build();
    }
    const now = this.g.ctx.currentTime;
    this.atSea = i.atSea;
    this.level!.set(clamp(i.proximity, 0, 1) * TRIM.ocean, this.started ? 1 : FIRST_TAU * 2);
    this.pan!.set(clamp(i.pan, -1, 1), 0.5);
    if (i.proximity > 0) {
      while (this.nextWave < now + 0.5) {
        this.wave(Math.max(this.nextWave, now));
        this.nextWave += i.atSea ? range(this.g.r, 9, 13) : range(this.g.r, 7, 11);
      }
    }
    this.lapLevel = i.atSea ? 0.6 * clamp(i.bob, 0, 1) : 0;
    if (this.lapLevel > 0.02) {
      if (this.nextLap < now) this.nextLap = now + range(this.g.r, 0.1, 0.4);
      while (this.nextLap < now + 0.5) {
        const p = this.lap!.gain;
        p.setValueAtTime(0, this.nextLap);
        p.linearRampToValueAtTime(this.lapLevel, this.nextLap + 0.008);
        p.setTargetAtTime(0, this.nextLap + 0.01, 0.015);
        this.nextLap += range(this.g.r, 0.7, 1.5);
      }
    }
    this.started = true;
  }

  /** enteredOcean: the next wave comes 6 s from now, so it never doubles the one-shot. */
  surge(): void {
    this.nextWave = this.g.ctx.currentTime + 6;
  }
}

// -------------------------------------------------------------------------------------------------
// Flood after a breach (§7.5): built on its first non-zero update
// -------------------------------------------------------------------------------------------------

class Flood {
  private built = false;
  private t: { gain: Target; lp: Target; grit: Target; pan: Target } | null = null;
  private quietSince = -1;
  private sources: AudioBufferSourceNode[] = [];

  constructor(
    private readonly g: Graph,
    private readonly noise: NoiseBank,
    private readonly out: AudioNode,
  ) {}

  /** True once the flood voice has been built (tests). */
  get exists(): boolean {
    return this.built;
  }

  private build(): void {
    const { g, noise } = this;
    const pan = g.panner();
    const sum = g.gain(1, true);
    chain(sum, pan, this.out);
    const lp = g.filter('lowpass', 500, BUTTERWORTH_Q_DB);
    const gain = g.gain(0);
    const body = g.gain(1);
    this.sources = [];
    chain(g.noise(noise.brown, this.sources), g.filter('highpass', SUB_CUT_HZ, BUTTERWORTH_Q_DB), body);
    chain(g.noise(noise.pink, this.sources), body);
    chain(body, lp, gain, sum);
    const grit = g.gain(0);
    chain(g.noise(noise.white, this.sources), g.filter('bandpass', 2000, 1.2), grit, sum);
    this.t = {
      gain: new Target(g.ctx, gain.gain, 1e-6),
      lp: new Target(g.ctx, lp.frequency, 0.5),
      grit: new Target(g.ctx, grit.gain, 1e-6),
      pan: new Target(g.ctx, pan.pan, 0.01, false),
    };
    this.built = true;
  }

  update(i: FloodInputs): void {
    const rush = clamp(i.rush, 0, 1);
    if (!this.built) {
      if (rush <= 0 || i.distGain <= 0) return;
      this.build();
    }
    const t = this.t!;
    const s = rush * Math.max(0, i.distGain) * TRIM.flood;
    t.gain.set(0.12 * s, rush > 0 ? 0.4 : 1);
    t.grit.set(0.03 * s, rush > 0 ? 0.4 : 1);
    t.lp.set(Math.min(500 + 5000 * rush, Math.max(200, i.airLowpassHz)), 0.4);
    t.pan.set(clamp(i.pan, -1, 1), 0.3);
    // Drained: after 4 s of silence the loops stop (a later breach builds the voice again).
    const now = this.g.ctx.currentTime;
    if (rush > 0) this.quietSince = -1;
    else if (this.quietSince < 0) this.quietSince = now;
    else if (now - this.quietSince > 4) {
      for (const s of this.sources) s.stop(now + 0.05);
      this.built = false;
      this.t = null;
      this.quietSince = -1;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Machines that stop (§7.8, P1): four slots
// -------------------------------------------------------------------------------------------------

class EmitterSlot {
  private kind: EmitterKind | null = null;
  private src: AudioBufferSourceNode | null = null;
  private t: { gain: Target; lp: Target; pan: Target } | null = null;
  private stopped = false;

  constructor(
    private readonly g: Graph,
    private readonly bank: SoundBank,
    private readonly out: AudioNode,
  ) {}

  private build(kind: EmitterKind): boolean {
    const buf = this.bank.buffer(EMITTER_LOOP[kind], 0);
    if (!buf) return false;
    const { g } = this;
    const pan = g.panner();
    const gain = g.gain(0, true);
    const lp = g.filter('lowpass', 8000, BUTTERWORTH_Q_DB);
    this.src = g.loop(buf, 1);
    chain(this.src, lp, gain, pan, this.out);
    this.t = { gain: new Target(g.ctx, gain.gain, 1e-6), lp: new Target(g.ctx, lp.frequency, 0.5), pan: new Target(g.ctx, pan.pan, 0.01, false) };
    this.kind = kind;
    return true;
  }

  update(i: EmitterSlotInputs): void {
    if (this.stopped) return;
    if (!this.src) {
      if (!i.kind || !i.running || i.distGain <= 0 || !this.build(i.kind)) return;
    }
    const t = this.t!;
    if (!i.running) {
      // The machine has gone: its loop runs down and never restarts in this attempt. A turbine's
      // blades slow over 4 s; the others stop within 0.15 s.
      const now = this.g.ctx.currentTime;
      if (this.kind === 'turbine') {
        this.src!.playbackRate.setTargetAtTime(0.3, now, 1.3);
        t.gain.set(0, 1.3);
        this.src!.stop(now + 4.5);
      } else {
        t.gain.set(0, 0.05);
        this.src!.stop(now + 0.3);
      }
      this.stopped = true;
      return;
    }
    t.gain.set(0.05 * Math.max(0, i.distGain), 0.3);
    t.lp.set(Math.min(16000, Math.max(200, i.airLowpassHz)), 0.3);
    t.pan.set(clamp(i.pan, -1, 1), 0.2);
  }
}

// -------------------------------------------------------------------------------------------------

class Voices implements AmbienceVoices {
  readonly wind: Wind;
  readonly scrape: Scrape;
  readonly water: Water;
  readonly falls: FallSlot[];
  readonly ocean: Ocean;
  readonly flood: Flood;
  readonly emitters: EmitterSlot[];
  private stopped = false;

  constructor(
    private readonly g: Graph,
    out: AmbienceOutputs,
    noise: NoiseBank,
    bank: SoundBank,
    timbre: AmbienceTimbre,
  ) {
    this.wind = new Wind(g, noise, out.ambience, timbre.wind);
    this.scrape = new Scrape(g, noise, bank, out.effects);
    this.water = new Water(g, noise, out.ambience);
    this.water.setTopDb(timbre.waterTopDb);
    this.falls = [0, 1, 2].map(() => new FallSlot(g, noise, out.ambience));
    this.ocean = new Ocean(g, noise, out.ambience);
    this.flood = new Flood(g, noise, out.ambience);
    this.emitters = [0, 1, 2, 3].map(() => new EmitterSlot(g, bank, out.ambience));
    // Updates after stop() must do nothing: every voice is fronted by this guard.
    const guard = <T extends object>(v: T, method: keyof T): void => {
      const f = v[method] as unknown as (x: unknown) => void;
      (v as Record<keyof T, unknown>)[method] = (x: unknown) => {
        if (!this.stopped) f.call(v, x);
      };
    };
    for (const v of [this.wind, this.scrape, this.water, this.ocean, this.flood, ...this.falls, ...this.emitters]) guard(v, 'update');
    guard(this.ocean, 'surge');
  }

  setTimbre(t: AmbienceTimbre): void {
    if (this.stopped) return;
    this.wind.setCharacter(t.wind);
    this.water.setTopDb(t.waterTopDb);
  }

  stop(fadeSec: number): void {
    if (this.stopped) return;
    this.stopped = true;
    const { ctx } = this.g;
    const now = ctx.currentTime;
    const fade = Math.max(0.005, fadeSec);
    for (const o of this.g.outs) o.gain.setTargetAtTime(0, now, fade / 4);
    const live = this.g.sources.length;
    let ended = 0;
    const disconnectAll = (): void => {
      for (const n of this.g.nodes) n.disconnect();
    };
    if (live === 0) {
      disconnectAll();
      return;
    }
    for (const s of this.g.sources) {
      s.onended = () => {
        ended++;
        if (ended === live) disconnectAll();
      };
      try {
        s.stop(now + fade + 0.05);
      } catch {
        // Already stopped (a drained flood, a machine that ran down): it has ended or will.
      }
    }
  }
}

/** Default colour until setTimbre: Act I's warm wind, untouched water. */
const DEFAULT_TIMBRE: AmbienceTimbre = {
  wind: { bandHz: 380, q: 0.7, gustDb: 4, gustSec: 2.8, troughs: false },
  waterTopDb: 0,
};

export const createAmbienceVoices: AmbienceVoiceFactory = (ctx, out, noise, bank, seed) =>
  new Voices(new Graph(ctx, seededRng(bakeSeed(seed, 'ambience', 0))), out, noise, bank, DEFAULT_TIMBRE);
