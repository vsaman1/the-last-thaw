/**
 * The app settings reduced to what the sound system consumes (contract AudioLevels). Every value is
 * re-clamped here too, so the engine never sees a NaN or an out-of-range gain even if a caller builds
 * Settings by hand (tests do).
 */
import type { Settings } from '../state/appStore';
import { AUDIO_SETTING_DEFAULTS, type AudioLevels } from './contract';

/** Before the settings arrive: the settings defaults (music 0.6 is today's loudness, appStore). */
export const DEFAULT_LEVELS: AudioLevels = {
  master: AUDIO_SETTING_DEFAULTS.masterVolume,
  music: 0.6,
  ambience: AUDIO_SETTING_DEFAULTS.ambienceVolume,
  effects: AUDIO_SETTING_DEFAULTS.effectsVolume,
  musicMuted: false,
  soundMuted: AUDIO_SETTING_DEFAULTS.soundMuted,
};

const unit = (x: unknown, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;

export function levelsFromSettings(s: Readonly<Settings>): AudioLevels {
  return {
    master: unit(s.masterVolume, DEFAULT_LEVELS.master),
    music: unit(s.musicVolume, DEFAULT_LEVELS.music),
    ambience: unit(s.ambienceVolume, DEFAULT_LEVELS.ambience),
    effects: unit(s.effectsVolume, DEFAULT_LEVELS.effects),
    musicMuted: s.musicMuted === true,
    soundMuted: s.soundMuted === true,
  };
}

export function sameLevels(a: AudioLevels, b: AudioLevels): boolean {
  return (
    a.master === b.master &&
    a.music === b.music &&
    a.ambience === b.ambience &&
    a.effects === b.effects &&
    a.musicMuted === b.musicMuted &&
    a.soundMuted === b.soundMuted
  );
}
