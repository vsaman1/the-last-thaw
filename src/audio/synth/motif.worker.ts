/**
 * The motif worker (a module worker, created by src/audio/synth/motifRenderer.ts with Vite's
 * new Worker(new URL(...), import.meta.url) pattern): renders one motif per message, the samples
 * handed back without a copy (transferred).
 */
import { runMotifJob, type MotifJob } from './motifJob';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<MotifJob>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (ev) => {
  const reply = runMotifJob(ev.data);
  scope.postMessage(reply, reply.ok ? [reply.data.buffer] : []);
};
