import { describe, expect, it } from 'vitest';
import { createAnalyticTerrain } from '../testing/analyticTerrain';
import type { IcebergParams, IcebergState, ObstacleProxy } from '../types';
import { momentumBreakImpulse } from '../obstacles/catalog';
import { DEFAULT_ICEBERG_PARAMS, SIM_TUNING, withLevelIceberg } from './params';
import {
  breakClosingSpeed,
  contactTestImpulse,
  createIceberg,
  momentumTestImpulse,
  resolveIcebergContacts,
} from './iceberg';

/**
 * Glancing hits on standing bodies: the break test counts the share of the sliding speed a hull
 * scraping past drags the body's foot along with (breakClosingSpeed), never more than a head-on hit
 * at the same speed; what the iceberg pays when one gives way is unchanged. Before, only the normal
 * closing speed counted, so a 130 t iceberg whose hull swept over a wind turbine's steel shaft
 * bounced off it and left it standing.
 */

const flat = createAnalyticTerrain({ height: () => 0 });
const MU = SIM_TUNING.breakFriction;

/** The wind turbine's tower as the solver sees it: a 3 m circle, 36 t, breaks at 20 m/s for 30 t. */
function tower(): ObstacleProxy {
  return {
    id: 7,
    kind: 'windTurbine',
    part: 'windTurbine',
    x: 0,
    y: 20,
    z: 100,
    radius: 3,
    top: 40,
    bottom: 0,
    mass: 36,
    vx: 0,
    vy: 0,
    vz: 0,
    anchored: true,
    breakImpulse: momentumBreakImpulse(20),
    state: 'intact',
  };
}

/** A melted level iceberg of `mass` t (Power Valley: 220 t at scale 2.2, size 0.55 + 0.45·ice). */
function paramsFor(mass: number): IcebergParams {
  const scale = 2.2 * (0.55 + 0.45 * (mass / 220));
  return withLevelIceberg(DEFAULT_ICEBERG_PARAMS, { mass, scale });
}

/** An iceberg moving +z at `speed`, its line `d` m beside the tower, its hull 0.1 m into it. */
function grazing(P: IcebergParams, speed: number, d: number): IcebergState {
  const s = createIceberg(flat, P);
  const reach = P.radius + 3 - 0.1;
  s.pos.x = -d;
  s.pos.z = 100 - Math.sqrt(reach * reach - d * d);
  s.pos.y = 0;
  s.vel.x = 0;
  s.vel.y = 0;
  s.vel.z = speed;
  s.heading = 0;
  return s;
}

describe('breakClosingSpeed: the normal speed plus the friction share of a scrape', () => {
  it('head-on it is the closing speed; a scrape adds mu·vt, never beyond the relative speed', () => {
    expect(breakClosingSpeed(6, 0)).toBe(6);
    expect(breakClosingSpeed(3, 4)).toBeCloseTo(3 + MU * 4, 12);
    expect(breakClosingSpeed(3, 4, 0)).toBe(3);
    // mu 0.9 would count 6.6 m/s for a 5 m/s relative speed: capped at 5.
    expect(breakClosingSpeed(3, 4, 0.9)).toBeCloseTo(5, 12);
    for (let a = 0.05; a < Math.PI / 2; a += 0.05) {
      const vn = 10 * Math.cos(a);
      const vt = 10 * Math.sin(a);
      expect(breakClosingSpeed(vn, vt)).toBeLessThanOrEqual(10 + 1e-9);
      expect(breakClosingSpeed(vn, vt)).toBeGreaterThanOrEqual(vn);
    }
    expect(breakClosingSpeed(0, 10)).toBe(0);
    expect(breakClosingSpeed(-1, 10)).toBe(0);
  });
});

describe('a glancing hit on a wind turbine (solver)', () => {
  it('130 t at 6 m/s, hull over the steel shaft (line 5 m off): breaks it (was: bounced off)', () => {
    const P = paramsFor(130);
    const s = grazing(P, 6, 5);
    const o = tower();
    const [c] = resolveIcebergContacts(s, [o], P);
    expect(c.obstacleId).toBe(o.id);
    // The normal speed alone falls short of the 750 t·m/s it takes (the old rule bounced it) ...
    expect(momentumTestImpulse(c.relSpeed, 130)).toBeLessThan(o.breakImpulse);
    // ... the scrape's drag makes it.
    expect(c.testImpulse).toBeGreaterThanOrEqual(o.breakImpulse);
    // It gives way: the iceberg pays the unchanged loose-body exchange with 36 t at the normal
    // closing speed instead of bouncing (a bounce left it ~2.5 m/s), pushing the tower away from
    // it along the normal (across and along its path).
    expect(s.vel.z).toBeGreaterThan(0.8 * 6);
    const J = contactTestImpulse(c.relSpeed, 130, 36);
    expect(c.impulse.x).toBeCloseTo(J * c.normal.x, 9);
    expect(c.impulse.z).toBeCloseTo(J * c.normal.z, 9);
    expect(c.normal.x).toBeGreaterThan(0.5);
    expect(c.normal.z).toBeGreaterThan(0.5);
  });

  it('a light iceberg grazing it never fells it below its head-on break speed (30 t, 19.5 m/s)', () => {
    const P = withLevelIceberg(DEFAULT_ICEBERG_PARAMS, { mass: 30, scale: 1 });
    const R = P.radius + 3;
    for (let d = 0; d < R - 0.2; d += 0.25) {
      const s = grazing(P, 19.5, d);
      const o = tower();
      const [c] = resolveIcebergContacts(s, [o], P);
      expect(c.testImpulse, `line ${d} m off`).toBeLessThan(o.breakImpulse);
      // It bounces off the standing tower, as before.
      expect(s.vel.z, `line ${d} m off`).toBeLessThan(19.5);
    }
  });

  it('a head-on hit counts exactly as before', () => {
    const P = paramsFor(220);
    const s = grazing(P, 4, 0);
    const [c] = resolveIcebergContacts(s, [tower()], P);
    expect(c.testImpulse).toBeCloseTo(momentumTestImpulse(4, 220), 9);
    expect(c.impulse.x).toBeCloseTo(0, 9);
  });
});
