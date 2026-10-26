/**
 * window.__icebergAudio (contract §16): the sound system's evidence surface for the browser runs.
 * Installed in development builds, or in any build loaded with ?audiodebug=1 (never under tests).
 * Installing it turns tracing on (so entries are only ever built while someone can read them) and
 * the graph then carries AnalyserNode taps, read once per animation frame while meter() is in use.
 *
 *   state()        AudioState: context status, levels, actual bus gains, ducks, voices, bells, bank
 *   trace(since?)  the trace ring after a sequence number
 *   meter()        per-bus peak and RMS since the last call (master, music = the motif bus, ambience, effects)
 *   lab()          the offline lab (./lab.ts, a separate chunk loaded on demand)
 *   player()       extra: the recorded-music player's own state (the exact el.volume of each voice)
 *   bake()         extra: the bake's pace, its main-thread time per pace, the bank, and every sound
 *                  or bell dropped as notReady so far
 */
import type { AudioDebugApi, AudioLab, BusMeter } from './contract';
import { audioQueryFlags } from './env';
import type { MeterBus } from './engine/graph';
import type { BakeReport, EngineAudioManager } from './manager';
import { musicPlayer, type MusicPlayerState } from './music';

export interface IcebergAudioDebug extends AudioDebugApi {
  player(): MusicPlayerState;
  bake(): BakeReport;
}

export function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (audioQueryFlags().debug) return true;
  return import.meta.env.DEV === true && import.meta.env.MODE !== 'test';
}

const BUSES: readonly MeterBus[] = ['master', 'music', 'ambience', 'effects'];
const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Accumulates peak and mean square per bus between meter() calls, one read per animation frame. */
class MeterReader {
  private readonly peak: Record<MeterBus, number> = { master: 0, music: 0, ambience: 0, effects: 0 };
  private readonly sumSq: Record<MeterBus, number> = { master: 0, music: 0, ambience: 0, effects: 0 };
  private samples = 0;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private running = false;
  private idleFrames = 0;

  constructor(private readonly m: EngineAudioManager) {}

  read(): Readonly<Record<MeterBus, BusMeter>> {
    this.start();
    this.idleFrames = 0;
    const out = {} as Record<MeterBus, BusMeter>;
    for (const b of BUSES) {
      out[b] = { peakDb: toDb(this.peak[b]), rmsDb: this.samples > 0 ? toDb(Math.sqrt(this.sumSq[b] / this.samples)) : -Infinity };
      this.peak[b] = 0;
      this.sumSq[b] = 0;
    }
    this.samples = 0;
    return out;
  }

  private start(): void {
    if (this.running || typeof requestAnimationFrame !== 'function') return;
    this.running = true;
    const tick = (): void => {
      this.sample();
      // Stop polling if nobody has asked for ten seconds.
      if (++this.idleFrames > 600) {
        this.running = false;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private sample(): void {
    const meters = this.m.graph()?.meters;
    if (!meters) return;
    let n = 0;
    for (const b of BUSES) {
      const a = meters[b];
      if (this.buf.length !== a.fftSize) this.buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(this.buf);
      let pk = this.peak[b];
      let ss = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const x = this.buf[i];
        const ax = x < 0 ? -x : x;
        if (ax > pk) pk = ax;
        ss += x * x;
      }
      this.peak[b] = pk;
      this.sumSq[b] += ss;
      n = this.buf.length;
    }
    this.samples += n;
  }
}

export function installAudioDebug(m: EngineAudioManager): IcebergAudioDebug | null {
  if (typeof window === 'undefined') return null;
  m.setTracing(true);
  const meters = new MeterReader(m);
  let lab: Promise<AudioLab> | null = null;
  const api: IcebergAudioDebug = {
    state: () => m.state(),
    trace: (sinceSeq?: number) => m.traceRing.since(sinceSeq ?? 0),
    clearTrace: () => m.traceRing.clear(),
    meter: () => meters.read(),
    // The lab and package B's analysis (BS.1770 loudness, spectra) load on demand as their own chunk.
    lab: () => (lab ??= Promise.all([import('./lab'), import('./analysis')]).then(([mod, an]) => mod.createLab(m, an.renderStats, an.loudness))),
    player: () => musicPlayer.state(),
    bake: () => m.bakeReport(),
  };
  window.__icebergAudio = api;
  return api;
}
