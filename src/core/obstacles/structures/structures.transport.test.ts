import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../../testing/analyticTerrain';
import type { ObstacleKind, ObstaclePlacement, Terrain } from '../../types';
import { CONTACT_ABOVE } from '../../sim/iceberg';
import { contactImpulseFor, momentumBreakSpeed } from '../catalog';
import { getGeom, scaledPoints } from '../shapes';
import { partsBounds, rotateVec, type BodySpec } from '../specs';
import { buildObstacleSpecs } from '../spawn';
import { monolithLayout } from './dam';
import { isSpanningKind, structureDef } from './index';

/** Transport and water structures: truck, bus, guardrail, roadBridge, railWagon, boat, dam. */
const KINDS: ObstacleKind[] = ['truck', 'bus', 'guardrail', 'roadBridge', 'railWagon', 'boat', 'dam'];

const flat =
  (h: number) =>
  (): number =>
    h;

function terrainWith(
  obstacles: ObstaclePlacement[],
  height: (x: number, z: number) => number = flat(5),
): Terrain {
  return createAnalyticTerrain({ height, cellSize: 2, level: { obstacles } });
}

type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

/** World AABB of the collider (non-decor) parts of a spec. */
function worldBounds(spec: BodySpec): Box {
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

function unionBounds(specs: readonly BodySpec[]): Box {
  const bs = specs.map(worldBounds);
  return {
    min: {
      x: Math.min(...bs.map((b) => b.min.x)),
      y: Math.min(...bs.map((b) => b.min.y)),
      z: Math.min(...bs.map((b) => b.min.z)),
    },
    max: {
      x: Math.max(...bs.map((b) => b.max.x)),
      y: Math.max(...bs.map((b) => b.max.y)),
      z: Math.max(...bs.map((b) => b.max.z)),
    },
  };
}

/** Loose-body break impulse of a loose structure that a 30 t hit shatters at `speed`. */
const looseBreak = (mass: number, speed: number): number => contactImpulseFor(mass, speed);

const colliders = (s: BodySpec): number => s.parts.filter((p) => !p.decor).length;

describe('transport structures: registered and built by the kit', () => {
  it('every kind has a definition; the spanning ones are spanning', () => {
    for (const kind of KINDS) {
      const def = structureDef(kind);
      expect(def, kind).toBeDefined();
      expect(isSpanningKind(kind)).toBe(['guardrail', 'roadBridge', 'dam'].includes(kind));
    }
  });

  const grounds: [string, (x: number, z: number) => number][] = [
    ['flat', flat(5)],
    ['0.12 slope', inclinedPlane(0.12)],
  ];
  for (const kind of KINDS) {
    for (const [label, height] of grounds) {
      for (const scale of [1, 1.4]) {
        it(`${kind} (${label}, scale ${scale}): colliders match the render mesh, on the ground`, () => {
          const t = terrainWith([{ kind, s: 80, d: 3, scale }], height);
          const specs = buildObstacleSpecs(t, 11);
          expect(specs.length).toBeGreaterThan(0);
          expect(JSON.stringify(buildObstacleSpecs(t, 11))).toBe(JSON.stringify(specs));
          for (const spec of specs) {
            expect(spec.kind).toBe(kind);
            expect(colliders(spec)).toBeGreaterThan(0);
            // Few colliders per body (a dam monolith's nine blocks are the most).
            expect(colliders(spec)).toBeLessThanOrEqual(9);
            expect(spec.parts.reduce((a, p) => a + p.mass, 0)).toBeCloseTo(spec.mass, 6);
            for (const p of spec.parts) {
              if (p.decor) expect(p.mass).toBe(0);
              else expect(p.mass).toBeGreaterThan(0);
              const g = getGeom(p.geom);
              const pts = scaledPoints(g, p.scale);
              const pos = g.mesh.positions;
              const s = [p.scale.x, p.scale.y, p.scale.z];
              for (let k = 0; k < 3; k++) {
                let cmin = Infinity;
                let cmax = -Infinity;
                let rmin = Infinity;
                let rmax = -Infinity;
                for (let i = k; i < pts.length; i += 3) {
                  cmin = Math.min(cmin, pts[i]);
                  cmax = Math.max(cmax, pts[i]);
                }
                for (let i = k; i < pos.length; i += 3) {
                  rmin = Math.min(rmin, pos[i] * s[k]);
                  rmax = Math.max(rmax, pos[i] * s[k]);
                }
                expect(Math.abs(rmin - cmin)).toBeLessThan(0.03 * Math.max(1, ...s));
                expect(Math.abs(rmax - cmax)).toBeLessThan(0.03 * Math.max(1, ...s));
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
            expect(b.min.y).toBeGreaterThan(Math.min(...corners) - 0.6 * scale);
            if (spec.part !== 'deck') expect(b.min.y).toBeLessThan(Math.max(...corners) + 0.15);
          }
        });
      }
    }
  }
});

describe('vehicles: loose bodies with documented masses, sizes and shatter speeds', () => {
  const one = (kind: ObstacleKind, opts: Partial<ObstaclePlacement> = {}, height = flat(5)): BodySpec => {
    const specs = buildObstacleSpecs(terrainWith([{ kind, s: 80, d: 0, yaw: 0, ...opts }], height), 2);
    expect(specs.length).toBe(1);
    return specs[0];
  };

  it('truck: ~8 t box truck, 7.6 m long, 3.5 m tall, cab + cargo box + chassis on four wheels', () => {
    const truck = one('truck');
    expect(truck.anchored).toBe(false);
    expect(truck.material).toBe('metal');
    expect(truck.mass).toBeCloseTo(8, 6);
    // Shattered by a 30 t hit above 18 m/s (the loose-body impulse).
    expect(truck.breakMode).toBe('shatter');
    expect(truck.breakImpulse).toBeCloseTo(looseBreak(8, 18), 6);
    const b = worldBounds(truck);
    expect(b.max.z - b.min.z).toBeGreaterThan(7.3);
    expect(b.max.z - b.min.z).toBeLessThan(7.8);
    expect(b.max.x - b.min.x).toBeLessThan(2.6);
    expect(b.max.y - b.min.y).toBeGreaterThan(3.3);
    expect(b.max.y - b.min.y).toBeLessThan(3.7);
    expect(b.min.y).toBeCloseTo(5, 1);
    expect(truck.parts.filter((p) => p.name === 'wheel').length).toBe(4);
    expect(new Set(truck.parts.filter((p) => !p.decor).map((p) => p.piece)).size).toBe(3);
    expect(truck.parts.filter((p) => p.decor).length).toBeGreaterThan(15);
    // Six times a car's mass: it costs a 30 t iceberg real speed.
    expect(truck.mass / one('car').mass).toBeGreaterThan(5);
  });

  it('bus: ~10 t, 12 m long, two halves on four wheels, a band of windows and doors', () => {
    const bus = one('bus');
    expect(bus.anchored).toBe(false);
    expect(bus.mass).toBeCloseTo(10, 6);
    expect(bus.breakImpulse).toBeCloseTo(looseBreak(10, 20), 6);
    const b = worldBounds(bus);
    expect(b.max.z - b.min.z).toBeCloseTo(12, 1);
    expect(b.max.x - b.min.x).toBeLessThan(2.7);
    expect(b.max.y - b.min.y).toBeGreaterThan(2.9);
    expect(b.max.y - b.min.y).toBeLessThan(3.4);
    expect(bus.parts.filter((p) => p.name === 'wheel').length).toBe(4);
    expect(new Set(bus.parts.filter((p) => !p.decor).map((p) => p.piece)).size).toBe(2);
    // Windows and doors are decor: thin glass panels along the flanks.
    const glass = bus.parts.filter((p) => p.decor && p.color === 0x1d2733 && p.scale.x < 0.05);
    expect(glass.length).toBe(7);
  });

  it('railWagon: 18 t, stands broadside across the valley by default; boxcars and tank wagons', () => {
    const variants = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const t = terrainWith([{ kind: 'railWagon', s: 80, d: 0 }]);
      const [w, ...rest] = buildObstacleSpecs(t, seed);
      expect(rest.length).toBe(0);
      expect(w.mass).toBeCloseTo(18, 6);
      expect(w.anchored).toBe(false);
      expect(w.breakImpulse).toBeCloseTo(looseBreak(18, 24), 6);
      expect(colliders(w)).toBe(3);
      const b = worldBounds(w);
      // The course runs along +z: broadside means its length lies along x.
      expect(b.max.x - b.min.x).toBeGreaterThan(11.5);
      expect(b.max.z - b.min.z).toBeLessThan(3);
      expect(b.max.y - b.min.y).toBeGreaterThan(3.6);
      expect(b.max.y - b.min.y).toBeLessThan(4.2);
      variants.add(w.parts.find((p) => !p.decor && p.name !== 'bogie')?.name ?? '');
    }
    expect([...variants].sort()).toEqual(['body', 'tank']);
  });

  it('boat: 3 t of wood; colliders 2 m tall so it floats half-submerged with 0.6-1 m of freeboard', () => {
    const boat = one('boat');
    expect(boat.mass).toBeCloseTo(3, 6);
    expect(boat.material).toBe('wood');
    expect(boat.breakImpulse).toBeCloseTo(looseBreak(3, 9), 6);
    const local = partsBounds(boat.parts);
    expect(local.max.y - local.min.y).toBeCloseTo(2, 3);
    const waterline = (local.min.y + local.max.y) / 2;
    const stern = boat.parts.find((p) => !p.decor && p.name === 'stern');
    const bottom = boat.parts.find((p) => !p.decor && p.name === 'hull');
    expect(stern && bottom).toBeTruthy();
    if (!stern || !bottom) return;
    // The waterline lies on the stern topsides: bottom under water, deck 0.6 m above it.
    const deck = stern.offset.y + stern.scale.y / 2;
    expect(waterline).toBeGreaterThan(bottom.offset.y + bottom.scale.z / 2);
    expect(deck - waterline).toBeGreaterThan(0.5);
    expect(deck - waterline).toBeLessThan(0.8);
    const b = worldBounds(boat);
    expect(b.max.z - b.min.z).toBeCloseTo(8, 1);
    expect(b.max.x - b.min.x).toBeCloseTo(2.9, 1);
    expect(new Set(boat.parts.filter((p) => !p.decor).map((p) => p.piece)).size).toBe(4);
  });

  it('vehicles on a slope are tilted onto the ground, wheels touching it', () => {
    for (const kind of ['truck', 'bus'] as const) {
      const t = terrainWith([{ kind, s: 80, d: 0, yaw: Math.PI / 2 }], inclinedPlane(0.15));
      const [v] = buildObstacleSpecs(t, 4);
      const c = { x: 0, y: 0, z: 0 };
      for (const w of v.parts.filter((p) => p.name === 'wheel')) {
        rotateVec(v.rotation, w.offset.x, w.offset.y - w.scale.x / 2, w.offset.z, c);
        const gap = v.position.y + c.y - t.heightAt(v.position.x + c.x, v.position.z + c.z);
        expect(Math.abs(gap), kind).toBeLessThan(0.08);
      }
    }
  });
});

describe('guardrail: light steel segments across the valley', () => {
  it('segments follow span; light anchored bodies a 30 t iceberg snaps at 3 m/s', () => {
    for (const [span, n] of [
      [24, 6],
      [12, 3],
      [4.4, 1],
    ] as const) {
      const specs = buildObstacleSpecs(terrainWith([{ kind: 'guardrail', s: 80, d: 0, span }]), 1);
      expect(specs.length).toBe(n);
      for (const s of specs) {
        expect(s.anchored).toBe(true);
        expect(s.material).toBe('metal');
        expect(s.mass).toBeLessThan(0.15);
        expect(momentumBreakSpeed(s.breakImpulse, 30)).toBeCloseTo(3, 6);
        expect(s.breakMode).toBe('shatter');
      }
      const b = unionBounds(specs);
      expect(b.max.x - b.min.x).toBeGreaterThan(span - 0.05);
      expect(b.max.x - b.min.x).toBeLessThan(span + 0.3);
      expect(b.max.z - b.min.z).toBeLessThan(0.5);
      expect(b.max.y - b.min.y).toBeLessThan(0.9);
    }
    // Default span: the floor width (40 m on the test terrain).
    const all = buildObstacleSpecs(terrainWith([{ kind: 'guardrail', s: 80, d: 0 }]), 1);
    const b = unionBounds(all);
    expect(b.max.x - b.min.x).toBeCloseTo(40, 0);
  });

  it('the beam faces up-course (the iceberg side) on two posts per segment', () => {
    const [seg] = buildObstacleSpecs(terrainWith([{ kind: 'guardrail', s: 80, d: 0, span: 12 }]), 1);
    const beam = seg.parts.find((p) => p.name === 'beam');
    const posts = seg.parts.filter((p) => p.name === 'post');
    expect(posts.length).toBe(2);
    // At yaw 0 local z is world z, the course direction: the beam sits on the -z side.
    expect(beam?.offset.z ?? 0).toBeLessThan(Math.min(...posts.map((p) => p.offset.z)));
    expect(new Set(seg.parts.filter((p) => !p.decor).map((p) => p.piece)).size).toBe(3);
  });

  it('follows the ground across a sloping valley side', () => {
    const t = terrainWith([{ kind: 'guardrail', s: 80, d: 0, span: 24 }], (x) => 5 + 0.2 * x);
    for (const s of buildObstacleSpecs(t, 1)) {
      const b = worldBounds(s);
      expect(b.min.y).toBeLessThan(t.heightAt(s.position.x, 80));
      expect(b.max.y - t.heightAt(s.position.x, 80)).toBeLessThan(1.4);
    }
  });
});

describe('roadBridge: decks resting on tall anchored piers', () => {
  it('bays follow span; a level deck 8 m above the highest ground, piers reaching up to it', () => {
    for (const [span, bays] of [
      [40, 2],
      [100, 5],
      [16, 1],
    ] as const) {
      const t = terrainWith([{ kind: 'roadBridge', s: 80, d: 0, span }], (x) => 5 + 0.002 * x * x);
      const specs = buildObstacleSpecs(t, 1);
      const piers = specs.filter((s) => s.part === 'pier');
      const decks = specs.filter((s) => s.part === 'deck');
      expect(decks.length).toBe(bays);
      expect(piers.length).toBe(bays + 1);
      let highest = -Infinity;
      for (let x = -span / 2; x <= span / 2; x += 0.5) highest = Math.max(highest, t.heightAt(x, 80));
      const deckY = decks.map((d) => worldBounds(d).min.y);
      expect(Math.max(...deckY) - Math.min(...deckY)).toBeLessThan(0.01);
      expect(deckY[0] - highest).toBeGreaterThan(7.9);
      expect(deckY[0] - highest).toBeLessThan(9);
      // Even a big iceberg (twice the normal size) passes under the deck.
      expect(deckY[0] - highest).toBeGreaterThan(2 * CONTACT_ABOVE + 1);
      let length = 0;
      for (const d of decks) {
        const b = worldBounds(d);
        length += b.max.x - b.min.x;
        expect(d.anchored).toBe(false);
        expect(d.breakMode).toBe('none');
        expect(d.material).toBe('stone');
      }
      // Each deck is 2 cm short of its bay, so neighbours never start inside each other.
      expect(length).toBeGreaterThan(span - 0.03 * bays);
      expect(length).toBeLessThan(span);
      for (const p of piers) {
        const b = worldBounds(p);
        expect(p.anchored).toBe(true);
        expect(p.breakMode).toBe('uproot');
        expect(p.proxyMode).toBe('trunk');
        expect(b.min.y).toBeLessThan(t.heightAt(p.position.x, p.position.z));
        expect(b.max.y).toBeCloseTo(deckY[0], 2);
      }
    }
  });

  it('piers: a 30 t iceberg needs 25 m/s, a 100 t one 7.5 m/s; scale² strength; heavier than decks', () => {
    const t = terrainWith([
      { kind: 'roadBridge', s: 80, d: 0, span: 40 },
      { kind: 'roadBridge', s: 200, d: 0, span: 40, scale: 1.5 },
    ]);
    const piers = buildObstacleSpecs(t, 1).filter((s) => s.part === 'pier');
    const [normal, scaled] = [piers.slice(0, 3), piers.slice(3)];
    for (const p of normal) {
      expect(momentumBreakSpeed(p.breakImpulse, 30)).toBeCloseTo(25, 6);
      expect(momentumBreakSpeed(p.breakImpulse, 100)).toBeCloseTo(7.5, 6);
      // Solid concrete, heavier than the two deck ends it carries.
      expect(p.mass).toBeGreaterThan(45);
      expect(p.mass).toBeLessThan(65);
    }
    for (const p of scaled) expect(momentumBreakSpeed(p.breakImpulse, 30)).toBeCloseTo(25 * 2.25, 4);
    const deck = buildObstacleSpecs(t, 1).find((s) => s.part === 'deck');
    expect(normal[1].mass).toBeGreaterThan(deck?.mass ?? Infinity);
  });
});

describe('dam: anchored concrete monoliths across a gorge', () => {
  it('a 10 m monolith on the centre line, ~10 m monoliths either side, together exactly span', () => {
    for (const [span, widths] of [
      [40, [7.5, 7.5, 10, 7.5, 7.5]],
      [30, [10, 10, 10]],
      [12, [12]],
      [20, [5, 10, 5]],
    ] as const) {
      const cols = monolithLayout(span);
      expect(cols.map((c) => +c.w.toFixed(6))).toEqual(widths);
      expect(cols.find((c) => c.x === 0)?.w).toBe(widths[(widths.length - 1) / 2]);
      let x = -span / 2;
      for (const c of cols) {
        expect(c.x - c.w / 2).toBeCloseTo(x, 6);
        x += c.w;
      }
      const specs = buildObstacleSpecs(terrainWith([{ kind: 'dam', s: 80, d: 0, span }]), 1);
      expect(specs.length).toBe(widths.length);
      const b = unionBounds(specs);
      expect(b.max.x - b.min.x).toBeGreaterThan(span - 0.05);
      expect(b.max.x - b.min.x).toBeLessThan(span + 0.05);
    }
  });

  it('a 9 m wall, vertical upstream face, nine blocks a monolith; 40 m/s at 30 t, 12 at 100 t', () => {
    const t = terrainWith([
      { kind: 'dam', s: 80, d: 0, span: 30 },
      // 45 m at scale 1.5 is the same nominal 30 m layout.
      { kind: 'dam', s: 200, d: 0, span: 45, scale: 1.5 },
    ]);
    const specs = buildObstacleSpecs(t, 1);
    const [normal, scaled] = [specs.slice(0, 3), specs.slice(3)];
    for (const m of normal) {
      const b = worldBounds(m);
      expect(m.anchored).toBe(true);
      expect(m.material).toBe('stone');
      expect(m.breakMode).toBe('shatter');
      expect(m.building).toBe(false);
      expect(b.max.y - 5).toBeCloseTo(9, 1);
      expect(b.min.y).toBeLessThan(5);
      expect(colliders(m)).toBe(9);
      expect(new Set(m.parts.filter((p) => !p.decor).map((p) => p.piece)).size).toBe(9);
      expect(momentumBreakSpeed(m.breakImpulse, 30)).toBeCloseTo(40, 6);
      expect(momentumBreakSpeed(m.breakImpulse, 100)).toBeCloseTo(12, 6);
      // ~97 t per 10 m monolith (effective concrete density 0.3 t/m³).
      expect(m.mass).toBeGreaterThan(90);
      expect(m.mass).toBeLessThan(105);
      // Every course starts at the same upstream face (-z) and steps back downstream.
      const blocks = m.parts.filter((p) => !p.decor);
      const faces = blocks.map((p) => p.offset.z - p.scale.z / 2);
      expect(Math.max(...faces) - Math.min(...faces)).toBeLessThan(1e-6);
      const toes = [...new Set(blocks.map((p) => +(p.offset.z + p.scale.z / 2).toFixed(3)))];
      expect(toes.length).toBe(3);
    }
    // Placement scale: strength × s² (and mass × s³).
    for (const m of scaled) {
      expect(momentumBreakSpeed(m.breakImpulse, 30)).toBeCloseTo(40 * 2.25, 4);
      expect(m.mass).toBeCloseTo(normal[0].mass * 3.375, 3);
    }
  });

  it('on a V-shaped gorge the side monoliths are shorter and none stands above the crest', () => {
    const v = (x: number): number => 5 + 0.45 * Math.abs(x);
    const t = terrainWith([{ kind: 'dam', s: 80, d: 0, span: 40 }], v);
    const specs = buildObstacleSpecs(t, 1);
    const crest = Math.max(...specs.map((s) => worldBounds(s).max.y));
    expect(crest - 5).toBeCloseTo(9, 1);
    for (const s of specs) {
      const b = worldBounds(s);
      expect(b.max.y).toBeCloseTo(crest, 3);
      expect(b.min.y).toBeLessThan(t.heightAt(b.min.x, 80) + 0.15);
    }
    const centre = specs.reduce((a, b) => (Math.abs(b.position.x) < Math.abs(a.position.x) ? b : a));
    const side = specs.reduce((a, b) => (Math.abs(b.position.x) > Math.abs(a.position.x) ? b : a));
    expect(colliders(side)).toBeLessThan(colliders(centre));
  });
});
