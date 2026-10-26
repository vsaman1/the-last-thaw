import { Box3, BufferAttribute, BufferGeometry, Color, Sphere, Vector3 } from 'three';
import type { Terrain } from '../types';
import { gridValue } from '../heightGrid';
import { lerp, smoothstep } from '../math';
import { fbm2, hash2 } from '../rng';
import { classifySurface, isGeneratedTerrain } from './terrain';
import { PAINT } from './features';
import { dirtPatchAt, snowAmount, snowCoverFor, THEMES, themeOf } from './themes';

/**
 * Flat-shaded, vertex-coloured terrain geometry built from the height grid, split into chunks for
 * frustum culling. Triangles are exactly the heightGrid triangulation — (00,10,11) and (00,11,01) —
 * emitted counter-clockwise from above so they face up. Colours follow the level theme (./themes.ts)
 * and the paint features leave (roads, ramp kickers, island and ravine rock).
 */

/** The default ('meadow') terrain palette. */
export const TERRAIN_PALETTE = THEMES.meadow.terrain;

/** Width (m) of one mown stripe on gentle grass in themes with stripes. */
const STRIPE_WIDTH = 6;

export interface TerrainChunk {
  /** Stable key, e.g. "3:5" (chunk column : chunk row). */
  key: string;
  geometry: BufferGeometry;
  /** Grid cell range covered, [ix0, ix1) × [iz0, iz1). */
  ix0: number;
  iz0: number;
  ix1: number;
  iz1: number;
}

type RGB = { r: number; g: number; b: number };

function linear(hex: string): RGB {
  const c = new Color(hex);
  return { r: c.r, g: c.g, b: c.b };
}

/** Builds all chunks. ~64×64 cells each; ~170k triangles for level 1. */
export function buildTerrainChunks(terrain: Terrain, chunkCells = 64): TerrainChunk[] {
  const g = terrain.grid;
  const level = terrain.level;
  const sea = level.seaLevel;
  const seed = level.seed;
  const gen = isGeneratedTerrain(terrain) ? terrain : null;
  const theme = gen ? gen.theme : themeOf(level);
  const snow = gen
    ? gen.snowCover
    : snowCoverFor(level, theme, terrain.course.sampleAt(level.startS).floor);
  const C = theme.terrain;
  const P = {
    grass: linear(C.grass),
    grassDeep: linear(C.grassDeep),
    accent: linear(C.grassAccent),
    dark: linear(C.rockDark),
    sand: linear(C.sand),
    sandWet: linear(C.sandWet),
    seabed: linear(C.seabed),
    seabedDeep: linear(C.seabedDeep),
    snow: linear(C.snow),
    snowShade: linear(C.snowShade),
    dirt: linear(C.dirt),
    asphalt: linear(C.asphalt),
    gravel: linear(C.gravel),
  };
  const bands = theme.rockBands.map(linear);
  const nb = bands.length;
  const strata = theme.bandMode === 'strata';
  const bandBlend = Math.max(1e-3, 0.5 * (1 - theme.bandSharpness));
  const snowMaxSlope = snow.style.maxSlope;
  // Mown stripes run down the valley (course start → end).
  const cs0 = terrain.course.sampleAt(0);
  const cs1 = terrain.course.sampleAt(terrain.course.length);
  const cl = Math.hypot(cs1.x - cs0.x, cs1.z - cs0.z) || 1;
  const stripeX = -(cs1.z - cs0.z) / cl;
  const stripeZ = (cs1.x - cs0.x) / cl;
  const out: RGB = { r: 0, g: 0, b: 0 };
  const mix = (a: RGB, b: RGB, t: number): void => {
    out.r = lerp(a.r, b.r, t);
    out.g = lerp(a.g, b.g, t);
    out.b = lerp(a.b, b.b, t);
  };
  const mixInto = (b: RGB, t: number): void => {
    out.r = lerp(out.r, b.r, t);
    out.g = lerp(out.g, b.g, t);
    out.b = lerp(out.b, b.b, t);
  };

  let cellPatch = NaN;
  let cellBand = NaN;
  let cellDirt = NaN;
  let cellCx = 0;
  let cellCz = 0;
  const mod = (k: number, n: number): number => ((k % n) + n) % n;
  const set = (a: RGB): void => {
    out.r = a.r;
    out.g = a.g;
    out.b = a.b;
  };

  /** Rock colour at height h into `out` (cellBand must be set). */
  const rockColour = (h: number): void => {
    const u = h / theme.bandStep + cellBand;
    if (!strata) {
      const band = u % 2;
      const t = smoothstep(0.75, 1.0, Math.abs((band < 0 ? band + 2 : band) - 1));
      mix(bands[0], bands[nb > 2 ? 1 + mod(Math.round(u / 2), nb - 1) : 1], t);
      return;
    }
    const k = Math.floor(u);
    const f = u - k;
    const cur = bands[mod(k, nb)];
    if (f > 1 - bandBlend) mix(cur, bands[mod(k + 1, nb)], 0.5 * smoothstep(1 - bandBlend, 1, f));
    else if (f < bandBlend) mix(cur, bands[mod(k - 1, nb)], 0.5 * (1 - smoothstep(0, bandBlend, f)));
    else set(cur);
  };

  /** Writes the face colour into `out`; (cx, cz) is the cell centre. */
  const faceColour = (
    cx: number,
    cz: number,
    h: number,
    slope: number,
    wall: number,
    rnd: number,
    paint: number,
  ): void => {
    if (h >= sea && (paint === PAINT.asphalt || paint === PAINT.gravel || paint === PAINT.dirt)) {
      set(paint === PAINT.asphalt ? P.asphalt : paint === PAINT.gravel ? P.gravel : P.dirt);
      const j = 0.96 + 0.08 * rnd;
      out.r *= j;
      out.g *= j;
      out.b *= j;
      return;
    }
    const kind = classifySurface(h, slope, wall, sea, paint);
    const jitter = 0.92 + 0.16 * rnd;
    const snowK = kind !== 'sand' && kind !== 'seabed' ? snowAmount(snow, h, slope, cx, cz, seed, paint) : 0;
    if (snowK >= 1) {
      mix(P.snow, P.snowShade, smoothstep(0.25, snowMaxSlope, slope));
    } else if (kind === 'grass') {
      mix(P.grassDeep, P.grass, 0.45 + 0.55 * rnd);
      // Noise is shared by the two triangles of a cell (computed lazily once per cell).
      if (Number.isNaN(cellPatch)) cellPatch = smoothstep(0.12, 0.42, fbm2(cx / 38, cz / 38, seed + 91, 3));
      mixInto(P.accent, cellPatch * theme.grassPatch);
      mixInto(P.grassDeep, smoothstep(0.25, 0.7, slope) * 0.45);
      if (theme.stripes > 0 && slope < 0.3) {
        // Alternate light and dark bands, like a freshly mown field.
        const k = theme.stripes * 0.6 * (1 - smoothstep(0.1, 0.3, slope));
        const stripe = Math.floor((cx * stripeX + cz * stripeZ) / STRIPE_WIDTH) & 1;
        if (stripe) mixInto(P.accent, k);
        else mixInto(P.grassDeep, k);
      }
      if (theme.dirtPatch > 0) {
        if (Number.isNaN(cellDirt)) cellDirt = dirtPatchAt(theme, cx, cz, seed);
        mixInto(P.dirt, cellDirt);
      }
    } else if (kind === 'rock') {
      if (Number.isNaN(cellBand)) cellBand = 0.9 * fbm2(cx / 55, cz / 55, seed + 93, 2);
      rockColour(h);
      if (slope > 2.2) mixInto(P.dark, 0.35);
    } else if (kind === 'sand') {
      mix(P.sandWet, P.sand, smoothstep(sea + 0.1, sea + 1.4, h));
    } else {
      mix(P.seabed, P.seabedDeep, smoothstep(sea - 1, sea - 12, h));
    }
    if (snowK > 0 && snowK < 1) {
      // The soft rim of snow a level brought down (LevelDef.snow): melt into the ground colour.
      const t = smoothstep(0.25, snowMaxSlope, slope);
      out.r = lerp(out.r, lerp(P.snow.r, P.snowShade.r, t), snowK);
      out.g = lerp(out.g, lerp(P.snow.g, P.snowShade.g, t), snowK);
      out.b = lerp(out.b, lerp(P.snow.b, P.snowShade.b, t), snowK);
    }
    out.r *= jitter;
    out.g *= jitter;
    out.b *= jitter;
  };

  const wallAt = (ix: number, iz: number): number => {
    if (!gen) return 0;
    const cx = ix < 0 ? 0 : ix >= g.cols ? g.cols - 1 : ix;
    const cz = iz < 0 ? 0 : iz >= g.rows ? g.rows - 1 : iz;
    return gen.wallness[cz * g.cols + cx];
  };

  const paintAt = (ix: number, iz: number): number => (gen ? gen.paint[iz * g.cols + ix] : PAINT.none);
  /** The paint at least two of a triangle's three vertices share (else none). */
  const facePaint = (a: number, b: number, q: number): number => (a === b || a === q ? a : b === q ? b : 0);

  const chunks: TerrainChunk[] = [];
  const cellsX = g.cols - 1;
  const cellsZ = g.rows - 1;
  const c = g.cellSize;
  for (let cz0 = 0, rowIdx = 0; cz0 < cellsZ; cz0 += chunkCells, rowIdx++) {
    for (let cx0 = 0, colIdx = 0; cx0 < cellsX; cx0 += chunkCells, colIdx++) {
      const cx1 = Math.min(cellsX, cx0 + chunkCells);
      const cz1 = Math.min(cellsZ, cz0 + chunkCells);
      const cells = (cx1 - cx0) * (cz1 - cz0);
      const pos = new Float32Array(cells * 18);
      const nor = new Float32Array(cells * 18);
      const col = new Float32Array(cells * 18);
      let o = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      const emit = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        qx: number,
        qy: number,
        qz: number,
        wall: number,
        rnd: number,
        paint: number,
      ): void => {
        // Face normal of (a, b, q).
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = qx - ax;
        const vy = qy - ay;
        const vz = qz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const slope = ny > 1e-6 ? Math.sqrt(nx * nx + nz * nz) / ny : 1e6;
        faceColour(cellCx, cellCz, (ay + by + qy) / 3, slope, wall, rnd, paint);
        pos[o] = ax;
        pos[o + 1] = ay;
        pos[o + 2] = az;
        pos[o + 3] = bx;
        pos[o + 4] = by;
        pos[o + 5] = bz;
        pos[o + 6] = qx;
        pos[o + 7] = qy;
        pos[o + 8] = qz;
        for (let k = 0; k < 9; k += 3) {
          nor[o + k] = nx;
          nor[o + k + 1] = ny;
          nor[o + k + 2] = nz;
          col[o + k] = out.r;
          col[o + k + 1] = out.g;
          col[o + k + 2] = out.b;
        }
        o += 9;
      };
      for (let iz = cz0; iz < cz1; iz++) {
        const z0 = g.originZ + iz * c;
        const z1 = z0 + c;
        for (let ix = cx0; ix < cx1; ix++) {
          const x0 = g.originX + ix * c;
          const x1 = x0 + c;
          const h00 = gridValue(g, ix, iz);
          const h10 = gridValue(g, ix + 1, iz);
          const h11 = gridValue(g, ix + 1, iz + 1);
          const h01 = gridValue(g, ix, iz + 1);
          minY = Math.min(minY, h00, h10, h11, h01);
          maxY = Math.max(maxY, h00, h10, h11, h01);
          const w00 = wallAt(ix, iz);
          const w11 = wallAt(ix + 1, iz + 1);
          const wA = (w00 + wallAt(ix + 1, iz) + w11) / 3;
          const wB = (w00 + w11 + wallAt(ix, iz + 1)) / 3;
          cellCx = x0 + 0.5 * c;
          cellCz = z0 + 0.5 * c;
          cellPatch = NaN;
          cellBand = NaN;
          cellDirt = NaN;
          const p00 = paintAt(ix, iz);
          const p11 = paintAt(ix + 1, iz + 1);
          const pA = facePaint(p00, p11, paintAt(ix + 1, iz));
          const pB = facePaint(p00, p11, paintAt(ix, iz + 1));
          // (00, 11, 10) == heightGrid triangle (00,10,11), wound to face up.
          emit(x0, h00, z0, x1, h11, z1, x1, h10, z0, wA, hash2(ix * 2, iz, seed), pA);
          // (00, 01, 11) == heightGrid triangle (00,11,01).
          emit(x0, h00, z0, x0, h01, z1, x1, h11, z1, wB, hash2(ix * 2 + 1, iz, seed), pB);
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new BufferAttribute(nor, 3));
      geometry.setAttribute('color', new BufferAttribute(col, 3));
      const box = new Box3(
        new Vector3(g.originX + cx0 * c, minY, g.originZ + cz0 * c),
        new Vector3(g.originX + cx1 * c, maxY, g.originZ + cz1 * c),
      );
      geometry.boundingBox = box;
      geometry.boundingSphere = box.getBoundingSphere(new Sphere());
      chunks.push({ key: `${colIdx}:${rowIdx}`, geometry, ix0: cx0, iz0: cz0, ix1: cx1, iz1: cz1 });
    }
  }
  return chunks;
}
