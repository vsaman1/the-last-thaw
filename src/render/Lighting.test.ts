import { DirectionalLight, WebGLRenderTarget } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { LevelTheme } from '../core/types';
import { LIGHTING, THEME_LIGHTING, lightingLookFor, releaseShadowMap } from './Lighting';

describe('shadow map memory', () => {
  it('turning shadows off frees the light’s shadow map (three re-creates it when needed)', () => {
    const light = new DirectionalLight();
    const map = new WebGLRenderTarget(LIGHTING.shadowMapHigh, LIGHTING.shadowMapHigh);
    const dispose = vi.spyOn(map, 'dispose');
    light.shadow.map = map;
    releaseShadowMap(light);
    expect(dispose).toHaveBeenCalledOnce();
    expect(light.shadow.map).toBeNull();
    releaseShadowMap(light); // nothing allocated: a no-op
    expect(dispose).toHaveBeenCalledOnce();
  });
});

const THEMES: LevelTheme[] = ['meadow', 'canyon', 'alpine', 'town', 'industrial'];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

describe('theme lighting looks', () => {
  it('meadow (and an unthemed level) keeps the original lighting', () => {
    for (const t of [undefined, 'meadow' as const]) {
      const l = lightingLookFor(t);
      expect(l.sunColor).toBe(LIGHTING.sunColor);
      expect(l.sunIntensity).toBe(LIGHTING.sunIntensity);
      expect(l.hemiSky).toBe(LIGHTING.hemiSky);
      expect(l.hemiGround).toBe(LIGHTING.hemiGround);
      expect(l.hemiIntensity).toBe(LIGHTING.hemiIntensity);
      expect(l.ambientColor).toBe(LIGHTING.ambientColor);
      expect(l.ambientIntensity).toBe(LIGHTING.ambientIntensity);
    }
  });

  it('every theme is complete and plausible', () => {
    for (const t of THEMES) {
      const l = THEME_LIGHTING[t];
      for (const c of [l.sunColor, l.hemiSky, l.hemiGround, l.ambientColor]) {
        expect(c).toMatch(/^#[0-9A-F]{6}$/i);
      }
      expect(l.sunIntensity).toBeGreaterThan(1);
      expect(l.sunIntensity).toBeLessThan(3.5);
      expect(l.hemiIntensity).toBeGreaterThan(0.6);
      expect(l.ambientIntensity).toBeLessThan(0.5);
    }
  });

  it('canyon sun is warmer than the meadow; alpine sun is whiter and stronger', () => {
    const warmth = (hex: string): number => rgb(hex)[0] - rgb(hex)[2];
    expect(warmth(THEME_LIGHTING.canyon.sunColor)).toBeGreaterThan(warmth(LIGHTING.sunColor));
    const whiteness = (hex: string): number => Math.min(...rgb(hex));
    expect(whiteness(THEME_LIGHTING.alpine.sunColor)).toBeGreaterThan(whiteness(LIGHTING.sunColor));
    expect(THEME_LIGHTING.alpine.sunIntensity).toBeGreaterThan(LIGHTING.sunIntensity);
  });

  it('town and industrial light is softer: less direct sun relative to fill', () => {
    const ratio = (t: LevelTheme): number =>
      THEME_LIGHTING[t].sunIntensity / THEME_LIGHTING[t].hemiIntensity;
    expect(ratio('town')).toBeLessThan(ratio('meadow'));
    expect(ratio('industrial')).toBeLessThan(ratio('town'));
    expect(THEME_LIGHTING.industrial.sunIntensity).toBeLessThan(LIGHTING.sunIntensity);
  });
});
