import { describe, expect, it } from 'vitest';
import { LEVELS } from '../levels';
import { getTerrain } from '../session';
import { type IntroKind, introTimeline, routeLengthOf } from '../intro';
import { calvingKeys } from '../glacier/calving';
import { getGlacier, glacierTopAt, spawnIcebergFor } from '../glacier/glacier';
import {
  CALVING_SHOT,
  CAMERA_TUNING,
  CameraController,
  type CameraPose,
  createCameraPose,
  followPose,
  getCalvingShot,
  getIntroPath,
  groundAt,
  introCameraPose,
  isFinitePose,
} from './camera';

type P = { x: number; y: number; z: number };
const dist3 = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: CameraPose): CameraPose => ({ position: { ...p.position }, lookAt: { ...p.lookAt }, fov: p.fov });

describe.each(LEVELS.map((l) => [l.id, l] as const))('calving camera on %s', (_id, level) => {
  const terrain = getTerrain(level);
  const ice = spawnIcebergFor(terrain);
  const glacier = getGlacier(terrain);
  const shot = getCalvingShot(terrain);

  for (const kind of ['full', 'short'] as IntroKind[]) {
    for (const reduceMotion of [false, true]) {
      const label = `${kind}${reduceMotion ? ', reduced motion' : ''}`;
      const tl = introTimeline(kind, routeLengthOf(level));

      it(`is finite, clear of terrain and glacier, and ends on the follow pose (${label})`, () => {
        const pose = createCameraPose();
        const n = Math.round(tl.total * 60);
        for (let i = 0; i <= n; i++) {
          introCameraPose(tl, (i / n) * tl.total, terrain, ice, reduceMotion, pose);
          expect(isFinitePose(pose)).toBe(true);
          const p = pose.position;
          expect(p.y - groundAt(terrain, p.x, p.z)).toBeGreaterThanOrEqual(CAMERA_TUNING.minClearance - 1e-6);
          expect(p.y - glacierTopAt(glacier, p.x, p.z)).toBeGreaterThan(0.5);
          expect(pose.fov).toBeGreaterThan(30);
          expect(pose.fov).toBeLessThan(80);
        }
        const end = introCameraPose(tl, tl.total, terrain, ice, reduceMotion, createCameraPose());
        const follow = followPose(ice, terrain, createCameraPose());
        expect(dist3(end.position, follow.position)).toBeLessThan(1e-9);
        expect(dist3(end.lookAt, follow.lookAt)).toBeLessThan(1e-9);
        // Landing on it continuously: the last frame before the hand-off is close.
        const before = introCameraPose(tl, tl.total - 1 / 60, terrain, ice, reduceMotion, createCameraPose());
        expect(dist3(before.position, follow.position)).toBeLessThan(0.6);
      });

      it(`moves without jumps (cuts only under the reduced-motion veil) (${label})`, () => {
        const k = calvingKeys(tl.calving);
        const cutAt = tl.flyover + k.cutAt;
        const pose = createCameraPose();
        let prev: CameraPose | null = null;
        let maxJump = 0;
        let maxLookJump = 0;
        const dt = 1 / 60;
        for (let t = 0; t <= tl.total + 1e-9; t += dt) {
          introCameraPose(tl, t, terrain, ice, reduceMotion, pose);
          const acrossCut = reduceMotion && prev !== null && t - dt < cutAt && t >= cutAt;
          if (prev && !acrossCut && t > dt * 1.5) {
            maxJump = Math.max(maxJump, dist3(pose.position, prev.position));
            maxLookJump = Math.max(maxLookJump, dist3(pose.lookAt, prev.lookAt));
          }
          prev = copy(pose);
        }
        // The flyover sweeps the whole course (up to ~2 km) in 7.5 s; the calving is slow.
        expect(maxJump).toBeLessThan(kind === 'full' ? 16 : 1.5);
        expect(maxLookJump).toBeLessThan(kind === 'full' ? 32 : 1.5);
      });
    }
  }

  it('lands the flyover exactly on the calving start pose', () => {
    const fly = getIntroPath(terrain).evaluate(1, ice, createCameraPose());
    const start = shot.startPose('full', ice, createCameraPose());
    expect(dist3(fly.position, start.position)).toBeLessThan(0.05);
    expect(dist3(fly.lookAt, start.lookAt)).toBeLessThan(0.05);
  });

  it('frames the iceberg in its socket from the open side, in front of the snout', () => {
    for (const kind of ['full', 'short'] as const) {
      const p = shot.startPose(kind, ice, createCameraPose());
      const ex = ice.pos.x - glacier.fx * glacier.slide;
      const ez = ice.pos.z - glacier.fz * glacier.slide;
      const ahead = (p.position.x - ex) * glacier.fx + (p.position.z - ez) * glacier.fz;
      const side = (p.position.x - ex) * glacier.rx + (p.position.z - ez) * glacier.rz;
      expect(ahead).toBeGreaterThan(0);
      expect(Math.sign(side)).toBe(glacier.cameraSide);
      expect(Math.hypot(p.position.x - ex, p.position.z - ez)).toBeLessThan(45);
      // Looking toward the chunk.
      const lx = p.lookAt.x - p.position.x;
      const lz = p.lookAt.z - p.position.z;
      const tx = ex - p.position.x;
      const tz = ez - p.position.z;
      expect((lx * tx + lz * tz) / (Math.hypot(lx, lz) * Math.hypot(tx, tz))).toBeGreaterThan(0.9);
      expect(CALVING_SHOT[kind].fov).toBeGreaterThan(40);
    }
  });
});

describe('CameraController through the intro', () => {
  const terrain = getTerrain(LEVELS[0]);
  const ice = spawnIcebergFor(terrain);

  it('starts the short intro on the calving shot while loading', () => {
    const cam = new CameraController();
    cam.introTimeline = introTimeline('short');
    const pose = copy(cam.update(1 / 60, 'loading', 0, 0, ice, terrain));
    const start = getCalvingShot(terrain).startPose('short', ice, createCameraPose());
    expect(dist3(pose.position, start.position)).toBeLessThan(1e-6);
  });

  it('blends (no cut) when Space switches the flyover to the short calving', () => {
    const cam = new CameraController();
    const full = introTimeline('full');
    cam.introTimeline = full;
    const dt = 1 / 60;
    let last = createCameraPose();
    for (let i = 0; i < 120; i++) last = copy(cam.update(dt, 'intro', i * dt, (i * dt) / full.total, ice, terrain));
    cam.introTimeline = introTimeline('short');
    const first = copy(cam.update(dt, 'intro', 2, 0, ice, terrain));
    expect(dist3(first.position, last.position)).toBeLessThan(3);
    let prev = first;
    // A quick swoop (like the old skip blend) from wherever the flyover was: no frame-to-frame cut.
    const gap = dist3(first.position, getCalvingShot(terrain).startPose('short', ice).position);
    for (let i = 1; i < 72; i++) {
      const p = copy(cam.update(dt, 'intro', 2 + i * dt, (i * dt) / 1.2, ice, terrain));
      expect(dist3(p.position, prev.position)).toBeLessThan(2 + (gap * 2 * dt) / CAMERA_TUNING.introSwitchBlend);
      prev = p;
    }
    // ...and lands on the follow pose at the hand-off as usual.
    const handoff = copy(cam.update(dt, 'intro', 3.2, 1, ice, terrain));
    const playing = cam.update(dt, 'playing', 0, 1, ice, terrain);
    expect(dist3(playing.position, handoff.position)).toBeLessThan(0.5);
  });

  it('hands off seamlessly at the end of every intro kind', () => {
    for (const kind of ['full', 'short'] as IntroKind[]) {
      const cam = new CameraController();
      const tl = introTimeline(kind);
      cam.introTimeline = tl;
      const dt = 1 / 60;
      let last = createCameraPose();
      const n = Math.round(tl.total / dt);
      for (let i = 0; i <= n; i++) last = copy(cam.update(dt, 'intro', i * dt, Math.min(1, i / n), ice, terrain));
      const first = cam.update(dt, 'playing', 0, 1, ice, terrain);
      expect(dist3(first.position, last.position)).toBeLessThan(0.5);
    }
  });
});
