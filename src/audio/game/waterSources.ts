/**
 * Waterfalls, the dam-break flood and the dam's moment in the mix (DESIGN §7.4, §7.5, §8.7 M5), from
 * the water the game actually has: falls exist only where water crosses a drop (a dry cliff is
 * silent until the meltwater river goes over it), a flood only once a reservoir is breached.
 *
 * Falls: sources are rebuilt (at most every 0.5 s, only when the water or the river changed) into a
 * preallocated table: stream cells flagged as falls (one source per run, at its lowest cell, flow
 * h·|u|) and the bottoms of the river trail's 'fall' runs (flow flowSpeed·width/10). Every 0.25 s the
 * two loudest within 300 m (strength × distance gain) take the two voice slots, with 15 % hysteresis;
 * a source that loses its slot fades out over 1.5 s on the third, so nothing ever jumps.
 *
 * Flood: the breach itself (rush = √(outflow/1500) until the lake is drained) and the flood front
 * downstream (the nearest reach cell standing above its steady depth, scanned 256 cells a tick), the
 * louder of the two at the listener.
 */
import { smoothstep } from '../../core/math';
import type { RiverTrailApi } from '../../core/types';
import type { WaterSystem } from '../../core/water/system';
import { SPATIAL, type FallSlotInputs, type FloodInputs, type ListenerPose } from '../contract';
import { airLowpassHz, distanceGain, distanceTo, panFor } from '../spatial';

export const MAX_FALL_SOURCES = 64;
const STRIDE = 4;
export const FALL_REBUILD_SEC = 0.5;
export const FALL_SELECT_SEC = 0.25;
export const FALL_HYSTERESIS = 1.15;
export const FALL_FADE_SEC = 1.5;
/**
 * Flow that sounds at full strength: the 90th percentile of source flow over headless autopilot runs
 * of all nine levels on 2026-10-22 (7567 samples of the source table every 0.5 s; median 3.6, p90
 * 17.5). Stream falls (h·|u|) and trail falls (flowSpeed·width/10) share the scale.
 */
export const FALL_Q_REF = 17.5;
/** Spray: full inside 8 m, none beyond 40 m. */
export const NEAR_FULL_M = 8;
export const NEAR_NONE_M = 40;
export const FLOOD_OUTFLOW_REF = 1500;
export const FLOOD_SCAN_CELLS = 256;
/** A reach cell this far above its steady depth is a full flood (m). */
export const FLOOD_DEPTH_REF = 1.5;

export const fallStrength = (q: number): number => smoothstep(0, FALL_Q_REF, q);
export const nearAmount = (d: number): number => 1 - smoothstep(NEAR_FULL_M, NEAR_NONE_M, d);

interface Slot {
  /** World position of the source it plays (y for distance). */
  x: number;
  y: number;
  z: number;
  q: number;
  /** 'on' plays its source; 'fading' runs down over FALL_FADE_SEC; 'free' is silent. */
  mode: 'on' | 'fading' | 'free';
  fade: number;
}

const newSlot = (): Slot => ({ x: 0, y: 0, z: 0, q: 0, mode: 'free', fade: 0 });

export class FallSources {
  /** x, z, flow, kind (0 stream, 1 trail) per source; y kept apart. */
  readonly table = new Float32Array(MAX_FALL_SOURCES * STRIDE);
  readonly ys = new Float32Array(MAX_FALL_SOURCES);
  count = 0;
  readonly slots: Slot[] = [newSlot(), newSlot(), newSlot()];
  readonly inputs: FallSlotInputs[] = [0, 1, 2].map(() => ({
    active: false,
    strength: 0,
    distGain: 0,
    airLowpassHz: 16000,
    pan: 0,
    near: 0,
  }));
  private waterVersion = -1;
  private riverVersion = -1;
  private sinceRebuild = Infinity;
  private sinceSelect = Infinity;

  constructor(
    private readonly river: RiverTrailApi,
    private readonly water: WaterSystem | null,
  ) {}

  /** Advance by dt: rebuild, reselect and refresh the three slot inputs (call at 10 Hz or faster). */
  update(dt: number, pose: Readonly<ListenerPose>): readonly FallSlotInputs[] {
    this.sinceRebuild += dt;
    this.sinceSelect += dt;
    const wv = this.water?.version ?? 0;
    if ((wv !== this.waterVersion || this.river.version !== this.riverVersion) && this.sinceRebuild >= FALL_REBUILD_SEC) {
      this.waterVersion = wv;
      this.riverVersion = this.river.version;
      this.sinceRebuild = 0;
      this.rebuild();
      this.remap();
    }
    if (this.sinceSelect >= FALL_SELECT_SEC) {
      this.sinceSelect = 0;
      this.select(pose);
    }
    for (let k = 0; k < 3; k++) {
      const s = this.slots[k];
      if (s.mode === 'fading') {
        s.fade -= dt / FALL_FADE_SEC;
        if (s.fade <= 0) s.mode = 'free';
      }
      const inp = this.inputs[k];
      if (s.mode === 'free') {
        inp.active = false;
        inp.strength = 0;
        continue;
      }
      const d = distanceTo(pose, s.x, s.y, s.z);
      inp.active = true;
      inp.strength = fallStrength(s.q) * (s.mode === 'fading' ? Math.max(0, s.fade) : 1);
      inp.distGain = d > SPATIAL.falls.maxM ? 0 : distanceGain(d, SPATIAL.falls);
      inp.airLowpassHz = airLowpassHz(d, SPATIAL.falls.refM);
      inp.pan = panFor(pose, s.x, s.z, SPATIAL.falls.panLimit);
      inp.near = nearAmount(d);
    }
    return this.inputs;
  }

  private push(x: number, y: number, z: number, q: number, kind: number): void {
    if (this.count >= MAX_FALL_SOURCES) return;
    const o = this.count * STRIDE;
    this.table[o] = x;
    this.table[o + 1] = z;
    this.table[o + 2] = q;
    this.table[o + 3] = kind;
    this.ys[this.count] = y;
    this.count++;
  }

  /** Every fall the water has now. */
  rebuild(): void {
    this.count = 0;
    const w = this.water;
    if (w) {
      for (const st of w.streams) this.scanReach(st.reach);
      for (const cap of w.captures) this.scanReach(cap.reach);
    }
    const s = this.river.samples;
    let i = 0;
    while (i < s.length) {
      if (s[i].kind !== 'fall') {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < s.length && s[j + 1].kind === 'fall') j++;
      const b = j + 1 < s.length ? s[j + 1] : s[j];
      this.push(b.x, b.y, b.z, (b.flowSpeed * b.width) / 10, 1);
      i = j + 1;
    }
  }

  private scanReach(r: WaterSystem['streams'][number]['reach']): void {
    let c = 0;
    while (c < r.n) {
      if (r.fall[c] !== 1) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < r.n && r.fall[e + 1] === 1) e++;
      const q = r.h[e] * Math.abs(r.u[e]);
      if (q > 1e-3) this.push(r.x[e], r.baseY[e] + r.h[e], r.z[e], q, 0);
      c = e + 1;
    }
  }

  /** After a rebuild, each slot follows its source to the new table (or fades when it is gone). */
  private remap(): void {
    for (const s of this.slots) {
      if (s.mode !== 'on') continue;
      const k = this.nearest(s.x, s.z, 4);
      if (k < 0) {
        s.mode = 'fading';
        s.fade = 1;
        continue;
      }
      s.q = this.table[k * STRIDE + 2];
    }
  }

  private nearest(x: number, z: number, within: number): number {
    let best = -1;
    let bestD = within;
    for (let k = 0; k < this.count; k++) {
      const d = Math.hypot(this.table[k * STRIDE] - x, this.table[k * STRIDE + 1] - z);
      if (d <= bestD) {
        best = k;
        bestD = d;
      }
    }
    return best;
  }

  private scoreOf(k: number, pose: Readonly<ListenerPose>): number {
    const o = k * STRIDE;
    const d = distanceTo(pose, this.table[o], this.ys[k], this.table[o + 1]);
    if (d > SPATIAL.falls.maxM) return 0;
    return fallStrength(this.table[o + 2]) * distanceGain(d, SPATIAL.falls);
  }

  private slotScore(s: Slot, pose: Readonly<ListenerPose>): number {
    const d = distanceTo(pose, s.x, s.y, s.z);
    return d > SPATIAL.falls.maxM ? 0 : fallStrength(s.q) * distanceGain(d, SPATIAL.falls);
  }

  /** The two loudest sources hold the two playing slots; a challenger needs 15 % more to take one. */
  private select(pose: Readonly<ListenerPose>): void {
    // A source that went out of range (or dry) fades rather than stops.
    for (const s of this.slots) {
      if (s.mode === 'on' && this.slotScore(s, pose) <= 0) {
        s.mode = 'fading';
        s.fade = 1;
      }
    }
    // The two best sources not already playing.
    let c1 = -1;
    let c2 = -1;
    let s1 = 0;
    let s2 = 0;
    for (let k = 0; k < this.count; k++) {
      const o = k * STRIDE;
      if (this.playing(this.table[o], this.table[o + 1])) continue;
      const sc = this.scoreOf(k, pose);
      if (sc <= 0) continue;
      if (sc > s1) {
        c2 = c1;
        s2 = s1;
        c1 = k;
        s1 = sc;
      } else if (sc > s2) {
        c2 = k;
        s2 = sc;
      }
    }
    if (c1 >= 0) this.offer(c1, s1, pose);
    if (c2 >= 0) this.offer(c2, s2, pose);
  }

  /** Give a candidate source a playing slot: one is free, or it beats the weakest by the hysteresis. */
  private offer(cand: number, score: number, pose: Readonly<ListenerPose>): void {
    let on = 0;
    let weak = -1;
    let weakScore = Infinity;
    for (let k = 0; k < 3; k++) {
      const s = this.slots[k];
      if (s.mode !== 'on') continue;
      on++;
      const sc = this.slotScore(s, pose);
      if (sc < weakScore) {
        weak = k;
        weakScore = sc;
      }
    }
    if (on >= 2) {
      if (!(score > weakScore * FALL_HYSTERESIS)) return;
      this.slots[weak].mode = 'fading';
      this.slots[weak].fade = 1;
    }
    // A free slot, else the fade that is nearly done gives way (the third slot only carries a fade).
    let target = -1;
    let lowest = Infinity;
    for (let k = 0; k < 3; k++) {
      const s = this.slots[k];
      if (s.mode === 'free') {
        target = k;
        break;
      }
      if (s.mode === 'fading' && k !== weak && s.fade < lowest) {
        target = k;
        lowest = s.fade;
      }
    }
    if (target < 0) return;
    const o = cand * STRIDE;
    const s = this.slots[target];
    s.x = this.table[o];
    s.z = this.table[o + 1];
    s.y = this.ys[cand];
    s.q = this.table[o + 2];
    s.mode = 'on';
    s.fade = 1;
  }

  private playing(x: number, z: number): boolean {
    for (const s of this.slots) if (s.mode === 'on' && Math.hypot(s.x - x, s.z - z) < 4) return true;
    return false;
  }
}

/** The flood the listener hears: the breach or the flood front, whichever is louder there. */
export class FloodSource {
  readonly inputs: FloodInputs = { rush: 0, distGain: 0, airLowpassHz: 16000, pan: 0 };
  private stream = 0;
  private cell = 0;
  /** Best flood-front cell found by the sweep in progress, and by the last complete one. */
  private frontX = 0;
  private frontY = 0;
  private frontZ = 0;
  private front = 0;
  private sweepX = 0;
  private sweepY = 0;
  private sweepZ = 0;
  private sweepBest = 0;
  private sweepDist = Infinity;

  constructor(private readonly water: WaterSystem) {}

  update(pose: Readonly<ListenerPose>): FloodInputs {
    this.scan(pose);
    const out = this.inputs;
    let rush = 0;
    let score = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const r of this.water.reservoirs) {
      if (!r.broken || r.drained > 0.98 || r.outflow < 5) continue;
      const rr = Math.sqrt(Math.min(1, r.outflow / FLOOD_OUTFLOW_REF));
      const ry = r.floorY;
      const sc = rr * distanceGain(distanceTo(pose, r.bx, ry, r.bz), SPATIAL.flood);
      if (sc > score) {
        score = sc;
        rush = rr;
        x = r.bx;
        y = ry;
        z = r.bz;
      }
    }
    if (this.front > 0) {
      const sc = this.front * distanceGain(distanceTo(pose, this.frontX, this.frontY, this.frontZ), SPATIAL.flood);
      if (sc > score) {
        score = sc;
        rush = this.front;
        x = this.frontX;
        y = this.frontY;
        z = this.frontZ;
      }
    }
    if (score <= 0) {
      out.rush = 0;
      out.distGain = 0;
      return out;
    }
    const d = distanceTo(pose, x, y, z);
    out.rush = rush;
    out.distGain = d > SPATIAL.flood.maxM ? 0 : distanceGain(d, SPATIAL.flood);
    out.airLowpassHz = airLowpassHz(d, SPATIAL.flood.refM);
    out.pan = panFor(pose, x, z, SPATIAL.flood.panLimit);
    return out;
  }

  /** Round-robin over the reach cells, FLOOD_SCAN_CELLS a call: the nearest cell above its steady depth. */
  private scan(pose: Readonly<ListenerPose>): void {
    const streams = this.water.streams;
    if (streams.length === 0) return;
    let budget = FLOOD_SCAN_CELLS;
    while (budget > 0) {
      if (this.stream >= streams.length) {
        // A sweep is complete: publish what it found.
        this.front = this.sweepBest;
        this.frontX = this.sweepX;
        this.frontY = this.sweepY;
        this.frontZ = this.sweepZ;
        this.sweepBest = 0;
        this.sweepDist = Infinity;
        this.stream = 0;
        this.cell = 0;
      }
      const r = streams[this.stream].reach;
      const end = Math.min(r.n, this.cell + budget);
      for (let c = this.cell; c < end; c++) {
        const over = r.h[c] - r.steady[c];
        if (!(over > 0.02)) continue;
        const y = r.baseY[c] + r.h[c];
        const d = distanceTo(pose, r.x[c], y, r.z[c]);
        if (d < this.sweepDist) {
          this.sweepDist = d;
          this.sweepBest = Math.min(1, over / FLOOD_DEPTH_REF);
          this.sweepX = r.x[c];
          this.sweepY = y;
          this.sweepZ = r.z[c];
        }
      }
      budget -= end - this.cell;
      this.cell = end;
      if (this.cell >= r.n) {
        this.stream++;
        this.cell = 0;
        if (r.n === 0) budget--;
      }
    }
  }
}

/**
 * M5, the dam's moment: when a reservoir is first seen breached, the music lowers (Story −10 dB while
 * the outflow is above 30 % of its peak, 15 s at most; Arcade −4 dB for 4 s), then lets go.
 */
export const DAM_STORY_MAX_SEC = 15;
export const DAM_STORY_SUBSIDE = 0.3;
export const DAM_ARCADE_SEC = 4;

export class DamWatch {
  private readonly seen = new Set<number>();
  private since = -1;
  private qPeak = 0;
  private reservoir = -1;
  active = false;

  constructor(
    private readonly water: WaterSystem,
    private readonly story: boolean,
  ) {}

  /** dt in session seconds. Returns 'breach' and 'subside' on the frames they happen, else null. */
  update(dt: number): 'breach' | 'subside' | null {
    const res = this.water.reservoirs;
    let breach = false;
    for (let k = 0; k < res.length; k++) {
      const r = res[k];
      if (!r.broken || this.seen.has(k)) continue;
      this.seen.add(k);
      breach = true;
      this.reservoir = k;
      this.qPeak = r.qPeak;
    }
    if (breach) {
      const was = this.active;
      this.active = true;
      this.since = 0;
      return was ? null : 'breach';
    }
    if (!this.active) return null;
    this.since += dt;
    const r = res[this.reservoir];
    const subsided = this.story
      ? this.since >= DAM_STORY_MAX_SEC || (r !== undefined && r.outflow <= DAM_STORY_SUBSIDE * this.qPeak && this.since > 1)
      : this.since >= DAM_ARCADE_SEC;
    if (!subsided) return null;
    this.active = false;
    return 'subside';
  }
}
