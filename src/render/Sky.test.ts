import { describe, expect, it } from 'vitest';
import { Color, SRGBColorSpace } from 'three';
import type { LevelTheme } from '../core/types';
import {
  SKY_DEFAULTS,
  THEME_SKIES,
  cloudHidesPlayArea,
  farthestInPlayArea,
  riverViewFog,
  skyLookFor,
} from './Sky';

const THEMES: LevelTheme[] = ['meadow', 'canyon', 'alpine', 'town', 'industrial'];

function hsl(hex: string): { h: number; s: number; l: number } {
  return new Color(hex).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
}

/** sRGB channels 0..1 of a hex colour. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

describe('theme sky looks', () => {
  it('a meadow level without its own sky keeps the original look', () => {
    for (const level of [{}, { theme: 'meadow' as const }]) {
      const look = skyLookFor(level);
      expect(look.top).toBe(SKY_DEFAULTS.top);
      expect(look.horizon).toBe(SKY_DEFAULTS.horizon);
      expect(look.fog).toBe(SKY_DEFAULTS.fog);
      expect(look.sun).toBe(SKY_DEFAULTS.sun);
      expect(look.fogNear).toBe(SKY_DEFAULTS.fogNear);
      expect(look.fogFar).toBe(SKY_DEFAULTS.fogFar);
      expect(look.cloudCover).toBe(1);
    }
  });

  it("a level's own sky colours win over the theme; fog falls back to the horizon", () => {
    const sky = { top: '#102030', horizon: '#405060', fog: '#708090' };
    const look = skyLookFor({ theme: 'canyon', sky });
    expect([look.top, look.horizon, look.fog]).toEqual([sky.top, sky.horizon, sky.fog]);
    // The theme still decides the rest (haze distance, sun, clouds).
    expect(look.fogFar).toBe(THEME_SKIES.canyon.fogFar);
    expect(look.sun).toBe(THEME_SKIES.canyon.sun);
    const noFog = skyLookFor({ sky: { top: '#102030', horizon: '#405060' } as typeof sky });
    expect(noFog.fog).toBe('#405060');
  });

  it('every theme has valid colours and fog distances, and differs from the meadow', () => {
    for (const t of THEMES) {
      const look = skyLookFor({ theme: t });
      for (const c of [look.top, look.horizon, look.fog, look.sun, look.cloudColor, look.cloudEmissive]) {
        expect(c).toMatch(/^#[0-9A-F]{6}$/i);
      }
      expect(look.fogNear).toBeGreaterThan(0);
      expect(look.fogFar).toBeGreaterThan(look.fogNear * 2);
      expect(look.cloudCover).toBeGreaterThanOrEqual(0);
      expect(look.cloudCover).toBeLessThanOrEqual(1);
      if (t !== 'meadow') {
        const m = THEME_SKIES.meadow;
        expect([look.top, look.horizon, look.fog]).not.toEqual([m.top, m.horizon, m.fog]);
      }
    }
  });

  it('canyon reads warm and dusty', () => {
    const c = THEME_SKIES.canyon;
    const [hr, , hb] = rgb(c.horizon);
    const [fr, , fb] = rgb(c.fog);
    expect(hr - hb).toBeGreaterThan(0.1);
    expect(fr - fb).toBeGreaterThan(0.1);
    expect(c.fogFar).toBeLessThan(SKY_DEFAULTS.fogFar);
  });

  it('alpine reads crisp and blue: a deep blue zenith and clearer air than the meadow', () => {
    const a = THEME_SKIES.alpine;
    const [r, , b] = rgb(a.top);
    expect(b - r).toBeGreaterThan(0.6);
    expect(hsl(a.top).s).toBeGreaterThan(0.7);
    expect(a.fogFar).toBeGreaterThan(SKY_DEFAULTS.fogFar);
    expect(hsl(a.fog).l).toBeGreaterThan(0.85);
  });

  it('town is soft (calmer sky than the meadow); industrial is hazy (short, greyish fog)', () => {
    expect(hsl(THEME_SKIES.town.top).s).toBeLessThan(hsl(SKY_DEFAULTS.top).s);
    const ind = THEME_SKIES.industrial;
    expect(ind.fogFar).toBeLessThan(SKY_DEFAULTS.fogFar * 0.75);
    expect(ind.fogNear).toBeLessThan(SKY_DEFAULTS.fogNear);
    expect(hsl(ind.fog).s).toBeLessThan(0.25);
    expect(hsl(ind.top).s).toBeLessThan(hsl(SKY_DEFAULTS.top).s);
  });
});

describe('river-view fog: the river stays legible, the level keeps its atmosphere', () => {
  // A long level (about Power Valley's size) and the smoggy industrial look.
  const area = { minX: -150, maxX: 150, minZ: 0, maxZ: 2000, minY: 0, maxY: 300 };
  const smog = { fogNear: 140, fogFar: 1000 };
  const fogAt = (f: { near: number; far: number }, d: number) =>
    Math.min(1, Math.max(0, (d - f.near) / (f.far - f.near)));

  it('framing the whole river from far out: light haze over the river, real fog past it', () => {
    for (const cam of [
      { x: 0, y: 1800, z: -1200 },
      { x: 1500, y: 2200, z: 1000 },
    ]) {
      const f = riverViewFog(cam, area, smog);
      const far = farthestInPlayArea(cam, area);
      expect(fogAt(f, far)).toBeLessThan(0.5);
      expect(fogAt(f, 3 * far)).toBeGreaterThan(0.6);
    }
  });

  it('never thinner than the old fixed river-view fog, and never denser than in play', () => {
    const close = riverViewFog({ x: 0, y: 60, z: 1000 }, area, smog);
    expect(close.near).toBeGreaterThanOrEqual(SKY_DEFAULTS.viewFogNear);
    expect(close.far).toBeGreaterThanOrEqual(SKY_DEFAULTS.viewFogFar);
    const clear = riverViewFog({ x: 0, y: 3000, z: -2000 }, area, { fogNear: 320, fogFar: 2000 });
    expect(clear.near).toBeGreaterThan(320);
    expect(clear.far).toBeGreaterThan(2000);
  });

  it("the haze is the level's: smog closes in on the world around the river sooner than alpine air", () => {
    const cam = { x: 0, y: 1800, z: -1200 };
    const far = farthestInPlayArea(cam, area);
    const smoggy = riverViewFog(cam, area, THEME_SKIES.industrial);
    const alpine = riverViewFog(cam, area, THEME_SKIES.alpine);
    // The river itself: no fog in front of it, at most the theme's haze at its far end.
    expect(fogAt(smoggy, far)).toBeCloseTo(THEME_SKIES.industrial.viewHaze, 2);
    expect(fogAt(alpine, far)).toBeLessThan(fogAt(smoggy, far));
    // A kilometre past it the smog is much thicker than the alpine air.
    expect(fogAt(smoggy, far + 1000)).toBeGreaterThan(fogAt(alpine, far + 1000) + 0.2);
    expect(fogAt(smoggy, far + 2500)).toBe(1);
  });

  it('is always full before the world around the level ends', () => {
    const cam = { x: 0, y: 4000, z: -3000 };
    const f = riverViewFog(cam, area, THEME_SKIES.alpine, 5000);
    expect(f.far).toBeLessThanOrEqual(0.9 * 5000);
    expect(f.near).toBeLessThan(f.far);
  });
});

describe('clouds in the river view', () => {
  const area = { minX: -150, maxX: 150, minZ: 0, maxZ: 2000, minY: 0, maxY: 300 };
  const cam = { x: 0, y: 2000, z: -1500 };

  it('a cloud between the camera and the river hides it; one off to the side does not', () => {
    // On the sight line from the camera to the middle of the river.
    const t = 0.7;
    const mid = { x: 0, y: 150, z: 1000 };
    const at = (a: number, b: number): number => a + (b - a) * t;
    const between = { x: at(cam.x, mid.x), y: at(cam.y, mid.y), z: at(cam.z, mid.z) };
    expect(cloudHidesPlayArea(cam, between, area)).toBe(true);
    expect(cloudHidesPlayArea(cam, { ...between, x: between.x + 900 }, area)).toBe(false);
  });

  it('a camera at or below a cloud never looks at the river through it', () => {
    const low = { x: 0, y: 200, z: 900 };
    expect(cloudHidesPlayArea(low, { x: 0, y: 450, z: 1000 }, area)).toBe(false);
    expect(cloudHidesPlayArea(cam, { x: 0, y: 100, z: 1000 }, area)).toBe(false);
  });
});
