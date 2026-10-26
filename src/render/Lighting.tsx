import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight, Object3D, PCFShadowMap, Vector3 } from 'three';
import type { LevelTheme } from '../core/types';
import { useRuntime } from './RuntimeContext';
import { conditionLightingLook, useWorldCondition } from './worldCondition';

/** Unit vector from the scene toward the sun (shared with the sky's sun glow). */
export const SUN_DIRECTION = new Vector3(0.55, 0.78, -0.3).normalize();

export const LIGHTING = {
  sunColor: '#FFE6BF',
  sunIntensity: 2.2,
  hemiSky: '#A9DEFF',
  hemiGround: '#4C9A34',
  hemiIntensity: 1.05,
  ambientColor: '#DDEBFF',
  ambientIntensity: 0.22,
  /** Half-size of the orthographic shadow box (m). */
  shadowExtent: 70,
  /** The box is centred this far ahead of the iceberg, where the camera is looking. */
  shadowLead: 22,
  shadowMapHigh: 2048,
  sunDistance: 260,
} as const;

/** Light colours and strengths that vary with the level theme (the sun direction does not). */
export interface LightingLook {
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  /** Bounce light from the ground: grass, red rock, snow, tarmac… */
  hemiGround: string;
  hemiIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
}

/** Default lighting per level theme; 'meadow' is the original look. */
export const THEME_LIGHTING: Readonly<Record<LevelTheme, Readonly<LightingLook>>> = {
  meadow: {
    sunColor: LIGHTING.sunColor,
    sunIntensity: LIGHTING.sunIntensity,
    hemiSky: LIGHTING.hemiSky,
    hemiGround: LIGHTING.hemiGround,
    hemiIntensity: LIGHTING.hemiIntensity,
    ambientColor: LIGHTING.ambientColor,
    ambientIntensity: LIGHTING.ambientIntensity,
  },
  // Low warm sun, sandy sky fill and a red-rock bounce.
  canyon: {
    sunColor: '#FFD39A',
    sunIntensity: 2.35,
    hemiSky: '#E6D8C4',
    hemiGround: '#A0603A',
    hemiIntensity: 1.0,
    ambientColor: '#FFE8D0',
    ambientIntensity: 0.22,
  },
  // Crisp, nearly white sun; cool sky fill and a bright snow/rock bounce.
  alpine: {
    sunColor: '#FFF6EA',
    sunIntensity: 2.4,
    hemiSky: '#B8E2FF',
    hemiGround: '#7F98AC',
    hemiIntensity: 1.1,
    ambientColor: '#E6F2FF',
    ambientIntensity: 0.24,
  },
  // Softer sun, more sky fill: gentle shadows.
  town: {
    sunColor: '#FFE9CC',
    sunIntensity: 1.95,
    hemiSky: '#C4E0F2',
    hemiGround: '#6C9A50',
    hemiIntensity: 1.15,
    ambientColor: '#EEF2FF',
    ambientIntensity: 0.28,
  },
  // Sun dimmed by haze, flat grey fill, dull ground bounce.
  industrial: {
    sunColor: '#F6DDB8',
    sunIntensity: 1.8,
    hemiSky: '#C2C8CC',
    hemiGround: '#6A6A58',
    hemiIntensity: 1.2,
    ambientColor: '#E4E2DA',
    ambientIntensity: 0.3,
  },
};

export function lightingLookFor(theme: LevelTheme | undefined): LightingLook {
  return { ...(THEME_LIGHTING[theme ?? 'meadow'] ?? THEME_LIGHTING.meadow) };
}

/**
 * Frees a light's shadow map (2048² at 'high'/'medium') once shadows are off: three keeps it
 * allocated otherwise. It allocates a new one if shadows are turned back on.
 */
export function releaseShadowMap(light: DirectionalLight): void {
  const map = light.shadow.map;
  if (!map) return;
  // As three does when it replaces a shadow map: the depth texture first, then the target.
  map.depthTexture?.dispose();
  map.depthTexture = null;
  map.dispose();
  light.shadow.map = null;
}

/**
 * Hemisphere + ambient fill and a warm sun whose shadow box follows the iceberg. The box centre is
 * snapped to whole shadow-map texels in light space so shadows do not shimmer as it moves.
 */
export function Lighting({ quality }: { quality: 'high' | 'low' }) {
  const rt = useRuntime();
  const gl = useThree((s) => s.gl);
  const sun = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const high = quality === 'high';
  const mapSize = LIGHTING.shadowMapHigh;
  const theme = rt.level.theme;
  const world = useWorldCondition();
  const look = useMemo(() => conditionLightingLook(lightingLookFor(theme), world), [theme, world]);

  // Light-space basis for texel snapping (sun direction is fixed).
  const basis = useMemo(() => {
    const fwd = SUN_DIRECTION.clone();
    const right = new Vector3(0, 1, 0).cross(fwd).normalize();
    const up = fwd.clone().cross(right).normalize();
    return { fwd, right, up, centre: new Vector3() };
  }, []);

  useEffect(() => {
    // three r186 removed PCFSoftShadowMap (it warns and falls back); PCF + shadow.radius is soft.
    gl.shadowMap.enabled = high;
    if (high) gl.shadowMap.type = PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
    if (!high && sun.current) releaseShadowMap(sun.current);
  }, [gl, high]);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target = target;
    const cam = light.shadow.camera;
    const e = LIGHTING.shadowExtent;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = LIGHTING.sunDistance * 2;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.05;
    light.shadow.radius = 3;
  }, [target, mapSize]);

  useFrame(() => {
    const light = sun.current;
    if (!light) return;
    const ice = rt.iceberg;
    const vx = ice.vel.x;
    const vz = ice.vel.z;
    const sp = Math.hypot(vx, vz);
    let cx = ice.pos.x;
    let cz = ice.pos.z;
    if (sp > 0.5) {
      cx += (vx / sp) * LIGHTING.shadowLead;
      cz += (vz / sp) * LIGHTING.shadowLead;
    } else {
      cx += Math.sin(ice.heading) * LIGHTING.shadowLead;
      cz += Math.cos(ice.heading) * LIGHTING.shadowLead;
    }
    const c = basis.centre.set(cx, ice.pos.y, cz);
    const texel = (LIGHTING.shadowExtent * 2) / mapSize;
    const a = Math.round(c.dot(basis.right) / texel) * texel;
    const b = Math.round(c.dot(basis.up) / texel) * texel;
    const w = c.dot(basis.fwd);
    c.set(0, 0, 0)
      .addScaledVector(basis.right, a)
      .addScaledVector(basis.up, b)
      .addScaledVector(basis.fwd, w);
    target.position.copy(c);
    target.updateMatrixWorld();
    light.position.copy(c).addScaledVector(SUN_DIRECTION, LIGHTING.sunDistance);
  });

  return (
    <>
      <hemisphereLight
        color={look.hemiSky}
        groundColor={look.hemiGround}
        intensity={look.hemiIntensity}
      />
      <ambientLight color={look.ambientColor} intensity={look.ambientIntensity} />
      <directionalLight ref={sun} color={look.sunColor} intensity={look.sunIntensity} castShadow={high} />
      <primitive object={target} />
    </>
  );
}
