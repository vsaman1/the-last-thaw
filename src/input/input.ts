/**
 * Steering input: keyboard (A/D, ←/→) and mouse position relative to the play area's centre.
 *
 * Rules:
 * - Keyboard steer ramps toward ±1 at KEY_RAMP_RATE/s and back toward 0 at KEY_RETURN_RATE/s.
 * - Mouse steer (settings.mouseSteering) maps horizontal offset from the centre of `target`;
 *   full lock at MOUSE_FULL_FRACTION of the width divided by sensitivity, with a rescaled dead zone.
 * - The mouse is "armed" only once the cursor has passed through the centre band (a new handle and
 *   recentre() disarm it), so a cursor left on a menu button never grabs full lock. Touch arms at once.
 * - A held steering key overrides the mouse. Pressing a key also disengages the mouse until it
 *   moves again, so a cursor resting off-centre never steers a keyboard player.
 * - If the pointer leaves the window (or a touch ends) mouse steer eases back to 0.
 * - Window blur or the page becoming hidden releases every held key.
 */
import { clamp, damp } from '../core/math';
import type { SteeringInput } from '../core/types';
import type { Settings } from '../state/appStore';

export const KEY_RAMP_RATE = 7;
export const KEY_RETURN_RATE = 10;
export const MOUSE_DEAD_ZONE = 0.06;
/** Fraction of the target width (at sensitivity 1) from centre to full steer. */
export const MOUSE_FULL_FRACTION = 0.25;
/** Exponential follow rate (1/s) while the mouse is steering; smooths sensor jitter only. */
export const MOUSE_FOLLOW_RATE = 30;
/** Exponential rate (1/s) at which mouse steer relaxes to 0 after the pointer leaves. */
export const MOUSE_RELEASE_RATE = 4;
/** Pointer travel (px) needed to hand control back to the mouse after a key press. */
export const MOUSE_ENGAGE_PX = 6;
/**
 * Half-width of the centre band that arms the mouse, in raw steer units (before the dead zone):
 * 0.15 is ~48 px each side at 1280 px and sensitivity 1, and arms at |steer| < 0.1.
 */
export const MOUSE_ARM_BAND = 0.15;

/**
 * Pure mouse mapping. Output is continuous: 0 inside the dead zone, then rescaled so it still
 * reaches ±1 at the same distance as without a dead zone.
 */
export function mouseToSteer(
  mouseX: number,
  centreX: number,
  width: number,
  sensitivity: number,
): number {
  if (!(width > 0) || !Number.isFinite(mouseX) || !Number.isFinite(centreX)) return 0;
  const sens = sensitivity > 0 && Number.isFinite(sensitivity) ? sensitivity : 1;
  const raw = clamp((mouseX - centreX) / ((MOUSE_FULL_FRACTION * width) / sens), -1, 1);
  const mag = Math.abs(raw);
  if (mag <= MOUSE_DEAD_ZONE) return 0;
  return (Math.sign(raw) * (mag - MOUSE_DEAD_ZONE)) / (1 - MOUSE_DEAD_ZONE);
}

/** True when the cursor is close enough to the centre to arm mouse steering. */
export function inMouseArmBand(
  mouseX: number,
  centreX: number,
  width: number,
  sensitivity: number,
): boolean {
  if (!(width > 0) || !Number.isFinite(mouseX) || !Number.isFinite(centreX)) return false;
  const sens = sensitivity > 0 && Number.isFinite(sensitivity) ? sensitivity : 1;
  return Math.abs(mouseX - centreX) <= (MOUSE_ARM_BAND * MOUSE_FULL_FRACTION * width) / sens;
}

/**
 * Pure keyboard ramp. Moving away from 0 uses KEY_RAMP_RATE; moving toward 0 (release, or the
 * first half of a reversal) uses the faster KEY_RETURN_RATE. A reversal that crosses 0 within
 * one step spends the remaining time ramping at KEY_RAMP_RATE.
 */
export function stepKeyboardSteer(current: number, target: number, dt: number): number {
  if (!(dt > 0)) return current;
  const t = clamp(target, -1, 1);
  if (t === current) return t;
  if (t === 0 || (current !== 0 && Math.sign(t) !== Math.sign(current))) {
    const toZero = Math.abs(current) / KEY_RETURN_RATE;
    if (t === 0 || dt < toZero) {
      const step = KEY_RETURN_RATE * dt;
      if (t === 0) return Math.abs(current) <= step ? 0 : current - Math.sign(current) * step;
      return current - Math.sign(current) * step;
    }
    return rampAway(0, t, dt - toZero);
  }
  if (Math.abs(t) < Math.abs(current)) {
    // Same sign but a smaller target (not produced by keys; kept total for scripted callers).
    const step = KEY_RETURN_RATE * dt;
    return Math.abs(current - t) <= step ? t : current - Math.sign(current - t) * step;
  }
  return rampAway(current, t, dt);
}

function rampAway(current: number, target: number, dt: number): number {
  const step = KEY_RAMP_RATE * dt;
  const diff = target - current;
  return Math.abs(diff) <= step ? target : current + Math.sign(diff) * step;
}

export type SteerDirection = -1 | 0 | 1;

/** Which steering direction a key maps to (left = -1). Matches both labels and physical keys. */
export function keyToDirection(key: string, code: string): SteerDirection {
  if (key === 'ArrowLeft' || code === 'ArrowLeft' || code === 'KeyA') return -1;
  if (key === 'ArrowRight' || code === 'ArrowRight' || code === 'KeyD') return 1;
  const k = key.length === 1 ? key.toLowerCase() : '';
  if (k === 'a') return -1;
  if (k === 'd') return 1;
  return 0;
}

/** True when keyboard focus is somewhere text/number entry or native arrow keys matter. */
export function isFormControl(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).tagName !== 'string') return false;
  const e = el as HTMLElement;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable === true;
}

export interface SteeringInputHandle {
  /**
   * Advance ramps by dt and return the current steer. The returned object is reused between calls
   * (allocation-free); copy its fields if you need to keep them.
   */
  read(dt: number): SteeringInput;
  /**
   * Disarm the mouse until the cursor passes through the centre band again. Call when play starts
   * and on resume, so the cursor position left by a menu/pause click is never applied as steer.
   */
  recentre(): void;
  /** False while mouse steering waits for the cursor to pass the centre (HUD shows a prompt). */
  isMouseArmed(): boolean;
  /**
   * True once a steering key has been pressed with this handle (one handle per attempt). The HUD
   * then stops asking a keyboard player to centre the mouse.
   */
  hasKeyboardSteered(): boolean;
  dispose(): void;
}

export function createSteeringInput(
  target: HTMLElement,
  getSettings: () => Settings,
): SteeringInputHandle {
  const out: SteeringInput = { steer: 0, source: 'none' };
  const leftKeys = new Set<string>();
  const rightKeys = new Set<string>();
  let lastDir: SteerDirection = 0;
  let keySteer = 0;
  let keyboardSteered = false;

  let pointerX = Number.NaN;
  let centreX = 0;
  let width = 0;
  let pointerInside = false;
  let mouseArmed = false;
  let mouseEngaged = false;
  let engageAnchorX = Number.NaN;
  let mouseSteer = 0;

  // Physical key when known. Without event.code (synthetic events, some virtual keyboards) fall back
  // to the case-folded key, so pressing Shift mid-hold ('d' down, 'D' up) cannot leave it stuck.
  const keyId = (e: KeyboardEvent): string =>
    e.code || (e.key.length === 1 ? e.key.toLowerCase() : e.key);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (isFormControl(e.target)) return;
    const dir = keyToDirection(e.key, e.code);
    if (dir === 0) return;
    if (dir < 0) leftKeys.add(keyId(e));
    else rightKeys.add(keyId(e));
    lastDir = dir;
    keyboardSteered = true;
    mouseEngaged = false;
    engageAnchorX = pointerX;
    if (e.key.startsWith('Arrow')) e.preventDefault();
  };

  // Key-ups are always honoured (even with modifiers) so a key can never stick down.
  const onKeyUp = (e: KeyboardEvent): void => {
    const id = keyId(e);
    const released = leftKeys.delete(id) || rightKeys.delete(id);
    if (!released) return;
    if (leftKeys.size > 0 && rightKeys.size === 0) lastDir = -1;
    else if (rightKeys.size > 0 && leftKeys.size === 0) lastDir = 1;
    else if (leftKeys.size === 0 && rightKeys.size === 0) lastDir = 0;
  };

  const onPointerMove = (e: PointerEvent): void => {
    const rect = target.getBoundingClientRect();
    const prevX = pointerInside ? pointerX : Number.NaN;
    centreX = rect.left + rect.width / 2;
    width = rect.width;
    pointerX = e.clientX;
    pointerInside = true;
    if (!mouseArmed) {
      const crossed = (prevX - centreX) * (pointerX - centreX) < 0; // NaN-safe: false
      if (
        e.pointerType === 'touch' ||
        crossed ||
        inMouseArmBand(pointerX, centreX, width, getSettings().mouseSensitivity)
      ) {
        mouseArmed = true;
        mouseEngaged = true;
      }
      return;
    }
    if (!mouseEngaged) {
      if (!Number.isFinite(engageAnchorX) || Math.abs(pointerX - engageAnchorX) >= MOUSE_ENGAGE_PX) {
        mouseEngaged = true;
      }
    }
  };

  const onPointerOut = (e: PointerEvent): void => {
    if (e.relatedTarget === null) pointerInside = false;
  };

  const onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') pointerInside = false;
  };

  const onBlur = (): void => {
    leftKeys.clear();
    rightKeys.clear();
    lastDir = 0;
    pointerInside = false;
  };

  const onDocLeave = (): void => {
    pointerInside = false;
  };

  // Key-ups that happen while the page is hidden never reach us.
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onBlur();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerMove);
  window.addEventListener('pointerout', onPointerOut);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('blur', onBlur);
  document.documentElement.addEventListener('mouseleave', onDocLeave);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    read(dt: number): SteeringInput {
      const settings = getSettings();
      const keysHeld = leftKeys.size + rightKeys.size > 0;
      keySteer = stepKeyboardSteer(keySteer, keysHeld ? lastDir : 0, dt);

      const mouseOn = settings.mouseSteering && mouseArmed && mouseEngaged;
      const mouseTarget =
        mouseOn && pointerInside ? mouseToSteer(pointerX, centreX, width, settings.mouseSensitivity) : 0;
      const rate = mouseOn && pointerInside ? MOUSE_FOLLOW_RATE : MOUSE_RELEASE_RATE;
      mouseSteer = dt > 0 ? damp(mouseSteer, mouseTarget, rate, dt) : mouseSteer;
      if (Math.abs(mouseSteer) < 1e-4 && mouseTarget === 0) mouseSteer = 0;

      if (keysHeld) {
        out.steer = keySteer;
        out.source = 'keyboard';
      } else if (mouseOn) {
        out.steer = mouseSteer;
        out.source = 'mouse';
      } else if (keySteer !== 0) {
        out.steer = keySteer;
        out.source = 'keyboard';
      } else {
        out.steer = 0;
        out.source = 'none';
      }
      return out;
    },
    recentre(): void {
      const sens = getSettings().mouseSensitivity;
      mouseArmed = pointerInside && inMouseArmBand(pointerX, centreX, width, sens);
      mouseEngaged = mouseArmed;
      mouseSteer = 0;
    },
    isMouseArmed(): boolean {
      return mouseArmed;
    },
    hasKeyboardSteered(): boolean {
      return keyboardSteered;
    },
    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      window.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onBlur);
      document.documentElement.removeEventListener('mouseleave', onDocLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      onBlur();
    },
  };
}
