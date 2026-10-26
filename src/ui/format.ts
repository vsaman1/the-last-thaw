/** Display formatting for figures shown in menus and the HUD. All outputs are locale-independent. */
import type { IceFlash } from '../state/gameStore';

/** Seconds → "m:ss.s" (e.g. 83.46 → "1:23.5"). Negative or non-finite input shows "0:00.0". */
export function formatTime(seconds: number): string {
  const tenths = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 10) : 0;
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const s = Math.floor(rest / 10);
  const t = rest % 10;
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

/** Integer with comma thousands separators: 12345.6 → "12,346". */
export function formatInt(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  const neg = v < 0;
  const digits = String(Math.abs(v));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return neg ? `-${out}` : out;
}

export function formatDistance(metres: number): string {
  return `${formatInt(metres)} m`;
}

/** m/s → whole km/h. */
export function toKmh(metresPerSecond: number): number {
  return Number.isFinite(metresPerSecond) ? Math.max(0, Math.round(metresPerSecond * 3.6)) : 0;
}

/** 0..1 → 0..100 whole percent (clamped, floored so 99.6% never reads as finished). */
export function percentInt(fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.floor(f * 100 + 1e-9);
}

/** 0..1 → "0%".."100%" (see percentInt). */
export function formatPercent(fraction: number): string {
  return `${percentInt(fraction)}%`;
}

/** Ice ratio → whole percent, floored like percentInt but not capped at 100 (a grown iceberg). */
export function formatIcePercent(ice: number): string {
  const v = Number.isFinite(ice) ? Math.max(0, ice) : 0;
  return `${Math.floor(v * 100 + 1e-9)}%`;
}

/** Tonnes: "30 t", "1,234 t"; one decimal below 10 t ("9.5 t"). */
export function formatMass(tonnes: number): string {
  const t = Number.isFinite(tonnes) ? Math.max(0, tonnes) : 0;
  return t >= 9.95 ? `${formatInt(t)} t` : `${t.toFixed(1)} t`;
}

/** A fraction of an iceberg as a percentage for chips: "8%", "0.4%" (at least 0.1%). */
function chipPercent(fraction: number): string {
  const pct = Math.max(0.1, (Number.isFinite(fraction) ? Math.abs(fraction) : 0) * 100);
  return pct >= 0.95 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

/** Floating HUD text for a chip / absorb: "−8% ice" (true minus sign) or "+12 t ice". */
export function iceFlashText(flash: IceFlash): string {
  return flash.kind === 'chip' ? `−${chipPercent(flash.amount)} ice` : `+${formatMass(flash.amount)} ice`;
}

/** The same event for the screen-reader live region. */
export function iceFlashSpeech(flash: IceFlash): string {
  if (flash.kind === 'chip') return `Ice broke off: ${chipPercent(flash.amount)} lost.`;
  return `Absorbed ${formatMass(flash.amount).replace(/ t$/, ' tonnes')} of glacier ice.`;
}

/** Two-digit level number for editorial labels: 1 → "01". */
export function levelNumber(index: number): string {
  return String(index).padStart(2, '0');
}
