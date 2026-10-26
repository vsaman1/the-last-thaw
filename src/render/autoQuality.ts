import type { RenderQuality } from '../state/appStore';

/** Frames per measurement window. */
export const AUTO_QUALITY_WINDOW = 150;
/** Median frame time above which 'auto' steps down (60 fps = 16.7 ms; leaves room for jitter). */
export const AUTO_QUALITY_SLOW_MS = 18.5;
/**
 * Medians above this are not GPU-bound frames but a throttled/background tab (or a debugger pause);
 * stepping down then would wrongly punish a fast machine.
 */
export const AUTO_QUALITY_THROTTLED_MS = 100;
/**
 * Frame intervals a fast machine can be locked to below 60 Hz: a 50 Hz display, or a browser capping
 * requestAnimationFrame at 30 fps (Safari Low Power Mode, Chrome Energy Saver). Holding that pace is
 * not slow, so it must not step quality down.
 */
export const PACED_INTERVALS_MS: readonly number[] = [1000 / 50, 1000 / 30];
/** How close (as a fraction) the fastest frames must be to one of those intervals to count as paced. */
const PACED_TOLERANCE = 0.08;
/** When paced, step down only if the median is this much slower than the pace (missed frames). */
export const AUTO_QUALITY_PACED_SLACK = 1.15;
/** The fastest frames show the pace the display (or cap) allows: this percentile of frame times. */
const PACE_PERCENTILE = 0.1;

const LOWER: Record<RenderQuality, RenderQuality | null> = { high: 'medium', medium: 'low', low: null };

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nearest-rank percentile (p in 0..1). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
}

/**
 * The display interval a window of frame times appears to be paced at, when its fastest frames sit
 * on a 50 Hz display's or a 30 fps cap's interval; null otherwise (a 60 Hz+ display, where the plain
 * threshold applies, or frames slow throughout with no pace, e.g. 40 fps on a GPU-bound machine).
 */
export function pacedInterval(frameMs: readonly number[]): number | null {
  const fast = percentile(frameMs, PACE_PERCENTILE);
  for (const t of PACED_INTERVALS_MS) if (Math.abs(fast - t) <= t * PACED_TOLERANCE) return t;
  return null;
}

/**
 * Given one window of frame times (ms) rendered at `current`, the tier 'auto' should switch to, or
 * null to stay. Only ever steps down, one tier per window. A window paced at 50 Hz or a 30 fps cap
 * steps down only when its median is clearly above that pace.
 *
 * Known limit: a GPU-bound machine whose every frame misses a 60 Hz vsync shows a steady 33 ms,
 * the same as a 30 fps cap, so it keeps its tier (at a steady 30 fps).
 */
export function nextAutoQuality(current: RenderQuality, frameMs: readonly number[]): RenderQuality | null {
  if (frameMs.length < AUTO_QUALITY_WINDOW) return null;
  const p50 = median(frameMs);
  if (p50 > AUTO_QUALITY_THROTTLED_MS) return null;
  const pace = pacedInterval(frameMs);
  const slow = pace === null ? AUTO_QUALITY_SLOW_MS : pace * AUTO_QUALITY_PACED_SLACK;
  if (!(p50 > slow)) return null;
  return LOWER[current];
}
