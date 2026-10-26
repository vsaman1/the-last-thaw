import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings, type Settings } from '../state/appStore';
import { AUDIO_SETTING_DEFAULTS } from './contract';
import { DEFAULT_LEVELS, levelsFromSettings, sameLevels } from './settings';

describe('levelsFromSettings', () => {
  it('the defaults give the default levels, and the store defaults are the contract defaults', () => {
    expect(defaultSettings).toMatchObject(AUDIO_SETTING_DEFAULTS);
    expect(levelsFromSettings(defaultSettings)).toEqual(DEFAULT_LEVELS);
    expect(DEFAULT_LEVELS.music).toBe(defaultSettings.musicVolume);
  });

  it('maps every field', () => {
    const s: Settings = {
      ...defaultSettings,
      masterVolume: 0.5,
      musicVolume: 0.4,
      ambienceVolume: 0.3,
      effectsVolume: 0.2,
      musicMuted: true,
      soundMuted: true,
    };
    expect(levelsFromSettings(s)).toEqual({
      master: 0.5,
      music: 0.4,
      ambience: 0.3,
      effects: 0.2,
      musicMuted: true,
      soundMuted: true,
    });
  });

  it('re-clamps hand-built settings so the engine never sees NaN or a gain above 1', () => {
    const s = { ...defaultSettings, masterVolume: Number.NaN, effectsVolume: 3, ambienceVolume: -1 };
    expect(levelsFromSettings(s)).toMatchObject({ master: 1, effects: 1, ambience: 0 });
  });

  it('sanitised junk always yields finite levels in 0..1', () => {
    for (const junk of [null, 42, 'x', { masterVolume: 'loud' }, { effectsVolume: 1e9, soundMuted: 1 }]) {
      const l = levelsFromSettings(sanitizeSettings(junk));
      for (const v of [l.master, l.music, l.ambience, l.effects]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(typeof l.soundMuted).toBe('boolean');
    }
  });

  it('sameLevels compares every field', () => {
    expect(sameLevels(DEFAULT_LEVELS, { ...DEFAULT_LEVELS })).toBe(true);
    expect(sameLevels(DEFAULT_LEVELS, { ...DEFAULT_LEVELS, soundMuted: true })).toBe(false);
    expect(sameLevels(DEFAULT_LEVELS, { ...DEFAULT_LEVELS, effects: 0.81 })).toBe(false);
  });
});
