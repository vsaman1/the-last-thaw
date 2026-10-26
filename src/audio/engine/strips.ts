/**
 * Strips: the per-voice channel a one-shot plays through, built once when the graph is built so that
 * a play creates exactly one node (its AudioBufferSourceNode):
 *
 *   source ─► gain ─► low-pass (Butterworth) ─► stereo panner ─┬─► bus input (effects or ambience)
 *                                                                 └─► send gain ─► space send input
 *
 * A strip carries one voice at a time and is busy until that voice has stopped (or, after a steal,
 * until its 25 ms fade has finished), so there are more strips than voices.
 *
 * Pan law: a StereoPannerNode spreads a mono input with equal power, so a centred voice comes out
 * 3 dB down in each channel (measured in Chrome: -3.01 dB). Strips make up for it (x √2), so a
 * layer's gainDb is the peak a centred voice reaches in each channel at the pre-master sum, as the
 * design's level table means it; a voice panned toward one side keeps its power and gets up to
 * +2.3 dB (effects, pan 0.5) or +2.8 dB (bells, pan 0.7) in the nearer channel.
 */

/** Web Audio reads a low-pass Q in dB (20·log10 of the linear Q): 1/√2 linear is a flat Butterworth. */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
/** Equal-power make-up for a mono voice through the stereo panner (see the header). */
export const PAN_LAW_COMP = Math.SQRT2;

const clampHz = (hz: number, sampleRate: number): number => Math.min(sampleRate / 2 - 1, Math.max(20, hz));

/** Cancel what is scheduled from `now` and set a value that holds from `now`. */
export function setNow(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
}

export class Strip {
  readonly gain: GainNode;
  readonly lowpass: BiquadFilterNode;
  readonly panner: StereoPannerNode;
  readonly send: GainNode;
  /** AudioContext time until which the strip is taken. */
  busyUntil = 0;
  /** The voice's nominal linear gain (before PAN_LAW_COMP): what a fade starts from. */
  level = 0;

  constructor(
    readonly index: number,
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    sendOut: AudioNode,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.Q.value = BUTTERWORTH_Q_DB;
    this.lowpass.frequency.value = clampHz(16000, ctx.sampleRate);
    this.panner = ctx.createStereoPanner();
    this.send = ctx.createGain();
    this.send.gain.value = 0;
    this.gain.connect(this.lowpass);
    this.lowpass.connect(this.panner);
    this.panner.connect(out);
    this.panner.connect(this.send);
    this.send.connect(sendOut);
  }

  /** Values for a new voice, effective immediately (the strip is free, nothing else plays on it). */
  prepare(now: number, gain: number, lowpassHz: number, pan: number, send: number): void {
    this.level = gain;
    setNow(this.gain.gain, gain * PAN_LAW_COMP, now);
    setNow(this.lowpass.frequency, clampHz(lowpassHz, this.ctx.sampleRate), now);
    setNow(this.panner.pan, Math.max(-1, Math.min(1, pan)), now);
    setNow(this.send.gain, Math.max(0, send), now);
  }

  /** Glide to new values (a long positional voice moving relative to the listener). */
  glide(now: number, gain: number, lowpassHz: number, pan: number, tauSec: number): void {
    this.level = gain;
    this.gain.gain.setTargetAtTime(gain * PAN_LAW_COMP, now, tauSec);
    this.lowpass.frequency.setTargetAtTime(clampHz(lowpassHz, this.ctx.sampleRate), now, tauSec);
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, tauSec);
  }

  /** Ramp the voice on this strip to silence over sec (linear, from its current level). */
  fadeOut(now: number, sec: number): void {
    const p = this.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(this.level * PAN_LAW_COMP, now);
    p.linearRampToValueAtTime(0, now + Math.max(0.001, sec));
    this.level = 0;
  }

  /** Exponential choke (a bell clapper damped): setTarget toward 0 with time constant tau. */
  choke(now: number, tauSec: number): void {
    const p = this.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(this.level * PAN_LAW_COMP, now);
    p.setTargetAtTime(0, now, Math.max(0.001, tauSec));
    this.level = 0;
  }

  disconnect(): void {
    for (const n of [this.gain, this.lowpass, this.panner, this.send]) {
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}

export function createStrips(ctx: BaseAudioContext, count: number, out: AudioNode, sendOut: AudioNode): Strip[] {
  return Array.from({ length: count }, (_, i) => new Strip(i, ctx, out, sendOut));
}
