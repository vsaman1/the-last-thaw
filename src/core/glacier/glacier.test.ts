import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { LEVELS } from '../levels';
import { getTerrain } from '../session';
import { INTRO_TIMING } from '../intro';
import { generateDecor } from '../terrain/decor';
import { createAnalyticTerrain, inclinedPlane } from '../testing/analyticTerrain';
import { calvingKeys } from './calving';
import {
  GLACIER_TUNING,
  PORTAL_TUNING,
  createGlacierPlacement,
  getGlacier,
  glacierFrontS,
  glacierSnoutS,
  glacierSnowAt,
  glacierSurface,
  glacierTopAt,
  glacierWorld,
  spawnIcebergFor,
} from './glacier';
import { SNOW_LIFT, buildCrackGeometry, buildGlacierGeometry, buildSnowFieldGeometry } from './geometry';

const arr = (g: BufferGeometry, name: string): Float32Array => g.getAttribute(name).array as Float32Array;

function expectInBounds(pos: Float32Array, b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
  let bad = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const ok =
      Number.isFinite(pos[i]) &&
      Number.isFinite(pos[i + 1]) &&
      Number.isFinite(pos[i + 2]) &&
      pos[i] >= b.minX &&
      pos[i] <= b.maxX &&
      pos[i + 2] >= b.minZ &&
      pos[i + 2] <= b.maxZ;
    if (!ok) bad++;
  }
  expect(bad).toBe(0);
}

describe.each(LEVELS.map((l) => [l.id, l] as const))('glacier at the top of %s', (_id, level) => {
  const terrain = getTerrain(level);
  const g = getGlacier(terrain);

  it('is deterministic and derived from the spawn (no level data)', () => {
    const again = createGlacierPlacement(terrain);
    expect({ ...again, terrain: null }).toEqual({ ...g, terrain: null });
    const ice = spawnIcebergFor(terrain);
    expect(g.spawn).toEqual({ x: ice.pos.x, y: ice.pos.y, z: ice.pos.z });
    expect(g.radius).toBeCloseTo(ice.radius, 12);
    expect(g.endSpeed).toBeCloseTo(Math.hypot(ice.vel.x, ice.vel.z), 12);
    expect(Math.hypot(g.fx, g.fz)).toBeCloseTo(1, 9);
  });

  it('sits upstream of the spawn, with the iceberg clear of the snout at the hand-off', () => {
    expect(g.embedS).toBeCloseTo(level.startS - g.slide, 9);
    expect(g.faceS).toBeLessThan(g.embedS);
    expect(g.backS).toBeLessThan(0);
    // The spawned hull (widest ring ≈ its radius) is in front of the snout everywhere it spans.
    for (let d = -g.radius; d <= g.radius; d += g.radius / 8) {
      expect(level.startS - Math.sqrt(Math.max(0, g.radius ** 2 - d * d))).toBeGreaterThan(glacierFrontS(g, d));
    }
    // And no glacier top under the spawn footprint.
    for (let a = 0; a < 16; a++) {
      const r = g.radius * 0.95;
      const x = g.spawn.x + Math.cos((a / 16) * Math.PI * 2) * r;
      const z = g.spawn.z + Math.sin((a / 16) * Math.PI * 2) * r;
      expect(glacierTopAt(g, x, z)).toBe(-Infinity);
    }
  });

  it('slides out far enough to reach the spawn speed even in the short calving', () => {
    const k = calvingKeys(INTRO_TIMING.calvingShort);
    // slideProgress needs end slope m = speed × window / slide ≥ 1 to start from rest.
    expect((g.endSpeed * (k.duration - k.breakAt)) / g.slide).toBeGreaterThanOrEqual(1);
    expect(g.slide).toBeGreaterThanOrEqual(GLACIER_TUNING.slideMin);
    expect(g.slide).toBeLessThanOrEqual(GLACIER_TUNING.slideMax);
  });

  it('frames the iceberg as the leading chunk: a face about its height, a socket around it', () => {
    expect(g.faceHeight).toBeGreaterThan(g.ledge + 0.75);
    expect(g.faceHeight).toBeLessThanOrEqual(g.iceHeight + g.ledge + 0.2 * g.scale);
    expect(g.faceHeight).toBeGreaterThan(0.6 * g.iceHeight);
    expect(g.socketHalf).toBeGreaterThan(g.radius);
    expect(g.socketBackS).toBeLessThan(g.embedS - g.radius);
  });

  it('stays under the follow camera at the hand-off (camera and its sight line clear)', () => {
    const cam = g.handoff.position;
    expect(cam.y - glacierTopAt(g, cam.x, cam.z)).toBeGreaterThanOrEqual(GLACIER_TUNING.camMargin - 1e-6);
    // Sight line from the camera to the spawned iceberg's foot clears the glacier.
    const ty = g.spawn.y + GLACIER_TUNING.sightTargetUp * g.scale;
    for (let f = 0; f <= 1; f += 0.02) {
      const x = cam.x + (g.spawn.x - cam.x) * f;
      const z = cam.z + (g.spawn.z - cam.z) * f;
      const y = cam.y + (ty - cam.y) * f;
      expect(y - glacierTopAt(g, x, z)).toBeGreaterThan(0.2);
    }
  });

  it('builds finite, deterministic geometry inside the level bounds', () => {
    const b = level.bounds;
    const body = buildGlacierGeometry(g);
    const cracks = buildCrackGeometry(g);
    const snow = buildSnowFieldGeometry(g);
    for (const geo of [body, cracks, snow]) expectInBounds(arr(geo, 'position'), b);
    const tris = arr(body, 'position').length / 9;
    expect(tris).toBeGreaterThan(500);
    expect(tris).toBeLessThan(6000);
    expect(arr(snow, 'position').length / 9).toBeLessThan(16000);
    expect(arr(cracks, 'position').length / 9).toBeGreaterThan(20);
    for (const v of arr(cracks, 'aReveal')) expect(v >= 0 && v <= 1).toBe(true);
    for (const v of arr(body, 'aGlow')) expect(v >= 0 && v <= 1.5).toBe(true);
    const nor = arr(body, 'normal');
    for (let i = 0; i < nor.length; i += 3) expect(Math.hypot(nor[i], nor[i + 1], nor[i + 2])).toBeCloseTo(1, 4);
    // The top faces up (it is drawn front-face only).
    let up = 0;
    for (let i = 1; i < nor.length; i += 3) if (nor[i] > 0.3) up++;
    expect(up / (nor.length / 3)).toBeGreaterThan(0.5);
    expect(Array.from(arr(buildGlacierGeometry(g), 'position'))).toEqual(Array.from(arr(body, 'position')));
    expect(Array.from(arr(buildSnowFieldGeometry(g), 'color'))).toEqual(Array.from(arr(snow, 'color')));
    for (const geo of [body, cracks, snow]) geo.dispose();
  });

  it('lays the snow field just above the terrain, never on the valley floor in front of the snout', () => {
    const snow = buildSnowFieldGeometry(g);
    const pos = arr(snow, 'position');
    for (let i = 0; i < pos.length; i += 3 * 37) {
      expect(pos[i + 1] - terrain.heightAt(pos[i], pos[i + 2])).toBeCloseTo(SNOW_LIFT, 3);
    }
    const p = { x: 0, y: 0, z: 0 };
    for (let s = g.faceS + 1; s < level.startS + 40; s += 3) {
      for (const d of [-10, 0, 10]) {
        glacierWorld(g, s, d, p);
        expect(glacierSnowAt(g, p.x, p.z, terrain.heightAt(p.x, p.z), 0)).toBe(0);
      }
    }
    snow.dispose();
  });

  it('keeps decor off the glacier and its snow field', () => {
    const decor = generateDecor(terrain, level.seed);
    for (const batch of [decor.trees, decor.bushes, decor.tufts, decor.pebbles]) {
      for (let i = 0; i < batch.count; i++) {
        const x = batch.positions[i * 3];
        const y = batch.positions[i * 3 + 1];
        const z = batch.positions[i * 3 + 2];
        expect(glacierTopAt(g, x, z)).toBeLessThan(y + 0.5);
      }
    }
  });
});

/** Distance along the ray (o, u) to the nearest triangle of `pos` (Möller–Trumbore), or Infinity. */
function rayHit(pos: Float32Array, o: number[], u: number[]): number {
  let best = Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    const e1 = [pos[i + 3] - pos[i], pos[i + 4] - pos[i + 1], pos[i + 5] - pos[i + 2]];
    const e2 = [pos[i + 6] - pos[i], pos[i + 7] - pos[i + 1], pos[i + 8] - pos[i + 2]];
    const p = [u[1] * e2[2] - u[2] * e2[1], u[2] * e2[0] - u[0] * e2[2], u[0] * e2[1] - u[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const t0 = [o[0] - pos[i], o[1] - pos[i + 1], o[2] - pos[i + 2]];
    const a = (t0[0] * p[0] + t0[1] * p[1] + t0[2] * p[2]) / det;
    if (a < 0 || a > 1) continue;
    const q = [t0[1] * e1[2] - t0[2] * e1[1], t0[2] * e1[0] - t0[0] * e1[2], t0[0] * e1[1] - t0[1] * e1[0]];
    const b = (u[0] * q[0] + u[1] * q[1] + u[2] * q[2]) / det;
    if (b < 0 || a + b > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > 1e-6 && t < best) best = t;
  }
  return best;
}

describe('meltwater portal (Power Valley: its river rises under the glacier)', () => {
  const level = LEVELS.find((l) => l.id === 'power-valley')!;
  const terrain = getTerrain(level);
  const g = getGlacier(terrain);
  const river = (level.features ?? []).findIndex((f) => f.type === 'stream');

  it('opens where the river crosses the snout, clear of the socket, with ice over its arch', () => {
    expect(g.portals).toHaveLength(1);
    const p = g.portals[0];
    expect(p.feature).toBe(river);
    expect(p.s).toBeCloseTo(glacierSnoutS(g, p.d), 1);
    expect(Math.abs(p.d - 30)).toBeLessThan(1);
    expect(p.half).toBeGreaterThanOrEqual(7);
    expect(Math.abs(p.d) - p.half).toBeGreaterThan(g.socketHalf + 2);
    expect(p.apexY - p.springY).toBeGreaterThanOrEqual(PORTAL_TUNING.riseMin);
    expect(p.short).toBe(0);
    expect(p.lift).toBeLessThanOrEqual(PORTAL_TUNING.maxLift);
    // The glacier stands at least the roof over the apex (its lobe), and only near the portal.
    expect(glacierSurface(g, glacierFrontS(g, p.d), p.d)).toBeGreaterThan(p.apexY + PORTAL_TUNING.roof - 0.01);
    const plain = createGlacierPlacement({ ...terrain, level: { ...level, features: [] } });
    expect(glacierSurface(g, g.faceS, 0)).toBeCloseTo(glacierSurface(plain, g.faceS, 0), 9);
  });

  it('lets the channel run out from beneath the ice: rays into the opening reach the vault', () => {
    const p = g.portals[0];
    const body = buildGlacierGeometry(g);
    const pos = arr(body, 'position');
    // From 6 m in front of the snout, looking up the stream into the opening.
    const ex = g.fx * p.dirS + g.rx * p.dirD;
    const ez = g.fz * p.dirS + g.rz * p.dirD;
    const o = { x: 0, y: 0, z: 0 };
    for (const off of [-0.5, 0, 0.5]) {
      for (const h of [0.5, 1.5, 0.6 * (p.apexY - p.springY)]) {
        glacierWorld(g, p.s + 6 * p.dirS, p.d + 6 * p.dirD + off * p.half, o);
        const hit = rayHit(pos, [o.x, p.springY + h, o.z], [-ex, 0, -ez]);
        // Not stopped at the face (6 m away): the vault's back wall, ~depth further in.
        expect(hit).toBeGreaterThan(6 + 0.6 * p.depth);
        expect(hit).toBeLessThan(6 + p.depth + 3);
      }
    }
    // Beside the opening the face is solid ice down to the ground (the snout recedes a little there).
    const side = p.d + p.half + 4;
    glacierWorld(g, p.s + 6, side, o);
    const face = 6 + p.s - glacierSnoutS(g, side);
    expect(rayHit(pos, [o.x, p.springY + 1, o.z], [-g.fx, 0, -g.fz])).toBeLessThan(face + 1);
    body.dispose();
  });
});

describe('glacier on an analytic test terrain', () => {
  it('places and builds without a generated terrain', () => {
    const t = createAnalyticTerrain({ height: inclinedPlane(0.15), width: 160, length: 400, cellSize: 2 });
    const g = createGlacierPlacement(t);
    expect(g.faceS).toBeLessThan(t.level.startS);
    expect(Number.isFinite(g.faceHeight)).toBe(true);
    const body = buildGlacierGeometry(g);
    expectInBounds(arr(body, 'position'), t.level.bounds);
    body.dispose();
  });
});
