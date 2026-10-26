/**
 * A recording stand-in for BaseAudioContext, for package B's node tests (the bank and the ambience
 * voices). It implements the contract's FakeAudioContextHandle (§18) for the node types package B
 * uses, so the integrator can swap in package A's src/audio/testing/fakeAudioContext.ts for the op
 * checks. Test-only: nothing in the game imports it (the name keeps it out of the vitest test glob).
 *
 * It also keeps each AudioParam's automation timeline and can render a node's output offline
 * (renderGraph): looping buffer sources with linear-interpolation resampling, gains with audio-rate
 * modulation into their params, biquads by the Web Audio formulas, equal-power stereo panners. That
 * is enough to measure the steady levels and fades of the live voices in node; it is a model of the
 * browser, not the browser (package A's OfflineAudioContext lab is the real check).
 */
import type { FakeAudioContextHandle, RecordedAudioOp } from '../contract';
import { Biquad, type BiquadType } from '../synth/dsp';

type Op = RecordedAudioOp;

interface AutomationEvent {
  readonly method: 'set' | 'linear' | 'exponential' | 'target';
  readonly value: number;
  readonly time: number;
  readonly tau: number;
}

export class FakeParam {
  private v: number;
  private readonly initial: number;
  private events: AutomationEvent[] = [];
  /** Nodes whose output is added to this param at audio rate. */
  readonly modulators: FakeNode[] = [];

  constructor(
    private readonly rec: Recorder,
    private readonly owner: number,
    private readonly name: string,
    value: number,
  ) {
    this.v = value;
    this.initial = value;
  }
  get value(): number {
    return this.v;
  }
  set value(x: number) {
    this.v = x;
    this.add({ method: 'set', value: x, time: this.rec.time, tau: 0 });
    this.rec.push({ op: 'param', id: this.owner, param: this.name, method: 'value', value: x, time: this.rec.time });
  }
  private add(e: AutomationEvent): void {
    // Keep time order; events at the same time stay in the order they were made.
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
  }
  private log(method: string, value: number, time: number): this {
    this.rec.push({ op: 'param', id: this.owner, param: this.name, method, value, time });
    return this;
  }
  setValueAtTime(value: number, time: number): this {
    this.v = value;
    this.add({ method: 'set', value, time, tau: 0 });
    return this.log('setValueAtTime', value, time);
  }
  setTargetAtTime(value: number, time: number, tau: number): this {
    this.v = value;
    this.add({ method: 'target', value, time, tau });
    return this.log('setTargetAtTime', value, time);
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.v = value;
    this.add({ method: 'linear', value, time, tau: 0 });
    return this.log('linearRampToValueAtTime', value, time);
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.v = value;
    this.add({ method: 'exponential', value, time, tau: 0 });
    return this.log('exponentialRampToValueAtTime', value, time);
  }
  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time);
    return this.log('cancelScheduledValues', 0, time);
  }
  cancelAndHoldAtTime(time: number): this {
    return this.log('cancelAndHoldAtTime', 0, time);
  }
  /** The node that owns this param (for connect ops that target a param). */
  get ownerId(): number {
    return this.owner;
  }

  /** The automation's value at time t (Web Audio semantics for the four event kinds used). */
  valueAt(t: number): number {
    let v = this.initial;
    let lastT = 0;
    const ev = this.events;
    for (let k = 0; k < ev.length; k++) {
      const e = ev[k];
      if (e.time > t) {
        if (e.method === 'linear') return v + ((e.value - v) * (t - lastT)) / Math.max(1e-9, e.time - lastT);
        if (e.method === 'exponential' && v > 0 && e.value > 0) return v * Math.pow(e.value / v, (t - lastT) / Math.max(1e-9, e.time - lastT));
        return v;
      }
      if (e.method === 'target') {
        const next = ev[k + 1];
        const end = Math.min(t, next ? next.time : Infinity);
        v = e.value + (v - e.value) * Math.exp(-(end - e.time) / Math.max(1e-9, e.tau));
        lastT = end;
        if (end >= t) return v;
      } else {
        v = e.value;
        lastT = e.time;
      }
    }
    return v;
  }
}

class Recorder {
  readonly ops: Op[] = [];
  time = 0;
  nextId = 1;
  sources = new Set<FakeSource>();
  push(op: Op): void {
    this.ops.push(op);
  }
}

export class FakeNode {
  readonly id: number;
  readonly inputs: FakeNode[] = [];
  readonly outputs: (FakeNode | FakeParam)[] = [];
  disconnected = false;
  constructor(
    protected readonly rec: Recorder,
    readonly kind: string,
  ) {
    this.id = rec.nextId++;
    rec.push({ op: 'create', node: kind, id: this.id });
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    this.outputs.push(dest);
    if (dest instanceof FakeNode) dest.inputs.push(this);
    else dest.modulators.push(this);
    this.rec.push({ op: 'connect', from: this.id, to: dest instanceof FakeNode ? dest.id : dest.ownerId });
    return dest;
  }
  disconnect(): void {
    for (const d of this.outputs) {
      const list = d instanceof FakeNode ? d.inputs : d.modulators;
      const i = list.indexOf(this);
      if (i >= 0) list.splice(i, 1);
    }
    this.outputs.length = 0;
    this.disconnected = true;
    this.rec.push({ op: 'disconnect', from: this.id });
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(rec: Recorder) {
    super(rec, 'Gain');
    this.gain = new FakeParam(rec, this.id, 'gain', 1);
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadType = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  readonly gain: FakeParam;
  readonly detune: FakeParam;
  constructor(rec: Recorder) {
    super(rec, 'BiquadFilter');
    this.frequency = new FakeParam(rec, this.id, 'frequency', 350);
    this.Q = new FakeParam(rec, this.id, 'Q', 1);
    this.gain = new FakeParam(rec, this.id, 'gain', 0);
    this.detune = new FakeParam(rec, this.id, 'detune', 0);
  }
}

export class FakePanner extends FakeNode {
  readonly pan: FakeParam;
  constructor(rec: Recorder) {
    super(rec, 'StereoPanner');
    this.pan = new FakeParam(rec, this.id, 'pan', 0);
  }
}

export class FakeAudioBuffer {
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number, start = 0): void {
    this.data[c].set(src.subarray(0, this.length - start), start);
  }
  copyFromChannel(dst: Float32Array, c: number, start = 0): void {
    dst.set(this.data[c].subarray(start, start + dst.length));
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeParam;
  readonly detune: FakeParam;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  startOffset = 0;
  stoppedAt: number | null = null;
  ended = false;
  constructor(rec: Recorder) {
    super(rec, 'AudioBufferSource');
    this.playbackRate = new FakeParam(rec, this.id, 'playbackRate', 1);
    this.detune = new FakeParam(rec, this.id, 'detune', 0);
  }
  start(when = 0, offset = 0): void {
    if (this.startedAt !== null) throw new Error('InvalidStateError: start() called twice');
    this.startedAt = when;
    this.startOffset = offset;
    this.rec.sources.add(this);
    this.rec.push({ op: 'start', id: this.id, when, offset });
  }
  stop(when = 0): void {
    if (this.startedAt === null) throw new Error('InvalidStateError: stop() before start()');
    if (this.stoppedAt !== null) throw new Error('InvalidStateError: stop() called twice');
    this.stoppedAt = when;
    this.rec.push({ op: 'stop', id: this.id, when });
  }
}

export interface FakeContext extends FakeAudioContextHandle {
  /** Every node created, by id. */
  node(id: number): FakeNode | undefined;
  /** Ops recorded since `mark` (an index into ops). */
  since(mark: number): readonly RecordedAudioOp[];
  /** The destination node (what tests connect outputs to). */
  readonly destination: FakeNode;
}

/** A fake context at the given rate; cast `ctx` to BaseAudioContext for code under test. */
export function createFakeContext(sampleRate = 48000): FakeContext {
  const rec = new Recorder();
  const nodes = new Map<number, FakeNode>();
  let state = 'running';
  const track = <T extends FakeNode>(n: T): T => {
    nodes.set(n.id, n);
    return n;
  };
  const destination = track(new FakeNode(rec, 'Destination'));
  const ctx = {
    get currentTime(): number {
      return rec.time;
    },
    sampleRate,
    get state(): string {
      return state;
    },
    destination,
    createGain: () => track(new FakeGain(rec)),
    createBiquadFilter: () => track(new FakeBiquad(rec)),
    createStereoPanner: () => track(new FakePanner(rec)),
    createBufferSource: () => track(new FakeSource(rec)),
    createBuffer: (channels: number, length: number, rate: number) => new FakeAudioBuffer(channels, length, rate),
  };
  return {
    ctx,
    get ops() {
      return rec.ops;
    },
    destination,
    advance(seconds: number): void {
      rec.time += seconds;
      for (const s of rec.sources) {
        if (s.ended || s.startedAt === null) continue;
        const natural = s.buffer && !s.loop ? s.startedAt + s.buffer.duration / Math.max(1e-6, s.playbackRate.value) : Infinity;
        const end = Math.min(natural, s.stoppedAt ?? Infinity);
        if (end <= rec.time) {
          s.ended = true;
          s.onended?.();
        }
      }
    },
    setState(s): void {
      state = s;
      rec.push({ op: 'state', state: s });
    },
    liveSources(): number {
      let n = 0;
      for (const s of rec.sources) if (!s.ended) n++;
      return n;
    },
    node: (id) => nodes.get(id),
    since: (mark) => rec.ops.slice(mark),
  };
}

// -------------------------------------------------------------------------------------------------
// Offline rendering of a fake graph
// -------------------------------------------------------------------------------------------------

/**
 * Renders `node`'s output from context time t0 for `seconds` (for the destination: everything
 * connected to it). Stereo once a panner is in the path; mono inputs reach both channels.
 */
export function renderGraph(node: FakeNode, t0: number, seconds: number, fs = 48000): { left: Float32Array; right: Float32Array } {
  const n = Math.round(seconds * fs);
  const memo = new Map<number, { l: Float32Array; r: Float32Array | null }>();
  const block = 32;

  const sumInputs = (inputs: readonly FakeNode[]): { l: Float32Array; r: Float32Array | null } => {
    const l = new Float32Array(n);
    let r: Float32Array | null = null;
    for (const src of inputs) {
      const o = out(src);
      for (let i = 0; i < n; i++) l[i] += o.l[i];
      if (o.r) {
        if (!r) r = l.slice(0, n).fill(0);
        for (let i = 0; i < n; i++) r[i] += o.r[i];
      }
    }
    if (r) {
      // Mono inputs reach both channels.
      const mono = new Float32Array(n);
      for (const src of inputs) {
        const o = out(src);
        if (!o.r) for (let i = 0; i < n; i++) mono[i] += o.l[i];
      }
      for (let i = 0; i < n; i++) {
        r[i] += mono[i];
      }
    }
    return { l, r };
  };

  /** The param's value per sample: automation (per 32-sample block) plus audio-rate modulators. */
  const paramSignal = (p: FakeParam): Float32Array => {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i += block) {
      const x = p.valueAt(t0 + i / fs);
      for (let k = i; k < Math.min(n, i + block); k++) v[k] = x;
    }
    for (const m of p.modulators) {
      const o = out(m);
      for (let i = 0; i < n; i++) v[i] += o.l[i];
    }
    return v;
  };

  function out(nd: FakeNode): { l: Float32Array; r: Float32Array | null } {
    const hit = memo.get(nd.id);
    if (hit) return hit;
    let res: { l: Float32Array; r: Float32Array | null };
    if (nd instanceof FakeSource) {
      const l = new Float32Array(n);
      const b = nd.buffer;
      if (b && nd.startedAt !== null) {
        const data = b.getChannelData(0);
        const len = data.length;
        const rate = paramSignal(nd.playbackRate);
        // Position (buffer samples) at t0: offset + elapsed x rate (rate taken as its value at t0).
        let pos = nd.startOffset * b.sampleRate + Math.max(0, t0 - nd.startedAt) * nd.playbackRate.valueAt(t0) * b.sampleRate;
        for (let i = 0; i < n; i++) {
          const t = t0 + i / fs;
          if (t < nd.startedAt || (nd.stoppedAt !== null && t >= nd.stoppedAt)) continue;
          if (nd.loop) pos %= len;
          else if (pos >= len - 1) break;
          const k = Math.floor(pos);
          const f = pos - k;
          l[i] = data[k] * (1 - f) + data[(k + 1) % len] * f;
          pos += (rate[i] * b.sampleRate) / fs;
        }
      }
      res = { l, r: null };
    } else if (nd instanceof FakeGain) {
      const x = sumInputs(nd.inputs);
      const g = paramSignal(nd.gain);
      for (let i = 0; i < n; i++) x.l[i] *= g[i];
      if (x.r) for (let i = 0; i < n; i++) x.r[i] *= g[i];
      res = x;
    } else if (nd instanceof FakeBiquad) {
      const x = sumInputs(nd.inputs);
      const freq = paramSignal(nd.frequency);
      const q = paramSignal(nd.Q);
      const gdb = paramSignal(nd.gain);
      for (const ch of [x.l, x.r]) {
        if (!ch) continue;
        const bq = new Biquad(fs, true);
        for (let i = 0; i < n; i += block) {
          bq.set(nd.type, freq[i], q[i], gdb[i]);
          for (let k = i; k < Math.min(n, i + block); k++) ch[k] = bq.tick(ch[k]);
        }
      }
      res = x;
    } else if (nd instanceof FakePanner) {
      const x = sumInputs(nd.inputs);
      const p = paramSignal(nd.pan);
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = ((Math.max(-1, Math.min(1, p[i])) + 1) / 2) * (Math.PI / 2);
        l[i] = x.l[i] * Math.cos(a);
        r[i] = (x.r ? x.r[i] : x.l[i]) * Math.sin(a);
      }
      res = { l, r };
    } else {
      res = sumInputs(nd.inputs);
    }
    memo.set(nd.id, res);
    return res;
  }

  const res = sumInputs([node]);
  return { left: res.l, right: res.r ?? res.l };
}
