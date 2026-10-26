/**
 * The offline lab (contract AudioLab, DESIGN §11.2), development and ?audiodebug=1 only, loaded as
 * its own chunk by window.__icebergAudio.lab(). It builds the same graph the game plays through (the
 * strips, shelf, space, limiter and makeup) on an OfflineAudioContext, plays bank buffers or a
 * recorded trace through it, and measures the result.
 *
 *   fire(id, opts)    one sound now, live, through the real graph (traced as 'injected')
 *   render(id, v, g)  one sound offline, sliders at 1, no jitter
 *   burst(spec)       a seeded storm of collisions, breaks and splashes through the real voice pool
 *                     and limits, one admission round per 1/60 s frame
 *   renderMix(trace)  the 'play' entries of a trace replayed at their times; reports the limiter's
 *                     gain reduction from a second, unlimited copy of the pre-master signal
 *   variation(on)     jitter and shuffled variants on or off (live and offline)
 *
 * Extras beyond the contract's AudioLab (EngineLab, used by scripts/audio-e2e.mjs R4-R10):
 *   renderMotif(m, o)    a baked motif through motifBus at music 1 (with or without the calibration,
 *                        and at a moment's trim, gainDb, through the same per-motif gain as playMotif)
 *   recording(url)       one of the six recordings decoded and measured as the player hears it at
 *                        el.volume 1 (two channels; a mono file counts twice, as it plays on both)
 *   sine(o)              a sine into preMaster (R4: the limiter's makeup) or a full-scale burst
 *   renderAt(id, o)      one sound through the graph at a given distance and slider levels (R2, R5,
 *                        R6), optionally high-passed at 150 Hz (laptop speakers)
 *
 * Pre-roll: Chrome's DynamicsCompressorNode starts a context fully compressed and takes ~100 ms to
 * open (measured offline: -15.6 dB in the first 10 ms, -3.3 dB to 50 ms, -0.4 dB to 100 ms, 0 after),
 * so every offline render starts its sounds LAB_PREROLL_SEC in and measures from there. The live
 * game never meets this: its limiter is built at unlock, long before the first sound.
 *
 * Measurement: the debug API passes package B's analysis.ts (renderStats: sample and 4x true peak,
 * RMS, BS.1770 loudness, the spectral centroid, band energy). Without it (createLab(m) alone) the
 * basic analyser below computes peak, an approximate true peak (linear interpolation, a lower
 * bound), RMS, DC, clipped samples and duration, and leaves the loudness fields NaN, not a guess.
 */
import {
  BELL_PATTERN,
  BELL_VOICINGS,
  GLOBAL_LIMITS,
  SEED,
  SOUND_DEFS,
  SOUND_IDS,
  SPACE,
  SPATIAL,
  type AudioLab,
  type AudioLevels,
  type BellVoicingId,
  type BurstSpec,
  type MixStats,
  type MotifRequest,
  type RenderStats,
  type SoundId,
  type SoundRequest,
  type TraceEntry,
} from './contract';
import { dbToGain } from './ducks';
import { AudioGraph } from './engine/graph';
import { createPlayDetail, EffectVoices, VoiceSession } from './engine/voicePool';
import type { EngineAudioManager } from './manager';
import { streamRng } from './rng';
import { airLowpassHz, createListenerPose, distanceGain } from './spatial';

export const LAB_RATE = 48000;
/** Offline sounds start this far in, past the limiter's start-up (see the header). */
export const LAB_PREROLL_SEC = 0.5;
/** A context time on a render-quantum boundary at or after t (offline suspends are quantised). */
const quantum = (t: number): number => Math.ceil((t * LAB_RATE) / 128) * (128 / LAB_RATE);
const FULL_LEVELS = { master: 1, music: 1, ambience: 1, effects: 1, musicMuted: false, soundMuted: false } as const;

/** Package B's analyser, or the basic one below (stereo, in the lab's sample rate). */
export type Analyze = (channels: readonly Float32Array[], sampleRate: number) => RenderStats;

/** Package B's integrated loudness alone (long recordings: renderStats would also take their spectrum). */
export type LoudnessOf = (channels: readonly Float32Array[], sampleRate: number) => { integrated: number; momentaryMax: number };

/** What a recording measures as the player hears it at el.volume 1. */
export interface RecordingStats {
  readonly url: string;
  readonly channels: number;
  readonly sampleRate: number;
  readonly durationSec: number;
  readonly peakDb: number;
  readonly lufsI: number;
  readonly lufsMMax: number;
}

/** The contract's lab plus the measurements the browser checks R4-R10 need. */
export interface EngineLab extends AudioLab {
  renderMotif(m: MotifRequest, o?: { calibrated?: boolean; music?: number; gainDb?: number }): Promise<RenderStats>;
  recording(url: string): Promise<RecordingStats>;
  /**
   * A sine into preMaster at dbfs (R4), or with burst a noise burst (sample peak at dbfs), band-limited
   * at bandHz if given; with the steady part (from 0.1 s) apart.
   */
  sine(o: { dbfs: number; hz?: number; seconds?: number; burst?: boolean; bandHz?: number }): Promise<RenderStats & { steady: RenderStats }>;
  /** One sound through the graph: at distM (positional gain and air), with these levels and pause gate. */
  renderAt(id: SoundId, o: { gainDb: number; distM?: number; levels?: Partial<AudioLevels>; gateAtSec?: number; highpass150?: boolean; rate?: number; lowpassHz?: number }): Promise<RenderStats & { gateDbAt?: number }>;
  /** A bell strike through the ambience channel at distM. */
  renderBell(voicing: BellVoicingId, o: { distM: number; highpass150?: boolean; levels?: Partial<AudioLevels> }): Promise<RenderStats>;
}

export function basicStats(channels: readonly Float32Array[], sampleRate: number): RenderStats {
  let peak = 0;
  let truePeak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      if (ax >= 1) clipped++;
      sumSq += x * x;
      sum += x;
      if (i > 0) {
        const p = ch[i - 1];
        for (let k = 1; k < 4; k++) truePeak = Math.max(truePeak, Math.abs(p + ((x - p) * k) / 4));
      }
    }
    n += ch.length;
  }
  const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  return {
    peakDb: db(peak),
    truePeakDb: db(Math.max(peak, truePeak)),
    rmsDb: db(n > 0 ? Math.sqrt(sumSq / n) : 0),
    lufsI: Number.NaN,
    lufsMMax: Number.NaN,
    clippedSamples: clipped,
    dcOffset: n > 0 ? sum / n : 0,
    centroidHz: Number.NaN,
    below150: Number.NaN,
    below40: Number.NaN,
    durationSec: channels.length > 0 ? channels[0].length / sampleRate : 0,
  };
}

interface OfflineRig {
  readonly ctx: OfflineAudioContext;
  readonly graph: AudioGraph;
  readonly fx: EffectVoices;
  /** Channels 2-3 carry the pre-master sum (unlimited), when the rig was built with `pre`. */
  readonly pre: boolean;
}

function offline(m: EngineAudioManager, seconds: number, pre: boolean, variation: boolean, motifCalibDb: number | undefined = m.motifCalibDb): OfflineRig {
  const channels = pre ? 4 : 2;
  const ctx = new OfflineAudioContext(channels, Math.max(1, Math.ceil(seconds * LAB_RATE)), LAB_RATE);
  const ir = m.synthesis.generateSpaceIR?.(LAB_RATE, SPACE.irSeconds, m.seed) ?? null;
  let destination: AudioNode = ctx.destination;
  let merger: ChannelMergerNode | null = null;
  if (pre) {
    merger = ctx.createChannelMerger(4);
    merger.connect(ctx.destination);
    const out = ctx.createChannelSplitter(2);
    out.connect(merger, 0, 0);
    out.connect(merger, 1, 1);
    destination = out;
  }
  const graph = new AudioGraph(ctx, { spaceIR: ir, meters: false, destination, makeupDb: m.makeupDb, motifCalibDb });
  if (merger !== null) {
    const split = ctx.createChannelSplitter(2);
    graph.preMaster.connect(split);
    split.connect(merger, 0, 2);
    split.connect(merger, 1, 3);
  }
  graph.applyLevels(FULL_LEVELS, 0, 0, 0, 0);
  const bank = m.bank();
  const fx = new EffectVoices(ctx, graph.effectsIn, graph.fxSendIn, () => bank);
  fx.variation = variation;
  return { ctx, graph, fx, pre };
}

/** Channels from..from+count of a render, without the pre-roll. */
const channelsOf = (b: AudioBuffer, from: number, count: number): Float32Array[] =>
  Array.from({ length: count }, (_, i) => b.getChannelData(from + i).subarray(Math.round(LAB_PREROLL_SEC * LAB_RATE)));

/** One admission round per frame: `each(frame)` every 1/60 s for `seconds`, after the pre-roll. */
function frames(ctx: OfflineAudioContext, seconds: number, each: (frame: number) => void): void {
  const n = Math.floor(seconds * 60);
  let last = -1;
  for (let f = 0; f < n; f++) {
    const t = quantum(LAB_PREROLL_SEC + f / 60);
    if (t <= last) continue; // one suspend per quantum
    last = t;
    ctx.suspend(t).then(() => {
      each(f);
      return ctx.resume();
    });
  }
}

function hitRequest(sound: SoundId, gainDb: number, key: number, positional: boolean): SoundRequest {
  const def = SOUND_DEFS[sound];
  const layers = Array.from({ length: GLOBAL_LIMITS.maxLayers }, () => ({
    sound,
    variant: -1,
    gainDb,
    rate: 1,
    lowpassHz: 16000,
    delaySec: 0,
    optional: false,
  }));
  return { family: def.family, priority: def.priority, layerCount: 1, layers, positional, x: 0, y: 0, z: -20, key, cause: -1, startDelaySec: 0 };
}

/**
 * Channels through a 4th-order Butterworth: high-pass at 150 Hz is how laptop speakers roll off (R2,
 * R6); low-pass at 16 kHz is where every effect strip's low-pass stops (R4's band-limited burst).
 */
async function butter4(channels: readonly Float32Array[], rate: number, type: 'highpass' | 'lowpass', hz: number): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(channels.length, channels[0].length, rate);
  const buf = ctx.createBuffer(channels.length, channels[0].length, rate);
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const a = ctx.createBiquadFilter();
  const b = ctx.createBiquadFilter();
  for (const f of [a, b]) {
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = f === a ? 0.5412 : 1.3066;
  }
  src.connect(a).connect(b).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, i) => out.getChannelData(i));
}

/**
 * The limiter's look-ahead in samples: a -20 dBFS click into preMaster (well under the threshold, so
 * no reduction), and the distance from its peak before the limiter to its peak after. Chrome's
 * DynamicsCompressorNode delays its output by a fixed pre-delay, so the limited signal must be compared
 * with the pre-master signal that many samples earlier.
 */
export async function limiterLatency(m: EngineAudioManager): Promise<number> {
  const rig = offline(m, LAB_PREROLL_SEC + 0.25, true, false);
  const click = rig.ctx.createBuffer(1, 1, LAB_RATE);
  click.getChannelData(0)[0] = 0.1;
  const src = rig.ctx.createBufferSource();
  src.buffer = click;
  src.connect(rig.graph.preMaster);
  src.start(LAB_PREROLL_SEC + 0.05);
  const out = await rig.ctx.startRendering();
  const argmax = (c: Float32Array): number => {
    let at = 0;
    for (let i = 1; i < c.length; i++) if (Math.abs(c[i]) > Math.abs(c[at])) at = i;
    return at;
  };
  return Math.max(0, argmax(channelsOf(out, 0, 1)[0]) - argmax(channelsOf(out, 2, 1)[0]));
}

export function createLab(m: EngineAudioManager, analyze: Analyze = basicStats, loudnessOf: LoudnessOf | null = null): EngineLab {
  let variation = true;
  let latency: number | null = null;
  const levelsFull = (o?: Partial<AudioLevels>): AudioLevels => ({ ...FULL_LEVELS, ...(o ?? {}) });
  return {
    async renderMotif(motif: MotifRequest, o: { calibrated?: boolean; music?: number; gainDb?: number } = {}): Promise<RenderStats> {
      const buffer = m.bank()?.motif(motif) ?? null;
      if (buffer === null) throw new Error(`lab.renderMotif: ${motif.variant}@${motif.tempoScale} is not baked`);
      const rig = offline(m, LAB_PREROLL_SEC + buffer.duration + 0.5, false, false, o.calibrated === false ? 0 : m.motifCalibDb);
      rig.graph.applyLevels(levelsFull({ music: o.music ?? 1 }), 0, 0, 0, 0);
      const src = rig.ctx.createBufferSource();
      src.buffer = buffer;
      // The moment's trim, on its own gain node as playMotif does (<= 0 dB).
      const trim = rig.ctx.createGain();
      trim.gain.value = dbToGain(Math.min(0, o.gainDb ?? 0));
      src.connect(trim);
      trim.connect(rig.graph.motifBus);
      src.start(LAB_PREROLL_SEC);
      const out = await rig.ctx.startRendering();
      return analyze(channelsOf(out, 0, 2), LAB_RATE);
    },

    async recording(url: string): Promise<RecordingStats> {
      const bytes = await (await fetch(url)).arrayBuffer();
      const ctx = new OfflineAudioContext(2, 1, LAB_RATE);
      const buf = await ctx.decodeAudioData(bytes);
      const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      // A mono file is played on both speakers: measure it as two channels.
      const heard = chans.length === 1 ? [chans[0], chans[0]] : chans.slice(0, 2);
      let peak = 0;
      for (const c of heard) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
      const l = loudnessOf ? loudnessOf(heard, buf.sampleRate) : { integrated: Number.NaN, momentaryMax: Number.NaN };
      return {
        url,
        channels: buf.numberOfChannels,
        sampleRate: buf.sampleRate,
        durationSec: buf.duration,
        peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
        lufsI: l.integrated,
        lufsMMax: l.momentaryMax,
      };
    },

    async sine(o: { dbfs: number; hz?: number; seconds?: number; burst?: boolean; bandHz?: number }): Promise<RenderStats & { steady: RenderStats }> {
      const seconds = o.seconds ?? 2;
      const rig = offline(m, LAB_PREROLL_SEC + seconds + 0.2, false, false);
      const n = Math.ceil(seconds * LAB_RATE);
      const buf = rig.ctx.createBuffer(1, n, LAB_RATE);
      const d = buf.getChannelData(0);
      const amp = Math.pow(10, o.dbfs / 20);
      const rng = streamRng('lab-sine', 0, 'sfx', m.seed);
      for (let i = 0; i < n; i++) d[i] = o.burst ? rng() * 2 - 1 : amp * Math.sin((2 * Math.PI * (o.hz ?? 1000) * i) / LAB_RATE);
      if (o.burst) {
        // White noise carries energy up to Nyquist and so intersample peaks about 3.5 dB over its
        // sample peak; band-limited like the game's one-shots (every effect strip's low-pass stops at
        // 16 kHz; the ambience beds are low-passed pink and brown noise), it does not. Either way the
        // burst's sample peak is set to dbfs.
        const x = o.bandHz !== undefined ? (await butter4([d], LAB_RATE, 'lowpass', o.bandHz))[0] : d;
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
        for (let i = 0; i < n; i++) d[i] = (x[i] / Math.max(1e-12, peak)) * amp;
      }
      const src = rig.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(rig.graph.preMaster);
      src.start(LAB_PREROLL_SEC);
      const out = await rig.ctx.startRendering();
      const all = channelsOf(out, 0, 2);
      // The whole render, and the steady part from 0.1 s on (past the limiter's attack at the onset).
      const steady = all.map((c) => c.subarray(Math.round(0.1 * LAB_RATE)));
      return { ...analyze(all, LAB_RATE), steady: analyze(steady, LAB_RATE) };
    },

    async renderAt(id: SoundId, o: { gainDb: number; distM?: number; levels?: Partial<AudioLevels>; gateAtSec?: number; highpass150?: boolean; rate?: number; lowpassHz?: number }) {
      const dist = o.distM ?? 0;
      const tail = SOUND_DEFS[id].seconds + 0.5;
      const rig = offline(m, LAB_PREROLL_SEC + tail, false, false);
      const levels = levelsFull(o.levels);
      rig.graph.applyLevels(levels, 0, 0, 0, 0);
      if (o.gateAtSec !== undefined) {
        rig.ctx.suspend(quantum(LAB_PREROLL_SEC + o.gateAtSec)).then(() => {
          rig.graph.setGate(false, rig.ctx.currentTime);
          return rig.ctx.resume();
        });
      }
      const buffer = m.bank()?.buffer(id, 0) ?? null;
      if (buffer === null) throw new Error(`lab.renderAt: ${id} not baked`);
      const v = rig.fx.playRaw(buffer, {
        token: 0,
        family: SOUND_DEFS[id].family,
        priority: SOUND_DEFS[id].priority,
        sound: id,
        when: LAB_PREROLL_SEC,
        gain: dbToGain(o.gainDb) * (dist > 0 ? distanceGain(dist, SPATIAL.effects) : 1),
        lowpassHz: Math.min(o.lowpassHz ?? 16000, dist > 0 ? airLowpassHz(dist, SPATIAL.effects.refM) : 16000),
        pan: 0,
        send: 0.1,
        rate: o.rate ?? 1,
      });
      if (v === null) throw new Error(`lab.renderAt: ${id} not played`);
      const out = await rig.ctx.startRendering();
      let chans = channelsOf(out, 0, 2);
      if (o.highpass150) chans = await butter4(chans, LAB_RATE, 'highpass', 150);
      const stats = analyze(chans, LAB_RATE);
      if (o.gateAtSec === undefined) return stats;
      // The level 0.25 s after the gate closed, against the 50 ms before it (R5: -60 dB within 0.25 s).
      const at = Math.round((o.gateAtSec + 0.25) * LAB_RATE);
      const before = Math.round((o.gateAtSec - 0.05) * LAB_RATE);
      const rms = (c: Float32Array, a: number, b: number): number => {
        let s2 = 0;
        for (let i = a; i < b; i++) s2 += c[i] * c[i];
        return Math.sqrt(s2 / Math.max(1, b - a));
      };
      const w = Math.round(0.02 * LAB_RATE);
      const after = rms(chans[0], at, at + w);
      const ref = rms(chans[0], before, before + Math.round(0.05 * LAB_RATE));
      return { ...stats, gateDbAt: 20 * Math.log10(Math.max(1e-12, after) / Math.max(1e-12, ref)) };
    },

    async renderBell(voicing: BellVoicingId, o: { distM: number; highpass150?: boolean; levels?: Partial<AudioLevels> }): Promise<RenderStats> {
      const buffer = m.bank()?.bell(voicing, 'strike') ?? null;
      if (buffer === null) throw new Error(`lab.renderBell: ${voicing} strike not baked`);
      const rig = offline(m, LAB_PREROLL_SEC + buffer.duration + 0.5, false, false);
      if (o.levels) rig.graph.applyLevels(levelsFull(o.levels), 0, 0, 0, 0);
      const g = rig.ctx.createGain();
      g.gain.value = dbToGain(BELL_PATTERN.strikeDbAt40m + BELL_VOICINGS[voicing].trimDb) * distanceGain(o.distM, SPATIAL.bells);
      const lp = rig.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = airLowpassHz(o.distM, SPATIAL.bells.refM);
      const src = rig.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(lp).connect(g).connect(rig.graph.ambienceIn);
      src.start(LAB_PREROLL_SEC);
      const out = await rig.ctx.startRendering();
      let chans = channelsOf(out, 0, 2);
      if (o.highpass150) chans = await butter4(chans, LAB_RATE, 'highpass', 150);
      return analyze(chans, LAB_RATE);
    },

    fire(id, opts): void {
      m.fire(id, opts);
    },

    variation(on: boolean): void {
      variation = on;
      m.setVariation(on);
    },

    async render(id: SoundId, variant: number, gainDb: number): Promise<RenderStats> {
      const rig = offline(m, LAB_PREROLL_SEC + SOUND_DEFS[id].seconds + 0.5, false, false);
      const s = new VoiceSession(0, streamRng('lab', 0, 'sfx', m.seed), createListenerPose());
      s.frame.begin(0);
      const req = hitRequest(id, gainDb, -1, false);
      req.layers[0].variant = variant;
      req.startDelaySec = LAB_PREROLL_SEC;
      const r = rig.fx.play(req, s, createPlayDetail());
      if (r.started === 0) throw new Error(`lab.render: ${id} not played (${r.reason})`);
      const out = await rig.ctx.startRendering();
      return analyze(channelsOf(out, 0, 2), LAB_RATE);
    },

    async burst(spec: BurstSpec): Promise<RenderStats> {
      const seconds = Math.max(0.1, spec.seconds);
      const rig = offline(m, LAB_PREROLL_SEC + seconds + 5, false, variation);
      const rng = streamRng('lab-burst', 0, 'sfx', SEED);
      const s = new VoiceSession(0, streamRng('lab-burst', 0, 'sfx', m.seed), createListenerPose());
      const detail = createPlayDetail();
      const nFrames = Math.floor(seconds * 60);
      const per = (total: number): number => total / Math.max(1, nFrames);
      const owed = { c: 0, b: 0, s: 0 };
      const hits: SoundId[] = ['hit.stone.light', 'hit.stone.heavy', 'hit.wood', 'hit.ice'];
      const breaks: SoundId[] = ['house.collapse', 'tree.fall.pine', 'masonry.collapse.large', 'metal.break.structure'];
      const splashes: SoundId[] = ['splash.small', 'splash.medium', 'splash.large'];
      let maxVoices = 0;
      let key = 0;
      frames(rig.ctx, seconds, (f) => {
        s.frame.begin(f);
        owed.c += per(spec.collisions);
        owed.b += per(spec.breaks);
        owed.s += per(spec.splashes);
        const batch: SoundRequest[] = [];
        for (; owed.b >= 1; owed.b--) batch.push(hitRequest(breaks[Math.floor(rng() * breaks.length)], -14 + rng() * 5, key++, true));
        for (; owed.s >= 1; owed.s--) batch.push(hitRequest(splashes[Math.floor(rng() * splashes.length)], -34 + rng() * 18, -1, true));
        for (; owed.c >= 1; owed.c--) batch.push(hitRequest(hits[Math.floor(rng() * hits.length)], -35 + rng() * 22, key++, true));
        // As the router does: most important first.
        batch.sort((a, b) => a.priority - b.priority || b.layers[0].gainDb - a.layers[0].gainDb);
        for (const req of batch) rig.fx.play(req, s, detail);
        maxVoices = Math.max(maxVoices, rig.fx.active(rig.ctx.currentTime));
      });
      const out = await rig.ctx.startRendering();
      const stats = analyze(channelsOf(out, 0, 2), LAB_RATE);
      return { ...stats, maxVoices } as RenderStats;
    },

    async renderMix(trace: readonly TraceEntry[]): Promise<MixStats> {
      const plays = trace.filter((e) => e.kind === 'play' && e.sound !== undefined && (SOUND_IDS as readonly string[]).includes(e.sound));
      if (plays.length === 0) throw new Error('lab.renderMix: no play entries');
      const t0 = Math.min(...plays.map((e) => e.t));
      const end = Math.max(...plays.map((e) => e.t - t0 + SOUND_DEFS[e.sound!].seconds));
      const rig = offline(m, LAB_PREROLL_SEC + end + 1, true, false);
      const bank = m.bank();
      let maxVoices = 0;
      const byTime = [...plays].sort((a, b) => a.t - b.t);
      const startAll = (from: number, to: number): void => {
        for (const e of byTime) {
          const rel = e.t - t0;
          if (rel < from || rel >= to) continue;
          const at = LAB_PREROLL_SEC + rel;
          const buf = bank?.buffer(e.sound!, Math.max(0, e.variant ?? 0)) ?? null;
          if (buf === null) continue;
          rig.fx.playRaw(buf, {
            token: 0,
            family: e.family ?? 'hit',
            priority: e.priority ?? 3,
            sound: e.sound!,
            when: at,
            gain: dbToGain(e.gainDb ?? -30),
            lowpassHz: e.lowpassHz ?? 16000,
            pan: e.pan ?? 0,
            send: 0.1,
            rate: e.rate ?? 1,
          });
        }
        maxVoices = Math.max(maxVoices, rig.fx.active(rig.ctx.currentTime));
      };
      // Schedule in 0.25 s windows (just before each window) so the pool's caps see what overlaps.
      const step = 0.25;
      for (let t = 0; t < end; t += step) {
        const from = t;
        rig.ctx.suspend(quantum(Math.max(0, LAB_PREROLL_SEC + from - 0.01))).then(() => {
          startAll(from, from + step);
          return rig.ctx.resume();
        });
      }
      const out = await rig.ctx.startRendering();
      const post = channelsOf(out, 0, 2);
      const pre = channelsOf(out, 2, 2);
      const stats = analyze(post, LAB_RATE);
      latency ??= await limiterLatency(m);
      const red = limiterReduction(pre, post, dbToGain(m.makeupDb ?? -1.71), latency);
      return { ...stats, limiterMaxReductionDb: red.max, limiterP99ReductionDb: red.p99, maxVoices, limiterLatencySamples: latency };
    },
  };
}

/**
 * Gain reduction per 20 ms block: the limited output's peak against the pre-master peak times the
 * makeup compensation, the output read `latency` samples later (the limiter's look-ahead, measured by
 * limiterLatency). Without that shift a block that ends on an onset compares the onset before the
 * limiter with the silence before it after the limiter: the first R11 run read reductions of 145-159
 * dB that way. Blocks quieter than -40 dBFS before the limiter are ignored. Reduction is reported as a
 * positive number of dB.
 */
export function limiterReduction(pre: readonly Float32Array[], post: readonly Float32Array[], makeup: number, latency = 0): { max: number; p99: number } {
  const block = Math.round(0.02 * LAB_RATE);
  const out: number[] = [];
  const n = Math.min(pre[0].length, post[0].length - latency);
  for (let i = 0; i + block <= n; i += block) {
    let a = 0;
    let b = 0;
    for (let c = 0; c < pre.length; c++) {
      for (let k = i; k < i + block; k++) {
        a = Math.max(a, Math.abs(pre[c][k]));
        b = Math.max(b, Math.abs(post[c][k + latency]));
      }
    }
    if (a < 0.01) continue;
    out.push(Math.max(0, 20 * Math.log10((a * makeup) / Math.max(1e-9, b))));
  }
  if (out.length === 0) return { max: 0, p99: 0 };
  out.sort((x, y) => x - y);
  return { max: out[out.length - 1], p99: out[Math.min(out.length - 1, Math.floor(0.99 * out.length))] };
}
