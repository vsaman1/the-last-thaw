import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { createTerrain } from '../terrain/terrain';
import { streamSandbox } from '../testing/streamSandbox';
import { LOGIC_RULES } from '../terrain/logic';
import { buildCaveGeometry, caveFace, cavePlacement, CAVE_TUNING } from './cave';
import { WaterSystem } from './system';

/**
 * The cave a 'cave' stream rises from (./cave.ts), on the stream sandbox's side stream: a spring at
 * the foot of the left valley wall (s 290, d −36), its first segment pointing away from the wall.
 */

const terrain = createTerrain(streamSandbox);
const water = new WaterSystem(terrain);
const pool = water.pools[0];

describe('cave spring', () => {
  it('stands at the back of its pool, its recess reaching to where the bank leaves the water', () => {
    const c = cavePlacement(terrain, 1, pool.level)!;
    expect(c).not.toBeNull();
    expect(c.waterY).toBe(pool.level);
    expect(c.mouthA).toBeGreaterThan(0);
    expect(c.backA).toBeLessThan(pool.radius + 0.5);
    expect(c.backA - c.mouthA).toBeGreaterThanOrEqual(CAVE_TUNING.depthMin - 1e-9);
    // Into the face = against the first segment (s 290, d −36 → s 300, d −26).
    const a = terrain.course.toWorld(290, -36);
    const b = terrain.course.toWorld(300, -26);
    const ux = (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z);
    const uz = (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z);
    expect(c.backX * ux + c.backZ * uz).toBeCloseTo(-1, 9);
    // At the back of the recess the pool's bank rises out of the water.
    const back = { x: c.cx + c.backX * c.backA, z: c.cz + c.backZ * c.backA };
    expect(terrain.heightAt(back.x, back.z)).toBeGreaterThan(pool.level - 0.6);
    const mouth = { x: c.cx + c.backX * c.mouthA, z: c.cz + c.backZ * c.mouthA };
    expect(terrain.heightAt(mouth.x, mouth.z)).toBeLessThan(pool.level - 0.5);
  });

  it('has the valley wall behind it (the world logic rule measures it)', () => {
    const c = cavePlacement(terrain, 1)!;
    const face = caveFace(terrain, c, LOGIC_RULES.sourceCaveReach, LOGIC_RULES.sourceCaveRun);
    expect(face.rise).toBeGreaterThan(LOGIC_RULES.sourceCaveRise);
    expect(face.steepest).toBeGreaterThan(LOGIC_RULES.sourceCaveSteep);
  });

  it('builds a closed low-poly hood: the arch facing down the stream, dark inside, in rock colours', () => {
    const c = cavePlacement(terrain, 1, pool.level)!;
    const geo = buildCaveGeometry(c, terrain, terrain.theme, 7);
    const pos = geo.getAttribute('position').array as Float32Array;
    const nor = geo.getAttribute('normal').array as Float32Array;
    const col = geo.getAttribute('color').array as Float32Array;
    expect(pos.length / 9).toBeGreaterThan(100);
    expect(pos.length / 9).toBeLessThan(600);
    let far = 0;
    let top = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      expect(Number.isFinite(pos[i] + pos[i + 1] + pos[i + 2])).toBe(true);
      far = Math.max(far, Math.hypot(pos[i] - c.cx, pos[i + 2] - c.cz));
      top = Math.max(top, pos[i + 1]);
      expect(Math.hypot(nor[i], nor[i + 1], nor[i + 2])).toBeCloseTo(1, 4);
    }
    // Within the pool and the stretch of bank behind it; standing over the arch by its rock.
    expect(far).toBeLessThan(c.backA + CAVE_TUNING.backInto + 2 * (c.half + CAVE_TUNING.sideThick));
    expect(top - pool.level).toBeGreaterThan(c.rise + CAVE_TUNING.topThick * 0.8);
    // Faces turned toward the stream (out of the mouth) are the frame and the dark back wall; the
    // brightest of them is rock, the darkest near black.
    const rock = new Color(terrain.theme.rockBands[0]);
    let darkest = Infinity;
    let brightest = 0;
    for (let i = 0; i < nor.length; i += 9) {
      const out = -(nor[i] * c.backX + nor[i + 2] * c.backZ);
      if (out < 0.8) continue;
      const lum = col[i] + col[i + 1] + col[i + 2];
      darkest = Math.min(darkest, lum);
      brightest = Math.max(brightest, lum);
    }
    expect(darkest).toBeLessThan(0.1 * (rock.r + rock.g + rock.b));
    expect(brightest).toBeGreaterThan(0.6 * (rock.r + rock.g + rock.b));
    // Deterministic from the seed.
    const again = buildCaveGeometry(c, terrain, terrain.theme, 7).getAttribute('position').array;
    expect(Array.from(again)).toEqual(Array.from(pos));
    geo.dispose();
  });
});
