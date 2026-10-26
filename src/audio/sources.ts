/**
 * Where every sound in the game comes from (docs/AUDIO_DESIGN.md §12): a closed table, enumerated by
 * a test, so nothing can be heard that is not listed here.
 *
 * Every effect, ambience voice, bell, the space and the felt piano are original procedural synthesis
 * written for this project: no samples, nothing to license. The motif "No. 14" is an original
 * composition (2026). The only recordings are the six Musopen piano recordings the music has always
 * used, public domain or CC0, credited as in docs/MUSIC_CREDITS.md. docs/AUDIO_CREDITS.md is written
 * from this table. Seeded from SEED = 42.
 */
import { BELL_VOICINGS, SOUND_IDS, type BellVoicingId, type SoundId } from './contract';
import { CUE_TRACKS } from './tracks';
import type { Recipe } from './synth/blocks';
import { GLASS_RECIPES } from './synth/recipes/glass';
import { ICE_RECIPES } from './synth/recipes/ice';
import { MACHINE_RECIPES } from './synth/recipes/machine';
import { MASONRY_RECIPES } from './synth/recipes/masonry';
import { METAL_RECIPES } from './synth/recipes/metal';
import { STONE_RECIPES } from './synth/recipes/stone';
import { WATER_RECIPES } from './synth/recipes/water';
import { WOOD_RECIPES } from './synth/recipes/wood';
import type { MusicCue } from '../story/types';

export type SourceKind = 'synthesis' | 'composition' | 'recording';

export interface SoundSource {
  /** A SoundId, or bell:<voicing>, motif:no-14, piano:felt, space-ir, noise:<what>, ambience:<voice>, track:<cue>. */
  readonly id: string;
  readonly kind: SourceKind;
  readonly author: string;
  /** Where it is made (synthesis) or kept (recording), from the repository root. */
  readonly file: string;
  readonly licence: string;
  readonly provenance: string;
  /** The page that states a recording's licence. */
  readonly source?: string;
}

export const SYNTHESIS = 'Original procedural synthesis (this project)';
export const COMPOSITION = 'Original composition (2026)';
export const ORIGINAL_LICENCE = 'Original work (course project)';
const AUTHOR = 'this project';

const synth = (id: string, file: string): SoundSource => ({
  id,
  kind: 'synthesis',
  author: AUTHOR,
  file,
  licence: ORIGINAL_LICENCE,
  provenance: SYNTHESIS,
});

const RECIPE_FILES: readonly [Partial<Record<SoundId, Recipe>>, string][] = [
  [ICE_RECIPES, 'src/audio/synth/recipes/ice.ts'],
  [STONE_RECIPES, 'src/audio/synth/recipes/stone.ts'],
  [WOOD_RECIPES, 'src/audio/synth/recipes/wood.ts'],
  [GLASS_RECIPES, 'src/audio/synth/recipes/glass.ts'],
  [METAL_RECIPES, 'src/audio/synth/recipes/metal.ts'],
  [MASONRY_RECIPES, 'src/audio/synth/recipes/masonry.ts'],
  [WATER_RECIPES, 'src/audio/synth/recipes/water.ts'],
  [MACHINE_RECIPES, 'src/audio/synth/recipes/machine.ts'],
];

/** The recipe file of a baked sound, or null for a sound with no recipe (the cut Vey strings). */
export function recipeFile(id: SoundId): string | null {
  for (const [table, file] of RECIPE_FILES) if (id in table) return file;
  return null;
}

const soundRows: SoundSource[] = SOUND_IDS.flatMap((id) => {
  const file = recipeFile(id);
  return file ? [synth(id, file)] : [];
});

const bellRows: SoundSource[] = (Object.keys(BELL_VOICINGS) as BellVoicingId[]).map((v) => synth(`bell:${v}`, 'src/audio/synth/bell.ts'));

const otherRows: SoundSource[] = [
  {
    id: 'motif:no-14',
    kind: 'composition',
    author: AUTHOR,
    file: 'src/audio/contract.ts',
    licence: ORIGINAL_LICENCE,
    provenance: COMPOSITION,
  },
  synth('piano:felt', 'src/audio/synth/piano.ts'),
  synth('space-ir', 'src/audio/synth/ir.ts'),
  synth('noise:white', 'src/audio/voices/noiseBank.ts'),
  synth('noise:pink', 'src/audio/voices/noiseBank.ts'),
  synth('noise:brown', 'src/audio/voices/noiseBank.ts'),
  synth('noise:control', 'src/audio/voices/noiseBank.ts'),
  ...['wind', 'scrape', 'water', 'falls', 'ocean', 'flood', 'emitters'].map((v) => synth(`ambience:${v}`, 'src/audio/voices/ambience.ts')),
];

const trackRows: SoundSource[] = (Object.keys(CUE_TRACKS) as MusicCue[]).map((cue) => {
  const t = CUE_TRACKS[cue];
  return {
    id: `track:${cue}`,
    kind: 'recording',
    author: `${t.performer}; Musopen (musopen.org)`,
    file: `public/audio/${t.file}`,
    licence: t.licence,
    provenance: `${t.title}, ${t.composer}. Musopen recording via Wikimedia Commons; the licence is stated on the file page (docs/MUSIC_CREDITS.md).`,
    source: t.source,
  };
});

/** The closed list of every sound source in the game. */
export const SOUND_SOURCES: readonly SoundSource[] = [...soundRows, ...bellRows, ...otherRows, ...trackRows];
