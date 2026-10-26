import { create } from 'zustand';
import { AUDIO_SETTING_DEFAULTS } from '../audio/contract';
import type { RunStats } from '../core/types';
import { chapterById } from '../story/chapters';
import type { ChapterId } from '../story/types';
import { loadJson, saveJson } from './storage';
import {
  emptyProgress,
  isProgress,
  mergeProgress,
  recordCompletion,
  sanitizeProgress,
  type Progress,
} from './progress';

export type Screen =
  | 'mainMenu'
  | 'levelSelect'
  | 'settings'
  | 'howToPlay'
  | 'quit'
  | 'game'
  // Story Mode, The Last Thaw (src/ui/story): chapter progress, a chapter's card, the Archive, the
  // real-world science, the epilogue (reread), and the optional pilot-study survey.
  | 'story'
  | 'storyIntro'
  | 'archive'
  | 'science'
  | 'epilogue'
  | 'pilot';

/** Arcade = the original game (its scoring, LEVEL COMPLETE panel); story = The Last Thaw chapters. */
export type GameMode = 'arcade' | 'story';

/** What the renderer actually does. */
export type RenderQuality = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | RenderQuality;
export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'high', 'medium', 'low'];

const isRenderQuality = (v: unknown): v is RenderQuality => v === 'high' || v === 'medium' || v === 'low';

export const effectiveQuality = (q: QualitySetting, auto: RenderQuality): RenderQuality =>
  q === 'auto' ? auto : q;

export interface Settings {
  /** Steer by moving the mouse left/right of screen centre (keyboard always works too). */
  mouseSteering: boolean;
  /** 0.5 – 2. Scales how far the mouse must move for full steer. */
  mouseSensitivity: number;
  /**
   * 'high' = shadows + bloom, 'medium' = shadows without post-processing, 'low' = neither.
   * 'auto' starts at high and steps down if the measured frame rate is below 60 fps.
   */
  quality: QualitySetting;
  /** Show speed/momentum readout in the HUD. */
  showSpeedometer: boolean;
  /** Skip the intro cinematic automatically. */
  skipIntros: boolean;
  /** Playtesting: every level is playable without finishing the one before it. */
  unlockAllLevels: boolean;
  /** Background music (src/audio/music.ts), 0..1. */
  musicVolume: number;
  musicMuted: boolean;
  /** 0..1, multiplies every channel including the music (src/audio, DESIGN §5). */
  masterVolume: number;
  /** 0..1: river, waterfalls, sea, wind and church bells. */
  ambienceVolume: number;
  /** 0..1: collisions, breaking structures, splashes and the iceberg's slide. */
  effectsVolume: number;
  /** "Mute all sound" (shortcut M); musicMuted stays the separate music mute. */
  soundMuted: boolean;
}

export const SETTINGS_KEY = 'iceberg-river.settings.v1';
/** The tier 'auto' last settled on, so the next visit starts there instead of at 'high'. */
export const AUTO_QUALITY_KEY = 'iceberg-river.autoQuality.v1';
export const PROGRESS_KEY = 'iceberg-river.progress.v1';

export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 2;

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** skipIntros follows prefers-reduced-motion until the player saves their own choice. */
export const defaultSettings: Settings = {
  mouseSteering: true,
  mouseSensitivity: 1,
  quality: 'auto',
  showSpeedometer: true,
  skipIntros: prefersReducedMotion(),
  unlockAllLevels: false,
  musicVolume: 0.6,
  musicMuted: false,
  // Saves from before the sound settings pick these up (masterVolume 1 keeps today's music level).
  ...AUDIO_SETTING_DEFAULTS,
};

/**
 * Field-by-field repair of anything read from storage: each wrong-typed or missing field falls back
 * to its default (sensitivity is clamped into range), unknown keys are dropped. Never throws.
 */
export function sanitizeSettings(v: unknown): Settings {
  const o: Record<string, unknown> =
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const d = defaultSettings;
  const bool = (x: unknown, fallback: boolean): boolean => (typeof x === 'boolean' ? x : fallback);
  /** A finite number clamped into 0..1, otherwise the default. */
  const unit = (x: unknown, fallback: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;
  const sens = o.mouseSensitivity;
  return {
    mouseSteering: bool(o.mouseSteering, d.mouseSteering),
    mouseSensitivity:
      typeof sens === 'number' && Number.isFinite(sens)
        ? Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, sens))
        : d.mouseSensitivity,
    quality: QUALITY_SETTINGS.includes(o.quality as QualitySetting) ? (o.quality as QualitySetting) : d.quality,
    showSpeedometer: bool(o.showSpeedometer, d.showSpeedometer),
    skipIntros: bool(o.skipIntros, d.skipIntros),
    unlockAllLevels: bool(o.unlockAllLevels, d.unlockAllLevels),
    musicVolume: unit(o.musicVolume, d.musicVolume),
    musicMuted: bool(o.musicMuted, d.musicMuted),
    masterVolume: unit(o.masterVolume, d.masterVolume),
    ambienceVolume: unit(o.ambienceVolume, d.ambienceVolume),
    effectsVolume: unit(o.effectsVolume, d.effectsVolume),
    soundMuted: bool(o.soundMuted, d.soundMuted),
  };
}

const isPresent = (v: unknown): v is NonNullable<unknown> => v !== null && v !== undefined;
/** Stored settings, or null when nothing (valid JSON) is stored. */
const readStoredSettings = (): Settings | null => {
  const raw = loadJson<unknown>(SETTINGS_KEY, null, isPresent);
  return raw === null ? null : sanitizeSettings(raw);
};
const loadSettings = (): Settings => readStoredSettings() ?? { ...defaultSettings };
const loadProgress = (): Progress =>
  sanitizeProgress(loadJson(PROGRESS_KEY, emptyProgress(), isProgress));

interface AppState {
  screen: Screen;
  /** Level currently loaded in the game screen (in Story Mode: the chapter's base level). */
  levelId: string | null;
  /** What the game screen plays; set by playLevel (arcade) and playChapter (story). */
  mode: GameMode;
  /** Story Mode: the chapter on screen (card, game) — null before one is chosen. */
  chapterId: ChapterId | null;
  /** Bumped to force a fresh attempt of the same level (restart/replay). */
  attempt: number;
  /** Polygon transition overlay visible. */
  transitioning: boolean;
  settings: Settings;
  progress: Progress;
  /**
   * What 'auto' quality currently resolves to. The measured tier is saved, so a slow machine does
   * not play its first attempt of every visit at 'high'; choosing Auto again in Settings re-measures.
   */
  autoQuality: RenderQuality;
  /**
   * A tier 'auto' measured during play but has not applied yet: switching mid-run relinks every
   * shader at once (a freeze of a second or more), so it waits for the next loading screen, where
   * the warm-up compiles the new variants. null = nothing pending.
   */
  pendingAutoQuality: RenderQuality | null;

  goTo: (screen: Exclude<Screen, 'game'>) => void;
  setAutoQuality: (q: RenderQuality) => void;
  /** Remember a measured tier for the next loading screen (see pendingAutoQuality). */
  queueAutoQuality: (q: RenderQuality) => void;
  /** Apply the pending tier, if any. Call only while nothing is on screen (loading, leaving). */
  applyPendingAutoQuality: () => void;
  /** Load a level and enter the game screen. */
  playLevel: (levelId: string) => void;
  /** Same as playLevel but behind the polygon transition (used by Next Level). */
  playLevelWithTransition: (levelId: string) => void;
  /** Story Mode: show a chapter's card (or, with narrative off, the caller plays it directly). */
  openChapter: (chapterId: ChapterId) => void;
  /** Story Mode: play a chapter (its level plus overlay), optionally behind the transition. */
  playChapter: (chapterId: ChapterId, withTransition?: boolean) => void;
  /** New attempt of the current level without a page reload. */
  restartLevel: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  recordCompletion: (stats: RunStats) => void;
  resetProgress: () => void;
}

export const TRANSITION_MS = 900;

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'mainMenu',
  levelId: null,
  mode: 'arcade',
  chapterId: null,
  attempt: 0,
  transitioning: false,
  settings: loadSettings(),
  progress: loadProgress(),
  autoQuality: loadJson<RenderQuality>(AUTO_QUALITY_KEY, 'high', isRenderQuality),
  pendingAutoQuality: null,

  // From a Story Mode run, the pause / fail panels' 'Level Select' leads to the chapters instead.
  goTo: (screen) =>
    set({ screen: screen === 'levelSelect' && get().screen === 'game' && get().mode === 'story' ? 'story' : screen }),
  setAutoQuality: (autoQuality) => {
    saveJson(AUTO_QUALITY_KEY, autoQuality);
    set({ autoQuality, pendingAutoQuality: null });
  },
  // Saved at once (the next visit starts there even if this one ends before a loading screen);
  // applied in this visit only at the next loading screen.
  queueAutoQuality: (q) => {
    saveJson(AUTO_QUALITY_KEY, q);
    set({ pendingAutoQuality: q === get().autoQuality ? null : q });
  },
  applyPendingAutoQuality: () => {
    const pending = get().pendingAutoQuality;
    if (pending === null) return;
    saveJson(AUTO_QUALITY_KEY, pending);
    set({ autoQuality: pending, pendingAutoQuality: null });
  },
  playLevel: (levelId) => set((s) => ({ screen: 'game', mode: 'arcade', levelId, attempt: s.attempt + 1 })),
  playLevelWithTransition: (levelId) => {
    if (get().transitioning) return;
    set({ transitioning: true });
    setTimeout(() => {
      set((s) => ({ screen: 'game', mode: 'arcade', levelId, attempt: s.attempt + 1 }));
      setTimeout(() => set({ transitioning: false }), TRANSITION_MS / 2);
    }, TRANSITION_MS / 2);
  },
  openChapter: (chapterId) => set({ screen: 'storyIntro', mode: 'story', chapterId }),
  playChapter: (chapterId, withTransition = true) => {
    const chapter = chapterById(chapterId);
    if (!chapter || get().transitioning) return;
    const go = (): void =>
      set((s) => ({ screen: 'game', mode: 'story', chapterId, levelId: chapter.levelId, attempt: s.attempt + 1 }));
    if (!withTransition) {
      go();
      return;
    }
    set({ transitioning: true });
    setTimeout(() => {
      go();
      setTimeout(() => set({ transitioning: false }), TRANSITION_MS / 2);
    }, TRANSITION_MS / 2);
  },
  restartLevel: () => set((s) => ({ attempt: s.attempt + 1 })),
  // Storage is re-read before every write: another tab may have saved since this one loaded.
  updateSettings: (patch) => {
    const raw = loadJson<unknown>(SETTINGS_KEY, null, isPresent);
    const settings = sanitizeSettings({ ...(raw === null ? get().settings : sanitizeSettings(raw)), ...patch });
    // skipIntros follows prefers-reduced-motion until the player sets it: only save it once chosen
    // (in this patch or an earlier save), so changing another setting doesn't freeze the default.
    const chosen =
      'skipIntros' in patch ||
      (typeof raw === 'object' && raw !== null && typeof (raw as { skipIntros?: unknown }).skipIntros === 'boolean');
    const { skipIntros, ...rest } = settings;
    saveJson(SETTINGS_KEY, chosen ? settings : rest);
    set({ settings: { ...rest, skipIntros } });
    // Picking Auto (again) starts a fresh measurement from the top tier.
    if (patch.quality === 'auto') get().setAutoQuality('high');
  },
  recordCompletion: (stats) => {
    const stored = loadJson(PROGRESS_KEY, emptyProgress(), isProgress);
    const progress = recordCompletion(mergeProgress(get().progress, stored), stats);
    saveJson(PROGRESS_KEY, progress);
    set({ progress });
  },
  resetProgress: () => {
    const progress = emptyProgress();
    saveJson(PROGRESS_KEY, progress);
    set({ progress });
  },
}));

/** Other tabs' writes (key === null means storage was cleared). Replaces rather than merges, so a
 * reset in one tab is not undone by another. */
function onStorage(e: StorageEvent): void {
  if (e.key === null || e.key === SETTINGS_KEY) useAppStore.setState({ settings: loadSettings() });
  if (e.key === null || e.key === PROGRESS_KEY) useAppStore.setState({ progress: loadProgress() });
}

if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
