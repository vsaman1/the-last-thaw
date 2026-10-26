/**
 * The level a Story Mode chapter plays: its base level (src/core/levels) plus the chapter's overlay of
 * extra human structures and the roads they stand on. Nothing of the base level changes: overlay
 * obstacles are APPENDED (so every base index — landmark bindings, physics bodies' `placement`,
 * world-logic reports — stays valid) and overlay features are appended after the base features (so
 * KickerLip.index and friends stay valid too). The base LevelDef is never mutated.
 *
 * Why the id changes: terrains are cached per level id (src/core/session.ts getTerrain), and both the
 * terrain (bridge cuttings, roads) and the physics world (it spawns terrain.level.obstacles) are built
 * from the level the terrain was made for. A chapter that adds anything must therefore get its own id,
 * or a session would silently reuse the base terrain and spawn none of the overlay. A chapter without
 * an overlay plays the base level object itself and shares its cached terrain.
 */
import { getLevel } from '../core/levels';
import type { LevelDef } from '../core/types';
import type { ChapterDef, LandmarkDef } from './types';

/** Separator between the base level id and the chapter id in a story level's id. */
export const STORY_LEVEL_SEP = '~';

const hasOverlay = (c: ChapterDef): boolean =>
  c.overlay.obstacles.length > 0 || (c.overlay.features?.length ?? 0) > 0;

/** Built story levels, per chapter object (the same chapter always yields the same LevelDef). */
const built = new WeakMap<ChapterDef, LevelDef>();

/**
 * The chapter's level: `base` (default: the level with chapter.levelId) plus the overlay. Returns
 * the base object itself when the chapter adds nothing; otherwise a new LevelDef with id
 * `${base.id}~${chapter.id}` whose obstacles and features are new arrays.
 */
export function storyLevel(chapter: ChapterDef, base: LevelDef = getLevel(chapter.levelId)): LevelDef {
  if (!hasOverlay(chapter)) return base;
  const cached = built.get(chapter);
  if (cached && cached.id === storyLevelId(chapter, base)) return cached;
  const level: LevelDef = {
    ...base,
    id: storyLevelId(chapter, base),
    obstacles: [...base.obstacles, ...chapter.overlay.obstacles],
    features: [...(base.features ?? []), ...(chapter.overlay.features ?? [])],
  };
  built.set(chapter, level);
  return level;
}

/** The id storyLevel(chapter) will carry. */
export function storyLevelId(chapter: ChapterDef, base: LevelDef = getLevel(chapter.levelId)): string {
  return hasOverlay(chapter) ? `${base.id}${STORY_LEVEL_SEP}${chapter.id}` : base.id;
}

/**
 * Index into storyLevel(chapter).obstacles of the placement a landmark points at (its `index`; see
 * landmarkPlacements for all of them): the base index as is, an overlay index after all base
 * obstacles. -1 when the binding points nowhere.
 */
export function landmarkPlacement(
  chapter: ChapterDef,
  landmark: LandmarkDef,
  base: LevelDef = getLevel(chapter.levelId),
): number {
  return resolveBinding(landmark.bind, base.obstacles.length, chapter.overlay.obstacles.length);
}

/**
 * Every placement a landmark binds (its `index` first, then `also`), as indices into
 * storyLevel(chapter).obstacles; -1 for each that points nowhere.
 */
export function landmarkPlacements(
  chapter: ChapterDef,
  landmark: LandmarkDef,
  base: LevelDef = getLevel(chapter.levelId),
): number[] {
  return resolveBindings(landmark.bind, base.obstacles.length, chapter.overlay.obstacles.length);
}

/**
 * The same resolution from counts alone: `baseCount` base obstacles followed by `overlayCount`
 * overlay obstacles (a story level has baseCount + overlayCount). -1 when out of range. `also` is
 * not read here: resolveBindings resolves every placement of a landmark.
 */
export function resolveBinding(bind: LandmarkDef['bind'], baseCount: number, overlayCount: number): number {
  const { source, index } = bind;
  if (!Number.isInteger(index) || index < 0) return -1;
  if (source === 'base') return index < baseCount ? index : -1;
  return index < overlayCount ? baseCount + index : -1;
}

/** resolveBinding for each placement a landmark binds: `index`, then every `also` index. */
export function resolveBindings(bind: LandmarkDef['bind'], baseCount: number, overlayCount: number): number[] {
  return [bind.index, ...(bind.also ?? [])].map((index) => resolveBinding({ source: bind.source, index }, baseCount, overlayCount));
}

/** Placement index → landmark id for every resolvable placement of the chapter's landmarks. */
export function landmarkIndex(
  chapter: ChapterDef,
  base: LevelDef = getLevel(chapter.levelId),
): Map<number, string> {
  const out = new Map<number, string>();
  for (const lm of chapter.landmarks) {
    for (const p of landmarkPlacements(chapter, lm, base)) if (p >= 0 && !out.has(p)) out.set(p, lm.id);
  }
  return out;
}

/**
 * Problems with a chapter's bindings (empty when it is sound): landmarks that point nowhere (any of
 * their placements), duplicate landmark ids, two landmarks on one placement (or one landmark naming a
 * placement twice), the chapter on an unknown level.
 */
export function chapterBindingIssues(chapter: ChapterDef): string[] {
  const issues: string[] = [];
  let base: LevelDef;
  try {
    base = getLevel(chapter.levelId);
  } catch {
    return [`${chapter.id}: unknown level '${chapter.levelId}'`];
  }
  const ids = new Set<string>();
  const used = new Map<number, string>();
  for (const lm of chapter.landmarks) {
    if (ids.has(lm.id)) issues.push(`${chapter.id}: duplicate landmark id '${lm.id}'`);
    ids.add(lm.id);
    const indices = [lm.bind.index, ...(lm.bind.also ?? [])];
    landmarkPlacements(chapter, lm, base).forEach((p, k) => {
      if (p < 0) {
        issues.push(`${chapter.id}: landmark '${lm.id}' binds ${lm.bind.source}[${indices[k]}], which does not exist`);
        return;
      }
      const other = used.get(p);
      if (other === lm.id) issues.push(`${chapter.id}: landmark '${lm.id}' binds placement ${p} twice`);
      else if (other) issues.push(`${chapter.id}: landmarks '${other}' and '${lm.id}' share placement ${p}`);
      used.set(p, lm.id);
    });
  }
  return issues;
}
