/**
 * The app's sound director (DESIGN §2.1, §5, §8): the one place the UI talks to the AudioManager.
 *
 * - Settings → audio levels (master, music, ambience, effects, the two mutes), on every change.
 * - Unlock: browsers keep audio locked until a gesture, so the first click, tap or key press anywhere
 *   unlocks it (capture phase, until the context runs).
 * - A hidden tab pauses the music and suspends the sound; showing it again brings them back.
 * - Which cue plays where (src/ui/story/music.ts), the bed under it, and the bake set of the level the
 *   player is most likely to play next, asked for as early as it is known (the bank bakes without a
 *   context, so even before the first gesture):
 *     main menu      the Play button's level;
 *     level select   the focused (or hovered) card, else the card that takes the focus first;
 *     Story          the focused chapter, else the chapter to continue with;
 *     chapter card   its chapter; in the game, the level (and chapter) on screen. Retry keeps the set.
 * - While the loading overlay covers the game screen, the bank may bake in bigger slices
 *   (AudioManager.setLoadingScreen).
 * - Story's app-level moments (src/audio/story/moments.ts): the revelation, the epilogue, the ch8 card.
 * - M mutes and unmutes all sound (saved like the toggle in Settings), announced as "Sound off" /
 *   "Sound on" in a polite live region. Ignored with Ctrl, Alt or Meta, where a letter types or picks
 *   something (text fields, a select's type-ahead, editable text), on key repeat and during the
 *   polygon transition. On a slider, a checkbox or a button it works (letters do nothing there).
 *
 * Installed once (idempotent, reference counted: StrictMode's double effects never leave two
 * subscriptions live) from the App; everything is a store subscription or a window listener.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { CHAPTER_MIX, type AudioLevels, type AudioManager } from '../../audio/contract';
import { LEVELS } from '../../core/levels';
import { audioEngine } from '../../audio/game/engine';
import { levelSoundSet } from '../../audio/game/levelSet';
import { levelsFromSettings, sameLevels } from '../../audio/settings';
import { StoryMoments, windowTimers, type MomentInputs, type MomentTimers } from '../../audio/story/moments';
import { useAppStore } from '../../state/appStore';
import { useGameStore } from '../../state/gameStore';
import { nextChapter, useStoryStore } from '../../state/storyStore';
import { chapterById } from '../../story/chapters';
import type { ChapterId } from '../../story/types';
import { pickPlayLevel } from '../actions';
import { useStoryRun } from '../story/storyRun';
import { cueFor, trimFor } from '../story/music';

export const SOUND_OFF_TEXT = 'Sound off';
export const SOUND_ON_TEXT = 'Sound on';

/** What the live region says (the App renders it). */
export const useSoundAnnouncement = create<{ text: string }>(() => ({ text: '' }));

/** Gestures that unlock audio on every input type (pointerdown alone does not grant activation on touch). */
const GESTURES = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'] as const;

/** Input types where a letter key is typed (an input with no type is a text field). */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['', 'text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week']);

/**
 * True where a letter key already means something: text entry, a select's type-ahead, editable
 * text. A range slider, a checkbox, a radio button or a button ignore letters, so M works there.
 */
export function takesLetters(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).tagName !== 'string') return false;
  const e = el as HTMLElement;
  if (e.isContentEditable === true || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT') return true;
  if (e.tagName !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.has((e.getAttribute('type') ?? '').toLowerCase());
}

/** The M shortcut: plain M (either case), not where a letter types, not held down. */
export function isMuteKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return false;
  if (takesLetters(e.target)) return false;
  return e.code === 'KeyM' || e.key === 'm' || e.key === 'M';
}

export interface DirectorOptions {
  readonly engine?: () => AudioManager;
  readonly timers?: MomentTimers;
}

interface Installed {
  count: number;
  uninstall: () => void;
}

let installed: Installed | null = null;

/** A level (and chapter) to bake for. */
interface SoundTarget {
  readonly levelId: string;
  readonly chapterId: ChapterId | null;
}

/** What the player has focused or hovered on the level select or the Story menu (cleared on any screen change). */
let focusTarget: SoundTarget | null = null;
let onFocusTarget: (() => void) | null = null;
/** Focus moves across cards faster than a set bakes: only a target held this long is asked for. */
export const FOCUS_PREPARE_MS = 200;
let focusTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The level select and the Story menu call this when a card or a chapter row takes the focus or the
 * pointer: its sounds start baking (after FOCUS_PREPARE_MS; the latest target wins).
 */
export function prepareSoundFor(levelId: string, chapterId: ChapterId | null = null): void {
  if (focusTimer !== null) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    focusTimer = null;
    focusTarget = { levelId, chapterId };
    onFocusTarget?.();
  }, FOCUS_PREPARE_MS);
}

/** The set to bake on this screen (null: keep whatever is prepared). */
function soundTarget(screen: string, mode: string, chapterId: ChapterId | null, levelId: string | null): SoundTarget | null {
  if (screen === 'game' && levelId) return { levelId, chapterId: mode === 'story' ? chapterId : null };
  if (screen === 'storyIntro' && chapterId) {
    const chapter = chapterById(chapterId);
    return chapter ? { levelId: chapter.levelId, chapterId } : null;
  }
  if ((screen === 'levelSelect' || screen === 'story') && focusTarget) return focusTarget;
  const app = useAppStore.getState();
  if (screen === 'mainMenu' || screen === 'levelSelect') {
    // The main menu's Play button; the level select's first focus (the same pick, honouring unlock-all).
    const id = pickPlayLevel(LEVELS, app.progress, screen === 'levelSelect' && app.settings.unlockAllLevels);
    return id ? { levelId: id, chapterId: null } : null;
  }
  if (screen === 'story') {
    const chapter = chapterById(nextChapter(useStoryStore.getState().progress));
    return chapter ? { levelId: chapter.levelId, chapterId: chapter.id } : null;
  }
  return null;
}

function install(options: DirectorOptions): () => void {
  const engine = options.engine ?? audioEngine;
  const moments = new StoryMoments(engine, options.timers ?? windowTimers);
  const offs: (() => void)[] = [];

  // --- settings ----------------------------------------------------------------------------------
  let levels: AudioLevels | null = null;
  const applySettings = (): void => {
    const next = levelsFromSettings(useAppStore.getState().settings);
    if (levels !== null && sameLevels(levels, next)) return;
    levels = next;
    engine().applySettings(next);
  };

  // --- cue, trim, bake set ----------------------------------------------------------------------
  let placeKey = '';
  let prepared = '';
  let heldEntry = false;
  let lastScreen = '';
  const prepareTarget = (): void => {
    const { screen, mode, chapterId, levelId } = useAppStore.getState();
    const want = soundTarget(screen, mode, chapterId, levelId);
    if (!want) return;
    const k = `${want.levelId}|${want.chapterId}`;
    if (k === prepared) return;
    prepared = k;
    try {
      engine().prepare(levelSoundSet(want.levelId, want.chapterId));
    } catch {
      // An unknown level id (a test shell): nothing to bake.
    }
  };
  onFocusTarget = prepareTarget;
  const applyPlace = (): void => {
    const { screen, mode, chapterId, levelId } = useAppStore.getState();
    if (screen !== lastScreen) {
      // A focus belongs to the screen it happened on.
      lastScreen = screen;
      focusTarget = null;
    }
    const key = `${screen}|${mode}|${chapterId}|${levelId}`;
    if (key === placeKey) {
      prepareTarget();
      return;
    }
    placeKey = key;
    const music = engine().music;
    // Act III enters late (DESIGN §8.3): no piano from the moment the chapter's level is chosen until
    // its opening caption ends. The attempt's StoryAudio takes the same hold and lets it go.
    const lateEntry = screen === 'game' && mode === 'story' && chapterId !== null && CHAPTER_MIX[chapterId].musicEntry === 'afterCaption';
    if (lateEntry && !heldEntry) music.hold('act3Entry');
    else if (!lateEntry && heldEntry) music.release('act3Entry');
    heldEntry = lateEntry;
    const cue = cueFor(screen, mode, chapterId);
    // Going silent keeps the bed it had: the fade-out never begins with a step up (+2 dB leaving
    // Arcade play, up to +5 dB leaving Act III). The next cue brings its own bed.
    if (cue !== null) music.setTrim(trimFor(screen, mode, chapterId));
    music.setCue(cue);
    prepareTarget();
  };

  // --- the loading overlay (the bank's bigger slices) -------------------------------------------
  let loadingScreen = false;
  const applyLoading = (): void => {
    const on = useAppStore.getState().screen === 'game' && useGameStore.getState().phase === 'loading';
    if (on === loadingScreen) return;
    loadingScreen = on;
    engine().setLoadingScreen(on);
  };

  // --- moments ----------------------------------------------------------------------------------
  const momentInputs = (): MomentInputs => {
    const app = useAppStore.getState();
    const game = useGameStore.getState();
    const run = useStoryRun.getState();
    return {
      screen: app.screen,
      mode: app.mode,
      chapterId: app.chapterId,
      narrative: useStoryStore.getState().progress.settings.narrative,
      viewingRiver: game.viewingRiver,
      phase: game.phase,
      outcome: run.outcome,
      epilogue: run.epilogue,
    };
  };
  const applyMoments = (): void => moments.update(momentInputs());

  // Moments before the cue: a hold taken on entering a card must be in place before its cue is asked for.
  const onApp = (): void => {
    applySettings();
    applyMoments();
    applyPlace();
    applyLoading();
  };
  onApp();
  offs.push(useAppStore.subscribe(onApp));
  offs.push(useGameStore.subscribe((s, p) => {
    if (s.phase !== p.phase || s.viewingRiver !== p.viewingRiver) applyMoments();
    if (s.phase !== p.phase) applyLoading();
  }));
  offs.push(useStoryStore.subscribe((s, p) => {
    if (s.progress.completed !== p.progress.completed) prepareTarget();
  }));
  offs.push(useStoryRun.subscribe((s, p) => {
    if (s.outcome !== p.outcome || s.epilogue !== p.epilogue) applyMoments();
  }));
  offs.push(useStoryStore.subscribe((s, p) => {
    if (s.progress.settings.narrative !== p.progress.settings.narrative) applyMoments();
  }));

  if (typeof window !== 'undefined') {
    // --- unlock on the first gesture (until the context runs) --------------------------------------
    const unlock = (): void => {
      const e = engine();
      e.unlock();
      const st = e.status();
      if (st === 'running' || st === 'unavailable') disarm();
    };
    const disarm = (): void => {
      for (const g of GESTURES) window.removeEventListener(g, unlock, true);
    };
    for (const g of GESTURES) window.addEventListener(g, unlock, true);
    offs.push(disarm);

    // --- hidden tab ----------------------------------------------------------------------------------
    const onVisibility = (): void => engine().setHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    offs.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // --- M: mute all ---------------------------------------------------------------------------------
    const onKey = (e: KeyboardEvent): void => {
      if (!isMuteKey(e)) return;
      const app = useAppStore.getState();
      if (app.transitioning) return;
      e.preventDefault();
      const muted = !app.settings.soundMuted;
      app.updateSettings({ soundMuted: muted });
      // The same words twice in a row (the Settings toggle changed it in between) would not be read
      // again: a trailing no-break space changes the region's text without changing what is heard.
      const text = muted ? SOUND_OFF_TEXT : SOUND_ON_TEXT;
      const same = useSoundAnnouncement.getState().text === text;
      useSoundAnnouncement.setState({ text: same ? `${text} ` : text });
    };
    window.addEventListener('keydown', onKey);
    offs.push(() => window.removeEventListener('keydown', onKey));
  }

  return () => {
    for (const off of offs) off();
    moments.dispose();
    if (heldEntry) engine().music.release('act3Entry');
    if (loadingScreen) engine().setLoadingScreen(false);
    if (onFocusTarget === prepareTarget) onFocusTarget = null;
    if (focusTimer !== null) clearTimeout(focusTimer);
    focusTimer = null;
    focusTarget = null;
  };
}

/** Install the director (idempotent, reference counted); returns this caller's uninstaller. */
export function installAudioDirector(options: DirectorOptions = {}): () => void {
  if (!installed) {
    const uninstall = install(options);
    installed = { count: 0, uninstall };
  }
  const mine = installed;
  mine.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mine.count--;
    if (mine.count === 0 && installed === mine) {
      installed = null;
      mine.uninstall();
    }
  };
}

/** Settings preview (DESIGN §5, P1): releasing a slider plays that channel at most this often. */
export const PREVIEW_MIN_SEC = 0.4;
let lastPreviewMs = -Infinity;

/**
 * Let the player hear the level they just set: the engine plays a stone hit (effects) or a distant
 * church bell (ambience), and dips the music while it does. Throttled, so holding an arrow key or
 * dragging back and forth never stacks previews.
 */
export function previewSound(kind: 'effects' | 'ambience', nowMs: number = performance.now()): boolean {
  if (nowMs - lastPreviewMs < PREVIEW_MIN_SEC * 1000) return false;
  lastPreviewMs = nowMs;
  audioEngine().preview(kind);
  return true;
}

/** Tests: forget the last preview. */
export const resetPreviewThrottle = (): void => {
  lastPreviewMs = -Infinity;
};

/** The App's hook: runs the director while mounted; returns what the live region should say. */
export function useAudioDirector(): string {
  useEffect(() => installAudioDirector(), []);
  return useSoundAnnouncement((s) => s.text);
}
