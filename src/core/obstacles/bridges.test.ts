import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import type { ObstaclePlacement, Terrain, TerrainFeature } from '../types';
import { Quaternion, Vector3 } from 'three';
import { validateWorldLogic } from '../terrain/logic';
import { getGeom, scaledPoints } from './shapes';
import { partsBounds, rotateVec, type BodySpec } from './specs';
import { buildObstacleSpecs } from './spawn';
import { getTerrain } from '../session';
import { LEVELS } from '../levels';
import { bridgePlans, placementFrame, trafficLines } from './bridges';
import { DECK_RULES, deckTopAt, FOOT_DECK, ROAD_DECK } from './structures/deck';

/**
 * Bridges that connect (./structures/deck.ts, ./bridges.ts): a deck runs from the ground at one end
 * to the ground at the other (ramped between uneven rims), abutments carry the road out to where
 * it meets the ground and hold the deck ends, piers stand on the real ground under them, and a road
 * bridge carries a street along its deck.
 *
 * Analytic terrain: a 0.05 slope along +z (s = z, d = -x) with a GORGE across it at s 200: 20 m
 * wide, 14 m deep, 1 m walls.
 */

const GORGE_DEPTH = 14;
const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;
const cutAt = (z: number): number => {
  const q = Math.abs(z - 200);
  return q <= 10 ? GORGE_DEPTH : q < 11 ? GORGE_DEPTH * (11 - q) : 0;
};
const slope = (cross = 0) => (x: number, z: number): number => 60 - 0.05 * z + cross * x;
const gorge = (cross = 0) => (x: number, z: number): number => slope(cross)(x, z) - cutAt(z);

function terrainWith(
  obstacles: ObstaclePlacement[],
  height: (x: number, z: number) => number = gorge(),
  features: TerrainFeature[] = [],
): Terrain {
  return createAnalyticTerrain({
    height,
    halfWidth: 60,
    width: 200,
    length: 420,
    cellSize: 1,
    level: { obstacles, features, theme: 'town' },
  });
}

/** Along the course over the gorge: ends at s 185 and s 215 on the rims. */
const ALONG: ObstaclePlacement = { kind: 'roadBridge', s: 200, d: 0, yaw: Math.PI / 2, span: 30 };

/** World AABB of the collider (non-decor) parts of a spec. */
type V = { x: number; y: number; z: number };
function worldBounds(spec: BodySpec): { min: V; max: V } {
  const { min, max } = partsBounds(spec.parts);
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  const c = { x: 0, y: 0, z: 0 };
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        rotateVec(spec.rotation, x, y, z, c);
        lo.x = Math.min(lo.x, c.x + spec.position.x);
        lo.y = Math.min(lo.y, c.y + spec.position.y);
        lo.z = Math.min(lo.z, c.z + spec.position.z);
        hi.x = Math.max(hi.x, c.x + spec.position.x);
        hi.y = Math.max(hi.y, c.y + spec.position.y);
        hi.z = Math.max(hi.z, c.z + spec.position.z);
      }
    }
  }
  return { min: lo, max: hi };
}

/** World height of a body's top face (its local top plane) over world (x, z). */
function topAt(spec: BodySpec, x: number, z: number): number {
  const { max } = partsBounds(spec.parts.filter((p) => !p.decor));
  const n = { x: 0, y: 0, z: 0 };
  rotateVec(spec.rotation, 0, 1, 0, n);
  const c = { x: 0, y: 0, z: 0 };
  rotateVec(spec.rotation, 0, max.y, 0, c);
  const px = spec.position.x + c.x;
  const py = spec.position.y + c.y;
  const pz = spec.position.z + c.z;
  return py - (n.x * (x - px) + n.z * (z - pz)) / n.y;
}

describe('road bridge: a deck from rim to rim', () => {
  it('meets the ground at both ends, ramped between rims 1.5 m apart, high over the gorge', () => {
    const t = terrainWith([ALONG]);
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('rims');
    for (const e of b.ends) {
      expect(Math.abs(e.top - e.ground - DECK_RULES.lift)).toBeLessThan(0.05);
      expect(Math.abs(e.s - 200)).toBeCloseTo(15, 1);
    }
    expect(Math.abs(b.grade)).toBeCloseTo(0.05, 2);
    expect(b.depthBelow).toBeGreaterThan(GORGE_DEPTH - ROAD_DECK.depth - 1);
    expect(b.intrusion.by).toBeLessThan(0);

    const specs = buildObstacleSpecs(t, 1);
    const decks = specs.filter((s) => s.part === 'deck');
    const abutments = specs.filter((s) => s.part === 'abutment');
    expect(abutments).toHaveLength(2);
    expect(decks.length).toBeGreaterThanOrEqual(1);
    // The running surface: straight from end to end, on the ground at both.
    const [e0, e1] = b.ends;
    const line = (z: number): number => e0.top + ((e1.top - e0.top) * (z - e0.z)) / (e1.z - e0.z);
    for (const d of decks) {
      expect(d.anchored).toBe(false);
      expect(d.breakMode).toBe('none');
      const w = worldBounds(d);
      for (const z of [w.min.z + 0.5, (w.min.z + w.max.z) / 2, w.max.z - 0.5]) {
        expect(Math.abs(topAt(d, 0, z) - line(z))).toBeLessThan(0.05);
      }
      // Over the gorge it is far above the floor: the iceberg passes under it.
      expect(w.min.y - t.heightAt(0, 200)).toBeGreaterThan(10);
    }
    for (const a of abutments) {
      expect(a.anchored).toBe(true);
      expect(a.breakImpulse).toBe(Infinity);
      expect(a.passable).toBe(true);
      const w = worldBounds(a);
      // Buried in the bank, its top carries the road on the line out past the end.
      expect(w.min.y).toBeLessThan(t.heightAt(0, (w.min.z + w.max.z) / 2) - 0.5);
      const zEnd = a.position.z < 200 ? b.ends.find((e) => e.z < 200)!.z : b.ends.find((e) => e.z > 200)!.z;
      expect(Math.abs(topAt(a, 0, zEnd) - line(zEnd))).toBeLessThan(0.05);
      expect(Math.abs(topAt(a, 0, zEnd) - t.heightAt(0, zEnd))).toBeLessThan(0.1);
    }
  });

  it('piers stand on the gorge floor and carry the deck; abutments hold the deck ends', () => {
    // A 40 m gorge: two bays over it, one pier in the middle.
    const wide = (x: number, z: number): number => {
      const q = Math.abs(z - 200);
      return 60 - 0.05 * z + 0.02 * x - (q <= 20 ? GORGE_DEPTH : q < 21 ? GORGE_DEPTH * (21 - q) : 0);
    };
    const t = terrainWith([{ ...ALONG, span: 50 }], wide);
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('rims');
    expect(b.plan.supports.map((s) => s.type)).toEqual(['abutment', 'pier', 'abutment']);
    const specs = buildObstacleSpecs(t, 1);
    const [pier] = specs.filter((s) => s.part === 'pier');
    const decks = specs.filter((s) => s.part === 'deck');
    expect(decks).toHaveLength(2);
    const pw = worldBounds(pier);
    expect(pw.min.y).toBeLessThan(t.heightAt(pier.position.x, pier.position.z));
    expect(pw.max.y - t.heightAt(pier.position.x, pier.position.z)).toBeGreaterThan(10);
    // Both deck undersides meet on the pier head (its tilted top face; its high corner is ≤ 0.1 m
    // above the middle on this 4 % grade).
    const drop = ROAD_DECK.depth * Math.hypot(1, b.grade);
    for (const d of decks) {
      const under = topAt(d, pier.position.x, pier.position.z) - drop;
      expect(Math.abs(under - pw.max.y)).toBeLessThan(0.12);
    }
  });

  it('uses the rim height (the uncut ground) at an end inside a ravine cut, and says so', () => {
    // The ends at s 191 and 209 fall inside the gorge.
    const base = terrainWith([{ ...ALONG, span: 18 }]);
    const cut: Terrain = { ...base, ravineDepthAt: (_x, z) => cutAt(z) };
    const [b] = bridgePlans(cut);
    expect(b.mode).toBe('rims');
    for (const e of b.ends) {
      // The deck stands at the rim's height; the ground under the end is the gorge floor.
      expect(e.top - (slope()(0, (e.z)) + DECK_RULES.lift)).toBeCloseTo(0, 1);
      expect(e.top - e.ground).toBeGreaterThan(GORGE_DEPTH - 1);
    }
    // Without the cut known, the ends sit on the floor and the deck has nothing to cross.
    expect(bridgePlans(base)[0].mode).toBe('floating');
  });

  it('a span that reaches the floor edge is the wall-to-wall viaduct: level, 8 m up, into the walls', () => {
    // A 40 m floor between walls rising at 1:1.
    const valley = (x: number): number => 5 + Math.max(0, Math.abs(x) - 20);
    const t = createAnalyticTerrain({
      height: valley,
      halfWidth: 20,
      width: 120,
      cellSize: 1,
      level: { obstacles: [{ kind: 'roadBridge', s: 80, d: 0 }] },
    });
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('walls');
    const top = 5 + ROAD_DECK.clearance + ROAD_DECK.depth;
    for (const e of b.ends) {
      expect(e.top).toBeCloseTo(top, 1);
      expect(Math.abs(e.top - e.ground)).toBeLessThan(0.1);
      // The wall reaches the deck 9.4 m past the floor edge.
      expect(Math.abs(e.d)).toBeCloseTo(20 + top - 5, 0);
    }
    const specs = buildObstacleSpecs(t, 1);
    // The floor piers stay where they were (bays of 20 m from wall to wall), abutments in the walls.
    const piers = specs.filter((s) => s.part === 'pier').map((s) => Math.round(s.position.x));
    expect(piers.sort((a, z) => a - z)).toEqual([-20, 0, 20]);
    expect(specs.filter((s) => s.part === 'abutment')).toHaveLength(2);
  });

  it('over nothing it is built the old way (floating): a level deck 8 m up, piers at both ends', () => {
    const t = terrainWith([{ kind: 'roadBridge', s: 100, d: 0, span: 40 }], slope());
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('floating');
    for (const e of b.ends) expect(e.top - e.ground).toBeGreaterThan(ROAD_DECK.clearance);
    const specs = buildObstacleSpecs(t, 1);
    expect(specs.filter((s) => s.part === 'abutment')).toHaveLength(0);
    expect(specs.filter((s) => s.part === 'pier')).toHaveLength(3);
  });
});

/** World positions of every collider (non-decor) hull point of a spec. */
function worldPoints(spec: BodySpec): V[] {
  const out: V[] = [];
  const v = new Vector3();
  const q = new Quaternion();
  const c = { x: 0, y: 0, z: 0 };
  for (const part of spec.parts) {
    if (part.decor) continue;
    const pts = scaledPoints(getGeom(part.geom), part.scale);
    q.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(q);
      rotateVec(spec.rotation, v.x + part.offset.x, v.y + part.offset.y, v.z + part.offset.z, c);
      out.push({ x: c.x + spec.position.x, y: c.y + spec.position.y, z: c.z + spec.position.z });
    }
  }
  return out;
}

describe('road bridge: skewed where the gap crosses the road at an angle', () => {
  /** Distance from the axis of a gorge turned `deg` from square to the road (through s 200, d 0). */
  const across = (deg: number, x: number, z: number): number => {
    const a = (deg * Math.PI) / 180;
    return Math.abs((z - 200) * Math.cos(a) - x * Math.sin(a));
  };
  /** That gorge: 20 m wide (the floor within 10 m of the axis), walls 1 m wide. */
  const oblique = (deg: number) => (x: number, z: number): number => {
    const q = across(deg, x, z);
    return 60 - 0.05 * z - (q <= 10 ? GORGE_DEPTH : q < 11 ? GORGE_DEPTH * (11 - q) : 0);
  };

  it('its ends run along the rims: abutments stop at the bank, the girder ends over the gap', () => {
    const t = terrainWith([{ ...ALONG, span: 48 }], oblique(35));
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('rims');
    expect((b.skew * 180) / Math.PI).toBeGreaterThan(30);
    expect((b.skew * 180) / Math.PI).toBeLessThan(40);
    const ends = [b.plan.supports[0], b.plan.supports[b.plan.supports.length - 1]];
    for (const e of ends) {
      expect(e.type).toBe('abutment');
      expect((Math.abs(Math.atan(e.skew)) * 180) / Math.PI).toBeGreaterThan(30);
    }
    // Both ends skew the same way (the rims are parallel), the pier between stays square.
    expect(Math.sign(ends[0].skew)).toBe(Math.sign(ends[1].skew));
    expect(b.intrusion.by).toBeLessThan(0);
    expect(b.depthBelow).toBeGreaterThan(GORGE_DEPTH - ROAD_DECK.depth - 1);
    // (No roads here: only the bridge-road rule may complain.)
    expect(validateWorldLogic(t).filter((i) => i.rule.startsWith('bridge') && i.rule !== 'bridge-road')).toEqual([]);

    const specs = buildObstacleSpecs(t, 1);
    const abutments = specs.filter((s) => s.part === 'abutment');
    expect(abutments).toHaveLength(2);
    // No corner of an abutment hangs over the gorge: its top lies on the bank everywhere (the
    // square block of the old build reached 3.7 m out over the edge at 35°).
    const [e0, e1] = b.ends;
    const line = (z: number): number => e0.top + ((e1.top - e0.top) * (z - e0.z)) / (e1.z - e0.z);
    for (const a of abutments) {
      // The block's top face carries the road on the deck line; every corner of it stands on the
      // bank or the top of the 1 m wall (a square block reaches out over the gorge on one side).
      const tops = worldPoints(a).filter((p) => p.y > line(p.z) - 0.1);
      expect(tops.length).toBeGreaterThanOrEqual(4);
      for (const p of tops) expect(across(35, p.x, p.z)).toBeGreaterThan(10.5);
    }
    // The decks: their underside clears the ground everywhere, and they reach the abutments' seats.
    const decks = specs.filter((s) => s.part === 'deck');
    for (const d of decks) {
      for (const p of worldPoints(d)) expect(t.heightAt(p.x, p.z)).toBeLessThan(p.y + 0.06);
    }
    const reach = (a: BodySpec): number =>
      Math.min(
        ...decks.map((d) => {
          const ap = worldPoints(a);
          return Math.min(...worldPoints(d).map((p) => Math.min(...ap.map((q) => Math.hypot(p.x - q.x, p.z - q.z)))));
        }),
      );
    for (const a of abutments) expect(reach(a)).toBeLessThan(0.1);
  });

  it('a square crossing stays square; a footbridge never skews; past 45° the logic check fails it', () => {
    const square = bridgePlans(terrainWith([{ ...ALONG, span: 44 }], oblique(0)))[0];
    expect(square.plan.supports.every((x) => x.skew === 0)).toBe(true);
    const foot = bridgePlans(terrainWith([{ ...ALONG, kind: 'footbridge', span: 44 }], oblique(25)))[0];
    expect(foot.plan.supports.every((x) => x.skew === 0)).toBe(true);
    expect((foot.skew * 180) / Math.PI).toBeGreaterThan(20);
    const steep = terrainWith([{ ...ALONG, span: 90 }], oblique(60));
    const issues = validateWorldLogic(steep).filter((i) => i.rule === 'bridge-skew');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  /** Bridge rules other than bridge-road (no roads in these terrains). */
  const bridgeIssues = (t: Terrain) =>
    validateWorldLogic(t).filter((i) => i.rule.startsWith('bridge') && i.rule !== 'bridge-road');
  it('a rim met close to the span end is still measured, and a deck edge over the gap is flagged', () => {
    // The ends `past` m beyond the rim on the road line: closer than tan(angle) × half the width,
    // one deck edge already lies over the gorge at the end (the old search started at the end
    // and fitted to the clipped point: 30° read 26.5°, 44° read 28.7°, and nothing was flagged).
    for (const [angle, past] of [[30, 2], [40, 2], [44, 0.3]]) {
      const span = 2 * (11 / Math.cos(rad(angle)) + past);
      const t = terrainWith([{ ...ALONG, span }], oblique(angle));
      const [b] = bridgePlans(t);
      expect(Math.abs(deg(b.skew) - angle), `${angle}°`).toBeLessThan(1.5);
      const need = Math.tan(rad(angle)) * (ROAD_DECK.width / 2) - past;
      for (const over of b.over) expect(over, `${angle}°`).toBeGreaterThan(need - 0.5);
      const ends = bridgeIssues(t).filter((i) => i.rule === 'bridge-end');
      expect(ends, `${angle}°`).toHaveLength(2);
      for (const i of ends) expect(i.problem).toMatch(/lengthen the span/);
      // At least tan(angle) × half the width past the rim (and a metre), no edge is over the gap.
      const ok = terrainWith([{ ...ALONG, span: span + 2 * (need + 1) }], oblique(angle));
      expect(bridgePlans(ok)[0].over).toEqual([0, 0]);
      expect(bridgeIssues(ok), `${angle}° long enough`).toEqual([]);
    }
    // Searched from beyond the end, a 55° rim still reads 55° and fails the 45° rule (it read 42.8°).
    const steep = terrainWith([{ ...ALONG, span: 2 * (11 / Math.cos(rad(55)) + 2) }], oblique(55));
    expect(deg(bridgePlans(steep)[0].skew)).toBeGreaterThan(54);
    expect(bridgeIssues(steep).filter((i) => i.rule === 'bridge-skew')).toHaveLength(1);
  });

  it('the rim angle follows the ground smoothly, so a footbridge fails the 30° rule only past 30°', () => {
    // Fine cells (0.25 m) so the gorge wall is where the formula puts it. Each edge line's crossing
    // is interpolated between samples; it used to be the first 0.25 m sample, so a 2.2 m footbridge
    // read only 0, 6.5, 12.8 … 29.6, 34.3° and 29-31° rims failed while 32-35° passed.
    for (const shift of [0, 0.1, 0.2]) {
      for (const angle of [27, 29, 30, 31, 33, 35]) {
        const t = createAnalyticTerrain({
          height: (x, z) => oblique(angle)(x, z + shift),
          halfWidth: 30,
          width: 60,
          length: 260,
          cellSize: 0.25,
          level: { obstacles: [{ ...ALONG, kind: 'footbridge', span: 44 }], features: [], theme: 'town' },
        });
        const [b] = bridgePlans(t);
        expect(Math.abs(deg(b.skew) - angle), `${angle}° shift ${shift}`).toBeLessThan(1.2);
        const fails = validateWorldLogic(t).some((i) => i.rule === 'bridge-skew');
        expect(fails, `${angle}° shift ${shift}`).toBe(angle > 30);
      }
    }
  });

  it('a shallow crossing is measured where the girder clears the bank (it read square at any angle)', () => {
    // A channel 2 m deep (16 m floor, 1 m walls): the ground never falls skewDrop under the
    // girder's underside, so the angle is measured on the lines the girder clears.
    const channel = (angle: number) => (x: number, z: number): number => {
      const q = across(angle, x, z);
      return 60 - 0.05 * z - (q <= 8 ? 2 : q < 9 ? 2 * (9 - q) : 0);
    };
    const gentle = terrainWith([{ ...ALONG, span: 64 }], channel(20));
    const [g] = bridgePlans(gentle);
    expect(Math.abs(deg(g.skew) - 20)).toBeLessThan(1.5);
    for (const s of [g.plan.supports[0], g.plan.supports[g.plan.supports.length - 1]]) {
      expect(Math.abs(deg(Math.atan(Math.abs(s.skew))) - 20)).toBeLessThan(1.5);
    }
    expect(bridgeIssues(gentle)).toEqual([]);
    const oblique60 = terrainWith([{ ...ALONG, span: 64 }], channel(60));
    expect(Math.abs(deg(bridgePlans(oblique60)[0].skew) - 60)).toBeLessThan(1.5);
    expect(bridgeIssues(oblique60).filter((i) => i.rule === 'bridge-skew')).toHaveLength(1);
  });

  it('the girder end clears the ground on every line across the deck: a narrow spur of bank', () => {
    // A 0.8 m spur of the upstream bank reaches 2.5 m into the gorge between where the old fit's
    // nine lines (1.31 m apart) looked; the skewed girder end must still clear it.
    const spur = (x: number, z: number): number => {
      const q = across(35, x, z);
      if (z < 200 && q >= 8.5 && q < 11 && Math.abs(x - 1) < 0.4) return 60 - 0.05 * z;
      return oblique(35)(x, z);
    };
    const t = terrainWith([{ ...ALONG, span: 48 }], spur);
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('rims');
    const f = placementFrame(t, t.level.obstacles[0], 0)!;
    const [a, e] = [b.plan.supports[0], b.plan.supports[b.plan.supports.length - 1]];
    const drop = ROAD_DECK.depth * Math.hypot(1, b.grade);
    let worst = -Infinity;
    for (let z = -ROAD_DECK.width / 2; z <= ROAD_DECK.width / 2 + 1e-9; z += 0.05) {
      for (let x = a.x + a.skew * z; x <= e.x + e.skew * z; x += 0.05) {
        worst = Math.max(worst, f.ctx.groundAt(x, z) - (deckTopAt(b.plan, x) - drop));
      }
    }
    expect(worst).toBeLessThan(-DECK_RULES.free + 0.02);
  });

  it('the logic check sees ground rising into the deck between the lines it used to sample', () => {
    // A rock 1.2 m across under the deck, 2 m off its centre line (the check sampled only the
    // centre line and both edges).
    const rock = (x: number, z: number): number =>
      Math.abs(x - 2) < 0.6 && Math.abs(z - 200) < 0.6 ? 60 - 0.05 * z - 1 : gorge()(x, z);
    const t = terrainWith([ALONG], rock);
    expect(bridgePlans(t)[0].intrusion.by).toBeGreaterThan(0.3);
    expect(bridgeIssues(t).filter((i) => i.rule === 'bridge-ground')).toHaveLength(1);
  });

  it('on a bowed rim the abutment block stops at the bank (only the seat carries on to the deck)', () => {
    // The upstream bank juts 1.5 m into the gorge in the middle of the road: the straight girder
    // end fitted along the rim must clear the jut, so it lies past the bank on the edge lines,
    // where the old block stood out over the drop by as much.
    const bowed = (x: number, z: number): number => {
      const floor = 10 - 1.5 * Math.max(0, 1 - (x / 7) ** 2);
      const q = across(35, x, z);
      return 60 - 0.05 * z - (q <= floor ? GORGE_DEPTH : q < floor + 1 ? GORGE_DEPTH * (floor + 1 - q) : 0);
    };
    const t = terrainWith([{ ...ALONG, span: 48 }], bowed);
    const [b] = bridgePlans(t);
    const lead = b.plan.supports[0];
    // The girder end (x0: toward +x is toward the gap) lies well past the bank on some line.
    expect(Math.max(...lead.bank!.map(([z, x]) => lead.x + lead.skew * z - x))).toBeGreaterThan(0.8);
    const specs = buildObstacleSpecs(t, 1);
    const [e0, e1] = b.ends;
    const line = (z: number): number => e0.top + ((e1.top - e0.top) * (z - e0.z)) / (e1.z - e0.z);
    const soffit = (z: number): number => line(z) - ROAD_DECK.depth * Math.hypot(1, b.grade);
    for (const a of specs.filter((s) => s.part === 'abutment')) {
      // Out over the drop stand only the road's cap and the seat under the deck end (about a
      // metre deep), never the block, which stood there all the way down to the gorge floor.
      for (const p of worldPoints(a)) {
        if (t.heightAt(p.x, p.z) > soffit(p.z) - 0.3) continue;
        expect(soffit(p.z) - p.y, `over the gorge at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBeLessThan(1.6);
      }
    }
  });
});

/**
 * How far each abutment's road face and the end deck's end face stand apart (m, along the deck,
 * in the abutment's frame: + a slot, − an overlap), at the x0 end then the x1 end of each road
 * bridge in `specs`.
 */
function joints(t: Terrain, specs: readonly BodySpec[]): { index: number; gaps: number[] }[] {
  const out: { index: number; gaps: number[] }[] = [];
  for (const b of bridgePlans(t)) {
    if (b.kind !== 'roadBridge' || b.mode === 'floating') continue;
    const mine = specs.filter((s) => s.kind === 'roadBridge' && s.placement === b.index);
    const decks = mine.filter((s) => s.part === 'deck');
    const abutments = mine.filter((s) => s.part === 'abutment');
    const tilt = Math.atan(b.grade);
    const gaps = abutments.map((a, i) => {
      const sup = i === 0 ? b.plan.supports[0] : b.plan.supports[b.plan.supports.length - 1];
      const k = sup.skew / Math.cos(tilt);
      const inv = new Quaternion(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w).invert();
      /** Along the deck in the abutment's frame, measured square to the (skewed) end face. */
      const key = (p: V): { u: number; z: number } => {
        const v = new Vector3(p.x - a.position.x, p.y - a.position.y, p.z - a.position.z).applyQuaternion(inv);
        return { u: v.x - k * v.z, z: v.z };
      };
      // The cap (the abutment's first part) carries the road to the deck end.
      const cap = worldPoints({ ...a, parts: [a.parts[0]] }).map((p) => key(p).u);
      const deck = decks
        .flatMap((d) => worldPoints(d))
        .map(key)
        .filter((q) => Math.abs(q.z) <= (ROAD_DECK.width / 2) * b.scale + 1e-6)
        .map((q) => q.u);
      if (i === 0) {
        const face = Math.max(...cap);
        return Math.min(...deck.filter((u) => u > face - 3)) - face;
      }
      const face = Math.min(...cap);
      return face - Math.max(...deck.filter((u) => u < face + 3));
    });
    out.push({ index: b.index, gaps });
  }
  return out;
}

describe('road bridge: deck ends meet the abutments', () => {
  it('on a 12 % grade, square and skewed, each deck end stands 1-2 cm off its abutment face', () => {
    // The face used to run through the road surface's end, so the deck end sat DECK_H·tan(tilt)
    // inside the block at the low end and left a slot as wide at the high end (17 cm here).
    const graded = (angle: number) => (x: number, z: number): number => {
      const q = Math.abs((z - 200) * Math.cos(rad(angle)) - x * Math.sin(rad(angle)));
      return 60 - 0.12 * z - (q <= 10 ? GORGE_DEPTH : q < 11 ? GORGE_DEPTH * (11 - q) : 0);
    };
    for (const angle of [0, 30]) {
      const t = terrainWith([{ ...ALONG, span: 44 }], graded(angle));
      expect(Math.abs(bridgePlans(t)[0].grade)).toBeGreaterThan(0.1);
      const [{ gaps }] = joints(t, buildObstacleSpecs(t, 1));
      expect(gaps).toHaveLength(2);
      for (const g of gaps) {
        expect(g, `${angle}°`).toBeGreaterThanOrEqual(0);
        expect(g, `${angle}°`).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('on every level, every road bridge end: within 2 cm, no overlap', () => {
    for (const level of LEVELS) {
      if (!level.obstacles.some((o) => o.kind === 'roadBridge')) continue;
      const t = getTerrain(level);
      for (const { index, gaps } of joints(t, buildObstacleSpecs(t, level.seed))) {
        expect(gaps, `${level.id} #${index}`).toHaveLength(2);
        for (const g of gaps) {
          expect(g, `${level.id} #${index}`).toBeGreaterThanOrEqual(0);
          // 1 cm per side at the placement's scale (Riverside Town's viaduct is × 1.3).
          expect(g, `${level.id} #${index}`).toBeLessThanOrEqual(0.02);
        }
      }
    }
  }, 120_000);

  it('on every level, nothing of an abutment hangs in the air below its seat', () => {
    // The block used to reach the gorge floor and, square to a tilted deck, lean its front out over
    // the gap by its depth × sin(tilt): Riverside Town's x0 block had a bottom corner 1.66 m in the
    // air ~9.7 m under the deck. Now the block stops at the bank, plumb, buried; what stands out
    // over the drop is the seat that carries the deck end (at most SEAT_MAX, 6 m, deep).
    const SEAT_MAX = 6;
    for (const level of LEVELS) {
      if (!level.obstacles.some((o) => o.kind === 'roadBridge')) continue;
      const t = getTerrain(level);
      const scale = new Map(bridgePlans(t).map((b) => [b.index, b.scale]));
      for (const a of buildObstacleSpecs(t, level.seed).filter((s) => s.part === 'abutment')) {
        const s = scale.get(a.placement ?? -1) ?? 1;
        const inv = new Quaternion(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w).invert();
        for (const p of worldPoints(a)) {
          if (p.y <= t.heightAt(p.x, p.z) + 0.05) continue;
          // Square to the deck below its running surface (the body's origin): the underside is at
          // −DECK_H.
          const v = new Vector3(p.x - a.position.x, p.y - a.position.y, p.z - a.position.z).applyQuaternion(inv).y;
          expect(v, `${level.id} abutment point in the air at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
            .toBeGreaterThan(-(ROAD_DECK.depth + SEAT_MAX) * s - 0.01);
        }
      }
    }
  }, 120_000);
});

describe('footbridge: a path from bank to bank', () => {
  it('meets the banks of a stream cutting, ramped, on sills', () => {
    const t = terrainWith([{ kind: 'footbridge', s: 200, d: 0, yaw: Math.PI / 2, span: 26 }], gorge());
    const [b] = bridgePlans(t);
    expect(b.mode).toBe('rims');
    for (const e of b.ends) expect(Math.abs(e.top - e.ground)).toBeLessThan(0.1);
    const specs = buildObstacleSpecs(t, 1);
    const sills = specs.filter((s) => s.part === 'sill');
    expect(sills).toHaveLength(2);
    expect(sills.every((s) => s.anchored && s.passable && s.material === 'stone')).toBe(true);
    const decks = specs.filter((s) => s.part === 'deck');
    // ~20 m over the gorge in ~8 m bays: posts on the gorge floor between them.
    expect(decks.length).toBeGreaterThanOrEqual(2);
    for (const p of specs.filter((s) => s.part === 'post')) {
      const w = worldBounds(p);
      expect(w.min.y).toBeLessThan(t.heightAt(p.position.x, p.position.z));
      expect(w.max.y - t.heightAt(p.position.x, p.position.z)).toBeGreaterThan(GORGE_DEPTH - 2);
    }
    expect(FOOT_DECK.maxGrade).toBeGreaterThan(Math.abs(b.grade));
  });
});

describe('the street a road bridge carries', () => {
  const roads: TerrainFeature[] = [
    { type: 'road', s0: 30, s1: 185, d: 0, width: 8 },
    { type: 'road', s0: 215, s1: 380, d: 0, width: 8 },
  ];

  it('is laid along the deck from end to end (carve: false) and joins the approach roads', () => {
    const t = terrainWith([ALONG], gorge(), roads);
    const lines = trafficLines(t);
    const deck = lines.filter((l) => l.bridge !== undefined);
    expect(deck).toHaveLength(1);
    expect(deck[0].carve).toBe(false);
    expect(deck[0].bridge).toBe(0);
    const [p0, p1] = deck[0].points;
    expect(Math.min(p0.s, p1.s)).toBeCloseTo(185, 0);
    expect(Math.max(p0.s, p1.s)).toBeCloseTo(215, 0);
  });

  it('is not laid twice when the level already authors a street over the deck', () => {
    const over: TerrainFeature = {
      type: 'street',
      points: [
        { s: 185, d: 0 },
        { s: 215, d: 0 },
      ],
      width: 8,
      carve: false,
    };
    const t = terrainWith([ALONG], gorge(), [...roads, over]);
    expect(trafficLines(t).filter((l) => l.bridge !== undefined)).toHaveLength(0);
  });

  it('is not laid on a floating bridge, nor on a footbridge', () => {
    const t = terrainWith(
      [
        { kind: 'roadBridge', s: 100, d: 0, span: 40 },
        { kind: 'footbridge', s: 200, d: 0, yaw: Math.PI / 2, span: 26 },
      ],
      gorge(),
    );
    expect(trafficLines(t).filter((l) => l.bridge !== undefined)).toHaveLength(0);
  });
});
