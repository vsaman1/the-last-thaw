import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import type { CliffDef, ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { LOGIC_RULES, validateWorldLogic, type LogicRule } from './logic';
import { validateFeatures, validateLevel } from './validate';

/**
 * World logic (./logic.ts), one rule at a time, each with a case that breaks it and one that keeps
 * it. Analytic terrain: a 0.05 slope along +z (s = z, d = -x; floor half-width 60), a GORGE across
 * it at s 190-210 (14 m deep), roads that end in marked turning circles unless a case says not.
 */

const cutAt = (z: number): number => {
  const q = Math.abs(z - 200);
  return q <= 10 ? 14 : q < 11 ? 14 * (11 - q) : 0;
};
const slope =
  (k = 0.05) =>
  (_x: number, z: number): number =>
    60 - k * z;
const gorge =
  (k = 0.05) =>
  (x: number, z: number): number =>
    slope(k)(x, z) - cutAt(z);

interface Setup {
  obstacles?: ObstaclePlacement[];
  features?: TerrainFeature[];
  height?: (x: number, z: number) => number;
  seaLevel?: number;
  coastS?: number;
  cliffs?: CliffDef[];
}

function terrain(o: Setup): Terrain {
  return createAnalyticTerrain({
    height: o.height ?? gorge(),
    halfWidth: 60,
    width: 200,
    length: 420,
    cellSize: 1,
    seaLevel: o.seaLevel,
    level: {
      obstacles: o.obstacles ?? [],
      features: o.features ?? [],
      cliffs: o.cliffs ?? [],
      theme: 'town',
      ...(o.coastS !== undefined ? { coastS: o.coastS } : {}),
    },
  });
}

/** "severity:rule:area index" for every issue. */
const found = (t: Terrain): string[] =>
  validateWorldLogic(t).map((i) => `${i.severity}:${i.rule}:${i.area} ${i.index}`);
const has = (t: Terrain, rule: LogicRule): boolean => validateWorldLogic(t).some((i) => i.rule === rule);
/** found() on the plain 0.05 slope (no gorge). */
const on = (o: Setup): string[] => found(terrain({ height: slope(), ...o }));

/** A road down the course on each rim, up to the bridge ends (s 185 and 215). */
const RIM_ROADS: TerrainFeature[] = [
  { type: 'road', s0: 60, s1: 185, d: 0, width: 8, start: 'turning' },
  { type: 'road', s0: 215, s1: 380, d: 0, width: 8, end: 'turning' },
];
const BRIDGE: ObstaclePlacement = { kind: 'roadBridge', s: 200, d: 0, yaw: Math.PI / 2, span: 30 };

describe('bridges', () => {
  it('a road bridge from rim to rim with a road at each end is fine', () => {
    expect(found(terrain({ obstacles: [BRIDGE], features: RIM_ROADS }))).toEqual([]);
  });

  it('bridge-crossing: a bridge over nothing (its deck 8 m up, both ends in the air)', () => {
    const t = terrain({ obstacles: [{ kind: 'roadBridge', s: 100, d: 0, span: 40 }], height: slope() });
    const i = validateWorldLogic(t);
    expect(i.map((x) => x.rule)).toEqual(['bridge-crossing']);
    expect(i[0].severity).toBe('error');
    expect(i[0].problem).toMatch(/crosses nothing/);
  });

  it('bridge-end: an end over the ravine (inside its cut) hangs in the air', () => {
    const base = terrain({ obstacles: [{ ...BRIDGE, span: 18 }], features: RIM_ROADS });
    const t: Terrain = { ...base, ravineDepthAt: (_x, z) => cutAt(z) };
    const ends = validateWorldLogic(t).filter((i) => i.rule === 'bridge-end');
    expect(ends).toHaveLength(2);
    expect(ends[0].problem).toMatch(/m above the ground/);
    expect(ends.every((i) => i.severity === 'error')).toBe(true);
  });

  it('bridge-end: a footbridge ending in a stream channel', () => {
    const stream: TerrainFeature = {
      type: 'stream',
      points: [
        { s: 100, d: -30 },
        { s: 300, d: -30 },
      ],
      width: 12,
      bank: 2,
    };
    // A footbridge across the gorge whose end lands in the stream's channel: the rule fires;
    // move the stream aside and it does not.
    const fb: ObstaclePlacement = { kind: 'footbridge', s: 200, d: -30, yaw: Math.PI / 2, span: 30 };
    expect(has(terrain({ obstacles: [fb], features: [stream] }), 'bridge-end')).toBe(true);
    const aside = { ...stream, points: stream.points.map((p) => ({ ...p, d: 30 })) };
    expect(has(terrain({ obstacles: [fb], features: [aside] }), 'bridge-end')).toBe(false);
  });

  it('bridge-grade: rims 6 m apart over 30 m (20 %) is too steep; 1.5 m (5 %) is fine', () => {
    const steep = terrain({ obstacles: [BRIDGE], features: RIM_ROADS, height: gorge(0.2) });
    const i = validateWorldLogic(steep).filter((x) => x.rule === 'bridge-grade');
    expect(i).toHaveLength(1);
    expect(i[0].problem).toMatch(/grade 20 %/);
    expect(has(terrain({ obstacles: [BRIDGE], features: RIM_ROADS }), 'bridge-grade')).toBe(false);
  });

  it('bridge-ground: a rock in the gorge rising into the deck', () => {
    const rock = (x: number, z: number): number => gorge()(x, z) + (Math.abs(z - 200) < 2 ? 15 : 0);
    const i = validateWorldLogic(terrain({ obstacles: [BRIDGE], features: RIM_ROADS, height: rock }));
    expect(i.filter((x) => x.rule === 'bridge-ground')).toHaveLength(1);
  });

  it('bridge-road: a road bridge needs a road at each end; a footbridge does not', () => {
    const one = terrain({ obstacles: [BRIDGE], features: [RIM_ROADS[0]] });
    const i = validateWorldLogic(one).filter((x) => x.rule === 'bridge-road');
    expect(i).toHaveLength(1);
    expect(i[0].s).toBeCloseTo(215, 0);
    const fb = terrain({ obstacles: [{ ...BRIDGE, kind: 'footbridge' }] });
    expect(found(fb)).toEqual([]);
  });

  it('bridge-road (warning): a carved street over the deck', () => {
    const over: TerrainFeature = {
      type: 'street',
      points: [
        { s: 185, d: 0 },
        { s: 215, d: 0 },
      ],
      width: 8,
    };
    const i = validateWorldLogic(terrain({ obstacles: [BRIDGE], features: [...RIM_ROADS, over] }));
    expect(i.map((x) => `${x.severity}:${x.rule}`)).toEqual(['warning:bridge-road']);
    const ok = terrain({ obstacles: [BRIDGE], features: [...RIM_ROADS, { ...over, carve: false }] });
    expect(found(ok)).toEqual([]);
  });
});

describe('road ends', () => {
  const field: TerrainFeature = { type: 'road', s0: 60, s1: 150, d: 20, width: 8, start: 'turning' };

  it('road-end: a road that stops in a field', () => {
    const i = validateWorldLogic(terrain({ features: [field], height: slope() }));
    expect(i.map((x) => `${x.rule}:${x.area} ${x.index}`)).toEqual(['road-end:feature 0']);
    expect(i[0].s).toBeCloseTo(150, 0);
    expect(i[0].problem).toMatch(/meets no other road/);
  });

  it('marked ends, junctions, parking, buildings, the wall and the coast are all fine ends', () => {
    const ok = (o: Setup): void => expect(has(terrain({ height: slope(), ...o }), 'road-end')).toBe(false);
    ok({ features: [{ ...field, end: 'turning' }] });
    ok({ features: [{ ...field, end: 'trailhead' }] });
    // A T into a cross street (its own ends run into the valley walls).
    ok({
      features: [
        field,
        { type: 'street', points: [{ s: 150, d: -60 }, { s: 150, d: 60 }], width: 8 },
      ],
    });
    ok({ features: [field, { type: 'parking', s: 160, d: 20, length: 16, width: 16 }] });
    ok({ features: [field], obstacles: [{ kind: 'house', s: 170, d: 25 }] });
    ok({ features: [{ ...field, s1: 150, d: 58 }] });
    ok({ features: [{ ...field, s1: 405 }], coastS: 410 });
  });

  it('a spur past its last junction: ≤ 15 m is a drive, longer is a dead end', () => {
    const cross = (end: number): TerrainFeature => ({
      type: 'street',
      points: [
        { s: 150, d: -60 },
        { s: 150, d: end },
      ],
      width: 8,
    });
    const main: TerrainFeature = { ...field, s1: 300, end: 'turning' };
    expect(has(terrain({ features: [main, cross(32)], height: slope() }), 'road-end')).toBe(false);
    const long = validateWorldLogic(terrain({ features: [main, cross(50)], height: slope() }));
    expect(long.map((x) => x.rule)).toEqual(['road-end']);
    expect(long[0].problem).toMatch(/runs 30\.0 m past its last junction/);
  });
});

describe('rail', () => {
  const bed = (s0: number, s1: number, marks = true): TerrainFeature => ({
    type: 'road',
    s0,
    s1,
    d: 20,
    width: 6,
    surface: 'rail',
    ...(marks ? { start: 'buffer' as const, end: 'buffer' as const } : {}),
  });
  /** Yaw 0: a wagon's length (local +z) along the course, so along a bed that runs along it. */
  const wagon = (s: number, yaw = 0): ObstaclePlacement => ({ kind: 'railWagon', s, d: 20, yaw });

  it('wagons along a 60 m bed with buffer stops at both ends are fine', () => {
    expect(on({ features: [bed(100, 160)], obstacles: [wagon(115), wagon(145)] })).toEqual([]);
  });

  it('rail-short / rail-wagon: a wagon on 20 m of track overhangs it', () => {
    const t = terrain({ features: [bed(100, 106)], obstacles: [wagon(103)], height: slope() });
    const i = validateWorldLogic(t);
    expect(i.map((x) => x.rule).sort()).toEqual(['rail-short', 'rail-wagon']);
    expect(i.find((x) => x.rule === 'rail-wagon')?.problem).toMatch(/overhangs the end of its track bed/);
  });

  it('rail-wagon: a wagon standing across its track', () => {
    const t = terrain({ features: [bed(100, 160)], obstacles: [wagon(130, Math.PI / 2)], height: slope() });
    const i = validateWorldLogic(t);
    expect(i.map((x) => x.rule)).toEqual(['rail-wagon']);
    expect(i[0].problem).toMatch(/90° across/);
  });

  it('rail-end: a track bed that stops mid-field (and is fine into the wall)', () => {
    const i = validateWorldLogic(terrain({ features: [bed(100, 160, false)], height: slope() }));
    expect(i.map((x) => x.rule)).toEqual(['rail-end', 'rail-end']);
    const walls: TerrainFeature = {
      type: 'street',
      points: [
        { s: 100, d: -60 },
        { s: 100, d: 60 },
      ],
      width: 6,
      surface: 'rail',
    };
    expect(on({ features: [walls] })).toEqual([]);
  });
});

describe('placement in context', () => {
  const road = (d: number): TerrainFeature => ({
    type: 'road',
    s0: 60,
    s1: 300,
    d,
    width: 8,
    start: 'turning',
    end: 'turning',
  });

  it('lighthouse-coast: on the coast fine, in the hills not', () => {
    const sea = (_x: number, z: number): number => 40 - 0.1 * z;
    const at = (s: number): Terrain =>
      terrain({ obstacles: [{ kind: 'lighthouse', s, d: 0 }], height: sea, seaLevel: 0, coastS: 400 });
    expect(found(at(330))).toEqual([]);
    expect(found(at(150))).toEqual(['error:lighthouse-coast:obstacle 0']);
    expect(LOGIC_RULES.lighthouseCoast).toBe(150);
  });

  it('lift-line / lift-slope: pylons in a line up the slope; alone, off the line, on the flat', () => {
    const pylon = (s: number, d = 20, yaw = 0): ObstaclePlacement => ({ kind: 'skiLiftPylon', s, d, yaw });
    const lift = (obstacles: ObstaclePlacement[], height = slope(0.2)): string[] =>
      found(terrain({ obstacles, height }));
    expect(lift([pylon(100), pylon(150), pylon(200)])).toEqual([]);
    expect(lift([pylon(100)])).toEqual(['error:lift-line:obstacle 0']);
    expect(lift([pylon(100), pylon(150, 35), pylon(200)])).toEqual(['warning:lift-line:obstacle 1']);
    // Its rope across the line of the lift.
    expect(lift([pylon(100), pylon(150, 20, Math.PI / 2), pylon(200)])).toEqual([
      'warning:lift-line:obstacle 1',
    ]);
    expect(lift([pylon(100), pylon(150), pylon(200)], () => 30)).toEqual(['warning:lift-slope:obstacle 0']);
  });

  it('open-ground: a pylon or wind turbine standing on a road', () => {
    const obstacles: ObstaclePlacement[] = [
      { kind: 'pylon', s: 150, d: 2 },
      { kind: 'windTurbine', s: 200, d: 30 },
    ];
    expect(on({ features: [road(0)], obstacles })).toEqual(['error:open-ground:obstacle 0']);
  });

  it('building-road: houses and barns within 60 m of a road are fine, a chalet 66 m away is not', () => {
    const obstacles: ObstaclePlacement[] = [
      { kind: 'house', s: 150, d: 0 },
      { kind: 'chalet', s: 200, d: 30 },
      { kind: 'barn', s: 250, d: 15 },
    ];
    expect(on({ features: [road(-40)], obstacles })).toEqual(['error:building-road:obstacle 1']);
  });

  it('fence-road: a fence across a road; a guardrail along its kerb is fine', () => {
    const obstacles: ObstaclePlacement[] = [
      { kind: 'fence', s: 150, d: 0, span: 30 },
      { kind: 'guardrail', s: 220, d: 4.8, yaw: Math.PI / 2, span: 40 },
    ];
    expect(on({ features: [road(0)], obstacles })).toEqual(['error:fence-road:obstacle 0']);
  });
});

describe('validateLevel and world logic', () => {
  it('includes the errors (area logic), not the warnings', () => {
    const pylon = (s: number, d = 20): ObstaclePlacement => ({ kind: 'skiLiftPylon', s, d });
    const lighthouse: ObstaclePlacement = { kind: 'lighthouse', s: 150, d: -20 };
    const obstacles = [pylon(100), pylon(150, 35), pylon(200), lighthouse];
    const t = terrain({ obstacles, height: slope(0.2) });
    const logic = validateLevel(t).filter((i) => i.area === 'logic');
    expect(logic).toHaveLength(1);
    expect(logic[0].problem).toMatch(/^\[lighthouse-coast\] obstacle 3 \(lighthouse\)/);
  });
});

describe('streets and cliff bands (validateFeatures)', () => {
  // A cliff band across d -60..0 at s 200: sheer only there.
  const band: CliffDef = { s: 200, drop: 8, d: -30, width: 60 };
  const street = (d: number): TerrainFeature => ({
    type: 'street',
    points: [
      { s: 100, d: -50 },
      { s: 150, d },
      { s: 300, d },
    ],
    width: 8,
  });

  it('flags a street only where it crosses the sheer part of a band, per segment', () => {
    const issues = (d: number): string[] =>
      validateFeatures(terrain({ features: [street(d)], cliffs: [band], height: slope() })).map(
        (i) => i.problem,
      );
    // Its first leg starts beside the band (d -50) but it crosses s 200 at d 30, round the band's end.
    expect(issues(30).filter((p) => /cliff/.test(p))).toEqual([]);
    expect(issues(-20).filter((p) => /cliff/.test(p))).toEqual([
      expect.stringMatching(/crosses the cliff at s=200/),
    ]);
  });
});

describe('stream sources (stream-source)', () => {
  type Stream = Extract<TerrainFeature, { type: 'stream' }>;
  const stream = (points: { s: number; d: number }[], over: Partial<Stream> = {}): Stream => ({
    type: 'stream',
    points,
    width: 14,
    bank: 3,
    ...over,
  });
  /** The stream-source problems of a level with these features on the plain slope (or `height`). */
  const sources = (features: TerrainFeature[], height = slope()): string[] =>
    validateWorldLogic(terrain({ features, height }))
      .filter((i) => i.rule === 'stream-source')
      .map((i) => `${i.index}: ${i.problem}`);
  /** The plain slope with a 15 m rock step (sheer at 1 m cells) rising upstream of s 100. */
  const step = (x: number, z: number): number => slope()(x, z) + (z < 100 ? 15 : 0);
  // The analytic glacier: spawn at s 10, snout at s ≈ 5 on the centre line, ≈ 1 at d 30.
  const meltwater = (d: number): Stream =>
    stream(
      [
        { s: -10, d },
        { s: 400, d },
      ],
      { source: 'glacier' },
    );

  it('a stream without a source rises out of open ground', () => {
    const plain = stream([
      { s: 60, d: 0 },
      { s: 400, d: 0 },
    ]);
    const p = sources([plain]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^0: rises out of open ground at \(s 60\.0, d 0\.0\)/);
    expect(p[0]).toMatch(/source: 'glacier'.*source: 'cave'.*source: 'branch'/);
    const all = validateWorldLogic(terrain({ features: [plain], height: slope() }));
    expect(all.find((i) => i.rule === 'stream-source')?.severity).toBe('error');
  });

  it("'glacier': rising under the ice and leaving through the snout clear of the socket is fine", () => {
    expect(sources([meltwater(30)])).toEqual([]);
    expect(sources([meltwater(-30)])).toEqual([]);
  });

  it("'glacier': a first point that is not under the ice", () => {
    const late = stream(
      [
        { s: 30, d: 30 },
        { s: 400, d: 30 },
      ],
      { source: 'glacier' },
    );
    const p = sources([late]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/is not under the glacier: start it under the ice — upstream of the snout/);
  });

  it("'glacier': a first point under the glacier's thin edge is not really under the ice", () => {
    // From under the edge (d 62: 0.1 m of ice) inward, out of the snout at d ≈ 36 (far from its lobe).
    const edge = stream(
      [
        { s: -14, d: 62 },
        { s: 0, d: 35 },
        { s: 400, d: 35 },
      ],
      { source: 'glacier' },
    );
    const p = sources([edge]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/lies under only 0\.\d m of the glacier's thin edge .* start it further in/);
    // Out through the snout's thin edge (d 60: 0.4 m of ice): even the lowest arch has no roof.
    const thin = stream(
      [
        { s: -14, d: 60 },
        { s: 400, d: 60 },
      ],
      { source: 'glacier' },
    );
    expect(sources([thin])).toEqual([
      expect.stringMatching(/the snout over its ice portal at d 60\.0 is \d\.\d m too thin .* nearer the middle/),
    ]);
  });

  it("'glacier': a portal that would cut into the iceberg's socket", () => {
    const p = sources([meltwater(4)]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/its ice portal .* reaches the iceberg's socket .* move the stream sideways/);
  });

  it("'cave': a spring at the foot of a rock step is fine, one in the open meadow is not", () => {
    // The first segment points away from the step (down the slope): the cave faces down it.
    const spring = stream(
      [
        { s: 112, d: 0 },
        { s: 140, d: 0 },
        { s: 400, d: 0 },
      ],
      { source: 'cave' },
    );
    expect(sources([spring], step)).toEqual([]);
    const p = sources([spring]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/cave mouth .* has no rock face behind it: the ground behind the mouth rises/);
    expect(p[0]).toMatch(/needs ≥ 6 m/);
    // Facing the step (its first segment points into it), the rock is in front, not behind.
    const backwards = stream(
      [
        { s: 130, d: 0 },
        { s: 102, d: 0 },
        { s: 102, d: 40 },
      ],
      { source: 'cave' },
    );
    expect(sources([backwards], step)).toHaveLength(1);
  });

  it("'branch': leaving another stream's channel is fine; outside one, or above its water, is not", () => {
    const parent = meltwater(30);
    const branch = (d0: number, bank = 3): Stream =>
      stream(
        [
          { s: 150, d: d0 },
          { s: 200, d: 0 },
          { s: 400, d: -20 },
        ],
        { width: 8, bank, source: 'branch' },
      );
    expect(sources([parent, branch(30)])).toEqual([]);
    expect(sources([parent, branch(-20)])).toEqual([
      expect.stringMatching(/^1: its first point .* is in no other stream's channel/),
    ]);
    // Banks of 1 m: its bed stands 0.8 m above the parent's water (3 m banks, 1.2 m deep).
    expect(sources([parent, branch(30, 1)])).toEqual([
      expect.stringMatching(/^1: its bed .* stands 0\.8 m above the water of stream feature 0/),
    ]);
  });

  it('a glacier-fed stream may start upstream of the spawn (and of s 0), but not beside it', () => {
    const issues = (f: Stream): string[] =>
      validateFeatures(terrain({ features: [f], height: slope() })).map((i) => i.problem);
    expect(issues(meltwater(30)).filter((p) => /start|outside|spawn/.test(p))).toEqual([]);
    expect(issues(meltwater(9)).filter((p) => /spawn/.test(p))).toEqual([
      expect.stringMatching(/its channel passes 2\.0 m from the spawn \(keep ≥ 4\.4 m/),
    ]);
    // Without a source the same stream is outside the course and too close to the start.
    const unsourced = issues({ ...meltwater(30), source: undefined });
    expect(unsourced.filter((p) => /outside the course|too close to the start/.test(p))).toHaveLength(2);
  });
});

describe('the ground in a road\'s lanes (road-ground)', () => {
  it('fails a rock reaching into the carriageway (Power Valley as it was) and passes the fixed level', async () => {
    const { powerValley } = await import('../levels/powerValley');
    const { createTerrain } = await import('./terrain');
    const roadGround = (t: Terrain) => validateWorldLogic(t).filter((i) => i.rule === 'road-ground');
    expect(roadGround(createTerrain(powerValley))).toEqual([]);
    // Slag heap S1 started at s 690 before 2026-10-21: its end cap reached into the plant street (f22).
    const features = (powerValley.features ?? []).map((f, i) =>
      i === 18 && f.type === 'ridge' ? { ...f, points: [{ s: 690, d: -62 }, { s: 830, d: -48 }] } : f,
    );
    const issues = roadGround(createTerrain({ ...powerValley, features }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', area: 'feature', index: 22, what: 'street' });
    expect(issues[0].problem).toMatch(/stands \d+(\.\d)? m above the road/);
    expect(LOGIC_RULES.roadLaneRise).toBe(3);
  }, 120_000);
});
