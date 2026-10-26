import type { CourseCoord, LevelDef, Terrain } from '../types';
import { FELL_DEPTH } from '../fall';
import { sampleGradient } from '../heightGrid';
import { clamp } from '../math';
import { DEFAULT_ICEBERG_PARAMS, SIM_TUNING } from '../sim/params';
import { isGeneratedTerrain } from './terrain';

/**
 * Route tools for level design: can the iceberg get from the spawn to the sea, where do the other
 * branches dead-end, and does a jump clear a ravine?
 *
 * Energy model ("head" = v² / 2g, metres): moving costs friction (μ per metre), drag (head decays
 * as e^(−2·drag·metres)) and the climb; descending adds head, capped at maxSpeed. Faces steeper
 * than the sim's wallSlope cannot be climbed at any speed, and ground a fatal ravine lowered by
 * FELL_DEPTH or more ends the run. The search runs over a coarse grid of cells × 8 headings × a
 * short turn memory: each move goes to a neighbour cell, turning at most 45°. A turn costs
 * ROUTE_RULES.turnKeep of the head, unless it continues a turn the same way made within the last
 * TURN_AGES moves: then the 45° are carved within one or two cells, and it keeps what the sim keeps
 * for a 45° turn in that time (turnSpeedKeep: at speed, full lock scrubs it down to ~0.97 × the arc
 * length in m/s). So drifting across the slope (an S-bend through the 8 headings) stays cheap, but
 * a U-turn at speed in a pocket costs what it does in the sim. An iceberg that cannot go on stops
 * and may turn round (from rest it only slides downhill). Jumps: from floor cells near a ravine
 * (not ridge tops, tors or the walls), ballistic probes (probeFlight: ride the grid surface, take
 * off where the ground falls away faster than a ballistic path — kicker lips, cliff lips, crests —
 * and fly with drag) find the slowest take-off that lands the whole hull clear, and add a jump move
 * (usable from jumpShare of the arriving speed). The hull's wall probe (0.7 radius ahead) keeps a big
 * iceberg's centre off a wall it runs at.
 *
 * Calibration against the sim (autopilot runs on the lines of the six open levels): along the path
 * a run actually took, the model's friction, drag and gravity give its speed within 1–4 % on clean
 * stretches; the search's best head at the cells it passes runs a few to ~13 % above it (it picks
 * the best path, the autopilot steers), and obstacles, absorbed ice and dams are where real runs
 * lose more (ignored here). Kicker lips are read from the grid (they fly ~6–11 % shorter than the
 * exact lips the sim uses: pessimistic). So "no way to the sea" and a reported dead end are
 * reliable; a jump the search uses is not always achievable: jumpList reports each one's margin
 * (arrive vs speed), and a margin under ~10 % is marginal in the sim (Glacier Avalanche's right
 * couloir: 21.1 m/s needed, 22.9 arriving, real runs ~20; Highland Maze's Leap: 20.0 needed,
 * 21.0 arriving, and the line makes it). A route the search finds still needs the autopilot test.
 */

/** Turns remembered for this many moves (see the module comment). */
const TURN_AGES = 2;
/** Turn-memory tags per (cell, heading): 0 = none, 1 + side × TURN_AGES + (age − 1) otherwise. */
const TAGS = 1 + 2 * TURN_AGES;

/**
 * Share of its speed an iceberg keeps through a 45° turn completed in `T` s, against a straight run
 * of the same time (measured on flat ground at 8–30 m/s: steer 0.2 over ~3 s keeps 0.94–0.95,
 * steer 0.35 over 1.7–1.9 s 0.91–0.92, steer 0.5 over 1.3–1.45 s 0.87–0.89, full lock over
 * 0.75–0.88 s 0.71–0.76). Faster than full lock allows, it has to slow down to make the turn.
 */
export function turnSpeedKeep(T: number): number {
  if (!(T > 0)) return 0;
  return T >= 0.75 ? 0.95 - 0.22 * Math.exp(-(T - 0.75) / 0.55) : (0.73 * T) / 0.75;
}

export const ROUTE_RULES = {
  /** Nav cell = max(minCell, cellFactor × the terrain cellSize) metres. */
  cellFactor: 2,
  minCell: 3,
  /**
   * Head kept by a 45° change of heading that does not continue a recent turn the same way (a
   * gentle carve over a long arc: the sim keeps 0.94–0.95 of the speed). Turns that do (U-turns,
   * tight bends) keep what turnSpeedKeep says instead: at 0.95 for every turn, an iceberg could
   * U-turn at full speed out of any pocket.
   */
  turnKeep: 0.95,
  /** Rise (m) allowed above wallSlope × step on one sub-step (grid noise). */
  wallTolerance: 0.05,
  /**
   * A face steeper than wallSlope only lets a move through that goes down it: along it by at least
   * this share of its steepest descent (else the sim bounces or slides the iceberg off it).
   */
  descendShare: 0.5,
  /** Below this head (m) an iceberg may stop and turn round (also whenever it cannot go on). */
  stopHead: 1,
  /** Cells within this many nav cells of a ravine launch jump probes toward it. */
  jumpReach: 2,
  /** Slowest take-off speed tried (m/s). */
  jumpMinSpeed: 5,
  /**
   * A jump probe must land with the iceberg's centre at least this many radii past the ravine (the
   * whole hull over the far rim); a centre 0.1 m past the rim counted as clear.
   */
  landingRadii: 1,
  /**
   * Cells this rocky (Terrain wallness: wall ridges, islands, tors, the valley walls) or beyond the
   * floor edge are no take-off or landing for jump probes: probes off ridge tops and the wall foot
   * made sealed pockets look escapable.
   */
  perchWallness: 0.5,
  /**
   * A jump move needs a take-off speed of at most this share of the speed the model arrives with.
   * 1 keeps dead ends reliable (the model is an upper bound); 0.9, the validator's lineJumpShare,
   * would drop Glacier Avalanche's marginal right-couloir jumps but also Highland Maze's Leap,
   * which real runs make on 5 % margin. Read the margins in jumpList instead.
   */
  jumpShare: 1,
  /** Probe integration step (s) and longest flight (s). */
  probeStep: 1 / 120,
  probeFlight: 8,
  /** Bisection steps on the take-off speed. */
  probeIterations: 7,
  /** Dead-end clusters smaller than this (m²) are not reported. */
  minDeadEndArea: 200,
  /** Head slack (m) when comparing arrival head with what a cell needs. */
  tolerance: 0.05,
  /** The domain: from startS − this (m) to coastS + coastPast, out to halfWidth + wallShare × wallRamp. */
  startBack: 30,
  coastPast: 60,
  wallShare: 0.5,
} as const;

const RR = ROUTE_RULES;
const P = DEFAULT_ICEBERG_PARAMS;
const G = P.gravity;
/** Head at the speed cap. */
export const MAX_HEAD = (P.maxSpeed * P.maxSpeed) / (2 * G);
export const speedToHead = (v: number): number => (v * v) / (2 * G);
export const headToSpeed = (h: number): number => Math.sqrt(2 * G * Math.max(0, h));

const ravineDepth = (t: Terrain, x: number, z: number): number => t.ravineDepthAt?.(x, z) ?? 0;

/** The integrator's lip tolerance (m): see LIP_TOLERANCE in src/core/sim/iceberg.ts. */
const LIP_TOLERANCE = 0.02;

/**
 * The sim's wall rule for a move along (dirX, dirZ) onto a surface of gradient (gx, gz): a face
 * steeper than wallSlope stops the iceberg (it bounces off it, or slides off it sideways) unless
 * the move clearly goes down it.
 */
function isWallFace(gx: number, gz: number, dirX: number, dirZ: number): boolean {
  const gl = Math.hypot(gx, gz);
  return gl > SIM_TUNING.wallSlope && gx * dirX + gz * dirZ > -RR.descendShare * gl;
}

function steepAhead(t: Terrain, x: number, z: number, dirX: number, dirZ: number): boolean {
  const g = sampleGradient(t.grid, x, z);
  return isWallFace(g.dx, g.dz, dirX, dirZ);
}

/** A face too steep to climb at (x, z) that rises within 45° of square to (dirX, dirZ). */
function wallHeadOn(t: Terrain, x: number, z: number, dirX: number, dirZ: number): boolean {
  const g = sampleGradient(t.grid, x, z);
  const gl = Math.hypot(g.dx, g.dz);
  return gl > SIM_TUNING.wallSlope && g.dx * dirX + g.dz * dirZ > Math.SQRT1_2 * gl;
}

// --- jump probes ---------------------------------------------------------------------------------

export interface FlightResult {
  /**
   * 'landed' clear of every ravine; 'fell' into a fatal ravine (on the ground or on landing); 'wall'
   * into a face too steep to climb (riding, or flying into one: the sim bounces back down);
   * 'none' never took off within the reach.
   */
  outcome: 'landed' | 'fell' | 'wall' | 'none';
  /** Where the probe ended (the landing point when it landed). */
  x: number;
  y: number;
  z: number;
  /** Horizontal metres from the start to the end, and of them in the air. */
  distance: number;
  flown: number;
  /** True when the flight passed over a fatal ravine (a jump, not a hop). */
  over: boolean;
  /** Horizontal and vertical speed (m/s) at the end (touching down, when it landed). */
  speed: number;
  vy: number;
}

/**
 * Rides the terrain from (x, z) along the unit direction (dirX, dirZ) at a constant ground speed,
 * takes off where the ground falls away faster than a ballistic path (like the iceberg integrator:
 * a drop of more than airborneDrop within a step), and flies with air drag until it touches down.
 * Gives up as 'none' if it has not taken off after `reach` m. A landing whose point `margin` m back
 * along the flight is still on a fatal ravine's floor counts as 'fell' (the hull is not over).
 */
export function probeFlight(
  terrain: Terrain,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  speed: number,
  reach: number,
  margin = 0,
): FlightResult {
  const dt = RR.probeStep;
  const wall = SIM_TUNING.wallSlope;
  let y = terrain.heightAt(x, z);
  let v = speed;
  // Launch tests as the integrator's groundStep: the surface-following vertical speed (gradient of
  // the triangle being entered) for the drop and crest tests, and the descending part of the
  // vertical speed carried from the last step for its lip test (so a sheer edge is fallen off,
  // never walked down). `vy` is that carried speed on the ground, the flight's once airborne.
  let vy = 0;
  let air = false;
  let distance = 0;
  let flown = 0;
  let over = false;
  const end = (outcome: FlightResult['outcome']): FlightResult => ({
    outcome,
    x,
    y,
    z,
    distance,
    flown,
    over,
    speed: v,
    vy,
  });
  const steps = Math.ceil(RR.probeFlight / dt) + Math.ceil(reach / Math.max(1, v * dt));
  for (let i = 0; i < steps; i++) {
    const step = v * dt;
    const nx = x + dirX * step;
    const nz = z + dirZ * step;
    const ground = terrain.heightAt(nx, nz);
    if (!air) {
      const gr = sampleGradient(terrain.grid, x + dirX * 1e-3, z + dirZ * 1e-3);
      let vy0 = (gr.dx * dirX + gr.dz * dirZ) * v;
      let yBall = y + vy0 * dt - 0.5 * G * dt * dt;
      let launch = yBall - ground > P.airborneDrop;
      if (!launch && v > SIM_TUNING.minLaunchSpeed && ground <= yBall) {
        // A crest that curves away faster than gravity launches too.
        const tau = dt + SIM_TUNING.launchLookahead;
        const yb = y + vy0 * tau - 0.5 * G * tau * tau;
        launch = yb - terrain.heightAt(x + dirX * v * tau, z + dirZ * v * tau) > P.airborneDrop;
      }
      if (!launch) {
        // Lip test: a kink sharper than the steepest slideable slope is a drop-off.
        const vyIn = vy < 0 ? vy : 0;
        const yLip = y + vyIn * dt - 0.5 * G * dt * dt;
        if (yLip - ground > wall * step + LIP_TOLERANCE) {
          launch = true;
          vy0 = vyIn;
          yBall = yLip;
        }
      }
      if (launch) {
        air = true;
        vy = vy0 - G * dt;
        y = yBall;
      } else if (ground - y > wall * step + RR.wallTolerance || steepAhead(terrain, nx, nz, dirX, dirZ)) {
        return end('wall');
      } else {
        vy = (ground - y) / dt;
        y = ground;
        if (ravineDepth(terrain, nx, nz) >= FELL_DEPTH) {
          x = nx;
          z = nz;
          distance += step;
          return end('fell');
        }
        if (distance + step > reach) return end('none');
      }
      x = nx;
      z = nz;
      distance += step;
      continue;
    }
    vy -= G * dt;
    v *= Math.max(0, 1 - P.drag * v * dt);
    const ny = y + vy * dt;
    if (ny > ground) {
      x = nx;
      z = nz;
      y = ny;
      distance += step;
      flown += step;
      if (!over && ravineDepth(terrain, nx, nz) >= FELL_DEPTH) over = true;
      continue;
    }
    const g = sampleGradient(terrain.grid, nx, nz);
    if (Math.hypot(g.dx, g.dz) > wall && ny > terrain.heightAt(x, z)) return end('wall');
    x = nx;
    z = nz;
    y = ground;
    distance += step;
    flown += step;
    const short = margin > 0 && ravineDepth(terrain, nx - dirX * margin, nz - dirZ * margin) >= FELL_DEPTH;
    return end(short || ravineDepth(terrain, nx, nz) >= FELL_DEPTH ? 'fell' : 'landed');
  }
  return end('none');
}

/**
 * Slowest take-off speed (m/s, between jumpMinSpeed and maxSpeed) at which probeFlight from
 * (x, z) along (dirX, dirZ) flies over a ravine and lands clear (by `margin` m, see probeFlight);
 * Infinity if even maxSpeed does not.
 */
export function minClearSpeed(
  terrain: Terrain,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  reach: number,
  margin = 0,
): { speed: number; landing: FlightResult | null } {
  const clears = (v: number): FlightResult | null => {
    const f = probeFlight(terrain, x, z, dirX, dirZ, v, reach, margin);
    return f.outcome === 'landed' && f.over ? f : null;
  };
  let hi = P.maxSpeed;
  let best = clears(hi);
  if (!best) return { speed: Infinity, landing: null };
  let lo: number = RR.jumpMinSpeed;
  const low = clears(lo);
  if (low) return { speed: lo, landing: low };
  for (let k = 0; k < RR.probeIterations; k++) {
    const mid = 0.5 * (lo + hi);
    const f = clears(mid);
    if (f) {
      hi = mid;
      best = f;
    } else {
      lo = mid;
    }
  }
  return { speed: hi, landing: best };
}

// --- head along a line ---------------------------------------------------------------------------

/** Lateral offset of a course line at s (linear between points, held beyond the ends). */
function lineAt(line: readonly CourseCoord[], s: number): number {
  if (line.length === 0) return 0;
  if (s <= line[0].s) return line[0].d;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (s <= b.s) return b.s > a.s ? a.d + ((b.d - a.d) * (s - a.s)) / (b.s - a.s) : b.d;
  }
  return line[line.length - 1].d;
}

/**
 * Head (m) the energy model gives an iceberg following `line` from the start (spawn speed), every
 * `step` m of s from startS: what a good line carries into each stretch (heights include any
 * ravine it crosses, so a crossing is only judged by the head before it).
 */
export function lineHeads(terrain: Terrain, line: readonly CourseCoord[], step = 2): Float64Array {
  const level = terrain.level;
  const n = Math.max(2, Math.ceil((level.coastS - level.startS) / step) + 1);
  const out = new Float64Array(n);
  let p = terrain.course.toWorld(level.startS, lineAt(line, level.startS));
  let head = speedToHead(P.launchSpeed);
  out[0] = head;
  for (let i = 1; i < n; i++) {
    const s = level.startS + i * step;
    const q = terrain.course.toWorld(s, lineAt(line, s));
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    head = Math.min(MAX_HEAD, head * Math.exp(-2 * P.drag * len) - (q.y - p.y) - P.friction * len);
    if (head < 0) head = 0;
    out[i] = head;
    p = q;
  }
  return out;
}

// --- route search --------------------------------------------------------------------------------

export interface DeadEnd {
  /** Course coordinates of the cluster's centre, its area (m²) and cell count. */
  s: number;
  d: number;
  area: number;
  cells: number;
  /** 'ravine': it drains into a fatal ravine; 'trap': a hollow, closed channel or pocket. */
  cause: 'ravine' | 'trap';
}

export interface RouteAnalysis {
  /** True when some route reaches the coast (s ≥ coastS, or the sea). */
  solvable: boolean;
  /** The nav grid (cell metres, origin at level.bounds min corner). */
  cell: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  /** Per cell: best arrival head (m) over its headings; −1 = never reached. */
  head: Float32Array;
  /** Per cell: 1 if the sea is still reachable from it with the head it can arrive with. */
  live: Uint8Array;
  /** Farthest arc length any route reached. */
  reachedS: number;
  /** Reachable regions the sea cannot be reached from, largest first. */
  deadEnds: DeadEnd[];
  /** The route arriving at the coast with the most head, start → coast (course coordinates). */
  path: CourseCoord[];
  /** Jump moves found (take-offs that clear a ravine), and the time the analysis took (ms). */
  jumps: number;
  ms: number;
  /** Time (ms) per phase: cells, moves, jump probes, forward and backward search. */
  phases: { cells: number; moves: number; jumps: number; forward: number; backward: number };
  /**
   * Every jump move: take-off and landing (course coordinates), the slowest take-off that clears
   * (m/s) and the most speed the model arrives at the take-off with on that heading (m/s, 0 = never
   * reached). arrive − speed is the jump's margin: real runs carry about 0.9–1 of the model's speed
   * on a clean line (see the module comment), so a margin under ~10 % is marginal in the sim.
   */
  jumpList: { from: CourseCoord; to: CourseCoord; speed: number; arrive: number }[];
}

/** Neighbour offsets per heading k (k·45°, k = 0 → +x, 2 → +z). */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DZ = [0, 1, 1, 1, 0, -1, -1, -1];
/** Unit directions of the headings. */
const UX = DX.map((x, k) => x / Math.hypot(x, DZ[k]));
const UZ = DZ.map((z, k) => z / Math.hypot(DX[k], z));

/**
 * Monotone min-queue of (key, value) pairs: keys are bucketed every `step` over [min, max] (clamped),
 * and a key pushed is never below the bucket being popped (both searches expand by an energy that
 * no move improves), so popping walks the buckets once. Within a bucket the order is arbitrary
 * (later improvements re-push, as with a heap).
 */
class BucketQueue {
  private readonly head: Int32Array;
  private next: Int32Array = new Int32Array(1 << 16);
  private keys: Float64Array = new Float64Array(1 << 16);
  private vals: Int32Array = new Int32Array(1 << 16);
  private free = -1;
  private used = 0;
  private cursor = 0;
  size = 0;

  constructor(
    private readonly min: number,
    max: number,
    private readonly step: number,
  ) {
    this.head = new Int32Array(Math.max(1, Math.ceil((max - min) / step) + 2)).fill(-1);
  }

  push(key: number, val: number): void {
    let node = this.free;
    if (node >= 0) this.free = this.next[node];
    else {
      if (this.used === this.vals.length) this.grow();
      node = this.used++;
    }
    const nb = this.head.length;
    let b = Math.floor((key - this.min) / this.step);
    b = b < 0 ? 0 : b >= nb ? nb - 1 : b;
    if (b < this.cursor) b = this.cursor;
    this.keys[node] = key;
    this.vals[node] = val;
    this.next[node] = this.head[b];
    this.head[b] = node;
    this.size++;
  }

  private grow(): void {
    const n = this.vals.length * 2;
    const nx = new Int32Array(n);
    nx.set(this.next);
    this.next = nx;
    const k = new Float64Array(n);
    k.set(this.keys);
    this.keys = k;
    const v = new Int32Array(n);
    v.set(this.vals);
    this.vals = v;
  }

  /** Key of the next entry (call before pop; size > 0). */
  get topKey(): number {
    while (this.head[this.cursor] < 0) this.cursor++;
    return this.keys[this.head[this.cursor]];
  }

  pop(): number {
    while (this.head[this.cursor] < 0) this.cursor++;
    const node = this.head[this.cursor];
    this.head[this.cursor] = this.next[node];
    this.next[node] = this.free;
    this.free = node;
    this.size--;
    return this.vals[node];
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Default-option analyses per terrain (terrains are immutable): validateLevel and tests share one. */
const analysisCache = new WeakMap<Terrain, RouteAnalysis>();

/**
 * Search the routes from the spawn to the sea (see the module comment). With the default nav cell
 * the result is cached per terrain object: treat it as read-only.
 */
export function analyzeRoutes(terrain: Terrain, opts: { cell?: number } = {}): RouteAnalysis {
  if (opts.cell !== undefined) return searchRoutes(terrain, opts.cell);
  let r = analysisCache.get(terrain);
  if (!r) {
    r = searchRoutes(terrain, undefined);
    analysisCache.set(terrain, r);
  }
  return r;
}

function searchRoutes(terrain: Terrain, cell: number | undefined): RouteAnalysis {
  const t0 = now();
  const level: LevelDef = terrain.level;
  const b = level.bounds;
  const course = terrain.course;
  const nc = cell ?? Math.max(RR.minCell, RR.cellFactor * level.cellSize);
  const cols = Math.floor((b.maxX - b.minX) / nc) + 1;
  const rows = Math.floor((b.maxZ - b.minZ) / nc) + 1;
  const cells = cols * rows;
  const cx = (c: number): number => b.minX + (c % cols) * nc;
  const cz = (c: number): number => b.minZ + Math.floor(c / cols) * nc;

  // The level's iceberg: its wall probe reaches this far ahead of its centre (SIM_TUNING.wallProbe).
  const radius = P.radius * (level.iceberg?.scale ?? 1);
  const probeReach = SIM_TUNING.wallProbe * radius;
  const gen = isGeneratedTerrain(terrain) ? terrain : null;

  // Cells: domain, goal, height, ravine, course coordinates, perches (no jump take-off or landing).
  const inside = new Uint8Array(cells);
  const goal = new Uint8Array(cells);
  const deadly = new Uint8Array(cells);
  const perch = new Uint8Array(cells);
  const height = new Float32Array(cells);
  const cs = new Float32Array(cells);
  const cd = new Float32Array(cells);
  for (let c = 0; c < cells; c++) {
    const x = cx(c);
    const z = cz(c);
    const p = course.project(x, z);
    cs[c] = p.s;
    cd[c] = p.d;
    const hw = course.sampleAt(p.s).halfWidth;
    const along = p.s >= level.startS - RR.startBack && p.s <= level.coastS + RR.coastPast;
    if (!along || Math.abs(p.d) > hw + RR.wallShare * level.wallRamp) continue;
    inside[c] = 1;
    height[c] = terrain.heightAt(x, z);
    if (Math.abs(p.d) > hw || (gen !== null && gen.wallnessAt(x, z) > RR.perchWallness)) perch[c] = 1;
    if (ravineDepth(terrain, x, z) >= FELL_DEPTH) deadly[c] = 1;
    else if (p.s >= level.coastS || terrain.isOcean(x, z)) goal[c] = 1;
  }

  const tCells = now();
  // Moves: per cell and heading, 0 = open, 1 = wall, 2 = ravine, 3 = out of the domain.
  const step = Math.max(0.5, level.cellSize / 2);
  const wall = SIM_TUNING.wallSlope;
  const block = new Uint8Array(cells * 8);
  const climb = new Float32Array(cells * 8);
  const dh = new Float32Array(cells * 8);
  const len = DX.map((dx, k) => Math.hypot(dx, DZ[k]) * nc);
  const decay = len.map((l) => Math.exp(-2 * P.drag * l));
  // Samples along a move: on a nav grid aligned with the terrain grid, the grid's own vertices
  // (and the crossed cells' centres on anti-diagonals), where the surface is exact; else heightAt
  // every half terrain cell.
  const g = terrain.grid;
  const cutField = isGeneratedTerrain(terrain) ? terrain.cut : null;
  const ratio = nc / g.cellSize;
  const kGrid = Math.round(ratio);
  const aligned =
    Math.abs(ratio - kGrid) < 1e-9 &&
    Math.abs(g.originX - b.minX) < 1e-9 &&
    Math.abs(g.originZ - b.minZ) < 1e-9 &&
    (cutField !== null || !terrain.ravineDepthAt);
  const hs = new Float64Array(4 * Math.max(kGrid, 4) + 4);
  const cuts = new Float64Array(hs.length);
  const gxs = new Float64Array(hs.length);
  const gzs = new Float64Array(hs.length);
  /** Central-difference gradient at grid vertex (vx, vz), added (× w) into gxs/gzs[m]. */
  const vertexGrad = (vx: number, vz: number, m: number, w: number): void => {
    const gh = g.heights;
    const x0 = Math.max(0, vx - 1);
    const x1 = Math.min(g.cols - 1, vx + 1);
    const z0 = Math.max(0, vz - 1);
    const z1 = Math.min(g.rows - 1, vz + 1);
    gxs[m] += (w * (gh[vz * g.cols + x1] - gh[vz * g.cols + x0])) / ((x1 - x0) * g.cellSize);
    gzs[m] += (w * (gh[z1 * g.cols + vx] - gh[z0 * g.cols + vx])) / ((z1 - z0) * g.cellSize);
  };
  const sampleMove = (ix: number, iz: number, k: number): number => {
    if (aligned) {
      const gh = g.heights;
      let vx = ix * kGrid;
      let vz = iz * kGrid;
      let m = 0;
      const anti = DX[k] * DZ[k] < 0;
      for (let i = 0; i < kGrid; i++) {
        const nx = vx + DX[k];
        const nz = vz + DZ[k];
        if (anti) {
          // The crossed cell's centre lies on its (00)-(11) diagonal.
          const a = Math.min(vz, nz) * g.cols + Math.min(vx, nx);
          const q = Math.max(vz, nz) * g.cols + Math.max(vx, nx);
          hs[m] = 0.5 * (gh[a] + gh[q]);
          cuts[m] = cutField ? 0.5 * (cutField[a] + cutField[q]) : 0;
          gxs[m] = 0;
          gzs[m] = 0;
          vertexGrad(Math.min(vx, nx), Math.min(vz, nz), m, 0.5);
          vertexGrad(Math.max(vx, nx), Math.max(vz, nz), m++, 0.5);
        }
        const v = nz * g.cols + nx;
        hs[m] = gh[v];
        cuts[m] = cutField ? cutField[v] : 0;
        gxs[m] = 0;
        gzs[m] = 0;
        vertexGrad(nx, nz, m++, 1);
        vx = nx;
        vz = nz;
      }
      return m;
    }
    const m = Math.max(1, Math.ceil(len[k] / step));
    const x0 = b.minX + ix * nc;
    const z0 = b.minZ + iz * nc;
    for (let i = 1; i <= m; i++) {
      const x = x0 + (DX[k] * nc * i) / m;
      const z = z0 + (DZ[k] * nc * i) / m;
      hs[i - 1] = terrain.heightAt(x, z);
      cuts[i - 1] = ravineDepth(terrain, x, z);
      const gr = sampleGradient(g, x, z);
      gxs[i - 1] = gr.dx;
      gzs[i - 1] = gr.dz;
    }
    return m;
  };
  for (let c = 0; c < cells; c++) {
    if (!inside[c]) continue;
    if (deadly[c]) {
      block.fill(2, c * 8, c * 8 + 8);
      continue;
    }
    const ix = c % cols;
    const iz = Math.floor(c / cols);
    for (let k = 0; k < 8; k++) {
      const e = c * 8 + k;
      const jx = ix + DX[k];
      const jz = iz + DZ[k];
      if (jx < 0 || jz < 0 || jx >= cols || jz >= rows || !inside[jz * cols + jx]) {
        block[e] = 3;
        continue;
      }
      const m = sampleMove(ix, iz, k);
      const sub = len[k] / m;
      let prev = height[c];
      let need = 0;
      for (let i = 0; i < m; i++) {
        const h = hs[i];
        if (cuts[i] >= FELL_DEPTH) {
          block[e] = 2;
          break;
        }
        if (h - prev > wall * sub + RR.wallTolerance || isWallFace(gxs[i], gzs[i], UX[k], UZ[k])) {
          block[e] = 1;
          break;
        }
        need = Math.max(need, h - height[c] + P.friction * sub * (i + 1));
        prev = h;
      }
      // The hull's wall probe: a face too steep to climb, met head-on within probeReach ahead of
      // the cell it moves to, bounces it back (a big iceberg's centre stays that far from a wall).
      if (block[e] === 0) {
        const px = cx(c) + DX[k] * nc + UX[k] * probeReach;
        const pz = cz(c) + DZ[k] * nc + UZ[k] * probeReach;
        if (wallHeadOn(terrain, px, pz, UX[k], UZ[k])) block[e] = 1;
      }
      climb[e] = need;
      dh[e] = height[jz * cols + jx] - height[c];
    }
  }

  const tMoves = now();
  // Jump moves: from cells near a ravine, along a heading that runs into it.
  const jumpFrom: number[] = [];
  const jumpTo: number[] = [];
  const jumpNeed: number[] = [];
  const jumpDh: number[] = [];
  const jumpAt = new Int32Array(cells * 8).fill(-1);
  const margin = RR.landingRadii * radius;
  for (let c = 0; c < cells; c++) {
    if (!inside[c] || deadly[c] || goal[c] || perch[c]) continue;
    for (let k = 0; k < 8; k++) {
      let toward = false;
      let w = c;
      for (let j = 0; j <= RR.jumpReach && w >= 0; j++) {
        const bk = block[w * 8 + k];
        if (bk === 2) {
          toward = true;
          break;
        }
        if (bk !== 0) break;
        w += DZ[k] * cols + DX[k];
      }
      if (!toward) continue;
      const l = Math.hypot(DX[k], DZ[k]);
      const dirX = DX[k] / l;
      const dirZ = DZ[k] / l;
      const reach = (RR.jumpReach + 1) * len[k] + 4;
      const jump = minClearSpeed(terrain, cx(c), cz(c), dirX, dirZ, reach, margin);
      if (!jump.landing) continue;
      const lx = Math.round((jump.landing.x - b.minX) / nc);
      const lz = Math.round((jump.landing.z - b.minZ) / nc);
      if (lx < 0 || lz < 0 || lx >= cols || lz >= rows) continue;
      const land = lz * cols + lx;
      if (!inside[land] || deadly[land] || perch[land] || land === c) continue;
      jumpAt[c * 8 + k] = jumpFrom.length;
      jumpFrom.push(c * 8 + k);
      jumpTo.push(land * 8 + k);
      jumpNeed.push(speedToHead(jump.speed));
      jumpDh.push(jump.landing.y - height[c]);
    }
  }

  const tJumps = now();
  // Turn memory (see the module comment): the tag after a move, and the age of the recent turn the
  // same way it continues (0 = none: a gentle turn), per (tag, dk + 1).
  const tagNext = new Int8Array(TAGS * 3);
  const tagTight = new Int8Array(TAGS * 3);
  for (let t = 0; t < TAGS; t++) {
    const side = t === 0 ? -1 : Math.floor((t - 1) / TURN_AGES);
    const age = t === 0 ? 0 : ((t - 1) % TURN_AGES) + 1;
    tagNext[t * 3 + 1] = t === 0 || age >= TURN_AGES ? 0 : t + 1;
    for (const dk of [-1, 1]) {
      const s2 = dk > 0 ? 0 : 1;
      tagNext[t * 3 + dk + 1] = 1 + s2 * TURN_AGES;
      tagTight[t * 3 + dk + 1] = side === s2 ? age : 0;
    }
  }
  /** Moves that lead to each tag, for the backward search: pairs (tag before, dk) per tag. */
  const tagFrom: Int8Array[] = [];
  for (let t2 = 0; t2 < TAGS; t2++) {
    const list: number[] = [];
    for (let t = 0; t < TAGS; t++) {
      for (let dk = -1; dk <= 1; dk++) if (tagNext[t * 3 + dk + 1] === t2) list.push(t, dk);
    }
    tagFrom.push(Int8Array.from(list));
  }
  /**
   * Tags at least as free as each tag (no recent turn, or an older one the same way): a state is
   * dominated when one of those holds as much head at the same (cell, heading).
   */
  const freer: Int8Array[] = [];
  for (let t = 0; t < TAGS; t++) {
    const list: number[] = t === 0 ? [] : [0];
    const age = t === 0 ? 0 : ((t - 1) % TURN_AGES) + 1;
    for (let a = age + 1; t > 0 && a <= TURN_AGES; a++) list.push(t + a - age);
    freer.push(Int8Array.from(list));
  }
  /** Head after a tight 45° turn over `age` cells of heading k2 (turnSpeedKeep), from head h. */
  const tightHead = (h: number, age: number, k2: number): number => {
    const v = headToSpeed(h);
    return v > 0 ? speedToHead(v * turnSpeedKeep((age * len[k2]) / v)) : 0;
  };
  // Its inverse, tabulated per (age, diagonal) on a 0.05 m/s grid of entry speeds (non-decreasing).
  const vStep = 0.05;
  const vN = Math.ceil(P.maxSpeed / vStep) + 1;
  const tightOut = Array.from({ length: 2 * TURN_AGES }, (_, i) => {
    const dist = (Math.floor(i / 2) + 1) * len[i % 2];
    const out = new Float64Array(vN);
    for (let j = 1; j < vN; j++) {
      out[j] = Math.max(out[j - 1], j * vStep * turnSpeedKeep(dist / (j * vStep)));
    }
    return out;
  });
  /** Least head before a tight turn that leaves head `n` after it (Infinity if none can). */
  const tightNeed = (n: number, age: number, k2: number): number => {
    const out = tightOut[(age - 1) * 2 + (k2 & 1)];
    const want = headToSpeed(n);
    if (want > out[vN - 1]) return Infinity;
    let lo = 0;
    let hi = vN - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (out[mid] >= want) hi = mid;
      else lo = mid + 1;
    }
    return speedToHead(lo * vStep);
  };

  // Forward: the most head each (cell, heading, tag) state can be reached with. States are expanded
  // by total energy (height + head), which no move increases, so each is settled about once.
  const states = cells * 8 * TAGS;
  const cellOf = (st: number): number => Math.floor(st / TAGS) >> 3;
  const head = new Float32Array(states).fill(-1);
  const parent = new Int32Array(states).fill(-1);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let c = 0; c < cells; c++) {
    if (!inside[c]) continue;
    if (height[c] < minH) minH = height[c];
    if (height[c] > maxH) maxH = height[c];
  }
  const QSTEP = 0.01;
  let heap = new BucketQueue(-(maxH + MAX_HEAD) - 1, -minH + 1, QSTEP);
  const eps = 1e-3;
  const offset = DX.map((dx, k) => DZ[k] * cols + dx);
  const startPos = course.toWorld(level.startS, 0);
  const sx = Math.round((startPos.x - b.minX) / nc);
  const sz = Math.round((startPos.z - b.minZ) / nc);
  const start = clamp(sz, 0, rows - 1) * cols + clamp(sx, 0, cols - 1);
  const dir0 = course.sampleAt(level.startS);
  const a0 = Math.atan2(dir0.dirZ, dir0.dirX);
  const k0 = ((Math.round(a0 / (Math.PI / 4)) % 8) + 8) % 8;
  const head0 = speedToHead(P.launchSpeed);
  for (const k of [k0, (k0 + 1) & 7, (k0 + 7) & 7]) {
    head[(start * 8 + k) * TAGS] = head0;
    heap.push(-(height[start] + head0), (start * 8 + k) * TAGS);
  }
  let bestGoal = -1;
  let reachedS = level.startS;
  /** True when a freer tag of the same (cell, heading) already holds head h. */
  const dominated = (st: number, h: number): boolean => {
    const t = st % TAGS;
    const fr = freer[t];
    for (let i = 0; i < fr.length; i++) if (head[st - t + fr[i]] >= h - eps) return true;
    return false;
  };
  const relax = (st: number, h: number, from: number): void => {
    if (h > head[st] + eps && !dominated(st, h)) {
      head[st] = h;
      parent[st] = from;
      heap.push(-(height[cellOf(st)] + h), st);
    }
  };
  const jumpShare2 = RR.jumpShare * RR.jumpShare;
  while (heap.size > 0) {
    const top = -heap.topKey;
    const st = heap.pop();
    const t = st % TAGS;
    const ck = (st - t) / TAGS;
    const c = ck >> 3;
    const h = top - height[c];
    if (h < head[st] - eps || dominated(st, h + 2 * eps)) continue;
    const k = ck & 7;
    if (cs[c] > reachedS) reachedS = cs[c];
    if (goal[c]) {
      if (bestGoal < 0 || h > head[bestGoal]) bestGoal = st;
      continue;
    }
    let moved = false;
    for (let dk = -1; dk <= 1; dk++) {
      const k2 = (k + dk + 8) & 7;
      const e = c * 8 + k2;
      if (block[e] !== 0) continue;
      const ti = t * 3 + dk + 1;
      const age = tagTight[ti];
      const ht = dk === 0 ? h : age > 0 ? tightHead(h, age, k2) : h * RR.turnKeep;
      if (ht < climb[e] - RR.tolerance) continue;
      const h2 = Math.min(MAX_HEAD, ht * decay[k2] - dh[e] - P.friction * len[k2]);
      if (h2 < 0) continue;
      moved = true;
      relax(((c + offset[k2]) * 8 + k2) * TAGS + tagNext[ti], h2, st);
    }
    const j = jumpAt[ck];
    if (j >= 0 && h >= jumpNeed[j] / jumpShare2 - RR.tolerance) {
      moved = true;
      relax(jumpTo[j] * TAGS, Math.min(MAX_HEAD, Math.max(0, h - jumpDh[j])), st);
    }
    if (!moved || h < RR.stopHead) {
      for (let k2 = 0; k2 < 8; k2++) if (k2 !== k) relax((c * 8 + k2) * TAGS, 0, st);
    }
  }

  const tForward = now();
  // Backward: the least head each state needs to still reach the sea, expanded by the energy
  // needed (height + head), which never decreases going backward. Only states the forward search
  // reached, or kept out as dominated by a freer tag, count: a feasible move from a reached state
  // leads to one of those.
  const bestHead = new Float32Array(cells).fill(-1);
  const relevant = new Uint8Array(states);
  for (let c = 0; c < cells; c++) {
    const end = (c + 1) * 8 * TAGS;
    for (let st = c * 8 * TAGS; st < end; st++) {
      if (head[st] > bestHead[c]) bestHead[c] = head[st];
      const t = st % TAGS;
      let ok = head[st] >= 0;
      const fr = freer[t];
      for (let i = 0; i < fr.length && !ok; i++) ok = head[st - t + fr[i]] >= 0;
      relevant[st] = ok ? 1 : 0;
    }
  }
  const need = new Float32Array(states).fill(Infinity);
  heap = new BucketQueue(minH - 1, maxH + MAX_HEAD + 1, QSTEP);
  const atRest = new Uint8Array(cells);
  const jumpsInto = new Map<number, number[]>();
  jumpTo.forEach((to, i) => {
    const list = jumpsInto.get(to);
    if (list) list.push(i);
    else jumpsInto.set(to, [i]);
  });
  const lower = (st: number, n: number): void => {
    if (n <= MAX_HEAD && n < need[st] - eps && relevant[st] === 1) {
      need[st] = n;
      heap.push(height[cellOf(st)] + n, st);
    }
  };
  /** Every tag of (cell, heading) ck. */
  const lowerAll = (ck: number, n: number): void => {
    for (let t = 0; t < TAGS; t++) lower(ck * TAGS + t, n);
  };
  for (let c = 0; c < cells; c++) {
    if (!goal[c]) continue;
    for (let k = 0; k < 8; k++) lowerAll(c * 8 + k, 0);
  }
  while (heap.size > 0) {
    const top = heap.topKey;
    const st = heap.pop();
    const t2 = st % TAGS;
    const ck = (st - t2) / TAGS;
    const c = ck >> 3;
    const n = top - height[c];
    if (n > need[st] + eps) continue;
    const k2 = ck & 7;
    // From rest it may turn any way: every state of the cell needs nothing either (once per cell).
    if (n <= RR.tolerance && !atRest[c]) {
      atRest[c] = 1;
      for (let k = 0; k < 8; k++) lowerAll(c * 8 + k, 0);
    }
    // Moves into c along heading k2 come from the cell behind it, from headings k2 − 1 … k2 + 1
    // and the tags that leave t2.
    const fx = (c % cols) - DX[k2];
    const fz = Math.floor(c / cols) - DZ[k2];
    const from = fz * cols + fx;
    if (fx >= 0 && fz >= 0 && fx < cols && fz < rows && inside[from] && !goal[from]) {
      const e = from * 8 + k2;
      if (block[e] === 0) {
        const base = Math.max(0, climb[e], (n + dh[e] + P.friction * len[k2]) / decay[k2]);
        const tf = tagFrom[t2];
        for (let i = 0; i < tf.length; i += 2) {
          const t = tf[i];
          const dk = tf[i + 1];
          const k = (k2 - dk + 8) & 7;
          const age = tagTight[t * 3 + dk + 1];
          const hIn = dk === 0 ? base : age > 0 ? tightNeed(base, age, k2) : base / RR.turnKeep;
          lower((from * 8 + k) * TAGS + t, hIn);
        }
      }
    }
    const into = t2 === 0 ? jumpsInto.get(ck) : undefined;
    if (into) {
      for (const i of into) lowerAll(jumpFrom[i], Math.max(jumpNeed[i] / jumpShare2, n + jumpDh[i]));
    }
  }

  const tBackward = now();
  // Live and dead cells.
  const live = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    for (let st = c * 8 * TAGS; st < (c + 1) * 8 * TAGS; st++) {
      if (head[st] >= 0 && head[st] >= need[st] - RR.tolerance) live[c] = 1;
    }
  }
  const deadEnds: DeadEnd[] = [];
  const seen = new Uint8Array(cells);
  const stack: number[] = [];
  for (let c0 = 0; c0 < cells; c0++) {
    if (seen[c0] || bestHead[c0] < 0 || live[c0] || goal[c0]) continue;
    let n = 0;
    let ss = 0;
    let sd = 0;
    let ravine = false;
    stack.push(c0);
    seen[c0] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      n++;
      ss += cs[c];
      sd += cd[c];
      const ix = c % cols;
      const iz = Math.floor(c / cols);
      for (let k = 0; k < 8; k++) {
        if (block[c * 8 + k] === 2) ravine = true;
        const jx = ix + DX[k];
        const jz = iz + DZ[k];
        if (jx < 0 || jz < 0 || jx >= cols || jz >= rows) continue;
        const w = jz * cols + jx;
        if (seen[w] || bestHead[w] < 0 || live[w] || goal[w]) continue;
        seen[w] = 1;
        stack.push(w);
      }
    }
    const area = n * nc * nc;
    if (area < RR.minDeadEndArea) continue;
    deadEnds.push({ s: ss / n, d: sd / n, area, cells: n, cause: ravine ? 'ravine' : 'trap' });
  }
  deadEnds.sort((p, q) => q.area - p.area);

  // The best route, start → coast.
  const path: CourseCoord[] = [];
  if (bestGoal >= 0) {
    const cellsOnPath: number[] = [];
    for (let st = bestGoal, guard = 0; st >= 0 && guard < states; st = parent[st], guard++) {
      const c = cellOf(st);
      if (cellsOnPath[cellsOnPath.length - 1] !== c) cellsOnPath.push(c);
    }
    cellsOnPath.reverse();
    const every = Math.max(1, Math.round(10 / nc));
    cellsOnPath.forEach((c, i) => {
      if (i % every === 0 || i === cellsOnPath.length - 1) path.push({ s: cs[c], d: cd[c] });
    });
  }
  /** Most speed the model arrives at (cell, heading) ck with, over its turn tags (0 = never). */
  const bestArrive = (ck: number): number => {
    let h = -1;
    for (let t = 0; t < TAGS; t++) h = Math.max(h, head[ck * TAGS + t]);
    return h >= 0 ? headToSpeed(h) : 0;
  };

  return {
    solvable: bestGoal >= 0,
    cell: nc,
    cols,
    rows,
    originX: b.minX,
    originZ: b.minZ,
    head: bestHead,
    live,
    reachedS,
    deadEnds,
    path,
    jumps: jumpFrom.length,
    jumpList: jumpFrom.map((st, i) => ({
      from: { s: cs[st >> 3], d: cd[st >> 3] },
      to: { s: cs[jumpTo[i] >> 3], d: cd[jumpTo[i] >> 3] },
      speed: headToSpeed(jumpNeed[i]),
      arrive: bestArrive(st),
    })),
    ms: now() - t0,
    phases: {
      cells: tCells - t0,
      moves: tMoves - tCells,
      jumps: tJumps - tMoves,
      forward: tForward - tJumps,
      backward: tBackward - tForward,
    },
  };
}
