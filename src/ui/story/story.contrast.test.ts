import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from '../contrast';
import { PALETTE } from '../theme';
import { STORY_CSS_VAR, STORY_PALETTE, type StoryPaletteKey } from './palette';

const P = STORY_PALETTE;

describe('Story Mode palette meets WCAG AA', () => {
  const pairs: [string, string, string][] = [
    ['ink on the story surface', P.ink, P.bg],
    ['muted text on the story surface', P.muted, P.bg],
    ['accent labels on the story surface', P.accent, P.bg],
    ['warning text on the story surface', P.warn, P.bg],
    ['document ink on paper', P.paperInk, P.paper],
    ['document meta on paper', P.paperMuted, P.paper],
    ['science text on the science surface', P.ink, P.scienceBg],
    ['science muted text on the science surface', P.muted, P.scienceBg],
    ['science accent (headings, links) on the science surface', P.scienceAccent, P.scienceBg],
  ];
  for (const [what, fg, bg] of pairs) {
    it(`${what}: ${fg} on ${bg} >= 4.5:1`, () => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the focus ring stays >= 3:1 on story and science surfaces', () => {
    expect(contrastRatio(PALETTE.focus, P.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(PALETTE.focus, P.scienceBg)).toBeGreaterThanOrEqual(3);
  });

  it('the caption and panels stay legible over a white pixel of the 3D scene', () => {
    // --st-scrim (caption, panel backdrop) is 72% and --st-surface 94% of the story background.
    expect(contrastRatio(P.ink, composite(P.bg, 0.72, '#FFFFFF'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(P.muted, composite(P.bg, 0.94, '#FFFFFF'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the epilogue text (muted eyebrow, ink title and text) stays legible over the brightest scene pixels', () => {
    // Its text sits on --st-surface (94%) throughout; the see-through fade is a text-free strip above it
    // (checked against story.css below). The same worst pixels as contrast.test.ts: snow, ice, glow.
    for (const scene of ['#FFFFFF', '#7FFFF4', '#C8F04A', '#5BD43A']) {
      const under = composite(P.bg, 0.94, scene);
      expect(contrastRatio(P.muted, under), `muted over ${scene}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(P.ink, under), `ink over ${scene}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the epilogue overlay keeps its text off the fade', () => {
  const css = readFileSync(fileURLToPath(new URL('./story.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string): string => {
    const m = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    expect(m, `${selector} missing from story.css`).not.toBeNull();
    return m![1];
  };
  it('the scroll box that holds every line of text is the solid story surface', () => {
    expect(rule('.story-epilogue__scroll')).toMatch(/background:\s*var\(--st-surface\)/);
    expect(rule('.story-epilogue__scroll')).toMatch(/overflow-y:\s*auto/);
  });
  it('the fade is an empty strip outside the scroll box, and the box itself paints nothing see-through', () => {
    const strip = rule('.story-epilogue::before');
    expect(strip).toMatch(/content:\s*''/);
    expect(strip).toMatch(/linear-gradient/);
    expect(rule('.story-epilogue')).not.toMatch(/background|overflow/);
  });
});

describe('story.css stays in sync with palette.ts', () => {
  const css = readFileSync(fileURLToPath(new URL('./story.css', import.meta.url)), 'utf8');
  it('declares every story colour with the same value', () => {
    for (const key of Object.keys(P) as StoryPaletteKey[]) {
      const m = new RegExp(`${STORY_CSS_VAR[key]}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(css);
      expect(m, `${STORY_CSS_VAR[key]} missing from story.css`).not.toBeNull();
      expect(m![1].toUpperCase()).toBe(P[key].toUpperCase());
    }
  });
  it('the translucent story surfaces are the story background', () => {
    expect(css).toMatch(/--st-surface:\s*rgba\(10, 16, 23, 0\.94\)/);
    expect(css).toMatch(/--st-scrim:\s*rgba\(10, 16, 23, 0\.72\)/);
  });
});
