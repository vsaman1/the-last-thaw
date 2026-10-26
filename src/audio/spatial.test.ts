import { describe, expect, it } from 'vitest';
import { AIR_LOWPASS, SPATIAL, type SpatialClass } from './contract';
import {
  airLowpassHz,
  createListenerPose,
  createSpatialOut,
  distanceGain,
  listenerFromMatrix,
  panFor,
  spatialize,
} from './spatial';

describe('distance', () => {
  it('no attenuation inside refM; (1/2)^rolloff at twice refM, for every profile', () => {
    for (const key of Object.keys(SPATIAL) as SpatialClass[]) {
      const p = SPATIAL[key];
      expect(distanceGain(0, p)).toBe(1);
      expect(distanceGain(p.refM, p)).toBe(1);
      expect(distanceGain(2 * p.refM, p)).toBeCloseTo(Math.pow(0.5, p.rolloff), 12);
    }
  });

  it('a bell at the Riverside start (565 m) is low-passed to 2.5 kHz +/- 5% (DESIGN §2.5)', () => {
    const hz = airLowpassHz(565, SPATIAL.bells.refM);
    expect(hz).toBeGreaterThan(2500 * 0.95);
    expect(hz).toBeLessThan(2500 * 1.05);
  });

  it('the air low-pass is open inside refM and never below its floor', () => {
    expect(airLowpassHz(10, 40)).toBe(AIR_LOWPASS.hzAtRef);
    expect(airLowpassHz(40, 40)).toBe(AIR_LOWPASS.hzAtRef);
    expect(airLowpassHz(1e6, 40)).toBe(AIR_LOWPASS.minHz);
    let prev = Infinity;
    for (let d = 41; d < 3000; d += 37) {
      const hz = airLowpassHz(d, 40);
      expect(hz).toBeLessThanOrEqual(prev);
      prev = hz;
    }
  });
});

describe('pan', () => {
  const pose = createListenerPose(); // at the origin, facing -z, right = +x

  it('is symmetric left and right, zero ahead and behind, and never past the limit', () => {
    const lim = SPATIAL.effects.panLimit;
    expect(panFor(pose, 30, -30, lim)).toBeCloseTo(-panFor(pose, -30, -30, lim), 12);
    expect(panFor(pose, 0, -50, lim)).toBeCloseTo(0, 12);
    expect(panFor(pose, 0, 50, lim)).toBeCloseTo(0, 12);
    expect(panFor(pose, 100, 0, lim)).toBeCloseTo(lim, 12);
    expect(panFor(pose, -100, 0, lim)).toBeCloseTo(-lim, 12);
    expect(panFor(pose, 0, 0, lim)).toBe(0);
  });

  it('follows the camera: a sound straight ahead of a camera turned to +x is centred', () => {
    // A camera yawed -90° (looking along +x): right = (0, 0, 1) in world space.
    const m = new Array<number>(16).fill(0);
    m[0] = 0; m[2] = 1; // x axis -> world +z
    m[5] = 1;
    m[8] = -1; m[10] = 0; // z axis -> world -x, so forward = +x
    m[12] = 5; m[13] = 2; m[14] = -3;
    const p = listenerFromMatrix(m, createListenerPose());
    expect(p).toMatchObject({ px: 5, py: 2, pz: -3, rightX: 0, rightZ: 1, fwdX: 1, fwdZ: -0 });
    expect(panFor(p, 50, -3, 0.5)).toBeCloseTo(0, 12);
    expect(panFor(p, 5, 40, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('spatialize', () => {
  it('fills the caller-owned object and returns it (no allocation)', () => {
    const out = createSpatialOut();
    const pose = createListenerPose();
    const r1 = spatialize(pose, 0, 0, -80, SPATIAL.effects, out);
    const r2 = spatialize(pose, 0, 0, -800, SPATIAL.effects, out);
    expect(r1).toBe(out);
    expect(r2).toBe(out);
    expect(out.culled).toBe(true);
    const near = spatialize(pose, 0, 0, -80, SPATIAL.effects, createSpatialOut());
    expect(near).toMatchObject({ distM: 80, gain: 0.5, culled: false });
  });
});
