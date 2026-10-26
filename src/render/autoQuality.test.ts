import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY_WINDOW, median, nextAutoQuality, pacedInterval, percentile } from './autoQuality';

const frames = (ms: number, n = AUTO_QUALITY_WINDOW): number[] => Array.from({ length: n }, () => ms);

/** Deterministic jitter in [-amp, amp] (no Math.random: the tests must be reproducible). */
const jitter = (i: number, amp: number): number => amp * Math.sin(i * 12.9898 + 78.233);

/** `ms` per frame with ±amp jitter and a frame-time spike every `spikeEvery` frames. */
function paced(ms: number, amp = 0.4, spikeEvery = 23): number[] {
  return Array.from({ length: AUTO_QUALITY_WINDOW }, (_, i) =>
    i % spikeEvery === 0 ? ms * 2 : ms + jitter(i, amp),
  );
}

/** Frames that make or miss a vsync of `interval` ms: a fraction `missed` of them take two. */
function vsynced(interval: number, missed: number): number[] {
  return Array.from({ length: AUTO_QUALITY_WINDOW }, (_, i) =>
    ((i * 7919) % 100) / 100 < missed ? 2 * interval : interval,
  );
}

describe('auto quality', () => {
  it('stays on a machine holding 60 fps, even with a few spikes', () => {
    const f = frames(16.7);
    for (let i = 0; i < 20; i++) f[i * 7] = 40;
    expect(nextAutoQuality('high', f)).toBeNull();
  });

  it('steps down one tier at a time when frames are consistently slow', () => {
    expect(nextAutoQuality('high', frames(25))).toBe('medium');
    expect(nextAutoQuality('medium', frames(25))).toBe('low');
    expect(nextAutoQuality('low', frames(25))).toBeNull();
  });

  it('waits for a full window and ignores throttled background-tab frame times', () => {
    expect(nextAutoQuality('high', frames(25, AUTO_QUALITY_WINDOW - 1))).toBeNull();
    expect(nextAutoQuality('high', frames(1000))).toBeNull();
  });

  it('computes medians for odd and even lengths, and nearest-rank percentiles', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentile([5, 1, 4, 2, 3, 6, 7, 8, 9, 10], 0.1)).toBe(2);
    expect(percentile([5, 1, 4], 0)).toBe(1);
    expect(percentile([5, 1, 4], 1)).toBe(5);
  });

  describe('displays and browsers paced below 60 Hz', () => {
    it('a fast GPU on a 50 Hz display keeps its tier', () => {
      expect(pacedInterval(paced(20))).toBe(20);
      expect(nextAutoQuality('high', paced(20))).toBeNull();
    });

    it('a fast GPU in a browser capped at 30 fps (low-power / energy saver) keeps its tier', () => {
      expect(pacedInterval(paced(1000 / 30, 0.8))).toBeCloseTo(1000 / 30, 6);
      expect(nextAutoQuality('high', paced(1000 / 30, 0.8))).toBeNull();
      expect(nextAutoQuality('medium', paced(1000 / 30, 0.8))).toBeNull();
    });

    it('but steps down when frames miss even that pace', () => {
      expect(nextAutoQuality('high', vsynced(20, 0.6))).toBe('medium'); // 50 Hz, most frames late
      expect(nextAutoQuality('high', vsynced(1000 / 30, 0.6))).toBe('medium'); // capped and slow
    });
  });

  describe('a genuinely slow machine on a 60 Hz display', () => {
    it('steps down when frames keep missing vsync', () => {
      const f = vsynced(1000 / 60, 0.6);
      expect(pacedInterval(f)).toBeNull(); // the fastest frames still make 60 Hz
      expect(nextAutoQuality('high', f)).toBe('medium');
    });

    it('steps down when frames are uniformly slow with no vsync pace (e.g. 40 fps)', () => {
      expect(pacedInterval(paced(25))).toBeNull();
      expect(nextAutoQuality('high', paced(25))).toBe('medium');
    });

    it('stays when only a few frames miss', () => {
      expect(nextAutoQuality('high', vsynced(1000 / 60, 0.1))).toBeNull();
    });
  });
});
