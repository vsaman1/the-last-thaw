// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../state/appStore';
import {
  KEY_RAMP_RATE,
  KEY_RETURN_RATE,
  MOUSE_DEAD_ZONE,
  MOUSE_ARM_BAND,
  MOUSE_ENGAGE_PX,
  MOUSE_FULL_FRACTION,
  createSteeringInput,
  inMouseArmBand,
  keyToDirection,
  mouseToSteer,
  stepKeyboardSteer,
  type SteeringInputHandle,
} from './input';

describe('mouseToSteer', () => {
  const W = 1000;
  const C = 500;

  it('is zero at the centre and inside the dead zone', () => {
    expect(mouseToSteer(C, C, W, 1)).toBe(0);
    const edge = MOUSE_DEAD_ZONE * 0.25 * W; // dead-zone edge in pixels at sensitivity 1
    expect(mouseToSteer(C + edge * 0.99, C, W, 1)).toBe(0);
    expect(mouseToSteer(C - edge * 0.99, C, W, 1)).toBe(0);
    expect(mouseToSteer(C + edge * 1.5, C, W, 1)).toBeGreaterThan(0);
  });

  it('is continuous at the dead-zone edge (rescaled, no jump)', () => {
    const edge = MOUSE_DEAD_ZONE * 0.25 * W;
    expect(mouseToSteer(C + edge + 0.01, C, W, 1)).toBeLessThan(0.001);
  });

  it('reaches full lock at a quarter width from centre and clamps beyond', () => {
    expect(mouseToSteer(C + 0.25 * W, C, W, 1)).toBeCloseTo(1, 10);
    expect(mouseToSteer(C - 0.25 * W, C, W, 1)).toBeCloseTo(-1, 10);
    expect(mouseToSteer(C + 0.5 * W, C, W, 1)).toBe(1);
    expect(mouseToSteer(-1e6, C, W, 1)).toBe(-1);
  });

  it('left of centre steers left (negative), right steers right (positive)', () => {
    expect(mouseToSteer(C - 100, C, W, 1)).toBeLessThan(0);
    expect(mouseToSteer(C + 100, C, W, 1)).toBeGreaterThan(0);
    expect(mouseToSteer(C - 100, C, W, 1)).toBeCloseTo(-mouseToSteer(C + 100, C, W, 1), 12);
  });

  it('higher sensitivity needs less travel for the same steer', () => {
    const x = C + 0.125 * W;
    expect(mouseToSteer(x, C, W, 2)).toBeCloseTo(1, 10);
    expect(mouseToSteer(x, C, W, 1)).toBeLessThan(mouseToSteer(x, C, W, 2));
    expect(mouseToSteer(x, C, W, 0.5)).toBeLessThan(mouseToSteer(x, C, W, 1));
  });

  it('degenerate inputs give 0 or fall back to sensitivity 1', () => {
    expect(mouseToSteer(700, C, 0, 1)).toBe(0);
    expect(mouseToSteer(Number.NaN, C, W, 1)).toBe(0);
    expect(mouseToSteer(C + 200, C, W, 0)).toBeCloseTo(mouseToSteer(C + 200, C, W, 1), 12);
  });
});

describe('inMouseArmBand', () => {
  it('is a band of MOUSE_ARM_BAND (in steer units) around the centre, scaled by sensitivity', () => {
    const half = MOUSE_ARM_BAND * MOUSE_FULL_FRACTION * 1000; // px at sensitivity 1
    expect(inMouseArmBand(500, 500, 1000, 1)).toBe(true);
    expect(inMouseArmBand(500 + half * 0.99, 500, 1000, 1)).toBe(true);
    expect(inMouseArmBand(500 - half * 1.01, 500, 1000, 1)).toBe(false);
    expect(inMouseArmBand(500 + half * 0.99, 500, 1000, 2)).toBe(false);
    // Armed inside the band means the first mouse steer is gentle, never a lurch.
    expect(Math.abs(mouseToSteer(500 + half, 500, 1000, 1))).toBeLessThan(0.1);
    expect(inMouseArmBand(Number.NaN, 500, 1000, 1)).toBe(false);
    expect(inMouseArmBand(500, 500, 0, 1)).toBe(false);
  });
});

describe('stepKeyboardSteer', () => {
  it('ramps toward ±1 at KEY_RAMP_RATE per second', () => {
    expect(stepKeyboardSteer(0, 1, 0.1)).toBeCloseTo(KEY_RAMP_RATE * 0.1, 10);
    expect(stepKeyboardSteer(0, -1, 0.1)).toBeCloseTo(-KEY_RAMP_RATE * 0.1, 10);
    let s = 0;
    for (let i = 0; i < 60; i++) s = stepKeyboardSteer(s, 1, 1 / 60);
    expect(s).toBe(1);
  });

  it('takes about 1/7 s to reach full lock and never overshoots', () => {
    let s = 0;
    let t = 0;
    while (s < 1 && t < 1) {
      s = stepKeyboardSteer(s, 1, 1 / 120);
      t += 1 / 120;
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(t).toBeCloseTo(1 / KEY_RAMP_RATE, 1);
  });

  it('returns to 0 at KEY_RETURN_RATE without crossing zero', () => {
    expect(stepKeyboardSteer(1, 0, 0.05)).toBeCloseTo(1 - KEY_RETURN_RATE * 0.05, 10);
    expect(stepKeyboardSteer(0.2, 0, 0.05)).toBe(0);
    expect(stepKeyboardSteer(-0.2, 0, 0.05)).toBe(0);
  });

  it('reversal: unwinds at the return rate, then ramps the other way with leftover time', () => {
    // From +0.5: 0.05 s to reach 0 at 10/s, then 0.05 s ramping at 7/s → -0.35.
    expect(stepKeyboardSteer(0.5, -1, 0.1)).toBeCloseTo(-0.35, 10);
    // Short step that does not reach zero.
    expect(stepKeyboardSteer(0.5, -1, 0.02)).toBeCloseTo(0.3, 10);
  });

  it('ignores non-positive dt', () => {
    expect(stepKeyboardSteer(0.4, 1, 0)).toBe(0.4);
    expect(stepKeyboardSteer(0.4, 1, -1)).toBe(0.4);
  });
});

describe('keyToDirection', () => {
  it('maps A / D / arrows; left is negative', () => {
    expect(keyToDirection('a', 'KeyA')).toBe(-1);
    expect(keyToDirection('A', '')).toBe(-1);
    expect(keyToDirection('ArrowLeft', 'ArrowLeft')).toBe(-1);
    expect(keyToDirection('d', 'KeyD')).toBe(1);
    expect(keyToDirection('ArrowRight', 'ArrowRight')).toBe(1);
    expect(keyToDirection('w', 'KeyW')).toBe(0);
    expect(keyToDirection(' ', 'Space')).toBe(0);
  });
});

describe('createSteeringInput (DOM)', () => {
  let settings: Settings;
  let target: HTMLDivElement;
  let input: SteeringInputHandle;
  const DT = 1 / 60;

  const key = (type: 'keydown' | 'keyup', k: string, code: string, extra: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true, ...extra }));
  const move = (clientX: number) =>
    window.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY: 300, bubbles: true }));
  /** Pass the cursor through the centre band so the mouse may steer (see 'arming' tests). */
  const arm = () => move(500);
  const run = (seconds: number) => {
    let r = input.read(0);
    for (let t = 0; t < seconds; t += DT) r = input.read(DT);
    return r;
  };

  beforeEach(() => {
    settings = { ...defaultSettings };
    target = document.createElement('div');
    document.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0 }) as DOMRect;
    input = createSteeringInput(target, () => settings);
  });

  afterEach(() => {
    input.dispose();
    target.remove();
  });

  it('starts neutral', () => {
    const r = input.read(DT);
    expect(r.steer).toBe(0);
    expect(r.source).toBe('none');
  });

  it('keyboard ramps to full lock and back', () => {
    key('keydown', 'd', 'KeyD');
    let r = input.read(0.05);
    expect(r.source).toBe('keyboard');
    expect(r.steer).toBeCloseTo(0.35, 6);
    r = run(0.5);
    expect(r.steer).toBe(1);
    key('keyup', 'd', 'KeyD');
    r = input.read(0.05);
    expect(r.steer).toBeCloseTo(0.5, 6);
    r = run(0.2);
    expect(r.steer).toBe(0);
    expect(r.source).toBe('none');
  });

  // Regression for the real-browser smoke log "released D: steer still 1 (keyboard)". The key-up IS
  // handled at once; the reused result object only changes on the next read(), and that snapshot
  // was taken before another frame ran (speed / applied steer were identical to the previous one).
  it('key-up is honoured immediately; the value updates on the next frame', () => {
    key('keydown', 'd', 'KeyD');
    const held = run(0.7);
    expect(held).toMatchObject({ steer: 1, source: 'keyboard' });
    key('keyup', 'd', 'KeyD');
    expect(held.steer).toBe(1); // no frame yet: last frame's value, as the smoke script saw
    expect(input.read(0.05).steer).toBeCloseTo(1 - KEY_RETURN_RATE * 0.05, 6);
    expect(run(0.1)).toMatchObject({ steer: 0, source: 'none' });
    // A key left "held" would keep overriding the mouse; after release the mouse takes over.
    arm();
    move(100);
    move(120);
    expect(run(0.5).source).toBe('mouse');
    expect(run(0.5).steer).toBeCloseTo(-1, 3);
  });

  it('key-up matches its key-down even without event.code and with a changed case', () => {
    key('keydown', 'd', '');
    expect(run(0.3).steer).toBe(1);
    key('keyup', 'D', '', { shiftKey: true }); // Shift pressed while D was held
    expect(run(0.3)).toMatchObject({ steer: 0, source: 'none' });
    key('keydown', 'ArrowLeft', '');
    expect(run(0.3).steer).toBe(-1);
    key('keyup', 'ArrowLeft', '');
    expect(run(0.3).steer).toBe(0);
  });

  it('hiding the page releases held keys (their key-ups go elsewhere)', () => {
    key('keydown', 'a', 'KeyA');
    expect(run(0.3).steer).toBe(-1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState; // back to jsdom's getter
    }
    expect(document.visibilityState).toBe('visible');
    expect(run(0.5)).toMatchObject({ steer: 0, source: 'none' });
  });

  it('left keys steer negative; holding both keeps the most recent', () => {
    key('keydown', 'ArrowLeft', 'ArrowLeft');
    expect(run(0.5).steer).toBe(-1);
    key('keydown', 'd', 'KeyD');
    expect(run(0.5).steer).toBe(1);
    key('keyup', 'd', 'KeyD');
    expect(run(0.5).steer).toBe(-1);
    key('keyup', 'ArrowLeft', 'ArrowLeft');
    expect(run(0.5).steer).toBe(0);
  });

  it('ignores key presses with modifiers but always honours key-up', () => {
    key('keydown', 'd', 'KeyD', { ctrlKey: true });
    expect(run(0.3).steer).toBe(0);
    key('keydown', 'd', 'KeyD');
    expect(run(0.3).steer).toBe(1);
    key('keyup', 'd', 'KeyD', { shiftKey: true });
    expect(run(0.3).steer).toBe(0);
  });

  it('mouse steers relative to the target centre', () => {
    arm();
    move(750); // quarter width right of centre → full right
    const r = run(0.5);
    expect(r.source).toBe('mouse');
    expect(r.steer).toBeCloseTo(1, 3);
    move(375);
    expect(run(0.5).steer).toBeCloseTo(mouseToSteer(375, 500, 1000, 1), 3);
  });

  it('mouse is ignored when mouse steering is off', () => {
    settings.mouseSteering = false;
    arm();
    move(900);
    const r = run(0.5);
    expect(r.steer).toBe(0);
    expect(r.source).toBe('none');
  });

  it('a held key overrides the mouse, and the mouse re-engages only after it moves', () => {
    arm();
    move(900);
    expect(run(0.5).steer).toBeCloseTo(1, 3);
    key('keydown', 'a', 'KeyA');
    let r = run(0.5);
    expect(r.source).toBe('keyboard');
    expect(r.steer).toBe(-1);
    key('keyup', 'a', 'KeyA');
    r = run(1);
    // The cursor is still far right but has not moved: keyboard player is not dragged right.
    expect(r.steer).toBe(0);
    move(900 + MOUSE_ENGAGE_PX + 1);
    r = run(0.5);
    expect(r.source).toBe('mouse');
    expect(r.steer).toBeCloseTo(1, 3);
  });

  it('mouse steer eases back to 0 after the pointer leaves the window', () => {
    arm();
    move(900);
    expect(run(0.5).steer).toBeCloseTo(1, 3);
    window.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: null }));
    const soon = input.read(DT).steer;
    expect(soon).toBeGreaterThan(0.5); // eases, does not snap
    expect(run(3).steer).toBeLessThan(0.01);
  });

  it('window blur releases held keys', () => {
    key('keydown', 'd', 'KeyD');
    expect(run(0.3).steer).toBe(1);
    window.dispatchEvent(new Event('blur'));
    expect(run(0.5).steer).toBe(0);
  });

  it('does not steer while typing in a form control', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
    expect(run(0.3).steer).toBe(0);
    field.remove();
  });

  it('read() reuses one result object (allocation-free hot path)', () => {
    expect(input.read(DT)).toBe(input.read(DT));
  });

  // Regression (review spec-ux #1): the menu's PLAY button leaves the cursor ~350 px left of centre
  // at 1280 px; the first nudge used to give full left lock and a STUCK fail ~12 s later.
  describe('arming: the mouse steers only after the cursor passes the centre band', () => {
    it('a fresh handle ignores a stale off-centre cursor that is nudged', () => {
      target.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800, x: 0, y: 0 }) as DOMRect;
      move(0.22 * 1280);
      move(0.22 * 1280 + 10);
      expect(run(1)).toMatchObject({ steer: 0, source: 'none' });
      expect(input.isMouseArmed()).toBe(false);
      // Keyboard works while the mouse is waiting.
      key('keydown', 'd', 'KeyD');
      expect(run(0.3)).toMatchObject({ steer: 1, source: 'keyboard' });
      key('keyup', 'd', 'KeyD');
      expect(run(0.3)).toMatchObject({ steer: 0, source: 'none' });
      // Through the centre band: armed, and steering follows the cursor from there.
      move(640 + 20);
      expect(input.isMouseArmed()).toBe(true);
      expect(Math.abs(run(0.3).steer)).toBeLessThan(0.1);
      move(0.22 * 1280);
      expect(run(0.5)).toMatchObject({ source: 'mouse' });
      expect(input.read(DT).steer).toBeCloseTo(-1, 3);
    });

    it('sweeping across the centre in one event also arms (fast mouse)', () => {
      move(150);
      move(850);
      expect(input.isMouseArmed()).toBe(true);
      expect(run(0.5).steer).toBeCloseTo(1, 3);
    });

    it('leaving the window forgets the last position, so re-entering on the far side does not arm', () => {
      move(150);
      window.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: null }));
      move(850);
      expect(input.isMouseArmed()).toBe(false);
      expect(run(0.5).steer).toBe(0);
    });

    it('recentre() (new attempt / resume) disarms until the cursor is centred again', () => {
      arm();
      move(900);
      expect(run(0.5).steer).toBeCloseTo(1, 3);
      input.recentre();
      expect(input.isMouseArmed()).toBe(false);
      expect(input.read(DT)).toMatchObject({ steer: 0, source: 'none' });
      move(905);
      expect(run(0.5).steer).toBe(0);
      move(510);
      expect(input.isMouseArmed()).toBe(true);
      move(900);
      expect(run(0.5).steer).toBeCloseTo(1, 3);
    });

    it('recentre() with the cursor already resting in the centre band stays armed', () => {
      move(490);
      input.recentre();
      expect(input.isMouseArmed()).toBe(true);
      move(900);
      expect(run(0.5)).toMatchObject({ source: 'mouse' });
      window.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: null }));
      input.recentre(); // cursor outside the window: position unknown, so wait for it
      expect(input.isMouseArmed()).toBe(false);
    });

    it('remembers that the keyboard steered (the HUD drops its "centre the mouse" prompt)', () => {
      expect(input.hasKeyboardSteered()).toBe(false);
      key('keydown', 'Shift', 'ShiftLeft');
      key('keydown', 'd', 'KeyD', { ctrlKey: true }); // a shortcut, not steering
      expect(input.hasKeyboardSteered()).toBe(false);
      key('keydown', 'ArrowLeft', 'ArrowLeft');
      key('keyup', 'ArrowLeft', 'ArrowLeft');
      expect(input.hasKeyboardSteered()).toBe(true);
      input.recentre(); // resume: still the same attempt
      expect(input.hasKeyboardSteered()).toBe(true);
      expect(input.isMouseArmed()).toBe(false);
    });

    it('a touch arms at once (no resting cursor on touch screens)', () => {
      const ev = new MouseEvent('pointerdown', { clientX: 100, clientY: 300, bubbles: true });
      Object.defineProperty(ev, 'pointerType', { value: 'touch' });
      window.dispatchEvent(ev);
      expect(input.isMouseArmed()).toBe(true);
      expect(run(0.5).steer).toBeCloseTo(-1, 3);
    });
  });

  it('dispose removes listeners', () => {
    input.dispose();
    key('keydown', 'd', 'KeyD');
    expect(input.read(0.5).steer).toBe(0);
  });
});
