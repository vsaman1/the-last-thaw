import type { LevelDef, RunStats } from '../core/types';

export interface LevelRecord {
  bestTime: number;
  bestScore: number;
  completions: number;
}

export interface Progress {
  version: 1;
  completed: Record<string, LevelRecord>;
}

export const emptyProgress = (): Progress => ({ version: 1, completed: {} });

export function isProgress(v: unknown): v is Progress {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Partial<Progress>;
  return p.version === 1 && typeof p.completed === 'object' && p.completed !== null;
}

export function isLevelRecord(v: unknown): v is LevelRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<Record<keyof LevelRecord, unknown>>;
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  return (
    finite(r.bestTime) &&
    r.bestTime > 0 &&
    finite(r.bestScore) &&
    finite(r.completions) &&
    r.completions >= 0
  );
}

/**
 * Per-level union of two saves (best time = min, best score = max, completions = max), keeping only
 * well-formed records. Used to fold in what another tab saved before writing.
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const completed: Record<string, LevelRecord> = {};
  for (const src of [a.completed, b.completed]) {
    for (const id of Object.keys(src)) {
      const rec: unknown = src[id];
      if (id === '__proto__' || !isLevelRecord(rec)) continue;
      const prev = completed[id];
      completed[id] = prev
        ? {
            bestTime: Math.min(prev.bestTime, rec.bestTime),
            bestScore: Math.max(prev.bestScore, rec.bestScore),
            completions: Math.max(prev.completions, rec.completions),
          }
        : { bestTime: rec.bestTime, bestScore: rec.bestScore, completions: rec.completions };
    }
  }
  return { version: 1, completed };
}

/** Drops malformed level records from a loaded save. */
export const sanitizeProgress = (p: Progress): Progress => mergeProgress(p, emptyProgress());

/**
 * Level n is playable if it is the first level or level n-1 has been completed, or always when
 * `unlockAll` (the playtesting setting) is on.
 */
export function isUnlocked(
  levels: readonly LevelDef[],
  progress: Progress,
  levelId: string,
  unlockAll = false,
): boolean {
  const sorted = [...levels].sort((a, b) => a.index - b.index);
  const i = sorted.findIndex((l) => l.id === levelId);
  if (i < 0) return false;
  if (i === 0 || unlockAll) return true;
  return progress.completed[sorted[i - 1].id] !== undefined;
}

export function recordCompletion(progress: Progress, stats: RunStats): Progress {
  const prev = progress.completed[stats.levelId];
  const rec: LevelRecord = prev
    ? {
        bestTime: Math.min(prev.bestTime, stats.time),
        bestScore: Math.max(prev.bestScore, stats.score),
        completions: prev.completions + 1,
      }
    : { bestTime: stats.time, bestScore: stats.score, completions: 1 };
  return { ...progress, completed: { ...progress.completed, [stats.levelId]: rec } };
}

/** The level after `levelId` in display order, or null if it was the last. */
export function nextLevelId(levels: readonly LevelDef[], levelId: string): string | null {
  const sorted = [...levels].sort((a, b) => a.index - b.index);
  const i = sorted.findIndex((l) => l.id === levelId);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1].id : null;
}
