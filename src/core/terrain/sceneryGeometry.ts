import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
} from 'three';
import { THEMES, type SceneryColours } from './themes';

export { buildBackdropGeometry, type BackdropOptions } from './backdrop';

/**
 * Low-poly scenery models (non-indexed, flat normals, baked vertex colours). Colours follow the level
 * theme (./themes.ts). The world around the level (the backdrop) lives in ./backdrop.ts.
 */

const MEADOW = THEMES.meadow;

/** The default ('meadow') scenery and backdrop colours. */
export const SCENERY_PALETTE = {
  ...MEADOW.scenery,
  backdropGrass: MEADOW.backdrop.grass,
  backdropRock: MEADOW.backdrop.rock,
  backdropRockWarm: MEADOW.backdrop.rockWarm,
  backdropSnow: MEADOW.backdrop.snow,
  backdropSand: MEADOW.backdrop.sand,
  backdropSeabed: MEADOW.backdrop.seabed,
} as const;

interface Part {
  geometry: BufferGeometry;
  color: string;
}

/** Merge parts into one non-indexed geometry with flat normals and per-part vertex colours. */
function mergeParts(parts: Part[]): BufferGeometry {
  const flat = parts.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    return { g, src: p.geometry, color: new Color(p.color) };
  });
  const total = flat.reduce((n, f) => n + f.g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const f of flat) {
    const a = f.g.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      pos[o] = a.getX(i);
      pos[o + 1] = a.getY(i);
      pos[o + 2] = a.getZ(i);
      col[o] = f.color.r;
      col[o + 1] = f.color.g;
      col[o + 2] = f.color.b;
      o += 3;
    }
    if (f.g !== f.src) f.g.dispose();
    f.src.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface SceneryModels {
  conifer: BufferGeometry;
  broadleaf: BufferGeometry;
  bush: BufferGeometry;
  tuft: BufferGeometry;
  pebble: BufferGeometry;
}

/**
 * Model space: base at y = 0, +Y up, roughly 1 unit ≈ 1 m. Colours default to the meadow theme;
 * pass a theme's `scenery` colours for another look. Caller disposes.
 */
export function createSceneryModels(colours: SceneryColours = MEADOW.scenery): SceneryModels {
  const P = colours;
  const conifer = mergeParts([
    { geometry: new CylinderGeometry(0.2, 0.3, 1.4, 5).translate(0, 0.7, 0), color: P.trunk },
    { geometry: new ConeGeometry(1.9, 2.8, 7).translate(0, 2.3, 0), color: P.coniferLow },
    { geometry: new ConeGeometry(1.45, 2.3, 7).translate(0, 3.6, 0), color: P.coniferMid },
    { geometry: new ConeGeometry(0.95, 1.9, 7).translate(0, 4.8, 0), color: P.coniferTop },
  ]);
  const broadleaf = mergeParts([
    { geometry: new CylinderGeometry(0.22, 0.32, 1.9, 5).translate(0, 0.95, 0), color: P.trunk },
    { geometry: new IcosahedronGeometry(1.8, 0).scale(1, 0.85, 1).translate(0, 3.0, 0), color: P.broadleaf },
    {
      geometry: new IcosahedronGeometry(1.15, 0).translate(0.8, 3.7, 0.35),
      color: P.broadleafLight,
    },
  ]);
  const bush = mergeParts([
    { geometry: new IcosahedronGeometry(0.85, 0).scale(1.25, 0.7, 1).translate(0, 0.4, 0), color: P.bush },
  ]);
  const blade = (x: number, z: number, tilt: number, h: number, color: string): Part => ({
    geometry: new ConeGeometry(0.07, h, 3)
      .translate(0, h / 2, 0)
      .rotateZ(tilt)
      .rotateY(x * 3 + z)
      .translate(x, 0, z),
    color,
  });
  const tuft = mergeParts([
    blade(0, 0, 0.1, 0.45, P.tuft),
    blade(0.09, 0.05, -0.35, 0.38, P.tuftDeep),
    blade(-0.08, 0.06, 0.4, 0.34, P.tuft),
    blade(0.02, -0.09, -0.15, 0.3, P.tuftDeep),
  ]);
  const pebble = mergeParts([
    {
      geometry: new DodecahedronGeometry(0.28, 0).scale(1, 0.55, 0.8).translate(0, 0.08, 0),
      color: P.pebble,
    },
  ]);
  return { conifer, broadleaf, bush, tuft, pebble };
}
