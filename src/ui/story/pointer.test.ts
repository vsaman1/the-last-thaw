/**
 * The game's overlay layer lets the mouse through to the 3D view, and every panel mounted on it must take
 * the mouse back or it cannot be clicked, tapped or scrolled (Story Mode's panels could not, 2026-10-21:
 * jsdom's element.click() skips hit testing, so only this check or a real browser catches it).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (name: string): string =>
  readFileSync(new URL(name, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
const story = css('./story.css');
const base = css('../styles.css');

/** Selectors of the rule blocks that set pointer-events: auto. */
function autoSelectors(sheet: string): string[] {
  const out: string[] = [];
  for (const m of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/pointer-events:\s*auto/.test(m[2])) out.push(...m[1].split(',').map((s) => s.trim()));
  }
  return out;
}

describe('overlay panels take the mouse', () => {
  it('the overlay layer itself lets the mouse through (so this check means something)', () => {
    expect(base).toMatch(/\.overlay-layer \{[^}]*pointer-events: none/);
  });

  it.each(['story-panel', 'story-epilogue'])('.%s on the overlay layer has pointer-events: auto', (cls) => {
    expect(autoSelectors(story)).toContain(`.overlay-layer > .${cls}`);
  });

  it('the caption stays see-through (it must not block steering with the mouse)', () => {
    expect(story).toMatch(/\.story-caption \{[^}]*pointer-events: none/);
  });
});
