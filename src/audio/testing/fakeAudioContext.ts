/**
 * A recording stand-in for a Web Audio context (contract §18), for node and jsdom tests of the engine
 * (package A) and the live voices (package B). It builds no sound: it records every node created, every
 * connect and disconnect, every start and stop, every AudioParam automation call and every state
 * change, and it evaluates AudioParam automation so `param.value` reads what a browser would report at
 * `currentTime`. Time only moves when the test calls advance(); sources whose buffer has played out
 * (or whose stop time has passed) then fire 'ended', in time order.
 *
 * Real-browser behaviour kept on purpose, so bugs show up here first:
 *  - start() twice, or stop() before start(), throws InvalidStateError;
 *  - resume() on a closed context rejects;
 *  - by default resume() moves the state to 'running' in a microtask (like Chrome), and can be told
 *    to never run (an Escape key press, which grants no user activation) or to run synchronously.
 *
 * Ownership tags: set `handle.owner` (or use withOwner) and every node created meanwhile carries that
 * tag, so liveSources(tag) can count one session's sources.
 */
import type { FakeAudioContextHandle, RecordedAudioOp } from '../contract';

type Listener = (ev: Event) => void;

/** How resume() behaves: 'async' = running after a microtask (default), 'sync', or 'never'. */
export type FakeResumeMode = 'async' | 'sync' | 'never';

export interface FakeAudioContextOptions {
  readonly sampleRate?: number;
  /** Starting state. Chrome reports 'suspended' until the audio thread has started. */
  readonly state?: 'suspended' | 'running';
  readonly resume?: FakeResumeMode;
  /** OfflineAudioContext-like: numberOfChannels / length are informational only. */
  readonly offline?: boolean;
}

type AutomationEvent =
  | { readonly type: 'set'; readonly time: number; readonly value: number }
  | { readonly type: 'linear'; readonly time: number; readonly value: number }
  | { readonly type: 'exp'; readonly time: number; readonly value: number }
  | { readonly type: 'target'; readonly time: number; readonly value: number; readonly tau: number }
  | { readonly type: 'curve'; readonly time: number; readonly duration: number; readonly values: Float32Array };

/** An AudioParam that records its automation and evaluates it at the context's currentTime. */
export class FakeAudioParam {
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  automationRate: 'a-rate' | 'k-rate' = 'a-rate';
  /** Automation events, sorted by time (ties keep insertion order). */
  readonly events: AutomationEvent[] = [];
  private base: number;

  constructor(
    /** The node this param belongs to (connect(param) records that node as the target). */
    readonly node: FakeAudioNode,
    readonly name: string,
    value: number,
    minValue = -3.4028234663852886e38,
    maxValue = 3.4028234663852886e38,
  ) {
    this.defaultValue = value;
    this.base = value;
    this.minValue = minValue;
    this.maxValue = maxValue;
  }

  get value(): number {
    return this.valueAt(this.node.context.currentTime);
  }

  /** Setting value is setValueAtTime(value, currentTime), recorded as method 'value'. */
  set value(v: number) {
    const t = this.node.context.currentTime;
    this.record('value', v, t);
    this.insert({ type: 'set', time: t, value: v });
  }

  setValueAtTime(value: number, startTime: number): this {
    this.check(value, startTime);
    this.record('setValueAtTime', value, startTime);
    this.insert({ type: 'set', time: startTime, value });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.check(value, endTime);
    this.record('linearRampToValueAtTime', value, endTime);
    this.insert({ type: 'linear', time: endTime, value });
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.check(value, endTime);
    if (value === 0) throw new RangeError('exponentialRampToValueAtTime: value must not be 0');
    this.record('exponentialRampToValueAtTime', value, endTime);
    this.insert({ type: 'exp', time: endTime, value });
    return this;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    this.check(target, startTime);
    if (!(timeConstant >= 0)) throw new RangeError('setTargetAtTime: negative time constant');
    this.record('setTargetAtTime', target, startTime);
    this.insert({ type: 'target', time: startTime, value: target, tau: timeConstant });
    return this;
  }

  setValueCurveAtTime(values: ArrayLike<number>, startTime: number, duration: number): this {
    this.check(values.length > 0 ? values[0] : 0, startTime);
    this.record('setValueCurveAtTime', values.length > 0 ? values[values.length - 1] : 0, startTime);
    this.insert({ type: 'curve', time: startTime, duration, values: Float32Array.from(values) });
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    this.record('cancelScheduledValues', 0, cancelTime);
    this.removeFrom(cancelTime);
    return this;
  }

  cancelAndHoldAtTime(cancelTime: number): this {
    const held = this.valueAt(cancelTime);
    this.record('cancelAndHoldAtTime', held, cancelTime);
    this.removeFrom(cancelTime);
    this.insert({ type: 'set', time: cancelTime, value: held });
    return this;
  }

  /** The automation's value at time t (Web Audio semantics, setTarget approximated per segment). */
  valueAt(t: number): number {
    let v = this.base;
    let prevTime = 0;
    const ev = this.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'linear' || e.type === 'exp') {
        // A ramp runs from the previous event (its time and value) to this one.
        if (t >= e.time) {
          v = e.value;
          prevTime = e.time;
          continue;
        }
        if (t <= prevTime) return v;
        const f = (t - prevTime) / (e.time - prevTime);
        if (e.type === 'linear') return v + (e.value - v) * f;
        if (v === 0 || Math.sign(v) !== Math.sign(e.value)) return v;
        return v * Math.pow(e.value / v, f);
      }
      if (e.time > t) break;
      if (e.type === 'set') {
        v = e.value;
        prevTime = e.time;
      } else if (e.type === 'target') {
        // The curve runs until the next event (or t); a following ramp starts from where it got to.
        const next = ev[i + 1];
        const stop = next !== undefined ? Math.min(t, next.time) : t;
        v = e.value + (v - e.value) * (e.tau > 0 ? Math.exp(-(stop - e.time) / e.tau) : 0);
        prevTime = stop;
      } else {
        const dt = t - e.time;
        if (dt >= e.duration) v = e.values[e.values.length - 1];
        else {
          const pos = (dt / e.duration) * (e.values.length - 1);
          const k = Math.floor(pos);
          const f = pos - k;
          v = e.values[k] + (e.values[Math.min(e.values.length - 1, k + 1)] - e.values[k]) * f;
        }
        prevTime = Math.min(t, e.time + e.duration);
      }
    }
    return v;
  }

  private check(value: number, time: number): void {
    if (!Number.isFinite(value)) throw new TypeError(`${this.name}: non-finite value ${value}`);
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`${this.name}: bad time ${time}`);
  }

  private record(method: string, value: number, time: number): void {
    this.node.context.record({ op: 'param', id: this.node.id, param: this.name, method, value, time });
  }

  private insert(e: AutomationEvent): void {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
  }

  private removeFrom(t: number): void {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].time >= t) this.events.splice(i, 1);
  }
}

export class FakeAudioNode {
  readonly id: number;
  /** Ownership tag at creation (see FakeAudioContext.owner). */
  readonly owner: string | null;
  channelCount = 2;
  channelCountMode: 'max' | 'clamped-max' | 'explicit' = 'max';
  channelInterpretation: 'speakers' | 'discrete' = 'speakers';
  /** Ids this node is connected to (nodes, or the owner node of a connected param). */
  readonly outputs: number[] = [];

  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
    readonly numberOfInputs = 1,
    readonly numberOfOutputs = 1,
  ) {
    this.id = context.register(this);
    this.owner = context.owner;
  }

  connect(destination: FakeAudioNode | FakeAudioParam, _output?: number, _input?: number): FakeAudioNode | undefined {
    void _output;
    void _input;
    const to = destination instanceof FakeAudioParam ? destination.node : destination;
    if (to.context !== this.context) throw new DOMException('connect: different context', 'InvalidAccessError');
    this.outputs.push(to.id);
    this.context.record({ op: 'connect', from: this.id, to: to.id });
    return destination instanceof FakeAudioParam ? undefined : destination;
  }

  disconnect(destination?: FakeAudioNode | FakeAudioParam | number): void {
    if (destination === undefined || typeof destination === 'number') this.outputs.length = 0;
    else {
      const to = destination instanceof FakeAudioParam ? destination.node : destination;
      const i = this.outputs.indexOf(to.id);
      if (i < 0) throw new DOMException('disconnect: not connected', 'InvalidAccessError');
      this.outputs.splice(i, 1);
    }
    this.context.record({ op: 'disconnect', from: this.id });
  }

  addEventListener(): void {
    // Only sources fire events (FakeScheduledSource overrides this).
  }

  removeEventListener(): void {
    // see addEventListener
  }

  protected param(name: string, value: number, min?: number, max?: number): FakeAudioParam {
    return new FakeAudioParam(this, name, value, min, max);
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'Gain');
    this.gain = this.param('gain', 1);
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency: FakeAudioParam;
  readonly Q: FakeAudioParam;
  readonly gain: FakeAudioParam;
  readonly detune: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'BiquadFilter');
    this.frequency = this.param('frequency', 350, 0, ctx.sampleRate / 2);
    this.Q = this.param('Q', 1);
    this.gain = this.param('gain', 0);
    this.detune = this.param('detune', 0);
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'StereoPanner');
    this.pan = this.param('pan', 0, -1, 1);
  }
}

export class FakeDelayNode extends FakeAudioNode {
  readonly delayTime: FakeAudioParam;
  constructor(ctx: FakeAudioContext, maxDelayTime = 1) {
    super(ctx, 'Delay');
    this.delayTime = this.param('delayTime', 0, 0, maxDelayTime);
  }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode {
  readonly threshold: FakeAudioParam;
  readonly knee: FakeAudioParam;
  readonly ratio: FakeAudioParam;
  readonly attack: FakeAudioParam;
  readonly release: FakeAudioParam;
  readonly reduction = 0;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'DynamicsCompressor');
    this.threshold = this.param('threshold', -24, -100, 0);
    this.knee = this.param('knee', 30, 0, 40);
    this.ratio = this.param('ratio', 12, 1, 20);
    this.attack = this.param('attack', 0.003, 0, 1);
    this.release = this.param('release', 0.25, 0, 1);
  }
}

export class FakeConvolverNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  normalize = true;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'Convolver');
  }
}

export class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  minDecibels = -100;
  maxDecibels = -30;
  smoothingTimeConstant = 0.8;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'Analyser');
  }
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  /** No signal is rendered: the time-domain data is silence. */
  getFloatTimeDomainData(out: Float32Array): void {
    out.fill(0);
  }
  getFloatFrequencyData(out: Float32Array): void {
    out.fill(-Infinity);
  }
}

export class FakeWaveShaperNode extends FakeAudioNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'WaveShaper');
  }
}

export class FakeAudioBuffer {
  readonly duration: number;
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (numberOfChannels < 1 || length < 1 || !(sampleRate > 0)) throw new DOMException('createBuffer', 'NotSupportedError');
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    const c = this.channels[channel];
    if (!c) throw new DOMException('getChannelData: bad channel', 'IndexSizeError');
    return c;
  }
  copyToChannel(source: Float32Array, channel: number, offset = 0): void {
    this.getChannelData(channel).set(source.subarray(0, Math.max(0, this.length - offset)), offset);
  }
  copyFromChannel(dest: Float32Array, channel: number, offset = 0): void {
    dest.set(this.getChannelData(channel).subarray(offset, offset + dest.length));
  }
}

/** Shared start/stop/ended logic for buffer sources, oscillators and constant sources. */
export class FakeScheduledSource extends FakeAudioNode {
  onended: ((ev: Event) => void) | null = null;
  startTime: number | null = null;
  startOffset = 0;
  stopTime: number | null = null;
  /** True once 'ended' has fired. */
  ended = false;
  private readonly listeners: Listener[] = [];

  constructor(ctx: FakeAudioContext, kind: string) {
    super(ctx, kind, 0, 1);
  }

  start(when = 0, offset = 0, duration?: number): void {
    if (this.startTime !== null) throw new DOMException('start() called twice', 'InvalidStateError');
    if (!(when >= 0)) throw new RangeError('start: negative time');
    this.startTime = when;
    this.startOffset = offset;
    if (duration !== undefined) this.playDuration = duration;
    this.context.record({ op: 'start', id: this.id, when, offset });
  }

  stop(when = 0): void {
    if (this.startTime === null) throw new DOMException('stop() before start()', 'InvalidStateError');
    if (!(when >= 0)) throw new RangeError('stop: negative time');
    this.stopTime = when;
    this.context.record({ op: 'stop', id: this.id, when });
  }

  override addEventListener(type?: string, fn?: Listener): void {
    if (type === 'ended' && fn) this.listeners.push(fn);
  }

  override removeEventListener(type?: string, fn?: Listener): void {
    if (type !== 'ended' || !fn) return;
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  /** Requested play length (start's third argument), or null. */
  protected playDuration: number | null = null;

  /** When the source stops sounding (Infinity: never by itself). */
  endTime(): number {
    if (this.startTime === null) return Infinity;
    const natural = this.naturalLength();
    const byDuration = this.playDuration !== null ? this.startTime + this.playDuration : Infinity;
    const byStop = this.stopTime ?? Infinity;
    return Math.min(byStop, byDuration, natural === Infinity ? Infinity : this.startTime + natural);
  }

  /** Seconds of output from start, if the source ends by itself. */
  protected naturalLength(): number {
    return Infinity;
  }

  fireEnded(): void {
    if (this.ended) return;
    this.ended = true;
    const ev = new Event('ended');
    this.onended?.(ev);
    for (const fn of [...this.listeners]) fn(ev);
  }
}

export class FakeAudioBufferSourceNode extends FakeScheduledSource {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeAudioParam;
  readonly detune: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'AudioBufferSource');
    this.playbackRate = this.param('playbackRate', 1);
    this.detune = this.param('detune', 0);
  }
  protected override naturalLength(): number {
    if (this.loop || this.buffer === null) return Infinity;
    const rate = Math.abs(this.playbackRate.valueAt(this.startTime ?? 0)) * Math.pow(2, this.detune.valueAt(0) / 1200);
    if (rate <= 0) return Infinity;
    return Math.max(0, this.buffer.duration - this.startOffset) / rate;
  }
}

export class FakeOscillatorNode extends FakeScheduledSource {
  type: OscillatorType = 'sine';
  readonly frequency: FakeAudioParam;
  readonly detune: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'Oscillator');
    this.frequency = this.param('frequency', 440);
    this.detune = this.param('detune', 0);
  }
  setPeriodicWave(): void {
    // nothing to record
  }
}

export class FakeConstantSourceNode extends FakeScheduledSource {
  readonly offset: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'ConstantSource');
    this.offset = this.param('offset', 1);
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate: number;
  state: AudioContextState | 'interrupted';
  readonly baseLatency = 0.01;
  readonly destination: FakeAudioNode;
  readonly ops: RecordedAudioOp[] = [];
  readonly nodes: FakeAudioNode[] = [];
  onstatechange: ((ev: Event) => void) | null = null;
  /** Ownership tag given to every node created while it is set. */
  owner: string | null = null;
  resumeMode: FakeResumeMode;
  /** Calls to resume() and suspend() (whatever their outcome). */
  resumeCalls = 0;
  suspendCalls = 0;
  private readonly listeners: Listener[] = [];
  private nextId = 1;

  constructor(options: FakeAudioContextOptions = {}) {
    this.sampleRate = options.sampleRate ?? 48000;
    this.state = options.state ?? 'suspended';
    this.resumeMode = options.resume ?? 'async';
    this.destination = new FakeAudioNode(this, 'Destination', 1, 0);
  }

  register(node: FakeAudioNode): number {
    const id = this.nextId++;
    this.nodes.push(node);
    this.ops.push({ op: 'create', node: node.kind, id });
    return id;
  }

  record(op: RecordedAudioOp): void {
    this.ops.push(op);
  }

  createGain(): FakeGainNode {
    return new FakeGainNode(this);
  }
  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode(this);
  }
  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode(this);
  }
  createDelay(maxDelayTime?: number): FakeDelayNode {
    return new FakeDelayNode(this, maxDelayTime);
  }
  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    return new FakeDynamicsCompressorNode(this);
  }
  createConvolver(): FakeConvolverNode {
    return new FakeConvolverNode(this);
  }
  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode(this);
  }
  createWaveShaper(): FakeWaveShaperNode {
    return new FakeWaveShaperNode(this);
  }
  createChannelMerger(inputs = 6): FakeAudioNode {
    return new FakeAudioNode(this, 'ChannelMerger', inputs, 1);
  }
  createChannelSplitter(outputs = 6): FakeAudioNode {
    return new FakeAudioNode(this, 'ChannelSplitter', 1, outputs);
  }
  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode(this);
  }
  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode(this);
  }
  createConstantSource(): FakeConstantSourceNode {
    return new FakeConstantSourceNode(this);
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }
  decodeAudioData(): Promise<FakeAudioBuffer> {
    return Promise.reject(new DOMException('decodeAudioData is not faked', 'NotSupportedError'));
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.state === 'closed') return Promise.reject(new DOMException('closed', 'InvalidStateError'));
    if (this.resumeMode === 'never' || this.state === 'running') return Promise.resolve();
    if (this.resumeMode === 'sync') {
      this.setState('running');
      return Promise.resolve();
    }
    return Promise.resolve().then(() => {
      if (this.state !== 'closed' && this.resumeMode === 'async') this.setState('running');
    });
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state === 'closed') return Promise.reject(new DOMException('closed', 'InvalidStateError'));
    if (this.state !== 'suspended') this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.state !== 'closed') this.setState('closed');
    return Promise.resolve();
  }

  addEventListener(type: string, fn: Listener): void {
    if (type === 'statechange') this.listeners.push(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    if (type !== 'statechange') return;
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  setState(state: AudioContextState | 'interrupted'): void {
    if (this.state === state) return;
    this.state = state;
    this.ops.push({ op: 'state', state });
    const ev = new Event('statechange');
    this.onstatechange?.(ev);
    for (const fn of [...this.listeners]) fn(ev);
  }

  /** Every started source (buffer, oscillator, constant). */
  sources(): FakeScheduledSource[] {
    return this.nodes.filter((n): n is FakeScheduledSource => n instanceof FakeScheduledSource);
  }

  advance(seconds: number): void {
    if (!(seconds >= 0)) throw new RangeError('advance: negative');
    // A suspended or closed context does not move its clock, as in a browser.
    if (this.state === 'running') this.currentTime += seconds;
    const due = this.sources()
      .filter((s) => s.startTime !== null && !s.ended && s.endTime() <= this.currentTime)
      .sort((a, b) => a.endTime() - b.endTime() || a.id - b.id);
    for (const s of due) s.fireEnded();
  }

  /** Sources started and not yet stopped or ended at currentTime (optionally one owner's). */
  liveSources(owner?: string): number {
    let n = 0;
    for (const s of this.sources()) {
      if (owner !== undefined && s.owner !== owner) continue;
      if (s.startTime !== null && !s.ended && s.endTime() > this.currentTime) n++;
    }
    return n;
  }
}

/** The contract's handle, plus direct access to the fake (owner tags, nodes, graph queries). */
export interface FakeHandle extends FakeAudioContextHandle {
  readonly ctx: FakeAudioContext;
  readonly fake: FakeAudioContext;
  liveSources(owner?: string): number;
  /** Run fn with every node it creates tagged `owner`. */
  withOwner<T>(owner: string, fn: () => T): T;
  /** Nodes of one kind ('Gain', 'AudioBufferSource', ...), in creation order. */
  nodesOf(kind: string): FakeAudioNode[];
  /** True when a path of connections leads from node id to the destination. */
  reachesDestination(id: number): boolean;
}

export function createFakeAudioContext(options: FakeAudioContextOptions = {}): FakeHandle {
  const fake = new FakeAudioContext(options);
  return {
    ctx: fake,
    fake,
    get ops(): readonly RecordedAudioOp[] {
      return fake.ops;
    },
    advance: (seconds: number) => fake.advance(seconds),
    setState: (state) => fake.setState(state),
    liveSources: (owner?: string) => fake.liveSources(owner),
    withOwner<T>(owner: string, fn: () => T): T {
      const prev = fake.owner;
      fake.owner = owner;
      try {
        return fn();
      } finally {
        fake.owner = prev;
      }
    },
    nodesOf: (kind: string) => fake.nodes.filter((n) => n.kind === kind),
    reachesDestination(id: number): boolean {
      const byId = new Map(fake.nodes.map((n) => [n.id, n]));
      const seen = new Set<number>();
      const stack = [id];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur === fake.destination.id) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const to of byId.get(cur)?.outputs ?? []) stack.push(to);
      }
      return false;
    },
  };
}
