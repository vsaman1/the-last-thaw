import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { calvingVeil } from '../core/glacier/calving';
import {
  type GlacierPlacement,
  getGlacier,
  glacierFrontS,
  glacierSurface,
  glacierWorld,
} from '../core/glacier/glacier';
import { buildCrackGeometry, buildGlacierGeometry, buildSnowFieldGeometry } from '../core/glacier/geometry';
import { useGameStore } from '../state/gameStore';
import { createCalvingClock, readCalving } from './calvingClock';
import { lastOnly } from './lastOnly';
import { ParticlePool } from './Particles';
import { usePrefersReducedMotion } from './reducedMotion';
import { useRuntime } from './RuntimeContext';

export const GLACIER_VISUAL = {
  /** Emissive tint of the glacier ice (× face colour × aGlow), like the iceberg's. */
  emissive: '#9FF6FF',
  glow: 0.24,
  /** Calving crack colour (additive, unlit, past 1.0 for bloom). */
  crackColor: '#BFFFFF',
  /**
   * Reduced-motion veil colour (the cut between the front shot and the follow pose): a pale glacier
   * blue just under the bloom threshold, so the dip reads as a soft fade, not a flash.
   */
  veilColor: '#CFE0EC',
  /** Ice crumbs per second falling off the front while the cracks spread (at full spread). */
  crumbRate: 34,
} as const;

interface GlacierGeometries {
  body: THREE.BufferGeometry;
  cracks: THREE.BufferGeometry;
  snow: THREE.BufferGeometry;
}

// Placements are cached per terrain (core), so a retry reuses the built arrays; unmounting only frees
// the GPU buffers (three re-uploads on the next mount), like the terrain chunks.
const geometriesFor = lastOnly(
  (g: GlacierPlacement): GlacierGeometries => ({
    body: buildGlacierGeometry(g),
    cracks: buildCrackGeometry(g),
    snow: buildSnowFieldGeometry(g),
  }),
);

/** Glacier ice: lit, flat-shaded vertex colours; ice faces glow turquoise (aGlow), snow stays matte. */
export function createBodyMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.6,
    metalness: 0.02,
    emissive: new THREE.Color(GLACIER_VISUAL.emissive),
    emissiveIntensity: GLACIER_VISUAL.glow,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      // Snow is rough, ice glossy.
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.9, 0.3, clamp(vGlow, 0.0, 1.0));',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )',
          '  totalEmissiveRadiance *= vColor.rgb * vGlow;',
          '#endif',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'glacier-ice-v1';
  return m;
}

/** Snow field over the terrain: the terrain's own program (same parameters), pulled forward in depth. */
function createSnowMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export interface CrackUniforms {
  uCrack: { value: number };
  uGlow: { value: number };
}

/** Calving cracks: unlit additive ribbons, lit from where the crack starts up to uCrack. */
export function createCrackMaterial(u: CrackUniforms): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: GLACIER_VISUAL.crackColor,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCrack = u.uCrack;
    shader.uniforms.uGlow = u.uGlow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute float aReveal;',
          'attribute float aEdge;',
          'varying float vReveal;',
          'varying float vEdge;',
        ].join('\n'),
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReveal = aReveal;\nvEdge = aEdge;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uCrack;',
          'uniform float uGlow;',
          'varying float vReveal;',
          'varying float vEdge;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'if (vReveal > uCrack) discard;',
          // The advancing tip burns brightest; the ribbon fades to its edges.
          'float tip = exp(-(uCrack - vReveal) * 9.0);',
          'float core = 1.0 - vEdge * vEdge;',
          'diffuseColor.rgb *= uGlow * core * (0.7 + 1.8 * tip);',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'glacier-crack-v1';
  return m;
}

/** Full-screen veil (clip-space quad) for the reduced-motion cut. */
export function createVeilMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(GLACIER_VISUAL.veilColor) },
      uOpacity: { value: 0 },
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      'void main() {',
      '  gl_FragColor = vec4(uColor, uOpacity);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * The glacier the level starts from (body, snow field, calving cracks) and the calving's effects:
 * cracks spreading and glowing, ice crumbs and snow dust off the front, the burst as the chunk breaks
 * free, the puff as it lands, and (prefers-reduced-motion) the veil over the camera cut. Every
 * material is in the scene while the loading overlay is up, so the shader warm-up compiles it.
 */
export function Glacier() {
  const rt = useRuntime();
  const glacier = useMemo(() => getGlacier(rt.terrain), [rt]);
  const geo = useMemo(() => geometriesFor(glacier), [glacier]);
  const crackUniforms = useMemo<CrackUniforms>(() => ({ uCrack: { value: 0 }, uGlow: { value: 0 } }), []);
  const bodyMaterial = useMemo(() => createBodyMaterial(), []);
  const snowMaterial = useMemo(() => createSnowMaterial(), []);
  const crackMaterial = useMemo(() => createCrackMaterial(crackUniforms), [crackUniforms]);
  const veilMaterial = useMemo(() => createVeilMaterial(), []);
  const veilGeometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  const cracks = useRef<THREE.Mesh>(null);
  const veil = useRef<THREE.Mesh>(null);
  const reduceMotion = usePrefersReducedMotion();
  const clock = useRef(createCalvingClock());
  const fx = useRef({ lastT: -1, crumbs: 0, spray: 0 });
  const scratch = useMemo<Vec3>(() => ({ x: 0, y: 0, z: 0 }), []);

  useEffect(
    () => () => {
      geo.body.dispose();
      geo.cracks.dispose();
      geo.snow.dispose();
    },
    [geo],
  );
  useEffect(
    () => () => {
      bodyMaterial.dispose();
      snowMaterial.dispose();
      crackMaterial.dispose();
      veilMaterial.dispose();
      veilGeometry.dispose();
    },
    [bodyMaterial, snowMaterial, crackMaterial, veilMaterial, veilGeometry],
  );

  useFrame((_state, delta) => {
    const c = readCalving(rt, glacier, clock.current);
    const s = c.state;
    // While the loading overlay is up everything stays visible so the warm-up compiles it.
    const loading = useGameStore.getState().phase === 'loading';
    crackUniforms.uCrack.value = c.active ? s.crack : 0;
    crackUniforms.uGlow.value = c.active ? s.glow : 0;
    if (cracks.current) cracks.current.visible = loading || (c.active && c.t > 0);
    const veilOpacity = reduceMotion && c.active ? calvingVeil(c.keys, c.t) : 0;
    (veilMaterial.uniforms.uOpacity as { value: number }).value = veilOpacity;
    if (veil.current) veil.current.visible = loading || veilOpacity > 0.002;
    emitEffects(c.active ? c.t : -1, Math.min(delta, 0.1));
  });

  /** Particle effects keyed to the calving clock (crossings, so a frame never fires one twice). */
  function emitEffects(t: number, dt: number): void {
    const f = fx.current;
    const prev = f.lastT;
    f.lastT = t;
    const pool = rt.fx instanceof ParticlePool ? rt.fx : null;
    if (t < 0 || !pool || rt.phase !== 'intro') return;
    const g = glacier;
    const k = clock.current.keys;
    const st = clock.current.state;
    const budget = pool.budget;
    // Crumbs and dust off the front edge round the socket while the cracks spread.
    if (t > 0 && t < k.breakAt) {
      f.crumbs += GLACIER_VISUAL.crumbRate * (0.2 + 0.8 * Math.min(1, st.crack)) * budget * dt;
      while (f.crumbs >= 1) {
        f.crumbs -= 1;
        const span = g.socketHalf + 1.5 * g.radius;
        const d = (pool.random() * 2 - 1) * span;
        const sf = glacierFrontS(g, d) + 0.15;
        glacierWorld(g, sf, d, scratch);
        scratch.y = glacierSurface(g, sf, d);
        pool.crumbs(scratch, g.fx, g.fz, 1, 0.35);
      }
    }
    const chunkAt = (along: number, up: number): Vec3 => {
      scratch.x = rt.iceberg.pos.x - g.fx * along;
      scratch.z = rt.iceberg.pos.z - g.fz * along;
      scratch.y = rt.terrain.heightAt(scratch.x, scratch.z) + up;
      return scratch;
    };
    if (prev < k.breakAt && t >= k.breakAt) {
      // The break: a burst of ice off the back and top of the chunk, snow billowing from the crack.
      pool.iceShards(chunkAt(g.slide + 0.5 * g.radius, g.iceHeight * 0.75), 0.14);
      pool.crumbs(chunkAt(g.slide + 0.9 * g.radius, g.faceHeight), g.fx, g.fz, Math.round(16 * budget), 0.7);
      pool.emit('sparkle', chunkAt(g.slide, g.iceHeight * 0.6), { intensity: 1.4, count: 12 });
    }
    if (prev < k.landAt && t >= k.landAt) {
      // The landing: a puff of snow and a few crumbs round its base.
      pool.crumbs(chunkAt(st.along, 0.3), g.fx, g.fz, Math.max(6, Math.round(18 * budget)), 0.65);
    }
    if (t > k.landAt) {
      // Snow kicked up behind it as it slides off.
      f.spray += 14 * budget * dt;
      while (f.spray >= 1) {
        f.spray -= 1;
        pool.crumbs(chunkAt(st.along + 0.6 * g.radius, 0.15), -g.fx, -g.fz, 1, 0.8);
      }
    }
  }

  return (
    <group name="glacier">
      <mesh name="glacier-body" geometry={geo.body} material={bodyMaterial} castShadow receiveShadow />
      <mesh name="glacier-snow" geometry={geo.snow} material={snowMaterial} receiveShadow />
      <mesh
        ref={cracks}
        name="glacier-cracks"
        geometry={geo.cracks}
        material={crackMaterial}
        renderOrder={2}
        frustumCulled={false}
      />
      <mesh
        ref={veil}
        name="glacier-veil"
        geometry={veilGeometry}
        material={veilMaterial}
        renderOrder={1000}
        frustumCulled={false}
      />
    </group>
  );
}
