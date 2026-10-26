import { getLevel } from '../core/levels';
import { BIBLE } from '../story/bible';
import { CHAPTERS } from '../story/chapters';
import { CLIMATE_FACTS } from '../story/science';
import type { ChapterDef } from '../story/types';
import type { StoryData } from '../story/validate';
import { summarizeLevel, type LevelSummary } from './tools';

/** The trusted, authored story the production service works from (tests use small fixtures instead). */
export const STORY: StoryData = { bible: BIBLE, chapters: CHAPTERS, facts: CLIMATE_FACTS };

/** The level a chapter plays, summarised for get_level_context; undefined for an unknown level id. */
export function levelSummaryFor(chapter: ChapterDef): LevelSummary | undefined {
  try {
    return summarizeLevel(getLevel(chapter.levelId), chapter);
  } catch {
    return undefined;
  }
}
