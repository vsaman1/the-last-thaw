import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  Color,
  Fog,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { damp } from '../core/math';
import { createRng, rngRange } from '../core/rng';
import { backdropHorizon } from '../core/terrain/backdrop';
import type { LevelDef, LevelTheme, Terrain } from '../core/types';
import { useGameStore } from '../state/gameStore';
import { SUN_DIRECTION } from './Lighting';
import { useRuntime } from './RuntimeContext';
import { conditionSkyLook, useWorldCondition } from './worldCondition';

export const SKY_DEFAULTS = {
  top: '#2A86E8',
  horizon: '#BDF4FF',
  fog: '#C8F2FF',
  sun: '#FFF1D6',
  fogNear: 250,
  fogFar: 1600,
  /** While viewing the whole river after LEVEL COMPLETE the camera sits far out; keep it all clear. */
  viewFogNear: 1000,
  viewFogFar: 3600,
  /** How fast the fog distance (and the clouds fading out of the way) ease between the two (1/s). */
  fogRate: 3,
} as const;

const CLOUDS = {
  /** Clouds per km² of the region they wrap in (16 over level 1's original region), and limits. */
  density: 3.7,
  minCount: 12,
  maxCount: 64,
  puffsPerCloud: 4,
  /**
   * Clouds wrap within the level bounds expanded by this margin (m): wide enough that the river view
   * still has clouds around the river once those in front of it have faded out of the way.
   */
  margin: 1200,
  /** Ground footprint (m) a cloud can hide, before the perspective from the camera grows it. */
  footprint: 90,
  wind: 2.5,
  color: '#CFE2F4',
  /** Emissive lift so undersides stay white-blue instead of taking the green ground bounce. */
  emissive: '#A8C8E6',
  emissiveIntensity: 0.5,
} as const;

/** The wind the clouds drift on (m/s along a unit direction); smoke and steam plumes share it. */
export const WIND = { speed: CLOUDS.wind, x: 0.94, z: 0.34 } as const;

/** The playable area (course ± floor half-width) as a box: where the river can be. */
export interface PlayArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export function playAreaOf(course: Terrain['course']): PlayArea {
  const a = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
  const step = Math.max(5, course.length / 400);
  for (let s = 0; s <= course.length + 1e-6; s += step) {
    const p = course.sampleAt(Math.min(s, course.length));
    a.minX = Math.min(a.minX, p.x - p.halfWidth);
    a.maxX = Math.max(a.maxX, p.x + p.halfWidth);
    a.minZ = Math.min(a.minZ, p.z - p.halfWidth);
    a.maxZ = Math.max(a.maxZ, p.z + p.halfWidth);
    a.minY = Math.min(a.minY, p.floor);
    a.maxY = Math.max(a.maxY, p.floor);
  }
  return a;
}

/** Distance from `cam` to the farthest corner of the play-area box. */
export function farthestInPlayArea(cam: { x: number; y: number; z: number }, a: PlayArea): number {
  let farthest = 0;
  for (const x of [a.minX, a.maxX]) {
    for (const z of [a.minZ, a.maxZ]) {
      for (const y of [a.minY, a.maxY]) {
        farthest = Math.max(farthest, Math.hypot(x - cam.x, y - cam.y, z - cam.z));
      }
    }
  }
  return farthest;
}

/**
 * River-view haze: from the far end of the play area the fog thickens to full over this many times
 * the level's own fog depth (fogFar − fogNear), so the world around the river recedes into the
 * level's air (Power Valley's smog closes in within ~2 km, the alpine air stays clear for ~4 km).
 */
const VIEW_FOG_SPAN = 2.5;
const DEFAULT_VIEW_HAZE = 0.15;

/**
 * True when a cloud centred at c hides part of the play area from the camera: the sight line from the
 * camera through the cloud reaches the play area's mid height inside the area, grown by the cloud's
 * footprint as seen from there. A camera at or below the cloud looks across or up at it (never over
 * the river through it).
 */
export function cloudHidesPlayArea(
  cam: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  a: PlayArea,
  footprint: number = CLOUDS.footprint,
): boolean {
  const y = (a.minY + a.maxY) / 2;
  if (!(cam.y > c.y + 1) || c.y <= y) return false;
  const t = (cam.y - y) / (cam.y - c.y);
  const gx = cam.x + (c.x - cam.x) * t;
  const gz = cam.z + (c.z - cam.z) * t;
  const m = footprint * t;
  return gx > a.minX - m && gx < a.maxX + m && gz > a.minZ - m && gz < a.maxZ + m;
}

/**
 * Fog for the river view. The level keeps its own atmosphere (Power Valley's smog, the canyon haze)
 * while the river stays legible: the fog is `viewHaze` thick at the far end of the play area (none
 * in front of the river) and full VIEW_FOG_SPAN × the level's fog depth beyond it, so the world
 * around recedes into the level's air towards the horizon. Never denser than the old fixed
 * river-view fog (so never denser than in play), and always full by `horizon` (m): before the world
 * around the level ends (see backdropHorizon).
 */
export function riverViewFog(
  cam: { x: number; y: number; z: number },
  a: PlayArea,
  look: { fogNear: number; fogFar: number; viewHaze?: number },
  horizon: number = Infinity,
): { near: number; far: number } {
  const reach = farthestInPlayArea(cam, a);
  const span = VIEW_FOG_SPAN * Math.max(1, look.fogFar - look.fogNear);
  const haze = Math.min(0.45, Math.max(0, look.viewHaze ?? DEFAULT_VIEW_HAZE));
  const far = Math.min(Math.max(SKY_DEFAULTS.viewFogFar, reach + span), HORIZON_FOG * horizon);
  const near = Math.max(SKY_DEFAULTS.viewFogNear, reach - (haze / (1 - haze)) * span);
  return { near: Math.min(near, 0.5 * far), far };
}

/** River-view fog is full by this fraction of the distance to the edge of the world. */
const HORIZON_FOG = 0.9;

/** Everything the sky dome, scene fog and clouds need for one level. */
export interface SkyLook {
  top: string;
  horizon: string;
  fog: string;
  /** Sun disc / glow tint. */
  sun: string;
  fogNear: number;
  fogFar: number;
  cloudColor: string;
  cloudEmissive: string;
  /** Fraction of the cloud set shown (0..1). */
  cloudCover: number;
  /** River view: how thick (0..0.45) the fog is at the far end of the river. */
  viewHaze: number;
}

/** Default sky per level theme; 'meadow' is the original look. */
export const THEME_SKIES: Readonly<Record<LevelTheme, Readonly<SkyLook>>> = {
  meadow: {
    top: SKY_DEFAULTS.top,
    horizon: SKY_DEFAULTS.horizon,
    fog: SKY_DEFAULTS.fog,
    sun: SKY_DEFAULTS.sun,
    fogNear: SKY_DEFAULTS.fogNear,
    fogFar: SKY_DEFAULTS.fogFar,
    cloudColor: CLOUDS.color,
    cloudEmissive: CLOUDS.emissive,
    cloudCover: 1,
    viewHaze: 0.15,
  },
  // Warm, dusty desert air: sandy horizon haze, a paler zenith, few clouds.
  canyon: {
    top: '#3E7FC4',
    horizon: '#F4D9B0',
    fog: '#E8CFA8',
    sun: '#FFE2B0',
    fogNear: 180,
    fogFar: 1300,
    // Cream rather than tan: lit by the warm sun, deeper tints read as brown blobs.
    cloudColor: '#F6E8D8',
    cloudEmissive: '#E2CEB4',
    cloudCover: 0.45,
    viewHaze: 0.2,
  },
  // Thin, clear mountain air: deep blue overhead, bright white-blue horizon, long sight lines.
  alpine: {
    top: '#1F6FE0',
    horizon: '#CFEFFF',
    fog: '#DDF3FF',
    sun: '#FFFFFF',
    fogNear: 320,
    fogFar: 2000,
    cloudColor: '#EEF6FF',
    cloudEmissive: '#C8DCF0',
    cloudCover: 0.75,
    viewHaze: 0.1,
  },
  // Soft, calm daylight: a gentler blue and a pale horizon.
  town: {
    top: '#5A9BE0',
    horizon: '#DCEFF8',
    fog: '#E1EEF2',
    sun: '#FFF0DC',
    fogNear: 220,
    fogFar: 1500,
    cloudColor: '#E2ECF4',
    cloudEmissive: '#BCCDDC',
    cloudCover: 1,
    viewHaze: 0.15,
  },
  // Hazy industrial air: grey-blue sky, beige-grey smog that closes in early.
  industrial: {
    top: '#6C8CA8',
    horizon: '#D2D0C4',
    fog: '#C9C8BE',
    sun: '#FFE6C0',
    fogNear: 140,
    fogFar: 1000,
    cloudColor: '#C4C6C4',
    cloudEmissive: '#9EA2A4',
    cloudCover: 1,
    viewHaze: 0.28,
  },
};

/**
 * The sky for a level: its theme's default look, with the level's own `sky` colours (if any)
 * taking precedence. Haze distance, sun tint and clouds always follow the theme.
 */
export function skyLookFor(level: Pick<LevelDef, 'sky' | 'theme'>): SkyLook {
  const base = THEME_SKIES[level.theme ?? 'meadow'] ?? THEME_SKIES.meadow;
  const sky = level.sky;
  if (!sky) return { ...base };
  return { ...base, top: sky.top, horizon: sky.horizon, fog: sky.fog ?? sky.horizon };
}

const domeVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position * 1000.0 + cameraPosition, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}
`;

// Fog colour at the horizon line (so fully fogged terrain meets the sky seamlessly), the level's
// horizon tint just above it, deep blue overhead, and a soft sun glow with a small HDR disc.
const domeFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uFog, uHorizon, smoothstep(0.0, 0.09, h));
  col = mix(col, uTop, smoothstep(0.04, 0.9, pow(h, 0.75)));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(s, 1200.0) * 1.6 + pow(s, 24.0) * 0.16 + pow(s, 4.0) * 0.05) * step(0.0, d.y + 0.02);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const wrap = (v: number, span: number): number => ((v % span) + span) % span;

interface Puff {
  cloud: number;
  ox: number;
  oy: number;
  oz: number;
  sx: number;
  sy: number;
  sz: number;
  q: Quaternion;
}

/**
 * Gradient sky dome, matching scene fog and a few slowly drifting low-poly clouds. While the player
 * views the whole river (useGameStore.viewingRiver) the fog eases out with the camera distance (the
 * level keeps its haze, thick before the world around it ends) and the clouds the high orbit camera
 * would look through at the river fade out of the way; the others stay. Both return afterwards.
 */
export function Sky() {
  const rt = useRuntime();
  const scene = useThree((s) => s.scene);
  const level = rt.level;
  // Story Mode's world condition hazes the level's own sky (Arcade: none, the look as is).
  const world = useWorldCondition();
  const look = useMemo(() => conditionSkyLook(skyLookFor(level), world), [level, world]);
  const { top, horizon, fog: fogHex, sun } = look;

  const dome = useMemo(() => {
    const geometry = new SphereGeometry(1, 32, 16);
    const material = new ShaderMaterial({
      uniforms: {
        uTop: { value: new Color(top) },
        uHorizon: { value: new Color(horizon) },
        uFog: { value: new Color(fogHex) },
        uSun: { value: new Color(sun) },
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    return { geometry, material };
  }, [top, horizon, fogHex, sun]);

  useEffect(
    () => () => {
      dome.geometry.dispose();
      dome.material.dispose();
    },
    [dome],
  );

  const fogRef = useRef<Fog | null>(null);
  useEffect(() => {
    const prevFog = scene.fog;
    const prevBackground = scene.background;
    const c = new Color(fogHex);
    const fog = new Fog(c, look.fogNear, look.fogFar);
    scene.fog = fog;
    scene.background = c;
    fogRef.current = fog;
    return () => {
      fogRef.current = null;
      scene.fog = prevFog;
      scene.background = prevBackground;
    };
  }, [scene, fogHex, look]);

  const clouds = useMemo(() => {
    const rng = createRng((level.seed ^ 0x51c0) >>> 0);
    const b = level.bounds;
    const heights = rt.terrain.grid.heights;
    let maxH = level.seaLevel;
    for (let i = 0; i < heights.length; i++) if (heights[i] > maxH) maxH = heights[i];
    const region = {
      minX: b.minX - CLOUDS.margin,
      minZ: b.minZ - CLOUDS.margin,
      spanX: b.maxX - b.minX + 2 * CLOUDS.margin,
      spanZ: b.maxZ - b.minZ + 2 * CLOUDS.margin,
    };
    const count = Math.round(
      Math.min(
        CLOUDS.maxCount,
        Math.max(CLOUDS.minCount, (CLOUDS.density * region.spanX * region.spanZ) / 1e6),
      ),
    );
    const base = new Float32Array(count * 3);
    for (let c = 0; c < count; c++) {
      base[c * 3] = region.minX + rng() * region.spanX;
      base[c * 3 + 1] = maxH + rngRange(rng, 90, 230);
      base[c * 3 + 2] = region.minZ + rng() * region.spanZ;
    }
    const puffs: Puff[] = [];
    const up = new Vector3(0, 1, 0);
    for (let c = 0; c < count; c++) {
      const size = rngRange(rng, 0.7, 1.4);
      const yaw = rng() * Math.PI;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      for (let k = 0; k < CLOUDS.puffsPerCloud; k++) {
        const along = (k / (CLOUDS.puffsPerCloud - 1) - 0.5) * 70 * size + rngRange(rng, -8, 8);
        const side = rngRange(rng, -10, 10) * size;
        const mid = 1 - Math.abs(k / (CLOUDS.puffsPerCloud - 1) - 0.5);
        puffs.push({
          cloud: c,
          ox: along * cos - side * sin,
          oy: rngRange(rng, -2, 6) * mid,
          oz: along * sin + side * cos,
          sx: rngRange(rng, 22, 34) * size * (0.6 + mid * 0.6),
          sy: rngRange(rng, 7, 12) * size * (0.6 + mid * 0.6),
          sz: rngRange(rng, 16, 26) * size * (0.6 + mid * 0.6),
          q: new Quaternion().setFromAxisAngle(up, rng() * Math.PI * 2),
        });
      }
    }
    const geometry = new IcosahedronGeometry(1, 0);
    const material = new MeshLambertMaterial({
      color: look.cloudColor,
      emissive: look.cloudEmissive,
      emissiveIntensity: CLOUDS.emissiveIntensity,
      flatShading: true,
      fog: false,
    });
    const mesh = new InstancedMesh(geometry, material, puffs.length);
    // Puffs are stored cloud by cloud, so a sparser sky simply draws the first clouds only.
    const shown = Math.round(count * Math.min(1, Math.max(0, look.cloudCover)));
    mesh.count = shown * CLOUDS.puffsPerCloud;
    mesh.visible = shown > 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    /** Per cloud: 1 shown … 0 faded out of the river view's way (eased). */
    const shownMix = new Float32Array(count).fill(1);
    return { mesh, geometry, material, puffs, base, region, shownMix };
  }, [level, rt.terrain, look]);

  useEffect(
    () => () => {
      clouds.geometry.dispose();
      clouds.material.dispose();
      clouds.mesh.dispose();
    },
    [clouds],
  );

  const scratch = useRef({ m: new Matrix4(), p: new Vector3(), s: new Vector3(), c: new Vector3() });
  /** 0 = normal sky, 1 = river-view sky (eased). */
  const viewMix = useRef(0);
  const playArea = useMemo(() => playAreaOf(rt.terrain.course), [rt.terrain]);
  const windX = WIND.x;
  const windZ = WIND.z;

  useFrame((state, delta) => {
    const S = SKY_DEFAULTS;
    const viewing = rt.phase === 'complete' && useGameStore.getState().viewingRiver;
    let mix = damp(viewMix.current, viewing ? 1 : 0, S.fogRate, Math.min(delta, 0.1));
    if (mix < 1e-3) mix = 0;
    viewMix.current = mix;
    const fog = fogRef.current;
    if (fog) {
      if (mix > 0) {
        const cam = state.camera.position;
        const v = riverViewFog(cam, playArea, look, backdropHorizon(rt.terrain, cam.x, cam.z));
        fog.near = look.fogNear + (Math.max(v.near, look.fogNear) - look.fogNear) * mix;
        fog.far = look.fogFar + (Math.max(v.far, look.fogFar) - look.fogFar) * mix;
      } else {
        fog.near = look.fogNear;
        fog.far = look.fogFar;
      }
    }
    const { mesh, puffs, base, region, shownMix } = clouds;
    const { m, p, s, c: centre } = scratch.current;
    const drift = rt.time * CLOUDS.wind;
    const cam = state.camera.position;
    const dt = Math.min(delta, 0.1);
    let lastCloud = -1;
    let show = 1;
    for (let i = 0; i < mesh.count; i++) {
      const pf = puffs[i];
      const c = pf.cloud;
      const u = wrap(base[c * 3] - region.minX + drift * windX, region.spanX);
      const v = wrap(base[c * 3 + 2] - region.minZ + drift * windZ, region.spanZ);
      if (c !== lastCloud) {
        // In the river view a cloud between the camera and the river fades out of the way; the rest
        // stay, so the sky keeps its clouds around the river.
        lastCloud = c;
        centre.set(region.minX + u, base[c * 3 + 1], region.minZ + v);
        const hides = mix > 0 && cloudHidesPlayArea(cam, centre, playArea);
        let k = damp(shownMix[c], hides ? 0 : 1, S.fogRate, dt);
        if (k > 0.999) k = 1;
        shownMix[c] = k;
        show = k * k * (3 - 2 * k);
      }
      // Shrink to nothing near the wrap edges so clouds never pop.
      const edge = Math.min(u, region.spanX - u, v, region.spanZ - v);
      const fade = Math.min(1, edge / 200) * show;
      p.set(region.minX + u + pf.ox, base[c * 3 + 1] + pf.oy, region.minZ + v + pf.oz);
      s.set(pf.sx * fade + 1e-3, pf.sy * fade + 1e-3, pf.sz * fade + 1e-3);
      m.compose(p, pf.q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <mesh geometry={dome.geometry} material={dome.material} frustumCulled={false} renderOrder={-1000} />
      <primitive object={clouds.mesh} />
    </>
  );
}
