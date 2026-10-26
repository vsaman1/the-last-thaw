import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import type { LevelDef, LevelTheme, TerrainFeature } from '../types';
import { level1 } from '../levels/level1';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { buildTerrainChunks } from './terrainGeometry';
import { generateDecor } from './decor';
import { buildBackdropGeometry, createSceneryModels, SCENERY_PALETTE } from './sceneryGeometry';
import { TERRAIN_PALETTE } from './terrainGeometry';
import { LEVEL_THEMES, THEMES, themeOf } from './themes';

const HEX = /^#[0-9A-Fa-f]{6}$/;

const level = (theme: LevelTheme | undefined): LevelDef => ({
  id: `theme-${theme ?? 'none'}`,
  index: 99,
  name: 'Theme',
  subtitle: 'test',
  seed: 11,
  bounds: { minX: -200, maxX: 200, minZ: -80, maxZ: 640 },
  cellSize: 2.5,
  seaLevel: 0,
  course: [
    { x: 0, z: 0, floor: 70, halfWidth: 22 },
    { x: 20, z: 300, floor: 44, halfWidth: 20 },
    { x: 0, z: 600, floor: 4, halfWidth: 30 },
  ],
  cliffs: [{ s: 260, drop: 8 }],
  wallHeight: 30,
  wallRamp: 25,
  startS: 20,
  coastS: 540,
  finishS: 560,
  obstacles: [],
  decor: { sceneryTreeDensity: 8, bushDensity: 4, grassTuftDensity: 20, pebbleDensity: 6 },
  theme,
});

const terrains = new Map<string, GeneratedTerrain>();
const terrainFor = (theme: LevelTheme | undefined): GeneratedTerrain => {
  const key = theme ?? 'none';
  let t = terrains.get(key);
  if (!t) terrains.set(key, (t = createTerrain(level(theme))));
  return t;
};

interface FaceStats {
  rockRB: number;
  grassSat: number;
  white: number;
  whiteBelowSnow: number;
  faces: number;
}

/** Mean colours of steep (rock) and gentle grassy faces of the terrain mesh. */
function faceStats(t: GeneratedTerrain): FaceStats {
  const chunks = buildTerrainChunks(t);
  let rr = 0;
  let rb = 0;
  let satSum = 0;
  let satN = 0;
  let white = 0;
  let whiteBelow = 0;
  let faces = 0;
  const hsl = { h: 0, s: 0, l: 0 };
  const c = new Color();
  for (const ch of chunks) {
    const pos = ch.geometry.getAttribute('position');
    const nor = ch.geometry.getAttribute('normal');
    const col = ch.geometry.getAttribute('color');
    for (let v = 0; v < pos.count; v += 3) {
      faces++;
      const ny = nor.getY(v);
      const slope = Math.hypot(nor.getX(v), nor.getZ(v)) / Math.max(ny, 1e-6);
      const r = col.getX(v);
      const g = col.getY(v);
      const b = col.getZ(v);
      const yMid = (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3;
      if (Math.min(r, g, b) > 0.7) {
        white++;
        if (yMid < t.snowLine - 1) whiteBelow++;
      }
      if (slope > 1.6) {
        rr += r;
        rb += b;
      } else if (slope < 0.2 && yMid > t.level.seaLevel + 4 && g > r && g > b) {
        c.setRGB(r, g, b);
        c.getHSL(hsl);
        satSum += hsl.s;
        satN++;
      }
    }
    ch.geometry.dispose();
  }
  return {
    rockRB: rr / Math.max(rb, 1e-6),
    grassSat: satSum / Math.max(1, satN),
    white,
    whiteBelowSnow: whiteBelow,
    faces,
  };
}

describe('themes: data', () => {
  it('defines all five themes with complete, valid palettes', () => {
    expect([...LEVEL_THEMES].sort()).toEqual(['alpine', 'canyon', 'industrial', 'meadow', 'town']);
    for (const id of LEVEL_THEMES) {
      const th = THEMES[id];
      expect(th.id).toBe(id);
      for (const v of Object.values(th.terrain)) expect(v, `${id} terrain`).toMatch(HEX);
      for (const v of Object.values(th.scenery)) expect(v, `${id} scenery`).toMatch(HEX);
      for (const v of th.rockBands) expect(v).toMatch(HEX);
      expect(th.rockBands.length).toBeGreaterThanOrEqual(2);
      for (const k of ['grass', 'rock', 'rockWarm', 'snow', 'sand', 'seabed'] as const) {
        expect(th.backdrop[k]).toMatch(HEX);
      }
      for (const v of Object.values(th.decor)) {
        if (typeof v === 'number') expect(Number.isFinite(v) && v >= 0).toBe(true);
      }
    }
  });

  it('keeps meadow (the default) identical to the original look', () => {
    expect(themeOf(level1).id).toBe('meadow');
    expect(themeOf(undefined).id).toBe('meadow');
    const m = THEMES.meadow;
    // The colours level 1 shipped with before themes existed.
    const original = {
      grass: '#5BD43A',
      grassDeep: '#3DBB2F',
      grassAccent: '#C8F04A',
      rockGrey: '#4A4A55',
      rockBrown: '#6B5040',
      rockDark: '#383842',
      sand: '#EBD08E',
      sandWet: '#C9AC6E',
      seabed: '#2C8F88',
      seabedDeep: '#17566E',
    };
    expect(m.terrain).toMatchObject(original);
    expect(TERRAIN_PALETTE).toMatchObject(original);
    expect(m.rockBands).toEqual([original.rockGrey, original.rockBrown]);
    expect(m.scenery).toMatchObject({
      trunk: '#6B4A30',
      coniferLow: '#16884A',
      bush: '#43B935',
      pebble: '#8C8C99',
    });
    for (const [k, v] of Object.entries(m.scenery)) {
      expect(SCENERY_PALETTE[k as keyof typeof m.scenery], k).toBe(v);
    }
    expect(m.backdrop).toMatchObject({ grass: '#46B238', rock: '#4E4E5E', snow: '#EEF7FF', heightScale: 1 });
    expect(m.decor.trees).toBe(1);
    expect(m.snow).toBeUndefined();
  });

  it('gives each theme its own character', () => {
    const lum = (hex: string): Color => new Color(hex);
    const hslOf = (hex: string): { h: number; s: number; l: number } =>
      lum(hex).getHSL({ h: 0, s: 0, l: 0 });
    // Canyon: warm red/orange strata, drier grass.
    for (const b of THEMES.canyon.rockBands) {
      const c = lum(b);
      expect(c.r, b).toBeGreaterThan(c.b * 2);
    }
    expect(THEMES.canyon.terrain.grass).not.toBe(THEMES.meadow.terrain.grass);
    // Alpine: snow, grey rock.
    expect(THEMES.alpine.snow).toBeDefined();
    expect(hslOf(THEMES.alpine.terrain.rockGrey).s).toBeLessThan(0.2);
    // Industrial: greyer, less saturated greens than the meadow; still green.
    expect(hslOf(THEMES.industrial.terrain.grass).s).toBeLessThan(hslOf(THEMES.meadow.terrain.grass).s);
    expect(lum(THEMES.industrial.terrain.grass).g).toBeGreaterThan(lum(THEMES.industrial.terrain.grass).b);
    // Town: tidy green meadows with mown stripes.
    expect(THEMES.town.stripes).toBeGreaterThan(0);
    expect(lum(THEMES.town.terrain.grass).g).toBeGreaterThan(lum(THEMES.town.terrain.grass).r);
    // Roads: asphalt in town and industry, gravel elsewhere.
    expect(THEMES.town.roadSurface).toBe('asphalt');
    expect(THEMES.industrial.roadSurface).toBe('asphalt');
    expect(THEMES.meadow.roadSurface).toBe('gravel');
    // Still colourful: every theme's grass is clearly saturated.
    for (const id of LEVEL_THEMES) expect(hslOf(THEMES[id].terrain.grass).s, id).toBeGreaterThan(0.25);
  });
});

describe('themes: terrain colours', () => {
  const stats = new Map<string, FaceStats>();
  const statsFor = (theme: LevelTheme | undefined): FaceStats => {
    const key = theme ?? 'none';
    let s = stats.get(key);
    if (!s) stats.set(key, (s = faceStats(terrainFor(theme))));
    return s;
  };

  it('does not change heights, only colours', () => {
    const plainHeights = Array.from(terrainFor(undefined).grid.heights);
    expect(Array.from(terrainFor('canyon').grid.heights)).toEqual(plainHeights);
  });

  it('colours canyon rock warm red/orange and alpine high ground with snow', () => {
    const meadow = statsFor('meadow');
    const canyon = statsFor('canyon');
    expect(canyon.rockRB).toBeGreaterThan(meadow.rockRB * 2);
    const alpine = statsFor('alpine');
    expect(terrainFor('alpine').snowLine).toBeLessThan(terrainFor('alpine').startPos.y + 40);
    expect(alpine.white).toBeGreaterThan(alpine.faces * 0.03);
    expect(alpine.whiteBelowSnow).toBe(0);
    expect(meadow.white).toBe(0);
    expect(terrainFor('meadow').snowLine).toBe(Infinity);
  });

  it('paints roads (asphalt in town, gravel in the meadow) and ramp kickers in the mesh', () => {
    const features: TerrainFeature[] = [
      { type: 'road', s0: 100, s1: 200, d: 8, width: 6 },
      { type: 'ramp', s: 380, d: 0, width: 12, length: 16, height: 3 },
    ];
    const colourAt = (t: GeneratedTerrain, s: number, d: number): number[] => {
      const w = t.course.toWorld(s, d);
      let best = Infinity;
      let rgb: number[] = [];
      for (const ch of buildTerrainChunks(t)) {
        const pos = ch.geometry.getAttribute('position');
        const col = ch.geometry.getAttribute('color');
        for (let v = 0; v < pos.count; v += 3) {
          const cx = (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3;
          const cz = (pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2)) / 3;
          const dist = Math.hypot(cx - w.x, cz - w.z);
          if (dist < best) [best, rgb] = [dist, [col.getX(v), col.getY(v), col.getZ(v)]];
        }
        ch.geometry.dispose();
      }
      return rgb;
    };
    const near = (rgb: number[], hex: string): boolean => {
      const c = new Color(hex);
      return [c.r, c.g, c.b].every((ch, k) => Math.abs(rgb[k] - ch) <= ch * 0.05 + 1e-4);
    };
    const town = createTerrain({ ...level('town'), features });
    expect(near(colourAt(town, 150, 8), THEMES.town.terrain.asphalt)).toBe(true);
    expect(near(colourAt(town, 150, -8), THEMES.town.terrain.asphalt)).toBe(false);
    expect(near(colourAt(town, 374, 0), THEMES.town.terrain.dirt)).toBe(true);
    const meadow = createTerrain({ ...level('meadow'), features });
    expect(near(colourAt(meadow, 150, 8), THEMES.meadow.terrain.gravel)).toBe(true);
  });

  it('makes industrial grass greyer than the meadow', () => {
    expect(statsFor('industrial').grassSat).toBeLessThan(statsFor('meadow').grassSat - 0.05);
    expect(statsFor('town').grassSat).toBeGreaterThan(0.3);
  });
});

describe('themes: decor and scenery', () => {
  it('flavours the decor per theme', () => {
    const counts = (theme: LevelTheme) => {
      const t = terrainFor(theme);
      const d = generateDecor(t, t.level.seed);
      let conifers = 0;
      let aboveSnow = 0;
      for (let i = 0; i < d.trees.count; i++) {
        if (d.trees.variant[i] === 0) conifers++;
        if (d.trees.positions[i * 3 + 1] > t.snowLine) aboveSnow++;
      }
      return { trees: d.trees.count, bushes: d.bushes.count, pebbles: d.pebbles.count, conifers, aboveSnow };
    };
    const meadow = counts('meadow');
    const canyon = counts('canyon');
    const alpine = counts('alpine');
    const town = counts('town');
    const industrial = counts('industrial');
    expect(meadow.trees).toBeGreaterThan(100);
    expect(canyon.trees).toBeLessThan(meadow.trees * 0.5);
    expect(canyon.pebbles).toBeGreaterThan(meadow.pebbles);
    expect(alpine.conifers / alpine.trees).toBeGreaterThan(meadow.conifers / meadow.trees + 0.1);
    expect(alpine.aboveSnow).toBe(0);
    expect(industrial.bushes).toBeGreaterThan(meadow.bushes);
    expect(town.pebbles).toBeLessThan(industrial.pebbles);
  });

  it('builds scenery models in the theme colours', () => {
    const colourOf = (theme: LevelTheme): number[] => {
      const m = createSceneryModels(THEMES[theme].scenery);
      const c = m.bush.getAttribute('color');
      const out = [c.getX(0), c.getY(0), c.getZ(0)];
      for (const g of Object.values(m)) g.dispose();
      return out;
    };
    expect(colourOf('canyon')).not.toEqual(colourOf('meadow'));
    expect(colourOf('meadow')).toEqual(colourOf('meadow'));
  });

  it('shapes and colours the backdrop per theme', () => {
    const top = (theme: LevelTheme): number => {
      const g = buildBackdropGeometry(terrainFor(theme));
      const pos = g.getAttribute('position');
      let max = -Infinity;
      for (let v = 0; v < pos.count; v++) max = Math.max(max, pos.getY(v));
      g.dispose();
      return max;
    };
    expect(top('alpine')).toBeGreaterThan(top('town') * 1.3);
    const warm = buildBackdropGeometry(terrainFor('canyon'));
    const col = warm.getAttribute('color');
    let rSum = 0;
    let bSum = 0;
    for (let v = 0; v < col.count; v++) {
      rSum += col.getX(v);
      bSum += col.getZ(v);
    }
    expect(rSum).toBeGreaterThan(bSum * 2);
    warm.dispose();
  });
});
