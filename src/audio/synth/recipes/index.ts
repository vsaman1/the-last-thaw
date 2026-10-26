/**
 * Every baked sound (docs/AUDIO_DESIGN.md §6.4) and how it is baked (§6.1).
 *
 * RECIPES is exhaustive over the contract's SoundId: a new id fails the typecheck here until it has a
 * recipe, or is listed as cut. bakeSteps runs a recipe in slices for the bank; bakeSound runs it to
 * the end (the contract's BakeSound). Each buffer's seed is hash(SEED, id, variant), so a bake is
 * identical everywhere, every time.
 *
 * Cut: 'piano.strings' (the Vey strings, a piano struck inside a destroyed house). The lead cut it on
 * 2026-10-21 because a piano heard from a house that has just fallen could read as someone at home.
 * The id stays in the frozen contract; it has no recipe, the bank never bakes it, and a request for
 * it is a silent notReady drop.
 */
import { SOUND_DEFS, type BakeSound, type BakedPcm, type SoundId } from '../../contract';
import { type BakeContext, type Recipe, runSteps } from '../blocks';
import { bakeSeed, finishLoopSteps, finishOneShotSteps, seededRng } from '../dsp';
import { GLASS_RECIPES } from './glass';
import { ICE_RECIPES } from './ice';
import { MACHINE_RECIPES } from './machine';
import { MASONRY_RECIPES } from './masonry';
import { METAL_RECIPES } from './metal';
import { STONE_RECIPES } from './stone';
import { WATER_RECIPES } from './water';
import { WOOD_RECIPES } from './wood';

export type { Recipe } from '../blocks';
export { runSteps } from '../blocks';

/** Sounds the lead cut: no recipe, never baked. */
export const CUT_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>(['piano.strings']);

export const RECIPES: Readonly<Record<SoundId, Recipe | null>> = {
  ...ICE_RECIPES,
  ...STONE_RECIPES,
  ...WOOD_RECIPES,
  ...GLASS_RECIPES,
  ...METAL_RECIPES,
  ...MASONRY_RECIPES,
  ...WATER_RECIPES,
  ...MACHINE_RECIPES,
  'piano.strings': null,
};

/** True when the sound has a recipe (every SoundId except the cut ones). */
export const bakeable = (id: SoundId): boolean => RECIPES[id] !== null;

/**
 * Bakes one variant in steps: each `yield` is a point where the bank may stop for this slice. The
 * return value is the finished PCM (bake rules applied).
 */
export function* bakeSteps(id: SoundId, variant: number, seed: number): Generator<void, BakedPcm, void> {
  const def = SOUND_DEFS[id];
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`bakeSound: '${id}' has no recipe (cut)`);
  if (!Number.isInteger(variant) || variant < 0 || variant >= def.variants) {
    throw new Error(`bakeSound: '${id}' has no variant ${variant}`);
  }
  const fs = def.sampleRate;
  const n = Math.round(def.seconds * fs);
  const c: BakeContext = { id, variant, fs, n, out: new Float32Array(n), r: seededRng(bakeSeed(seed, id, variant)) };
  yield* recipe(c);
  yield;
  if (def.loop) yield* finishLoopSteps(c.out, fs);
  else yield* finishOneShotSteps(c.out, fs);
  return { sampleRate: fs, data: c.out };
}

export const bakeSound: BakeSound = (id, variant, seed) => runSteps(bakeSteps(id, variant, seed));
