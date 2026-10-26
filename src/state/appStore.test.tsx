// @vitest-environment jsdom
/**
 * appStore persistence: per-field settings repair, the reduced-motion default and multi-tab safety.
 * Each test boots a fresh store module against an in-memory localStorage.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunStats } from '../core/types';
import type { Progress } from './progress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS = 'iceberg-river.settings.v1';
const PROGRESS = 'iceberg-river.progress.v1';

function memoryStorage(data: Record<string, string>): Storage {
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    key: () => null,
    get length() {
      return Object.keys(data).length;
    },
  } as Storage;
}

async function bootStore(data: Record<string, string>) {
  vi.stubGlobal('localStorage', memoryStorage(data));
  vi.resetModules();
  return import('./appStore');
}

const stats = (time: number, score: number): RunStats => ({
  levelId: 'level1',
  time,
  score,
  distance: 600,
  topSpeed: 25,
  knockedDown: 3,
  buildingsDestroyed: 0,
  treesFelled: 1,
  waterfallsCrossed: 1,
  collisions: 4,
  iceLeft: 1,
  absorbed: 0,
  peakMass: 30,
});

const progressWith = (rec: { bestTime: number; bestScore: number; completions: number }): Progress => ({
  version: 1,
  completed: { level1: rec },
});

const fireStorage = (key: string | null, newValue: string | null) =>
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('saved settings are validated per field', () => {
  // Regression (review INTEGRATION #1 part 4): {"mouseSensitivity":null} passed the old shape check,
  // and opening Settings then threw "Cannot read properties of null (reading 'toFixed')".
  it('a null sensitivity falls back to the default and the Settings screen renders', async () => {
    const data = { [SETTINGS]: '{"mouseSteering":true,"mouseSensitivity":null}' };
    const { useAppStore, defaultSettings } = await bootStore(data);
    expect(useAppStore.getState().settings).toEqual(defaultSettings);

    const { SettingsScreen } = await import('../ui/screens/SettingsScreen');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<SettingsScreen />));
    expect(host.textContent).toContain('Mouse sensitivity');
    act(() => root.unmount());
    host.remove();
  });

  it('keeps valid fields, repairs bad ones, clamps sensitivity and drops unknown keys', async () => {
    const saved = {
      mouseSteering: false,
      mouseSensitivity: 5,
      quality: 'ultra',
      showSpeedometer: 'yes',
      skipIntros: true,
      somethingElse: 1,
    };
    const { useAppStore } = await bootStore({ [SETTINGS]: JSON.stringify(saved) });
    expect(useAppStore.getState().settings).toEqual({
      mouseSteering: false,
      mouseSensitivity: 2,
      quality: 'auto',
      showSpeedometer: true,
      skipIntros: true,
      unlockAllLevels: false,
      musicVolume: 0.6,
      musicMuted: false,
      masterVolume: 1,
      ambienceVolume: 0.8,
      effectsVolume: 0.8,
      soundMuted: false,
    });
  });

  it('a save from before the sound settings picks up their defaults and keeps its music choice', async () => {
    const saved = { musicVolume: 0.3, musicMuted: true };
    const { useAppStore } = await bootStore({ [SETTINGS]: JSON.stringify(saved) });
    expect(useAppStore.getState().settings).toMatchObject({
      musicVolume: 0.3,
      musicMuted: true,
      masterVolume: 1,
      ambienceVolume: 0.8,
      effectsVolume: 0.8,
      soundMuted: false,
    });
  });

  it('the sound settings: in-range values kept, out-of-range clamped, wrong types and non-finite fall back', async () => {
    const { sanitizeSettings, defaultSettings } = await bootStore({});
    expect(sanitizeSettings({ masterVolume: 0.25, ambienceVolume: 0, effectsVolume: 1, soundMuted: true })).toMatchObject({
      masterVolume: 0.25,
      ambienceVolume: 0,
      effectsVolume: 1,
      soundMuted: true,
    });
    expect(sanitizeSettings({ masterVolume: 7, ambienceVolume: -2, effectsVolume: 1.0001 })).toMatchObject({
      masterVolume: 1,
      ambienceVolume: 0,
      effectsVolume: 1,
    });
    // JSON cannot carry NaN or Infinity, but a hand-made object can.
    for (const bad of [Number.NaN, Infinity, -Infinity, '0.5', null, true, [0.5], { v: 0.5 }]) {
      const s = sanitizeSettings({ masterVolume: bad, ambienceVolume: bad, effectsVolume: bad, soundMuted: bad });
      expect(s.masterVolume, String(bad)).toBe(defaultSettings.masterVolume);
      expect(s.ambienceVolume, String(bad)).toBe(defaultSettings.ambienceVolume);
      expect(s.effectsVolume, String(bad)).toBe(defaultSettings.effectsVolume);
      if (typeof bad !== 'boolean') expect(s.soundMuted, String(bad)).toBe(defaultSettings.soundMuted);
    }
    expect(sanitizeSettings({ soundMuted: 'true' }).soundMuted).toBe(false);
  });

  it('the sound settings persist through updateSettings and a reload', async () => {
    const data: Record<string, string> = {};
    const first = await bootStore(data);
    first.useAppStore.getState().updateSettings({ masterVolume: 0.5, effectsVolume: 0.2, soundMuted: true });
    const second = await bootStore(data);
    expect(second.useAppStore.getState().settings).toMatchObject({
      masterVolume: 0.5,
      ambienceVolume: 0.8,
      effectsVolume: 0.2,
      soundMuted: true,
    });
  });

  it('accepts every quality tier, including saves from before medium/auto existed', async () => {
    const { sanitizeSettings } = await bootStore({});
    for (const q of ['auto', 'high', 'medium', 'low'] as const) {
      expect(sanitizeSettings({ quality: q }).quality).toBe(q);
    }
  });

  it('non-object or non-numeric junk gives the defaults', async () => {
    for (const raw of ['"x"', '42', 'null', '{"mouseSensitivity":"1.5","quality":7}']) {
      const { useAppStore, defaultSettings } = await bootStore({ [SETTINGS]: raw });
      expect(useAppStore.getState().settings, raw).toEqual(defaultSettings);
    }
  });

  it('sanitizeSettings is total', async () => {
    const { sanitizeSettings, defaultSettings } = await bootStore({});
    expect(sanitizeSettings(undefined)).toEqual(defaultSettings);
    expect(sanitizeSettings({ mouseSensitivity: 0.1 }).mouseSensitivity).toBe(0.5);
    expect(sanitizeSettings({ mouseSensitivity: 1.25, quality: 'low' })).toMatchObject({
      mouseSensitivity: 1.25,
      quality: 'low',
    });
  });
});

describe('prefers-reduced-motion', () => {
  const stubMotion = (reduce: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), media: q })),
    );

  it('defaults skipIntros on when the OS asks for reduced motion', async () => {
    stubMotion(true);
    const { useAppStore, defaultSettings } = await bootStore({});
    expect(defaultSettings.skipIntros).toBe(true);
    expect(useAppStore.getState().settings.skipIntros).toBe(true);
  });

  it('a saved choice still wins', async () => {
    stubMotion(true);
    const { useAppStore } = await bootStore({ [SETTINGS]: '{"skipIntros":false}' });
    expect(useAppStore.getState().settings.skipIntros).toBe(false);
  });

  it('changing another setting does not freeze skipIntros at the OS default', async () => {
    stubMotion(true);
    const data: Record<string, string> = {};
    const { useAppStore } = await bootStore(data);
    useAppStore.getState().updateSettings({ quality: 'low' });
    expect(useAppStore.getState().settings.skipIntros).toBe(true);
    expect(JSON.parse(data[SETTINGS])).not.toHaveProperty('skipIntros');
    useAppStore.getState().updateSettings({ skipIntros: false });
    expect(JSON.parse(data[SETTINGS]).skipIntros).toBe(false);
    useAppStore.getState().updateSettings({ quality: 'high' });
    expect(JSON.parse(data[SETTINGS]).skipIntros).toBe(false);
  });

  it('stays off without the preference', async () => {
    stubMotion(false);
    const { defaultSettings } = await bootStore({});
    expect(defaultSettings.skipIntros).toBe(false);
  });
});

describe('auto quality is remembered between visits', () => {
  const KEY = 'iceberg-river.autoQuality.v1';

  it('starts at high on a first visit, then at the tier auto settled on', async () => {
    const data: Record<string, string> = {};
    const first = await bootStore(data);
    expect(first.useAppStore.getState().autoQuality).toBe('high');
    first.useAppStore.getState().queueAutoQuality('medium');
    first.useAppStore.getState().applyPendingAutoQuality();
    expect(JSON.parse(data[KEY])).toBe('medium');
    const second = await bootStore(data);
    expect(second.useAppStore.getState().autoQuality).toBe('medium');
  });

  it('a measured step is saved at once, even if the visit ends before it is applied', async () => {
    const data: Record<string, string> = {};
    const first = await bootStore(data);
    first.useAppStore.getState().queueAutoQuality('medium');
    expect(first.useAppStore.getState().autoQuality).toBe('high');
    const second = await bootStore(data);
    expect(second.useAppStore.getState().autoQuality).toBe('medium');
  });

  it('ignores a corrupt saved tier, and choosing Auto again re-measures from high', async () => {
    const { useAppStore } = await bootStore({ [KEY]: '"ultra"' });
    expect(useAppStore.getState().autoQuality).toBe('high');
    useAppStore.getState().setAutoQuality('low');
    useAppStore.getState().updateSettings({ quality: 'medium' });
    expect(useAppStore.getState().autoQuality).toBe('low');
    useAppStore.getState().updateSettings({ quality: 'auto' });
    expect(useAppStore.getState().autoQuality).toBe('high');
  });
});

describe('several tabs share one save', () => {
  // Regression (review INTEGRATION #6): this tab booted with empty progress, another tab then saved
  // {61 s, 2305 pts, 3 completions}; finishing here in 80 s / 1900 pts stored {80, 1900, 1}.
  it('a completion merges with what another tab saved instead of overwriting it', async () => {
    const data: Record<string, string> = {};
    const { useAppStore } = await bootStore(data);
    data[PROGRESS] = JSON.stringify(progressWith({ bestTime: 61, bestScore: 2305, completions: 3 }));
    useAppStore.getState().recordCompletion(stats(80, 1900));
    const expected = { bestTime: 61, bestScore: 2305, completions: 4 };
    expect((JSON.parse(data[PROGRESS]) as Progress).completed.level1).toEqual(expected);
    expect(useAppStore.getState().progress.completed.level1).toEqual(expected);
  });

  it('a better run here still updates the merged record', async () => {
    const data = {
      [PROGRESS]: JSON.stringify(progressWith({ bestTime: 90, bestScore: 1000, completions: 1 })),
    };
    const { useAppStore } = await bootStore(data);
    data[PROGRESS] = JSON.stringify(progressWith({ bestTime: 75, bestScore: 800, completions: 2 }));
    useAppStore.getState().recordCompletion(stats(70, 1500));
    expect(useAppStore.getState().progress.completed.level1).toEqual({
      bestTime: 70,
      bestScore: 1500,
      completions: 3,
    });
  });

  it('a settings change keeps fields another tab changed meanwhile', async () => {
    const data: Record<string, string> = {};
    const { useAppStore } = await bootStore(data);
    data[SETTINGS] = JSON.stringify({ ...useAppStore.getState().settings, quality: 'low' });
    useAppStore.getState().updateSettings({ mouseSteering: false });
    const stored = JSON.parse(data[SETTINGS]) as Record<string, unknown>;
    expect(stored).toMatchObject({ quality: 'low', mouseSteering: false });
    expect(useAppStore.getState().settings).toMatchObject({ quality: 'low', mouseSteering: false });
  });

  it("'storage' events from other tabs refresh progress and settings (sanitised)", async () => {
    const data: Record<string, string> = {};
    const { useAppStore, defaultSettings } = await bootStore(data);

    const other = JSON.stringify(progressWith({ bestTime: 61, bestScore: 2305, completions: 3 }));
    data[PROGRESS] = other;
    fireStorage(PROGRESS, other);
    expect(useAppStore.getState().progress.completed.level1?.bestTime).toBe(61);

    // A reset in another tab is respected rather than merged away.
    data[PROGRESS] = JSON.stringify({ version: 1, completed: {} });
    fireStorage(PROGRESS, data[PROGRESS]);
    expect(useAppStore.getState().progress.completed).toEqual({});

    data[SETTINGS] = '{"quality":"low","mouseSensitivity":null}';
    fireStorage(SETTINGS, data[SETTINGS]);
    expect(useAppStore.getState().settings).toEqual({ ...defaultSettings, quality: 'low' });

    fireStorage('some.other.key', 'x');
    expect(useAppStore.getState().settings.quality).toBe('low');

    // localStorage.clear() in another tab arrives with key === null.
    for (const k of Object.keys(data)) delete data[k];
    fireStorage(null, null);
    expect(useAppStore.getState().settings).toEqual(defaultSettings);
  });
});

describe("'auto' quality steps", () => {
  it('a measured step waits (pending) until applied at a loading screen, and is never saved', async () => {
    const data: Record<string, string> = {};
    const { useAppStore, effectiveQuality } = await bootStore(data);
    const effective = () => {
      const s = useAppStore.getState();
      return effectiveQuality(s.settings.quality, s.autoQuality);
    };
    expect(effective()).toBe('high');
    useAppStore.getState().queueAutoQuality('medium');
    expect(useAppStore.getState().pendingAutoQuality).toBe('medium');
    expect(effective()).toBe('high'); // nothing changes mid-run
    useAppStore.getState().applyPendingAutoQuality();
    expect(effective()).toBe('medium');
    expect(useAppStore.getState().pendingAutoQuality).toBeNull();
    useAppStore.getState().applyPendingAutoQuality(); // nothing pending: no-op
    expect(effective()).toBe('medium');
    // Queueing the tier already in use leaves nothing pending.
    useAppStore.getState().queueAutoQuality('medium');
    expect(useAppStore.getState().pendingAutoQuality).toBeNull();
    expect(data[SETTINGS]).toBeUndefined();
  });
});
