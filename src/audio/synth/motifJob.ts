/**
 * A motif render off the main thread (src/audio/synth/motif.worker.ts runs it in a Web Worker; the
 * bank's MotifRenderer posts the jobs). Pure, so the same function is tested under node: the worker
 * renders exactly what the main thread would (renderMotif with the same seed), and hashes the samples
 * there too (pcmHash, the bank's checksum), so the main thread only wraps the buffer.
 */
import type { MotifRequest } from '../contract';
import { pcmHash } from './dsp';
import { renderMotif } from './piano';

export interface MotifJob {
  readonly id: number;
  readonly motif: MotifRequest;
  readonly seed: number;
  /**
   * Measurement only (the browser driver's --cpu-throttle, which slows the page's main thread but not
   * a worker): after the render, stay busy (slowdown - 1) times as long, so the worker is as slow as a
   * main thread throttled that much. 1 (or absent) in the game.
   */
  readonly slowdown?: number;
}

export type MotifReply =
  | { readonly id: number; readonly ok: true; readonly sampleRate: number; readonly data: Float32Array; readonly hash: number; readonly ms: number }
  | { readonly id: number; readonly ok: false; readonly error: string };

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function runMotifJob(job: MotifJob): MotifReply {
  try {
    const t0 = clock();
    const pcm = renderMotif(job.motif, job.seed);
    const hash = pcmHash(pcm.data);
    const spent = clock() - t0;
    const slow = job.slowdown !== undefined && job.slowdown > 1 ? job.slowdown : 1;
    if (slow > 1) {
      const until = clock() + spent * (slow - 1);
      while (clock() < until) {
        // busy, as a slower thread would be
      }
    }
    return { id: job.id, ok: true, sampleRate: pcm.sampleRate, data: pcm.data, hash, ms: clock() - t0 };
  } catch (err) {
    return { id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
