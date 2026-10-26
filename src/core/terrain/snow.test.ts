import { describe, expect, it } from 'vitest';
import type { LevelDef, LevelTheme, SnowSettings, TerrainFeature } from '../types';
import { createTerrain, type GeneratedTerrain } from './terrain';
import { buildTerrainChunks } from './terrainGeometry';
import { generateDecor } from './decor';
import { PAINT } from './features';
import { isSnowAt, snowCoverAt, snowLineFor, THEMES } from './themes';

/**
 * LevelDef.snow: snow brought down onto the playable floor (glacier and summit levels). Colours and
 * decor only; levels without it look exactly as before.
 */

const features: TerrainFeature[] = [
  { type: 'road', s0: 100, s1: 200, d: 8, width: 6 },
  { type: 'island', s0: 300, s1: 360, d: -6, width: 8, height: 8 },
  { type: 'ridge', points: [{ s: 420, d: -15 }, { s: 470, d: 10 }], width: 14, height: 3, profile: 'mound' },
  { type: 'ramp', s: 230, d: 0, width: 12, length: 16, height: 3 },
];

const level = (theme: LevelTheme, snow?: SnowSettings): LevelDef => ({
  id: `snow-${theme}-${JSON.stringify(snow ?? null)}`,
  index: 99,
  name: 'Snow',
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
  features,
  theme,
  ...(snow ? { snow } : {}),
});

interface Face {
  x: number;
  z: number;
  y: number;
  slope: number;
  white: boolean;
  rgb: [number, number, number];
}

function faces(t: GeneratedTerrain): Face[] {
  const out: Face[] = [];
  for (const ch of buildTerrainChunks(t)) {
    const pos = ch.geometry.getAttribute('position');
    const nor = ch.geometry.getAttribute('normal');
    const col = ch.geometry.getAttribute('color');
    for (let v = 0; v < pos.count; v += 3) {
      const r = col.getX(v);
      const g = col.getY(v);
      const b = col.getZ(v);
      out.push({
        x: (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3,
        z: (pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2)) / 3,
        y: (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3,
        slope: Math.hypot(nor.getX(v), nor.getZ(v)) / Math.max(nor.getY(v), 1e-6),
        white: Math.min(r, g, b) > 0.7,
        rgb: [r, g, b],
      });
    }
    ch.geometry.dispose();
  }
  return out;
}

/** Faces on the floor (|d| < halfWidth − 2) between s0 and s1, with their course coordinates. */
type FloorFace = Face & { s: number; d: number };

function floorFaces(t: GeneratedTerrain, list: Face[], s0 = 30, s1 = 520): FloorFace[] {
  const out: FloorFace[] = [];
  for (const f of list) {
    const p = t.course.project(f.x, f.z);
    if (p.s < s0 || p.s > s1 || Math.abs(p.d) > t.course.halfWidthAt(p.s) - 2) continue;
    out.push({ ...f, s: p.s, d: p.d });
  }
  return out;
}

describe('snow on the floor (LevelDef.snow)', () => {
  const plain = createTerrain(level('alpine'));
  const snowy = createTerrain(level('alpine', { line: 0 }));
  const plainFaces = faces(plain);
  const snowyFaces = faces(snowy);

  it('changes nothing for a level without it (the theme’s snow, face for face)', () => {
    // A line above the theme's own changes nothing either.
    const high = createTerrain(level('alpine', { line: 5000 }));
    expect(high.snowLine).toBe(plain.snowLine);
    expect(faces(high).map((f) => f.rgb)).toEqual(plainFaces.map((f) => f.rgb));
    // The cover reduces to isSnowAt without LevelDef.snow.
    const cover = plain.snowCover;
    expect(cover.line).toBe(snowLineFor(THEMES.alpine, plain.course.floorAt(20), 0));
    for (let i = 0; i < 2000; i++) {
      const x = -200 + ((i * 37) % 400);
      const z = -80 + ((i * 53) % 720);
      const h = cover.line - 20 + ((i * 7) % 60);
      const slope = ((i * 13) % 15) / 10;
      for (const paint of [PAINT.none, PAINT.rock]) {
        const was = isSnowAt(THEMES.alpine, cover.line, h, slope, x, z, 11);
        expect(snowCoverAt(cover, h, slope, x, z, 11, paint)).toBe(was);
      }
    }
  });

  it('is colours only: heights and surfaces (friction) are untouched', () => {
    expect(Array.from(snowy.grid.heights)).toEqual(Array.from(plain.grid.heights));
    for (let s = 40; s < 520; s += 7) {
      for (const d of [-15, -5, 0, 8, 15]) {
        const w = plain.course.toWorld(s, d);
        expect(snowy.surfaceAt(w.x, w.z)).toBe(plain.surfaceAt(w.x, w.z));
      }
    }
  });

  it('whitens the floor down to its line but keeps roads, the kicker, rock and the beach', () => {
    const floor = floorFaces(snowy, snowyFaces);
    const paint = (f: Face): number => snowy.paintAt(f.x, f.z);
    // Gentle unpainted floor above the ragged edge (alpine: up to 14 m) is snow.
    const open = floor.filter((f) => f.slope < 0.5 && paint(f) === PAINT.none && f.y > 14 + 1);
    expect(open.length).toBeGreaterThan(1000);
    expect(open.filter((f) => f.white).length / open.length).toBeGreaterThan(0.97);
    // Before: the same floor was green (the alpine line is start floor + 18 m).
    const before = floorFaces(plain, plainFaces).filter((f) => f.slope < 0.5 && f.y > 15 && f.y < 60);
    expect(before.filter((f) => f.white).length).toBe(0);
    // Roads, the kicker's dirt and painted rock (the island) never turn white (faces well inside).
    const inside: [string, (f: (typeof floor)[number]) => boolean][] = [
      ['road', (f) => f.s > 110 && f.s < 190 && Math.abs(f.d - 8) < 2],
      ['kicker', (f) => f.s > 222 && f.s < 229 && Math.abs(f.d) < 4],
      ['island', (f) => f.s > 310 && f.s < 350 && Math.abs(f.d + 6) < 2],
    ];
    for (const [name, on] of inside) {
      const painted = floor.filter(on);
      expect(painted.length, name).toBeGreaterThan(10);
      expect(painted.filter((f) => f.white).length, name).toBe(0);
    }
    // The mound ridge is snow; the beach is sand.
    const mound = floor.filter((f) => f.s > 430 && f.s < 460 && snowy.featureIndexAt(f.x, f.z) === 2);
    expect(mound.filter((f) => f.white).length / mound.length).toBeGreaterThan(0.9);
    const beach = snowyFaces.filter((f) => f.y > 0.3 && f.y < 2);
    expect(beach.length).toBeGreaterThan(20);
    expect(beach.filter((f) => f.white).length).toBe(0);
  });

  it('stops at its line (ragged edge above it) and can lie in patches', () => {
    const line = 40;
    const mid = createTerrain(level('alpine', { line }));
    const floor = floorFaces(mid, faces(mid)).filter((f) => f.slope < 0.5);
    expect(floor.filter((f) => f.white && f.y < line).length).toBe(0);
    const high = floor.filter((f) => f.y > line + 15 && mid.paintAt(f.x, f.z) === PAINT.none);
    expect(high.filter((f) => f.white).length / high.length).toBeGreaterThan(0.97);
    const patchy = createTerrain(level('alpine', { line: 0, floor: 'patchy' }));
    const open = floorFaces(patchy, faces(patchy)).filter(
      (f) => f.slope < 0.5 && f.y > 15 && patchy.paintAt(f.x, f.z) === PAINT.none,
    );
    const share = open.filter((f) => f.white).length / open.length;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.85);
  });

  it('works on a theme without snow of its own', () => {
    const t = createTerrain(level('meadow', { line: 30 }));
    const open = floorFaces(t, faces(t)).filter(
      (f) => f.slope < 0.5 && f.y > 30 + 15 && t.paintAt(f.x, f.z) === PAINT.none,
    );
    expect(open.filter((f) => f.white).length / open.length).toBeGreaterThan(0.97);
  });

  it('keeps the scenery forests, but no bushes or grass tufts on the snow', () => {
    const d = generateDecor(snowy, snowy.level.seed);
    const base = generateDecor(plain, plain.level.seed);
    expect(d.trees.count).toBe(base.trees.count);
    expect(d.tufts.count).toBeLessThan(base.tufts.count * 0.5);
    const cover = snowy.snowCover;
    const onSnow = (batch: typeof d.tufts): number => {
      let n = 0;
      for (let i = 0; i < batch.count; i++) {
        const x = batch.positions[i * 3];
        const y = batch.positions[i * 3 + 1];
        const z = batch.positions[i * 3 + 2];
        const g = snowy.gradientAt(x, z);
        if (snowCoverAt(cover, y, Math.hypot(g.dx, g.dz), x, z, 11, snowy.paintAt(x, z))) n++;
      }
      return n;
    };
    expect(onSnow(d.tufts)).toBe(0);
    expect(onSnow(d.bushes)).toBe(0);
  });
});
