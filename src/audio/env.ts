/**
 * Where Web Audio may be used. False under node (no window), under jsdom (its user agent says so,
 * and it has no audio rendering), where neither AudioContext nor webkitAudioContext exists, and when
 * the page was loaded with ?audio=off (A/B performance runs: the game then runs with the null
 * manager, and only the recorded music still plays).
 */

/** The page's query string flags that concern audio (read once per call; cheap). */
export interface AudioQueryFlags {
  /** ?audio=off: no Web Audio at all. */
  readonly off: boolean;
  /** ?audiodebug=1: install window.__icebergAudio outside development builds too. */
  readonly debug: boolean;
  /** False with ?audioworker=off: motifs bake on the main thread (A/B runs of the fallback). */
  readonly worker: boolean;
  /**
   * ?audioworkerslow=N (measurement only, the browser driver's --cpu-throttle N): the motif worker
   * takes N times as long, as DevTools CPU throttling slows the page's main thread but not a worker.
   */
  readonly workerSlowdown: number;
}

const NO_FLAGS: AudioQueryFlags = { off: false, debug: false, worker: true, workerSlowdown: 1 };

export function audioQueryFlags(): AudioQueryFlags {
  try {
    if (typeof location === 'undefined') return NO_FLAGS;
    const q = new URLSearchParams(location.search);
    const slow = Number(q.get('audioworkerslow') ?? 1);
    return {
      off: q.get('audio') === 'off',
      debug: q.get('audiodebug') === '1',
      worker: q.get('audioworker') !== 'off',
      workerSlowdown: Number.isFinite(slow) && slow > 1 ? Math.min(slow, 16) : 1,
    };
  } catch {
    return NO_FLAGS;
  }
}

type AudioGlobals = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

/** The AudioContext constructor this browser offers, or null. */
export function audioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const g = globalThis as AudioGlobals;
  if (typeof g.AudioContext === 'function') return g.AudioContext;
  if (typeof g.webkitAudioContext === 'function') return g.webkitAudioContext;
  return null;
}

export function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent ?? '');
}

export function audioAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (isJsdom()) return false;
  if (audioContextClass() === null) return false;
  return !audioQueryFlags().off;
}
