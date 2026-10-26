import type { LevelDef, LevelTheme } from '../types';
import { smoothstep } from '../math';
import { fbm2 } from '../rng';
import { PAINT } from './features';

/**
 * Level themes: terrain palette, decor flavour, scenery model colours and backdrop style.
 * Themes change colours and decor only — never heights — so a level plays the same in any theme.
 * 'meadow' is the default and reproduces the original look of level 1 exactly.
 */

/** sRGB hex colours of the terrain mesh. */
export interface TerrainColours {
  grass: string;
  grassDeep: string;
  grassAccent: string;
  rockGrey: string;
  rockBrown: string;
  rockDark: string;
  sand: string;
  sandWet: string;
  seabed: string;
  seabedDeep: string;
  snow: string;
  snowShade: string;
  /** Bare ground patches on grass (canyon, industrial) and the ramp-kicker surface. */
  dirt: string;
  asphalt: string;
  gravel: string;
}

/** sRGB hex colours baked into the low-poly scenery models. */
export interface SceneryColours {
  trunk: string;
  coniferLow: string;
  coniferMid: string;
  coniferTop: string;
  broadleaf: string;
  broadleafLight: string;
  bush: string;
  tuft: string;
  tuftDeep: string;
  pebble: string;
}

export interface DecorFlavour {
  /** Multipliers on LevelDef.decor densities. */
  trees: number;
  bushes: number;
  tufts: number;
  pebbles: number;
  /** Fraction of conifers among scenery trees at low and at high elevation. */
  coniferLow: number;
  coniferHigh: number;
  /** Scenery tree scale = treeScaleMin + rnd × treeScaleRange. */
  treeScaleMin: number;
  treeScaleRange: number;
  /** Scale multiplier for pebbles (canyon "pebbles" are proper rocks). */
  pebbleScale: number;
}

export interface BackdropStyle {
  grass: string;
  rock: string;
  rockWarm: string;
  snow: string;
  sand: string;
  seabed: string;
  /** Multiplier on the silhouette heights of the far mountains. */
  heightScale: number;
  /** Height above sea level (m) where backdrop snow begins (Infinity = none). */
  snowAt: number;
  /** Step (m) the silhouettes are terraced into (flat-topped mesas); 0 = smooth ridges. */
  terrace: number;
  /** Horizontal size (m) of the surrounding ranges. */
  rangeScale: number;
  /** 0 = rolling hills … 1 = sharp ridged peaks. */
  ridge: number;
  /** 0..1 share of the gentle far grass under dark forest. */
  forest: number;
  /** 0..1 strength of a farmland patchwork on gentle low ground. */
  fields: number;
}

export interface SnowStyle {
  /** The snow line sits this far above the course start floor... */
  aboveStart: number;
  /** ...but never lower than this above sea level (m). */
  minAboveSea: number;
  /** Faces steeper than this stay bare rock / grass. */
  maxSlope: number;
  /** Noise amplitude (m) that makes the snow line ragged (only ever raises it). */
  ragged: number;
}

export interface ThemeDef {
  id: LevelTheme;
  terrain: TerrainColours;
  /** Rock strata colours, cycled by height. */
  rockBands: readonly string[];
  /**
   * 'stripes': rock is rockBands[0] with thin soft stripes of the other colours every 2 × bandStep
   * (the original meadow look). 'strata': layers bandStep thick cycling through every colour.
   */
  bandMode: 'stripes' | 'strata';
  /** Height (m) of one stratum and how sharp strata edges are (0 = soft blend, 1 = hard edges). */
  bandStep: number;
  bandSharpness: number;
  /** 0..1 amount of light accent patches on grass. */
  grassPatch: number;
  /** 0..1 amount of bare-dirt patches on grass. */
  dirtPatch: number;
  /** 0..1 strength of mown stripes on gentle grass (tidy town meadows). */
  stripes: number;
  snow?: SnowStyle;
  /** Default surface of 'road' features without an explicit surface. */
  roadSurface: 'asphalt' | 'gravel';
  scenery: SceneryColours;
  /** Per-instance tint extremes for trees and bushes (white = no tint). */
  tintWarm: string;
  tintCool: string;
  decor: DecorFlavour;
  backdrop: BackdropStyle;
}

const ROAD = { asphalt: '#3E434D', gravel: '#B8A98A' } as const;

const meadow: ThemeDef = {
  id: 'meadow',
  terrain: {
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
    snow: '#EEF7FF',
    snowShade: '#CFE2F2',
    dirt: '#9C6B45',
    ...ROAD,
  },
  rockBands: ['#4A4A55', '#6B5040'],
  bandMode: 'stripes',
  bandStep: 4.2,
  bandSharpness: 0,
  grassPatch: 0.7,
  dirtPatch: 0,
  stripes: 0,
  roadSurface: 'gravel',
  scenery: {
    trunk: '#6B4A30',
    coniferLow: '#16884A',
    coniferMid: '#1FA257',
    coniferTop: '#2DBD63',
    broadleaf: '#5BD43A',
    broadleafLight: '#8BE24A',
    bush: '#43B935',
    tuft: '#C8F04A',
    tuftDeep: '#8FDC3C',
    pebble: '#8C8C99',
  },
  tintWarm: '#FFF6B0',
  tintCool: '#B8FFE8',
  decor: {
    trees: 1,
    bushes: 1,
    tufts: 1,
    pebbles: 1,
    coniferLow: 0.35,
    coniferHigh: 0.85,
    treeScaleMin: 1,
    treeScaleRange: 0.9,
    pebbleScale: 1,
  },
  backdrop: {
    grass: '#46B238',
    rock: '#4E4E5E',
    rockWarm: '#64503F',
    snow: '#EEF7FF',
    sand: '#E3C987',
    seabed: '#1F6878',
    heightScale: 1,
    snowAt: 340,
    terrace: 0,
    rangeScale: 950,
    ridge: 0.7,
    forest: 0.35,
    fields: 0.12,
  },
};

const canyon: ThemeDef = {
  id: 'canyon',
  terrain: {
    grass: '#B5B04A',
    grassDeep: '#8E9A3A',
    grassAccent: '#DCC66A',
    rockGrey: '#C2502E',
    rockBrown: '#E07B39',
    rockDark: '#7A2E1E',
    sand: '#F1C98C',
    sandWet: '#CFA36A',
    seabed: '#2C8F88',
    seabedDeep: '#17566E',
    snow: '#FFF4E6',
    snowShade: '#F0DCC4',
    dirt: '#C0703F',
    ...ROAD,
    gravel: '#D2A577',
  },
  rockBands: ['#C2502E', '#E07B39', '#F0B67F', '#9E3B26', '#D8643A'],
  bandMode: 'strata',
  bandStep: 2.6,
  bandSharpness: 0.85,
  grassPatch: 0.45,
  dirtPatch: 0.55,
  stripes: 0,
  roadSurface: 'gravel',
  scenery: {
    trunk: '#7A5034',
    coniferLow: '#5E7F3A',
    coniferMid: '#6E9244',
    coniferTop: '#86A852',
    broadleaf: '#9DAA45',
    broadleafLight: '#C4C25A',
    bush: '#8E9B52',
    tuft: '#E0C870',
    tuftDeep: '#C4A850',
    pebble: '#B5674A',
  },
  tintWarm: '#FFD9A0',
  tintCool: '#F2F0C0',
  decor: {
    trees: 0.22,
    bushes: 0.7,
    tufts: 0.45,
    pebbles: 2.2,
    coniferLow: 0.85,
    coniferHigh: 0.95,
    treeScaleMin: 0.6,
    treeScaleRange: 0.5,
    pebbleScale: 2.4,
  },
  backdrop: {
    grass: '#B39A5C',
    rock: '#B5532F',
    rockWarm: '#D9814A',
    snow: '#F6E2C8',
    sand: '#EBC58A',
    seabed: '#1F6878',
    heightScale: 0.8,
    snowAt: Infinity,
    terrace: 18,
    rangeScale: 650,
    ridge: 0.3,
    forest: 0.04,
    fields: 0,
  },
};

const alpine: ThemeDef = {
  id: 'alpine',
  terrain: {
    grass: '#4CC24A',
    grassDeep: '#2E9E45',
    grassAccent: '#9BE35A',
    rockGrey: '#6E737D',
    rockBrown: '#8A8C94',
    rockDark: '#4B5160',
    sand: '#D9CFB0',
    sandWet: '#B5AA8C',
    seabed: '#2C8F88',
    seabedDeep: '#17566E',
    snow: '#F4FAFF',
    snowShade: '#D6E6F5',
    dirt: '#8C6A4C',
    ...ROAD,
  },
  rockBands: ['#6E737D', '#8A8C94', '#5D626D'],
  bandMode: 'strata',
  bandStep: 5,
  bandSharpness: 0.3,
  grassPatch: 0.5,
  dirtPatch: 0,
  stripes: 0,
  snow: { aboveStart: 18, minAboveSea: 60, maxSlope: 1.1, ragged: 14 },
  roadSurface: 'gravel',
  scenery: {
    trunk: '#5E4030',
    coniferLow: '#0F6E45',
    coniferMid: '#178A50',
    coniferTop: '#22A35C',
    broadleaf: '#4CC23F',
    broadleafLight: '#7FDA4F',
    bush: '#3A9E40',
    tuft: '#A8E05A',
    tuftDeep: '#6FC24A',
    pebble: '#9095A3',
  },
  tintWarm: '#F0FFD0',
  tintCool: '#B8F0FF',
  decor: {
    trees: 1.15,
    bushes: 0.6,
    tufts: 0.9,
    pebbles: 1.4,
    coniferLow: 0.75,
    coniferHigh: 1,
    treeScaleMin: 1.1,
    treeScaleRange: 0.9,
    pebbleScale: 1.3,
  },
  backdrop: {
    grass: '#3FA84A',
    rock: '#6B7280',
    rockWarm: '#8A8C95',
    snow: '#F4FAFF',
    sand: '#D9CFB0',
    seabed: '#1F6878',
    heightScale: 1.5,
    snowAt: 170,
    terrace: 0,
    rangeScale: 1050,
    ridge: 0.95,
    forest: 0.55,
    fields: 0,
  },
};

const town: ThemeDef = {
  id: 'town',
  terrain: {
    grass: '#62D24A',
    grassDeep: '#47BC3E',
    grassAccent: '#A6E85A',
    rockGrey: '#5A5A66',
    rockBrown: '#7A604C',
    rockDark: '#40404A',
    sand: '#EBD08E',
    sandWet: '#C9AC6E',
    seabed: '#2C8F88',
    seabedDeep: '#17566E',
    snow: '#EEF7FF',
    snowShade: '#CFE2F2',
    dirt: '#9C6B45',
    ...ROAD,
  },
  rockBands: ['#5A5A66', '#7A604C'],
  bandMode: 'stripes',
  bandStep: 4.2,
  bandSharpness: 0,
  grassPatch: 0.25,
  dirtPatch: 0,
  stripes: 0.55,
  roadSurface: 'asphalt',
  scenery: {
    trunk: '#6B4A30',
    coniferLow: '#1A8F4C',
    coniferMid: '#24A85B',
    coniferTop: '#33C066',
    broadleaf: '#5FD43F',
    broadleafLight: '#9BE852',
    bush: '#3FB348',
    tuft: '#C8F04A',
    tuftDeep: '#8FDC3C',
    pebble: '#A3A3AE',
  },
  tintWarm: '#FFF6B0',
  tintCool: '#C8FFE0',
  decor: {
    trees: 0.7,
    bushes: 1.2,
    tufts: 0.6,
    pebbles: 0.5,
    coniferLow: 0.15,
    coniferHigh: 0.5,
    treeScaleMin: 0.9,
    treeScaleRange: 0.5,
    pebbleScale: 1,
  },
  backdrop: {
    grass: '#55BF45',
    rock: '#5E5E6E',
    rockWarm: '#706050',
    snow: '#EEF7FF',
    sand: '#E3C987',
    seabed: '#1F6878',
    heightScale: 0.7,
    snowAt: 420,
    terrace: 0,
    rangeScale: 1200,
    ridge: 0.2,
    forest: 0.3,
    fields: 0.75,
  },
};

const industrial: ThemeDef = {
  id: 'industrial',
  terrain: {
    grass: '#8FA55A',
    grassDeep: '#6F8A4B',
    grassAccent: '#B5B377',
    rockGrey: '#5C5E66',
    rockBrown: '#6E6458',
    rockDark: '#3F4148',
    sand: '#C8BC9A',
    sandWet: '#A89C7C',
    seabed: '#3A7F7C',
    seabedDeep: '#1F4F60',
    snow: '#E8EEF2',
    snowShade: '#C8D2DA',
    dirt: '#8A7A62',
    ...ROAD,
  },
  rockBands: ['#5C5E66', '#6E6458', '#50525A'],
  bandMode: 'strata',
  bandStep: 3.6,
  bandSharpness: 0.2,
  grassPatch: 0.35,
  dirtPatch: 0.45,
  stripes: 0,
  roadSurface: 'asphalt',
  scenery: {
    trunk: '#5E4A3A',
    coniferLow: '#3D7048',
    coniferMid: '#4A8052',
    coniferTop: '#5A9460',
    broadleaf: '#7FA048',
    broadleafLight: '#A3B65A',
    bush: '#6F8F48',
    tuft: '#B8B878',
    tuftDeep: '#94985E',
    pebble: '#7D7F88',
  },
  tintWarm: '#F2EBC0',
  tintCool: '#D0E8D8',
  decor: {
    trees: 0.4,
    bushes: 1.6,
    tufts: 1.1,
    pebbles: 1.8,
    coniferLow: 0.3,
    coniferHigh: 0.6,
    treeScaleMin: 0.7,
    treeScaleRange: 0.6,
    pebbleScale: 1.3,
  },
  backdrop: {
    grass: '#7E9258',
    rock: '#5B5D66',
    rockWarm: '#6A635A',
    snow: '#E8EEF2',
    sand: '#C8BC9A',
    seabed: '#2A6070',
    heightScale: 0.8,
    snowAt: Infinity,
    terrace: 0,
    rangeScale: 900,
    ridge: 0.4,
    forest: 0.12,
    fields: 0.3,
  },
};

export const THEMES: Readonly<Record<LevelTheme, ThemeDef>> = { meadow, canyon, alpine, town, industrial };

export const LEVEL_THEMES: readonly LevelTheme[] = Object.keys(THEMES) as LevelTheme[];

/**
 * Whether a level shows any snow: on its own slopes (its theme's snow, or LevelDef.snow) or capping
 * the far ranges (a finite backdrop snowAt). Measured on the backdrop geometry of every level
 * (vertices in the backdrop snow colour, playtest 2): Riverside Town's far ranges carry snow (7,566 of
 * 108,870), Rocky Canyon, Power Valley and Ravine Run none (15–48 sand-coloured vertices by chance).
 */
export function levelHasSnow(level: LevelDef): boolean {
  const theme = themeOf(level);
  return theme.snow !== undefined || level.snow !== undefined || Number.isFinite(theme.backdrop.snowAt);
}

/** The theme of a level (or a theme id); 'meadow' when none is given. */
export function themeOf(src: LevelDef | LevelTheme | undefined): ThemeDef {
  const id = typeof src === 'string' ? src : src?.theme;
  return THEMES[id ?? 'meadow'] ?? meadow;
}

/**
 * Absolute snow line (y) for a theme, given the course start floor and sea level; Infinity when the
 * theme has no snow.
 */
export function snowLineFor(theme: ThemeDef, startFloor: number, seaLevel: number): number {
  const s = theme.snow;
  return s ? Math.max(seaLevel + s.minAboveSea, startFloor + s.aboveStart) : Infinity;
}

/**
 * Where a level's snow lies (LevelDef.snow resolved against its theme, see snowCoverFor). Colours
 * and decor only: the iceberg slides on snow exactly as on grass.
 */
export interface SnowCover {
  /** Absolute snow line (y; Infinity = no snow): snow on faces up to style.maxSlope above it. */
  line: number;
  /**
   * The theme's own snow line (Infinity without one): scenery trees thin out toward it, and below
   * it painted rock (outcrops, ridges, islands, ravines) stays bare rock in the snow.
   */
  natural: number;
  /** Slope limit and ragged edge (the theme's, or alpine's for a theme without snow). */
  style: SnowStyle;
  /** LevelDef.snow.floor === 'patchy': below the natural line snow lies in fields, grass between. */
  patchy: boolean;
}

/**
 * A level's snow: its theme's snow line, or LevelDef.snow.line (default: sea level, i.e. down to the
 * beach) when the level brings the snow down (never up: a line above the theme's own changes
 * nothing). Levels without LevelDef.snow get exactly the theme's snow.
 */
export function snowCoverFor(level: LevelDef, theme: ThemeDef, startFloor: number): SnowCover {
  const natural = snowLineFor(theme, startFloor, level.seaLevel);
  const opt = level.snow;
  const want = opt ? (opt.line ?? level.seaLevel) : natural;
  const line = Number.isFinite(want) ? Math.min(want, natural) : natural;
  return { line, natural, style: theme.snow ?? alpine.snow!, patchy: opt?.floor === 'patchy' };
}

/**
 * How snow-covered (0..1) a face at height h with this slope is; `paint` is the PAINT code there.
 * The theme's own snow has a hard ragged line (isSnowAt); snow a level brought down
 * (LevelDef.snow) melts into the grass over ±SNOW_SOFT m of height at its ragged edge, and its
 * 'patchy' fields have soft rims on frosted grass, so the colours blend instead of stepping cell
 * by cell.
 */
export function snowAmount(
  cover: SnowCover,
  h: number,
  slope: number,
  x: number,
  z: number,
  seed: number,
  paint = 0,
): number {
  const s = cover.style;
  if (h < cover.line - SNOW_SOFT || slope > s.maxSlope) return 0;
  // The line's ragged edge only ever raises it (isSnowAt).
  const edge = s.ragged * (0.5 + 0.5 * fbm2(x / 60, z / 60, seed + 97, 2));
  if (h >= cover.natural + edge) return 1;
  if (!(cover.line < cover.natural)) return 0;
  // Snow the level brought down below the theme's own line: bare rock stays rock.
  if (paint === PAINT.rock) return 0;
  const k = smoothstep(cover.line + edge - SNOW_SOFT, cover.line + edge + SNOW_SOFT, h);
  if (!cover.patchy || k <= 0) return k;
  // Snow fields: patchier near the line, closing up over the next 80 m of height; the grass
  // between them is frosted (0.3 of the snow colour) so fields and grass read as one winter slope.
  const t = 0.12 - 0.3 * smoothstep(cover.line, cover.line + 80, h);
  return k * (0.3 + 0.7 * smoothstep(t - 0.05, t + 0.05, fbm2(x / 36, z / 36, seed + 99, 3)));
}

/** Height band (m) over which snow a level brought down blends into the grass (snowAmount). */
export const SNOW_SOFT = 2;

/** Is a face snow-covered (snowAmount ≥ 0.5)? Decor and tests use this. */
export function snowCoverAt(
  cover: SnowCover,
  h: number,
  slope: number,
  x: number,
  z: number,
  seed: number,
  paint = 0,
): boolean {
  return snowAmount(cover, h, slope, x, z, seed, paint) >= 0.5;
}

/**
 * 0..theme.dirtPatch: bare dirt on grass at (x, z) — exactly 0 when the theme has no dirt patches.
 * Shared by the terrain colouring and the decor (nothing grows on bare patches).
 */
export function dirtPatchAt(theme: ThemeDef, x: number, z: number, seed: number): number {
  if (theme.dirtPatch <= 0) return 0;
  return theme.dirtPatch * smoothstep(0.05, 0.4, fbm2(x / 27, z / 27, seed + 95, 3));
}

/**
 * True if a face at height h with this slope is snow-covered: above the snow line raised by a
 * ragged, never-negative noise offset, and not steeper than the theme allows.
 */
export function isSnowAt(
  theme: ThemeDef,
  snowLine: number,
  h: number,
  slope: number,
  x: number,
  z: number,
  seed: number,
): boolean {
  const s = theme.snow;
  if (!s || h < snowLine || slope > s.maxSlope) return false;
  return h >= snowLine + s.ragged * (0.5 + 0.5 * fbm2(x / 60, z / 60, seed + 97, 2));
}
