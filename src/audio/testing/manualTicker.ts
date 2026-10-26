/**
 * A manual clock for FadeTicker users (the music router, the engine's bus stepper), the same pattern
 * as music.test.ts: advance(ms) moves time in 50 ms steps and fires the tick while it runs.
 */
import type { FadeTicker } from '../music';

export class ManualTicker implements FadeTicker {
  t = 0;
  running = false;
  starts = 0;
  private onTick: (() => void) | null = null;

  now(): number {
    return this.t;
  }

  start(onTick: () => void): void {
    this.running = true;
    this.starts++;
    this.onTick = onTick;
  }

  stop(): void {
    this.running = false;
  }

  advance(ms: number, stepMs = 50): void {
    for (let left = ms; left > 0; left -= stepMs) {
      this.t += Math.min(stepMs, left);
      if (this.running) this.onTick?.();
    }
  }
}
