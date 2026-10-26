import { useAppStore } from '../state/appStore';
import { useGameStore } from '../state/gameStore';

/** What the active session exposes to UI buttons and keyboard shortcuts. */
export interface SessionControls {
  pause(): void;
  resume(): void;
  skipIntro(): void;
}

let active: SessionControls | null = null;

/** The running session registers here; returns an unregister function. */
export function registerSession(s: SessionControls): () => void {
  active = s;
  return () => {
    if (active === s) active = null;
  };
}

/** Single entry point for UI → game actions. Safe to call when no level is running. */
export const gameController = {
  pause: () => active?.pause(),
  // Resuming onto a lost WebGL context would play blind: wait until the browser restores it.
  resume: () => {
    if (!useGameStore.getState().contextLost) active?.resume();
  },
  skipIntro: () => active?.skipIntro(),
  restart: () => useAppStore.getState().restartLevel(),
  quitToMenu: () => useAppStore.getState().goTo('mainMenu'),
  toLevelSelect: () => useAppStore.getState().goTo('levelSelect'),
};
