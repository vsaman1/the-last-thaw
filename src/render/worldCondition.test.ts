import { describe, expect, it } from 'vitest';
import { Color, MeshStandardMaterial, SRGBColorSpace, type WebGLProgramParametersWithUniforms } from 'three';
import { THEMES } from '../core/terrain/themes';
import type { LevelTheme } from '../core/types';
import { WORLD_PALETTE, conditionAt, worldCondition } from '../story/environment';
import { lightingLookFor } from './Lighting';
import { RIVER_PALETTE } from './materials/water';
import { skyLookFor } from './Sky';
import {
  COVER_THRESHOLD,
  PLANT_HUE,
  PLANT_SATURATION,
  WORLD_CONDITION_PARS,
  WORLD_CONDITION_VERTEX,
  activeCondition,
  conditionLightingLook,
  conditionSkyLook,
  conditionWaterColours,
  coverAmount,
  obstacleTreeTint,
  patchVegetation,
  plantAmount,
} from './worldCondition';

const THEME_IDS = Object.keys(THEMES) as LevelTheme[];
const ACT1 = worldCondition('ch1-beginning');
const ACT2 = worldCondition('ch5-denial');
const ACT3 = worldCondition('ch8-remains');
const plant = (hex: string): number => {
  const c = new Color(hex);
  return plantAmount(c.r, c.g, c.b);
};
const srgb = (c: Color): { r: number; g: number; b: number } => c.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
/** The river material's colour uniforms as createWaterUniforms makes them. */
const riverColours = () => ({
  uDeep: { value: new Color(RIVER_PALETTE.deep) },
  uMid: { value: new Color(RIVER_PALETTE.mid) },
  uCyan: { value: new Color(RIVER_PALETTE.cyan) },
  uFoam: { value: new Color(RIVER_PALETTE.foam) },
  uFoamShade: { value: new Color(RIVER_PALETTE.foamShade) },
  uPlume: { value: new Color(RIVER_PALETTE.plume) },
});

describe('no condition (Arcade) and a healthy one (Act I) change nothing', () => {
  it('returns the very same looks and leaves materials and water untouched', () => {
    for (const c of [null, ACT1]) {
      expect(activeCondition(c)).toBe(false);
      const sky = skyLookFor({ theme: 'alpine' });
      expect(conditionSkyLook(sky, c)).toBe(sky);
      const light = lightingLookFor('alpine');
      expect(conditionLightingLook(light, c)).toBe(light);
      const water = riverColours();
      const before = water.uDeep.value.getHex();
      conditionWaterColours(water, c);
      expect(water.uDeep.value.getHex()).toBe(before);
      const m = new MeshStandardMaterial({ vertexColors: true });
      const onBefore = m.onBeforeCompile;
      expect(patchVegetation(m, c, 'ground')).toBe(m);
      expect(m.onBeforeCompile).toBe(onBefore);
      expect(m.userData.worldCondition).toBeUndefined();
      expect(obstacleTreeTint(c)).toBeNull();
    }
  });
});

describe('sky and light', () => {
  it('haze closes the fog in, turns it grey-brown and keeps the look valid, more so by Act III', () => {
    for (const t of THEME_IDS) {
      const base = skyLookFor({ theme: t });
      const two = conditionSkyLook(base, ACT2);
      const three = conditionSkyLook(base, ACT3);
      for (const look of [two, three]) {
        for (const c of [look.top, look.horizon, look.fog, look.sun, look.cloudColor, look.cloudEmissive]) {
          expect(c).toMatch(/^#[0-9A-F]{6}$/);
        }
        expect(look.fogFar).toBeGreaterThan(look.fogNear * 2);
        expect(look.viewHaze).toBeLessThanOrEqual(0.45);
      }
      expect(two.fogFar).toBeLessThan(base.fogFar);
      expect(three.fogFar).toBeLessThan(two.fogFar);
      expect(three.fogNear).toBeLessThan(two.fogNear);
      // The fog moves toward the smog colour.
      const smog = new Color(WORLD_PALETTE.smog);
      const dist = (hex: string): number => {
        const c = new Color(hex);
        return Math.hypot(c.r - smog.r, c.g - smog.g, c.b - smog.b);
      };
      expect(dist(three.fog)).toBeLessThan(dist(base.fog) + 1e-9);
    }
  });

  it('dims the sun through the haze and browns the ground bounce', () => {
    const base = lightingLookFor('meadow');
    const look = conditionLightingLook(base, ACT3);
    expect(look.sunIntensity).toBeLessThan(base.sunIntensity);
    expect(look.sunIntensity).toBeGreaterThan(0.8 * base.sunIntensity);
    const g0 = srgb(new Color(base.hemiGround));
    const g1 = srgb(new Color(look.hemiGround));
    expect(g1.g - g1.r).toBeLessThan(g0.g - g0.r); // less green, more brown
  });
});

describe('water', () => {
  it('Act II is a little murkier; Act III is brown (more red than blue)', () => {
    const blue = riverColours();
    const two = riverColours();
    const three = riverColours();
    conditionWaterColours(two, ACT2);
    conditionWaterColours(three, ACT3);
    const b = srgb(blue.uMid.value);
    const m2 = srgb(two.uMid.value);
    const m3 = srgb(three.uMid.value);
    expect(m2.b).toBeGreaterThan(m2.r); // still reads as blue water in Act II
    expect(m2.b).toBeLessThan(b.b);
    expect(m3.r).toBeGreaterThan(m3.b); // brown in Act III
    expect(srgb(three.uDeep.value).r).toBeGreaterThan(srgb(three.uDeep.value).b);
  });
});

describe('what counts as plants (shared by the shader and plantAmount)', () => {
  it("every theme's grass, leaves, needles and bushes count; ground, rock, trunks, roads and snow do not", () => {
    for (const id of THEME_IDS) {
      const t = THEMES[id];
      const s = t.scenery;
      for (const hex of [t.terrain.grass, t.terrain.grassDeep, s.coniferLow, s.coniferMid, s.coniferTop, s.broadleaf, s.broadleafLight, s.bush]) {
        expect(plant(hex), `${id} ${hex}`).toBeGreaterThan(0.6);
      }
      const notPlants = [
        t.terrain.sand, t.terrain.sandWet, t.terrain.dirt, t.terrain.asphalt, t.terrain.gravel, t.terrain.snow,
        t.terrain.snowShade, t.terrain.seabed, t.terrain.seabedDeep, t.terrain.rockDark, s.trunk, s.pebble,
        ...t.rockBands, t.backdrop.rock, t.backdrop.rockWarm, t.backdrop.sand, t.backdrop.snow,
      ];
      for (const hex of notPlants) expect(plant(hex), `${id} ${hex}`).toBeLessThan(0.05);
      // The far land dries with the near (the canyon's far scrub is already tan: left as it is).
      expect(plant(t.backdrop.grass), id).toBeGreaterThan(id === 'canyon' ? -1 : 0.6);
    }
  });

  it('the GLSL uses the same thresholds as the CPU mirror', () => {
    const n = (v: number): string => v.toFixed(4);
    expect(WORLD_CONDITION_PARS).toContain(`smoothstep(${n(PLANT_HUE.from[0])}, ${n(PLANT_HUE.from[1])}, h)`);
    expect(WORLD_CONDITION_PARS).toContain(`smoothstep(${n(PLANT_HUE.to[0])}, ${n(PLANT_HUE.to[1])}, h)`);
    expect(WORLD_CONDITION_PARS).toContain(`smoothstep(${n(PLANT_SATURATION[0])}, ${n(PLANT_SATURATION[1])}, d / mx)`);
  });
});

describe('how much of the ground dries (shared by the shader and coverAmount)', () => {
  const NOISE = Array.from({ length: 101 }, (_, i) => i / 100);
  /** The share of the ground that dries, over evenly spread noise values. */
  const share = (cover: number): number =>
    NOISE.reduce((a, n) => a + coverAmount(cover, n), 0) / NOISE.length;

  it('no cover dries nothing; full cover dries every patch, with no green island left', () => {
    for (const n of NOISE) {
      expect(coverAmount(0, n)).toBe(0);
      expect(coverAmount(1, n)).toBeCloseTo(1, 9);
    }
    // Chapter 8 and later are at full cover; chapter 7 nearly.
    expect(ACT3.grass.cover).toBe(1);
  });

  it('more cover dries more ground; Act II dries patches, not the whole valley', () => {
    for (let c = 0.05; c <= 1; c += 0.05) expect(share(c)).toBeGreaterThanOrEqual(share(c - 0.05));
    const two = ACT2.grass.cover;
    expect(coverAmount(two, 0.2)).toBe(0); // low-noise ground stays green
    expect(coverAmount(two, 0.95)).toBe(1); // high-noise ground dries
    expect(share(two)).toBeGreaterThan(0.2);
    expect(share(two)).toBeLessThan(0.7);
  });

  it('the GLSL uses the same thresholds as the CPU mirror', () => {
    const n = (v: number): string => v.toFixed(4);
    const T = COVER_THRESHOLD;
    const vs = WORLD_CONDITION_VERTEX;
    expect(vs).toContain(`mix(${n(T.empty)}, ${n(T.full)}, uWcGrass.y)`);
    expect(vs).toContain(`${n(T.drop)} * smoothstep(${n(T.dropFrom)}, 1.0, uWcGrass.y)`);
    expect(vs).toContain(`smoothstep(wcT - ${n(T.blend)}, wcT + ${n(T.blend)}, wcN)`);
  });
});

describe('patched materials', () => {
  const fakeShader = (): WebGLProgramParametersWithUniforms =>
    ({
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {\n#include <color_vertex>\n#include <begin_vertex>\n}',
      fragmentShader: '',
    }) as unknown as WebGLProgramParametersWithUniforms;

  it('add the vertex step after the vertex colours, with per-role programs and live uniforms', () => {
    for (const role of ['ground', 'trees'] as const) {
      const m = patchVegetation(new MeshStandardMaterial({ vertexColors: true }), ACT3, role);
      expect(m.customProgramCacheKey()).toBe(`world-condition:${role}`);
      const shader = fakeShader();
      m.onBeforeCompile(shader, undefined as never);
      const vs = shader.vertexShader;
      expect(vs.indexOf(WORLD_CONDITION_VERTEX)).toBeGreaterThan(vs.indexOf('#include <color_vertex>'));
      expect(vs.indexOf(WORLD_CONDITION_VERTEX)).toBeLessThan(vs.indexOf('#include <begin_vertex>'));
      expect(vs.includes('#define WC_TREES')).toBe(role === 'trees');
      expect(shader.uniforms.uWcGrass.value).toEqual([ACT3.grass.dry, ACT3.grass.cover, ACT3.grass.brown, ACT3.snow.soot]);
      expect(shader.uniforms.uWcTrees.value).toEqual([ACT3.trees.dead, ACT3.trees.fade]);
      // Only the vertex shader changes: no per-pixel cost.
      expect(shader.fragmentShader).toBe('');
    }
  });
});

describe('obstacle trees', () => {
  const canopy = { name: 'canopy' };
  const green = (): Color => new Color().setHex(0x3f9a3a);

  it('a share stands dead (rust or grey), the living yellow, trunks and other kinds keep their colours', () => {
    const tint = obstacleTreeTint(ACT3);
    expect(tint).not.toBeNull();
    const rust = new Color(WORLD_PALETTE.deadRust);
    const grey = new Color(WORLD_PALETTE.deadGrey);
    const isDead = (c: Color): boolean => {
      const k = c.r / rust.r;
      const k2 = c.r / grey.r;
      return Math.abs(c.g / k - rust.g) < 1e-6 || Math.abs(c.g / k2 - grey.g) < 1e-6;
    };
    let dead = 0;
    const N = 4000;
    for (let id = 0; id < N; id++) {
      const c = green();
      tint!({ originId: id, kind: id % 2 ? 'pine' : 'broadleaf' }, canopy, c);
      if (isDead(c)) dead++;
      else expect(c.r / c.g).toBeGreaterThan(green().r / green().g); // yellower than it was
    }
    expect(dead / N).toBeGreaterThan(ACT3.trees.dead - 0.03);
    expect(dead / N).toBeLessThan(ACT3.trees.dead + 0.03);
    for (const [kind, name] of [['pine', 'trunk'], ['house', 'canopy'], ['rockSmall', 'rock']] as const) {
      const c = green();
      tint!({ originId: 7, kind }, { name }, c);
      expect(c.getHex()).toBe(green().getHex());
    }
  });

  it('is deterministic per body', () => {
    const tint = obstacleTreeTint(conditionAt('ch9-last-thaw', 3, 1, 0, 0))!;
    const a = green();
    const b = green();
    tint({ originId: 42, kind: 'pine' }, { name: 'cone' }, a);
    tint({ originId: 42, kind: 'pine' }, { name: 'cone' }, b);
    expect(a.getHex()).toBe(b.getHex());
  });
});
