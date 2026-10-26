import { describe, expect, it } from 'vitest';
import { INTRO_TIMING, calvingTimeAt, flyoverFor, introStageAt, introTimeline } from '../intro';
import {
  CALVING_TUNING,
  type CalvingMotion,
  calvingKeys,
  calvingShake,
  calvingStateAt,
  calvingVeil,
  createCalvingState,
  slideProgress,
  slideRate,
} from './calving';

const MOTIONS: CalvingMotion[] = [
  { slide: 3.2, ledge: 0.3, endSpeed: 6 },
  { slide: 4.02, ledge: 0.35, endSpeed: 6 },
  { slide: 5, ledge: 0.77, endSpeed: 6 },
  { slide: 4, ledge: 0.4, endSpeed: 0 },
];

describe('intro timelines', () => {
  it('full = flyover + calving, short = the short calving only, none = nothing', () => {
    const full = introTimeline('full');
    expect(full.flyover).toBe(INTRO_TIMING.flyover);
    expect(full.calving).toBe(INTRO_TIMING.calving);
    expect(full.total).toBe(INTRO_TIMING.flyover + INTRO_TIMING.calving);
    const short = introTimeline('short');
    expect(short).toMatchObject({ flyover: 0, calving: INTRO_TIMING.calvingShort });
    expect(short.calving).toBeGreaterThan(1);
    expect(short.calving).toBeLessThan(1.5);
    expect(introTimeline('none').total).toBe(0);
    // Shared, frozen objects: a switch is detectable by identity.
    expect(introTimeline('full')).toBe(full);
    expect(Object.isFrozen(full)).toBe(true);
  });

  it('reports the stage and the calving clock at any time (NaN counts as over)', () => {
    const full = introTimeline('full');
    expect(introStageAt(full, 0)).toBe('flyover');
    expect(introStageAt(full, full.flyover - 1e-6)).toBe('flyover');
    expect(introStageAt(full, full.flyover)).toBe('calving');
    expect(introStageAt(full, full.total)).toBe('done');
    expect(introStageAt(full, NaN)).toBe('done');
    expect(introStageAt(introTimeline('short'), 0)).toBe('calving');
    expect(introStageAt(introTimeline('none'), 0)).toBe('done');
    expect(calvingTimeAt(full, 3)).toBe(0);
    expect(calvingTimeAt(full, full.flyover + 1.25)).toBeCloseTo(1.25, 12);
    expect(calvingTimeAt(full, 99)).toBe(full.calving);
    expect(calvingTimeAt(full, NaN)).toBe(full.calving);
  });
});

describe('calving keys', () => {
  for (const d of [INTRO_TIMING.calvingShort, 2, INTRO_TIMING.calving]) {
    it(`are ordered and inside the ${d} s calving`, () => {
      const k = calvingKeys(d);
      expect(k.duration).toBe(d);
      const order = [0, k.shudderFrom, k.crackEnd, k.breakAt, k.tiltPeak, k.landAt, k.settleAt, d];
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
      expect(k.cutAt).toBeGreaterThan(k.breakAt);
      expect(k.cutAt + k.veilOut).toBeLessThanOrEqual(d);
      expect(k.cutAt - k.veilIn).toBeGreaterThan(0);
    });
  }

  it('fall back to the full calving for a bad duration', () => {
    expect(calvingKeys(NaN).duration).toBe(INTRO_TIMING.calving);
    expect(calvingKeys(0).duration).toBe(INTRO_TIMING.calving);
  });
});

describe('slide profile', () => {
  it('rises monotonically from 0 to 1 with slope 0 at the start and m at the end', () => {
    for (const m of [0, 0.5, 1, 1.6, 2, 2.5, 3, 3.4, 5]) {
      let prev = -1;
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        const p = slideProgress(u, m);
        expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(slideRate(u, m)).toBeGreaterThanOrEqual(-1e-12);
        prev = p;
      }
      expect(slideProgress(0, m)).toBe(0);
      expect(slideProgress(1, m)).toBeCloseTo(1, 12);
      expect(slideRate(0, m)).toBe(0);
      expect(slideRate(1, m)).toBeCloseTo(m, 9);
      // The rate is the derivative of the progress.
      const h = 1e-5;
      expect((slideProgress(0.6 + h, m) - slideProgress(0.6 - h, m)) / (2 * h)).toBeCloseTo(slideRate(0.6, m), 4);
    }
  });
});

describe('calving state', () => {
  for (const duration of [INTRO_TIMING.calvingShort, INTRO_TIMING.calving]) {
    for (const motion of MOTIONS) {
      const label = `${duration} s, slide ${motion.slide} m at ${motion.endSpeed} m/s`;
      const k = calvingKeys(duration);

      it(`starts embedded and lands exactly on the spawn pose (${label})`, () => {
        const s = calvingStateAt(k, 0, motion, createCalvingState());
        expect(s).toMatchObject({ along: motion.slide, lift: motion.ledge, broken: false, speed: 0 });
        expect(s.crack).toBe(0);
        expect(s.frost).toBeGreaterThan(0);
        const end = calvingStateAt(k, duration, motion, createCalvingState());
        expect(end).toMatchObject({ along: 0, lift: 0, tilt: 0, roll: 0, shudder: 0, glow: 0, frost: 0 });
        expect(end.speed).toBe(motion.endSpeed);
        expect(end.broken).toBe(true);
        expect(end.crack).toBe(CALVING_TUNING.crackFull);
        // NaN and past the end are the hand-off too.
        expect(calvingStateAt(k, NaN, motion, createCalvingState())).toEqual(end);
      });

      it(`moves smoothly, only after the break, never back upstream (${label})`, () => {
        const s = createCalvingState();
        const dt = 1 / 240;
        let prev = calvingStateAt(k, 0, motion, createCalvingState());
        let maxStep = 0;
        for (let t = dt; t <= duration + 1e-9; t += dt) {
          calvingStateAt(k, t, motion, s);
          for (const v of [s.crack, s.glow, s.along, s.lift, s.tilt, s.roll, s.speed, s.frost]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          if (t < k.breakAt) {
            expect(s.along).toBe(motion.slide);
            expect(s.lift).toBe(motion.ledge);
          }
          expect(s.along).toBeLessThanOrEqual(prev.along + 1e-12);
          expect(s.crack).toBeGreaterThanOrEqual(prev.crack - 1e-12);
          expect(s.lift).toBeGreaterThanOrEqual(-1e-12);
          expect(Math.abs(s.tilt)).toBeLessThanOrEqual(CALVING_TUNING.maxTilt + 1e-12);
          // The drawn chunk never jumps: at most a frame of the spawn speed (plus a margin).
          maxStep = Math.max(maxStep, Math.abs(s.along - prev.along) + Math.abs(s.lift - prev.lift));
          prev = { ...s };
        }
        // Bounded by the fastest slide (ease or spawn speed) plus the drop off the ledge.
        const window = duration - k.breakAt;
        const slideSpeed = Math.max(motion.endSpeed, (1.5 * motion.slide) / window);
        const dropSpeed = (2 * motion.ledge) / (k.landAt - k.breakAt);
        expect(maxStep).toBeLessThan((slideSpeed + dropSpeed) * 1.2 * dt);
      });

      it(`reaches the spawn speed at the hand-off (${label})`, () => {
        // Finite difference of the drawn offset just before the end = the iceberg's spawn speed.
        const h = 1e-4;
        const a = calvingStateAt(k, duration - 2 * h, motion, createCalvingState()).along;
        const b = calvingStateAt(k, duration - h, motion, createCalvingState()).along;
        expect((a - b) / h).toBeCloseTo(motion.endSpeed, 1);
        expect(calvingStateAt(k, duration - h, motion, createCalvingState()).speed).toBeCloseTo(
          motion.endSpeed,
          2,
        );
      });
    }
  }

  it('lifts the reduced-motion veil only around the cut, and shakes only from the break', () => {
    for (const d of [INTRO_TIMING.calvingShort, INTRO_TIMING.calving]) {
      const k = calvingKeys(d);
      expect(calvingVeil(k, k.cutAt)).toBeCloseTo(CALVING_TUNING.veilPeak, 12);
      expect(calvingVeil(k, 0)).toBe(0);
      expect(calvingVeil(k, k.cutAt - k.veilIn - 1e-3)).toBe(0);
      expect(calvingVeil(k, k.cutAt + k.veilOut + 1e-3)).toBe(0);
      expect(calvingVeil(k, d)).toBe(0);
      for (let t = 0; t <= d; t += 0.01) {
        const v = calvingVeil(k, t);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(CALVING_TUNING.veilPeak);
      }
      expect(calvingShake(k, k.breakAt - 1e-3)).toBe(0);
      expect(calvingShake(k, k.breakAt)).toBeGreaterThan(0.1);
      expect(calvingShake(k, d)).toBe(0);
      expect(calvingShake(k, NaN)).toBe(0);
    }
  });
});

describe('flyover length follows the route', () => {
  it('7.5 s up to 1.2 km of route, a second per 300 m beyond, at most 11 s', () => {
    expect(flyoverFor(510)).toBe(7.5);
    expect(flyoverFor(undefined)).toBe(7.5);
    expect(flyoverFor(1800)).toBeCloseTo(9.5);
    expect(flyoverFor(5000)).toBe(11);
    expect(introTimeline('full', 1800).flyover).toBeCloseTo(9.5);
    expect(introTimeline('short', 1800)).toBe(introTimeline('short'));
  });
});
