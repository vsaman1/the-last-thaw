/**
 * Story Mode's palette: a darker, muted variant of the game's identity (same type system, same focus
 * ring). Story surfaces are near-black blue-grey with warm paper-white ink; documents are set on paper;
 * the real-world science sits on its own green-grey surface so it never reads as part of the fiction.
 * story.css declares these values (story.contrast.test.ts keeps them in sync and checks WCAG AA).
 */
export const STORY_PALETTE = {
  bg: '#0A1017',
  ink: '#ECE8DF',
  muted: '#ADA79B',
  accent: '#9FC3D1',
  paper: '#EAE4D6',
  paperInk: '#2B2722',
  paperMuted: '#5E574D',
  warn: '#E0AE66',
  scienceBg: '#0C1A16',
  scienceAccent: '#A6D3B2',
} as const;

export type StoryPaletteKey = keyof typeof STORY_PALETTE;

export const STORY_CSS_VAR: Record<StoryPaletteKey, string> = {
  bg: '--st-bg',
  ink: '--st-ink',
  muted: '--st-muted',
  accent: '--st-accent',
  paper: '--st-paper',
  paperInk: '--st-paper-ink',
  paperMuted: '--st-paper-muted',
  warn: '--st-warn',
  scienceBg: '--st-science-bg',
  scienceAccent: '--st-science-accent',
};
