import type { TrafficNetwork, TrafficPath } from './network';
import { signalState } from './signals';

/**
 * Road traffic: vehicles driving the lanes of a TrafficNetwork. Pure TypeScript, deterministic
 * (fixed steps, integer hashing for route choices, vehicles always processed in the same order) and
 * allocation-free per step. The physics world (src/core/physics/world.ts) owns one: it hands each
 * vehicle's pose to its (disabled) rigid body every step until the vehicle is hit, flooded or loses
 * its road, and then releases it as an ordinary dynamic body with its current velocity.
 *
 * Driving: the Intelligent Driver Model (Treiber) against the nearest of
 * - the vehicle ahead on its path, or on the paths it will take next (turns, the lane after them);
 * - its stop line, while it may not enter the junction: a red light (amber when it can still stop
 *   comfortably), a vehicle on a turn that crosses the one it wants, or no room on the lane beyond;
 * - an obstacle in its lane (debris, the iceberg, a flooded or broken road), found by probing
 *   points ahead along its route every TRAFFIC_TUNING.scanEvery steps (TrafficEnv.scan).
 * A vehicle close enough to its stop line while allowed in claims the turn (`committed`): later
 * arrivals treat it as occupying the junction, and it no longer stops for the light.
 * Closed roads: route choices avoid a road with something standing in it (TrafficEnv.closed) while
 * another way on is open; a vehicle that stands TRAFFIC_TUNING.turnBackAfter seconds before
 * something in its lane (the iceberg's river across the road, fallen ice, a broken deck) turns round
 * onto the opposite lane in a half circle, once that lane is clear and its box has room all the way
 * round (TrafficEnv.roomFor), and drives back the way it came. One that finds no way round within
 * TRAFFIC_TUNING.giveUpAfter s gives up: released, the world parks it where it stands.
 * Speed: the road's limit × a per-vehicle share (cars 0.85–1.1, trucks/buses capped at 10 m/s),
 * slowed ahead of turns to what they allow (sqrt(lateral accel × radius)).
 * Pose: the body origin sits on the mean support height (terrain or a bridge deck) under the four
 * wheels, pitched and rolled to them, facing from its rear axle point to its front axle point.
 */

export type VehicleKind = 'car' | 'truck' | 'bus';

export interface VehicleSpec {
  readonly length: number;
  readonly width: number;
  /** IDM maximum acceleration (m/s²). */
  readonly accel: number;
  /** Desired speed = road limit × a share in [lo, hi], capped. */
  readonly share: readonly [number, number];
  readonly cap: number;
}

export const VEHICLE_SPECS: Readonly<Record<VehicleKind, VehicleSpec>> = {
  car: { length: 4.2, width: 1.8, accel: 1.6, share: [0.85, 1.1], cap: Infinity },
  truck: { length: 7.6, width: 2.45, accel: 0.9, share: [0.78, 0.9], cap: 10 },
  bus: { length: 12, width: 2.55, accel: 0.8, share: [0.78, 0.9], cap: 10 },
};

export const TRAFFIC_TUNING = {
  /** IDM: safe time headway (s), jam distance (m), comfortable and emergency deceleration (m/s²). */
  headway: 1.2,
  minGap: 2,
  comfortBrake: 2.5,
  maxBrake: 8,
  /** Stop this far (m) short of a stop line, and of an obstacle in the lane. */
  stopLineGap: 1,
  obstacleGap: 2.5,
  /** Leaders and stop lines further ahead than this (m) are ignored. */
  lookahead: 90,
  /** Each vehicle probes its lane ahead every scanEvery steps (staggered by index). */
  scanEvery: 3,
  /** Probe spacing (m) and reach: max(probeMin, braking distance + probeMargin), ≤ probeMax. */
  probeStep: 3,
  probeMin: 16,
  probeMargin: 14,
  probeMax: 60,
  /** Most vehicles driving at once (more on the roads stay parked). */
  maxVehicles: 60,
  /** Front/rear axle points as a share of the length from the centre; wheel track share of width. */
  axleShare: 0.36,
  trackShare: 0.42,
  /**
   * Turning round before something in the lane: after standing this long (s) right before it (no
   * vehicle between), at this speed (m/s) through the half circle, when no vehicle on the opposite
   * lane is driving toward the point it joins from within turnBackBehind m, or stands within
   * turnBackAhead m (+ its length) beyond it (TrafficSystem.oppositeClear), and its box finds room
   * (TrafficEnv.roomFor) at turnBackSamples points round the half circle and at its pose on the
   * other lane.
   */
  turnBackAfter: 6,
  turnBackSpeed: 2.5,
  turnBackBehind: 30,
  turnBackAhead: 6,
  turnBackSamples: 8,
  /**
   * A vehicle that has stood this long (s) right before something in its lane without turning round
   * (no room to turn, no lane the other way, standing in a junction turn) gives up: the traffic
   * releases it (TrafficSystem.gaveUp) and the world parks it where it stands.
   */
  giveUpAfter: 20,
} as const;

const T = TRAFFIC_TUNING;
const MAX_PROBES = Math.ceil(T.probeMax / T.probeStep) + 2;

export interface VehicleSpawn {
  /** Physics body id (opaque here). */
  readonly body: number;
  readonly kind: VehicleKind;
  /** Lane (path id) and arc along it. */
  readonly path: number;
  readonly arc: number;
  /** Deterministic per-vehicle seed (desired speed, route choices). */
  readonly seed: number;
  /** Height it starts at (a vehicle on a bridge deck); omitted = on the ground. */
  readonly y?: number;
}

/** What the world around the traffic provides. */
export interface TrafficEnv {
  /**
   * Height a wheel stands on at (x, z): the terrain, or a bridge deck / dam crest near `refY` (the
   * vehicle's current height; NaN = the ground only).
   */
  support(x: number, z: number, refY: number): number;
  /**
   * Index of the first of `n` probe points ahead of vehicle `i` (world x/y/z) that is blocked (an
   * obstacle, the iceberg, water, a broken road), or -1. `carried[k]` is 1 where probe k lies on a
   * road that shapes no terrain (a street on a bridge deck or a dam crest: one that can break), 0
   * where it lies on carved ground.
   */
  scan?(
    i: number,
    xs: Float64Array,
    ys: Float64Array,
    zs: Float64Array,
    n: number,
    carried: Uint8Array,
  ): number;
  /**
   * True if something stands in path p somewhere along it, so a vehicle could never drive through
   * (fallen ice, a parked vehicle, a house): a closed road. Route choices avoid a closed road while
   * another way on is open.
   */
  closed?(p: TrafficPath): boolean;
  /**
   * True if vehicle i's plan box (its length × width), centred at world (x, z) and facing the unit
   * vector (hx, hz), meets nothing it could not drive through (the lane scan's rule for bodies).
   * Asked before a turn-round, along the half circle and at its end; omitted = always room.
   */
  roomFor?(i: number, x: number, z: number, hx: number, hz: number): boolean;
}

/** 32-bit integer hash → [0, 1). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export class TrafficSystem {
  readonly net: TrafficNetwork;
  /** Traffic clock (s): signals read it. */
  time = 0;
  steps = 0;
  readonly count: number;
  readonly body: Int32Array;
  readonly kind: VehicleKind[];
  readonly active: Uint8Array;
  /**
   * 1 once vehicle i gave up (stood giveUpAfter s before something in its lane with no way round):
   * the traffic released it, and the world should park its body where it stands.
   */
  readonly gaveUp: Uint8Array;
  readonly path: Int32Array;
  readonly arc: Float64Array;
  readonly v: Float64Array;
  /** Pose outputs (world): position of the body origin, rotation, velocity. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly qx: Float64Array;
  readonly qy: Float64Array;
  readonly qz: Float64Array;
  readonly qw: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  /** Desired speed (m/s) before road limits, per vehicle share of the limit. */
  private readonly share: Float64Array;
  private readonly cap: Float64Array;
  private readonly len: Float64Array;
  private readonly wid: Float64Array;
  private readonly acc: Float64Array;
  private readonly seed: Int32Array;
  private readonly visits: Int32Array;
  /** Chosen next path (a turn or U-turn for lanes; the out lane for turns), and the previous one. */
  private readonly next: Int32Array;
  private readonly prev: Int32Array;
  readonly committed: Uint8Array;
  /** Distance (m, from the vehicle's centre along its route) to the nearest blocking probe. */
  readonly blocked: Float64Array;
  private readonly accel: Float64Array;
  private readonly probeX = new Float64Array(MAX_PROBES);
  private readonly probeY = new Float64Array(MAX_PROBES);
  private readonly probeZ = new Float64Array(MAX_PROBES);
  private readonly probeArc = new Float64Array(MAX_PROBES);
  private readonly probeCarried = new Uint8Array(MAX_PROBES);
  /** Per path: 1 if its road shapes no terrain (a deck or dam-crest street), else 0. */
  private readonly carriedPath: Uint8Array;
  private readonly pt = { x: 0, z: 0 };
  /** Path the last along() point lies on. */
  private ptPath = -1;
  /** Per lane: the lane the other way along the same stretch of road (-1: none). */
  private readonly opposite: Int32Array;
  /** Gap (m) to the vehicle ahead at the last acceleration() (Infinity: none within lookahead). */
  private readonly leadGap: Float64Array;
  /** Seconds standing right before something in the lane (turnBackAfter turns it round). */
  private readonly waited: Float64Array;
  /**
   * Turning round (1) from lane `turnFrom` at arc `turnFromArc` onto the lane it is now on: a half
   * circle about (turnCx, turnCz) of radius turnR, from the point at unit offset (turnUx, turnUz)
   * setting off along (turnHx, turnHz), `turnT` of the way round after `turnDur` s in all.
   */
  readonly turning: Uint8Array;
  private readonly turnFrom: Int32Array;
  /** The lane it turns round from (turnFrom itself, or the lane before the turn it backs out of). */
  private readonly turnFromLane: Int32Array;
  private readonly turnFromArc: Float64Array;
  private readonly turnT: Float64Array;
  private readonly turnDur: Float64Array;
  private readonly turnCx: Float64Array;
  private readonly turnCz: Float64Array;
  private readonly turnR: Float64Array;
  private readonly turnUx: Float64Array;
  private readonly turnUz: Float64Array;
  private readonly turnHx: Float64Array;
  private readonly turnHz: Float64Array;

  constructor(
    net: TrafficNetwork,
    spawns: readonly VehicleSpawn[],
    private readonly env: TrafficEnv,
  ) {
    this.net = net;
    this.carriedPath = Uint8Array.from(net.paths, (p) => (net.lines[p.line]?.carve === false ? 1 : 0));
    const n = Math.min(spawns.length, T.maxVehicles);
    this.count = n;
    const f64 = (): Float64Array => new Float64Array(n);
    this.body = new Int32Array(n);
    this.kind = [];
    this.active = new Uint8Array(n);
    this.gaveUp = new Uint8Array(n);
    this.path = new Int32Array(n);
    this.arc = f64();
    this.v = f64();
    this.x = f64();
    this.y = f64();
    this.z = f64();
    this.qx = f64();
    this.qy = f64();
    this.qz = f64();
    this.qw = f64();
    this.vx = f64();
    this.vy = f64();
    this.vz = f64();
    this.share = f64();
    this.cap = f64();
    this.len = f64();
    this.wid = f64();
    this.acc = f64();
    this.seed = new Int32Array(n);
    this.visits = new Int32Array(n);
    this.next = new Int32Array(n);
    this.prev = new Int32Array(n);
    this.committed = new Uint8Array(n);
    this.blocked = f64();
    this.accel = f64();
    this.opposite = oppositeLanes(net);
    this.leadGap = f64().fill(Infinity);
    this.waited = f64();
    this.turning = new Uint8Array(n);
    this.turnFrom = new Int32Array(n).fill(-1);
    this.turnFromLane = new Int32Array(n).fill(-1);
    this.turnFromArc = f64();
    this.turnT = f64();
    this.turnDur = f64();
    this.turnCx = f64();
    this.turnCz = f64();
    this.turnR = f64();
    this.turnUx = f64();
    this.turnUz = f64();
    this.turnHx = f64();
    this.turnHz = f64();
    for (let i = 0; i < n; i++) {
      const s = spawns[i];
      const spec = VEHICLE_SPECS[s.kind];
      this.body[i] = s.body;
      this.kind.push(s.kind);
      this.active[i] = 1;
      this.path[i] = s.path;
      this.arc[i] = Math.min(Math.max(0, s.arc), net.paths[s.path].length);
      this.seed[i] = s.seed | 0;
      this.share[i] = spec.share[0] + (spec.share[1] - spec.share[0]) * hash01(s.seed, 7);
      this.cap[i] = spec.cap;
      this.len[i] = spec.length;
      this.wid[i] = spec.width;
      this.acc[i] = spec.accel;
      this.prev[i] = -1;
      this.blocked[i] = Infinity;
      this.next[i] = this.choose(i, s.path);
      this.y[i] = s.y ?? NaN;
      this.pose(i);
    }
  }

  /** Vehicles still driving. */
  get driving(): number {
    let k = 0;
    for (let i = 0; i < this.count; i++) k += this.active[i];
    return k;
  }

  /** Stop driving vehicle i (it was hit, flooded or lost its road): it is no longer simulated. */
  release(i: number): void {
    this.active[i] = 0;
    this.committed[i] = 0;
    this.waited[i] = 0;
    this.turning[i] = 0;
    this.turnFrom[i] = -1;
    this.turnFromLane[i] = -1;
  }

  /** Index of the vehicle driving body `id`, or -1. */
  indexOfBody(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.body[i] === id) return i;
    return -1;
  }

  /** Signal state for traffic arriving at junction j on signal phase `group`, now. */
  signal(j: number, group: number): ReturnType<typeof signalState> {
    return signalState(this.net.junctions[j], group, this.time);
  }

  step(dt: number): void {
    const n = this.count;
    // Accelerations from the current state (every vehicle sees the same snapshot)...
    for (let i = 0; i < n; i++) {
      if (!this.active[i] || this.turning[i]) continue;
      if ((this.steps + i) % T.scanEvery === 0) this.scan(i);
      this.accel[i] = this.acceleration(i);
    }
    // ...then integrate in order.
    for (let i = 0; i < n; i++) {
      if (!this.active[i]) continue;
      if (this.turning[i]) {
        this.turnRound(i, dt);
        continue;
      }
      this.integrate(i, dt);
      if (this.waitOrTurnBack(i, dt)) continue;
      this.pose(i);
    }
    this.time += dt;
    this.steps++;
  }

  // --- turning round ------------------------------------------------------------------------

  /**
   * Counts how long vehicle i has stood right before something in its lane, and after
   * turnBackAfter s starts it turning round onto the opposite lane when that is clear and its box
   * has room all the way round (roomForTurn). After giveUpAfter s with no way round it gives up
   * (gaveUp). True if it started turning (its pose is then set) or gave up.
   */
  private waitOrTurnBack(i: number, dt: number): boolean {
    const nets = this.net.paths;
    const p = nets[this.path[i]];
    // The lane it is in, or (a few metres into a turn) the lane it came off: it turns round onto that
    // lane's opposite, beside where it stands.
    const prev = this.prev[i];
    const lane =
      p.kind === 'lane' ? p : p.kind === 'turn' && this.arc[i] <= 4 && prev >= 0 ? nets[prev] : null;
    const q = lane && lane.kind === 'lane' ? this.opposite[lane.id] : -1;
    const half = this.len[i] / 2;
    const ob = this.blocked[i] - half;
    const before = Number.isFinite(ob) && ob <= T.obstacleGap + T.probeStep + 1 && this.leadGap[i] > ob;
    if (this.v[i] >= 0.2 || !before) {
      this.waited[i] = 0;
      return false;
    }
    this.waited[i] += dt;
    if (this.waited[i] >= T.giveUpAfter) {
      // Nowhere to go (no room to turn, no lane the other way, or standing in a junction turn): it
      // stops being traffic rather than standing in the road (or turning into a wreck) for good.
      this.release(i);
      this.gaveUp[i] = 1;
      return true;
    }
    if (!lane || q < 0 || this.waited[i] < T.turnBackAfter) return false;
    const out = nets[q];
    const b = mirroredArc(lane, lane === p ? this.arc[i] : lane.length, out);
    if (!this.oppositeClear(i, out, b)) return false;
    // The half circle, from where it stands to the point beside it on the other lane, backing away
    // from what blocks it (forward, its nose would swing toward it: into the water at a flooded road).
    const f = this.along(i, 0.5);
    let hx = f.x;
    let hz = f.z;
    const r0 = this.along(i, -0.5);
    hx -= r0.x;
    hz -= r0.z;
    const px = this.x[i];
    const pz = this.z[i];
    const qp = pointAt(out, b, this.pt);
    const cx = (px + qp.x) / 2;
    const cz = (pz + qp.z) / 2;
    const r = Math.max(0.5, Math.hypot(qp.x - px, qp.z - pz) / 2);
    const ux = (px - cx) / r;
    const uz = (pz - cz) / r;
    // Its heading, square to the radius (a lane on a bend, or a turn, is not quite square to it).
    const along = hx * ux + hz * uz;
    hx -= along * ux;
    hz -= along * uz;
    let hl = Math.hypot(hx, hz);
    if (hl < 1e-6) {
      hx = -uz;
      hz = ux;
      hl = 1;
    }
    if (!this.roomForTurn(i, out, b, cx, cz, r, ux, uz, hx / hl, hz / hl)) return false;
    this.turnCx[i] = cx;
    this.turnCz[i] = cz;
    this.turnR[i] = r;
    this.turnUx[i] = ux;
    this.turnUz[i] = uz;
    this.turnHx[i] = hx / hl;
    this.turnHz[i] = hz / hl;
    this.turnT[i] = 0;
    this.turnDur[i] = Math.max(1.5, (Math.PI * r) / T.turnBackSpeed);
    this.turnFrom[i] = p.id;
    this.turnFromLane[i] = lane.id;
    this.turnFromArc[i] = this.arc[i];
    this.turning[i] = 1;
    // From here on it is on the other lane (where the vehicles there see it), standing until round.
    this.path[i] = q;
    this.arc[i] = b;
    this.v[i] = 0;
    this.prev[i] = -1;
    this.visits[i]++;
    this.committed[i] = 0;
    this.blocked[i] = Infinity;
    this.waited[i] = 0;
    this.next[i] = this.choose(i, q);
    this.turnRound(i, 0);
    return true;
  }

  /**
   * Room to turn round onto lane q at arc b: no vehicle on q within its length + turnBackAhead ahead
   * of b (where the half circle sweeps), and none driving toward b from within turnBackBehind behind
   * it. One standing there (blocked from the other side of the same fallen ice, say) is no danger: it
   * meets this one on q as the vehicle ahead, and two such would otherwise wait on each other for good.
   */
  private oppositeClear(i: number, q: TrafficPath, b: number): boolean {
    const nets = this.net.paths;
    for (let j = 0; j < this.count; j++) {
      if (j === i || !this.active[j]) continue;
      const pj = this.path[j];
      if (pj === q.id) {
        const d = this.arc[j] - b;
        if (d >= 0 && d < this.len[i] + T.turnBackAhead) return false;
        // (Standing or not, not so close behind that the two would end up overlapping.)
        if (d < 0 && d > -(this.len[i] + this.len[j]) / 2 - 1) return false;
        if (d < 0 && d > -T.turnBackBehind && this.v[j] > 0.5) return false;
      } else if (b < T.turnBackBehind && this.v[j] > 0.5) {
        // Coming onto q at its start (through a turn or U-turn, or committed to one). A vehicle standing
        // in such a turn is not coming (two blocked in one junction would wait on each other for
        // good); should it move on, it meets this one on q as the vehicle ahead.
        const path = nets[pj];
        const into = path.out === q.id || (this.committed[j] === 1 && nets[this.next[j]]?.out === q.id);
        if (into) return false;
      }
    }
    return true;
  }

  /**
   * Room for vehicle i's box all the way round the half circle about (cx, cz) of radius r (from the
   * point at unit offset (ux, uz), setting off along (hx, hz): turnRound's geometry), sampled at
   * turnBackSamples points, and at the pose it ends in on lane q at arc b (TrafficEnv.roomFor). The
   * oppositeClear check sees only driving vehicles; this sees what stands in the road (a bus the
   * iceberg knocked across it, a parked car, debris): without it a car turned round into a toppled bus
   * on Alpine Pass and then back and forth inside it, every ~9 s, for the rest of the run.
   */
  private roomForTurn(
    i: number,
    q: TrafficPath,
    b: number,
    cx: number,
    cz: number,
    r: number,
    ux: number,
    uz: number,
    hx: number,
    hz: number,
  ): boolean {
    const roomFor = this.env.roomFor;
    if (!roomFor) return true;
    const k = T.turnBackSamples;
    for (let m = 1; m <= k; m++) {
      const phi = (Math.PI * m) / k;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const x = cx + r * (c * ux - s * hx);
      const z = cz + r * (c * uz - s * hz);
      if (!roomFor(i, x, z, s * ux + c * hx, s * uz + c * hz)) return false;
    }
    // Where it ends: its pose on lane q (axle points along the lane, as pose() puts them).
    const a = this.len[i] * T.axleShare;
    const f = pointAt(q, b + a, this.endF);
    const e = pointAt(q, Math.max(0, b - a), this.endR);
    const dx = f.x - e.x;
    const dz = f.z - e.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return true;
    return roomFor(i, (f.x + e.x) / 2, (f.z + e.z) / 2, dx / l, dz / l);
  }

  /** roomForTurn(): the end pose's axle points (reused). */
  private readonly endF = { x: 0, z: 0 };
  private readonly endR = { x: 0, z: 0 };

  /**
   * Advances vehicle i dt s round its half circle and poses it there (done: back to driving). It
   * backs round: its centre at C + r (cos φ u − sin φ h), φ 0 → π, so it moves along
   * −(sin φ u + cos φ h) while facing (sin φ u + cos φ h): from facing h where it stood to facing −h
   * on the other lane.
   */
  private turnRound(i: number, dt: number): void {
    const t = Math.min(1, this.turnT[i] + dt / this.turnDur[i]);
    this.turnT[i] = t;
    if (t >= 1) {
      this.turning[i] = 0;
      this.turnFrom[i] = -1;
      this.turnFromLane[i] = -1;
      this.pose(i);
      return;
    }
    const phi = Math.PI * t;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const ux = this.turnUx[i];
    const uz = this.turnUz[i];
    const hx = this.turnHx[i];
    const hz = this.turnHz[i];
    const r = this.turnR[i];
    const x = this.turnCx[i] + r * (c * ux - s * hx);
    const z = this.turnCz[i] + r * (c * uz - s * hz);
    const fx = s * ux + c * hx;
    const fz = s * uz + c * hz;
    const a = this.len[i] * T.axleShare;
    this.poseAt(i, x + fx * a, z + fz * a, x - fx * a, z - fz * a, -T.turnBackSpeed);
  }

  // --- route --------------------------------------------------------------------------------

  /**
   * Successor of path p for vehicle i: weighted pick for lanes (among the ways on that are not
   * closed, if any is open), the only one otherwise.
   */
  private choose(i: number, p: number): number {
    const nets = this.net.paths;
    const path = nets[p];
    const succ = path.succ;
    if (succ.length === 0) return -1;
    if (succ.length === 1) return succ[0];
    const closed = this.env.closed;
    let open = 0;
    for (let k = 0; k < succ.length; k++) {
      const s = nets[succ[k]];
      const shut = closed ? closed(s) || (s.out >= 0 && closed(nets[s.out])) : false;
      this.shut[k] = shut ? 1 : 0;
      if (!shut) open++;
    }
    const skip = open > 0 && open < succ.length;
    let total = 0;
    for (let k = 0; k < succ.length; k++) if (!(skip && this.shut[k])) total += path.weights[k];
    let r = hash01(this.seed[i], this.visits[i] * 31 + p) * total;
    let last = -1;
    for (let k = 0; k < succ.length; k++) {
      if (skip && this.shut[k]) continue;
      last = succ[k];
      r -= path.weights[k];
      if (r < 0) return succ[k];
    }
    return last;
  }

  /** choose(): which successors are closed (reused). */
  private readonly shut = new Uint8Array(32);

  /** The path after `p` on vehicle i's route (its chosen next for its current path), or -1. */
  private after(i: number, p: number): number {
    if (p === this.path[i]) return this.next[i];
    const path = this.net.paths[p];
    return path.kind === 'lane' ? -1 : path.succ[0] ?? -1;
  }

  private limit(i: number, p: TrafficPath): number {
    return Math.min(this.cap[i], p.speed * (p.kind === 'lane' ? this.share[i] : 1));
  }

  // --- driving ------------------------------------------------------------------------------

  /** IDM acceleration against one obstacle `gap` m ahead moving at vLead (desired speed v0). */
  private idm(i: number, v0: number, gap: number, vLead: number): number {
    const v = this.v[i];
    const a = this.acc[i];
    const b = T.comfortBrake;
    const free = v0 > 0.01 ? 1 - (v / v0) ** 4 : -1;
    if (!Number.isFinite(gap)) return a * free;
    if (gap <= 0.05) return -T.maxBrake;
    const sStar = T.minGap + Math.max(0, v * T.headway + (v * (v - vLead)) / (2 * Math.sqrt(a * b)));
    return a * (free - (sStar / gap) ** 2);
  }

  private acceleration(i: number): number {
    const nets = this.net.paths;
    const p = nets[this.path[i]];
    const arc = this.arc[i];
    const half = this.len[i] / 2;
    const rem = p.length - arc;
    const nextId = this.next[i];
    const next = nextId >= 0 ? nets[nextId] : null;
    // Desired speed: own limit, and slowing ahead of a slower next path (a turn).
    let v0 = this.limit(i, p);
    if (next) {
      const vn = this.limit(i, next);
      v0 = Math.min(v0, Math.sqrt(vn * vn + 2 * T.comfortBrake * Math.max(0, rem - half)));
    } else {
      v0 = Math.min(v0, Math.sqrt(2 * T.comfortBrake * Math.max(0, rem - half - T.stopLineGap)));
    }
    let a = this.idm(i, v0, Infinity, 0);
    // The vehicle ahead (this path, then along the route).
    const lead = this.leader(i);
    this.leadGap[i] = lead.gap;
    if (lead.gap < T.lookahead) a = Math.min(a, this.idm(i, v0, lead.gap, lead.v));
    // Stop line.
    if (p.kind === 'lane' && next && p.junction >= 0 && !this.committed[i] && rem < T.lookahead) {
      if (this.mayEnter(i, p, nextId)) {
        if (rem - half < (this.v[i] * this.v[i]) / (2 * T.comfortBrake) + 3) this.committed[i] = 1;
      } else {
        // (Minus the jam distance: it pulls up stopLineGap short of the line, not minGap more.)
        a = Math.min(a, this.idm(i, v0, rem - half - T.stopLineGap + T.minGap - 0.2, 0));
      }
    }
    // Obstacle in the lane.
    const ob = this.blocked[i];
    if (Number.isFinite(ob)) a = Math.min(a, this.idm(i, v0, ob - half - T.obstacleGap, 0));
    return Math.max(-T.maxBrake, a);
  }

  /** May vehicle i (on lane p) enter turn `turn` now: the light, crossing turns, room beyond. */
  private mayEnter(i: number, p: TrafficPath, turn: number): boolean {
    const nets = this.net.paths;
    const t = nets[turn];
    if (p.leg >= 0) {
      const J = this.net.junctions[p.junction];
      const group = J.legs[p.leg].group;
      if (group >= 0) {
        const state = signalState(J, group, this.time);
        if (state === 'red') return false;
        if (state === 'amber') {
          const stopDist = this.len[i] / 2 + T.stopLineGap;
          const canStop = p.length - this.arc[i] - stopDist > (this.v[i] * this.v[i]) / (2 * T.comfortBrake);
          if (canStop) return false;
        }
      }
    }
    if (t.kind !== 'turn') return true;
    // Nobody on (or committed to) a turn that crosses this one.
    for (let j = 0; j < this.count; j++) {
      if (j === i || !this.active[j]) continue;
      const pj = this.path[j];
      if (t.conflicts.includes(pj)) return false;
      if (this.committed[j] && t.conflicts.includes(this.next[j])) return false;
    }
    // Room on the lane beyond for this vehicle and everyone already on (or committed to) the turn,
    // so nobody is left standing in the junction.
    const out = t.out;
    const outLength = nets[out].length;
    let room = outLength;
    let needed = this.len[i] + T.minGap;
    let shared = false;
    for (let j = 0; j < this.count; j++) {
      if (j === i || !this.active[j]) continue;
      if (this.path[j] === out) room = Math.min(room, this.arc[j] - this.len[j] / 2);
      else if (this.path[j] === turn || (this.committed[j] && this.next[j] === turn)) {
        needed += this.len[j] + T.minGap;
        shared = true;
      }
    }
    // A lane shorter than the vehicle needs (two junctions a few metres apart) is never roomy enough:
    // enter it once it is empty and nobody else is on or committed to the turn, not never.
    return room >= needed || (!shared && room >= outLength && outLength < needed);
  }

  private readonly lead = { gap: Infinity, v: 0, arc: Infinity };

  /** Gap (m, bumper to bumper) to and speed of the nearest vehicle ahead along i's route. */
  private leader(i: number): { gap: number; v: number } {
    const out = this.lead;
    out.gap = Infinity;
    out.v = 0;
    const nets = this.net.paths;
    let p = this.path[i];
    let offset = -this.arc[i];
    const half = this.len[i] / 2;
    for (let hop = 0; hop < 3 && p >= 0; hop++) {
      const path = nets[p];
      for (let j = 0; j < this.count; j++) {
        if (j === i || !this.active[j]) continue;
        const pj = this.path[j];
        let aj: number;
        const turning = hop === 1 && path.kind === 'turn' && nets[pj].kind === 'turn';
        if (pj === p) aj = this.arc[j];
        else if (this.turnFrom[j] === p) {
          // Turning round out of this path: it still stands in it where it set off.
          aj = this.turnFromArc[j];
        } else if (
          hop === 1 &&
          path.kind === 'turn' &&
          this.turnFromLane[j] === this.path[i] &&
          this.turnFrom[j] >= 0 &&
          nets[this.turnFrom[j]].kind === 'turn'
        ) {
          // Backing out of a sibling turn from my lane, across the junction's mouth.
          aj = this.turnFromArc[j];
        } else if (turning && this.prev[j] === this.path[i]) {
          // A vehicle on a sibling turn from my lane: it shares the turn's first metres.
          aj = this.arc[j];
          if (aj > 10) continue;
        } else continue;
        const d = offset + aj;
        if (d < 0 || (d === 0 && hop === 0 && j < i)) continue;
        const gap = d - half - this.len[j] / 2;
        if (gap < out.gap) {
          out.gap = gap;
          out.v = this.v[j];
        }
      }
      if (out.gap < Infinity) break;
      offset += path.length;
      if (offset > T.lookahead) break;
      p = this.after(i, p);
    }
    return out;
  }

  private integrate(i: number, dt: number): void {
    const nets = this.net.paths;
    let v = this.v[i] + this.accel[i] * dt;
    if (v < 0) v = 0;
    let da = v * dt;
    // Hard limits: never into the vehicle ahead, past a closed stop line or into an obstacle.
    const half = this.len[i] / 2;
    const lead = this.leader(i);
    let room = lead.gap - 0.3;
    const p = nets[this.path[i]];
    if (p.kind === 'lane' && p.junction >= 0 && !this.committed[i] && this.next[i] >= 0) {
      room = Math.min(room, p.length - this.arc[i] - half - T.stopLineGap * 0.5);
    }
    if (Number.isFinite(this.blocked[i])) room = Math.min(room, this.blocked[i] - half - 0.5);
    if (p.succ.length === 0) room = Math.min(room, p.length - this.arc[i] - half);
    if (da > room) {
      da = Math.max(0, room);
      v = Math.min(v, da / dt);
    }
    this.v[i] = v;
    let arc = this.arc[i] + da;
    let path = this.path[i];
    while (arc >= nets[path].length && this.next[i] >= 0) {
      arc -= nets[path].length;
      this.prev[i] = path;
      path = this.next[i];
      this.visits[i]++;
      this.committed[i] = 0;
      this.next[i] = this.choose(i, path);
    }
    this.path[i] = path;
    this.arc[i] = Math.min(arc, nets[path].length);
    // The obstacle stays where it was (until the next scan): it is now da closer.
    if (Number.isFinite(this.blocked[i])) this.blocked[i] -= da;
  }

  // --- geometry -----------------------------------------------------------------------------

  /**
   * World x/z of the point `delta` m from vehicle i along its route (into the next paths ahead,
   * into the previous one behind) into this.pt.
   */
  private along(i: number, delta: number): { x: number; z: number } {
    const nets = this.net.paths;
    let p = this.path[i];
    let a = this.arc[i] + delta;
    for (let hop = 0; hop < 3; hop++) {
      const L = nets[p].length;
      if (a > L) {
        const q = this.after(i, p);
        if (q < 0) {
          a = L;
          break;
        }
        a -= L;
        p = q;
      } else if (a < 0) {
        const q = hop === 0 ? this.prev[i] : -1;
        if (q < 0) {
          a = 0;
          break;
        }
        a += nets[q].length;
        p = q;
      } else break;
    }
    this.ptPath = p;
    return pointAt(nets[p], a, this.pt);
  }

  private pose(i: number): void {
    const half = this.len[i] * T.axleShare;
    const f = this.along(i, half);
    const fx = f.x;
    const fz = f.z;
    const r = this.along(i, -half);
    this.poseAt(i, fx, fz, r.x, r.z, this.v[i]);
  }

  /** Pose of vehicle i with its front and rear axle points at (fx, fz), (rx, rz), moving at v. */
  private poseAt(i: number, fx: number, fz: number, rx: number, rz: number, v: number): void {
    let dx = fx - rx;
    let dz = fz - rz;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = 0;
      dz = 1;
    }
    const cx = (fx + rx) / 2;
    const cz = (fz + rz) / 2;
    // Wheel contact heights: left of travel is (dz, -dx).
    const tw = this.wid[i] * T.trackShare;
    const env = this.env;
    const ref = this.y[i];
    const fl = env.support(fx + dz * tw, fz - dx * tw, ref);
    const fr = env.support(fx - dz * tw, fz + dx * tw, ref);
    const rl = env.support(rx + dz * tw, rz - dx * tw, ref);
    const rr = env.support(rx - dz * tw, rz + dx * tw, ref);
    const span = Math.max(l, 0.5);
    const pitch = Math.atan2((fl + fr - rl - rr) / 2, span);
    const roll = Math.atan2((fl + rl - fr - rr) / 2, 2 * tw);
    this.x[i] = cx;
    this.y[i] = (fl + fr + rl + rr) / 4;
    this.z[i] = cz;
    // q = yaw(about +y) · pitch(about local x; −pitch raises the front) · roll(about local z).
    const yaw = Math.atan2(dx, dz);
    const hy = yaw / 2;
    const hp = -pitch / 2;
    const hr = roll / 2;
    const cy = Math.cos(hy);
    const sy = Math.sin(hy);
    const cp = Math.cos(hp);
    const sp = Math.sin(hp);
    const cr = Math.cos(hr);
    const sr = Math.sin(hr);
    // yaw · pitch
    const ax = cy * sp;
    const ay = sy * cp;
    const az = -sy * sp;
    const aw = cy * cp;
    // (yaw · pitch) · roll, roll = (0, 0, sr, cr)
    this.qx[i] = ax * cr + ay * sr;
    this.qy[i] = ay * cr - ax * sr;
    this.qz[i] = aw * sr + az * cr;
    this.qw[i] = aw * cr - az * sr;
    this.vx[i] = dx * v * Math.cos(pitch);
    this.vz[i] = dz * v * Math.cos(pitch);
    this.vy[i] = v * Math.sin(pitch);
  }

  /** Probe vehicle i's route ahead and record the distance to the first blocked probe. */
  private scan(i: number): void {
    const scan = this.env.scan;
    if (!scan) return;
    const v = this.v[i];
    const reach = Math.min(T.probeMax, Math.max(T.probeMin, (v * v) / (2 * T.comfortBrake) + T.probeMargin));
    const half = this.len[i] / 2;
    let n = 0;
    for (let d = half; d <= half + reach && n < MAX_PROBES; d += T.probeStep) {
      const q = this.along(i, d);
      this.probeX[n] = q.x;
      this.probeZ[n] = q.z;
      this.probeY[n] = this.env.support(q.x, q.z, this.y[i]);
      this.probeArc[n] = d;
      this.probeCarried[n] = this.carriedPath[this.ptPath];
      n++;
    }
    const k = scan(i, this.probeX, this.probeY, this.probeZ, n, this.probeCarried);
    this.blocked[i] = k >= 0 ? this.probeArc[k] : Infinity;
  }
}

/** World x/z at arc `a` along a path into `out`. */
export function pointAt(p: TrafficPath, a: number, out: { x: number; z: number }): { x: number; z: number } {
  const arc = p.arc;
  const n = arc.length;
  if (a <= 0 || n < 2) {
    out.x = p.xs[0];
    out.z = p.zs[0];
    return out;
  }
  if (a >= p.length) {
    out.x = p.xs[n - 1];
    out.z = p.zs[n - 1];
    return out;
  }
  // Binary search for the segment.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= a) lo = mid;
    else hi = mid;
  }
  const l = arc[hi] - arc[lo];
  const t = l > 0 ? (a - arc[lo]) / l : 0;
  out.x = p.xs[lo] + (p.xs[hi] - p.xs[lo]) * t;
  out.z = p.zs[lo] + (p.zs[hi] - p.zs[lo]) * t;
  return out;
}

/**
 * Per path: the lane the other way along the same stretch of road, else -1. The network builds each
 * stretch's two lanes one after the other from the same centreline samples (src/core/traffic/network.ts
 * lane()), so a lane's opposite is its neighbour by id with the same line and sample count whose ends
 * lie across the road from its own (within two lane offsets and a metre).
 */
export function oppositeLanes(net: TrafficNetwork): Int32Array {
  const paths = net.paths;
  const out = new Int32Array(paths.length).fill(-1);
  const across = (a: TrafficPath, ai: number, b: TrafficPath, bi: number): number =>
    Math.hypot(a.xs[ai] - b.xs[bi], a.zs[ai] - b.zs[bi]);
  for (const p of paths) {
    if (p.kind !== 'lane') continue;
    const n = p.xs.length;
    for (const id of [p.id - 1, p.id + 1]) {
      const q = paths[id];
      if (!q || q.kind !== 'lane' || q.line !== p.line || q.xs.length !== n) continue;
      const reach = 2 * 2.6 + 1;
      if (across(p, 0, q, n - 1) < reach && across(p, n - 1, q, 0) < reach) {
        out[p.id] = q.id;
        break;
      }
    }
  }
  return out;
}

/**
 * Arc along lane q (the opposite of lane p) of the point across the road from arc a on p: both lanes
 * share their centreline samples in reverse order, so p's segment k is q's segment n − 2 − k.
 */
export function mirroredArc(p: TrafficPath, a: number, q: TrafficPath): number {
  const n = p.arc.length;
  if (n < 2 || q.arc.length !== n) return Math.max(0, q.length - a);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.arc[mid] <= a) lo = mid;
    else hi = mid;
  }
  const l = p.arc[hi] - p.arc[lo];
  const t = l > 0 ? Math.min(1, Math.max(0, (a - p.arc[lo]) / l)) : 0;
  const k = n - 2 - lo;
  return q.arc[k] + (1 - t) * (q.arc[k + 1] - q.arc[k]);
}
