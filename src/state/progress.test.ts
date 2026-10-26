import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LevelDef, RunStats } from '../core/types';
import { loadJson } from './storage';
import {
  emptyProgress,
  isProgress,
  isUnlocked,
  mergeProgress,
  nextLevelId,
  recordCompletion,
  type Progress,
} from './progress';

const lvl = (id: string, index: number): LevelDef => ({ id, index }) as LevelDef;
// Deliberately out of display order: everything must sort by `index`.
const LEVELS = [lvl('c', 3), lvl('a', 1), lvl('b', 2)];

const stats = (levelId: string, time: number, score: number): RunStats => ({
  levelId,
  time,
  score,
  distance: 600,
  topSpeed: 25,
  knockedDown: 3,
  buildingsDestroyed: 0,
  treesFelled: 1,
  waterfallsCrossed: 1,
  collisions: 4,
  iceLeft: 1,
  absorbed: 0,
  peakMass: 30,
});

describe('isUnlocked', () => {
  it('only the first level is unlocked on a fresh save', () => {
    const p = emptyProgress();
    expect(isUnlocked(LEVELS, p, 'a')).toBe(true);
    expect(isUnlocked(LEVELS, p, 'b')).toBe(false);
    expect(isUnlocked(LEVELS, p, 'c')).toBe(false);
  });

  it('completing level n unlocks level n+1 only', () => {
    const p = recordCompletion(emptyProgress(), stats('a', 60, 1000));
    expect(isUnlocked(LEVELS, p, 'b')).toBe(true);
    expect(isUnlocked(LEVELS, p, 'c')).toBe(false);
  });

  it('unknown level ids are never unlocked', () => {
    expect(isUnlocked(LEVELS, emptyProgress(), 'nope')).toBe(false);
    expect(isUnlocked(LEVELS, emptyProgress(), 'nope', true)).toBe(false);
  });

  it('the unlock-all playtest setting opens every level on a fresh save', () => {
    const p = emptyProgress();
    for (const id of ['a', 'b', 'c']) expect(isUnlocked(LEVELS, p, id, true)).toBe(true);
  });
});

describe('recordCompletion', () => {
  it('first completion stores time and score', () => {
    const p = recordCompletion(emptyProgress(), stats('a', 71.3, 4200));
    expect(p.completed.a).toEqual({ bestTime: 71.3, bestScore: 4200, completions: 1 });
  });

  it('keeps the best time and best score independently', () => {
    let p = recordCompletion(emptyProgress(), stats('a', 70, 5000));
    p = recordCompletion(p, stats('a', 65, 4000)); // faster, lower score
    expect(p.completed.a).toEqual({ bestTime: 65, bestScore: 5000, completions: 2 });
    p = recordCompletion(p, stats('a', 90, 6000)); // slower, higher score
    expect(p.completed.a).toEqual({ bestTime: 65, bestScore: 6000, completions: 3 });
  });

  it('does not mutate the input progress', () => {
    const before = recordCompletion(emptyProgress(), stats('a', 70, 5000));
    const snapshot = JSON.stringify(before);
    recordCompletion(before, stats('a', 50, 9000));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('mergeProgress (two tabs, one save)', () => {
  const rec = (bestTime: number, bestScore: number, completions: number) => ({
    bestTime,
    bestScore,
    completions,
  });

  it('keeps the best of each field per level and the union of levels', () => {
    const a: Progress = { version: 1, completed: { a: rec(80, 1900, 1), b: rec(50, 10, 2) } };
    const b: Progress = { version: 1, completed: { a: rec(61, 2305, 3), c: rec(40, 5, 1) } };
    expect(mergeProgress(a, b).completed).toEqual({
      a: rec(61, 2305, 3),
      b: rec(50, 10, 2),
      c: rec(40, 5, 1),
    });
    expect(mergeProgress(b, a)).toEqual(mergeProgress(a, b));
  });

  it('drops malformed records instead of letting them reach the UI', () => {
    const bad = {
      version: 1,
      completed: {
        a: null,
        b: { bestTime: 'fast', bestScore: 1, completions: 1 },
        c: { bestTime: 0, bestScore: 1, completions: 1 },
        d: rec(70, 100, 1),
      },
    } as unknown as Progress;
    expect(isProgress(bad)).toBe(true); // the shape check alone lets these through
    expect(mergeProgress(bad, emptyProgress()).completed).toEqual({ d: rec(70, 100, 1) });
  });

  it('does not mutate its inputs', () => {
    const a: Progress = { version: 1, completed: { a: rec(80, 1900, 1) } };
    const snap = JSON.stringify(a);
    mergeProgress(a, { version: 1, completed: { a: rec(60, 3000, 4) } });
    expect(JSON.stringify(a)).toBe(snap);
  });
});

describe('nextLevelId', () => {
  it('follows display order and returns null after the last level', () => {
    expect(nextLevelId(LEVELS, 'a')).toBe('b');
    expect(nextLevelId(LEVELS, 'b')).toBe('c');
    expect(nextLevelId(LEVELS, 'c')).toBeNull();
    expect(nextLevelId(LEVELS, 'missing')).toBeNull();
  });
});

describe('stored progress validation', () => {
  const memoryStorage = (data: Record<string, string>): Storage =>
    ({
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
      removeItem: (k: string) => {
        delete data[k];
      },
      clear: () => undefined,
      key: () => null,
      length: 0,
    }) as Storage;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('isProgress rejects wrong shapes', () => {
    expect(isProgress(emptyProgress())).toBe(true);
    expect(isProgress(null)).toBe(false);
    expect(isProgress('x')).toBe(false);
    expect(isProgress({ version: 2, completed: {} })).toBe(false);
    expect(isProgress({ version: 1, completed: null })).toBe(false);
    expect(isProgress({ version: 1 })).toBe(false);
  });

  it('corrupt JSON, wrong shapes and throwing storage fall back to the default', () => {
    const fallback: Progress = emptyProgress();
    vi.stubGlobal('localStorage', memoryStorage({ k: '{not json' }));
    expect(loadJson('k', fallback, isProgress)).toBe(fallback);
    vi.stubGlobal('localStorage', memoryStorage({ k: '{"version":7,"completed":{}}' }));
    expect(loadJson('k', fallback, isProgress)).toBe(fallback);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(loadJson('k', fallback, isProgress)).toBe(fallback);
  });

  it('a valid save round-trips', () => {
    const saved = recordCompletion(emptyProgress(), stats('a', 70, 5000));
    vi.stubGlobal('localStorage', memoryStorage({ k: JSON.stringify(saved) }));
    expect(loadJson('k', emptyProgress(), isProgress)).toEqual(saved);
  });

  it('the app store boots with empty progress when the saved progress is corrupt', async () => {
    vi.stubGlobal(
      'localStorage',
      memoryStorage({
        'iceberg-river.progress.v1': '}}corrupt',
        'iceberg-river.settings.v1': '[]',
      }),
    );
    vi.resetModules();
    const { useAppStore, defaultSettings } = await import('./appStore');
    expect(useAppStore.getState().progress).toEqual(emptyProgress());
    expect(useAppStore.getState().settings).toEqual(defaultSettings);
  });
});
