/**
 * The motif worker's job (what motif.worker.ts runs) and the renderer the bank talks to, over a fake
 * Worker: the samples are the main thread's, and every way a worker can fail ends in an Error the
 * bank falls back on (bank.test.ts checks the fallback itself).
 */
import { describe, expect, it } from 'vitest';
import { SEED, type MotifRequest } from '../contract';
import { pcmHash } from './dsp';
import { runMotifJob, type MotifJob, type MotifReply } from './motifJob';
import { MOTIF_WORKER_TIMEOUT_MS, workerMotifRenderer, type MotifRender, type WorkerLike } from './motifRenderer';
import { renderMotif } from './piano';

const bare: MotifRequest = { variant: 'act3-bare', tempoScale: 1 };

describe('runMotifJob (the worker side)', () => {
  it('renders exactly what the main thread renders, with its hash', () => {
    for (const motif of [bare, { variant: 'act1', tempoScale: 0.94 } as MotifRequest]) {
      const r = runMotifJob({ id: 7, motif, seed: SEED });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const main = renderMotif(motif, SEED);
      expect(r.id).toBe(7);
      expect(r.sampleRate).toBe(main.sampleRate);
      expect(Buffer.from(r.data.buffer).equals(Buffer.from(main.data.buffer)), motif.variant).toBe(true);
      expect(r.hash).toBe(pcmHash(main.data));
      expect(r.ms).toBeGreaterThan(0);
    }
  });

  it('reports an error instead of throwing', () => {
    const r = runMotifJob({ id: 3, motif: { variant: 'nope' as MotifRequest['variant'], tempoScale: 1 }, seed: SEED });
    expect(r.ok).toBe(false);
    expect(r.id).toBe(3);
  });

  it('slowdown (measurement only) keeps the worker busy that many times as long, the samples unchanged', () => {
    runMotifJob({ id: 0, motif: bare, seed: SEED });
    const plain = runMotifJob({ id: 1, motif: bare, seed: SEED });
    const slow = runMotifJob({ id: 2, motif: bare, seed: SEED, slowdown: 3 });
    expect(plain.ok && slow.ok).toBe(true);
    if (!plain.ok || !slow.ok) return;
    expect(slow.ms).toBeGreaterThan(1.8 * plain.ms);
    expect(slow.hash).toBe(plain.hash);
  });
});

/** A Worker that answers when the test says, with the real job. */
function fakeWorker() {
  const posted: MotifJob[] = [];
  const state = { made: 0, terminated: 0, w: null as WorkerLike | null };
  const make = (): WorkerLike => {
    state.made++;
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (job) => void posted.push(job),
      terminate: () => void state.terminated++,
    };
    state.w = w;
    return w;
  };
  const reply = (r: MotifReply): void => state.w!.onmessage!({ data: r });
  const answer = (): void => reply(runMotifJob(posted.shift()!));
  return { make, posted, state, reply, answer };
}

function manualTimers() {
  let next = 1;
  const due = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => {
      due.set(next, fn);
      return next++;
    },
    clearTimer: (id: unknown) => void due.delete(id as number),
    fireAll: () => {
      const fns = [...due.values()];
      due.clear();
      for (const f of fns) f();
    },
    count: () => due.size,
  };
}

describe('workerMotifRenderer (the main-thread side)', () => {
  it('makes the worker on the first render, posts the job and hands back what it renders', () => {
    const f = fakeWorker();
    const t = manualTimers();
    const r = workerMotifRenderer(f.make, t);
    expect(f.state.made).toBe(0);
    const got: (MotifRender | Error)[] = [];
    r.render(bare, SEED, (x) => got.push(x));
    expect(f.state.made).toBe(1);
    expect(f.posted).toEqual([{ id: 1, motif: bare, seed: SEED }]);
    expect(t.count()).toBe(1);
    f.answer();
    expect(t.count()).toBe(0);
    expect(got).toHaveLength(1);
    const res = got[0] as MotifRender;
    expect(res.hash).toBe(pcmHash(renderMotif(bare, SEED).data));
    r.render(bare, SEED, (x) => got.push(x));
    expect(f.state.made).toBe(1);
    expect(f.posted[0].id).toBe(2);
  });

  it('passes a slowdown on to the job (measurement only)', () => {
    const f = fakeWorker();
    workerMotifRenderer(f.make, { ...manualTimers(), slowdown: 2 }).render(bare, SEED, () => undefined);
    expect(f.posted[0].slowdown).toBe(2);
  });

  it('a worker error, a failed job, no answer in time or a worker that cannot be made: an Error, then every later render gets one at once', () => {
    const cases: [string, (f: ReturnType<typeof fakeWorker>, t: ReturnType<typeof manualTimers>) => void, RegExp][] = [
      ['error event', (f) => f.state.w!.onerror!({ message: 'boom' }), /motif worker error: boom/],
      ['job failed', (f) => f.reply({ id: 1, ok: false, error: 'bad score' }), /motif worker: bad score/],
      ['timeout', (_f, t) => t.fireAll(), new RegExp(`no answer in ${MOTIF_WORKER_TIMEOUT_MS / 1000} s`)],
    ];
    for (const [name, breakIt, msg] of cases) {
      const f = fakeWorker();
      const t = manualTimers();
      const r = workerMotifRenderer(f.make, t);
      const got: (MotifRender | Error)[] = [];
      r.render(bare, SEED, (x) => got.push(x));
      breakIt(f, t);
      expect(got.length, name).toBe(1);
      expect(got[0], name).toBeInstanceOf(Error);
      expect((got[0] as Error).message, name).toMatch(msg);
      expect(f.state.terminated, name).toBe(1);
      r.render(bare, SEED, (x) => got.push(x));
      expect(got.length, name).toBe(2);
      expect(got[1], name).toBeInstanceOf(Error);
      expect(f.posted.length, name).toBe(1);
      // A late answer from the old worker changes nothing.
      expect(t.count(), name).toBe(0);
    }
    const r = workerMotifRenderer(() => {
      throw new Error('file:// cannot start a worker');
    }, manualTimers());
    const got: (MotifRender | Error)[] = [];
    r.render(bare, SEED, (x) => got.push(x));
    expect((got[0] as Error).message).toMatch(/file:\/\/ cannot start a worker/);
  });
});
