import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels';
import { createTerrain } from '../terrain/terrain';
import { validateLevel } from '../terrain/validate';
import { streamSandbox } from '../testing/streamSandbox';
import type { LevelDef, ObstaclePlacement, TerrainFeature } from '../types';
import { damProblems, streamProblems, validateDams } from './validate';

/**
 * The placement check for dams (a dam must hold back a stream: span its channel bank to bank) and
 * the stream checks, on the stream sandbox and variations of it; plus a report of every dam in the
 * registered levels that does not (they have no streams yet: designers are adding them).
 */

type Stream = Extract<TerrainFeature, { type: 'stream' }>;
const terrain = createTerrain(streamSandbox);
const dam = (over: Partial<ObstaclePlacement>): ObstaclePlacement => ({ kind: 'dam', s: 300, d: 0, ...over });
/** The stream runs at d = −1 at s 300 (from d −8 at s 200 to 6 at s 400), 14 m wide. */
const at300 = -1;

describe('dam placement check', () => {
  it('passes the sandbox: its dam spans the stream wall to wall', () => {
    expect(validateLevel(terrain)).toEqual([]);
    expect(validateDams(terrain)).toEqual([]);
  });

  it('passes a dam that spans the channel bank to bank, square or at an angle', () => {
    expect(damProblems(terrain, dam({ d: at300, span: 16 }))).toEqual([]);
    expect(damProblems(terrain, dam({ d: at300, span: 22, yaw: 0.6 }))).toEqual([]);
  });

  it('reports a dam that holds back no stream', () => {
    const p = damProblems(terrain, dam({ s: 300, d: 25, span: 10 }));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/stops short of stream \(feature 0\)|holds back no stream/);
    const far = damProblems(terrain, dam({ s: 1100, d: 30, span: 8 }));
    expect(far[0]).toMatch(/holds back no stream/);
  });

  it('reports a dam that does not reach both banks, or runs along the stream', () => {
    const short = damProblems(terrain, dam({ d: at300 + 4, span: 14 }));
    expect(short).toHaveLength(1);
    expect(short[0]).toMatch(/does not span stream \(feature 0\) bank to bank: needs 7\.\d m/);
    const along = damProblems(terrain, dam({ d: at300, span: 40, yaw: Math.PI / 2 - 0.2 }));
    expect(along[0]).toMatch(/runs along stream \(feature 0\)/);
  });

  it('is part of validateLevel (as an obstacle issue)', () => {
    const obstacles = [dam({ s: 300, d: 25, span: 8 })];
    const level: LevelDef = { ...streamSandbox, id: 'stream-bad-dam', obstacles };
    const issues = validateLevel(createTerrain(level));
    expect(issues.some((i) => i.area === 'obstacle' && /dam at s=300, d=25: /.test(i.problem))).toBe(true);
  });

  it('reports every dam of the registered levels that holds back no stream', () => {
    const report: string[] = [];
    for (const level of LEVELS) {
      for (const i of validateDams(createTerrain(level))) {
        report.push(`${level.id}: obstacle ${i.index} dam at s=${i.s}, d=${i.d}: ${i.problem}`);
      }
    }
    console.log(['Dams that hold back no stream:', ...report].join('\n  '));
    // (Not asserted: the level files are being redesigned with streams under their dams.)
    expect(Array.isArray(report)).toBe(true);
  }, 180_000);
});

describe('stream checks', () => {
  const base = streamSandbox.features![0] as Stream;
  const check = (over: Partial<Stream>): string[] => {
    const f: Stream = { ...base, ...over };
    const level: LevelDef = { ...streamSandbox, id: `stream-check-${JSON.stringify(over)}`, features: [f] };
    return streamProblems(createTerrain(level), f, 0);
  };

  it('accepts the sandbox streams', () => {
    expect(streamProblems(terrain, base, 0)).toEqual([]);
    expect(streamProblems(terrain, streamSandbox.features![1] as Stream, 1)).toEqual([]);
  });

  it('wants a channel wide and deep enough, water below its banks and a sane flow', () => {
    expect(check({ width: 3 })[0]).toMatch(/too narrow/);
    expect(check({ bank: 0.5, depth: 0.3 })[0]).toMatch(/banks too low/);
    expect(check({ depth: 2.8 })[0]).toMatch(/too deep for its banks/);
    expect(check({ flow: 20 })[0]).toMatch(/flow 20 m\/s/);
  });

  it('wants a sea end to reach the sea (or another stream), or the stream to end in a pool', () => {
    const short = [
      { s: 60, d: 0 },
      { s: 400, d: 6 },
    ];
    expect(check({ points: short })[0]).toMatch(/does not reach the sea or another stream/);
    expect(check({ points: short, end: 'pool' })).toEqual([]);
    // A tributary ending in the main stream is fine.
    const tributary: Stream = { ...base, points: [{ s: 300, d: -30 }, { s: 380, d: 4 }], width: 8 };
    const level: LevelDef = { ...streamSandbox, id: 'stream-tributary', features: [base, tributary] };
    expect(streamProblems(createTerrain(level), tributary, 1)).toEqual([]);
  });
});
