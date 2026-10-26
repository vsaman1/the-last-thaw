/** UI-side actions shared by menus, overlays and keyboard shortcuts. */
import { LEVELS } from '../core/levels';
import type { LevelDef } from '../core/types';
import { gameController } from '../game/controller';
import { useAppStore } from '../state/appStore';
import { emptyHud, useGameStore } from '../state/gameStore';
import { isUnlocked, type Progress } from '../state/progress';

/** Levels sorted by display index. */
export function sortedLevels(levels: readonly LevelDef[] = LEVELS): LevelDef[] {
  return [...levels].sort((a, b) => a.index - b.index);
}

/** Main-menu Play target: the first unlocked level not yet completed, else the first level. */
export function pickPlayLevel(
  levels: readonly LevelDef[],
  progress: Progress,
  unlockAll = false,
): string | null {
  const sorted = sortedLevels(levels);
  if (sorted.length === 0) return null;
  const next = sorted.find(
    (l) => isUnlocked(levels, progress, l.id, unlockAll) && !progress.completed[l.id],
  );
  return (next ?? sorted[0]).id;
}

/** "Level 1 · Mountain Valley" */
export function levelLabel(level: Pick<LevelDef, 'index' | 'name'>): string {
  return `Level ${level.index} · ${level.name}`;
}

export function findLevel(levelId: string | null): LevelDef | null {
  if (!levelId) return null;
  return LEVELS.find((l) => l.id === levelId) ?? null;
}

/** Puts useGameStore back to its initial 'loading' state. */
export function resetGameStore(): void {
  useGameStore.setState({
    phase: 'loading',
    introProgress: 0,
    introStage: 'flyover',
    hud: emptyHud(),
    result: null,
    failReason: null,
    failHint: null,
    viewingRiver: false,
    loadError: null,
  });
}

/** LEVEL COMPLETE only: hide the results panel to look around the finished river, or bring it back. */
export function setViewingRiver(on: boolean): void {
  if (on && useGameStore.getState().phase !== 'complete') return;
  useGameStore.setState({ viewingRiver: on });
}

let uninstallAttemptReset: (() => void) | null = null;

/**
 * Resets useGameStore synchronously whenever appStore starts a new attempt (levelId or attempt
 * changes) — before React mounts the new GameView — so overlays never flash the previous run's
 * phase/result (e.g. the old LEVEL COMPLETE panel after Replay). Leaving the game screen also ends
 * the river view so the camera rig never starts the next visit in orbit mode. Idempotent; returns an
 * uninstaller.
 */
export function installAttemptReset(): () => void {
  if (uninstallAttemptReset) return uninstallAttemptReset;
  const unsub = useAppStore.subscribe((s, prev) => {
    if (s.attempt !== prev.attempt || s.levelId !== prev.levelId) resetGameStore();
    else if (s.screen !== prev.screen && s.screen !== 'game') setViewingRiver(false);
  });
  uninstallAttemptReset = () => {
    unsub();
    uninstallAttemptReset = null;
  };
  return uninstallAttemptReset;
}

export function startLevel(levelId: string, withTransition = true): void {
  const app = useAppStore.getState();
  if (app.transitioning) return;
  if (withTransition) app.playLevelWithTransition(levelId);
  else app.playLevel(levelId);
}

export function restartAttempt(): void {
  if (useAppStore.getState().transitioning) return;
  gameController.restart();
}
