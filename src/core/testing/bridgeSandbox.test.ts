import { describe, expect, it } from 'vitest';
import { bridgePlans, trafficLines } from '../obstacles/bridges';
import type { PhysicsWorld } from '../physics/world';
import { FIXED_DT, GameSession, getTerrain } from '../session';
import { validateLevel, validateWorldLogic } from '../terrain/validate';
import { bridgeSandbox } from './bridgeSandbox';

/** The bridge sandbox: a road over a gorge on a road bridge, a footbridge beside it, traffic. */

const L = bridgeSandbox;

describe('bridge sandbox', () => {
  const terrain = getTerrain(L);

  it('passes every level-design check, the world logic included (no warnings either)', () => {
    expect(validateLevel(terrain)).toEqual([]);
    expect(validateWorldLogic(terrain)).toEqual([]);
  });

  it('both bridges run from rim to rim, ramped, their ends on the ground; the road crosses', () => {
    const plans = bridgePlans(terrain);
    expect(plans.map((b) => `${b.kind}:${b.mode}`)).toEqual(['roadBridge:rims', 'footbridge:rims']);
    for (const b of plans) {
      expect(Math.abs(b.grade)).toBeGreaterThan(0.08);
      for (const e of b.ends) expect(Math.abs(e.top - e.ground)).toBeLessThan(0.3);
      expect(b.depthBelow).toBeGreaterThan(10);
    }
    expect(trafficLines(terrain).filter((l) => l.bridge === 0)).toHaveLength(1);
  });

  it('runs: cars drive over the road bridge at deck height', async () => {
    const s = await GameSession.create({ level: L, skipIntro: true });
    const w = s.physics as PhysicsWorld;
    const t = w.traffic!;
    expect(t.count).toBe(5);
    let onDeck = 0;
    for (let k = 0; k < 40 * 60; k++) {
      w.step(FIXED_DT);
      for (let i = 0; i < t.count; i++) {
        const b = w.bodies[t.body[i]];
        if (!t.active[i] || Math.abs(b.pos.z - 160) > 8) continue;
        if (b.pos.y - terrain.heightAt(b.pos.x, b.pos.z) > 8) onDeck++;
      }
    }
    // Several vehicles crossed (each spends ~1.5 s over the gorge: ~90 steps), none fell in.
    expect(onDeck).toBeGreaterThan(150);
    expect(t.driving).toBe(5);
    s.dispose?.();
  });
});
