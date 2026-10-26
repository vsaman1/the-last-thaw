import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../../testing/analyticTerrain';
import type { ObstacleKind, ObstaclePlacement, Terrain } from '../../types';
import { CONTACT_ABOVE } from '../../sim/iceberg';
import { ICE, momentumBreakImpulse, momentumBreakSpeed, REFERENCE_ICEBERG_MASS } from '../catalog';
import { getGeom, scaledPoints } from '../shapes';
import { partsBounds, rotateVec, type BodySpec } from '../specs';
import { buildObstacleSpecs, specsForKind } from '../spawn';
import {
  isSpanningKind,
  isStructureKind,
  missingStructureKinds,
  STRUCTURE_KINDS,
  STRUCTURE_SOURCES,
  structureDef,
  structureDefs,
  structureFootprint,
} from './index';

const flat =
  (h: number) =>
  (): number =>
    h;

function terrainWith(obstacles: ObstaclePlacement[], height: (x: number, z: number) => number = flat(5)): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

/** The kinds Phase B still has to add. Update this list when a definition file lands. */
const PENDING: ObstacleKind[] = [];

/** World AABB of the collider (non-decor) parts of a spec. */
function worldBounds(spec: BodySpec): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const { min, max } = partsBounds(spec.parts);
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  const c = { x: 0, y: 0, z: 0 };
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    rotateVec(spec.rotation, x, y, z, c);
    lo.x = Math.min(lo.x, c.x + spec.position.x);
    lo.y = Math.min(lo.y, c.y + spec.position.y);
    lo.z = Math.min(lo.z, c.z + spec.position.z);
    hi.x = Math.max(hi.x, c.x + spec.position.x);
    hi.y = Math.max(hi.y, c.y + spec.position.y);
    hi.z = Math.max(hi.z, c.z + spec.position.z);
  }
  return { min: lo, max: hi };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structure registry', () => {
  it('knows all 30 StructureKinds exactly once', () => {
    expect(STRUCTURE_KINDS.length).toBe(30);
    expect(new Set(STRUCTURE_KINDS).size).toBe(30);
    expect(isStructureKind('car')).toBe(true);
    expect(isStructureKind('house')).toBe(false);
    expect(isStructureKind('pine')).toBe(false);
  });

  it('has the house migrated onto the kit plus the car, fence and footbridge examples', () => {
    const kinds = structureDefs().map((d) => d.kind);
    expect(kinds).toEqual(expect.arrayContaining(['house', 'car', 'fence', 'footbridge']));
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const d of structureDefs()) expect(structureDef(d.kind)).toBe(d);
  });

  it('registers definition files automatically, each named after its kind', () => {
    expect(STRUCTURE_SOURCES.size).toBe(structureDefs().length);
    for (const [path, kind] of STRUCTURE_SOURCES) expect(path).toBe(`./${kind}.ts`);
    // Spanning definitions agree with the SPANNING_KINDS list placement validation uses.
    for (const d of structureDefs()) expect(isSpanningKind(d.kind)).toBe(d.span !== undefined);
  });

  it('lists the kinds that still lack a definition (fails when one is added or removed)', () => {
    const missing = missingStructureKinds();
    console.log(`[structures] ${missing.length} kinds without a definition yet: ${missing.join(', ')}`);
    expect(missing).toEqual(PENDING);
  });

  it('spawning a kind without a definition skips it with one console warning instead of crashing', () => {
    const kind = missingStructureKinds().find((k) => k !== 'church') ?? 'church';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = terrainWith([
      { kind, s: 60, d: 0 },
      { kind, s: 90, d: 4 },
      { kind: 'rockSmall', s: 120, d: 0 },
    ]);
    if (structureDef(kind)) return; // Phase B defined everything.
    const specs = buildObstacleSpecs(t, 3);
    expect(specs.map((s) => s.kind)).toEqual(['rockSmall']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(kind);
  });

  it('spanning kinds and footprints are exposed for placement validation', () => {
    expect(isSpanningKind('fence')).toBe(true);
    expect(isSpanningKind('footbridge')).toBe(true);
    expect(isSpanningKind('car')).toBe(false);
    expect(isSpanningKind('house')).toBe(false);
    expect(structureFootprint('house')).toBeCloseTo(6, 0);
    expect(structureFootprint('car')).toBeGreaterThan(2);
    expect(structureFootprint('car')).toBeLessThan(3.5);
    expect(structureFootprint('house', 1.5)).toBeCloseTo(1.5 * (structureFootprint('house') ?? 0));
    if (PENDING.length) expect(structureFootprint(PENDING[0])).toBeUndefined();
  });
});

describe('the kit builds every defined structure', () => {
  const grounds: [string, (x: number, z: number) => number][] = [
    ['flat', flat(5)],
    ['0.12 slope', inclinedPlane(0.12)],
  ];
  for (const def of structureDefs()) {
    for (const [label, height] of grounds) {
      for (const scale of [1, 1.4]) {
        it(`${def.kind} (${label}, scale ${scale}): valid parts, masses and colliders that match the render mesh`, () => {
          const t = terrainWith([{ kind: def.kind, s: 80, d: 3, scale }], height);
          const specs = buildObstacleSpecs(t, 7);
          expect(specs.length).toBeGreaterThan(0);
          expect(JSON.stringify(buildObstacleSpecs(t, 7))).toBe(JSON.stringify(specs));
          for (const spec of specs) {
            expect(spec.kind).toBe(def.kind);
            const colliders = spec.parts.filter((p) => !p.decor);
            expect(colliders.length).toBeGreaterThan(0);
            const sum = spec.parts.reduce((a, p) => a + p.mass, 0);
            expect(sum).toBeCloseTo(spec.mass, 6);
            for (const p of spec.parts) {
              if (p.decor) expect(p.mass).toBe(0);
              else expect(p.mass).toBeGreaterThan(0);
              // Collider (box half extents or hull points) and render mesh share one bounding box.
              const g = getGeom(p.geom);
              const pts = scaledPoints(g, p.scale);
              const cmin = [Infinity, Infinity, Infinity];
              const cmax = [-Infinity, -Infinity, -Infinity];
              for (let i = 0; i < pts.length; i++) {
                cmin[i % 3] = Math.min(cmin[i % 3], pts[i]);
                cmax[i % 3] = Math.max(cmax[i % 3], pts[i]);
              }
              const pos = g.mesh.positions;
              const s = [p.scale.x, p.scale.y, p.scale.z];
              const rmin = [Infinity, Infinity, Infinity];
              const rmax = [-Infinity, -Infinity, -Infinity];
              for (let i = 0; i < pos.length; i++) {
                rmin[i % 3] = Math.min(rmin[i % 3], pos[i] * s[i % 3]);
                rmax[i % 3] = Math.max(rmax[i % 3], pos[i] * s[i % 3]);
              }
              if (g.collider === 'box') {
                const h = [g.halfExtents.x * p.scale.x, g.halfExtents.y * p.scale.y, g.halfExtents.z * p.scale.z];
                for (let k = 0; k < 3; k++) expect(cmax[k]).toBeCloseTo(h[k], 6);
              }
              // Decorative insets (windows, doors) stand 2.5 cm proud of a face.
              const tol = 0.03 * Math.max(1, ...s);
              for (let k = 0; k < 3; k++) {
                expect(Math.abs(rmin[k] - cmin[k])).toBeLessThan(tol);
                expect(Math.abs(rmax[k] - cmax[k])).toBeLessThan(tol);
              }
            }
            if (spec.anchored) {
              expect(Number.isFinite(spec.breakImpulse)).toBe(true);
              expect(spec.breakMode).not.toBe('none');
            }
            const b = worldBounds(spec);
            const corners = [
              t.heightAt(b.min.x, b.min.z),
              t.heightAt(b.max.x, b.min.z),
              t.heightAt(b.min.x, b.max.z),
              t.heightAt(b.max.x, b.max.z),
            ];
            // Nothing sunk deep into or hanging over the ground (decks are bridged on their posts).
            expect(b.min.y).toBeGreaterThan(Math.min(...corners) - 0.6 * scale);
            if (spec.part !== 'deck') expect(b.min.y).toBeLessThan(Math.max(...corners) + 0.15);
          }
        });
      }
    }
  }
});

describe('momentum-rule calibration (anchored obstacles break when (1+e)·vn·M >= breakImpulse)', () => {
  it('keeps the tutorial break speeds for a 30 t iceberg', () => {
    expect(REFERENCE_ICEBERG_MASS).toBe(30);
    const t = terrainWith([
      { kind: 'pine', s: 60, d: 0 },
      { kind: 'broadleaf', s: 90, d: 0 },
      { kind: 'house', s: 130, d: 0 },
    ]);
    const [pine, broadleaf, house] = buildObstacleSpecs(t, 5);
    expect(pine.breakImpulse).toBeCloseTo(262.5, 1);
    expect(broadleaf.breakImpulse).toBeCloseTo(337.5, 1);
    expect(house.breakImpulse).toBeCloseTo(562.5, 1);
    expect(momentumBreakSpeed(pine.breakImpulse, 30)).toBeCloseTo(7);
    expect(momentumBreakSpeed(house.breakImpulse, 30)).toBeCloseTo(15);
    // A 100 t iceberg flattens a house at walking-pace speeds.
    expect(momentumBreakSpeed(house.breakImpulse, 100)).toBeCloseTo(4.5);
  });

  it('scales strength with the placement scale squared (cross-section), not with random size', () => {
    expect(momentumBreakImpulse(15, 1.5)).toBeCloseTo(562.5 * 2.25);
    const t = terrainWith([
      { kind: 'pine', s: 60, d: 0 },
      { kind: 'pine', s: 90, d: 0 },
      { kind: 'house', s: 130, d: 0, scale: 1.2 },
    ]);
    const [p1, p2, house] = buildObstacleSpecs(t, 9);
    expect(p1.mass).not.toBeCloseTo(p2.mass, 3);
    expect(p1.breakImpulse).toBeCloseTo(p2.breakImpulse, 6);
    expect(house.breakImpulse).toBeCloseTo(562.5 * 1.44, 1);
  });
});

describe('structures: layout and standing', () => {
  it('car: one loose ~1.3 t body that faces down-course at yaw 0 and sits on its wheels', () => {
    const t = terrainWith([{ kind: 'car', s: 80, d: 0, yaw: 0 }]);
    const [car, ...rest] = buildObstacleSpecs(t, 2);
    expect(rest.length).toBe(0);
    expect(car.anchored).toBe(false);
    expect(car.mass).toBeGreaterThan(1.15);
    expect(car.mass).toBeLessThan(1.45);
    expect(car.material).toBe('metal');
    const b = worldBounds(car);
    // Course runs along +z here: the car's length is along z.
    expect(b.max.z - b.min.z).toBeGreaterThan(3.8);
    expect(b.max.x - b.min.x).toBeLessThan(2.2);
    expect(b.max.y - b.min.y).toBeGreaterThan(1.3);
    expect(b.max.y - b.min.y).toBeLessThan(1.7);
    expect(b.min.y).toBeCloseTo(5, 1);
    // Wheels, windows and lights are there.
    expect(car.parts.filter((p) => p.name === 'wheel').length).toBe(4);
    expect(car.parts.some((p) => p.decor)).toBe(true);
  });

  it('car: on a slope it is tilted onto the ground instead of hovering on one wheel', () => {
    const t = terrainWith([{ kind: 'car', s: 80, d: 0, yaw: Math.PI / 2 }], inclinedPlane(0.15));
    const [car] = buildObstacleSpecs(t, 4);
    const wheels = car.parts.filter((p) => p.name === 'wheel');
    const c = { x: 0, y: 0, z: 0 };
    const gaps = wheels.map((w) => {
      rotateVec(car.rotation, w.offset.x, w.offset.y - w.scale.x / 2, w.offset.z, c);
      const x = car.position.x + c.x;
      const z = car.position.z + c.z;
      return car.position.y + c.y - t.heightAt(x, z);
    });
    for (const g of gaps) expect(Math.abs(g)).toBeLessThan(0.08);
  });

  it('fence: segments laid across the valley, count and length follow span', () => {
    for (const [span, n] of [
      [24, 10],
      [12, 5],
      [7.2, 3],
    ] as const) {
      const t = terrainWith([{ kind: 'fence', s: 80, d: 0, span }]);
      const specs = buildObstacleSpecs(t, 1);
      expect(specs.length).toBe(n);
      let lo = Infinity;
      let hi = -Infinity;
      let zlo = Infinity;
      let zhi = -Infinity;
      for (const s of specs) {
        const b = worldBounds(s);
        lo = Math.min(lo, b.min.x);
        hi = Math.max(hi, b.max.x);
        zlo = Math.min(zlo, b.min.z);
        zhi = Math.max(zhi, b.max.z);
        expect(s.anchored).toBe(true);
        expect(s.mass).toBeLessThan(0.2);
        expect(momentumBreakSpeed(s.breakImpulse, 30)).toBeLessThan(3.5);
      }
      expect(hi - lo).toBeGreaterThan(span - 0.05);
      expect(hi - lo).toBeLessThan(span + 0.4);
      expect(zhi - zlo).toBeLessThan(0.5);
    }
    // Default span = the floor width (2 x halfWidth = 40 m on the test terrain).
    const t = terrainWith([{ kind: 'fence', s: 80, d: 0 }]);
    const specs = buildObstacleSpecs(t, 1);
    const xs = specs.flatMap((s) => {
      const b = worldBounds(s);
      return [b.min.x, b.max.x];
    });
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 0);
    // yaw is relative to the course: a quarter turn lays the fence along it.
    const along = buildObstacleSpecs(terrainWith([{ kind: 'fence', s: 80, d: 0, span: 12, yaw: Math.PI / 2 }]), 1);
    const zs = along.flatMap((s) => {
      const b = worldBounds(s);
      return [b.min.z, b.max.z];
    });
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(11.9);
  });

  it('fence: segments follow the ground across a sloping valley side', () => {
    const t = terrainWith([{ kind: 'fence', s: 80, d: 0, span: 24 }], (x) => 5 + 0.2 * x);
    for (const s of buildObstacleSpecs(t, 1)) {
      const b = worldBounds(s);
      expect(b.min.y).toBeLessThan(t.heightAt(s.position.x, 80));
      expect(b.max.y - t.heightAt(s.position.x, 80)).toBeLessThan(1.9);
    }
  });

  it('footbridge: a level deck on anchored posts, high enough for the iceberg to slide under', () => {
    // A wall-to-wall span (the floor is 40 m wide): the walls rise to the deck 33 m past each end.
    const t = terrainWith([{ kind: 'footbridge', s: 80, d: 0, span: 40 }], (x) => 5 + 0.002 * x * x);
    const specs = buildObstacleSpecs(t, 1);
    const posts = specs.filter((s) => s.part === 'post');
    const decks = specs.filter((s) => s.part === 'deck');
    const sills = specs.filter((s) => s.part === 'sill');
    // Five floor bays as ever, plus an approach bay into each wall onto its sill.
    expect(decks.length).toBe(7);
    expect(posts.length).toBe(6);
    expect(sills.length).toBe(2);
    expect(posts.every((p) => p.anchored && p.breakMode === 'uproot' && p.proxyMode === 'trunk')).toBe(true);
    expect(decks.every((d) => !d.anchored && d.breakMode === 'none')).toBe(true);
    let highestGround = -Infinity;
    for (let x = -20; x <= 20; x += 0.5) highestGround = Math.max(highestGround, t.heightAt(x, 80));
    let deckLength = 0;
    const deckY = decks.map((d) => worldBounds(d).min.y);
    const floorDecks = decks.filter((d) => Math.abs(d.position.x) < 20);
    expect(floorDecks.length).toBe(5);
    for (const d of floorDecks) {
      const b = worldBounds(d);
      deckLength += b.max.x - b.min.x;
      // Clear of the iceberg's contact band with room to spare.
      expect(b.min.y).toBeGreaterThan(highestGround + CONTACT_ABOVE + 1.5);
    }
    expect(Math.max(...deckY) - Math.min(...deckY)).toBeLessThan(0.01);
    expect(deckLength).toBeGreaterThan(39.5);
    expect(deckLength).toBeLessThan(40.5);
    // Each sill carries the path out to where the wall meets the running surface.
    const top = deckY[0] + 0.22;
    for (const sl of sills) {
      const b = worldBounds(sl);
      expect(sl.anchored).toBe(true);
      expect(sl.breakImpulse).toBe(Infinity);
      expect(b.max.y).toBeCloseTo(top, 1);
      const end = sl.position.x > 0 ? b.max.x - 1.2 : b.min.x + 1.2;
      expect(Math.abs(t.heightAt(end, 80) - top)).toBeLessThan(0.15);
      expect(Math.abs(end)).toBeGreaterThan(45);
    }
    // Every post stands on the ground and reaches up to the deck.
    for (const p of posts) {
      const b = worldBounds(p);
      expect(b.min.y).toBeLessThan(t.heightAt(p.position.x, p.position.z));
      expect(b.max.y).toBeCloseTo(deckY[0], 1);
      expect(momentumBreakSpeed(p.breakImpulse, 30)).toBeGreaterThan(4);
      expect(momentumBreakSpeed(p.breakImpulse, 30)).toBeLessThan(8);
    }
  });

  it('runtime spawn of a structure works without course context', () => {
    const t = terrainWith([]);
    let n = 0;
    const rng = (): number => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const specs = specsForKind('fence', 0, 50, t, rng, {});
    expect(specs.length).toBeGreaterThan(3);
    expect(specsForKind('car', 0, 50, t, rng, { scale: 1.2 })[0].mass).toBeGreaterThan(1.9);
  });
});

describe('glacier ice', () => {
  it('iceBlock: one loose absorbable translucent block of 2-25 t', () => {
    const t = terrainWith(
      Array.from({ length: 12 }, (_, i): ObstaclePlacement => ({ kind: 'iceBlock', s: 40 + i * 12, d: 0 })),
    );
    const specs = buildObstacleSpecs(t, 3);
    expect(specs.length).toBe(12);
    for (const s of specs) {
      expect(s.absorbable).toBe(true);
      expect(s.anchored).toBe(false);
      expect(s.material).toBe('ice');
      expect(s.noTally).toBe(true);
      expect(s.mass).toBeGreaterThanOrEqual(ICE.blockMass[0]);
      expect(s.mass).toBeLessThanOrEqual(ICE.blockMass[1]);
      expect(getGeom(s.parts[0].geom).surface).toBe('ice');
      // Mass follows the hull volume at the density of ice.
      const g = getGeom(s.parts[0].geom);
      const vol = (g.volume ?? 0) * s.parts[0].scale.x * s.parts[0].scale.y * s.parts[0].scale.z;
      expect(s.mass).toBeCloseTo(vol * ICE.density, 3);
    }
    expect(new Set(specs.map((s) => s.mass.toFixed(2))).size).toBeGreaterThan(6);
  });

  it('iceField: count members of mixed sizes within spread, not overlapping', () => {
    const t = terrainWith([{ kind: 'iceField', s: 80, d: 0, count: 9, spread: 9 }]);
    const specs = buildObstacleSpecs(t, 4);
    expect(specs.length).toBe(9);
    const masses = specs.map((s) => s.mass);
    expect(Math.min(...masses)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...masses)).toBeLessThanOrEqual(25);
    expect(Math.max(...masses) / Math.min(...masses)).toBeGreaterThan(2.5);
    for (const s of specs) {
      expect(s.absorbable).toBe(true);
      expect(Math.hypot(s.position.x, s.position.z - 80)).toBeLessThan(9 + 0.01);
    }
    const r = (s: BodySpec): number => Math.max(s.parts[0].scale.x, s.parts[0].scale.z) / 2;
    for (let i = 0; i < specs.length; i++) {
      for (let j = i + 1; j < specs.length; j++) {
        const a = specs[i].position;
        const b = specs[j].position;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.9 * (r(specs[i]) + r(specs[j])));
      }
    }
    const def = buildObstacleSpecs(terrainWith([{ kind: 'iceField', s: 80, d: 0 }]), 4);
    expect(def.length).toBeGreaterThanOrEqual(ICE.fieldCount[0]);
    expect(def.length).toBeLessThanOrEqual(ICE.fieldCount[1]);
  });
});
