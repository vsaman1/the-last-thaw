import type { ChapterDef, ChapterId } from '../types';
import type { OverlayRequest } from './authoring';
import { CH1, OVERLAY_REQUESTS as R1 } from './ch1';
import { CH2, OVERLAY_REQUESTS as R2 } from './ch2';
import { CH3, OVERLAY_REQUESTS as R3 } from './ch3';
import { CH4, OVERLAY_REQUESTS as R4 } from './ch4';
import { CH5, OVERLAY_REQUESTS as R5 } from './ch5';
import { CH6, OVERLAY_REQUESTS as R6 } from './ch6';
import { CH7, OVERLAY_REQUESTS as R7 } from './ch7';
import { CH8, OVERLAY_REQUESTS as R8 } from './ch8';
import { CH9, OVERLAY_REQUESTS as R9 } from './ch9';

export type { OverlayRequest, RequestedKind } from './authoring';

/**
 * The nine chapters of The Last Thaw in level order (chapter n plays level n). Act I, The Wonder
 * (1-3); Act II, The Cost (4-6); Act III, The Reckoning (7-9). See src/story/bible.ts for the story
 * they share and docs/STORY_MODE.md for how the game uses them.
 */
export const CHAPTERS: readonly ChapterDef[] = [CH1, CH2, CH3, CH4, CH5, CH6, CH7, CH8, CH9];

/**
 * The extra human structures each chapter's story asks for, for the level designers who turn them
 * into `overlay.obstacles` (and overlay landmarks). Escalates by act: none in chapter 1, a handful in
 * Act II, dense in Act III, where avoiding civilisation should become nearly impossible.
 */
export const OVERLAY_REQUESTS_BY_CHAPTER: Readonly<Record<ChapterId, readonly OverlayRequest[]>> = {
  'ch1-beginning': R1,
  'ch2-measurements': R2,
  'ch3-warning': R3,
  'ch4-people': R4,
  'ch5-denial': R5,
  'ch6-price': R6,
  'ch7-escape': R7,
  'ch8-remains': R8,
  'ch9-last-thaw': R9,
};

export const chapterById = (id: ChapterId): ChapterDef | undefined => CHAPTERS.find((c) => c.id === id);
export const chapterForLevel = (levelId: string): ChapterDef | undefined =>
  CHAPTERS.find((c) => c.levelId === levelId);
