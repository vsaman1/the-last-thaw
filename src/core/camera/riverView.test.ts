import { describe, expect, it } from 'vitest';
import type { IcebergState, Terrain, Vec3 } from '../types';
import { createRng } from '../rng';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import {
  CAMERA_TUNING,
  CameraController,
  type CameraPose,
  createCameraPose,
  followPose,
  groundAt,
  isFinitePose,
} from './camera';
import {
  type FitPoint,
  RIVER_VIEW,
  RiverOrbit,
  effectiveFov,
  fitOrbitDistance,
  riverBounds,
} from './riverView';
import { createRay, raycastGround, screenRay } from './pick';

const DEG = Math.PI / 180;

function makeIceberg(terrain: Terrain, x: number, z: number, vx: number, vz: number): IcebergState {
  return {
    pos: { x, y: terrain.heightAt(x, z), z },
    vel: { x: vx, y: 0, z: vz },
    heading: Math.atan2(vx, vz),
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

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Independent projection check: camera basis from the pose (lookAt convention, world up +Y),
 * returns the largest |ndc| coordinate over all points (<= 1 means everything is in frame).
 */
function maxNdc(points: readonly FitPoint[], pose: CameraPose, aspect: number): number {
  const p = pose.position;
  let fx = pose.lookAt.x - p.x;
  let fy = pose.lookAt.y - p.y;
  let fz = pose.lookAt.z - p.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0); up' = right × forward
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tanV = Math.tan((effectiveFov(pose.fov, aspect) * DEG) / 2);
  const tanH = tanV * aspect;
  let worst = 0;
  for (const q of points) {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const depth = dx * fx + dy * fy + dz * fz;
    if (depth <= 0) return Infinity;
    const sx = Math.abs(dx * rx + dz * rz) / (depth * tanH);
    const sy = Math.abs(dx * ux + dy * uy + dz * uz) / (depth * tanV);
    worst = Math.max(worst, sx, sy);
  }
  return worst;
}

/** Lowest projected (ndc) y over all points for a pose (same camera basis as maxNdc). */
function minNdcY(points: readonly FitPoint[], pose: CameraPose, aspect: number): number {
  const p = pose.position;
  const f = { x: pose.lookAt.x - p.x, y: pose.lookAt.y - p.y, z: pose.lookAt.z - p.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  f.x /= fl;
  f.y /= fl;
  f.z /= fl;
  const rl = Math.hypot(f.z, f.x);
  const r = { x: -f.z / rl, z: f.x / rl };
  const u = { x: -r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y };
  const tanV = Math.tan((effectiveFov(pose.fov, aspect) * DEG) / 2);
  let low = Infinity;
  for (const q of points) {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const depth = dx * f.x + dy * f.y + dz * f.z;
    low = Math.min(low, (dx * u.x + dy * u.y + dz * u.z) / (depth * tanV));
  }
  return low;
}

/** A winding synthetic river draped on the terrain, sampled every 1.2 m like the real trail. */
function windingRiver(terrain: Terrain, z0: number, z1: number, amp = 40): FitPoint[] {
  const out: FitPoint[] = [];
  for (let z = z0; z <= z1; z += 1.2) {
    const x = amp * Math.sin(z / 90);
    out.push({ x, y: terrain.heightAt(x, z) + 0.15, z, width: 6 });
  }
  return out;
}

describe('riverBounds', () => {
  it('returns the centre of the bounding box of the samples', () => {
    const pts: FitPoint[] = [
      { x: -10, y: 5, z: 0, width: 4 },
      { x: 30, y: -5, z: 100, width: 4 },
      { x: 0, y: 20, z: 40, width: 4 },
    ];
    const b = riverBounds(pts);
    expect(b.count).toBe(3);
    expect(b.cx).toBeCloseTo(10, 9);
    expect(b.cy).toBeCloseTo(7.5, 9);
    expect(b.cz).toBeCloseTo(50, 9);
    expect(b.minX).toBe(-10);
    expect(b.maxZ).toBe(100);
  });

  it('reports an empty river', () => {
    expect(riverBounds([]).count).toBe(0);
  });
});

describe('effectiveFov', () => {
  it('keeps the fov on landscape screens and widens it (capped) on portrait ones', () => {
    expect(effectiveFov(55, 16 / 9)).toBeCloseTo(55, 9);
    const portrait = effectiveFov(55, 390 / 844);
    expect(portrait).toBeGreaterThan(70);
    expect(portrait).toBeLessThanOrEqual(85);
  });
});

describe('fitOrbitDistance', () => {
  const terrain = createAnalyticTerrain({ height: inclinedPlane(0.15, 200), width: 400, length: 900 });
  const river = windingRiver(terrain, 20, 820);
  const b = riverBounds(river);

  for (const [name, az, el, aspect] of [
    ['from downstream, landscape', Math.PI, 0.6, 16 / 9],
    ['broadside, landscape', Math.PI / 2, 0.5, 16 / 9],
    ['high, portrait phone', 0.7, 1.1, 390 / 844],
    ['low, square', -2.3, 0.25, 1],
  ] as const) {
    it(`frames every sample tightly (${name})`, () => {
      const fov = RIVER_VIEW.fov;
      const d = fitOrbitDistance(river, b.cx, b.cy, b.cz, az, el, effectiveFov(fov, aspect), aspect, 1);
      const pose = createCameraPose();
      const place = (dist: number): CameraPose => {
        pose.position.x = b.cx + Math.sin(az) * Math.cos(el) * dist;
        pose.position.y = b.cy + Math.sin(el) * dist;
        pose.position.z = b.cz + Math.cos(az) * Math.cos(el) * dist;
        pose.lookAt.x = b.cx;
        pose.lookAt.y = b.cy;
        pose.lookAt.z = b.cz;
        pose.fov = fov;
        return pose;
      };
      expect(Number.isFinite(d)).toBe(true);
      expect(maxNdc(river, place(d), aspect)).toBeLessThanOrEqual(1 + 1e-9);
      // Tight: 10 % closer and something leaves the frame.
      expect(maxNdc(river, place(d * 0.9), aspect)).toBeGreaterThan(1);
    });
  }

  it('keeps the bottom inset clear (room for the UI bar)', () => {
    const aspect = 16 / 9;
    const fov = effectiveFov(RIVER_VIEW.fov, aspect);
    const d = fitOrbitDistance(river, b.cx, b.cy, b.cz, Math.PI, 0.6, fov, aspect, 1, 0.1);
    const pose = createCameraPose();
    pose.position.x = b.cx + Math.sin(Math.PI) * Math.cos(0.6) * d;
    pose.position.y = b.cy + Math.sin(0.6) * d;
    pose.position.z = b.cz + Math.cos(Math.PI) * Math.cos(0.6) * d;
    pose.lookAt = { x: b.cx, y: b.cy, z: b.cz };
    pose.fov = RIVER_VIEW.fov;
    // Lowest projected point stays above ndc -0.8.
    expect(minNdcY(river, pose, aspect)).toBeGreaterThanOrEqual(-0.8 - 1e-9);
    expect(maxNdc(river, pose, aspect)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('leaves room for the margin', () => {
    const d1 = fitOrbitDistance(river, b.cx, b.cy, b.cz, 1, 0.6, 50, 1.6, 1);
    const d2 = fitOrbitDistance(river, b.cx, b.cy, b.cz, 1, 0.6, 50, 1.6, 1.2);
    expect(d2).toBeGreaterThan(d1 * 1.1);
  });
});

describe('RiverOrbit', () => {
  const terrain = createAnalyticTerrain({ height: inclinedPlane(0.15, 200), width: 400, length: 900 });
  const river = windingRiver(terrain, 20, 820);

  function begun(aspect = 16 / 9): RiverOrbit {
    const orbit = new RiverOrbit();
    const from = createCameraPose();
    from.position = { x: 0, y: 260, z: 1000 };
    from.lookAt = { x: 0, y: 100, z: 500 };
    orbit.begin(river, from, aspect);
    return orbit;
  }

  it('clamps zoom between a close-up and a little beyond the fit', () => {
    const orbit = begun();
    const pose = createCameraPose();
    orbit.zoomBy(1e6);
    for (let i = 0; i < 240; i++) orbit.update(1 / 60, false, terrain, pose);
    const far = dist3(pose.position, pose.lookAt);
    const fit = orbit.fitDistance(orbit.azimuth, orbit.elevation);
    expect(far).toBeLessThanOrEqual(fit * RIVER_VIEW.zoomMax + 1);
    orbit.zoomBy(1e-6);
    for (let i = 0; i < 240; i++) orbit.update(1 / 60, false, terrain, pose);
    const near = dist3(pose.position, pose.lookAt);
    expect(near).toBeGreaterThanOrEqual(RIVER_VIEW.minDistance - 1e-6);
    expect(near).toBeLessThan(far / 4);
  });

  it('dragging orbits (horizontal = azimuth, vertical = elevation, clamped)', () => {
    const orbit = begun();
    const pose = createCameraPose();
    orbit.update(1 / 60, false, terrain, pose);
    const az0 = orbit.azimuth;
    orbit.drag(200, 0, 800);
    for (let i = 0; i < 60; i++) orbit.update(1 / 60, false, terrain, pose);
    expect(Math.abs(orbit.azimuth - az0)).toBeGreaterThan(0.3);
    orbit.drag(0, 1e5, 800);
    for (let i = 0; i < 120; i++) orbit.update(1 / 60, false, terrain, pose);
    expect(orbit.elevation).toBeCloseTo(RIVER_VIEW.maxElevation, 3);
    orbit.drag(0, -1e5, 800);
    for (let i = 0; i < 120; i++) orbit.update(1 / 60, false, terrain, pose);
    expect(orbit.elevation).toBeCloseTo(RIVER_VIEW.minElevation, 3);
  });

  it('auto-rotates slowly only after the pointer has been idle', () => {
    const orbit = begun();
    const pose = createCameraPose();
    const dt = 1 / 60;
    orbit.update(dt, true, terrain, pose);
    const az0 = orbit.azimuth;
    const steps = Math.floor((RIVER_VIEW.idleDelay * 0.5) / dt);
    for (let i = 0; i < steps; i++) orbit.update(dt, true, terrain, pose);
    expect(orbit.azimuth).toBeCloseTo(az0, 6);
    for (let i = 0; i < 60 * 8; i++) orbit.update(dt, true, terrain, pose);
    const turned = Math.abs(orbit.azimuth - az0);
    expect(turned).toBeGreaterThan(0.05);
    expect(turned).toBeLessThan(RIVER_VIEW.autoRotateRate * 9);
    // Disabled (reduced motion): never turns on its own.
    const still = begun();
    still.update(dt, false, terrain, pose);
    const s0 = still.azimuth;
    for (let i = 0; i < 60 * 10; i++) still.update(dt, false, terrain, pose);
    expect(still.azimuth).toBeCloseTo(s0, 9);
  });

  it('never goes below the terrain, even at the lowest elevation over a ridge', () => {
    const ridge = createAnalyticTerrain({
      height: (x, z) => 200 - 0.15 * z + 70 * Math.exp(-((x - 120) ** 2) / (2 * 30 ** 2)),
      width: 600,
      length: 900,
      cellSize: 4,
    });
    const r = windingRiver(ridge, 20, 820, 20);
    const orbit = new RiverOrbit();
    orbit.begin(r, createCameraPose(), 16 / 9);
    const pose = createCameraPose();
    orbit.drag(0, -1e5, 800);
    orbit.zoomBy(0.25);
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 30 === 0) orbit.drag(37, 0, 800);
      orbit.update(1 / 60, false, ridge, pose);
      expect(isFinitePose(pose)).toBe(true);
      const p = pose.position;
      expect(p.y - groundAt(ridge, p.x, p.z)).toBeGreaterThanOrEqual(CAMERA_TUNING.minClearance - 1e-6);
    }
  });
});

describe('CameraController view-the-river mode', () => {
  const terrain = createAnalyticTerrain({
    height: (_x, z) => 160 - 0.2 * z,
    width: 400,
    length: 1000,
    cellSize: 4,
    seaLevel: 160 - 0.2 * 800,
    level: { startS: 20, coastS: 800, finishS: 880 },
  });
  const river = windingRiver(terrain, 20, 830, 35);
  const aspect = 16 / 9;
  const dt = 1 / 60;
  const viewing = { viewingRiver: true, river, aspect };
  const notViewing = { viewingRiver: false, river, aspect };

  /** Plays a few seconds, then completes; returns the controller and the iceberg at sea. */
  function completed(): { cam: CameraController; ice: IcebergState } {
    const ice = makeIceberg(terrain, 0, 830, 0, 6);
    ice.pos.y = terrain.level.seaLevel;
    ice.inOcean = true;
    const cam = new CameraController();
    for (let i = 0; i < 60; i++) cam.update(dt, 'playing', i * dt, 1, ice, terrain);
    return { cam, ice };
  }

  it('blends smoothly into an orbit that frames the whole river around its bounding-box centre', () => {
    const { cam, ice } = completed();
    let t = 0;
    for (; t < 5; t += dt) cam.update(dt, 'complete', t, 1, ice, terrain, notViewing);
    let prev = { ...cam.pose.position };
    let maxStep = 0;
    for (let i = 0; i < Math.ceil((RIVER_VIEW.blend + 0.4) / dt); i++, t += dt) {
      const pose = cam.update(dt, 'complete', t, 1, ice, terrain, { viewingRiver: true, river, aspect });
      expect(isFinitePose(pose)).toBe(true);
      maxStep = Math.max(maxStep, dist3(pose.position, prev));
      prev = { ...pose.position };
    }
    // No teleport: a few hundred metres in ~0.6 s, spread over many frames.
    expect(maxStep).toBeLessThan(40);
    const b = riverBounds(river);
    expect(cam.pose.lookAt.x).toBeCloseTo(b.cx, 1);
    expect(cam.pose.lookAt.y).toBeCloseTo(b.cy, 1);
    expect(cam.pose.lookAt.z).toBeCloseTo(b.cz, 1);
    expect(maxNdc(river, cam.pose, aspect)).toBeLessThanOrEqual(1);
    const p = cam.pose.position;
    expect(p.y - groundAt(terrain, p.x, p.z)).toBeGreaterThanOrEqual(CAMERA_TUNING.minClearance - 1e-6);
  });

  it('keeps the whole river framed while auto-rotating', () => {
    const { cam, ice } = completed();
    let t = 0;
    for (; t < 40; t += dt) {
      cam.update(dt, 'complete', t, 1, ice, terrain, { viewingRiver: t > 4.5, river, aspect });
      if (t > 4.5 + RIVER_VIEW.blend + 0.1) expect(maxNdc(river, cam.pose, aspect)).toBeLessThanOrEqual(1);
    }
  });

  it('routes pointer input to the orbit only while viewing', () => {
    const { cam, ice } = completed();
    let t = 0;
    for (; t < 6; t += dt) cam.update(dt, 'complete', t, 1, ice, terrain, viewing);
    const before = { ...cam.pose.position };
    cam.orbit.drag(300, 0, 800);
    for (let i = 0; i < 30; i++, t += dt) {
      cam.update(dt, 'complete', t, 1, ice, terrain, { viewingRiver: true, river, aspect });
    }
    expect(dist3(cam.pose.position, before)).toBeGreaterThan(50);
  });

  it('blends back to the outro shot when leaving, without a jump', () => {
    const { cam, ice } = completed();
    const ref = completed().cam;
    let t = 0;
    for (; t < 8; t += dt) {
      cam.update(dt, 'complete', t, 1, ice, terrain, { viewingRiver: t > 4, river, aspect });
      ref.update(dt, 'complete', t, 1, ice, terrain);
    }
    let prev = { ...cam.pose.position };
    let maxStep = 0;
    for (let i = 0; i < Math.ceil((RIVER_VIEW.blend + 0.3) / dt); i++, t += dt) {
      const pose = cam.update(dt, 'complete', t, 1, ice, terrain, { viewingRiver: false, river, aspect });
      ref.update(dt, 'complete', t, 1, ice, terrain);
      maxStep = Math.max(maxStep, dist3(pose.position, prev));
      prev = { ...pose.position };
    }
    expect(maxStep).toBeLessThan(40);
    expect(dist3(cam.pose.position, ref.pose.position)).toBeLessThan(0.01);
    expect(dist3(cam.pose.lookAt, ref.pose.lookAt)).toBeLessThan(0.01);
  });

  it('ignores the flag outside the complete phase', () => {
    const ice = makeIceberg(terrain, 0, 300, 0, 15);
    const a = new CameraController();
    const b = new CameraController();
    for (let i = 0; i < 120; i++) {
      ice.pos.z += ice.vel.z * dt;
      ice.pos.y = terrain.heightAt(ice.pos.x, ice.pos.z);
      a.update(dt, 'playing', i * dt, 1, ice, terrain, { viewingRiver: true, river, aspect });
      b.update(dt, 'playing', i * dt, 1, ice, terrain);
      expect(dist3(a.pose.position, b.pose.position)).toBe(0);
    }
    for (let i = 0; i < 120; i++) {
      a.update(dt, 'failed', i * dt, 1, ice, terrain, { viewingRiver: true, river, aspect });
      b.update(dt, 'failed', i * dt, 1, ice, terrain);
      expect(dist3(a.pose.position, b.pose.position)).toBe(0);
    }
  });

  it('falls back to the iceberg when there is no river yet', () => {
    const { cam, ice } = completed();
    let t = 0;
    const empty = { viewingRiver: true, river: [], aspect };
    for (; t < 6; t += dt) cam.update(dt, 'complete', t, 1, ice, terrain, empty);
    expect(isFinitePose(cam.pose)).toBe(true);
    expect(Math.hypot(cam.pose.lookAt.x - ice.pos.x, cam.pose.lookAt.z - ice.pos.z)).toBeLessThan(1);
  });
});

describe('follow distance scales with the iceberg size', () => {
  const terrain = createAnalyticTerrain({
    height: inclinedPlane(0.1),
    width: 200,
    length: 400,
    cellSize: 2,
  });
  const back = (radius: number): { back: number; up: number } => {
    const ice = makeIceberg(terrain, 0, 150, 0, 12);
    ice.radius = radius;
    const pose = followPose(ice, terrain, createCameraPose());
    return { back: ice.pos.z - pose.position.z, up: pose.position.y - ice.pos.y };
  };

  it('frames a melted (smaller) iceberg tighter and a bigger one further back', () => {
    const base = back(2.2);
    const small = back(1.1);
    const big = back(4.4);
    expect(base.back).toBeCloseTo(CAMERA_TUNING.back, 0);
    expect(small.back).toBeLessThan(base.back - 2);
    expect(small.up).toBeLessThan(base.up - 1);
    expect(big.back).toBeGreaterThan(base.back + 3);
    // Gently: halving the radius does not halve the distance.
    expect(small.back).toBeGreaterThan(base.back * 0.6);
  });

  it('the controller follows a size change smoothly', () => {
    const ice = makeIceberg(terrain, 0, 100, 0, 12);
    const cam = new CameraController();
    for (let i = 0; i < 120; i++) cam.update(1 / 60, 'playing', i / 60, 1, ice, terrain);
    const before = ice.pos.z - cam.pose.position.z;
    ice.radius = 1.1;
    let prev = { ...cam.pose.position };
    let maxStep = 0;
    for (let i = 0; i < 180; i++) {
      cam.update(1 / 60, 'playing', i / 60, 1, ice, terrain);
      maxStep = Math.max(maxStep, dist3(cam.pose.position, prev));
      prev = { ...cam.pose.position };
    }
    expect(maxStep).toBeLessThan(0.5);
    expect(ice.pos.z - cam.pose.position.z).toBeLessThan(before - 2);
  });
});

describe('RiverOrbit: inspecting specific spots', () => {
  const terrain = createAnalyticTerrain({ height: inclinedPlane(0.15, 200), width: 500, length: 900 });
  const river = windingRiver(terrain, 20, 820);
  const aspect = 16 / 9;
  const dt = 1 / 60;

  function run(orbit: RiverOrbit, pose: CameraPose, seconds: number, t: Terrain = terrain): void {
    for (let i = 0; i < Math.round(seconds / dt); i++) orbit.update(dt, false, t, pose);
  }

  function settled(): { orbit: RiverOrbit; pose: CameraPose } {
    const orbit = new RiverOrbit();
    const from = createCameraPose();
    from.position = { x: 0, y: 260, z: 1000 };
    from.lookAt = { x: 0, y: 100, z: 500 };
    orbit.begin(river, from, aspect);
    const pose = createCameraPose();
    run(orbit, pose, 3);
    return { orbit, pose };
  }

  /** ndc of a world point (same camera basis as maxNdc). */
  function ndc(q: Vec3, pose: CameraPose): { x: number; y: number } {
    const p = pose.position;
    const f = { x: pose.lookAt.x - p.x, y: pose.lookAt.y - p.y, z: pose.lookAt.z - p.z };
    const fl = Math.hypot(f.x, f.y, f.z);
    f.x /= fl;
    f.y /= fl;
    f.z /= fl;
    const rl = Math.hypot(f.z, f.x);
    const r = { x: -f.z / rl, z: f.x / rl };
    const u = { x: -r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y };
    const tanV = Math.tan((effectiveFov(pose.fov, aspect) * DEG) / 2);
    const d = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
    const depth = d.x * f.x + d.y * f.y + d.z * f.z;
    return {
      x: (d.x * r.x + d.z * r.z) / (depth * tanV * aspect),
      y: (d.x * u.x + d.y * u.y + d.z * u.z) / (depth * tanV),
    };
  }

  const spot = (i: number): Vec3 => ({
    x: river[i].x,
    y: terrain.heightAt(river[i].x, river[i].z),
    z: river[i].z,
  });

  it('zooming at a point keeps that point under the cursor', () => {
    const { orbit, pose } = settled();
    expect(orbit.framed).toBe(true);
    const p = spot(150);
    const before = ndc(p, pose);
    expect(Math.abs(before.x)).toBeLessThan(1);
    expect(Math.abs(before.y)).toBeLessThan(1);
    const d0 = orbit.distance;
    orbit.zoomAt(0.5, p);
    expect(orbit.framed).toBe(false);
    run(orbit, pose, 2);
    const after = ndc(p, pose);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(orbit.distance / d0).toBeCloseTo(0.5, 2);
  });

  it('gets within a few tens of metres of a spot, above the ground', () => {
    const { orbit, pose } = settled();
    const p = spot(420);
    for (let i = 0; i < 30; i++) {
      orbit.zoomAt(0.7, p);
      run(orbit, pose, 0.1);
    }
    run(orbit, pose, 2);
    expect(orbit.distance).toBeCloseTo(RIVER_VIEW.minDistance, 3);
    expect(RIVER_VIEW.minDistance).toBeLessThanOrEqual(20);
    expect(dist3(pose.position, p)).toBeLessThan(45);
    expect(dist3(pose.lookAt, p)).toBeLessThan(25);
    const c = pose.position;
    expect(c.y - groundAt(terrain, c.x, c.z)).toBeGreaterThanOrEqual(CAMERA_TUNING.minClearance - 1e-6);
  });

  it('relaxes the elevation limit only when close (overview stays steep)', () => {
    const { orbit, pose } = settled();
    orbit.drag(0, -1e5, 800);
    run(orbit, pose, 1);
    expect(orbit.elevation).toBeCloseTo(RIVER_VIEW.minElevation, 3);
    const p = spot(300);
    for (let i = 0; i < 20; i++) orbit.zoomAt(0.7, p);
    run(orbit, pose, 2);
    orbit.drag(0, -1e5, 800);
    run(orbit, pose, 1);
    expect(orbit.elevation).toBeLessThan(0.3);
    // Zooming back out raises the camera again with the distance, smoothly.
    orbit.reset();
    let prevEl = orbit.elevation;
    let maxJump = 0;
    for (let i = 0; i < 240; i++) {
      orbit.update(dt, false, terrain, pose);
      maxJump = Math.max(maxJump, Math.abs(orbit.elevation - prevEl));
      prevEl = orbit.elevation;
    }
    expect(orbit.elevation).toBeGreaterThanOrEqual(RIVER_VIEW.minElevation - 1e-6);
    expect(maxJump).toBeLessThan(0.08);
  });

  it('double-click flies smoothly to a spot and orbits around it', () => {
    const { orbit, pose } = settled();
    const p = spot(600);
    orbit.flyTo(p);
    expect(orbit.framed).toBe(false);
    let prev = { ...pose.position };
    let maxStep = 0;
    for (let i = 0; i < 240; i++) {
      orbit.update(dt, false, terrain, pose);
      maxStep = Math.max(maxStep, dist3(pose.position, prev));
      prev = { ...pose.position };
    }
    expect(maxStep).toBeLessThan(40); // a flight over many frames, no teleport
    expect(dist3(pose.lookAt, p)).toBeLessThan(0.5);
    expect(orbit.distance).toBeLessThanOrEqual(RIVER_VIEW.focusDistance + 1e-6);
    expect(orbit.elevation).toBeLessThanOrEqual(RIVER_VIEW.focusElevation + 1e-6);
    // Dragging now orbits around the spot: the look point stays put while the camera moves.
    const cam = { ...pose.position };
    orbit.drag(300, 0, 800);
    run(orbit, pose, 1.5);
    expect(dist3(pose.lookAt, p)).toBeLessThan(0.5);
    expect(dist3(pose.position, cam)).toBeGreaterThan(20);
  });

  it('reset returns smoothly to the whole-river framing', () => {
    const { orbit, pose } = settled();
    orbit.flyTo(spot(600));
    orbit.drag(0, -1e5, 800);
    run(orbit, pose, 3);
    orbit.reset();
    expect(orbit.framed).toBe(true);
    let prev = { ...pose.position };
    let maxStep = 0;
    for (let i = 0; i < 300; i++) {
      orbit.update(dt, false, terrain, pose);
      maxStep = Math.max(maxStep, dist3(pose.position, prev));
      prev = { ...pose.position };
    }
    expect(maxStep).toBeLessThan(40);
    const b = riverBounds(river);
    expect(pose.lookAt.x).toBeCloseTo(b.cx, 0);
    expect(pose.lookAt.z).toBeCloseTo(b.cz, 0);
    expect(maxNdc(river, pose, aspect)).toBeLessThanOrEqual(1);
    expect(orbit.elevation).toBeGreaterThanOrEqual(RIVER_VIEW.startElevation - 1e-6);
  });

  it('zooming out far enough in a close-up returns to the framing by itself', () => {
    const { orbit, pose } = settled();
    orbit.flyTo(spot(200));
    run(orbit, pose, 3);
    for (let i = 0; i < 40 && !orbit.framed; i++) orbit.zoomAt(1.3, spot(200));
    expect(orbit.framed).toBe(true);
    run(orbit, pose, 4);
    expect(maxNdc(river, pose, aspect)).toBeLessThanOrEqual(1);
  });

  it('pans with the pointer (grab), follows the ground and stays near the river', () => {
    const { orbit, pose } = settled();
    orbit.flyTo(spot(400));
    run(orbit, pose, 3);
    const c0 = { ...orbit.centre };
    const g0 = c0.y - groundAt(terrain, c0.x, c0.z);
    // Camera right is (cos az, -sin az); dragging right moves the focus to the camera's left.
    const az = orbit.azimuth;
    orbit.pan(120, 0, 800, terrain);
    run(orbit, pose, 1.5);
    const c1 = { ...orbit.centre };
    const along = (c1.x - c0.x) * Math.cos(az) - (c1.z - c0.z) * Math.sin(az);
    expect(along).toBeLessThan(-5);
    expect(Math.abs(c1.y - groundAt(terrain, c1.x, c1.z) - g0)).toBeLessThan(0.5);
    // Dragging down moves the focus away from the camera (forward = (-sin az, -cos az)).
    orbit.pan(0, 120, 800, terrain);
    run(orbit, pose, 1.5);
    const fwd = -(orbit.centre.x - c1.x) * Math.sin(az) - (orbit.centre.z - c1.z) * Math.cos(az);
    expect(fwd).toBeGreaterThan(5);
    // Huge pans are clamped near the river's bounding box.
    orbit.pan(-1e6, 1e6, 800, terrain);
    run(orbit, pose, 2);
    const b = riverBounds(river);
    const m = RIVER_VIEW.panMargin + 1e-6;
    expect(orbit.centre.x).toBeGreaterThanOrEqual(b.minX - m);
    expect(orbit.centre.x).toBeLessThanOrEqual(b.maxX + m);
    expect(orbit.centre.z).toBeGreaterThanOrEqual(b.minZ - m);
    expect(orbit.centre.z).toBeLessThanOrEqual(b.maxZ + m);
  });

  it('keyboard rotation turns and tilts within the limits', () => {
    const { orbit, pose } = settled();
    const az0 = orbit.azimuth;
    orbit.rotateBy(0.5, 0);
    run(orbit, pose, 1);
    expect(orbit.azimuth - az0).toBeCloseTo(0.5, 2);
    orbit.rotateBy(0, 10);
    run(orbit, pose, 1);
    expect(orbit.elevation).toBeCloseTo(RIVER_VIEW.maxElevation, 3);
    orbit.rotateBy(0, -10);
    run(orbit, pose, 1);
    expect(orbit.elevation).toBeCloseTo(RIVER_VIEW.minElevation, 3);
  });

  it('a close-up behind a ridge raises the camera so the spot stays in sight', () => {
    const ridge = createAnalyticTerrain({
      height: (x, z) => 200 - 0.15 * z + 50 * Math.exp(-((x - 40) ** 2) / (2 * 12 ** 2)),
      width: 500,
      length: 900,
      cellSize: 2,
    });
    const r = windingRiver(ridge, 20, 820, 0);
    const orbit = new RiverOrbit();
    const from = createCameraPose();
    // Look from +X so the orbit sits on the far side of the ridge (x = 40) from the river (x = 0).
    from.position = { x: 600, y: 300, z: 400 };
    orbit.begin(r, from, aspect);
    const pose = createCameraPose();
    const p = { x: 0, y: ridge.heightAt(0, 400), z: 400 };
    orbit.flyTo(p);
    orbit.drag(0, -1e5, 800);
    run(orbit, pose, 4, ridge);
    const c = pose.position;
    expect(c.x).toBeGreaterThan(40); // really behind the ridge
    const ty = p.y + RIVER_VIEW.focusLineUp;
    for (const f of CAMERA_TUNING.lineSamples) {
      const x = c.x + (p.x - c.x) * f;
      const z = c.z + (p.z - c.z) * f;
      const y = c.y + (ty - c.y) * f;
      expect(y).toBeGreaterThanOrEqual(groundAt(ridge, x, z) + CAMERA_TUNING.minClearance - 1e-6);
    }
  });

  /** Ground point under a screen position (ndc), as the renderer's pointer pick does. */
  function pickAt(pose: CameraPose, nx: number, ny: number, t: Terrain = terrain): Vec3 {
    const ray = screenRay(pose, effectiveFov(pose.fov, aspect), aspect, nx, ny, createRay());
    const out = { x: 0, y: 0, z: 0 };
    expect(raycastGround(t, ray, 6000, out)).toBe(true);
    return out;
  }

  it('wheel steps at a spot far from the river keep it under the cursor and centre on the ground', () => {
    const { orbit, pose } = settled();
    const cursor = { x: 0.4, y: -0.25 };
    const p0 = pickAt(pose, cursor.x, cursor.y);
    // Off to the side of the river, beyond the pan margin: clamping the goal used to drag it away.
    expect(Math.abs(p0.x)).toBeGreaterThan(riverBounds(river).maxX + RIVER_VIEW.panMargin);
    for (let i = 0; i < 40; i++) {
      // Several wheel events can arrive between two frames, each re-picking under the cursor.
      orbit.zoomAt(0.75, pickAt(pose, cursor.x, cursor.y), terrain);
      if (i % 3 === 0) run(orbit, pose, 0.3);
      const n = ndc(p0, pose);
      expect(n.x).toBeCloseTo(cursor.x, 3);
      expect(n.y).toBeCloseTo(cursor.y, 3);
    }
    run(orbit, pose, 3);
    expect(orbit.distance).toBeCloseTo(RIVER_VIEW.minDistance, 3);
    expect(ndc(p0, pose).x).toBeCloseTo(cursor.x, 3);
    // The orbit centre ended on the ground (in the middle of the screen), not inside the hillside.
    const c = orbit.centre;
    expect(Math.abs(c.y - groundAt(terrain, c.x, c.z))).toBeLessThan(0.05);
  });

  it('panning from the overview grabs the ground in the middle of the screen', () => {
    const { orbit, pose } = settled();
    const heightPx = 800;
    const widthPx = heightPx * aspect;
    const g0 = pickAt(pose, 0, 0);
    orbit.pan(120, 0, heightPx, terrain);
    run(orbit, pose, 2);
    const a = ndc(g0, pose);
    expect(a.x).toBeCloseTo((2 * 120) / widthPx, 2);
    expect(Math.abs(a.y)).toBeLessThan(0.01);
    const g1 = pickAt(pose, 0, 0);
    orbit.pan(0, 80, heightPx, terrain);
    run(orbit, pose, 2);
    const b = ndc(g1, pose);
    expect(Math.abs(b.x)).toBeLessThan(0.01);
    // Down is -ndc. Moving the focus along a slope also moves it (and the camera) up or down to keep
    // its height above the ground, so on this 15 % slope the grab is only roughly exact.
    expect(b.y).toBeLessThan((-2 * 80 * 0.8) / heightPx);
    expect(b.y).toBeGreaterThan((-2 * 80 * 1.25) / heightPx);
  });

  /** A pointer drag from `a` to `b` (ndc) as many small moves, a few of them between two frames. */
  function dragGround(
    orbit: RiverOrbit,
    pose: CameraPose,
    a: { x: number; y: number },
    b: typeof a,
    t: Terrain = terrain,
  ): void {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const u = i / steps;
      const v = (i + 1) / steps;
      orbit.grab(
        a.x + (b.x - a.x) * u,
        a.y + (b.y - a.y) * u,
        a.x + (b.x - a.x) * v,
        a.y + (b.y - a.y) * v,
        800,
        t,
      );
      if (i % 4 === 3) run(orbit, pose, 0.1, t);
    }
    run(orbit, pose, 2, t);
  }

  it('grabbing the ground keeps the grabbed spot under the pointer, anywhere on screen', () => {
    const { orbit, pose } = settled();
    orbit.flyTo(spot(300));
    run(orbit, pose, 3);
    const a = { x: 0.35, y: -0.3 };
    const b = { x: -0.15, y: -0.05 };
    const g = pickAt(pose, a.x, a.y);
    dragGround(orbit, pose, a, b);
    const n = ndc(g, pose);
    expect(n.x).toBeCloseTo(b.x, 2);
    expect(n.y).toBeCloseTo(b.y, 2);
    // The focus slid along the slope: still on the ground.
    const c = orbit.centre;
    expect(Math.abs(c.y - groundAt(terrain, c.x, c.z))).toBeLessThan(0.05);
  });

  it('grabbing across a curved valley stays exact and keeps the focus on the ground', () => {
    const valley = createAnalyticTerrain({
      height: (x, z) => 200 - 0.15 * z + 0.004 * x * x,
      width: 600,
      length: 900,
      cellSize: 2,
    });
    const r = windingRiver(valley, 20, 820, 0);
    const orbit = new RiverOrbit();
    const from = createCameraPose();
    from.position = { x: 0, y: 260, z: 1000 };
    from.lookAt = { x: 0, y: 100, z: 500 };
    orbit.begin(r, from, aspect);
    const pose = createCameraPose();
    orbit.flyTo({ x: 0, y: valley.heightAt(0, 450), z: 450 });
    run(orbit, pose, 3, valley);
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 0.45, y: 0.05 }],
      [{ x: 0.2, y: -0.3 }, { x: -0.3, y: 0.1 }],
    ]) {
      const g = pickAt(pose, a.x, a.y, valley);
      dragGround(orbit, pose, a, b, valley);
      const n = ndc(g, pose);
      expect(n.x).toBeCloseTo(b.x, 2);
      expect(n.y).toBeCloseTo(b.y, 2);
      const c = orbit.centre;
      expect(Math.abs(c.y - groundAt(valley, c.x, c.z))).toBeLessThan(0.1);
    }
  });

  it('grabbing works from the whole-river overview too', () => {
    const { orbit, pose } = settled();
    // Small enough to stay within the pan margin around the river (a bigger drag stops at it).
    const a = { x: -0.2, y: -0.4 };
    const b = { x: -0.05, y: -0.15 };
    const g = pickAt(pose, a.x, a.y);
    dragGround(orbit, pose, a, b);
    expect(orbit.framed).toBe(false);
    const n = ndc(g, pose);
    expect(n.x).toBeCloseTo(b.x, 2);
    expect(n.y).toBeCloseTo(b.y, 2);
  });

  it('grabbing the sky falls back to a plain pan', () => {
    const { orbit, pose } = settled();
    orbit.flyTo(spot(300));
    orbit.rotateBy(0, -10);
    run(orbit, pose, 3);
    const c0 = { ...orbit.centre };
    orbit.grab(0, 0.99, 0.2, 0.99, 800, terrain);
    run(orbit, pose, 1);
    expect(dist3(orbit.centre, c0)).toBeGreaterThan(1);
    expect(isFinitePose(pose)).toBe(true);
  });

  it('a pan after flying beyond the pan margin does not snap back toward the river', () => {
    const { orbit, pose } = settled();
    const b = riverBounds(river);
    const far = { x: b.maxX + RIVER_VIEW.panMargin + 120, y: 0, z: (b.minZ + b.maxZ) / 2 };
    far.y = groundAt(terrain, far.x, far.z);
    orbit.flyTo(far);
    run(orbit, pose, 3);
    expect(dist3(orbit.centre, far)).toBeLessThan(0.5);
    orbit.pan(4, 0, 800, terrain);
    run(orbit, pose, 1.5);
    expect(dist3(orbit.centre, far)).toBeLessThan(5);
    // Panning further out is still held at the furthest point reached.
    orbit.pan(-1e5, 0, 800, terrain);
    run(orbit, pose, 1.5);
    expect(Math.abs(orbit.centre.x)).toBeLessThanOrEqual(Math.abs(far.x) + 5);
  });

  it('random interaction never puts the camera under the ground or produces NaN', () => {
    const ridge = createAnalyticTerrain({
      height: (x, z) => 200 - 0.15 * z + 70 * Math.exp(-((x - 120) ** 2) / (2 * 30 ** 2)),
      width: 600,
      length: 900,
      cellSize: 4,
    });
    const r = windingRiver(ridge, 20, 820, 20);
    const orbit = new RiverOrbit();
    orbit.begin(r, createCameraPose(), aspect);
    const pose = createCameraPose();
    const rng = createRng(42);
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 20 === 0) {
        const k = Math.floor(rng() * 8);
        const s = r[Math.floor(rng() * r.length)];
        const p = { x: s.x + (rng() - 0.5) * 80, y: 0, z: s.z + (rng() - 0.5) * 80 };
        p.y = groundAt(ridge, p.x, p.z);
        if (k === 0) orbit.zoomAt(0.3 + rng() * 1.2, p, ridge);
        else if (k === 1) orbit.flyTo(p);
        else if (k === 2) orbit.pan((rng() - 0.5) * 600, (rng() - 0.5) * 600, 800, ridge);
        else if (k === 3) orbit.drag((rng() - 0.5) * 900, (rng() - 0.5) * 900, 800);
        else if (k === 4) orbit.zoomBy(0.3 + rng() * 2);
        else if (k === 5) orbit.rotateBy((rng() - 0.5) * 2, (rng() - 0.5) * 2);
        else if (k === 6) orbit.grab(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, 800, ridge);
        else orbit.reset();
      }
      orbit.update(dt, rng() < 0.5, ridge, pose);
      expect(isFinitePose(pose)).toBe(true);
      const c = pose.position;
      expect(c.y - groundAt(ridge, c.x, c.z)).toBeGreaterThanOrEqual(CAMERA_TUNING.minClearance - 1e-6);
      expect(dist3(c, pose.lookAt)).toBeGreaterThanOrEqual(RIVER_VIEW.minDistance - 1e-6);
    }
  });
});
