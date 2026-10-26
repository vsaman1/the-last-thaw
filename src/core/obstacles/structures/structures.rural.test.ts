import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createAnalyticTerrain, inclinedPlane } from '../../testing/analyticTerrain';
import type { ObstacleKind, ObstaclePlacement, StructureKind, Terrain } from '../../types';
import { momentumBreakSpeed } from '../catalog';
import { getGeom, scaledPoints } from '../shapes';
import { partsBounds, rotateVec, type BodyPart, type BodySpec } from '../specs';
import { buildObstacleSpecs } from '../spawn';
import { isSpanningKind, structureDef } from './index';

/**
 * Industry, farm and mountain structures: tank, factoryHall, chalet, skiLiftPylon, barn, silo and
 * logPile. The shared kit suite (structures.test.ts) already builds every kind on flat and sloped
 * ground at two scales and compares colliders with meshes; this file pins what each kind promises.
 */

const RURAL: readonly StructureKind[] = [
  'tank',
  'factoryHall',
  'chalet',
  'skiLiftPylon',
  'barn',
  'silo',
  'logPile',
];

type Height = (x: number, z: number) => number;

const flat =
  (h: number): Height =>
  (): number =>
    h;

function terrainWith(obstacles: ObstaclePlacement[], height: Height = flat(5)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

/** World positions of every hull vertex of a part. */
function worldVerts(spec: BodySpec, part: BodyPart): Vector3[] {
  const q = new Quaternion(spec.rotation.x, spec.rotation.y, spec.rotation.z, spec.rotation.w);
  const pq = new Quaternion(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
  const pts = scaledPoints(getGeom(part.geom), part.scale);
  const out: Vector3[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const v = new Vector3(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(pq);
    v.add(new Vector3(part.offset.x, part.offset.y, part.offset.z)).applyQuaternion(q);
    out.push(v.add(new Vector3(spec.position.x, spec.position.y, spec.position.z)));
  }
  return out;
}

/** World AABB of the collider parts. */
function worldBox(specs: readonly BodySpec[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of specs) {
    for (const p of s.parts) {
      if (p.decor) continue;
      for (const v of worldVerts(s, p)) {
        min.min(v);
        max.max(v);
      }
    }
  }
  return { min, max };
}

/** Specs of one placement of `kind` at s 80 on the centreline, yaw 0 unless `extra` says otherwise. */
function one(kind: ObstacleKind, height = flat(5), extra: Partial<ObstaclePlacement> = {}): BodySpec[] {
  return buildObstacleSpecs(terrainWith([{ kind, s: 80, d: 0, yaw: 0, ...extra }], height), 11);
}

const colliders = (s: BodySpec): BodyPart[] => s.parts.filter((p) => !p.decor);
const pieces = (s: BodySpec): number => new Set(colliders(s).map((p) => p.piece)).size;

describe('rural structures: registry and calibration', () => {
  it('all seven kinds are defined, standing (not spanning), with sensible placement radii', () => {
    for (const kind of RURAL) {
      const def = structureDef(kind);
      expect(def, kind).toBeDefined();
      expect(isSpanningKind(kind)).toBe(false);
      expect(def?.label.length).toBeGreaterThan(2);
    }
    const r = (k: StructureKind): number => structureDef(k)?.footprint ?? 0;
    expect(r('factoryHall')).toBeGreaterThan(r('barn'));
    expect(r('barn')).toBeGreaterThan(r('chalet'));
    expect(r('logPile')).toBeLessThan(r('silo') + 0.1);
  });

  // kind, mass (t), break speed for a 30 t iceberg (m/s), break mode, pieces, material, building
  const TABLE: [StructureKind, number, number, 'shatter' | 'uproot', number, string, boolean][] = [
    ['tank', 28, 20, 'shatter', 7, 'metal', true],
    ['factoryHall', 55, 30, 'shatter', 15, 'masonry', true],
    ['chalet', 15, 12, 'shatter', 9, 'wood', true],
    ['skiLiftPylon', 4.5, 10, 'uproot', 3, 'metal', false],
    ['barn', 16, 11, 'shatter', 12, 'wood', true],
    ['silo', 26, 18, 'shatter', 5, 'masonry', true],
    ['logPile', 4.5, 2, 'shatter', 10, 'wood', false],
  ];
  for (const [kind, mass, speed, mode, n, material, building] of TABLE) {
    it(`${kind}: one anchored ${mass} t body, breaks at ${speed} m/s (30 t), ${mode} into ${n}`, () => {
      const specs = one(kind);
      expect(specs.length).toBe(1);
      const [s] = specs;
      expect(s.anchored).toBe(true);
      expect(s.mass).toBeCloseTo(mass, kind === 'logPile' ? -0.5 : 6);
      expect(momentumBreakSpeed(s.breakImpulse, 30)).toBeCloseTo(speed, 6);
      expect(s.breakMode).toBe(mode);
      expect(pieces(s)).toBe(n);
      expect(s.material).toBe(material);
      expect(s.building).toBe(building);
      // Few colliders per body, decor for the detail.
      expect(colliders(s).length).toBeLessThanOrEqual(15);
      expect(s.parts.some((p) => p.decor)).toBe(true);
      // Every collider piece carries a fair share of the mass (no feather-light or lead pieces; the
      // chalet's timber balcony is the lightest at ~2 %).
      const byPiece = new Map<number, number>();
      for (const p of colliders(s)) byPiece.set(p.piece ?? -1, (byPiece.get(p.piece ?? -1) ?? 0) + p.mass);
      const shares = [...byPiece.values()].map((m) => m / s.mass);
      expect(Math.min(...shares)).toBeGreaterThan(0.18 / n);
      expect(Math.max(...shares)).toBeLessThan(4 / n);
    });
  }

  it('the chalet is weaker than the stone house; big icebergs flatten the factory hall slowly', () => {
    const [chalet] = one('chalet');
    const [house] = one('house');
    expect(chalet.breakImpulse).toBeLessThan(house.breakImpulse);
    const [hall] = one('factoryHall');
    expect(momentumBreakSpeed(hall.breakImpulse, 100)).toBeCloseTo(9, 6);
    expect(momentumBreakSpeed(hall.breakImpulse, 220)).toBeCloseTo(30 * (30 / 220), 6);
    const [tank] = one('tank');
    expect(momentumBreakSpeed(tank.breakImpulse, 100)).toBeCloseTo(6, 6);
    // Strength grows with the placement scale squared, mass with its cube.
    const [big] = one('tank', flat(5), { scale: 1.5 });
    expect(big.breakImpulse).toBeCloseTo(tank.breakImpulse * 2.25, 6);
    expect(big.mass).toBeCloseTo(tank.mass * 3.375, 6);
  });
});

describe('rural structures: size and layout', () => {
  // kind: [x extent, y extent, z extent] of the colliders at yaw 0 on flat ground, ±tolerance
  // (round shapes are polygons, so a diameter reads a little short across its flats).
  const SIZES: [StructureKind, number, number, number, number][] = [
    ['tank', 10.86, 9.55, 10.86, 0.05],
    ['factoryHall', 24, 10.25, 18, 0.05],
    ['chalet', 10.42, 8.97, 12, 0.05],
    ['barn', 10.76, 9.0, 14.8, 0.05],
    ['silo', 6.08, 20.2, 6.08, 0.05],
    ['skiLiftPylon', 7, 12.45, 1.6, 0.05],
    ['logPile', 5.05, 1.4, 1.65, 0.5],
  ];
  for (const [kind, x, y, z, tol] of SIZES) {
    it(`${kind}: about ${x} × ${y} × ${z} m, standing on the ground`, () => {
      const specs = one(kind);
      const { min, max } = worldBox(specs);
      expect(Math.abs(max.x - min.x - x)).toBeLessThan(tol);
      expect(Math.abs(max.y - min.y - y)).toBeLessThan(tol);
      expect(Math.abs(max.z - min.z - z)).toBeLessThan(tol);
      expect(min.y).toBeGreaterThan(5 - 0.1);
      expect(min.y).toBeLessThan(5.02);
    });
  }

  it('tank: twelve plates close into one 12-sided shell under the roof, torn off in pairs', () => {
    const [s] = one('tank');
    const axis = new Vector3(s.position.x, 0, s.position.z);
    const plates = s.parts.filter((p) => !p.decor && p.name === 'plate');
    expect(plates.length).toBe(12);
    expect(new Set(plates.map((p) => p.piece)).size).toBe(6);
    const angles: number[] = [];
    for (const p of plates) {
      const rs = worldVerts(s, p).map((v) => Math.hypot(v.x - axis.x, v.z - axis.z));
      // Outer vertices on the 5.5 m circle, inner corners 0.3 m in.
      expect(Math.max(...rs)).toBeCloseTo(5.5, 3);
      expect(Math.min(...rs)).toBeCloseTo(5.2, 3);
      const c = new Vector3();
      rotateVec(s.rotation, p.offset.x, 0, p.offset.z, c);
      angles.push(Math.atan2(c.x, c.z));
    }
    const sorted = angles.map((a) => (a + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
    for (let i = 1; i < 12; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(Math.PI / 6, 3);
    const roof = s.parts.find((p) => !p.decor && p.name === 'roof');
    expect(roof).toBeDefined();
    const roofVerts = worldVerts(s, roof as BodyPart);
    const roofBottom = Math.min(...roofVerts.map((v) => v.y));
    const plateTop = Math.max(...plates.flatMap((p) => worldVerts(s, p).map((v) => v.y)));
    expect(roofBottom).toBeCloseTo(plateTop, 3);
    // The roof's corners stand over the shell's corners, 12 cm out.
    const shellCorners = plates.flatMap((p) => worldVerts(s, p)).filter((v) => {
      return Math.abs(Math.hypot(v.x - axis.x, v.z - axis.z) - 5.5) < 1e-3;
    });
    for (const v of roofVerts.filter((u) => u.y < roofBottom + 1e-3)) {
      const a = Math.atan2(v.x - axis.x, v.z - axis.z);
      const near = shellCorners.some((c) => Math.abs(Math.atan2(c.x - axis.x, c.z - axis.z) - a) < 1e-3);
      expect(near).toBe(true);
    }
    // The ladder (most of the decor) rides with one plate.
    const decorPerPiece = new Map<number, number>();
    for (const p of s.parts) {
      if (p.decor) decorPerPiece.set(p.piece ?? -1, (decorPerPiece.get(p.piece ?? -1) ?? 0) + 1);
    }
    expect(Math.max(...decorPerPiece.values())).toBeGreaterThan(12);
  });

  it('log pile: ten loose-fitting logs, each resting on the ground or on two logs below', () => {
    for (const height of [flat(5), inclinedPlane(0.15)]) {
      const [s] = one('logPile', height);
      const logs = s.parts.filter((p) => !p.decor);
      expect(logs.length).toBe(10);
      expect(new Set(logs.map((p) => p.piece)).size).toBe(10);
      expect(logs.every((p) => p.name === 'log' && p.geom === 'kit:cyl:32:1')).toBe(true);
      // Two pale end-grain discs per log, riding with it.
      for (const l of logs) expect(s.parts.filter((p) => p.decor && p.piece === l.piece).length).toBe(2);
      // Cross-section (z, y) of each log axis and its radius.
      const sec = logs.map((p) => ({ z: p.offset.z, y: p.offset.y, r: p.scale.x / 2 }));
      let onGround = 0;
      let resting = 0;
      sec.forEach((a, i) => {
        // Supports: logs in the row below (clearly lower) within 2 cm.
        const touching = sec.filter((b) => {
          return b.y < a.y - 0.15 && Math.hypot(a.z - b.z, a.y - b.y) - a.r - b.r < 0.02;
        });
        for (let j = i + 1; j < sec.length; j++) {
          const b = sec[j];
          expect(Math.hypot(a.z - b.z, a.y - b.y)).toBeGreaterThan(a.r + b.r + 0.005);
        }
        const g = height(s.position.x, s.position.z + a.z) - s.position.y;
        const gap = a.y - a.r - g;
        if (gap < 0.03) {
          expect(gap).toBeGreaterThan(-0.01);
          onGround++;
        } else if (touching.length === 2) {
          resting++;
        }
      });
      expect(onGround).toBe(4);
      expect(resting).toBe(6);
      // Mass from the logs' volume at 0.75 t/m³.
      const vol = logs.reduce((a, p) => a + Math.PI * (p.scale.x / 2) ** 2 * p.scale.y, 0);
      expect(s.mass).toBeCloseTo(vol * 0.75, 6);
      // Logs lie across the course (along x at yaw 0) so they roll down it.
      const b = partsBounds(logs);
      expect(b.max.x - b.min.x).toBeGreaterThan(4.5);
    }
  });

  it('silo: rings stacked with hairline gaps; concrete silos have hoops, the blue steel ones a band', () => {
    const silos = Array.from({ length: 16 }, (_, i): ObstaclePlacement => {
      return { kind: 'silo', s: 40 + i * 20, d: 0 };
    });
    const t = terrainWith(silos);
    const specs = buildObstacleSpecs(t, 5);
    let steel = 0;
    let concrete = 0;
    for (const s of specs) {
      const rings = s.parts.filter((p) => !p.decor && p.name === 'ring');
      rings.sort((a, b) => a.offset.y - b.offset.y);
      expect(rings.length).toBe(4);
      for (let i = 1; i < rings.length; i++) {
        const [lo, hi] = [rings[i - 1], rings[i]];
        const gap = hi.offset.y - hi.scale.y / 2 - (lo.offset.y + lo.scale.y / 2);
        expect(gap).toBeGreaterThan(0.001);
        expect(gap).toBeLessThan(0.03);
      }
      const hoops = s.parts.filter((p) => p.decor && p.color === 0x4f5458).length;
      if (rings[0].color === 0x27466e) {
        steel++;
        expect(hoops).toBe(0);
        expect(s.parts.some((p) => p.decor && p.color === 0xf2f2ee)).toBe(true);
      } else {
        concrete++;
        expect(hoops).toBe(8);
      }
    }
    expect(steel).toBeGreaterThan(0);
    expect(concrete).toBeGreaterThan(0);
  });

  it('ski lift pylon: topples as one body hit above its centre of mass; the chair rides along', () => {
    const [s] = one('skiLiftPylon');
    expect(s.proxyMode).toBe('trunk');
    expect(s.trunkRadius).toBeCloseTo(0.35, 6);
    const { max } = worldBox([s]);
    expect(max.y - 5).toBeGreaterThan(12);
    // Impulse lands a little above the centre of mass, so it topples forward instead of sliding.
    const com = colliders(s).reduce((a, p) => a + p.mass * p.offset.y, 0) / s.mass;
    expect(s.hitHeight).toBeGreaterThan(com);
    // Seat, backrest, hanger... at chair height under one end of the arm.
    const chair = s.parts.filter((p) => p.decor && p.offset.y > 9 && p.offset.y < 12 && p.offset.x > 2);
    expect(chair.length).toBeGreaterThanOrEqual(6);
  });
});

describe('rural structures: ground following on slopes', () => {
  /** Deepest burial and highest hover (m) of the bottom vertices of parts that reach the ground. */
  function groundContact(spec: BodySpec, terrain: Terrain): { buried: number; hover: number } {
    let buried = 0;
    let hover = 0;
    const lowest = Math.min(...colliders(spec).flatMap((p) => worldVerts(spec, p).map((v) => v.y)));
    for (const p of colliders(spec)) {
      const vs = worldVerts(spec, p);
      const bottom = Math.min(...vs.map((v) => v.y));
      const gBelow = Math.min(...vs.map((v) => terrain.heightAt(v.x, v.z)));
      // Only parts standing on the ground (not roofs, gables or upper logs).
      if (bottom - gBelow > 0.3 && bottom > lowest + 0.3) continue;
      for (const v of vs) {
        if (v.y > bottom + 0.05) continue;
        const g = terrain.heightAt(v.x, v.z);
        buried = Math.max(buried, g - v.y);
        hover = Math.max(hover, v.y - g);
      }
    }
    return { buried, hover };
  }

  const slopes: [string, (x: number, z: number) => number][] = [
    ['down-course 0.12', inclinedPlane(0.12)],
    ['down-course 0.18', inclinedPlane(0.18)],
    ['across 0.15', (x: number) => 5 + 0.15 * x],
  ];
  for (const kind of ['barn', 'chalet', 'factoryHall'] as const) {
    for (const [label, height] of slopes) {
      for (const yaw of [0, Math.PI / 2]) {
        it(`${kind}, ${label} slope, yaw ${yaw.toFixed(2)}: walls reach the ground, none sunk deep`, () => {
          const t = terrainWith([{ kind, s: 80, d: 0, yaw }], height);
          const [s] = buildObstacleSpecs(t, 2);
          // Every wall panel's bottom edge follows the ground: within a few cm at each end.
          const walls = colliders(s).filter((p) => p.name === 'wall');
          expect(walls.length).toBeGreaterThanOrEqual(4);
          for (const w of walls) {
            const vs = worldVerts(s, w);
            const bottom = vs.filter((v) => v.y - t.heightAt(v.x, v.z) < 0.5);
            expect(bottom.length).toBeGreaterThanOrEqual(4);
            for (const v of bottom) {
              const d = v.y - t.heightAt(v.x, v.z);
              expect(d).toBeLessThan(0.02);
              expect(d).toBeGreaterThan(-0.35);
            }
          }
          // Sloping walls became quantised trapezoid prisms shared between the kinds.
          expect(walls.some((w) => w.geom.startsWith('kit:prism:rural-wall-'))).toBe(true);
          // The roofline stays level.
          const roofs = colliders(s).filter((p) => p.name === 'roof');
          const lows = roofs.map((r) => Math.min(...worldVerts(s, r).map((v) => v.y)));
          if (kind === 'factoryHall') expect(Math.max(...lows) - Math.min(...lows)).toBeLessThan(1e-6);
        });
      }
    }
    it(`${kind} on flat ground: plain box walls`, () => {
      const [s] = one(kind);
      expect(colliders(s).filter((p) => p.name === 'wall').every((p) => p.geom === 'kit:box')).toBe(true);
    });
  }

  it('tank and silo on a 0.12 slope: nothing hovers, burial stays under one plate / one ring rise', () => {
    // Plate chord 5.5 m / rim 5.9 m across the slope, × 0.12, plus the 5 cm sink.
    for (const [kind, limit] of [['tank', 0.72], ['silo', 0.77]] as const) {
      const t = terrainWith([{ kind, s: 80, d: 0, yaw: 0.4 }], inclinedPlane(0.12));
      const [s] = buildObstacleSpecs(t, 2);
      const { buried, hover } = groundContact(s, t);
      expect(hover, kind).toBeLessThan(0.03);
      expect(buried, kind).toBeLessThan(limit);
    }
  });
});
