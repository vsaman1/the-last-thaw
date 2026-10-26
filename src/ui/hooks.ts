import { useEffect, type RefObject } from 'react';
import { gameController } from '../game/controller';
import { isFormControl } from '../input/input';
import { useAppStore } from '../state/appStore';
import { useGameStore } from '../state/gameStore';
import { riverViewControls } from '../state/riverViewControls';
import { restartAttempt, setViewingRiver } from './actions';

const navItems = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-nav]')).filter(
    (el) => !(el as HTMLButtonElement).disabled,
  );

/** Number of items sharing the first item's row (1 in a vertical stack, n in a single row). */
function columnsOf(items: HTMLElement[]): number {
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  let cols = 0;
  while (cols < items.length && items[cols].offsetTop === top) cols++;
  return Math.max(1, cols);
}

export interface ArrowNavOptions {
  /** Focus the [data-autofocus] item (else the first item) on mount. Default true. */
  autoFocus?: boolean;
  /** Re-run auto focus when this value changes (e.g. when a panel's content swaps). */
  focusKey?: unknown;
}

/**
 * Arrow keys / Home / End move focus between the [data-nav] elements inside `ref`; Enter and
 * Space activate them natively. Works from <body> too, so the very first arrow press lands in
 * the menu. Ignored while a form control (slider, radio) has focus.
 */
export function useArrowNavigation(
  ref: RefObject<HTMLElement | null>,
  { autoFocus = true, focusKey }: ArrowNavOptions = {},
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !autoFocus) return;
    const items = navItems(root);
    const preferred = items.find((el) => el.hasAttribute('data-autofocus')) ?? items[0];
    preferred?.focus({ preventScroll: true });
  }, [ref, autoFocus, focusKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const root = ref.current;
      if (!root || e.ctrlKey || e.metaKey || e.altKey || isFormControl(e.target)) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !root.contains(active)) return;
      const items = navItems(root);
      const n = items.length;
      if (n === 0) return;
      const i = active ? items.indexOf(active) : -1;
      const cols = columnsOf(items);
      const vStep = cols >= n ? 1 : cols;
      let next: number;
      switch (e.key) {
        case 'ArrowRight':
          next = i < 0 ? 0 : (i + 1) % n;
          break;
        case 'ArrowLeft':
          next = i < 0 ? n - 1 : (i - 1 + n) % n;
          break;
        case 'ArrowDown':
          next = i < 0 ? 0 : i + vStep < n ? i + vStep : vStep === 1 ? 0 : i;
          break;
        case 'ArrowUp':
          next = i < 0 ? n - 1 : i - vStep >= 0 ? i - vStep : vStep === 1 ? n - 1 : i;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      items[next].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}

/** Escape returns to the main menu from a sub-screen. */
export function useEscapeToMenu(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (useAppStore.getState().transitioning) return;
      e.preventDefault();
      useAppStore.getState().goTo('mainMenu');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

const RESTARTABLE = new Set(['playing', 'paused', 'failed', 'complete']);

/** River view: zoom factor per + / − press, and orbit (rad) / pan (screen heights) per arrow press. */
export const RIVER_KEYS = { zoom: 1.25, orbit: 0.08, tilt: 0.05, pan: 0.08 } as const;

/** River-view keys (held keys repeat); true when the key was one of them. */
function riverViewKey(e: KeyboardEvent): boolean {
  const c = riverViewControls;
  const K = RIVER_KEYS;
  switch (e.key) {
    case 'Home':
      if (!e.repeat) c.reset();
      return true;
    case '+':
    case '=':
      c.zoom(1 / K.zoom);
      return true;
    case '-':
    case '_':
      c.zoom(K.zoom);
      return true;
    case 'ArrowLeft':
      if (e.shiftKey) c.pan(-K.pan, 0);
      else c.rotate(-K.orbit, 0);
      return true;
    case 'ArrowRight':
      if (e.shiftKey) c.pan(K.pan, 0);
      else c.rotate(K.orbit, 0);
      return true;
    case 'ArrowUp':
      if (e.shiftKey) c.pan(0, K.pan);
      else c.rotate(0, K.tilt);
      return true;
    case 'ArrowDown':
      if (e.shiftKey) c.pan(0, -K.pan);
      else c.rotate(0, -K.tilt);
      return true;
    default:
      return false;
  }
}

/**
 * Global in-game shortcuts: Esc / P toggle pause, R restarts, Space skips the intro; on LEVEL
 * COMPLETE, V toggles the river view and Esc leaves it (and otherwise does nothing). In the river
 * view, Home resets the camera, + / − zoom, arrows orbit and Shift+arrows pan. Other keys with
 * Shift, and every key with Ctrl/Alt/Meta, are left alone (Ctrl+R still reloads, Ctrl + / − still
 * zoom the page), as is anything typed into a form control. Also pauses automatically when the
 * tab is hidden or the window loses focus.
 */
export function useGameKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || isFormControl(e.target)) return;
      if (useAppStore.getState().transitioning) return;
      const { phase, loadError, viewingRiver } = useGameStore.getState();
      if (phase === 'complete' && viewingRiver && riverViewKey(e)) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (phase === 'complete' && (k === 'v' || e.code === 'KeyV' || k === 'Escape')) {
        e.preventDefault();
        if (e.repeat) return;
        if (k === 'Escape') {
          if (viewingRiver) setViewingRiver(false);
        } else {
          setViewingRiver(!viewingRiver);
        }
        return;
      }
      if (k === 'Escape' || k === 'p' || e.code === 'KeyP') {
        if (phase === 'loading' && loadError && k === 'Escape') {
          e.preventDefault();
          gameController.quitToMenu();
          return;
        }
        if (phase === 'playing' || phase === 'intro') {
          e.preventDefault();
          if (!e.repeat) gameController.pause();
        } else if (phase === 'paused') {
          e.preventDefault();
          if (!e.repeat) gameController.resume();
        }
        return;
      }
      if (k === 'r' || e.code === 'KeyR') {
        if (!RESTARTABLE.has(phase)) return;
        e.preventDefault();
        if (!e.repeat) restartAttempt();
        return;
      }
      if (k === ' ' || e.code === 'Space') {
        if (phase !== 'intro') return;
        e.preventDefault();
        if (!e.repeat) gameController.skipIntro();
      }
    };

    const autoPause = (): void => {
      if (useGameStore.getState().phase === 'playing') gameController.pause();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') autoPause();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', autoPause);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
