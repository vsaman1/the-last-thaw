import type {
  FlowQuery,
  IcebergState,
  RiverBank,
  RiverSample,
  RiverSampleKind,
  RiverTrailApi,
  Terrain,
} from '../types';
import { clamp, clamp01, headingToDir, lerp, smoothstep } from '../math';
import { valueNoise2 } from '../rng';
import { SegmentGrid } from './segmentGrid';

/**
 * The river trail: a continuous strip of water recorded behind the iceberg along the exact route
 * it travelled. Pure data — geometry is built from `samples` by ./geometry.ts.
 *
 * Waterfalls follow the flight: when the iceberg flies off a drop-off and lands lower, the sheet
 * leaves from the exact take-off point and runs along the recorded trajectory (x, y, z) to the
 * landing, kept clear of the ground under both banks (see emitFall).
 *
 * Invariants (checked by river.test.ts and river.gap.test.ts):
 *  - samples[i].s is strictly increasing; s is 3D arc length so waterfalls get texture length.
 *  - consecutive samples are never further apart than the decimation limit, except across a
 *    jumped ravine: there the river pours into the ravine and the landing sample has gapBefore.
 *    Nothing (geometry, flowAt, decimation) joins the two samples either side of a gap.
 *  - 'fall' samples and the samples either side of a gap are never removed by decimation.
 */

export interface RiverOptions {
  /** Horizontal distance the iceberg must travel before a new sample is recorded (m). */
  spacing: number;
  /** Hard cap on stored samples; the oldest straight stretches are merged when exceeded. */
  maxSamples: number;
  /** After a decimation pass the trail holds at most this fraction of maxSamples. */
  decimateTo: number;
  /** The newest samples decimation never touches (kept at full detail near the player). */
  protectTail: number;
  /** Longest horizontal segment decimation may create, per relaxation level (m). */
  mergeMaxLength: readonly number[];
  /** Width = widthFactor × iceberg radius before speed and noise modulation. */
  widthFactor: number;
  /** ± fraction of deterministic width noise along s. */
  widthNoise: number;
  /** Noise frequency of the width modulation (1/m along s). */
  widthNoiseFreq: number;
  /** Waterfall sheets are this much narrower than the river above them. */
  fallWidthFactor: number;
  /** Ocean plume width multiplier reached `oceanSpreadDistance` metres past the shore. */
  oceanWidthGrowth: number;
  oceanSpreadDistance: number;
  /** Water surface above the terrain on land (m). */
  landOffset: number;
  /** Plume surface above sea level (m). */
  oceanOffset: number;
  /**
   * A landing (or very steep grounded descent) dropping more than this becomes a waterfall. A
   * landing only if the ground under the flight also falls by more than this at a slope steeper
   * than steepFallSlope (a real drop-off, not a hop down a slope).
   */
  fallMinDrop: number;
  /** Max vertical and horizontal step between waterfall samples (m). */
  fallStep: number;
  /**
   * A waterfall sheet's centreline stays this far above the ground under its whole cross-section
   * (both banks and a margin), fallStandoff metres up- and downstream of it (so a face right behind
   * a steep sheet counts) and halfway back to the previous sample. Near the lip it starts at
   * landOffset and grows as the sheet falls; it ramps out over the last two samples into the
   * plunge pool (m). The geometry lifts bank vertices that are still too close.
   */
  fallClearance: number;
  fallStandoff: number;
  /**
   * A sheet needing a bigger lift than this has a face right beside it (a slow iceberg tipping
   * over a lip falls close to the cliff): it is moved out along the flight, at most fallMaxPush
   * and just short of the base (which may move out a little with it), if that brings the lift
   * under this; then lifted (m).
   */
  fallMaxLift: number;
  fallMaxPush: number;
  /** Descents steeper than this (rise/run) by more than fallMinDrop are waterfalls (cliffs). */
  steepFallSlope: number;
  /**
   * A landing pours a waterfall only if the drop-off's foot is more than fallMinDrop below the
   * lowest water within this many metres of trail before the take-off: the back of a kicker ramp
   * only returns to the floor the river ran on before the ramp, so that jump follows the ground.
   */
  approachLookback: number;
  /**
   * Jumped ravine (the ground under the flight climbs back up steeper than steepFallSlope by more
   * than fallMinDrop): the pour lands this far past the foot of the near wall (m)...
   */
  pourReach: number;
  /** ...and the water before the gap stops at least this far short of the far wall (m). */
  gapWallClearance: number;
  /** Ground segments that change height by more than this are subdivided (m). */
  maxVerticalStep: number;
  /** Seconds over which a new waterfall sheet unrolls from lip to base (staggered birth t). */
  fallPourTime: number;
  /** High-turbulence plunge pool length after a waterfall base (m). */
  plungeLength: number;
  minFlowSpeed: number;
  /** Flow speed = max(minFlowSpeed, flowSpeedFactor × iceberg speed) + slope bonus. */
  flowSpeedFactor: number;
  /** Extra flow speed per unit downhill slope (m/s). */
  slopeFlowBonus: number;
  maxSlopeBonus: number;
  maxFallFlowSpeed: number;
  baseTurbulence: number;
  /** Heading change per metre at which bend turbulence starts / saturates. */
  bendTurbulenceStart: number;
  bendTurbulenceFull: number;
  /**
   * Smallest spatial hash cell for flowAt/disturb (m). Whenever the hash is (re)built the cell
   * grows with the river width, so a wide river does not put many times more cells per segment
   * into the rebuild that follows every decimation pass.
   */
  hashCellSize: number;
  /** Radius of disturb() (m); at least half the current river width. */
  disturbRadius: number;
  /** Seed for the deterministic width noise. */
  seed: number;
}

export const DEFAULT_RIVER_OPTIONS: Readonly<RiverOptions> = Object.freeze({
  spacing: 1.2,
  maxSamples: 5000,
  decimateTo: 0.85,
  protectTail: 400,
  mergeMaxLength: [6, 10, 16, 24],
  widthFactor: 2.6,
  widthNoise: 0.15,
  widthNoiseFreq: 0.035,
  fallWidthFactor: 0.85,
  oceanWidthGrowth: 3,
  oceanSpreadDistance: 40,
  landOffset: 0.15,
  oceanOffset: 0.06,
  fallMinDrop: 3,
  fallStep: 1.2,
  fallClearance: 0.35,
  fallStandoff: 0.6,
  fallMaxLift: 1,
  fallMaxPush: 3,
  steepFallSlope: 1.5,
  approachLookback: 30,
  pourReach: 1.5,
  gapWallClearance: 1.5,
  maxVerticalStep: 1.5,
  fallPourTime: 0.35,
  plungeLength: 6,
  minFlowSpeed: 3,
  flowSpeedFactor: 0.55,
  slopeFlowBonus: 10,
  maxSlopeBonus: 6,
  maxFallFlowSpeed: 24,
  baseTurbulence: 0.06,
  bendTurbulenceStart: 0.03,
  bendTurbulenceFull: 0.3,
  hashCellSize: 8,
  disturbRadius: 6,
  seed: 7919,
});

/** A stored sample: the public RiverSample plus a change stamp for incremental renderers. */
export interface TrailSample extends RiverSample {
  /** Value of `trail.version` when this sample was last written. */
  rev: number;
}

/** Snapshot of trail bookkeeping, for debugging and agent inspection. */
export interface RiverTrailStats {
  sampleCount: number;
  length: number;
  fallSamples: number;
  oceanSamples: number;
  /** Jumped ravines (samples with gapBefore). */
  gaps: number;
  version: number;
  structureVersion: number;
  decimations: number;
  hashCells: number;
  /** (cell, segment) pairs in the spatial hash: the work of the rebuild after a decimation. */
  hashEntries: number;
  /** Current spatial hash cell size (m). */
  hashCellSize: number;
}

const AIR_PATH_CAP = 512;
/** Airborne positions are recorded this fraction of `spacing` apart (3D) until the cap is hit. */
const AIR_STEP = 0.5;
/** Columns either side of the centre probed across a waterfall cross-section (as the geometry). */
const FALL_COLS = 4;
/** Probes reach this far past a waterfall sheet's banks (m). */
const FALL_BANK_MARGIN = 0.3;
/** Fall samples before the base over which the clearance ramps out into the plunge pool. */
const FALL_CLEAR_RAMP = 2;
/** Clearance gained per metre a sheet has fallen below its lip, from landOffset up. */
const FALL_CLEAR_PER_DROP = 0.5;
/** Clearance lifts that would make a falling sheet rise less than this are left to the geometry (m). */
const FALL_MAX_RISE = 0.3;
/** Shaped waterfall steps longer than this many fallSteps are split into straight-line samples. */
const FALL_SPLIT = 1.5;
/** flowAt ignores a waterfall sheet more than this high above the ground under it (m). */
const FALL_WET_REACH = 1.5;
/**
 * A waterfall's base may move out along the flight by up to this share of `spacing` (less than
 * one sample spacing, so the next sample recorded behind it is still ahead of it).
 */
const FALL_BASE_PUSH = 0.75;
/** Step of the search for how far to move a sheet out from a face beside it (m). */
const FALL_PUSH_STEP = 0.25;
/** Ground probe spacing along the flight path when looking for the drop-off under it (m). */
const AIR_PROBE_STEP = 0.3;
/** Shortest stretch of water worth laying between a pour and the gap (m). */
const MIN_POOL = 0.3;
/** Ground under a cross-section next to a ravine wall may differ this much from its centre (m). */
const BANK_STEP = 1;
/** Turbulence of the splash where the river restarts after a gap, and its length (m). */
const GAP_SPLASH = 0.6;
const GAP_SPLASH_LENGTH = 3;
/** Hash cell size per metre of river width (see hashCellSize). */
const HASH_CELL_PER_WIDTH = 0.7;
const GRAVITY = 9.81;
const MAX_FILL_SAMPLES = 2000;

// 15 bits per axis keeps keys non-negative and in V8 small-integer range; distant cells
// alias (2^15 cells apart), which only adds candidates the exact distance test then rejects.
const cellKey = (cx: number, cz: number): number => ((cx & 0x7fff) << 15) | (cz & 0x7fff);

export class RiverTrail implements RiverTrailApi {
  readonly options: Readonly<RiverOptions>;

  private readonly list: TrailSample[] = [];
  private readonly pool: TrailSample[] = [];
  private _version = 0;
  private _structureVersion = 0;
  private _decimations = 0;

  /** Indices of samples with gapBefore, ascending. */
  private readonly gapIdx: number[] = [];
  private readonly grid = new SegmentGrid();
  private marks: Int32Array = new Int32Array(1024);
  private markStamp = 0;
  /** 1 / current hash cell size. */
  private cellInv: number;
  private readonly flowResult: FlowQuery = { vx: 0, vz: 0, surfaceY: 0, strength: 0 };

  // recorder state
  private seaLevel = 0;
  private inAir = false;
  private hasGround = false;
  private groundX = 0;
  private groundZ = 0;
  /** The iceberg's height there: above the terrain grid on a kicker's exact face. */
  private groundY = 0;
  private landWidth = 0;
  private boostLevel = 0;
  private boostEndS = -Infinity;
  private boostFade = 4;
  private _coastS: number | null = null;
  // the current flight (iceberg base positions), decimated by halving when the cap is reached
  private readonly airX = new Float64Array(AIR_PATH_CAP);
  private readonly airY = new Float64Array(AIR_PATH_CAP);
  private readonly airZ = new Float64Array(AIR_PATH_CAP);
  private airCount = 0;
  private airStep = 0;
  private readonly pathX: number[] = [];
  private readonly pathZ: number[] = [];
  /** Water level along the flight path (lip, airborne points, landing); set by land() only. */
  private readonly pathY: number[] = [];
  private readonly tailX: number[] = [];
  private readonly tailZ: number[] = [];
  private readonly stepX: number[] = [0, 0];
  private readonly stepZ: number[] = [0, 0];
  private readonly fallU: number[] = [];
  // waterfall points before emitFall shapes them (the base last); rawU = share of the pour
  private readonly rawX: number[] = [];
  private readonly rawY: number[] = [];
  private readonly rawZ: number[] = [];
  private readonly rawU: number[] = [];
  // ground profile under the last flight: arc length along pathX/pathZ and water level there
  private probeArc = new Float64Array(2048);
  private probeG = new Float64Array(2048);
  private probeCount = 0;
  /** Arc of the foot, and water level at the top, of the drop-off found by dropOffUnderFlight. */
  private dropFoot = 0;
  private dropTop = 0;
  /** The next pushed sample starts a new stretch after a jumped gap. */
  private nextGap = false;
  /** Samples laid by seed(), and the structureVersion they were laid at. */
  private seedCount = 0;
  private seedStructure = -1;

  // per-record inputs shared by the append helpers (avoids threading 6 args everywhere)
  private curTime = 0;
  private curSpeed = 0;
  private curRadius = 2.2;
  private curHeading = 0;
  /** The corridor the water laid now may spread across (record's `bank`; RiverSample.bank). */
  private curBank: RiverBank | null = null;
  private curTerrain: Terrain | null = null;
  /** Set by fallNeed. */
  private needCentre = 0;

  constructor(opts?: Partial<RiverOptions>) {
    this.options = Object.freeze({ ...DEFAULT_RIVER_OPTIONS, ...opts });
    this.cellInv = 1 / this.options.hashCellSize;
  }

  get samples(): readonly TrailSample[] {
    return this.list;
  }

  /** Bumped on every change (append, disturb, decimation, reset). */
  get version(): number {
    return this._version;
  }

  /**
   * Bumped only when existing samples are removed or re-indexed (decimation, reset). Renderers
   * must rebuild everything when this changes; otherwise only chunks containing samples whose
   * `rev` is newer than their last build need rebuilding.
   */
  get structureVersion(): number {
    return this._structureVersion;
  }

  /** Trail length (s of the newest sample), 0 when empty. */
  get length(): number {
    const n = this.list.length;
    return n > 0 ? this.list[n - 1].s : 0;
  }

  /**
   * s at which the trail first entered the ocean, or null if it never has. Kept on later re-entries:
   * the plume fades with distance past it, and moving it forward would make the plume that already
   * faded out opaque again.
   */
  get coastS(): number | null {
    return this._coastS;
  }

  get stats(): RiverTrailStats {
    let falls = 0;
    let ocean = 0;
    let gaps = 0;
    for (const s of this.list) {
      if (s.kind === 'fall') falls++;
      else if (s.kind === 'ocean') ocean++;
      if (s.gapBefore) gaps++;
    }
    return {
      sampleCount: this.list.length,
      length: this.length,
      fallSamples: falls,
      oceanSamples: ocean,
      gaps,
      version: this._version,
      structureVersion: this._structureVersion,
      decimations: this._decimations,
      hashCells: this.grid.cellCount,
      hashEntries: this.grid.entryCount,
      hashCellSize: 1 / this.cellInv,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------------------------

  record(iceberg: IcebergState, terrain: Terrain, time: number, bank: RiverBank | null = null): void {
    const x = iceberg.pos.x;
    const z = iceberg.pos.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.curBank = bank;
    const y = iceberg.pos.y;
    this.seaLevel = terrain.level.seaLevel;
    this.curTerrain = terrain;
    this.curTime = time;
    const speed = Math.hypot(iceberg.vel.x, iceberg.vel.z);
    // A NaN here would poison width/flow of every later sample (lerped), so drop it at the door.
    this.curSpeed = Number.isFinite(speed) ? speed : 0;
    this.curRadius = iceberg.radius > 0 ? iceberg.radius : 2.2;
    this.curHeading = Number.isFinite(iceberg.heading) ? iceberg.heading : 0;

    const airborne = !iceberg.grounded && !iceberg.inOcean;
    const before = this.list.length;

    if (airborne) {
      if (!this.inAir) this.beginAir(terrain);
      if (Number.isFinite(y)) this.trackAir(x, y, z);
      if (this.list.length !== before) this.afterAppend();
      return;
    }

    const ocean = this.isOceanAt(terrain, x, z, iceberg.inOcean);
    if (this.inAir) {
      this.inAir = false;
      this.land(x, z, ocean, terrain);
    } else if (this.list.length === 0) {
      this.pushSample(x, this.waterAtIceberg(terrain, x, y, z, ocean), z, ocean ? 'ocean' : 'flow', 0);
    } else {
      const last = this.list[this.list.length - 1];
      if (Math.hypot(x - last.x, z - last.z) >= this.options.spacing) {
        this.pathX.length = 0;
        this.pathZ.length = 0;
        this.pathX.push(last.x, x);
        this.pathZ.push(last.z, z);
        const at = this.waterAtIceberg(terrain, x, y, z, ocean);
        this.appendAlongPath(this.pathX, this.pathZ, terrain, ocean, at);
      }
    }
    this.hasGround = true;
    this.groundX = x;
    this.groundZ = z;
    this.groundY = Number.isFinite(y) ? y : terrain.heightAt(x, z);
    if (this.list.length !== before) this.afterAppend();
  }

  /**
   * Lay a stretch of river before anything is recorded (the meltwater running out of the glacier
   * socket down to the spawn point, ./meltwater.ts): water-level points (xs, ys, zs), each born at
   * births[i] (the water shader hides samples not born yet). The last point should be the
   * iceberg's position, so the first record() continues from it. Only on an empty trail. Nothing is
   * charged for it: the water budget is the iceberg's melting, which this does not touch.
   */
  seed(
    iceberg: IcebergState,
    terrain: Terrain,
    xs: readonly number[],
    ys: readonly number[],
    zs: readonly number[],
    births: readonly number[],
  ): void {
    if (this.list.length > 0) return;
    this.seaLevel = terrain.level.seaLevel;
    this.curTerrain = terrain;
    const speed = Math.hypot(iceberg.vel.x, iceberg.vel.z);
    this.curSpeed = Number.isFinite(speed) ? speed : 0;
    this.curRadius = iceberg.radius > 0 ? iceberg.radius : 2.2;
    this.curHeading = Number.isFinite(iceberg.heading) ? iceberg.heading : 0;
    for (let i = 0; i < xs.length; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || !Number.isFinite(zs[i])) continue;
      this.curTime = Number.isFinite(births[i]) ? births[i] : 0;
      this.pushSample(xs[i], ys[i], zs[i], 'flow', 0);
    }
    const n = this.list.length;
    if (n === 0) return;
    // The river laid in play must not change because of this (river widths and flows move loose
    // bodies, and the physics is chaotic): the last point is the trail's start as it would have
    // been, at s = 0 with a first sample's width, flow and direction; the stretch has s < 0.
    const last = this.list[n - 1];
    for (let i = 0; i < n - 1; i++) this.list[i].s -= last.s;
    last.s = 0;
    const o = this.options;
    const speedT = smoothstep(6, 28, this.curSpeed);
    const noise = valueNoise2(0, 0.37, o.seed);
    const target = o.widthFactor * this.curRadius * (0.96 + 0.16 * speedT) * (1 + o.widthNoise * noise);
    this.landWidth = target;
    last.width = target;
    last.flowSpeed = Math.max(o.minFlowSpeed, o.flowSpeedFactor * this.curSpeed);
    last.turbulence = o.baseTurbulence;
    const d = headingToDir(this.curHeading);
    last.dirX = d.x;
    last.dirZ = d.z;
    this.rebuildHash();
    this.seedCount = n;
    this.seedStructure = this._structureVersion;
  }

  /** Samples laid by seed() at the start of the trail; 0 once decimation or a reset touched them. */
  get seeded(): number {
    return this.seedStructure === this._structureVersion ? this.seedCount : 0;
  }

  /** Re-time the seeded stretch: births[i] for its i-th sample (while it is still intact). */
  retimeSeed(births: readonly number[]): void {
    const n = Math.min(this.seeded, births.length);
    const rev = this._version + 1;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const s = this.list[i];
      if (s.t === births[i] || !Number.isFinite(births[i])) continue;
      s.t = births[i];
      s.rev = rev;
      changed = true;
    }
    if (changed) this._version = rev;
  }

  private afterAppend(): void {
    if (this.list.length > this.options.maxSamples) this.decimate();
  }

  private isOceanAt(terrain: Terrain, x: number, z: number, icebergInOcean: boolean): boolean {
    if (terrain.isOcean(x, z)) return true;
    return icebergInOcean && terrain.heightAt(x, z) < this.seaLevel + 0.1;
  }

  private surfaceY(terrain: Terrain, x: number, z: number, ocean: boolean): number {
    const o = this.options;
    return ocean ? this.seaLevel + o.oceanOffset : terrain.heightAt(x, z) + o.landOffset;
  }

  /**
   * Water level under a grounded iceberg at (x, y, z): the surface there, or the iceberg's own base
   * if that is higher (riding a kicker's exact face, above the terrain grid's truncated lip).
   */
  private waterAtIceberg(terrain: Terrain, x: number, y: number, z: number, ocean: boolean): number {
    const w = this.surfaceY(terrain, x, z, ocean);
    return ocean || !Number.isFinite(y) ? w : Math.max(w, y + this.options.landOffset);
  }

  private beginAir(terrain: Terrain): void {
    const o = this.options;
    this.inAir = true;
    this.airCount = 0;
    this.airStep = AIR_STEP * o.spacing;
    if (!this.hasGround) return;
    const n = this.list.length;
    const gx = this.groundX;
    const gz = this.groundZ;
    const ocean = this.isOceanAt(terrain, gx, gz, false);
    // The lip is exactly where (and as high as) the iceberg left the ground, so a waterfall starts
    // at the take-off point. Off a kicker's exact face that is above the terrain grid, whose
    // truncated lip can even lie part way down the cliff the kicker launches over.
    const lipY = ocean
      ? this.surfaceY(terrain, gx, gz, true)
      : Math.max(this.surfaceY(terrain, gx, gz, false), this.groundY + o.landOffset);
    if (n === 0) {
      this.pushSample(gx, lipY, gz, ocean ? 'ocean' : 'flow', 0);
      return;
    }
    const last = this.list[n - 1];
    if (Math.hypot(gx - last.x, gz - last.z) >= 0.25) {
      this.pathX.length = 0;
      this.pathZ.length = 0;
      this.pathX.push(last.x, gx);
      this.pathZ.push(last.z, gz);
      this.appendAlongPath(this.pathX, this.pathZ, terrain, ocean, lipY);
    }
  }

  /**
   * Record an airborne position (the iceberg's base). Points are kept airStep apart in 3D; a flight
   * too long for the buffer keeps every other point and from then on records half as often.
   */
  private trackAir(x: number, y: number, z: number): void {
    const ax = this.airX;
    const ay = this.airY;
    const az = this.airZ;
    let c = this.airCount;
    if (c > 0 && Math.hypot(x - ax[c - 1], y - ay[c - 1], z - az[c - 1]) < this.airStep) return;
    if (c === AIR_PATH_CAP) {
      c >>= 1;
      for (let i = 1; i < c; i++) {
        ax[i] = ax[2 * i];
        ay[i] = ay[2 * i];
        az[i] = az[2 * i];
      }
      this.airStep *= 2;
    }
    ax[c] = x;
    ay[c] = y;
    az[c] = z;
    this.airCount = c + 1;
  }

  private land(x: number, z: number, ocean: boolean, terrain: Terrain): void {
    const n = this.list.length;
    if (n === 0) {
      this.pushSample(x, this.surfaceY(terrain, x, z, ocean), z, ocean ? 'ocean' : 'flow', 0);
      this.airCount = 0;
      return;
    }
    const o = this.options;
    const lip = this.list[n - 1];
    const baseY = this.surfaceY(terrain, x, z, ocean);
    // The flight: lip, airborne positions (water at the iceberg's base, as on the ground), landing.
    const px = this.pathX;
    const py = this.pathY;
    const pz = this.pathZ;
    px.length = 0;
    py.length = 0;
    pz.length = 0;
    px.push(lip.x);
    py.push(lip.y);
    pz.push(lip.z);
    for (let i = 0; i < this.airCount; i++) {
      px.push(this.airX[i]);
      py.push(this.airY[i] + o.landOffset);
      pz.push(this.airZ[i]);
    }
    px.push(x);
    py.push(baseY);
    pz.push(z);
    this.airCount = 0;

    const drop = lip.y - baseY;
    const lipS = lip.s;
    this.probeFlight(terrain);
    const refY = this.approachLevel(lip);
    const climb = this.steepClimbUnderFlight();
    const edge = drop > o.fallMinDrop ? this.dropOffUnderFlight(this.probeCount - 1, refY) : -1;
    if (climb >= 0 && !(edge >= 0 && this.farSideLower(climb, refY))) {
      // A jumped ravine with its far side about as high as this one: water cannot fly, it pours
      // into the ravine and the river restarts at the landing.
      this.pourIntoGap(climb, refY, terrain);
      this.nextGap = true;
      const sm = this.pushSample(x, baseY, z, ocean ? 'ocean' : 'flow', GAP_SPLASH);
      this.setBoost(GAP_SPLASH, sm.s, GAP_SPLASH_LENGTH, 4);
      return;
    }
    if (edge >= 0) {
      // A waterfall: out from the take-off point along the flight, down to where it landed.
      this.resampleFlight();
      this.emitFall(ocean);
      return;
    }
    this.appendAlongPath(px, pz, terrain, ocean);
    if (drop > 0.4) this.setBoost(clamp(0.35 + drop * 0.15, 0, 0.9), lipS, 4, 4);
  }

  /**
   * True if a jumped ravine (far wall starting at probe `climb`) is really a step down with a
   * ditch at its foot: the far side stays below the near rim by more than fallMinDrop and by more
   * than the far wall is tall. The water then falls onto the far side instead of into the ravine.
   * (A ravine on a downhill run has a far rim a little lower than the near one, but its far wall
   * is taller than that: the water pours into it.)
   */
  private farSideLower(climb: number, refY: number): boolean {
    if (this.dropOffUnderFlight(climb, refY) < 0) return false;
    const g = this.probeG;
    let top = -Infinity;
    for (let k = climb; k < this.probeCount; k++) if (g[k] > top) top = g[k];
    let floor = Infinity;
    for (let k = 0; k <= climb; k++) if (g[k] < floor) floor = g[k];
    // (the near rim without a kicker on it: no higher than the water before the take-off)
    const step = Math.min(this.dropTop, refY) - top;
    return step > this.options.fallMinDrop && step > top - floor;
  }

  /**
   * Waterfall points from the flight polyline pathX/pathY/pathZ (lip excluded, landing last) into
   * rawX/Y/Z: evenly spaced along its 3D length, at most fallStep apart.
   */
  private resampleFlight(): void {
    const px = this.pathX;
    const py = this.pathY;
    const pz = this.pathZ;
    const m = px.length;
    let total = 0;
    for (let i = 1; i < m; i++) total += this.pathLen3(i);
    const pieces = clamp(Math.ceil(total / this.options.fallStep - 1e-9), 1, MAX_FILL_SAMPLES);
    this.clearRaw();
    let seg = 1;
    let segStart = 0;
    let segLen = this.pathLen3(1);
    for (let j = 1; j < pieces; j++) {
      const target = (total * j) / pieces;
      while (seg < m - 1 && segStart + segLen < target) {
        segStart += segLen;
        seg++;
        segLen = this.pathLen3(seg);
      }
      const f = segLen > 1e-9 ? clamp01((target - segStart) / segLen) : 1;
      const x = lerp(px[seg - 1], px[seg], f);
      this.pushRaw(x, lerp(py[seg - 1], py[seg], f), lerp(pz[seg - 1], pz[seg], f));
      this.rawU[j - 1] = j / pieces;
    }
    this.pushRaw(px[m - 1], py[m - 1], pz[m - 1]);
    this.rawU[pieces - 1] = 1;
  }

  /** 3D length of flight path segment i - 1 → i. */
  private pathLen3(i: number): number {
    const px = this.pathX;
    const py = this.pathY;
    const pz = this.pathZ;
    return Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1], pz[i] - pz[i - 1]);
  }

  private clearRaw(): void {
    this.rawX.length = 0;
    this.rawY.length = 0;
    this.rawZ.length = 0;
    this.rawU.length = 0;
  }

  private pushRaw(x: number, y: number, z: number): void {
    this.rawX.push(x);
    this.rawY.push(y);
    this.rawZ.push(z);
    this.rawU.push(0);
  }

  /** Sample the water level (ground + landOffset, at least the sea) along pathX/pathZ. */
  private probeFlight(terrain: Terrain): void {
    const o = this.options;
    const px = this.pathX;
    const pz = this.pathZ;
    const sea = this.seaLevel + o.oceanOffset;
    let k = 0;
    this.probeArc[0] = 0;
    this.probeG[0] = Math.max(terrain.heightAt(px[0], pz[0]) + o.landOffset, sea);
    let arc = 0;
    for (let i = 1; i < px.length; i++) {
      const len = Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
      if (len < 1e-9) continue;
      const steps = Math.ceil(len / AIR_PROBE_STEP);
      if (k + steps + 1 > this.probeArc.length) this.growProbes(k + steps + 1);
      for (let j = 1; j <= steps; j++) {
        const f = j / steps;
        const h = terrain.heightAt(lerp(px[i - 1], px[i], f), lerp(pz[i - 1], pz[i], f));
        k++;
        this.probeArc[k] = arc + len * f;
        this.probeG[k] = Math.max(h + o.landOffset, sea);
      }
      arc += len;
    }
    this.probeCount = k + 1;
  }

  private growProbes(min: number): void {
    const size = Math.max(min, this.probeArc.length * 2);
    const arc = new Float64Array(size);
    const g = new Float64Array(size);
    arc.set(this.probeArc);
    g.set(this.probeG);
    this.probeArc = arc;
    this.probeG = g;
  }

  /** Lowest water level within approachLookback metres of trail before (and at) the lip. */
  private approachLevel(lip: TrailSample): number {
    const fromS = lip.s - this.options.approachLookback;
    let low = lip.y;
    for (let i = this.list.length - 1; i >= 0 && this.list[i].s >= fromS; i--) {
      if (this.list[i].y < low) low = this.list[i].y;
      if (this.list[i].gapBefore) break;
    }
    return low;
  }

  /**
   * Arc length along the flight path (pathX/pathZ, from the lip) of the top of the drop-off under
   * the flight, or -1 if the ground under it (probes 0…last) never falls away like a cliff: by more
   * than fallMinDrop in one stretch steeper than steepFallSlope (the rule grounded slides use too),
   * to more than fallMinDrop below `refY`. A hop down a slope, e.g. sideways down a valley wall, or
   * off a kicker back onto the floor is not a waterfall; the water follows the ground. 0 when the
   * drop-off starts within one sample spacing of the lip; its foot is left in `dropFoot` and the
   * water level at its top in `dropTop`.
   */
  private dropOffUnderFlight(last: number, refY: number): number {
    const o = this.options;
    const arc = this.probeArc;
    const g = this.probeG;
    let runStart = 0;
    let runTop = 0;
    let runDrop = 0;
    let bestStart = -1;
    let bestDrop = o.fallMinDrop;
    let foot = 0;
    let top = 0;
    for (let k = 1; k <= last; k++) {
      const fallBy = g[k - 1] - g[k];
      if (fallBy <= o.steepFallSlope * (arc[k] - arc[k - 1])) {
        runDrop = 0;
        continue;
      }
      if (runDrop === 0) {
        runStart = arc[k - 1];
        runTop = g[k - 1];
      }
      runDrop += fallBy;
      if (runDrop > bestDrop && refY - g[k] > o.fallMinDrop) {
        bestDrop = runDrop;
        bestStart = runStart;
        foot = arc[k];
        top = runTop;
      }
    }
    this.dropFoot = foot;
    this.dropTop = top;
    if (bestStart < 0) return -1;
    // Within one sample spacing of the lip the sheet simply starts at the lip.
    return bestStart > o.spacing ? bestStart : 0;
  }

  /**
   * Probe index where the ground under the flight first climbs back up like a wall (by more than
   * fallMinDrop, steeper than steepFallSlope): the far side of a jumped ravine, which water
   * following the ground could not climb. -1 if there is none.
   */
  private steepClimbUnderFlight(): number {
    const o = this.options;
    const arc = this.probeArc;
    const g = this.probeG;
    let start = 0;
    let rise = 0;
    for (let k = 1; k < this.probeCount; k++) {
      const up = g[k] - g[k - 1];
      if (up <= o.steepFallSlope * (arc[k] - arc[k - 1])) {
        rise = 0;
        continue;
      }
      if (rise === 0) start = k - 1;
      rise += up;
      if (rise > o.fallMinDrop) return start;
    }
    return -1;
  }

  /**
   * The near side of a jumped ravine whose far wall starts at probe `climb`: the water follows the
   * ground to the near edge, pours down the near wall onto the floor and pools briefly, stopping
   * short of the far wall. The caller then restarts the river at the landing.
   */
  private pourIntoGap(climb: number, refY: number, terrain: Terrain): void {
    const o = this.options;
    const edge = this.dropOffUnderFlight(climb, refY);
    const foot = edge >= 0 ? this.dropFoot : 0;
    // Crossing a wall at an angle, a cross-section's bank reaches it before its centre does: end
    // the water where neither bank touches the far wall, and land the pour clear of the near one.
    let poolEnd = this.probeArc[climb] - o.gapWallClearance;
    while (poolEnd > foot && !this.banksClear(poolEnd, terrain)) poolEnd -= AIR_PROBE_STEP;
    if (edge < 0) {
      if (poolEnd > MIN_POOL) this.appendSubPath(0, poolEnd, terrain);
      return;
    }
    let baseArc = foot + o.pourReach;
    while (baseArc < poolEnd && !this.banksClear(baseArc, terrain)) baseArc += AIR_PROBE_STEP;
    baseArc = Math.min(baseArc, Math.max(foot, poolEnd));
    if (edge > 0) this.appendSubPath(0, edge, terrain);
    this.subPath(edge, baseArc);
    const m = this.tailX.length - 1;
    const bx = this.tailX[m];
    const bz = this.tailZ[m];
    const bOcean = terrain.isOcean(bx, bz);
    const bY = this.surfaceY(terrain, bx, bz, bOcean);
    // (the pour may move its base out from the near wall, but not into the far one)
    let poolFrom = baseArc;
    if (this.list[this.list.length - 1].y - bY > o.fallMinDrop) {
      poolFrom += this.appendFall(this.tailX, this.tailZ, bY, bOcean, Math.max(0, poolEnd - baseArc));
    } else {
      this.appendAlongPath(this.tailX, this.tailZ, terrain, bOcean);
    }
    if (poolEnd > poolFrom + MIN_POOL) {
      this.appendSubPath(poolFrom, Math.min(poolEnd, poolFrom + o.plungeLength), terrain);
    }
  }

  /**
   * True if a cross-section at arc `a` of the flight path would lie on ground within BANK_STEP
   * metres of its centre's height across its whole (generously estimated) width.
   */
  private banksClear(a: number, terrain: Terrain): boolean {
    const px = this.pathX;
    const pz = this.pathZ;
    let arc = 0;
    let i = 1;
    let len = Math.hypot(px[1] - px[0], pz[1] - pz[0]);
    while (i < px.length - 1 && arc + len < a) {
      arc += len;
      i++;
      len = Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    }
    if (len < 1e-9) return true;
    const f = clamp01((a - arc) / len);
    const x = lerp(px[i - 1], px[i], f);
    const z = lerp(pz[i - 1], pz[i], f);
    const g = terrain.heightAt(x, z);
    const hw = 0.6 * this.landWidth;
    const rx = (-(pz[i] - pz[i - 1]) / len) * hw;
    const rz = ((px[i] - px[i - 1]) / len) * hw;
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      if (Math.abs(terrain.heightAt(x + rx * k * 0.5, z + rz * k * 0.5) - g) > BANK_STEP) return false;
    }
    return true;
  }

  /** Ground samples along pathX/pathZ between arc lengths a0 (the newest sample) and a1. */
  private appendSubPath(a0: number, a1: number, terrain: Terrain): void {
    this.subPath(a0, a1);
    const m = this.tailX.length - 1;
    this.appendAlongPath(this.tailX, this.tailZ, terrain, terrain.isOcean(this.tailX[m], this.tailZ[m]));
  }

  /** Copy the part of pathX/pathZ between arc lengths a0 ≤ a1 into tailX/tailZ. */
  private subPath(a0: number, a1: number): void {
    const px = this.pathX;
    const pz = this.pathZ;
    const tx = this.tailX;
    const tz = this.tailZ;
    tx.length = 0;
    tz.length = 0;
    let arc = 0;
    for (let i = 1; i < px.length; i++) {
      const len = Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
      const next = arc + len;
      if (tx.length === 0 && next >= a0) {
        const f = len > 1e-9 ? clamp01((a0 - arc) / len) : 0;
        tx.push(lerp(px[i - 1], px[i], f));
        tz.push(lerp(pz[i - 1], pz[i], f));
      }
      if (tx.length > 0) {
        if (next >= a1) {
          const f = len > 1e-9 ? clamp01((a1 - arc) / len) : 1;
          tx.push(lerp(px[i - 1], px[i], f));
          tz.push(lerp(pz[i - 1], pz[i], f));
          return;
        }
        tx.push(px[i]);
        tz.push(pz[i]);
      }
      arc = next;
    }
    if (tx.length === 0) {
      tx.push(px[px.length - 1]);
      tz.push(pz[pz.length - 1]);
    }
  }

  /**
   * Append ground samples along the polyline px/pz (first point = newest sample), evenly spaced at
   * about `spacing`, ending exactly at the last path point. The final point uses `lastIsOcean` and
   * `lastY` (water level; NaN = from the terrain); intermediate points ask the terrain.
   */
  private appendAlongPath(
    px: readonly number[],
    pz: readonly number[],
    terrain: Terrain,
    lastIsOcean: boolean,
    lastY = NaN,
  ): void {
    const m = px.length;
    let total = 0;
    for (let i = 1; i < m; i++) total += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    if (total < 1e-6) return;
    const pieces = clamp(Math.round(total / this.options.spacing), 1, MAX_FILL_SAMPLES);
    let seg = 1;
    let segStart = 0;
    let segLen = Math.hypot(px[1] - px[0], pz[1] - pz[0]);
    for (let j = 1; j <= pieces; j++) {
      let x: number;
      let z: number;
      if (j === pieces) {
        x = px[m - 1];
        z = pz[m - 1];
      } else {
        const target = (total * j) / pieces;
        while (seg < m - 1 && segStart + segLen < target) {
          segStart += segLen;
          seg++;
          segLen = Math.hypot(px[seg] - px[seg - 1], pz[seg] - pz[seg - 1]);
        }
        const f = segLen > 1e-9 ? clamp01((target - segStart) / segLen) : 1;
        x = lerp(px[seg - 1], px[seg], f);
        z = lerp(pz[seg - 1], pz[seg], f);
      }
      const ocean = j === pieces ? lastIsOcean : terrain.isOcean(x, z);
      this.appendGround(terrain, x, z, ocean, j === pieces ? lastY : NaN);
    }
  }

  /**
   * One ground step from the newest sample to (x, z), subdividing steep or tall steps; `at` is the
   * water level there (NaN = from the terrain).
   */
  private appendGround(terrain: Terrain, x: number, z: number, ocean: boolean, at = NaN): void {
    const o = this.options;
    const prev = this.list[this.list.length - 1];
    const y = Number.isFinite(at) ? at : this.surfaceY(terrain, x, z, ocean);
    const horiz = Math.hypot(x - prev.x, z - prev.z);
    const drop = prev.y - y;
    if (drop > o.fallMinDrop && drop > o.steepFallSlope * horiz && prev.kind !== 'ocean') {
      // A cliff the iceberg slid down without leaving the ground: still a waterfall.
      const fx = this.stepX;
      const fz = this.stepZ;
      fx[0] = prev.x;
      fx[1] = x;
      fz[0] = prev.z;
      fz[1] = z;
      this.appendFall(fx, fz, y, ocean);
      return;
    }
    const pieces = Math.min(16, Math.max(1, Math.ceil(Math.abs(drop) / o.maxVerticalStep)));
    const x0 = prev.x;
    const z0 = prev.z;
    for (let j = 1; j < pieces; j++) {
      const f = j / pieces;
      const sx = lerp(x0, x, f);
      const sz = lerp(z0, z, f);
      const so = terrain.isOcean(sx, sz);
      this.pushSample(sx, this.surfaceY(terrain, sx, sz, so), sz, so ? 'ocean' : 'flow', 0);
    }
    this.pushSample(x, y, z, ocean ? 'ocean' : 'flow', 0);
  }

  /**
   * Waterfall without a recorded flight (a grounded slide over a cliff, a pour into a ravine) from
   * the newest sample (the lip, = px[0]/pz[0]) to the last path point (the base), following the
   * horizontal route with y = lip.y − drop·u² (leaves the lip horizontally, then bends down). Steps
   * are ≤ fallStep both horizontally and vertically. Returns how far the base moved out (emitFall).
   */
  private appendFall(
    px: readonly number[],
    pz: readonly number[],
    baseY: number,
    baseOcean: boolean,
    basePushMax = FALL_BASE_PUSH * this.options.spacing,
  ): number {
    const o = this.options;
    const lip = this.list[this.list.length - 1];
    const m = px.length;
    let total = 0;
    for (let i = 1; i < m; i++) total += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    const drop = lip.y - baseY;

    // Step u until it passes 1, then rescale so the last step lands exactly on the base: every
    // step stays ≤ fallStep and there is no sliver segment before the base.
    const us = this.fallU;
    us.length = 0;
    let u = 0;
    while (u < 1 && us.length < MAX_FILL_SAMPLES) {
      const duH = total > 1e-6 ? o.fallStep / total : 1;
      const duV = Math.sqrt(u * u + o.fallStep / drop) - u;
      u += Math.min(duH, duV);
      us.push(u);
    }
    const scale = 1 / Math.max(1, us[us.length - 1]);

    this.clearRaw();
    let seg = 1;
    let segStart = 0;
    let segLen = m > 1 ? Math.hypot(px[1] - px[0], pz[1] - pz[0]) : 0;
    for (let k = 0; k < us.length - 1; k++) {
      u = us[k] * scale;
      const target = u * total;
      while (seg < m - 1 && segStart + segLen < target) {
        segStart += segLen;
        seg++;
        segLen = Math.hypot(px[seg] - px[seg - 1], pz[seg] - pz[seg - 1]);
      }
      const f = segLen > 1e-9 ? clamp01((target - segStart) / segLen) : 1;
      const x = m > 1 ? lerp(px[seg - 1], px[seg], f) : lip.x;
      const z = m > 1 ? lerp(pz[seg - 1], pz[seg], f) : lip.z;
      this.pushRaw(x, lip.y - drop * u * u, z);
      this.rawU[k] = u;
    }
    this.pushRaw(px[m - 1], baseY, pz[m - 1]);
    this.rawU[this.rawU.length - 1] = 1;
    return this.emitFall(baseOcean, basePushMax);
  }

  /**
   * Append the waterfall rawX/Y/Z (after the newest sample, the lip; the last point is the base)
   * as 'fall' samples and the base, kept clear of the ground (fallClearance; see fallNeed). A
   * cross-section that would need more than fallMaxLift has a face right beside it: it is moved
   * out along the flight (never back past the previous sample) as far as fixes that, if anything
   * does. Its centreline is then lifted as far as it still needs; the geometry lifts bank vertices.
   * The base may move out too, by at most basePushMax: returns how far it did (m).
   */
  private emitFall(baseOcean: boolean, basePushMax = FALL_BASE_PUSH * this.options.spacing): number {
    const o = this.options;
    const rx = this.rawX;
    const ry = this.rawY;
    const rz = this.rawZ;
    const m = rx.length;
    const lip = this.list[this.list.length - 1];
    const lipY = lip.y;
    const landFlow = lip.flowSpeed;
    let bx = rx[m - 1];
    let bz = rz[m - 1];
    // A straight drop has no horizontal direction of its own: fall back on lip → base, then the lip's.
    let gdx = bx - lip.x;
    let gdz = bz - lip.z;
    const gl = Math.hypot(gdx, gdz);
    gdx = gl > 0.05 ? gdx / gl : lip.dirX;
    gdz = gl > 0.05 ? gdz / gl : lip.dirZ;
    // The base may move out (if the sheet has to) over ground about as high as where it landed;
    // the sheet may reach just short of that.
    const by0 = ry[m - 1];
    let reach = 0;
    const t = this.curTerrain;
    while (t && reach + FALL_PUSH_STEP <= basePushMax + 1e-9) {
      const qx = bx + gdx * (reach + FALL_PUSH_STEP);
      const qz = bz + gdz * (reach + FALL_PUSH_STEP);
      const level = baseOcean ? t.isOcean(qx, qz) : Math.abs(this.surfaceY(t, qx, qz, false) - by0) <= 0.3;
      if (!level) break;
      reach += FALL_PUSH_STEP;
    }
    const fx = bx + gdx * reach;
    const fz = bz + gdz * reach;
    const hw = 0.5 * this.landWidth * o.fallWidthFactor + FALL_BANK_MARGIN;
    let px = lip.x;
    let py = lip.y;
    let pz = lip.z;
    for (let j = 0; j < m - 1; j++) {
      const x0 = rx[j];
      const z0 = rz[j];
      let y = ry[j];
      // local horizontal direction of the route
      let dx = rx[j + 1] - (j > 0 ? rx[j - 1] : lip.x);
      let dz = rz[j + 1] - (j > 0 ? rz[j - 1] : lip.z);
      const dl = Math.hypot(dx, dz);
      dx = dl > 0.02 ? dx / dl : gdx;
      dz = dl > 0.02 ? dz / dl : gdz;
      // Water still level with the lip (an angled lip's near bank over the edge) clears the ground
      // like the river above it; the full clearance applies once it falls, until the plunge pool.
      const cLip = o.landOffset + FALL_CLEAR_PER_DROP * Math.max(0, lipY - py);
      const cBase = (o.fallClearance * (m - 1 - j)) / FALL_CLEAR_RAMP;
      const c = Math.min(o.fallClearance, cLip, cBase);
      const pushMin = Math.max(0, (px - x0) * dx + (pz - z0) * dz);
      const pushMax = Math.min(o.fallMaxPush, Math.max(0, (fx - x0) * dx + (fz - z0) * dz - FALL_PUSH_STEP));
      let push = Math.min(pushMin, pushMax);
      let face = this.fallNeed(x0 + dx * push, y, z0 + dz * push, dx, dz, hw, c, px, py, pz);
      let centre = this.needCentre;
      // A face right behind the sheet: move it out only as far as that brings it within a small
      // lift (if anything does; ground beside the sheet does not get lower by moving along).
      for (let p = push + FALL_PUSH_STEP; face > o.fallMaxLift && p <= pushMax + 1e-9; p += FALL_PUSH_STEP) {
        const nf = this.fallNeed(x0 + dx * p, y, z0 + dz * p, dx, dz, hw, c, px, py, pz);
        if (nf <= o.fallMaxLift) {
          face = nf;
          centre = this.needCentre;
          push = p;
        }
      }
      // The centreline is lifted here; the geometry lifts any bank vertex still too close.
      if (centre > 0) y += centre;
      // A descending sheet only lifted a little above the previous sample (a bank over higher
      // ground beside the lip) stays level instead; the geometry lifts that bank's vertices.
      if (ry[j] <= py && y > py && y - py < FALL_MAX_RISE) y = py;
      const x = x0 + dx * push;
      const z = z0 + dz * push;
      this.pushFallSteps(lip, x, y, z, j > 0 ? this.rawU[j - 1] : 0, this.rawU[j], true);
      px = x;
      py = y;
      pz = z;
    }
    // The base stays where the iceberg landed unless the sheet had to move out past it.
    let by = by0;
    const basePush = clamp((px - bx) * gdx + (pz - bz) * gdz + FALL_PUSH_STEP, 0, reach);
    if (basePush > 0 && t) {
      bx += gdx * basePush;
      bz += gdz * basePush;
      if (!baseOcean) by = this.surfaceY(t, bx, bz, false);
    }
    this.pushFallSteps(lip, bx, by, bz, m > 1 ? this.rawU[m - 2] : 0, 1, false);
    const base = this.pushSample(bx, by, bz, baseOcean ? 'ocean' : 'flow', 1);
    base.flowSpeed = Math.max(base.flowSpeed, landFlow);
    this.setBoost(1, base.s, o.plungeLength, 4);
    // the plunge pool covers the base itself
    base.turbulence = 1;
    return basePush;
  }

  /**
   * Append 'fall' samples from the newest sample to (x, y, z), which lies u of the way down the
   * pour (u0 at the newest sample): straight-line samples wherever shaping left a step longer than
   * FALL_SPLIT × fallStep, then the point itself if `end`. Steps under 5 cm are dropped.
   */
  private pushFallSteps(
    lip: TrailSample,
    x: number,
    y: number,
    z: number,
    u0: number,
    u: number,
    end: boolean,
  ): void {
    const o = this.options;
    const prev = this.list[this.list.length - 1];
    const len = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
    if (len < 0.05) return;
    const k = len > FALL_SPLIT * o.fallStep ? Math.min(MAX_FILL_SAMPLES, Math.ceil(len / o.fallStep)) : 1;
    const x0 = prev.x;
    const y0 = prev.y;
    const z0 = prev.z;
    for (let i = 1; i <= (end ? k : k - 1); i++) {
      const f = i / k;
      const sy = lerp(y0, y, f);
      const s = this.pushSample(lerp(x0, x, f), sy, lerp(z0, z, f), 'fall', 1);
      s.t = Math.max(lip.t, this.curTime - (1 - lerp(u0, u, f)) * o.fallPourTime);
      const v = Math.sqrt(2 * GRAVITY * Math.max(0, lip.y - sy));
      s.flowSpeed = clamp(Math.max(lip.flowSpeed, v), 0, o.maxFallFlowSpeed);
    }
  }

  /**
   * Clearance of a flat waterfall cross-section at (x, y, z), heading (dx, dz), half-width hw: the
   * lift its centreline needs to clear the ground by c under it, fallStandoff up- and downstream
   * and halfway back to the previous sample (px, py, pz) goes to needCentre (≤ 0: clear). Returns
   * the lift a face right behind it would need: the most any column (both banks and beyond) needs
   * for the ground fallStandoff behind it where its own ground is no problem (a bank over higher
   * ground beside the sheet is left to the geometry's vertex lift).
   */
  private fallNeed(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    hw: number,
    c: number,
    px: number,
    py: number,
    pz: number,
  ): number {
    const t = this.curTerrain;
    if (!t) return 0;
    const sea = this.seaLevel;
    const off = this.options.fallStandoff;
    const ox = dx * off;
    const oz = dz * off;
    const mx = 0.5 * (x + px);
    const mz = 0.5 * (z + pz);
    const my = 0.5 * (y + py);
    const lift = this.options.fallMaxLift;
    let face = -Infinity;
    for (let k = -FALL_COLS; k <= FALL_COLS; k++) {
      const l = (hw * k) / FALL_COLS;
      const lx = -dz * l;
      const lz = dx * l;
      const cx = x + lx;
      const cz = z + lz;
      const own = Math.max(t.heightAt(cx, cz), sea) + c - y;
      const back = Math.max(t.heightAt(cx - ox, cz - oz), sea) + c - y;
      if (own <= lift && back > face) face = back;
      if (k !== 0) continue;
      const fwd = Math.max(t.heightAt(cx + ox, cz + oz), sea) + c - y;
      // lifting the sample by L lifts the point halfway back by L/2
      const mid = 2 * (Math.max(t.heightAt(mx, mz), sea) + c - my);
      this.needCentre = Math.max(own, back, fwd, mid);
    }
    return face;
  }

  private setBoost(level: number, fromS: number, length: number, fade: number): void {
    if (fromS + length < this.boostEndS && level <= this.boostLevel) return;
    this.boostLevel = level;
    this.boostEndS = fromS + length;
    this.boostFade = fade;
  }

  private boostAt(s: number): number {
    if (s <= this.boostEndS) return this.boostLevel;
    return this.boostLevel * Math.max(0, 1 - (s - this.boostEndS) / this.boostFade);
  }

  private takeSample(): TrailSample {
    const s = this.pool.pop();
    if (s) return s;
    return {
      x: 0,
      y: 0,
      z: 0,
      dirX: 0,
      dirZ: 1,
      s: 0,
      width: 0,
      flowSpeed: 0,
      turbulence: 0,
      t: 0,
      kind: 'flow',
      gapBefore: false,
      rev: 0,
    };
  }

  /** Append one sample, deriving direction, s, width, flow speed and turbulence. */
  private pushSample(x: number, y: number, z: number, kind: RiverSampleKind, extraTurb: number): TrailSample {
    const o = this.options;
    const n = this.list.length;
    const prev = n > 0 ? this.list[n - 1] : null;
    const sm = this.takeSample();

    let dirX: number;
    let dirZ: number;
    let horiz = 0;
    let segLen = 0;
    if (prev) {
      const dx = x - prev.x;
      const dz = z - prev.z;
      horiz = Math.hypot(dx, dz);
      segLen = Math.hypot(horiz, y - prev.y);
      if (horiz > 0.05) {
        dirX = dx / horiz;
        dirZ = dz / horiz;
      } else {
        dirX = prev.dirX;
        dirZ = prev.dirZ;
      }
    } else {
      const d = headingToDir(this.curHeading);
      dirX = d.x;
      dirZ = d.z;
    }
    const s = prev ? prev.s + Math.max(segLen, 1e-4) : 0;

    if (kind === 'ocean' && this._coastS === null) this._coastS = s;

    // width
    const speedT = smoothstep(6, 28, this.curSpeed);
    const noise = valueNoise2(s * o.widthNoiseFreq, 0.37, o.seed);
    const target = o.widthFactor * this.curRadius * (0.96 + 0.16 * speedT) * (1 + o.widthNoise * noise);
    // the plume fans out from the last land width, so land width is frozen at sea
    if (this.landWidth <= 0) this.landWidth = target;
    else if (kind !== 'ocean') this.landWidth = lerp(this.landWidth, target, 0.35);
    let width = this.landWidth;
    if (kind === 'fall') width *= o.fallWidthFactor;
    else if (kind === 'ocean' && this._coastS !== null) {
      const k = smoothstep(0, o.oceanSpreadDistance, s - this._coastS);
      width *= 1 + (o.oceanWidthGrowth - 1) * k;
    }

    // flow speed
    let flow: number;
    if (kind === 'ocean') {
      const tgt = Math.max(1.5, 0.35 * this.curSpeed);
      flow = prev ? lerp(prev.flowSpeed, tgt, 0.2) : tgt;
    } else {
      const slope = horiz > 0.05 && prev ? (prev.y - y) / horiz : 0;
      const bonus = clamp(slope * o.slopeFlowBonus, 0, o.maxSlopeBonus);
      const tgt = Math.max(o.minFlowSpeed, o.flowSpeedFactor * this.curSpeed) + bonus;
      flow = prev && prev.kind !== 'fall' ? lerp(prev.flowSpeed, tgt, 0.4) : tgt;
    }

    // turbulence: bends (heading change per metre), boosts (landings, plunge pools), falls
    let turb = kind === 'ocean' ? o.baseTurbulence * 0.5 : o.baseTurbulence;
    if (prev && n > 1 && horiz > 0.05) {
      const cross = prev.dirX * dirZ - prev.dirZ * dirX;
      const dot = prev.dirX * dirX + prev.dirZ * dirZ;
      const kappa = Math.abs(Math.atan2(cross, dot)) / horiz;
      turb = Math.max(turb, 0.85 * smoothstep(o.bendTurbulenceStart, o.bendTurbulenceFull, kappa));
    }
    turb = Math.min(1, Math.max(turb, this.boostAt(s), extraTurb));

    sm.x = x;
    sm.y = y;
    sm.z = z;
    sm.dirX = dirX;
    sm.dirZ = dirZ;
    sm.s = s;
    sm.width = width;
    sm.flowSpeed = flow;
    sm.turbulence = turb;
    sm.t = this.curTime;
    sm.kind = kind;
    sm.gapBefore = this.nextGap && n > 0;
    sm.bank = kind === 'flow' ? this.curBank : null;
    this.nextGap = false;
    if (sm.gapBefore) this.gapIdx.push(n);
    sm.rev = ++this._version;
    this.list.push(sm);
    if (n === 1) this.pickCellSize();
    if (n > 0) this.hashSegment(n);
    return sm;
  }

  // -------------------------------------------------------------------------------------------
  // Decimation
  // -------------------------------------------------------------------------------------------

  /**
   * Merge the oldest low-curvature stretches until the trail is back under budget. Removal is a
   * single in-place compaction per relaxation level; fall samples and kind transitions are kept.
   */
  private decimate(): void {
    const o = this.options;
    const list = this.list;
    const target = Math.floor(o.maxSamples * o.decimateTo);
    let toRemove = list.length - target;
    if (toRemove <= 0) return;
    const angles = [0.06, 0.15, 0.35, 0.8];
    const dys = [0.25, 0.6, 1.5, 3];
    const levels = Math.min(angles.length, o.mergeMaxLength.length);
    let removed = 0;
    // Extra last pass ignores shape (still no falls, no kind transitions, bounded segment length)
    // so the cap holds even for a trail that zig-zags everywhere; otherwise every append would
    // re-run decimation and force full renderer rebuilds.
    for (let lvl = 0; lvl <= levels && toRemove > 0; lvl++) {
      const forced = lvl === levels;
      if (forced && list.length <= o.maxSamples) break;
      const maxLen = o.mergeMaxLength[forced ? levels - 1 : lvl];
      const maxAng = forced ? Math.PI : angles[lvl];
      const maxDy = forced ? Infinity : dys[lvl];
      const maxDw = forced ? Infinity : 0.25;
      const n = list.length;
      const protect = Math.min(n, Math.max(2, Math.min(o.protectTail, Math.floor(o.maxSamples / 4))));
      const stop = n - protect;
      let write = 1;
      let prevKept = list[0];
      for (let read = 1; read < n; read++) {
        const cur = list[read];
        if (toRemove > 0 && read < stop && read + 1 < n) {
          const next = list[read + 1];
          if (this.canMerge(prevKept, cur, next, maxLen, maxAng, maxDy, maxDw)) {
            next.turbulence = Math.max(next.turbulence, cur.turbulence);
            this.pool.push(cur);
            toRemove--;
            removed++;
            continue;
          }
        }
        list[write++] = cur;
        prevKept = cur;
      }
      list.length = write;
    }
    if (removed === 0) return;
    this.gapIdx.length = 0;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (b.gapBefore) this.gapIdx.push(i);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const h = Math.hypot(dx, dz);
      if (h > 0.05) {
        b.dirX = dx / h;
        b.dirZ = dz / h;
      }
    }
    this._decimations++;
    this._structureVersion++;
    const rev = ++this._version;
    for (const s of list) s.rev = rev;
    this.rebuildHash();
  }

  private canMerge(
    a: TrailSample,
    cur: TrailSample,
    b: TrailSample,
    maxLen: number,
    maxAng: number,
    maxDy: number,
    maxDw: number,
  ): boolean {
    if (cur.kind === 'fall' || a.kind !== cur.kind || b.kind !== cur.kind) return false;
    // removing either end of a gap would move where the river pours in or restarts
    if (cur.gapBefore || b.gapBefore) return false;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len = Math.hypot(abx, abz);
    if (len > maxLen || len < 1e-6) return false;
    const ax = cur.x - a.x;
    const az = cur.z - a.z;
    const bx = b.x - cur.x;
    const bz = b.z - cur.z;
    const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    if (ang > maxAng) return false;
    const t = clamp01((ax * abx + az * abz) / (len * len));
    if (Math.abs(cur.y - lerp(a.y, b.y, t)) > maxDy) return false;
    return Math.abs(cur.width - lerp(a.width, b.width, t)) <= maxDw * cur.width;
  }

  // -------------------------------------------------------------------------------------------
  // Spatial hash, flowAt, disturb
  // -------------------------------------------------------------------------------------------

  /**
   * Insert segment (j-1 → j) into every cell its width-expanded bounding box touches. A segment
   * across a jumped gap holds no water and is never inserted.
   */
  private hashSegment(j: number): void {
    const a = this.list[j - 1];
    const b = this.list[j];
    if (b.gapBefore) return;
    const hw = 0.5 * Math.max(a.width, b.width) + 0.01;
    const inv = this.cellInv;
    const cx0 = Math.floor((Math.min(a.x, b.x) - hw) * inv);
    const cx1 = Math.floor((Math.max(a.x, b.x) + hw) * inv);
    const cz0 = Math.floor((Math.min(a.z, b.z) - hw) * inv);
    const cz1 = Math.floor((Math.max(a.z, b.z) + hw) * inv);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) this.grid.add(cellKey(cx, cz), j);
    }
  }

  /** Only while the hash is empty or about to be rebuilt. */
  private pickCellSize(): void {
    this.cellInv = 1 / Math.max(this.options.hashCellSize, HASH_CELL_PER_WIDTH * this.landWidth);
  }

  private rebuildHash(): void {
    this.grid.clear();
    this.pickCellSize();
    for (let j = 1; j < this.list.length; j++) this.hashSegment(j);
  }

  /**
   * Flow at a world point, or null outside the water. The returned object is reused by the next
   * call — copy the fields if you need to keep them. Non-waterfall water wins over a waterfall
   * sheet overhead; compare a body's y with `surfaceY` to tell whether it is actually in it. A
   * waterfall sheet arcing more than FALL_WET_REACH above the ground is no water at all there: a
   * body lying under the arc is not in it (nor buoyed up to it).
   */
  flowAt(x: number, z: number): FlowQuery | null {
    const list = this.list;
    if (list.length < 2) return null;
    const inv = this.cellInv;
    const slot = this.grid.find(cellKey(Math.floor(x * inv), Math.floor(z * inv)));
    if (slot < 0) return null;
    const cell = this.grid.list(slot);
    const cellSize = this.grid.size(slot);
    const terrain = this.curTerrain;
    let best = -1;
    let bestScore = Infinity;
    let bestT = 0;
    let bestRatio = 0;
    for (let c = 0; c < cellSize; c++) {
      const j = cell[c];
      const a = list[j - 1];
      const b = list[j];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz;
      if (this.gapIdx.length > 0 && this.pastGapEnd(j, x, z)) continue;
      const t = l2 > 1e-9 ? clamp01(((x - a.x) * abx + (z - a.z) * abz) / l2) : 0;
      const ex = x - (a.x + abx * t);
      const ez = z - (a.z + abz * t);
      const hw = 0.5 * (a.width + (b.width - a.width) * t);
      const lat2 = ex * ex + ez * ez;
      if (lat2 >= hw * hw) continue;
      const fall = b.kind === 'fall' || a.kind === 'fall';
      if (fall && terrain && a.y + (b.y - a.y) * t - terrain.heightAt(x, z) > FALL_WET_REACH) continue;
      const ratio = Math.sqrt(lat2) / hw;
      const score = ratio + (fall ? 2 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = j;
        bestT = t;
        bestRatio = ratio;
      }
    }
    if (best < 0) return null;
    const a = list[best - 1];
    const b = list[best];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len = Math.hypot(abx, abz);
    const dx = len > 0.05 ? abx / len : b.dirX;
    const dz = len > 0.05 ? abz / len : b.dirZ;
    const strength = 1 - bestRatio * bestRatio;
    const flow = a.flowSpeed + (b.flowSpeed - a.flowSpeed) * bestT;
    const r = this.flowResult;
    r.vx = dx * flow * strength;
    r.vz = dz * flow * strength;
    r.surfaceY = a.y + (b.y - a.y) * bestT;
    r.strength = strength;
    return r;
  }

  /**
   * True if (x, z) lies beyond the straight end of the stretch of water that segment j belongs
   * to, at a jumped gap (as the geometry ends it). Without this the round end of a segment near
   * the gap would report water over the ravine. Only stretch ends within a river width of the
   * segment count, so a stretch that curls back on itself is not cut.
   */
  private pastGapEnd(j: number, x: number, z: number): boolean {
    const list = this.list;
    const a = list[j - 1];
    const b = list[j];
    const gaps = this.gapIdx;
    for (let k = 0; k < gaps.length; k++) {
      const g = gaps[k];
      if (g > j) {
        const e = list[g - 1];
        if (e.s - a.s <= e.width && (x - e.x) * e.dirX + (z - e.z) * e.dirZ > 0) return true;
      } else {
        const l = list[g];
        const f = g + 1 < list.length ? list[g + 1] : l;
        if (b.s - l.s <= l.width && (x - l.x) * f.dirX + (z - l.z) * f.dirZ < 0) return true;
      }
    }
    return false;
  }

  disturb(x: number, z: number, amount: number): void {
    const list = this.list;
    if (list.length < 2 || !(amount > 0)) return;
    // a grown or big-level iceberg lays a wider river; its splashes should cover it as well
    const r = Math.max(this.options.disturbRadius, 0.5 * this.landWidth);
    const inv = this.cellInv;
    if (this.marks.length < list.length) {
      this.marks = new Int32Array(Math.max(list.length, this.marks.length * 2));
    }
    const stamp = ++this.markStamp;
    const rev = this._version + 1;
    let changed = false;
    const cx0 = Math.floor((x - r) * inv);
    const cx1 = Math.floor((x + r) * inv);
    const cz0 = Math.floor((z - r) * inv);
    const cz1 = Math.floor((z + r) * inv);
    const grid = this.grid;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const slot = grid.find(cellKey(cx, cz));
        if (slot < 0) continue;
        const cell = grid.list(slot);
        const size = grid.size(slot);
        for (let c = 0; c < size; c++) {
          const j = cell[c];
          for (let i = j - 1; i <= j; i++) {
            if (this.marks[i] === stamp) continue;
            this.marks[i] = stamp;
            const sm = list[i];
            const d = Math.hypot(sm.x - x, sm.z - z);
            if (d >= r) continue;
            const next = Math.min(1, sm.turbulence + amount * (1 - d / r));
            if (next !== sm.turbulence) {
              sm.turbulence = next;
              sm.rev = rev;
              changed = true;
            }
          }
        }
      }
    }
    if (changed) this._version = rev;
  }

  reset(): void {
    for (const s of this.list) this.pool.push(s);
    this.list.length = 0;
    this.grid.clear();
    this.inAir = false;
    this.hasGround = false;
    this.airCount = 0;
    this.nextGap = false;
    this.gapIdx.length = 0;
    this.landWidth = 0;
    this.curBank = null;
    this.boostLevel = 0;
    this.boostEndS = -Infinity;
    this._coastS = null;
    this._structureVersion++;
    this._version++;
  }
}

/** True when `river` is the concrete RiverTrail (exposes structureVersion, rev and coastS). */
export function isRiverTrail(river: RiverTrailApi): river is RiverTrail {
  return river instanceof RiverTrail;
}
