/**
 * The bus graph (DESIGN §2.2), built once per AudioContext (live or offline):
 *
 *   effect strips ─► effectsIn ─► effectsShelf (highshelf 6 kHz) ─► effectsGain ───┐
 *         └ sends ─► fxSendIn ─► fxSendGain ──┐                                    │
 *   ambience voices, bell strips ─► ambienceIn ─► ambienceGain ────────────────────┼─► gate ─┐
 *         └ sends ─► ambSendIn ─► ambSendGain ┤                                    │         │
 *                                             └► spaceIn ─► convolver (IR with 15 ms predelay) ─► spaceReturn (-6 dB)
 *   motif sources ─► motifBus ─► motifGain ──────────────────────────────────────────────────┤
 *                                                                                            ▼
 *   preMaster ─► limiter (-3 dB, 20:1, knee 0, 1 ms / 120 ms) ─► makeupComp ─► master ─► hiddenGate ─► out
 *
 * One change from the design's diagram: the space sends are taken through their channel's own gain
 * (fxSendGain mirrors effectsGain, ambSendGain mirrors ambienceGain) and the space return goes through
 * the pause gate. Otherwise the reverb would ignore the Effects and Ambience sliders and their ducks,
 * Ambience 0 would still let bell reverb through, and a long collapse would go on feeding audible
 * reverb while the game is paused.
 *
 *   effectsGain = effects × duck.effects     ambienceGain = ambience × duck.ambience
 *   motifGain   = music × !musicMuted × motifCalib (the motif is the music channel's in-graph voice)
 *   master      = masterVolume × !soundMuted       hiddenGate = 0 while the tab is hidden
 *
 * Every gain is moved with short linear ramps from a JS model of its current value (RampedGain), so
 * a target is reached exactly (setTargetAtTime never quite gets there) and the value is always known.
 */
import { EFFECTS_SHELF_HZ, LIMITER, SPACE, type AudioLevels } from '../contract';
import { dbToGain } from '../ducks';

/** A GainNode whose ramps are modelled in JS: valueAt(now) is what the param is doing. */
export class RampedGain {
  readonly node: GainNode;
  private from: number;
  private to: number;
  private t0 = 0;
  private t1 = 0;

  constructor(ctx: BaseAudioContext, initial: number) {
    this.node = ctx.createGain();
    this.node.gain.value = initial;
    this.from = initial;
    this.to = initial;
  }

  get target(): number {
    return this.to;
  }

  valueAt(now: number): number {
    if (now >= this.t1 || this.t1 <= this.t0) return this.to;
    if (now <= this.t0) return this.from;
    return this.from + (this.to - this.from) * ((now - this.t0) / (this.t1 - this.t0));
  }

  /** Linear ramp from the current value to target over sec (0 = at once). No-op if already headed there. */
  rampTo(target: number, now: number, sec: number): void {
    const v = Number.isFinite(target) ? Math.max(0, target) : 0;
    if (v === this.to) return;
    const cur = this.valueAt(now);
    const p = this.node.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
    if (sec > 0) p.linearRampToValueAtTime(v, now + sec);
    else p.setValueAtTime(v, now);
    this.from = cur;
    this.to = v;
    this.t0 = now;
    this.t1 = now + Math.max(0, sec);
  }
}

export interface GraphOptions {
  /** Stereo impulse response for the shared space (package B's generateSpaceIR); null = no space. */
  readonly spaceIR: readonly [Float32Array, Float32Array] | null;
  /** AnalyserNode taps for window.__icebergAudio.meter(). */
  readonly meters: boolean;
  /** Final output (default: ctx.destination). */
  readonly destination?: AudioNode;
  /** Gain after the limiter cancelling its built-in makeup (dB). */
  readonly makeupDb?: number;
  /** motifGain calibration (dB): the motif's loudness against the recordings (R10). */
  readonly motifCalibDb?: number;
}

export type MeterBus = 'master' | 'music' | 'ambience' | 'effects';

/** How fast settings and duck steps move the channel gains (s). */
export const LEVEL_RAMP_SEC = 0.03;
/** Pause gate: closed in 120 ms, opened over 250 ms (DESIGN §4). */
export const GATE_CLOSE_SEC = 0.12;
export const GATE_OPEN_SEC = 0.25;
/** Hidden tab: master gate down before the context is suspended, and back up after resume. */
export const HIDE_SEC = 0.03;
export const SHOW_SEC = 0.15;

export class AudioGraph {
  readonly effectsIn: GainNode;
  readonly ambienceIn: GainNode;
  readonly fxSendIn: GainNode;
  readonly ambSendIn: GainNode;
  readonly motifBus: GainNode;
  readonly preMaster: GainNode;
  readonly effectsShelf: BiquadFilterNode;
  readonly effectsGain: RampedGain;
  readonly ambienceGain: RampedGain;
  readonly fxSendGain: RampedGain;
  readonly ambSendGain: RampedGain;
  readonly gate: RampedGain;
  readonly motifGain: RampedGain;
  readonly master: RampedGain;
  readonly hiddenGate: RampedGain;
  readonly spaceIn: GainNode;
  readonly convolver: ConvolverNode;
  /** The shared space's return (SPACE.returnDb); closed while no attempt is live (setSpaceOpen). */
  readonly spaceReturn: GainNode;
  private readonly spaceReturnGain: RampedGain;
  readonly limiter: DynamicsCompressorNode;
  readonly makeup: GainNode;
  readonly meters: Readonly<Record<MeterBus, AnalyserNode>> | null;
  private readonly motifCalib: number;
  private readonly nodes: AudioNode[] = [];

  constructor(
    readonly ctx: BaseAudioContext,
    options: GraphOptions,
  ) {
    const gain = (v = 1): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      this.nodes.push(g);
      return g;
    };
    const ramped = (v: number): RampedGain => {
      const r = new RampedGain(ctx, v);
      this.nodes.push(r.node);
      return r;
    };
    this.motifCalib = dbToGain(options.motifCalibDb ?? 0);

    this.effectsIn = gain();
    this.ambienceIn = gain();
    this.fxSendIn = gain();
    this.ambSendIn = gain();
    this.motifBus = gain();
    this.preMaster = gain();
    this.spaceIn = gain();
    this.spaceReturnGain = ramped(dbToGain(SPACE.returnDb));
    this.spaceReturn = this.spaceReturnGain.node;

    this.effectsShelf = ctx.createBiquadFilter();
    this.effectsShelf.type = 'highshelf';
    this.effectsShelf.frequency.value = EFFECTS_SHELF_HZ;
    this.effectsShelf.gain.value = 0;
    this.nodes.push(this.effectsShelf);

    this.effectsGain = ramped(0);
    this.ambienceGain = ramped(0);
    this.fxSendGain = ramped(0);
    this.ambSendGain = ramped(0);
    this.gate = ramped(1);
    this.motifGain = ramped(0);
    this.master = ramped(0);
    this.hiddenGate = ramped(1);

    // The IR carries the predelay as leading silence and has unit energy per channel (contract
    // SPACE): no DelayNode, and no browser normalisation, so the return is exactly SPACE.returnDb.
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false;
    if (options.spaceIR) {
      const [l, r] = options.spaceIR;
      const ir = ctx.createBuffer(2, Math.max(1, l.length), ctx.sampleRate);
      ir.getChannelData(0).set(l);
      ir.getChannelData(1).set(r.length === l.length ? r : l);
      this.convolver.buffer = ir;
    }
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER.thresholdDb;
    this.limiter.knee.value = LIMITER.kneeDb;
    this.limiter.ratio.value = LIMITER.ratio;
    this.limiter.attack.value = LIMITER.attackSec;
    this.limiter.release.value = LIMITER.releaseSec;
    this.makeup = gain(dbToGain(options.makeupDb ?? LIMITER.makeupCompDb));
    this.nodes.push(this.convolver, this.limiter);

    // Effects
    this.effectsIn.connect(this.effectsShelf);
    this.effectsShelf.connect(this.effectsGain.node);
    this.effectsGain.node.connect(this.gate.node);
    this.fxSendIn.connect(this.fxSendGain.node);
    this.fxSendGain.node.connect(this.spaceIn);
    // Ambience
    this.ambienceIn.connect(this.ambienceGain.node);
    this.ambienceGain.node.connect(this.gate.node);
    this.ambSendIn.connect(this.ambSendGain.node);
    this.ambSendGain.node.connect(this.spaceIn);
    // Space
    this.spaceIn.connect(this.convolver);
    this.convolver.connect(this.spaceReturn);
    this.spaceReturn.connect(this.gate.node);
    // Music (the motif) and the master chain
    this.motifBus.connect(this.motifGain.node);
    this.motifGain.node.connect(this.preMaster);
    this.gate.node.connect(this.preMaster);
    this.preMaster.connect(this.limiter);
    this.limiter.connect(this.makeup);
    this.makeup.connect(this.master.node);
    this.master.node.connect(this.hiddenGate.node);
    this.hiddenGate.node.connect(options.destination ?? ctx.destination);

    if (options.meters) {
      const tap = (from: AudioNode): AnalyserNode => {
        const a = ctx.createAnalyser();
        a.fftSize = 2048;
        from.connect(a);
        this.nodes.push(a);
        return a;
      };
      this.meters = {
        effects: tap(this.effectsGain.node),
        ambience: tap(this.ambienceGain.node),
        music: tap(this.motifGain.node),
        master: tap(this.hiddenGate.node),
      };
    } else this.meters = null;
  }

  /** Channel levels with the current duck sums (dB) for ambience and effects. */
  applyLevels(levels: AudioLevels, duckAmbienceDb: number, duckEffectsDb: number, now: number, sec = LEVEL_RAMP_SEC): void {
    const fx = levels.effects * dbToGain(duckEffectsDb);
    const amb = levels.ambience * dbToGain(duckAmbienceDb);
    this.effectsGain.rampTo(fx, now, sec);
    this.fxSendGain.rampTo(fx, now, sec);
    this.ambienceGain.rampTo(amb, now, sec);
    this.ambSendGain.rampTo(amb, now, sec);
    this.motifGain.rampTo(levels.musicMuted ? 0 : levels.music * this.motifCalib, now, sec);
    this.master.rampTo(levels.soundMuted ? 0 : levels.master, now, sec);
  }

  /** The pause gate on effects and ambience (sources keep running underneath). */
  setGate(open: boolean, now: number): void {
    this.gate.rampTo(open ? 1 : 0, now, open ? GATE_OPEN_SEC : GATE_CLOSE_SEC);
  }

  setHiddenGate(open: boolean, now: number): void {
    this.hiddenGate.rampTo(open ? 1 : 0, now, open ? SHOW_SEC : HIDE_SEC);
  }

  /**
   * Open or close the shared space's return over fadeSec. An ended attempt's sends are ramped to 0, but
   * the convolver still rings out its last 2.2 s (SPACE.irSeconds): the manager closes the return when
   * the last live attempt ends, so leaving the game leaves nothing ringing, and opens it again.
   */
  setSpaceOpen(open: boolean, now: number, fadeSec: number): void {
    this.spaceReturnGain.rampTo(open ? dbToGain(SPACE.returnDb) : 0, now, fadeSec);
  }

  /** The act's effects tone (ChapterMix.effectsShelfDb), glided over 0.5 s. */
  setShelfDb(db: number, now: number): void {
    const p = this.effectsShelf.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(Math.min(0, Math.max(-24, Number.isFinite(db) ? db : 0)), now + 0.5);
  }

  /**
   * The channel gains as scheduled (master excludes the hidden-tab gate, reported separately). `music`
   * is the music channel's level (music × !musicMuted); the motif's fixed calibration trim on top of it
   * is not a channel gain and is left out.
   */
  values(now: number): { master: number; music: number; ambience: number; effects: number; gate: number } {
    return {
      master: this.master.valueAt(now),
      music: this.motifGain.valueAt(now) / this.motifCalib,
      ambience: this.ambienceGain.valueAt(now),
      effects: this.effectsGain.valueAt(now),
      gate: this.gate.valueAt(now),
    };
  }

  /** The node count (the design budget is about 130 with the strips). */
  get nodeCount(): number {
    return this.nodes.length;
  }

  dispose(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}
