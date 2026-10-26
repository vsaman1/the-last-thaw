import { describe, expect, it } from 'vitest';
import { createFakeAudioContext } from './fakeAudioContext';

describe('the fake AudioContext', () => {
  it('records creation, connections, starts and stops', () => {
    const h = createFakeAudioContext({ state: 'running' });
    const ctx = h.fake;
    const g = ctx.createGain();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 4800, 48000);
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0.5, 0);
    src.stop(2);
    expect(h.ops.map((o) => o.op)).toEqual(['create', 'create', 'create', 'connect', 'connect', 'start', 'stop']);
    expect(h.reachesDestination(src.id)).toBe(true);
    expect(() => src.start()).toThrow(/twice/);
    expect(() => ctx.createBufferSource().stop()).toThrow(/before start/);
  });

  it('evaluates automation: set, linear and exponential ramps, targets, cancel and hold', () => {
    const h = createFakeAudioContext({ state: 'running' });
    const p = h.fake.createGain().gain;
    p.setValueAtTime(1, 0);
    p.linearRampToValueAtTime(0, 1);
    expect(p.valueAt(0.25)).toBeCloseTo(0.75, 9);
    expect(p.valueAt(2)).toBe(0);
    p.cancelScheduledValues(0);
    p.setValueAtTime(1, 0);
    p.exponentialRampToValueAtTime(0.01, 2);
    expect(p.valueAt(1)).toBeCloseTo(0.1, 9); // linear in dB
    p.cancelScheduledValues(0);
    p.setValueAtTime(1, 0);
    p.setTargetAtTime(0, 1, 0.5);
    expect(p.valueAt(1)).toBeCloseTo(1, 9);
    expect(p.valueAt(1.5)).toBeCloseTo(Math.exp(-1), 9);
    p.cancelAndHoldAtTime(1.5);
    expect(p.valueAt(10)).toBeCloseTo(Math.exp(-1), 9);
    h.advance(1.5);
    expect(p.value).toBeCloseTo(Math.exp(-1), 9);
  });

  it('fires ended when a buffer plays out or a stop time passes, and counts live sources by owner', () => {
    const h = createFakeAudioContext({ state: 'running' });
    const ctx = h.fake;
    const ended: number[] = [];
    const a = h.withOwner('s1', () => ctx.createBufferSource());
    a.buffer = ctx.createBuffer(1, 48000, 48000); // 1 s
    a.playbackRate.value = 2; // 0.5 s
    a.onended = () => ended.push(a.id);
    a.start(0);
    const b = h.withOwner('s2', () => ctx.createBufferSource());
    b.loop = true;
    b.buffer = ctx.createBuffer(1, 480, 48000);
    b.addEventListener('ended', () => ended.push(b.id));
    b.start(0);
    expect(h.liveSources()).toBe(2);
    expect(h.liveSources('s1')).toBe(1);
    h.advance(0.6);
    expect(ended).toEqual([a.id]);
    expect(h.liveSources('s1')).toBe(0);
    b.stop(1);
    expect(h.liveSources('s2')).toBe(1);
    h.advance(0.5);
    expect(ended).toEqual([a.id, b.id]);
    expect(h.liveSources()).toBe(0);
  });

  it('resume() runs in a microtask by default, never in "never" mode, and the clock stops while suspended', async () => {
    const h = createFakeAudioContext();
    expect(h.fake.state).toBe('suspended');
    h.advance(1);
    expect(h.fake.currentTime).toBe(0);
    const states: string[] = [];
    h.fake.addEventListener('statechange', () => states.push(h.fake.state));
    await h.fake.resume();
    expect(states).toEqual(['running']);
    h.fake.resumeMode = 'never';
    await h.fake.suspend();
    await h.fake.resume();
    expect(h.fake.state).toBe('suspended');
    await h.fake.close();
    await expect(h.fake.resume()).rejects.toThrow();
  });
});
