/**
 * Which music plays where (the director in src/ui/audio/useAudioDirector.ts asks; the engine's music
 * router plays). Story screens and Story Mode levels play the chapter's cue; the Arcade game screen
 * plays a lighter one (Mozart's K.545, then the Chopin waltz), trimmed 2 dB under the effects; the
 * other menus stay silent, as they always were.
 */
import { ARCADE_CUE, ARCADE_MIX, CHAPTER_MIX } from '../../audio/contract';
import type { GameMode, Screen } from '../../state/appStore';
import { chapterById } from '../../story/chapters';
import type { ChapterId, MusicCue } from '../../story/types';

const STORY_SCREENS: ReadonlySet<Screen> = new Set(['story', 'storyIntro', 'archive', 'science', 'epilogue']);

/** The cue for the current screen, or null for silence. */
export function cueFor(screen: Screen, mode: GameMode, chapterId: ChapterId | null): MusicCue | null {
  if (screen === 'game' && mode === 'arcade') return ARCADE_CUE;
  const story = STORY_SCREENS.has(screen) || (screen === 'game' && mode === 'story');
  if (!story) return null;
  return (chapterId ? chapterById(chapterId)?.music : undefined) ?? 'wonder';
}

/**
 * The music bed (dB, never above 0) under the current screen: in play, Arcade sits 2 dB under the
 * effects and each Story chapter a little lower than the last (CHAPTER_MIX); menus and cards at 0.
 */
export function trimFor(screen: Screen, mode: GameMode, chapterId: ChapterId | null): number {
  if (screen !== 'game') return 0;
  if (mode === 'arcade') return ARCADE_MIX.musicBedDb;
  return chapterId ? CHAPTER_MIX[chapterId].musicBedDb : 0;
}
