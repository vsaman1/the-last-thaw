/**
 * UI colour tokens. styles.css declares the same values as CSS custom properties; the contrast
 * test parses styles.css and fails if the two drift apart, so edit both together.
 */
export const PALETTE = {
  bg: '#061A3A',
  bgDeep: '#030F26',
  panel: '#0A2550',
  ink: '#FFFFFF',
  inkMuted: '#A9C7EA',
  accent: '#5FF3FF',
  ice: '#7FFFF4',
  iceSide: '#1C8FD6',
  river: '#1450E6',
  ocean: '#0B3A8C',
  focus: '#C8F04A',
  btn: '#00808C',
  btnHover: '#00727F',
  btnActive: '#00646F',
  btnEdge: '#5FF3FF',
  danger: '#B3261E',
  warn: '#FFC24A',
  warnInk: '#061A3A',
  disabled: '#24344F',
  disabledInk: '#B4C3D8',
  scrim: '#04102A',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Maps each palette token to its CSS custom property name in styles.css. */
export const CSS_VAR: Record<PaletteKey, string> = {
  bg: '--c-bg',
  bgDeep: '--c-bg-deep',
  panel: '--c-panel',
  ink: '--c-ink',
  inkMuted: '--c-ink-muted',
  accent: '--c-accent',
  ice: '--c-ice',
  iceSide: '--c-ice-side',
  river: '--c-river',
  ocean: '--c-ocean',
  focus: '--c-focus',
  btn: '--c-btn',
  btnHover: '--c-btn-hover',
  btnActive: '--c-btn-active',
  btnEdge: '--c-btn-edge',
  danger: '--c-danger',
  warn: '--c-warn',
  warnInk: '--c-warn-ink',
  disabled: '--c-disabled',
  disabledInk: '--c-disabled-ink',
  scrim: '--c-scrim',
};

/**
 * Opacity of the translucent panels drawn over the live 3D scene. Text on them is checked against
 * the worst case (a pure white pixel behind the panel) in contrast.test.ts.
 */
export const SCRIM_ALPHA = {
  /** HUD chips (level label, gauge, counters, hint). */
  hud: 0.74,
  /** Intro title band. */
  intro: 0.7,
  /** Full-screen dim behind the level-complete panel (scene stays visible). */
  completeDim: 0.45,
  /** The stats/button column of the level-complete panel. */
  completePanel: 0.78,
  /** Pause / failed / loading modals. */
  modal: 0.86,
} as const;
