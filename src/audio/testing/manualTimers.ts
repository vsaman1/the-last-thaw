/** setTimeout / clearTimeout on a manual clock (the context controller's and the manager's timers). */
import type { ContextTimers } from '../engine/context';

export class ManualTimers implements ContextTimers {
  t = 0;
  private nextId = 1;
  private queue: { id: number; at: number; fn: () => void }[] = [];

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  /** Move the clock forward, running every timer that falls due, in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.queue.filter((q) => q.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.queue = this.queue.filter((q) => q !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = end;
  }

  get pending(): number {
    return this.queue.length;
  }
}
