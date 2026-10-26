import type { GameEvent } from './types';

type Listener = (e: GameEvent) => void;

/** Tiny synchronous event bus. One per running level. */
export class EventBus {
  private listeners = new Set<Listener>();
  /** Every event emitted this run, in order — kept for stats and future analysis. */
  readonly log: GameEvent[] = [];

  emit(e: GameEvent): void {
    this.log.push(e);
    for (const l of this.listeners) l(e);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  clear(): void {
    this.listeners.clear();
  }
}
