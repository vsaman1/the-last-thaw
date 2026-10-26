/**
 * Motifs rendered off the main thread (docs/evidence/AUDIO_RUNS.md, "Slow computers"). A motif is the
 * longest bake there is (the epilogue's is 34 s of felt piano), and on a main thread twice as slow the
 * moments that play one missed it. The bank (SoundBankOptions.motifRenderer) sends a level set's motifs
 * here one at a time, in its own order, as soon as the set is asked for (all but a chapter card's short
 * motif, which bakes on the main thread with the strikes: see bank.ts); a module worker
 * (motif.worker.ts) renders each with the same code and seed as the main thread would (runMotifJob),
 * hashes it, and hands the samples back without a copy. The main thread only wraps them.
 *
 * Where no worker can be made (node and jsdom have none, a page opened from file:// may not start one,
 * ?audioworker=off turns it off for A/B runs) the bank bakes motifs on the main thread in slices, as
 * before; if the worker fails or stops answering, it does so from then on. The samples are identical
 * either way (tested: motifRenderer.test.ts, bank.test.ts).
 */
import type { MotifRequest } from '../contract';
import { audioQueryFlags } from '../env';
import type { MotifJob, MotifReply } from './motifJob';

export interface MotifRender {
  readonly sampleRate: number;
  readonly data: Float32Array;
  /** pcmHash of the samples (the bank's checksum). */
  readonly hash: number;
  /** Time the render took off the main thread (ms). */
  readonly ms: number;
}

export interface MotifRenderer {
  /**
   * Render `motif` with `seed`. `done` is called once, later or at once: with the samples, or with an
   * Error, after which the renderer is gone for good (every later call gets the Error at once).
   */
  render(motif: MotifRequest, seed: number, done: (result: MotifRender | Error) => void): void;
}

/** A render with no answer after this long gives the worker up (the epilogue takes about 1 s there). */
export const MOTIF_WORKER_TIMEOUT_MS = 30000;

/** What the renderer needs of a Worker (a fake in tests). */
export interface WorkerLike {
  onmessage: ((ev: { readonly data: MotifReply }) => void) | null;
  onerror: ((ev: { readonly message?: string }) => void) | null;
  postMessage(job: MotifJob): void;
  terminate(): void;
}

export interface WorkerRendererOptions {
  /** Measurement only: MotifJob.slowdown (the driver's --cpu-throttle, which does not reach a worker). */
  readonly slowdown?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/** A MotifRenderer over a worker made on the first render (`make` may throw: the renderer is then gone). */
export function workerMotifRenderer(make: () => WorkerLike, o: WorkerRendererOptions = {}): MotifRenderer {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let worker: WorkerLike | null = null;
  let broken: Error | null = null;
  let seq = 0;
  const jobs = new Map<number, { done: (r: MotifRender | Error) => void; timer: unknown }>();

  const fail = (err: Error): void => {
    if (broken !== null) return;
    broken = err;
    const w = worker;
    worker = null;
    try {
      w?.terminate();
    } catch {
      // already gone
    }
    const left = [...jobs.values()];
    jobs.clear();
    for (const j of left) {
      clearTimer(j.timer);
      j.done(err);
    }
  };

  const ensure = (): WorkerLike => {
    if (worker !== null) return worker;
    const w = make();
    w.onmessage = (ev) => {
      const r = ev.data;
      const job = jobs.get(r.id);
      if (job === undefined) return;
      jobs.delete(r.id);
      clearTimer(job.timer);
      if (r.ok) job.done({ sampleRate: r.sampleRate, data: r.data, hash: r.hash, ms: r.ms });
      else {
        // The same render would throw on the main thread too; the bank then marks it failed there.
        job.done(new Error(`motif worker: ${r.error}`));
        fail(new Error(`motif worker: ${r.error}`));
      }
    };
    w.onerror = (ev) => fail(new Error(`motif worker error${ev?.message ? `: ${ev.message}` : ''}`));
    worker = w;
    return w;
  };

  return {
    render(motif, seed, done) {
      if (broken !== null) {
        done(broken);
        return;
      }
      let w: WorkerLike;
      try {
        w = ensure();
      } catch (err) {
        fail(asError(err));
        done(broken ?? asError(err));
        return;
      }
      const id = ++seq;
      const timer = setTimer(() => fail(new Error(`motif worker: no answer in ${MOTIF_WORKER_TIMEOUT_MS / 1000} s`)), MOTIF_WORKER_TIMEOUT_MS);
      jobs.set(id, { done, timer });
      try {
        w.postMessage({ id, motif, seed, ...(o.slowdown !== undefined && o.slowdown > 1 ? { slowdown: o.slowdown } : {}) });
      } catch (err) {
        fail(asError(err));
      }
    },
  };
}

/**
 * The browser's renderer: a module worker (Vite bundles motif.worker.ts and its imports), or null
 * where there is no Worker or ?audioworker=off.
 */
export function browserMotifRenderer(): MotifRenderer | null {
  if (typeof Worker === 'undefined') return null;
  const flags = audioQueryFlags();
  if (!flags.worker) return null;
  return workerMotifRenderer(
    () => new Worker(new URL('./motif.worker.ts', import.meta.url), { type: 'module', name: 'motif' }) as unknown as WorkerLike,
    { slowdown: flags.workerSlowdown },
  );
}
