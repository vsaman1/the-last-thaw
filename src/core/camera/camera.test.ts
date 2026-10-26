import { describe, expect, it } from 'vitest';
import type { IcebergState, Terrain } from '../types';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import {
  CAMERA_TUNING,
  CameraController,
  type CameraPose,
  createCameraPose,
  followPose,
  groundAt,
  introPose,
  isFinitePose,
  outroShot,
  routeInfo,
} from './camera';

function makeIceberg(
  terrain: Terrain,
  x: number,
  z: number,
  vx: number,
  vz: number,
  heading?: number,
): IcebergState {
  return {
    pos: { x, y: terrain.heightAt(x, z), z },
    vel: { x: vx, y: 0, z: vz },
    heading: heading ?? Math.atan2(vx, vz),
    steer: 0,
    yawRate: 0,
    grounded: true,
    airTime: 0,
    airPeakY: terrain.heightAt(x, z),
    inOcean: false,
    stuckTimer: 0,
    pitch: 0,
    roll: 0,
    impact: 0,
    radius: 2.2,
    mass: 30,
    ice: 1,
    size: 1,
  };
}

const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Asserts the camera clears the ground at its position and at the sampled sight-line points. */
function expectClearance(terrain: Terrain, pose: CameraPose, ice: IcebergState): void {
  const c = CAMERA_TUNING.minClearance - 1e-6;
  const p = pose.position;
  expect(p.y - groundAt(terrain, p.x, p.z)).toBeGreaterThanOrEqual(c);
  const tx = ice.pos.x;
  const ty = ice.pos.y + CAMERA_TUNING.lineTargetUp;
  const tz = ice.pos.z;
  for (const f of CAMERA_TUNING.lineSamples) {
    const x = p.x + (tx - p.x) * f;
    const y = p.y + (ty - p.y) * f;
    const z = p.z + (tz - p.z) * f;
    expect(y - groundAt(terrain, x, z)).toBeGreaterThanOrEqual(c);
  }
}

describe('followPose', () => {
  const terrain = createAnalyticTerrain({ height: inclinedPlane(0.1), width: 200, length: 400, cellSize: 2 });

  it('sits behind the iceberg relative to its velocity (not its heading) and above it', () => {
    // Facing +Z but sliding toward +X: the camera must trail the velocity.
    const ice = makeIceberg(terrain, 0, 150, 20, 0, 0);
    const pose = followPose(ice, terrain, createCameraPose());
    const dx = pose.position.x - ice.pos.x;
    const dz = pose.position.z - ice.pos.z;
    expect(dx).toBeLessThan(-12);
    expect(Math.abs(dz)).toBeLessThan(1);
    expect(pose.position.y).toBeGreaterThan(ice.pos.y + 5);
    // Looks ahead of the iceberg along the velocity.
    expect(pose.lookAt.x).toBeGreaterThan(ice.pos.x + 5);
    expect(isFinitePose(pose)).toBe(true);
    expect(pose.fov).toBeGreaterThanOrEqual(55);
  });

  it('falls back to the heading when the iceberg is (nearly) stopped', () => {
    const ice = makeIceberg(terrain, 0, 150, 0, 0, Math.PI / 2);
    const pose = followPose(ice, terrain, createCameraPose());
    expect(pose.position.x - ice.pos.x).toBeLessThan(-12);
    expect(Math.abs(pose.position.z - ice.pos.z)).toBeLessThan(1);
  });

  it('widens the fov with speed', () => {
    const slow = followPose(makeIceberg(terrain, 0, 150, 0, 8), terrain, createCameraPose());
    const fast = followPose(makeIceberg(terrain, 0, 150, 0, 28), terrain, createCameraPose());
    expect(slow.fov).toBeCloseTo(55, 5);
    expect(fast.fov).toBeGreaterThan(62);
    expect(fast.fov).toBeLessThanOrEqual(64 + 1e-9);
  });

  it('rises and looks lower when the ground ahead drops away (cliff)', () => {
    const cliff = createAnalyticTerrain({
      height: (_x, z) => 100 - 0.1 * z - (z > 175 ? 25 : 0),
      width: 200,
      length: 400,
      cellSize: 2,
    });
    const flatIce = makeIceberg(terrain, 0, 150, 0, 20);
    const flat = followPose(flatIce, terrain, createCameraPose());
    const ice = makeIceberg(cliff, 0, 150, 0, 20);
    const pose = followPose(ice, cliff, createCameraPose());
    const rel = (p: CameraPose, i: IcebergState) => ({
      camY: p.position.y - i.pos.y,
      lookY: p.lookAt.y - i.pos.y,
      lookAhead: p.lookAt.z - i.pos.z,
    });
    const a = rel(flat, flatIce);
    const b = rel(pose, ice);
    expect(b.camY).toBeGreaterThan(a.camY + 2);
    expect(b.lookY).toBeLessThan(a.lookY - 2);
    expect(b.lookAhead).toBeGreaterThan(a.lookAhead + 3);
  });

  it('never goes below terrain + 2.5, including with a hill between camera and iceberg', () => {
    const hill = createAnalyticTerrain({
      // Flat valley with a 12 m ridge ~7 m behind an iceberg at z = 100.
      height: (_x, z) => 50 - 0.05 * z + 12 * Math.exp(-((z - 93) ** 2) / (2 * 3 ** 2)),
      width: 200,
      length: 300,
      cellSize: 1,
    });
    const ice = makeIceberg(hill, 0, 100, 0, 15);
    const pose = followPose(ice, hill, createCameraPose());
    expectClearance(hill, pose, ice);
    // The hill actually forced the camera up.
    expect(pose.position.y - ice.pos.y).toBeGreaterThan(CAMERA_TUNING.up + 1);
    expect(isFinitePose(pose)).toBe(true);
  });

  it('keeps clearance on bumpy terrain for many iceberg states', () => {
    const bumpy = createAnalyticTerrain({
      height: (x, z) => 120 - 0.25 * z + 6 * Math.sin(x * 0.15) * Math.cos(z * 0.11) + 4 * Math.sin(z * 0.37),
      width: 200,
      length: 400,
      cellSize: 2,
    });
    const pose = createCameraPose();
    for (let i = 0; i < 200; i++) {
      const a = i * 0.731;
      const sp = (i % 7) * 4;
      const z = 60 + ((i * 37) % 280);
      const ice = makeIceberg(bumpy, Math.sin(i) * 40, z, Math.sin(a) * sp, Math.cos(a) * sp, a);
      followPose(ice, bumpy, pose);
      expectClearance(bumpy, pose, ice);
      expect(isFinitePose(pose)).toBe(true);
    }
  });
});

describe('CameraController (following)', () => {
  it('moves at most ~1.5 m per 1/60 s frame through an instant 90° velocity change at 20 m/s', () => {
    const terrain = createAnalyticTerrain({ height: () => 0, width: 600, length: 600, cellSize: 4 });
    const ice = makeIceberg(terrain, 0, 40, 0, 20);
    const cam = new CameraController();
    const dt = 1 / 60;
    let prev: { x: number; y: number; z: number } | null = null;
    let maxStep = 0;
    for (let frame = 0; frame < 480; frame++) {
      if (frame === 180) {
        ice.vel.x = 20;
        ice.vel.z = 0;
        ice.heading = Math.PI / 2;
      }
      ice.pos.x += ice.vel.x * dt;
      ice.pos.z += ice.vel.z * dt;
      const pose = cam.update(dt, 'playing', frame * dt, 1, ice, terrain);
      expect(isFinitePose(pose)).toBe(true);
      if (prev) maxStep = Math.max(maxStep, dist3(pose.position, prev));
      prev = { ...pose.position };
    }
    expect(maxStep).toBeLessThanOrEqual(1.5);
    // Settled behind the new direction of travel.
    const p = cam.pose.position;
    expect(p.x - ice.pos.x).toBeLessThan(-10);
    expect(Math.abs(p.z - ice.pos.z)).toBeLessThan(2);
  });

  it('is frame-rate independent (30 fps and 144 fps settle to the same pose)', () => {
    const terrain = createAnalyticTerrain({
      height: inclinedPlane(0.15),
      width: 200,
      length: 500,
      cellSize: 2,
    });
    const run = (fps: number): CameraPose => {
      const ice = makeIceberg(terrain, 0, 20, 4, 18);
      const cam = new CameraController();
      const dt = 1 / fps;
      for (let i = 0; i < fps * 6; i++) {
        ice.pos.x += ice.vel.x * dt;
        ice.pos.z += ice.vel.z * dt;
        ice.pos.y = terrain.heightAt(ice.pos.x, ice.pos.z);
        cam.update(dt, 'playing', i * dt, 1, ice, terrain);
      }
      return cam.pose;
    };
    const a = run(30);
    const b = run(144);
    expect(dist3(a.position, b.position)).toBeLessThan(0.5);
    expect(dist3(a.lookAt, b.lookAt)).toBeLessThan(0.5);
  });

  it('blends from the intro pose to follow over ~0.6 s when the intro is skipped', () => {
    const terrain = createAnalyticTerrain({
      height: inclinedPlane(0.2),
      width: 200,
      length: 600,
      cellSize: 2,
    });
    const ice = makeIceberg(terrain, 0, 10, 0, 0, 0);
    const cam = new CameraController();
    const dt = 1 / 60;
    let last = createCameraPose();
    for (let i = 0; i < 60; i++) last = { ...cam.update(dt, 'intro', i * dt, 0.3 + i * 0.001, ice, terrain) };
    const introPos = { ...last.position };
    const first = cam.update(dt, 'playing', 0, 0.36, ice, terrain);
    // No teleport on the first playing frame.
    expect(dist3(first.position, introPos)).toBeLessThan(25);
    for (let i = 0; i < 45; i++) cam.update(dt, 'playing', i * dt, 1, ice, terrain);
    const target = followPose(ice, terrain, createCameraPose());
    expect(dist3(cam.pose.position, target.position)).toBeLessThan(0.5);
  });

  it('hands off seamlessly when the intro completes', () => {
    const terrain = createAnalyticTerrain({
      height: inclinedPlane(0.2),
      width: 200,
      length: 600,
      cellSize: 2,
    });
    const ice = makeIceberg(terrain, 0, 10, 0, 0, 0);
    const cam = new CameraController();
    const dt = 1 / 60;
    let lastIntro = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= 540; i++) {
      lastIntro = { ...cam.update(dt, 'intro', i * dt, Math.min(1, (i * dt) / 9), ice, terrain).position };
    }
    const first = cam.update(dt, 'playing', 0, 1, ice, terrain);
    expect(dist3(first.position, lastIntro)).toBeLessThan(0.5);
  });

  it('holds still while paused', () => {
    const terrain = createAnalyticTerrain({
      height: inclinedPlane(0.1),
      width: 200,
      length: 400,
      cellSize: 2,
    });
    const ice = makeIceberg(terrain, 0, 50, 0, 15);
    const cam = new CameraController();
    for (let i = 0; i < 30; i++) cam.update(1 / 60, 'playing', 0, 1, ice, terrain);
    const before = { ...cam.pose.position };
    ice.pos.z += 30;
    cam.update(1 / 60, 'paused', 0, 1, ice, terrain);
    expect(dist3(cam.pose.position, before)).toBe(0);
  });
});

describe('intro cinematic', () => {
  const height = (_x: number, z: number): number => 220 - 0.15 * z - (z > 450 ? 20 : 0);
  const big = createAnalyticTerrain({
    height,
    width: 400,
    length: 1100,
    cellSize: 4,
    seaLevel: 220 - 0.15 * 950 - 20,
    level: { startS: 20, coastS: 950, finishS: 1050, cliffs: [{ s: 450, drop: 20 }] },
  });
  const small = createAnalyticTerrain({ height: inclinedPlane(0.2), width: 160, length: 400, cellSize: 2 });

  for (const [name, terrain] of [
    ['long course with a cliff', big],
    ['default analytic terrain', small],
  ] as const) {
    describe(name, () => {
      const lv = terrain.level;
      const start = terrain.course.toWorld(lv.startS, 0);
      const ice = makeIceberg(terrain, start.x, start.z, 0, 0, 0);

      it('starts high above the start floor, over/beyond the coast', () => {
        const p0 = introPose(0, terrain, ice);
        const startFloor = terrain.course.sampleAt(lv.startS).floor;
        expect(p0.position.y).toBeGreaterThan(startFloor + 80);
        const coast = terrain.course.toWorld(lv.coastS, 0);
        const L = lv.coastS - lv.startS;
        expect(Math.hypot(p0.position.x - coast.x, p0.position.z - coast.z)).toBeLessThan(0.45 * L + 50);
        // Seaward of the coast, looking back up the valley.
        expect(terrain.course.project(p0.position.x, p0.position.z).s).toBeGreaterThanOrEqual(lv.coastS);
        expect(p0.lookAt.z).toBeLessThan(p0.position.z);
      });

      it('is continuous and finite (no jump > 15 m between samples 1/600 apart)', () => {
        const pose = createCameraPose();
        let prev: { x: number; y: number; z: number } | null = null;
        let prevLook: { x: number; y: number; z: number } | null = null;
        let maxJump = 0;
        let maxLookJump = 0;
        for (let k = 0; k <= 600; k++) {
          introPose(k / 600, terrain, ice, pose);
          expect(isFinitePose(pose)).toBe(true);
          const clear = pose.position.y - groundAt(terrain, pose.position.x, pose.position.z);
          expect(clear).toBeGreaterThanOrEqual(CAMERA_TUNING.minClearance - 1e-6);
          if (prev && prevLook) {
            maxJump = Math.max(maxJump, dist3(pose.position, prev));
            maxLookJump = Math.max(maxLookJump, dist3(pose.lookAt, prevLook));
          }
          prev = { ...pose.position };
          prevLook = { ...pose.lookAt };
        }
        expect(maxJump).toBeLessThan(15);
        expect(maxLookJump).toBeLessThan(25);
      });

      it('ends exactly on the follow pose for the spawned iceberg', () => {
        const end = introPose(1, terrain, ice);
        const follow = followPose(ice, terrain, createCameraPose());
        expect(dist3(end.position, follow.position)).toBeLessThan(0.5);
        expect(dist3(end.lookAt, follow.lookAt)).toBeLessThan(0.5);
        expect(Math.abs(end.fov - follow.fov)).toBeLessThan(0.5);
      });
    });
  }
});

describe('outro and failure shots', () => {
  const terrain = createAnalyticTerrain({
    height: (_x, z) => 160 - 0.2 * z,
    width: 400,
    length: 1000,
    cellSize: 4,
    seaLevel: 160 - 0.2 * 800,
    level: { startS: 20, coastS: 800, finishS: 880 },
  });

  it('pulls back to a high wide shot from out at sea looking up the river, smoothly', () => {
    const ice = makeIceberg(terrain, 0, 830, 0, 8);
    ice.pos.y = terrain.level.seaLevel;
    ice.inOcean = true;
    const cam = new CameraController();
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      ice.pos.z += ice.vel.z * dt;
      cam.update(dt, 'playing', i * dt, 1, ice, terrain);
    }
    let prev = { ...cam.pose.position };
    let prevStep = dist3(prev, prev);
    let maxStep = 0;
    let maxStepChange = 0;
    for (let i = 0; i < 60 * 12; i++) {
      ice.pos.z += ice.vel.z * dt;
      const pose = cam.update(dt, 'complete', i * dt, 1, ice, terrain);
      expect(isFinitePose(pose)).toBe(true);
      const step = dist3(pose.position, prev);
      maxStep = Math.max(maxStep, step);
      if (i > 0) maxStepChange = Math.max(maxStepChange, Math.abs(step - prevStep));
      prevStep = step;
      prev = { ...pose.position };
    }
    // A ~600 m crane move in 4 s is fast, but it must ramp smoothly (no single-frame jumps).
    expect(maxStep).toBeLessThan(10);
    expect(maxStepChange).toBeLessThan(0.5);
    const p = cam.pose;
    const info = routeInfo(terrain);
    expect(p.position.y).toBeGreaterThan(info.maxFloor + 50);
    expect(terrain.course.project(p.position.x, p.position.z).s).toBeGreaterThan(terrain.level.coastS);
    expect(p.lookAt.z).toBeLessThan(terrain.level.coastS);
    // Close to the held shot (only the slow drift separates them).
    expect(dist3(p.lookAt, outroShot(terrain).lookAt)).toBeLessThan(1);
  });

  it('orbits the iceberg slowly from a slightly higher vantage after failing', () => {
    const ice = makeIceberg(terrain, 0, 300, 0, 0.5);
    const cam = new CameraController();
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) cam.update(dt, 'playing', i * dt, 1, ice, terrain);
    const startAz = Math.atan2(cam.pose.position.x - ice.pos.x, cam.pose.position.z - ice.pos.z);
    let prev = { ...cam.pose.position };
    let maxStep = 0;
    for (let i = 0; i < 60 * 6; i++) {
      const pose = cam.update(dt, 'failed', i * dt, 1, ice, terrain);
      maxStep = Math.max(maxStep, dist3(pose.position, prev));
      prev = { ...pose.position };
      const r = Math.hypot(pose.position.x - ice.pos.x, pose.position.z - ice.pos.z);
      expect(r).toBeGreaterThan(8);
      expect(r).toBeLessThan(30);
    }
    expect(maxStep).toBeLessThan(0.5);
    const endAz = Math.atan2(cam.pose.position.x - ice.pos.x, cam.pose.position.z - ice.pos.z);
    expect(Math.abs(endAz - startAz)).toBeGreaterThan(0.5);
    expect(cam.pose.position.y - ice.pos.y).toBeGreaterThan(CAMERA_TUNING.up);
  });

  describe('with prefers-reduced-motion', () => {
    const azimuth = (cam: CameraController, ice: IcebergState): number =>
      Math.atan2(cam.pose.position.x - ice.pos.x, cam.pose.position.z - ice.pos.z);

    it('the failed shot eases in, then holds instead of orbiting forever', () => {
      const ice = makeIceberg(terrain, 0, 300, 0, 0.5);
      const cam = new CameraController();
      cam.reduceMotion = true;
      const dt = 1 / 60;
      for (let i = 0; i < 60; i++) cam.update(dt, 'playing', i * dt, 1, ice, terrain);
      const startAz = azimuth(cam, ice);
      let t = 0;
      for (let i = 0; i < 60 * 4; i++) cam.update(dt, 'failed', (t = i * dt), 1, ice, terrain);
      // The framing still changes (closer, higher), but the camera never swings around the iceberg.
      expect(Math.abs(azimuth(cam, ice) - startAz)).toBeLessThan(1e-9);
      const held = { ...cam.pose.position };
      for (let i = 0; i < 60 * 20; i++) cam.update(dt, 'failed', (t += dt), 1, ice, terrain);
      expect(dist3(cam.pose.position, held)).toBeLessThan(0.05);
    });

    it('turning motion back on resumes the failed orbit without a jump, and off again freezes it', () => {
      const ice = makeIceberg(terrain, 0, 300, 0, 0.5);
      const cam = new CameraController();
      const dt = 1 / 60;
      for (let i = 0; i < 60; i++) cam.update(dt, 'playing', i * dt, 1, ice, terrain);
      let t = 0;
      let prev = { ...cam.pose.position };
      let maxStep = 0;
      for (let i = 0; i < 60 * 12; i++) {
        cam.reduceMotion = i < 60 * 4 || i >= 60 * 8; // still, orbiting, still
        cam.update(dt, 'failed', (t = i * dt), 1, ice, terrain);
        maxStep = Math.max(maxStep, dist3(cam.pose.position, prev));
        prev = { ...cam.pose.position };
      }
      expect(maxStep).toBeLessThan(0.5);
      const frozen = azimuth(cam, ice);
      cam.update(dt, 'failed', t + 5, 1, ice, terrain);
      expect(azimuth(cam, ice)).toBeCloseTo(frozen, 9);
    });

    it('the outro reaches its wide shot, then holds without the slow drift', () => {
      const ice = makeIceberg(terrain, 0, 830, 0, 8);
      ice.pos.y = terrain.level.seaLevel;
      ice.inOcean = true;
      const cam = new CameraController();
      cam.reduceMotion = true;
      const dt = 1 / 60;
      for (let i = 0; i < 60; i++) cam.update(dt, 'playing', i * dt, 1, ice, terrain);
      ice.vel.z = 0;
      let t = 0;
      for (let i = 0; i < 60 * 6; i++) cam.update(dt, 'complete', (t = i * dt), 1, ice, terrain);
      const shot = outroShot(terrain);
      expect(dist3(cam.pose.position, shot.position)).toBeLessThan(0.01);
      const held = { ...cam.pose.position };
      cam.update(dt, 'complete', t + 60, 1, ice, terrain);
      expect(dist3(cam.pose.position, held)).toBeLessThan(1e-9);
    });
  });
});
