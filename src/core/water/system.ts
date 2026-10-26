import type {
  FlowQuery,
  IcebergContact,
  IcebergState,
  LevelDef,
  PhysicsWorldApi,
  RiverSample,
  RiverTrailApi,
  Vec3,
} from '../types';
import { clamp, smoothstep } from '../math';
import {
  createWaterSample,
  isConfinedBy,
  type InlandWater,
  type InlandWaterSample,
} from '../sim/inlandWater';
import { STREAM_SHAPE } from '../terrain/stream';
import type { GeneratedTerrain } from '../terrain/terrain';
import { buildStreams, type StreamInfo } from './network';
import { SpringPool } from './pool';
import { Reach, type ReachSink } from './reach';
import { Reservoir } from './reservoir';
import { SegmentHash } from './segmentHash';
import { CAPTURE, HYDRO, RESERVOIR, SPRING, SWEEP } from './tuning';

/**
 * Inland water for one session: the level's streams (live reaches), the reservoirs their dams hold,
 * the spring pools cave streams rise in (./pool.ts: still water, like an intact reservoir), dam-break
 * floods, and rivers captured by big icebergs. Implements InlandWater (what the iceberg
 * integrator queries) and supplies the physics world's water forces (flowAdapter).
 *
 * Per fixed step (step()): reservoirs drain if breached; every stream reach passes its water on (a
 * dam takes the inflow into its reservoir and lets through RESERVOIR.spillShare of it, or the breach
 * outflow once broken); captured rivers grow along the iceberg's meltwater trail and carry what is
 * diverted into them; a big iceberg leaving a stream's channel on the ground starts a capture; flood
 * water sweeps standing vehicles away (SWEEP). Water state changes bump `version` (renderers rebuild).
 *
 * RIVER CAPTURE. An iceberg the banks do not hold (isConfinedBy false) that was in a stream's water
 * and leaves its channel over a bank (riding or hopping over it; it is judged where it is back on
 * the ground) carves a new course once it is CAPTURE.away + its radius from where it left without
 * coming back: CAPTURE.delay s later the stream starts pouring into the iceberg's meltwater path,
 * CAPTURE.share of its water (and of any flood arriving there) after CAPTURE.ramp s more. The old
 * channel downstream of the departure drains to the rest; the captured river follows the trail
 * over the ground (wider, faster, more turbulent than the meltwater, CAPTURE.*) as far as the
 * iceberg has gone, until the trail re-enters the same channel (the water rejoins it there),
 * climbs CAPTURE.climb m above its low point (water runs downhill), reaches the sea, or jumps a
 * ravine. One capture per stream.
 */

/** A river captured by a big iceberg (see the module comment). */
export interface CapturedRiver {
  /** Index of the stream (into streams) and the cell the water leaves it at. */
  stream: number;
  junction: number;
  startedAt: number;
  reach: Reach;
  /** Trail arc length consumed so far, and the last point laid out (for even 2 m cells). */
  lastS: number;
  px: number;
  pz: number;
  pWidth: number;
  carry: number;
  /** Lowest ground along the captured river so far (water does not climb above it by CAPTURE.climb). */
  low: number;
  done: boolean;
  /** Stream cell the captured water rejoins at (−1 = none). */
  rejoin: number;
}

/** Nearest-segment result. */
interface Hit {
  reach: number;
  i: number;
  t: number;
  lat: number;
  dist: number;
}

/** True when a level has inland water (any 'stream' feature). */
export function hasInlandWater(level: LevelDef): boolean {
  return (level.features ?? []).some((f) => f.type === 'stream');
}

export class WaterSystem implements InlandWater {
  readonly terrain: GeneratedTerrain;
  readonly streams: readonly StreamInfo[];
  readonly reservoirs: readonly Reservoir[];
  /** Spring pools of the 'cave' streams. */
  readonly pools: readonly SpringPool[];
  readonly captures: CapturedRiver[] = [];
  /** Bumped whenever water levels, flows or captured rivers change (renderers rebuild on change). */
  version = 0;
  /** Simulated seconds. */
  time = 0;
  /** Standing bodies a flood released (ids), and how many. */
  readonly swept = new Set<number>();

  private readonly hash: SegmentHash;
  private readonly capHash = new SegmentHash(8);
  /** Per reservoir: its sink on the stream's reach. */
  private readonly sinks: ReachSink[];
  private readonly hit: Hit = { reach: -1, i: 0, t: 0, lat: 0, dist: 0 };
  private readonly ws: InlandWaterSample = createWaterSample();
  private readonly flow: FlowQuery = { vx: 0, vz: 0, surfaceY: 0, strength: 0 };
  /** Strength (0..1, lateral profile) of the last sample's current. */
  private strength = 0;
  /** Stream cell (segment start) of the last sample's channel, −1 when it was in none. */
  private streamCell = -1;
  /** The iceberg's current visit to a stream channel (for captures). */
  private readonly visit = { stream: -1, cell: 0, wet: false, bank: 0, top: 0 };
  /** A big iceberg left a channel here; it becomes a capture once it is CAPTURE.away from it. */
  private pending: { stream: number; cell: number; x: number; z: number } | null = null;
  private sweepClock = 0;

  constructor(terrain: GeneratedTerrain) {
    this.terrain = terrain;
    this.streams = buildStreams(terrain);
    const res: Reservoir[] = [];
    terrain.level.obstacles.forEach((p, index) => {
      if (p.kind !== 'dam') return;
      const r = Reservoir.build(terrain, index, this.streams);
      if (r) res.push(r);
    });
    this.reservoirs = res;
    // Dams: below each, the reach runs at the spillway trickle from the start.
    this.sinks = res.map((r) => {
      const sink: ReachSink = { at: r.cell, inflow: 0, sunk: 0 };
      this.streams[r.stream].reach.sinks.push(sink);
      return sink;
    });
    for (const st of this.streams) {
      const r = st.reach;
      // In order down the stream: what each dam takes in at the steady state the ones above it left.
      for (const s of r.sinks.slice().sort((a, b) => a.at - b.at)) {
        s.sunk = s.at > 0 ? r.A[s.at - 1] * r.u[s.at - 1] : r.qIn;
        s.inflow = RESERVOIR.spillShare * s.sunk;
        // (A flood is still measured against the free stream, not the trickle below the dam.)
        r.settle(s.inflow, s.at, false);
      }
    }
    const pools: SpringPool[] = [];
    this.streams.forEach((_, k) => {
      const p = SpringPool.build(terrain, k, this.streams);
      if (p) pools.push(p);
    });
    this.pools = pools;
    let maxHalf = 4;
    for (const st of this.streams) maxHalf = Math.max(maxHalf, st.def.width / 2);
    this.hash = new SegmentHash(Math.max(8, Math.min(24, maxHalf)));
    this.streams.forEach((st, k) => {
      const r = st.reach;
      const half = st.def.width / 2 + HYDRO.floodSpreadMax + 1;
      for (let i = 0; i + 1 < r.n; i++) {
        this.hash.insert(SegmentHash.entry(k, i), r.x[i], r.z[i], r.x[i + 1], r.z[i + 1], half);
      }
    });
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  private reachOf(hashReaches: 'streams' | 'captures', k: number): Reach {
    return hashReaches === 'streams' ? this.streams[k].reach : this.captures[k].reach;
  }

  /**
   * Nearest segment of the hashed reaches, into this.hit, if the point lies within its water or its
   * channel (grown by `beyond` m: a stream's outer cut).
   */
  private nearest(kind: 'streams' | 'captures', x: number, z: number, beyond = 0): boolean {
    const hash = kind === 'streams' ? this.hash : this.capHash;
    const list = hash.at(x, z);
    if (!list) return false;
    const out = this.hit;
    out.reach = -1;
    let best = Infinity;
    let bk = -1;
    let bi = 0;
    let bt = 0;
    // The nearest segment (squared distances only) ...
    for (let c = 0; c < list.length; c++) {
      const e = list[c];
      const k = SegmentHash.reachOf(e);
      const i = SegmentHash.segOf(e);
      const r = this.reachOf(kind, k);
      if (i + 1 >= r.n) continue;
      const ax = r.x[i];
      const az = r.z[i];
      const ex = r.x[i + 1] - ax;
      const ez = r.z[i + 1] - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 1e-12 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x - (ax + ex * t);
      const pz = z - (az + ez * t);
      const d2 = px * px + pz * pz;
      if (d2 >= best) continue;
      best = d2;
      bk = k;
      bi = i;
      bt = t;
    }
    if (bk < 0) return false;
    // ... if the point lies within its channel or its water.
    const r = this.reachOf(kind, bk);
    const i = bi;
    const dist = Math.sqrt(best);
    const wide = Math.max(r.topHalf[i] + beyond, r.waterHalf(i, r.h[i]), r.waterHalf(i + 1, r.h[i + 1]));
    if (dist > wide + 0.75) return false;
    const ex = r.x[i + 1] - r.x[i];
    const ez = r.z[i + 1] - r.z[i];
    const l = Math.sqrt(ex * ex + ez * ez) || 1;
    out.reach = bk;
    out.i = i;
    out.t = bt;
    out.dist = dist;
    // Right of travel is (−dirZ, dirX).
    out.lat = (-(x - r.x[i]) * ez + (z - r.z[i]) * ex) / l;
    return true;
  }

  sample(x: number, z: number, out: InlandWaterSample): boolean {
    const ground = this.terrain.heightAt(x, z);
    out.groundY = ground;
    out.surfaceY = ground;
    out.vx = 0;
    out.vz = 0;
    out.cvx = 0;
    out.cvz = 0;
    out.channel = false;
    out.cut = false;
    out.stream = -1;
    out.dirX = 0;
    out.dirZ = 1;
    out.lat = 0;
    out.waterHalf = 0;
    out.topHalf = 0;
    out.bank = 0;
    out.drowned = false;
    out.still = false;
    this.strength = 0;
    this.streamCell = -1;
    let wet = false;
    let surf = ground;
    let bankTop = Infinity;
    if (this.nearest('streams', x, z, STREAM_SHAPE.outerMax)) {
      const { reach: k, i, t, lat } = this.hit;
      const r = this.streams[k].reach;
      const j = i + 1;
      const h = r.h[i] + (r.h[j] - r.h[i]) * t;
      const base = r.baseY[i] + (r.baseY[j] - r.baseY[i]) * t;
      const top = r.topHalf[i];
      const bank = r.bank[i] + (r.bank[j] - r.bank[i]) * t;
      const half = r.waterHalf(i, h);
      const dx = r.x[j] - r.x[i];
      const dz = r.z[j] - r.z[i];
      const dl = Math.hypot(dx, dz) || 1;
      out.dirX = dx / dl;
      out.dirZ = dz / dl;
      bankTop = base + bank;
      const al = Math.abs(lat);
      if (bank > 0.3 && al <= top + STREAM_SHAPE.outerMax) {
        // In the channel, or on the outer cut: the face rising from the bank top beside it.
        out.channel = al <= top;
        const face = bankTop + (al - top) * STREAM_SHAPE.outerSlope;
        out.cut = !out.channel && ground > bankTop + 0.05 && Math.abs(ground - face) < 0.5;
        if (out.channel || out.cut) {
          out.stream = k;
          out.lat = lat;
          out.topHalf = top;
          out.bank = bank;
          out.waterHalf = half;
          this.streamCell = i;
        }
      }
      const s = base + h;
      if (h > HYDRO.dry && s > ground + 0.02 && Math.abs(lat) <= Math.max(half, top) + 0.5) {
        wet = true;
        surf = s;
        const q = lat / Math.max(half, 0.5);
        const strength = clamp(1 - q * q, 0.15, 1);
        const still = r.still[i] + (r.still[j] - r.still[i]) * t;
        const uc = (r.u[i] + (r.u[j] - r.u[i]) * t) * still;
        out.cvx = out.dirX * uc;
        out.cvz = out.dirZ * uc;
        out.vx = out.cvx * strength;
        out.vz = out.cvz * strength;
        out.still = still < 0.3;
        this.strength = strength;
      }
    }
    for (const res of this.reservoirs) {
      const L = res.level;
      if (!(L > ground + 0.02) || !(L > surf + 0.05) || !res.contains(x, z)) continue;
      wet = true;
      surf = L;
      // Still water drifting toward the dam; pulled toward the breach while it drains.
      let tx = res.cx - x;
      let tz = res.cz - z;
      let pull = RESERVOIR.lakeDrift;
      if (res.broken && res.qPeak > 0) {
        tx = res.bx - x;
        tz = res.bz - z;
        pull += RESERVOIR.drainDrift * (res.outflow / res.qPeak);
      }
      const tl = Math.hypot(tx, tz);
      let dirX = tl > 1e-6 ? tx / tl : -res.upX;
      let dirZ = tl > 1e-6 ? tz / tl : -res.upZ;
      if (out.channel) {
        // Along the drowned channel, the drift follows it.
        const w = smoothstep(4, 30, tl);
        dirX = dirX * (1 - w) + out.dirX * w;
        dirZ = dirZ * (1 - w) + out.dirZ * w;
        const dl = Math.hypot(dirX, dirZ) || 1;
        dirX /= dl;
        dirZ /= dl;
      }
      out.vx = dirX * pull;
      out.vz = dirZ * pull;
      out.cvx = out.vx;
      out.cvz = out.vz;
      out.still = !res.broken || res.outflow < 0.05 * res.qPeak;
      this.strength = 1;
      if (L >= bankTop - 0.05) out.drowned = true;
    }
    for (const pool of this.pools) {
      // The spring pool stands over the stream's own (flat, still) cells in it: it answers there.
      const L = pool.level;
      const dx = pool.cx - x;
      const dz = pool.cz - z;
      const reach = pool.radius + SPRING.fillMargin + 1;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (!(L > ground + 0.02) || !(L >= surf - 0.01) || !pool.contains(x, z)) continue;
      wet = true;
      surf = L;
      // Still water drifting gently toward the outlet, where the stream's current takes over.
      const tx = pool.ox - x;
      const tz = pool.oz - z;
      const tl = Math.hypot(tx, tz);
      const dirX = tl > 1e-6 ? tx / tl : -pool.upX;
      const dirZ = tl > 1e-6 ? tz / tl : -pool.upZ;
      out.vx = dirX * SPRING.drift;
      out.vz = dirZ * SPRING.drift;
      out.cvx = out.vx;
      out.cvz = out.vz;
      out.still = true;
      this.strength = 1;
      // No banks in the pool: the channel only confines past the outlet.
      out.drowned = true;
    }
    if (this.captures.length > 0 && this.nearest('captures', x, z)) {
      const { reach: k, i, t, lat } = this.hit;
      const r = this.captures[k].reach;
      const j = i + 1;
      const h = r.h[i] + (r.h[j] - r.h[i]) * t;
      const s = r.baseY[i] + (r.baseY[j] - r.baseY[i]) * t + h;
      const half = Math.max(r.waterHalf(i, h), r.waterHalf(j, r.h[j]));
      if (h > HYDRO.dry && s > ground + 0.02 && Math.abs(lat) <= half && s > surf - 0.05) {
        wet = true;
        surf = Math.max(surf, s);
        const q = lat / Math.max(half, 0.5);
        const strength = clamp(1 - q * q, 0.2, 1);
        const u = (r.u[i] + (r.u[j] - r.u[i]) * t) * strength;
        out.vx = r.dirX[i] * u;
        out.vz = r.dirZ[i] * u;
        out.cvx = out.vx;
        out.cvz = out.vz;
        out.still = false;
        this.strength = strength;
      }
    }
    if (out.channel && surf >= bankTop - 0.05) out.drowned = true;
    out.surfaceY = surf;
    return wet || out.channel || out.cut;
  }

  /**
   * Inland water at a point for loose bodies (PhysicsWorldApi.applyWaterForces), or null where it
   * is dry. The returned object is reused by the next call.
   */
  flowAt(x: number, z: number): FlowQuery | null {
    const w = this.ws;
    if (!this.sample(x, z, w) || !(w.surfaceY > w.groundY + 0.02)) return null;
    const f = this.flow;
    f.vx = w.vx;
    f.vz = w.vz;
    f.surfaceY = w.surfaceY;
    f.strength = this.strength;
    return f;
  }

  /**
   * The meltwater trail with this water added, for the physics world's water forces: flowAt answers
   * from whichever water stands higher there (the stream, reservoir, flood or captured river unless
   * the trail's surface is above it); everything else is the trail's.
   */
  flowAdapter(trail: RiverTrailApi): RiverTrailApi {
    const self = this;
    return {
      get samples(): readonly RiverSample[] {
        return trail.samples;
      },
      get version(): number {
        return trail.version;
      },
      get length(): number {
        return trail.length;
      },
      record: (ice, terrain, time) => trail.record(ice, terrain, time),
      flowAt(x: number, z: number): FlowQuery | null {
        const mine = self.flowAt(x, z);
        const theirs = trail.flowAt(x, z);
        if (!mine) return theirs;
        if (!theirs) return mine;
        return mine.surfaceY >= theirs.surfaceY - 0.1 ? mine : theirs;
      },
      disturb: (x, z, amount) => trail.disturb(x, z, amount),
      reset: () => trail.reset(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  /**
   * A dam body broke at `pos` (GameEvent 'obstacleBroken', kind 'dam'): the reservoir whose dam it
   * belongs to (the one whose axis passes nearest, within 6 m) is breached if its foot was under
   * water. Returns the reservoir breached, or null.
   */
  damBroken(pos: Vec3): Reservoir | null {
    let best: Reservoir | null = null;
    let bestD = 6;
    for (const r of this.reservoirs) {
      const [a, b] = r.ends;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? clamp(((pos.x - a.x) * ex + (pos.z - a.z) * ez) / l2, 0, 1) : 0;
      const d = Math.hypot(pos.x - (a.x + ex * t), pos.z - (a.z + ez * t));
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (!best || !best.breakAt(pos)) return null;
    this.version++;
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------------------------

  /**
   * Advance the water by one fixed step. `ice` (the iceberg, after its step) starts captures,
   * `trail` (its meltwater river) is the course captured rivers follow, `physics` takes the flood's
   * hits on standing vehicles. Any of them may be null (headless tests of the water alone).
   */
  step(
    dt: number,
    ice: IcebergState | null,
    trail: RiverTrailApi | null,
    physics: PhysicsWorldApi | null,
  ): void {
    this.time += dt;
    let changed = false;
    // Dams.
    this.reservoirs.forEach((res, k) => {
      if (res.step(dt)) changed = true;
      const sink = this.sinks[k];
      sink.inflow = res.broken
        ? res.outflow + sink.sunk * res.drained
        : RESERVOIR.spillShare * sink.sunk;
    });
    // Captures divert their stream's water.
    for (const cap of this.captures) {
      const r = this.streams[cap.stream].reach;
      r.divertAt = cap.junction;
      const ramp = smoothstep(CAPTURE.delay, CAPTURE.delay + CAPTURE.ramp, this.time - cap.startedAt);
      r.divertShare = CAPTURE.share * ramp;
      if (cap.rejoin >= 0) {
        r.joinAt = cap.rejoin;
        r.joinQ = cap.reach.outflow;
      }
    }
    for (const st of this.streams) if (st.reach.step(dt) > 1e-4) changed = true;
    for (const cap of this.captures) {
      if (trail && !cap.done && this.extendCapture(cap, trail)) changed = true;
      cap.reach.qIn = this.streams[cap.stream].reach.diverted;
      if (cap.reach.step(dt) > 1e-4) changed = true;
    }
    if (ice) this.watchIceberg(ice, trail);
    if (physics && ++this.sweepClock >= SWEEP.stride) {
      this.sweepClock = 0;
      this.sweep(physics);
    }
    if (changed) this.version++;
  }

  /** Track the iceberg's visits to stream channels; a big one leaving on the ground starts a capture. */
  private watchIceberg(ice: IcebergState, trail: RiverTrailApi | null): void {
    const v = this.visit;
    if (ice.inOcean) {
      // At sea there is nothing left to capture.
      v.stream = -1;
      v.wet = false;
      this.pending = null;
      return;
    }
    // In the air (a hop over a bank, a waterfall in the stream): judged where it comes down.
    if (!ice.grounded) return;
    const w = this.ws;
    const inside = this.sample(ice.pos.x, ice.pos.z, w) && (w.channel || w.cut);
    if (inside) {
      // Back in the channel it left: that was no departure (but it is still a visit from the water).
      const back = this.pending !== null && this.pending.stream === w.stream;
      if (back) this.pending = null;
      if (v.stream !== w.stream) v.wet = back;
      v.stream = w.stream;
      v.cell = this.streamCell;
      v.bank = w.bank;
      v.top = w.topHalf;
      if (w.surfaceY > w.groundY + 0.1) v.wet = true;
      return;
    }
    if (v.stream >= 0) {
      const free = !isConfinedBy(v.bank, 2 * v.top, ice.radius);
      if (v.wet && free && !this.captures.some((c) => c.stream === v.stream)) {
        this.pending = { stream: v.stream, cell: v.cell, x: ice.pos.x, z: ice.pos.z };
      }
      v.stream = -1;
      v.wet = false;
    }
    const pd = this.pending;
    if (pd && trail && Math.hypot(ice.pos.x - pd.x, ice.pos.z - pd.z) >= CAPTURE.away + ice.radius) {
      this.pending = null;
      this.startCapture(pd.stream, pd.cell, trail);
    }
  }

  /** Start capturing stream `stream` at cell `cell` along the trail from where it left the channel. */
  private startCapture(stream: number, cell: number, trail: RiverTrailApi): void {
    const samples = trail.samples;
    if (samples.length === 0) return;
    // The newest trail sample still in this channel: the captured river starts just after it.
    let from = samples.length - 1;
    const w = this.ws;
    for (let k = samples.length - 1; k >= Math.max(0, samples.length - 400); k--) {
      const sm = samples[k];
      if (this.sample(sm.x, sm.z, w) && w.channel && w.stream === stream) {
        from = Math.min(samples.length - 1, k + 1);
        break;
      }
    }
    const st = this.streams[stream];
    const first = samples[from];
    const reach = new Reach(256, HYDRO.cell);
    const ground = this.terrain.heightAt(first.x, first.z);
    const cap: CapturedRiver = {
      stream,
      junction: Math.min(cell + 1, st.reach.n - 2),
      startedAt: this.time,
      reach,
      lastS: first.s,
      px: first.x,
      pz: first.z,
      pWidth: first.width,
      carry: HYDRO.cell,
      low: ground,
      done: false,
      rejoin: -1,
    };
    this.captures.push(cap);
    this.appendCaptureCell(cap, first.x, first.z, ground, first.width, first.dirX, first.dirZ);
    this.extendCapture(cap, trail);
    this.version++;
  }

  /** Lay out new trail samples as captured-river cells. Returns true when cells were added. */
  private extendCapture(cap: CapturedRiver, trail: RiverTrailApi): boolean {
    const samples = trail.samples;
    let lo = 0;
    let hi = samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].s <= cap.lastS) lo = mid + 1;
      else hi = mid;
    }
    const before = cap.reach.n;
    const w = this.ws;
    for (let k = lo; k < samples.length && !cap.done; k++) {
      const sm = samples[k];
      cap.lastS = sm.s;
      if (sm.gapBefore || cap.reach.n >= CAPTURE.maxCells) {
        cap.done = true;
        break;
      }
      const seg = Math.hypot(sm.x - cap.px, sm.z - cap.pz);
      // Even cells along the segment from the last laid-out point, on the ground (the trail's own
      // heights follow the iceberg, which may be afloat).
      let along = cap.carry;
      while (along <= seg && !cap.done) {
        const f = seg > 1e-9 ? along / seg : 1;
        const x = cap.px + (sm.x - cap.px) * f;
        const z = cap.pz + (sm.z - cap.pz) * f;
        // Back in the channel it left: the water rejoins it there (at once if near the junction).
        if (this.sample(x, z, w) && w.channel && w.stream === cap.stream) {
          cap.rejoin = Math.max(this.streamCell, cap.junction + 1);
          cap.done = true;
          break;
        }
        const ground = this.terrain.heightAt(x, z);
        // Water runs downhill: where the path climbs well above its low, the captured river ends.
        if (ground > cap.low + CAPTURE.climb) {
          cap.done = true;
          break;
        }
        cap.low = Math.min(cap.low, ground);
        const width = cap.pWidth + (sm.width - cap.pWidth) * f;
        const dl = seg > 1e-9 ? seg : 1;
        this.appendCaptureCell(cap, x, z, ground, width, (sm.x - cap.px) / dl, (sm.z - cap.pz) / dl);
        along += HYDRO.cell;
      }
      cap.carry = along - seg;
      cap.px = sm.x;
      cap.pz = sm.z;
      cap.pWidth = sm.width;
      if (sm.kind === 'ocean' || this.terrain.isOcean(sm.x, sm.z)) cap.done = true;
    }
    return cap.reach.n !== before;
  }

  private appendCaptureCell(
    cap: CapturedRiver,
    x: number,
    z: number,
    base: number,
    trailWidth: number,
    dirX: number,
    dirZ: number,
  ): void {
    const r = cap.reach;
    const i = r.n;
    r.reserve(i + 1);
    const st = this.streams[cap.stream];
    const width = Math.max(trailWidth * CAPTURE.widthFactor, st.def.width * CAPTURE.streamWidth);
    r.x[i] = x;
    r.z[i] = z;
    const dl = Math.hypot(dirX, dirZ);
    r.dirX[i] = dl > 1e-9 ? dirX / dl : i > 0 ? r.dirX[i - 1] : 0;
    r.dirZ[i] = dl > 1e-9 ? dirZ / dl : i > 0 ? r.dirZ[i - 1] : 1;
    r.arc[i] = i * r.dx;
    r.baseY[i] = base;
    r.width[i] = width;
    r.topHalf[i] = width / 2;
    r.bank[i] = CAPTURE.bank;
    r.h0[i] = CAPTURE.depth;
    const slope = i > 0 ? (r.baseY[i - 1] - base) / r.dx : HYDRO.slopeRef;
    const rapid = clamp(Math.sqrt(Math.max(slope, 0) / HYDRO.slopeRef), HYDRO.rapidMin, HYDRO.rapidMax);
    const flow = (st.def.flow ?? 4) * CAPTURE.speedFactor;
    r.speed[i] = flow * rapid;
    r.fall[i] = slope > HYDRO.fallSlope ? 1 : 0;
    if (r.fall[i] && i > 0) r.fall[i - 1] = 1;
    r.turb[i] = Math.max(CAPTURE.turbulence, r.fall[i] ? 0.9 : 0);
    r.still[i] = 1;
    r.springs[i] = 0;
    r.steady[i] = 0;
    r.A[i] = 0;
    r.h[i] = 0;
    r.u[i] = 0;
    r.n = i + 1;
    if (i > 0) {
      const k = this.captures.indexOf(cap);
      const half = width / 2 + HYDRO.floodSpreadMax + 1;
      this.capHash.insert(SegmentHash.entry(k, i - 1), r.x[i - 1], r.z[i - 1], x, z, half);
    }
  }

  /** Flood water releases standing vehicles (SWEEP); the water forces then carry them. */
  private sweep(physics: PhysicsWorldApi): void {
    const reaches: { r: Reach; flood: boolean }[] = [];
    for (const st of this.streams) reaches.push({ r: st.reach, flood: false });
    for (const c of this.captures) reaches.push({ r: c.reach, flood: true });
    const w = this.ws;
    for (const { r, flood } of reaches) {
      for (let i = 0; i < r.n; i += 3) {
        const h = r.h[i];
        if (!(r.u[i] >= SWEEP.minSpeed)) continue;
        if (!(flood ? h >= SWEEP.minWet : h - r.steady[i] >= SWEEP.minRise)) continue;
        const near = physics.proxiesNear(r.x[i], r.z[i], r.waterHalf(i, h) + 3);
        for (let k = 0; k < near.length; k++) {
          const o = near[k];
          if (!o.anchored || !(o.breakImpulse < Infinity) || this.swept.has(o.id)) continue;
          if (!SWEEP.kinds.includes(o.kind)) continue;
          if (!this.sample(o.x, o.z, w) || !(w.surfaceY - o.bottom >= SWEEP.minWet)) continue;
          const speed = Math.hypot(w.vx, w.vz);
          if (!(speed >= SWEEP.minSpeed)) continue;
          this.swept.add(o.id);
          const j = Math.max(1, o.mass) * speed * 0.5;
          const contact: IcebergContact = {
            obstacleId: o.id,
            impulse: { x: (w.vx / speed) * j, y: 0.1 * j, z: (w.vz / speed) * j },
            point: { x: o.x, y: Math.min(w.surfaceY, o.top), z: o.z },
            normal: { x: w.vx / speed, y: 0, z: w.vz / speed },
            relSpeed: speed,
            speedLoss: 0,
            testImpulse: Infinity,
            shock: 0,
          };
          physics.applyContact(contact);
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Inspection
  // -------------------------------------------------------------------------------------------

  /** Water surface (m) of stream `k` at cell `i` (its reach level, or the reservoir's when higher). */
  surfaceAt(k: number, i: number): number {
    const r = this.streams[k].reach;
    return r.baseY[i] + r.h[i];
  }

  /** Discharge (m³/s) through cell i of stream k at the last step. */
  dischargeAt(k: number, i: number): number {
    const r = this.streams[k].reach;
    return r.A[i] * r.u[i];
  }
}
