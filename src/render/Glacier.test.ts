import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EFFECTS } from './Effects';
import { GLACIER_VISUAL, createBodyMaterial, createCrackMaterial, createVeilMaterial } from './Glacier';

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Runs a material's onBeforeCompile on three's real shader source for its type. */
function compiled(m: THREE.Material, lib: 'standard' | 'basic'): Shader {
  const src = THREE.ShaderLib[lib];
  const shader = {
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(src.uniforms),
  } as unknown as Shader;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('glacier materials', () => {
  it('inject the glow attribute into the standard shader (ice glows, snow is rough)', () => {
    const m = createBodyMaterial();
    const s = compiled(m, 'standard');
    expect(s.vertexShader).toContain('attribute float aGlow;');
    expect(s.vertexShader).toContain('vGlow = aGlow;');
    expect(s.fragmentShader).toContain('roughnessFactor = mix(0.9, 0.3');
    expect(s.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb * vGlow;');
    expect(m.customProgramCacheKey()).toBe('glacier-ice-v1');
    expect(m.vertexColors).toBe(true);
    m.dispose();
  });

  it('reveal the cracks up to uCrack in the basic shader, additive and unlit', () => {
    const u = { uCrack: { value: 0.4 }, uGlow: { value: 1 } };
    const m = createCrackMaterial(u);
    const s = compiled(m, 'basic');
    expect(s.vertexShader).toContain('attribute float aReveal;');
    expect(s.fragmentShader).toContain('if (vReveal > uCrack) discard;');
    expect(s.uniforms.uCrack).toBe(u.uCrack);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    expect(m.toneMapped).toBe(false);
    m.dispose();
  });

  it('keeps the reduced-motion veil a soft dip, under the bloom threshold', () => {
    const m = createVeilMaterial();
    expect(m.depthTest).toBe(false);
    expect(m.transparent).toBe(true);
    expect((m.uniforms.uOpacity as { value: number }).value).toBe(0);
    const c = new THREE.Color(GLACIER_VISUAL.veilColor);
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(luminance).toBeLessThan(EFFECTS.bloomThreshold);
    expect(luminance).toBeGreaterThan(0.5);
    m.dispose();
  });
});
