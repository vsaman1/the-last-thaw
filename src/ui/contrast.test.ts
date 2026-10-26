import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  aaThreshold,
  composite,
  contrastRatio,
  meetsAA,
  parseHex,
  relativeLuminance,
} from './contrast';
import { CSS_VAR, PALETTE, SCRIM_ALPHA, type PaletteKey } from './theme';

describe('WCAG helpers', () => {
  it('matches reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 10);
    // Well-known boundary: #767676 on white is the lightest grey that passes 4.5:1.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5);
    expect(contrastRatio('#FFFFFF', '#767676')).toBeCloseTo(contrastRatio('#767676', '#FFFFFF'), 12);
  });

  it('parses short and long hex, rejects junk', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('0B3A8C')).toEqual([11, 58, 140]);
    expect(() => parseHex('blue')).toThrow();
  });

  it('composites in sRGB space', () => {
    expect(composite('#000000', 0.5, '#FFFFFF')).toBe('#808080');
    expect(composite('#123456', 1, '#FFFFFF')).toBe('#123456');
    expect(composite('#123456', 0, '#FFFFFF')).toBe('#FFFFFF');
  });

  it('thresholds', () => {
    expect(aaThreshold('normal')).toBe(4.5);
    expect(aaThreshold('large')).toBe(3);
    expect(meetsAA('#FFFFFF', '#00808C')).toBe(true);
  });
});

/** [foreground, background, size, what] — every text/background pairing the UI uses. */
const TEXT_PAIRS: [string, string, 'normal' | 'large', string][] = [
  [PALETTE.ink, PALETTE.btn, 'normal', 'button label on turquoise'],
  [PALETTE.ink, PALETTE.btnHover, 'normal', 'button label, hover/focus'],
  [PALETTE.ink, PALETTE.btnActive, 'normal', 'button label, pressed'],
  [PALETTE.ink, PALETTE.danger, 'normal', 'destructive confirm button'],
  [PALETTE.disabledInk, PALETTE.disabled, 'normal', 'disabled button (exempt, kept legible)'],
  [PALETTE.ink, PALETTE.bg, 'normal', 'body text'],
  [PALETTE.ink, PALETTE.bgDeep, 'normal', 'body text, deep'],
  [PALETTE.inkMuted, PALETTE.bg, 'normal', 'muted text'],
  [PALETTE.inkMuted, PALETTE.panel, 'normal', 'muted text on card'],
  [PALETTE.accent, PALETTE.bg, 'normal', 'eyebrow / accent text'],
  [PALETTE.accent, PALETTE.panel, 'normal', 'accent on card'],
  [PALETTE.focus, PALETTE.panel, 'normal', 'Completed status tag'],
  [PALETTE.warn, PALETTE.bgDeep, 'normal', 'warning eyebrow'],
  [PALETTE.warnInk, PALETTE.warn, 'normal', 'Losing momentum! chip'],
  [PALETTE.warnInk, PALETTE.focus, 'normal', 'New best badge'],
];

describe('UI palette contrast (WCAG AA)', () => {
  it('white on the turquoise button face passes 4.5:1 (normal text, not just large)', () => {
    const r = contrastRatio(PALETTE.ink, PALETTE.btn);
    expect(r).toBeGreaterThanOrEqual(4.5);
    // Record the actual value so a palette change shows up in the diff of the test output.
    expect(r.toFixed(2)).toBe('4.70');
  });

  for (const [fg, bg, size, what] of TEXT_PAIRS) {
    it(`${what}: ${fg} on ${bg} >= ${aaThreshold(size)}:1`, () => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(aaThreshold(size));
    });
  }

  it('focus ring is >= 3:1 against the page, cards and the button face', () => {
    for (const bg of [PALETTE.bg, PALETTE.bgDeep, PALETTE.panel, PALETTE.btn, PALETTE.btnHover]) {
      expect(contrastRatio(PALETTE.focus, bg)).toBeGreaterThanOrEqual(3);
    }
    // Over the 3D scene the ring sits on an opaque scrim halo (styles.css), not on the sky.
    expect(contrastRatio(PALETTE.focus, PALETTE.scrim)).toBeGreaterThanOrEqual(3);
  });

  it('translucent panels over the live 3D scene keep text legible even over a white pixel', () => {
    const worst = ['#FFFFFF', '#7FFFF4', '#C8F04A', '#5BD43A'];
    for (const behind of worst) {
      const hud = composite(PALETTE.scrim, SCRIM_ALPHA.hud, behind);
      expect(contrastRatio(PALETTE.ink, hud)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(PALETTE.inkMuted, hud)).toBeGreaterThanOrEqual(3);
      const intro = composite(PALETTE.scrim, SCRIM_ALPHA.intro, behind);
      expect(contrastRatio(PALETTE.ink, intro)).toBeGreaterThanOrEqual(4.5);
      const panel = composite(PALETTE.scrim, SCRIM_ALPHA.completePanel, behind);
      expect(contrastRatio(PALETTE.ink, panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(PALETTE.inkMuted, panel)).toBeGreaterThanOrEqual(4.5);
      const modal = composite(PALETTE.scrim, SCRIM_ALPHA.modal, behind);
      expect(contrastRatio(PALETTE.inkMuted, modal)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('amber "Melting fast" text on a HUD chip stays legible even over a white pixel', () => {
    for (const behind of ['#FFFFFF', '#7FFFF4', '#C8F04A', '#5BD43A']) {
      const hud = composite(PALETTE.scrim, SCRIM_ALPHA.hud, behind);
      expect(contrastRatio(PALETTE.warn, hud)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('styles.css stays in sync with theme.ts', () => {
  const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

  it('declares every palette token with the same value', () => {
    for (const key of Object.keys(PALETTE) as PaletteKey[]) {
      const m = new RegExp(`${CSS_VAR[key]}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(css);
      expect(m, `${CSS_VAR[key]} missing from styles.css`).not.toBeNull();
      expect(m![1].toUpperCase()).toBe(PALETTE[key].toUpperCase());
    }
  });

  it('scrim rgba() values match SCRIM_ALPHA and the scrim colour', () => {
    const [r, g, b] = parseHex(PALETTE.scrim);
    const expectRgba = (name: string, alpha: number) => {
      const m = new RegExp(`${name}:\\s*rgba\\(([^)]+)\\)`).exec(css);
      expect(m, `${name} missing`).not.toBeNull();
      const parts = m![1].split(',').map((s) => Number(s.trim()));
      expect(parts).toEqual([r, g, b, alpha]);
    };
    expectRgba('--scrim-hud', SCRIM_ALPHA.hud);
    expectRgba('--scrim-intro', SCRIM_ALPHA.intro);
    expectRgba('--scrim-complete-dim', SCRIM_ALPHA.completeDim);
    expectRgba('--scrim-complete-panel', SCRIM_ALPHA.completePanel);
    expectRgba('--scrim-modal', SCRIM_ALPHA.modal);
  });

  it('uses no web fonts or remote URLs (must work offline)', () => {
    expect(css).not.toMatch(/@import|@font-face|url\(\s*['"]?https?:/i);
  });
});
