import { describe, expect, it } from 'vitest';
import { lastOnly } from './lastOnly';

describe('lastOnly', () => {
  it('reuses the value for the same key (a retry) and rebuilds for another (a new level)', () => {
    const builds: string[] = [];
    const levelA = { name: 'a' };
    const levelB = { name: 'b' };
    const chunksFor = lastOnly((t: { name: string }) => {
      builds.push(t.name);
      return { arrays: [new Float32Array(4)] };
    });
    const first = chunksFor(levelA);
    expect(chunksFor(levelA)).toBe(first);
    expect(builds).toEqual(['a']);
    const other = chunksFor(levelB);
    expect(other).not.toBe(first);
    // Only the latest level is held: coming back to A builds it again.
    expect(chunksFor(levelA)).not.toBe(first);
    expect(builds).toEqual(['a', 'b', 'a']);
  });

  it('a failed build caches nothing', () => {
    let fail = true;
    const get = lastOnly((k: object) => {
      if (fail) throw new Error('build failed');
      return { k };
    });
    const key = {};
    expect(() => get(key)).toThrow('build failed');
    fail = false;
    expect(get(key).k).toBe(key);
  });
});
