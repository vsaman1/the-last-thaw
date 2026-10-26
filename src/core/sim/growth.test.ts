import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { createRng } from '../rng';
import type { IcebergParams, IcebergState, ObstacleProxy, Terrain } from '../types';
import { DEFAULT_ICEBERG_PARAMS as P, SIM_TUNING, withLevelIceberg } from './params';
import {
  absorbIce,
  canGrow,
  chipAmount,
  collectAbsorbable,
  contactTestImpulse,
  createIceberg,
  momentumTestImpulse,
  resolveIcebergContacts,
  setIce,
  sizeForIce,
  stepIceberg,
} from './iceberg';

/**
 * Expansion mechanics at the sim level: the momentum break rule, how hard a hit is on the ice
 * (shock) and what it chips off, growth by absorbing glacier ice, and the per-level iceberg.
 */

const DT = 1 / 60;
const hspeed = (s: IcebergState): number => Math.hypot(s.vel.x, s.vel.z);
const flat = createAnalyticTerrain({ height: () => 0 });

/** Breaking impulses the structure kit calibrates at M = 30 t: (1 + e) · breakSpeed · 30. */
const HOUSE_BREAK = 1.25 * 15 * 30; // 562.5
const PINE_BREAK = 1.25 * 7 * 30; // 262.5
const BROADLEAF_BREAK = 1.25 * 9 * 30; // 337.5

function icebergAt(speed: number, params: IcebergParams = P): IcebergState {
  const s = createIceberg(flat, params);
  s.pos.x = 0;
  s.pos.z = 50;
  s.vel.x = 0;
  s.vel.z = speed;
  s.heading = 0;
  return s;
}

function proxyAhead(s: IcebergState, o: Partial<ObstacleProxy>): ObstacleProxy {
  const radius = o.radius ?? 0.8;
  return {
    id: 7,
    kind: 'rockSmall',
    part: 'stone',
    x: 0,
    y: 0.4,
    z: s.pos.z + s.radius + radius - 0.2,
    radius,
    top: 1.2,
    bottom: 0,
    mass: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: false,
    breakImpulse: Infinity,
    state: 'loose',
    ...o,
  };
}

const house = (s: IcebergState, breakImpulse = HOUSE_BREAK): ObstacleProxy =>
  proxyAhead(s, {
    kind: 'house',
    part: 'house',
    mass: 12,
    radius: 3,
    top: 6,
    anchored: true,
    breakImpulse,
    state: 'intact',
  });

const tree = (s: IcebergState, kind: 'pine' | 'broadleaf', breakImpulse: number): ObstacleProxy =>
  proxyAhead(s, { kind, part: 'trunk', mass: 2, radius: 0.4, top: 8, anchored: true, breakImpulse });

/** Hit `o` head-on at `speed` with an iceberg of `mass` t; returns the contact and the iceberg. */
function hit(speed: number, mass: number, make: (s: IcebergState) => ObstacleProxy) {
  const s = icebergAt(speed, mass === P.mass ? P : { ...P, mass });
  const contacts = resolveIcebergContacts(s, [make(s)], P);
  expect(contacts).toHaveLength(1);
  return { c: contacts[0], s };
}

describe('momentum break rule (anchored obstacles)', () => {
  it('tests J = (1 + e) · vn · M with the iceberg’s current mass', () => {
    expect(momentumTestImpulse(15, 30)).toBeCloseTo(562.5, 9);
    expect(momentumTestImpulse(5, 100)).toBeCloseTo(625, 9);
    expect(momentumTestImpulse(-2, 30)).toBe(0);
    expect(momentumTestImpulse(NaN, 30)).toBe(0);
  });

  it('a 30 t iceberg bounces off a house at 12 m/s and smashes it at 15.2 m/s', () => {
    const slow = hit(12, 30, house);
    expect(slow.c.testImpulse).toBeCloseTo(1.25 * 12 * 30, 9);
    expect(slow.c.testImpulse!).toBeLessThan(HOUSE_BREAK);
    expect(slow.s.vel.z).toBeLessThan(0); // bounced back

    const fast = hit(15.2, 30, house);
    expect(fast.c.testImpulse).toBeCloseTo(1.25 * 15.2 * 30, 9);
    expect(fast.c.testImpulse!).toBeGreaterThanOrEqual(HOUSE_BREAK);
    expect(fast.s.vel.z).toBeGreaterThan(0);
  });

  it('a 100 t iceberg smashes the same house at 5 m/s', () => {
    const { c, s } = hit(5, 100, house);
    expect(c.testImpulse).toBeCloseTo(625, 9);
    expect(c.testImpulse!).toBeGreaterThanOrEqual(HOUSE_BREAK);
    // Smashing through keeps the loose-body velocity change, J = (1 + e) vn Mm/(M + m).
    const J = contactTestImpulse(5, 100, 12);
    expect(5 - hspeed(s)).toBeCloseTo(J / 100, 6);
    expect(Math.hypot(c.impulse.x, c.impulse.z)).toBeCloseTo(J, 6);
    expect(hspeed(s)).toBeGreaterThan(0.85 * 5);
  });

  it('a 30 t iceberg breaking a house keeps the loose-body speed loss (not stopped dead)', () => {
    const { s } = hit(16, 30, house);
    expect(16 - hspeed(s)).toBeCloseTo(contactTestImpulse(16, 30, 12) / 30, 6);
    expect(hspeed(s)).toBeGreaterThan(0.6 * 16);
  });

  it('keeps today’s tree break speeds at 30 t: pine ≈ 7 m/s, broadleaf ≈ 9 m/s', () => {
    const pine = (s: IcebergState): ObstacleProxy => tree(s, 'pine', PINE_BREAK);
    const broad = (s: IcebergState): ObstacleProxy => tree(s, 'broadleaf', BROADLEAF_BREAK);
    expect(hit(6.9, 30, pine).c.testImpulse!).toBeLessThan(PINE_BREAK);
    expect(hit(7.1, 30, pine).c.testImpulse!).toBeGreaterThan(PINE_BREAK);
    expect(hit(8.9, 30, broad).c.testImpulse!).toBeLessThan(BROADLEAF_BREAK);
    expect(hit(9.1, 30, broad).c.testImpulse!).toBeGreaterThan(BROADLEAF_BREAK);
  });

  it('a melted (lighter) iceberg needs more speed to break the same thing', () => {
    const s = icebergAt(17);
    setIce(s, 0.8, P);
    expect(s.mass).toBeCloseTo(24, 9);
    const c = resolveIcebergContacts(s, [house(s)], P)[0];
    expect(c.testImpulse).toBeCloseTo(1.25 * 17 * 24, 9);
    expect(c.testImpulse!).toBeLessThan(HOUSE_BREAK);
  });
});

describe('shock: how hard a hit is on the ice', () => {
  it('immovable obstacle: (1 + e) · vn', () => {
    const { c } = hit(12, 30, (s) => house(s, Infinity));
    expect(c.shock).toBeCloseTo(1.25 * 12, 9);
  });

  it('anchored obstacle that gives way: breakImpulse / M', () => {
    expect(hit(16, 30, house).c.shock).toBeCloseTo(HOUSE_BREAK / 30, 9);
    expect(hit(25, 30, house).c.shock).toBeCloseTo(HOUSE_BREAK / 30, 9);
    expect(hit(5, 100, house).c.shock).toBeCloseTo(HOUSE_BREAK / 100, 9);
  });

  it('loose body: J / M', () => {
    const { c } = hit(15, 30, (s) => proxyAhead(s, { mass: 4, radius: 1.4 }));
    expect(c.shock).toBeCloseTo(contactTestImpulse(15, 30, 4) / 30, 9);
    expect(c.testImpulse).toBeCloseTo(contactTestImpulse(15, 30, 4), 9);
  });

  it('is continuous at the break threshold (bounce just below = give way just above)', () => {
    const below = hit(14.999, 30, house).c.shock;
    const above = hit(15.001, 30, house).c.shock;
    expect(Math.abs(above - below)).toBeLessThan(0.01);
  });
});

describe('chipping: ice lost per hit (default params, M = 30 t unless stated)', () => {
  const chipFor = (speed: number, mass: number, make: (s: IcebergState) => ObstacleProxy): number =>
    chipAmount(hit(speed, mass, make).c.shock, P);

  it('is enabled by default with the tuned constants', () => {
    expect(P.chipPerShock).toBeCloseTo(0.006, 9);
    expect(P.chipThreshold).toBeCloseTo(2.5, 9);
    expect(P.maxIce).toBeCloseTo(6, 9);
    expect(chipAmount(P.chipThreshold, P)).toBe(0);
    expect(chipAmount(1000, P)).toBe(P.chipMax);
    expect(chipAmount(NaN, P)).toBe(0);
    expect(chipAmount(10, { ...P, chipPerShock: 0 })).toBe(0);
  });

  it('smashing a house costs 8-12 % (9.75 %)', () => {
    const v = chipFor(16, 30, house);
    expect(v).toBeCloseTo(0.0975, 6);
    expect(v).toBeGreaterThan(0.08);
    expect(v).toBeLessThan(0.12);
  });

  it('felling a pine costs 3-4 % (3.75 %); a broadleaf 5.25 %', () => {
    const pine = chipFor(10, 30, (s) => tree(s, 'pine', PINE_BREAK));
    expect(pine).toBeCloseTo(0.0375, 6);
    expect(pine).toBeGreaterThan(0.03);
    expect(pine).toBeLessThan(0.04);
    expect(chipFor(12, 30, (s) => tree(s, 'broadleaf', BROADLEAF_BREAK))).toBeCloseTo(0.0525, 6);
  });

  it('bouncing off a house at 12 m/s costs 7-9 % (7.5 %)', () => {
    const v = chipFor(12, 30, house);
    expect(v).toBeCloseTo(0.075, 6);
    expect(v).toBeGreaterThan(0.07);
    expect(v).toBeLessThan(0.09);
  });

  it('light rocks cost nothing; a medium rock at 15 m/s nothing; heavy stones a little', () => {
    expect(chipFor(20, 30, (s) => proxyAhead(s, { mass: 0.8 }))).toBe(0);
    expect(chipFor(15, 30, (s) => proxyAhead(s, { mass: 4, radius: 1.4 }))).toBe(0);
    const stone = chipFor(18, 30, (s) => proxyAhead(s, { kind: 'stoneBarrier', mass: 7.5, radius: 1.2 }));
    expect(stone).toBeGreaterThan(0.005);
    expect(stone).toBeLessThan(0.02);
  });

  it('a 100 t iceberg smashing a house loses only 1-2 % (1.875 %)', () => {
    const v = chipFor(6, 100, house);
    expect(v).toBeCloseTo(0.01875, 6);
    expect(v).toBeGreaterThan(0.01);
    expect(v).toBeLessThan(0.02);
  });

  it('a small iceberg barely breaking a house loses a big bite', () => {
    const s = icebergAt(30);
    setIce(s, 0.5, P); // 15 t
    const c = resolveIcebergContacts(s, [house(s)], P)[0];
    expect(c.testImpulse!).toBeGreaterThanOrEqual(HOUSE_BREAK);
    expect(chipAmount(c.shock, P)).toBeGreaterThan(0.2);
  });
});

describe('growth: ice above 1', () => {
  it('size = cbrt(ice) above 1 and minSize + (1 - minSize)·ice below; mass and radius follow', () => {
    const s = createIceberg(flat, P);
    expect(sizeForIce(1, P)).toBe(1);
    expect(sizeForIce(0, P)).toBeCloseTo(P.minSize, 12);
    expect(sizeForIce(8, P)).toBeCloseTo(2, 12);
    setIce(s, 2, P);
    expect(s.ice).toBe(2);
    expect(s.size).toBeCloseTo(Math.cbrt(2), 12);
    expect(s.radius).toBeCloseTo(P.radius * Math.cbrt(2), 12);
    expect(s.mass).toBeCloseTo(60, 12);
    setIce(s, 0.5, P);
    expect(s.size).toBeCloseTo(P.minSize + (1 - P.minSize) * 0.5, 12);
    expect(s.mass).toBeCloseTo(15, 12);
    setIce(s, 99, P);
    expect(s.ice).toBe(P.maxIce);
    expect(s.mass).toBeCloseTo(P.mass * P.maxIce, 12);
    expect(canGrow(s, P)).toBe(false);
    setIce(s, -1, P);
    expect(s.ice).toBe(0);
  });

  it('absorbing conserves horizontal momentum, grows mass/size/radius and slows the iceberg', () => {
    const s = icebergAt(12);
    const merged = absorbIce(s, 15, { x: 0, y: 0, z: 0 }, P);
    expect(merged).toBe(15);
    expect(s.mass).toBeCloseTo(45, 12);
    expect(s.ice).toBeCloseTo(1.5, 12);
    expect(s.size).toBeCloseTo(Math.cbrt(1.5), 12);
    expect(s.radius).toBeCloseTo(P.radius * Math.cbrt(1.5), 12);
    expect(s.vel.z).toBeCloseTo((30 * 12) / 45, 12);
    expect(s.mass * s.vel.z).toBeCloseTo(30 * 12, 9);

    const m = icebergAt(10);
    absorbIce(m, 10, { x: 3, y: 0, z: 2 }, P);
    expect(m.vel.x).toBeCloseTo((10 * 3) / 40, 12);
    expect(m.vel.z).toBeCloseTo((30 * 10 + 10 * 2) / 40, 12);
  });

  it('respects maxIce: merges only what fits and nothing once full', () => {
    const cap = { ...P, maxIce: 1.5 };
    const s = icebergAt(12, cap);
    setIce(s, 1.2, cap); // 36 t
    const merged = absorbIce(s, 30, { x: 0, y: 0, z: 0 }, cap);
    expect(merged).toBeCloseTo(9, 9);
    expect(s.ice).toBeCloseTo(1.5, 12);
    expect(s.mass).toBeCloseTo(45, 9);
    expect(s.vel.z).toBeCloseTo((36 * 12) / 45, 9);
    const v = s.vel.z;
    expect(absorbIce(s, 5, { x: 0, y: 0, z: 0 }, cap)).toBe(0);
    expect(s.vel.z).toBe(v);
    expect(absorbIce(icebergAt(5), NaN, { x: 0, y: 0, z: 0 }, P)).toBe(0);
  });

  it('the contact solver leaves glacier ice to absorption while the iceberg can grow', () => {
    const s = icebergAt(12);
    const block = proxyAhead(s, { kind: 'iceBlock', part: 'ice', mass: 5, radius: 1.2, absorbable: true });
    expect(resolveIcebergContacts(s, [block], P)).toHaveLength(0);
    expect(hspeed(s)).toBe(12);
    const ids: number[] = [];
    const far = { ...block, id: 9, z: block.z + 10 };
    const rock = { ...block, id: 10, absorbable: false };
    expect(collectAbsorbable(s, [block, far, rock], ids)).toBe(1);
    expect(ids).toEqual([7]);
    // Without absorption (or once full) it is just a loose block of ice that gets pushed.
    expect(resolveIcebergContacts(s, [block], P, { absorbing: false })).toHaveLength(1);
    const full = icebergAt(12);
    setIce(full, P.maxIce, P);
    const b2 = proxyAhead(full, { kind: 'iceBlock', mass: 5, radius: 1.2, absorbable: true });
    expect(resolveIcebergContacts(full, [b2], P)).toHaveLength(1);
    expect(collectAbsorbable(full, [b2], ids)).toBe(0);
  });

  it('shock and testImpulse stay finite and non-negative for any iceberg size and body', () => {
    const rng = createRng(77);
    for (let k = 0; k < 400; k++) {
      const s = icebergAt(rng() * 30);
      setIce(s, rng() * 7, P);
      s.vel.x = (rng() - 0.5) * 10;
      const r = rng();
      const o = proxyAhead(s, {
        x: (rng() - 0.5) * 3,
        mass: r < 0.1 ? 0 : r < 0.2 ? Infinity : 0.5 + rng() * 60,
        anchored: rng() < 0.5,
        breakImpulse: rng() < 0.3 ? Infinity : rng() * 2000,
        absorbable: rng() < 0.2,
      });
      for (const c of resolveIcebergContacts(s, [o], P, { absorbing: rng() < 0.5 })) {
        expect(Number.isFinite(c.shock) && c.shock >= 0, `shock ${c.shock}`).toBe(true);
        expect(Number.isFinite(c.testImpulse!) && c.testImpulse! >= 0).toBe(true);
        const chip = chipAmount(c.shock, P);
        expect(chip >= 0 && chip <= P.chipMax).toBe(true);
      }
      expect(Number.isFinite(s.pos.x + s.pos.z + s.vel.x + s.vel.z)).toBe(true);
    }
  });

  it('a bigger iceberg is taller: it hits bodies a normal one passes under', () => {
    const s = icebergAt(10);
    const high = (st: IcebergState): ObstacleProxy =>
      proxyAhead(st, { bottom: st.pos.y + 3.5, top: st.pos.y + 4.5, anchored: true, mass: 5 });
    expect(resolveIcebergContacts(s, [high(s)], P)).toHaveLength(0);
    const big = icebergAt(10);
    setIce(big, 6, P);
    expect(resolveIcebergContacts(big, [high(big)], P)).toHaveLength(1);
    const scaled = withLevelIceberg(P, { scale: 2, mass: 100 });
    const lvl = icebergAt(10, scaled);
    expect(resolveIcebergContacts(lvl, [high(lvl)], scaled)).toHaveLength(1);
  });
});

describe('per-level iceberg', () => {
  it('withLevelIceberg scales the radius and sets the mass; bad values are ignored', () => {
    const p = withLevelIceberg(P, { scale: 2, mass: 100 });
    expect(p.radius).toBeCloseTo(4.4, 12);
    expect(p.mass).toBe(100);
    expect(p.friction).toBe(P.friction);
    expect(withLevelIceberg(P, undefined)).toBe(P);
    expect(withLevelIceberg(P, { scale: 1, mass: 30 })).toEqual(P);
    const bad = withLevelIceberg(P, { scale: 0, mass: NaN });
    expect(bad.radius).toBe(P.radius);
    expect(bad.mass).toBe(P.mass);
    const s = createIceberg(flat, p);
    expect(s.radius).toBeCloseTo(4.4, 12);
    expect(s.mass).toBe(100);
    expect(s.ice).toBe(1);
    expect(s.size).toBe(1);
  });
});

// --- integrator stability with mass / size changes ---------------------------------------------

/** A 0.09 slope along +Z. */
const slope09 = createAnalyticTerrain({
  height: inclinedPlane(0.09, 120),
  length: 1200,
  width: 80,
  cellSize: 2,
});

function cruise(terrain: Terrain, ice: number, seconds: number): number {
  const s = createIceberg(terrain, P);
  setIce(s, ice, P);
  s.vel.z = 15;
  for (let i = 0; i < seconds / DT; i++) {
    stepIceberg(s, { steer: 0, source: 'none' }, terrain, DT, P, i * DT);
  }
  return hspeed(s);
}

describe('avalanche: a grown iceberg carries its speed better', () => {
  it('drag per tonne falls as it grows (terminal speed rises); melting leaves it unchanged', () => {
    const normal = cruise(slope09, 1, 40);
    const grown = cruise(slope09, 6, 40);
    const melted = cruise(slope09, 0.5, 40);
    expect(normal).toBeGreaterThan(20);
    expect(normal).toBeLessThan(25);
    expect(grown).toBeGreaterThan(normal + 3);
    expect(grown).toBeLessThanOrEqual(P.maxSpeed);
    expect(Math.abs(melted - normal)).toBeLessThan(1e-9);
    expect(SIM_TUNING.growthDragExponent).toBeGreaterThan(0);
  });
});

describe('growth keeps the integrator stable', () => {
  // Floor 12 m wide (|x| < 6), walls rising at slope 2.5 beyond it, 0.1 descent along +Z.
  const valley = createAnalyticTerrain({
    height: (x, z) => 100 - 0.1 * z + 2.5 * Math.max(0, Math.abs(x) - 6),
    length: 600,
    width: 60,
    cellSize: 1,
  });

  it('growing next to a wall and a tree does not shove the iceberg up the wall', () => {
    const s = createIceberg(valley, P);
    s.pos.x = 5;
    s.pos.z = 60;
    s.pos.y = valley.heightAt(s.pos.x, s.pos.z);
    s.vel.x = 0;
    s.vel.z = 3;
    // An unbreakable trunk just touching the iceberg's left side.
    const post: ObstacleProxy = {
      ...proxyAhead(s, {}),
      kind: 'pine',
      x: s.pos.x - s.radius - 0.45,
      z: s.pos.z,
      radius: 0.5,
      top: s.pos.y + 9,
      bottom: s.pos.y - 1,
      anchored: true,
      breakImpulse: Infinity,
      mass: 2,
    };
    // radius 2.2 → 4.0 in one step: 1.85 m of overlap with the trunk, which would shove the centre
    // 0.85 m past the wall toe (2.1 m up the wall) without the terrain guard.
    setIce(s, 6, P);
    const opts = { terrain: valley };
    for (let i = 0; i < 180; i++) {
      stepIceberg(s, { steer: 0, source: 'none' }, valley, DT, P, 10 + i * DT);
      post.bottom = s.pos.y - 1;
      post.top = s.pos.y + 9;
      resolveIcebergContacts(s, [post], P, opts);
      const floor = 100 - 0.1 * s.pos.z;
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.vel.z)).toBe(true);
      expect(s.pos.y - floor, `step ${i}: x=${s.pos.x.toFixed(2)}`).toBeLessThan(0.3);
      expect(hspeed(s)).toBeLessThan(P.maxSpeed);
    }
  });

  it('absorbing block after block while weaving down a narrow valley stays finite and on the floor', () => {
    const s = createIceberg(valley, P);
    let t = 0;
    for (let i = 0; i < 60 * 20; i++, t += DT) {
      if (i % 40 === 0 && canGrow(s, P)) absorbIce(s, 6, { x: 0, y: 0, z: 0 }, P);
      const steer = Math.sin(t * 1.3);
      stepIceberg(s, { steer, source: 'scripted' }, valley, DT, P, t);
      const floor = 100 - 0.1 * s.pos.z;
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.vel.z)).toBe(true);
      if (s.grounded) expect(s.pos.y - floor).toBeLessThan(2);
      expect(Math.abs(s.pos.x)).toBeLessThan(7);
    }
    expect(s.ice).toBe(P.maxIce);
    expect(s.pos.z).toBeGreaterThan(40); // each still block it swallows costs speed, but it keeps going
  });
});
