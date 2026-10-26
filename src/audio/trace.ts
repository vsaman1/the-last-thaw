/**
 * The debug trace: a ring of the last 4096 decisions (an event queued, a sound played or dropped and
 * why, a duck, a hold, a bell, a motif, a lifecycle change, an error). Entries are only built while
 * window.__icebergAudio is installed (SessionAudio.tracing), so normal play allocates nothing here.
 * Every entry gets a sequence number on the way in; trace(sinceSeq) returns what came after it.
 */
import { GLOBAL_LIMITS, type TraceEntry } from './contract';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class TraceRing {
  private readonly buf: (TraceEntry | undefined)[];
  private head = 0;
  private count = 0;
  private seq = 0;

  constructor(readonly capacity: number = GLOBAL_LIMITS.traceEntries) {
    this.buf = new Array<TraceEntry | undefined>(capacity);
  }

  /** Store an entry (its seq is assigned here) and return the stored copy. */
  push(entry: Omit<TraceEntry, 'seq'> & { seq?: number }): TraceEntry {
    const e = { ...entry, seq: ++this.seq } as Mutable<TraceEntry>;
    this.buf[this.head] = e;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
    return e;
  }

  /** Entries with seq > sinceSeq, oldest first. */
  since(sinceSeq = 0): TraceEntry[] {
    const out: TraceEntry[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const e = this.buf[(start + i) % this.capacity];
      if (e !== undefined && e.seq > sinceSeq) out.push(e);
    }
    return out;
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  get lastSeq(): number {
    return this.seq;
  }
}
