/** WCAG 2.x relative luminance and contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). */

export type Rgb = readonly [number, number, number];

/** Parses "#rgb" or "#rrggbb" into 0..255 channels. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** sRGB channel (0..255) → linear light (0..1). */
export function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** Contrast ratio between two colours, 1..21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Colour seen when `fg` at `alpha` is drawn over `bg`. Browsers blend in gamma-encoded sRGB by
 * default, so the mix is done on the 0..255 channel values, not in linear light.
 */
export function composite(fg: string, alpha: number, bg: string): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const a = Math.min(1, Math.max(0, alpha));
  return toHex([f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a)]);
}

/** 'large' = at least 24px regular or 18.66px (14pt) bold. */
export type TextSize = 'normal' | 'large';

/** WCAG AA threshold for text: 4.5:1 normal, 3:1 large. Non-text UI parts also need 3:1. */
export function aaThreshold(size: TextSize): number {
  return size === 'large' ? 3 : 4.5;
}

export function meetsAA(fg: string, bg: string, size: TextSize = 'normal'): boolean {
  return contrastRatio(fg, bg) >= aaThreshold(size);
}
