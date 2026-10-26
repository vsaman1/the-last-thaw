/**
 * The AudioContext's life (DESIGN §4): unlock on a user gesture, suspend while the tab is hidden,
 * recover from a closed or interrupted context.
 *
 *   locked ──gesture with activation──► starting ──statechange running──► running
 *     ▲                                    │ not running within 1 s (an Escape press grants no activation)
 *     └────────────────────────────────────┘ (the context is kept; the next gesture resumes it)
 *   running ──hidden──► (gate down, suspend 60 ms later) suspended ──visible──► resume ──► running
 *                                                                     not running within 1 s ──► locked
 *   any ──closed / interrupted──► locked (a closed context is rebuilt on the next gesture)
 *
 * The gesture listeners (capture phase, passive, on window) stay armed until the context actually
 * runs, and are re-armed whenever it stops running for a reason other than a hidden tab. A context
 * is only constructed when the gesture carries user activation (navigator.userActivation.isActive,
 * where the browser has it), so Chrome never logs "The AudioContext was not allowed to start".
 */
import type { ContextStatus } from '../contract';

export const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'] as const;
/** How long 'starting' (or a resume after a hidden tab) may take before the gestures re-arm. */
export const START_TIMEOUT_MS = 1000;
/** The master gate falls first; the context is suspended this long after the tab hides. */
export const SUSPEND_DELAY_MS = 60;

export interface ContextTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const realTimers: ContextTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type GestureTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface ContextControllerOptions {
  /** Where the gesture listeners go (window); null = none (callers unlock explicitly). */
  readonly target: GestureTarget | null;
  readonly create: () => AudioContext;
  /** True when the current event grants user activation (default: navigator.userActivation). */
  readonly hasActivation?: () => boolean;
  readonly timers?: ContextTimers;
  /** A context was constructed: build the graph on it. */
  readonly onCreated: (ctx: AudioContext) => void;
  /** The context runs (first time, or again after a suspend): attach the bank, start bakes. */
  readonly onRunning: (ctx: AudioContext) => void;
  /** The tab hides (before the suspend) and shows again. */
  readonly onHide: (ctx: AudioContext) => void;
  readonly onShow: (ctx: AudioContext) => void;
  /** The context closed: forget everything built on it. */
  readonly onClosed: (ctx: AudioContext) => void;
  /** A user gesture arrived while locked (the music unlock rides on the same stack). */
  readonly onGesture?: () => void;
  readonly onStatus?: (status: ContextStatus, note: string) => void;
}

export function browserActivation(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua === undefined || ua.isActive !== false;
}

export class ContextController {
  status: ContextStatus = 'locked';
  ctx: AudioContext | null = null;
  private armed = false;
  private hidden = false;
  private disposed = false;
  private startTimer: unknown = null;
  private suspendTimer: unknown = null;
  /** Bumped by every resume attempt: a stale timer does nothing. */
  private generation = 0;
  private readonly timers: ContextTimers;
  private readonly hasActivation: () => boolean;
  private readonly onState = (): void => this.handleState();
  /** Synthetic events grant no activation, so hasActivation() already turns them away. */
  private readonly onGestureEvent = (): void => {
    this.options.onGesture?.();
    this.unlock();
  };

  constructor(private readonly options: ContextControllerOptions) {
    this.timers = options.timers ?? realTimers;
    this.hasActivation = options.hasActivation ?? browserActivation;
    this.arm();
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** From a trusted gesture handler. Returns true when a start is under way or done. */
  unlock(): boolean {
    if (this.disposed) return false;
    if (this.status === 'running') return true;
    if (this.hidden) return false;
    if (!this.hasActivation()) return false;
    if (this.ctx === null || this.ctx.state === 'closed') {
      let ctx: AudioContext;
      try {
        ctx = this.options.create();
      } catch (err) {
        this.setStatus('locked', `AudioContext construction failed: ${String(err)}`);
        return false;
      }
      this.ctx = ctx;
      ctx.addEventListener('statechange', this.onState);
      this.options.onCreated(ctx);
    }
    const ctx = this.ctx;
    this.setStatus('starting', 'gesture');
    this.resume(ctx);
    if (ctx.state === 'running') this.toRunning();
    return true;
  }

  setHidden(hidden: boolean): void {
    if (this.disposed || hidden === this.hidden) return;
    this.hidden = hidden;
    const ctx = this.ctx;
    if (ctx === null || ctx.state === 'closed') return;
    if (hidden) {
      this.clear('start');
      this.options.onHide(ctx);
      this.clear('suspend');
      this.suspendTimer = this.timers.setTimeout(() => {
        this.suspendTimer = null;
        if (!this.hidden || this.ctx !== ctx) return;
        ctx.suspend().catch(() => undefined);
        if (this.status === 'running' || this.status === 'starting') this.setStatus('suspended', 'hidden');
      }, SUSPEND_DELAY_MS);
      return;
    }
    this.clear('suspend');
    this.options.onShow(ctx);
    if (ctx.state === 'running') {
      // The suspend never happened (a quick switch back), or the browser resumed it meanwhile.
      this.toRunning();
      return;
    }
    if (this.status === 'locked') return; // never ran: the gestures are still armed
    this.setStatus('starting', 'visible');
    this.resume(ctx);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.disarm();
    this.clear('start');
    this.clear('suspend');
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx !== null) {
      ctx.removeEventListener('statechange', this.onState);
      if (ctx.state !== 'closed') await ctx.close().catch(() => undefined);
    }
  }

  private resume(ctx: AudioContext): void {
    const gen = ++this.generation;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      // a resume() that throws is treated like one that never completes
    }
    this.clear('start');
    this.startTimer = this.timers.setTimeout(() => {
      this.startTimer = null;
      if (gen !== this.generation || this.ctx !== ctx || this.disposed) return;
      if (ctx.state !== 'running' && !this.hidden) {
        this.setStatus('locked', 'not running 1 s after a resume: waiting for the next gesture');
        this.arm();
      }
    }, START_TIMEOUT_MS);
  }

  private handleState(): void {
    const ctx = this.ctx;
    if (ctx === null || this.disposed) return;
    const state = ctx.state as AudioContextState | 'interrupted';
    if (state === 'running') {
      if (this.hidden) {
        ctx.suspend().catch(() => undefined);
        return;
      }
      this.toRunning();
    } else if (state === 'suspended') {
      if (this.hidden) this.setStatus('suspended', 'hidden');
      else if (this.status === 'running') {
        this.setStatus('locked', 'suspended by the browser');
        this.arm();
      }
    } else if (state === 'closed') {
      ctx.removeEventListener('statechange', this.onState);
      this.ctx = null;
      this.clear('start');
      this.setStatus('locked', 'closed');
      this.arm();
      this.options.onClosed(ctx);
    } else {
      this.setStatus('locked', String(state));
      this.arm();
    }
  }

  private toRunning(): void {
    this.clear('start');
    const ctx = this.ctx;
    if (ctx === null || this.status === 'running') return;
    this.setStatus('running', 'running');
    this.disarm();
    this.options.onRunning(ctx);
  }

  private setStatus(status: ContextStatus, note: string): void {
    if (status === this.status) return;
    this.status = status;
    this.options.onStatus?.(status, note);
  }

  private arm(): void {
    const t = this.options.target;
    if (this.armed || t === null || this.disposed) return;
    for (const e of GESTURE_EVENTS) t.addEventListener(e, this.onGestureEvent, { capture: true, passive: true });
    this.armed = true;
  }

  private disarm(): void {
    const t = this.options.target;
    if (!this.armed || t === null) return;
    for (const e of GESTURE_EVENTS) t.removeEventListener(e, this.onGestureEvent, { capture: true });
    this.armed = false;
  }

  private clear(which: 'start' | 'suspend'): void {
    const id = which === 'start' ? this.startTimer : this.suspendTimer;
    if (id !== null) this.timers.clearTimeout(id);
    if (which === 'start') this.startTimer = null;
    else this.suspendTimer = null;
  }
}
