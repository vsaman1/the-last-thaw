import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  BufferAttribute,
  NormalBlending,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three';
import type {
  FxEmitter,
  FxKind,
  GameEvent,
  GamePhase,
  HeightGrid,
  IcebergState,
  ObstacleKind,
  RiverTrailApi,
  Vec3,
} from '../core/types';
import { clamp, smoothstep } from '../core/math';
import { createRng } from '../core/rng';
import { useRuntime } from './RuntimeContext';

export const PARTICLE_CAPACITY = 3000;

/** Colour/behaviour variant for 'debris' (the FxEmitter contract has no colour option). */
export type ParticleVariant = 'rock' | 'wood' | 'leaves' | 'house' | 'metal' | 'concrete' | 'ice';

/** Geometry radius of the iceberg at visual scale 1 (see ICEBERG_VISUAL.baseRadius). */
const ICEBERG_BASE_RADIUS = 2.2;

/**
 * Snow thrown up by a big, fast iceberg (the avalanche look). Rates are snow clouds per second;
 * the spray backs off as the shared pool fills so it can never starve hit/break effects.
 */
export const AVALANCHE = {
  /** Visual scale (radius / 2.2) where the spray starts, and where it is at full strength. */
  scaleStart: 1.15,
  scaleFull: 1.7,
  /** Horizontal speed (m/s) where it starts and is full. */
  speedStart: 9,
  speedFull: 18,
  maxRate: 36,
  /** Pool fill fraction where the spray starts to back off, and where it stops. */
  throttleStart: 0.7,
  throttleEnd: 0.9,
} as const;

/** Snow clouds per second behind the iceberg (before the quality budget). */
export function avalancheRate(scale: number, speed: number, alive: number, capacity: number): number {
  const A = AVALANCHE;
  const big = smoothstep(A.scaleStart, A.scaleFull, scale);
  const fast = smoothstep(A.speedStart, A.speedFull, speed);
  const room = 1 - smoothstep(A.throttleStart, A.throttleEnd, alive / capacity);
  return A.maxRate * big * fast * room;
}

/** Ice shards in the burst when `amount` (fraction of a full iceberg) is chipped off. */
export function iceShardCount(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.round(clamp(10 + amount * 450, 10, 70));
}

/** Snow/ice particles swirling in when glacier ice adds `fraction` of the new mass. */
export function absorbPuffCount(fraction: number): number {
  return Math.round(clamp(14 + clamp(fraction, 0, 1) * 160, 14, 60));
}

export interface ParticleEmitOptions {
  /** Velocity to inherit / eject along (m/s); spray uses it as the ejection velocity. */
  dir?: Vec3;
  /** Scales count and burst speed (default 1). */
  intensity?: number;
  /** Exact particle count (overrides the intensity-based default). */
  count?: number;
  variant?: ParticleVariant;
}

const SHAPE_SOFT = 0;
const SHAPE_SHARD = 1;
const SHAPE_CHUNK = 2;
/** Flattened ellipse that reads as a fleck lying on the water (never rotated). */
const SHAPE_FLECK = 3;

const F_GROUND = 1;
const F_FLUTTER = 2;
const F_FADE_IN = 4;
/** Swirls into the live iceberg (moves with it, pulled toward its centre, gone once inside). */
const F_ATTRACT = 8;

const ATTRACT_PULL = 30;
const ATTRACT_SWIRL = 16;

const MAX_FALLS = 24;
const MIST_RANGE = 250;

/** Linear-space RGB triplets for a palette of sRGB hex colours. */
export function palette(...hex: string[]): Float32Array {
  const out = new Float32Array(hex.length * 3);
  const c = new Color();
  hex.forEach((h, i) => {
    c.set(h);
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  });
  return out;
}

const PAL_WATER = palette('#CFF6FF', '#5FF3FF', '#FFFFFF', '#9FE8FF');
const PAL_WHITE = palette('#FFFFFF', '#EAF9FF', '#D8F4FF');
const PAL_SPARKLE = palette('#5FF3FF', '#9FFFF8', '#7FFFF4');
const PAL_ROCK = palette('#4A4A55', '#6B5040', '#5C5C66', '#3E3E48');
const PAL_WOOD = palette('#6B5040', '#8A6A48', '#4E3A2C');
const PAL_LEAVES = palette('#5BD43A', '#C8F04A', '#3FAE2E');
const PAL_HOUSE = palette('#6B5040', '#4A4A55', '#E8DCC8', '#C8553D');
const PAL_DUST = palette('#B9AE9C', '#A49A8C');
const PAL_ICE = palette('#E8FFFF', '#9FF6FF', '#5CFCEE', '#BDF4FF');
const PAL_SNOW = palette('#FFFFFF', '#F2FAFF', '#E4F4FC');
const PAL_METAL = palette('#C8553D', '#3E6FB0', '#E8C547', '#8A9099', '#4A4A55');
const PAL_CONCRETE = palette('#B8B4AC', '#9C988F', '#D6D2C8', '#7E7A72');
const PAL_SPARK = palette('#FFC46B', '#FF8A3D', '#FFE6A8');

/** Height of the triangulated grid surface (same split as heightGrid.ts) without allocating. */
function gridHeight(g: HeightGrid, x: number, z: number): number {
  let gx = (x - g.originX) / g.cellSize;
  let gz = (z - g.originZ) / g.cellSize;
  const mx = g.cols - 1.000001;
  const mz = g.rows - 1.000001;
  gx = gx < 0 ? 0 : gx > mx ? mx : gx;
  gz = gz < 0 ? 0 : gz > mz ? mz : gz;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const h = g.heights;
  const row = iz * g.cols;
  const h00 = h[row + ix];
  const h11 = h[row + g.cols + ix + 1];
  if (fx >= fz) {
    const h10 = h[row + ix + 1];
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }
  const h01 = h[row + g.cols + ix];
  return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

/**
 * CPU-simulated particle pool rendered as one THREE.Points draw call. Slots are recycled in ring
 * order (preferring dead slots), so emitting never allocates and never exceeds the capacity.
 */
export class ParticlePool implements FxEmitter {
  readonly capacity: number;
  readonly positions: Float32Array;
  /** rgb + alpha per particle (linear, may exceed 1 for bloom). */
  readonly colors: Float32Array;
  /** size (m), shape, rotation angle. */
  readonly misc: Float32Array;

  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly spin: Float32Array;
  private readonly flags: Uint8Array;
  private readonly rng: () => number;
  private cursor = 0;
  private time = 0;
  alive = 0;
  grid: HeightGrid | null = null;
  seaLevel = -Infinity;
  /** The live iceberg: shards inherit its motion and absorb puffs swirl into it. */
  iceberg: IcebergState | null = null;
  /** Quality scale (0..1) for the optional effects: avalanche spray, shard and puff counts. */
  budget = 1;

  constructor(capacity: number, seed: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    this.misc = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.rng = createRng(seed >>> 0);
  }

  private r(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  /** Seeded uniform random in [0, 1) shared by everything that emits into this pool. */
  random(): number {
    return this.rng();
  }

  private slot(): number {
    const n = this.capacity;
    for (let k = 0; k < 16; k++) {
      const i = (this.cursor + k) % n;
      if (this.life[i] <= 0) {
        this.cursor = (i + 1) % n;
        return i;
      }
    }
    const i = this.cursor;
    this.cursor = (i + 1) % n;
    return i;
  }

  /** Spawn one particle; colour is picked from `pal` and multiplied by `bright`. */
  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    s0: number,
    s1: number,
    pal: Float32Array,
    bright: number,
    alpha: number,
    drag: number,
    grav: number,
    shape: number,
    spin: number,
    flags: number,
  ): void {
    const i = this.slot();
    if (this.life[i] <= 0) this.alive++;
    const i3 = i * 3;
    const i4 = i * 4;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = s0;
    this.size1[i] = s1;
    const c = Math.floor(this.rng() * (pal.length / 3)) * 3;
    const shade = bright * this.r(0.9, 1.08);
    this.colors[i4] = pal[c] * shade;
    this.colors[i4 + 1] = pal[c + 1] * shade;
    this.colors[i4 + 2] = pal[c + 2] * shade;
    this.colors[i4 + 3] = 0;
    this.alpha[i] = alpha;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.spin[i] = spin;
    this.flags[i] = flags;
    this.misc[i3] = 0;
    this.misc[i3 + 1] = shape;
    this.misc[i3 + 2] = shape === SHAPE_FLECK ? 0 : this.rng() * Math.PI * 2;
  }

  emit(kind: FxKind, pos: Vec3, opts?: ParticleEmitOptions): void {
    const intensity = Math.max(0.05, Math.min(5, opts?.intensity ?? 1));
    const dir = opts?.dir;
    const fixed = opts?.count;
    const dx = dir ? dir.x : 0;
    const dy = dir ? dir.y : 0;
    const dz = dir ? dir.z : 0;
    switch (kind) {
      case 'splash':
        this.splash(pos, dx, dy, dz, intensity, clampCount(fixed, 18 * intensity));
        break;
      case 'spray':
        this.spray(pos, dx, dy, dz, clampCount(fixed, 3 * intensity), !!dir);
        break;
      case 'mist':
        this.mist(pos, dx, dz, intensity, clampCount(fixed, intensity), PAL_WHITE, 0.28);
        break;
      case 'debris':
        this.debris(pos, dx, dy, dz, intensity, opts?.variant ?? 'rock', fixed);
        break;
      case 'foam':
        this.foam(pos, dx, dz, intensity, clampCount(fixed, 6 * intensity));
        break;
      case 'sparkle':
        this.sparkle(pos, intensity, clampCount(fixed, 5 * intensity));
        break;
    }
  }

  splash(p: Vec3, dx: number, dy: number, dz: number, k: number, count: number): void {
    const sk = Math.sqrt(k);
    for (let j = 0; j < count; j++) {
      const a = this.rng() * Math.PI * 2;
      const out = this.r(1.5, 5.5) * sk;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rad = this.r(0, 0.9) * sk;
      this.spawn(
        p.x + ca * rad,
        p.y + 0.2,
        p.z + sa * rad,
        ca * out + dx * 0.35,
        this.r(3, 8.5) * (0.6 + 0.4 * sk) + dy * 0.2,
        sa * out + dz * 0.35,
        this.r(0.7, 1.4),
        this.r(0.22, 0.5),
        0.08,
        PAL_WATER,
        1.25,
        0.95,
        0.8,
        1,
        SHAPE_SHARD,
        this.r(-6, 6),
        0,
      );
    }
    const puffs = Math.min(12, Math.floor(count / 6));
    for (let j = 0; j < puffs; j++) {
      this.spawn(
        p.x + this.r(-1, 1) * sk,
        p.y + this.r(0.3, 1.2),
        p.z + this.r(-1, 1) * sk,
        this.r(-1, 1) + dx * 0.2,
        this.r(1, 2.5),
        this.r(-1, 1) + dz * 0.2,
        this.r(0.5, 0.9),
        this.r(1.0, 1.6) * sk,
        this.r(2.2, 3.2) * sk,
        PAL_WHITE,
        1.1,
        0.5,
        1.5,
        0.15,
        SHAPE_SOFT,
        0,
        F_FADE_IN,
      );
    }
  }

  spray(p: Vec3, dx: number, dy: number, dz: number, count: number, hasDir: boolean): void {
    for (let j = 0; j < count; j++) {
      this.spawn(
        p.x + this.r(-0.3, 0.3),
        p.y + this.r(0, 0.3),
        p.z + this.r(-0.3, 0.3),
        (hasDir ? dx : 0) + this.r(-1.2, 1.2),
        (hasDir ? dy : this.r(2, 4)) + this.r(-0.5, 1.2),
        (hasDir ? dz : 0) + this.r(-1.2, 1.2),
        this.r(0.35, 0.7),
        this.r(0.18, 0.36),
        0.05,
        PAL_WATER,
        1.05,
        0.85,
        1.6,
        1,
        SHAPE_SHARD,
        this.r(-8, 8),
        0,
      );
    }
  }

  mist(p: Vec3, dx: number, dz: number, k: number, count: number, pal: Float32Array, alpha: number): void {
    const spread = 3 * Math.sqrt(k);
    for (let j = 0; j < count; j++) {
      this.spawn(
        p.x + this.r(-spread, spread),
        p.y + this.r(0.2, 1.5),
        p.z + this.r(-spread, spread),
        dx + this.r(-0.6, 0.6),
        this.r(0.8, 1.8),
        dz + this.r(-0.6, 0.6),
        this.r(2.5, 4.5),
        this.r(2.5, 4),
        this.r(7, 10),
        pal,
        1,
        alpha,
        0.4,
        -0.02,
        SHAPE_SOFT,
        this.r(-0.3, 0.3),
        F_FADE_IN,
      );
    }
  }

  debris(
    p: Vec3,
    dx: number,
    dy: number,
    dz: number,
    k: number,
    variant: ParticleVariant,
    fixed: number | undefined,
  ): void {
    const sk = Math.sqrt(k);
    if (variant === 'leaves') {
      const count = clampCount(fixed, 16 * k);
      for (let j = 0; j < count; j++) {
        const a = this.rng() * Math.PI * 2;
        const out = this.r(1.5, 4) * sk;
        this.spawn(
          p.x + this.r(-1.5, 1.5),
          p.y + this.r(0.5, 3),
          p.z + this.r(-1.5, 1.5),
          Math.cos(a) * out + dx * 0.3,
          this.r(2, 5) + dy * 0.2,
          Math.sin(a) * out + dz * 0.3,
          this.r(2.2, 3.8),
          this.r(0.18, 0.36),
          0.16,
          PAL_LEAVES,
          1,
          1,
          2.2,
          0.3,
          SHAPE_SHARD,
          this.r(-5, 5),
          F_FLUTTER | F_GROUND,
        );
      }
      return;
    }
    const pal = debrisPalette(variant);
    const big = variant === 'house' ? 1.2 : variant === 'concrete' ? 1.3 : variant === 'metal' ? 0.9 : 1;
    const count = clampCount(fixed, 10 * k);
    for (let j = 0; j < count; j++) {
      const a = this.rng() * Math.PI * 2;
      const out = this.r(2, 6) * sk;
      const size = this.r(0.3, 0.75) * big;
      this.spawn(
        p.x + this.r(-0.8, 0.8),
        p.y + this.r(0.2, 1.2),
        p.z + this.r(-0.8, 0.8),
        Math.cos(a) * out + dx * 0.5,
        this.r(3, 8) * (0.7 + 0.3 * sk) + dy * 0.3,
        Math.sin(a) * out + dz * 0.5,
        this.r(1.6, 2.6),
        size,
        size * 0.85,
        pal,
        1,
        1,
        0.3,
        1,
        SHAPE_CHUNK,
        this.r(-8, 8),
        F_GROUND,
      );
    }
  }

  foam(p: Vec3, dx: number, dz: number, k: number, count: number): void {
    const sk = Math.sqrt(k);
    const spread = 1.5 * sk;
    for (let j = 0; j < count; j++) {
      const size = this.r(0.25, 0.45) * (0.5 + 0.5 * sk);
      this.spawn(
        p.x + this.r(-spread, spread),
        p.y + 0.08,
        p.z + this.r(-spread, spread),
        dx * 0.5 + this.r(-0.4, 0.4),
        0,
        dz * 0.5 + this.r(-0.4, 0.4),
        this.r(1.5, 3),
        size,
        size * 1.6,
        PAL_WHITE,
        1.15,
        0.85,
        0.8,
        0,
        SHAPE_FLECK,
        0,
        F_FADE_IN,
      );
    }
  }

  foamRing(p: Vec3, k: number, count: number): void {
    for (let j = 0; j < count; j++) {
      const a = (j / count) * Math.PI * 2 + this.r(-0.1, 0.1);
      const sp = this.r(2.5, 4.5) * k;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.spawn(
        p.x + ca * 1.5,
        p.y + 0.1,
        p.z + sa * 1.5,
        ca * sp,
        0,
        sa * sp,
        this.r(1.2, 2),
        0.45,
        0.9,
        PAL_WHITE,
        1.15,
        0.9,
        1.4,
        0,
        SHAPE_FLECK,
        0,
        0,
      );
    }
  }

  sparkle(p: Vec3, k: number, count: number): void {
    const spread = 1.5 * Math.sqrt(k);
    for (let j = 0; j < count; j++) {
      this.spawn(
        p.x + this.r(-spread, spread),
        p.y + this.r(0.5, 2.5),
        p.z + this.r(-spread, spread),
        this.r(-0.6, 0.6),
        this.r(0.5, 1.5),
        this.r(-0.6, 0.6),
        this.r(0.4, 0.9),
        this.r(0.18, 0.32),
        0,
        PAL_SPARKLE,
        2.2,
        1,
        2,
        -0.05,
        SHAPE_SHARD,
        this.r(-10, 10),
        0,
      );
    }
  }

  /** Hot, short-lived sparks (metal structures tearing apart). */
  sparks(p: Vec3, count: number): void {
    for (let j = 0; j < count; j++) {
      const a = this.rng() * Math.PI * 2;
      const out = this.r(4, 10);
      this.spawn(
        p.x + this.r(-0.5, 0.5),
        p.y + this.r(0.5, 2),
        p.z + this.r(-0.5, 0.5),
        Math.cos(a) * out,
        this.r(3, 9),
        Math.sin(a) * out,
        this.r(0.3, 0.65),
        this.r(0.12, 0.22),
        0.04,
        PAL_SPARK,
        2.2,
        1,
        0.6,
        1,
        SHAPE_SHARD,
        this.r(-12, 12),
        F_GROUND,
      );
    }
  }

  /** Ice broken off the iceberg: bright shards bursting out (carried on with its motion) + frost. */
  iceShards(p: Vec3, amount: number): void {
    const count = Math.max(1, Math.round(iceShardCount(amount) * this.budget));
    const k = clamp(amount * 10, 0.3, 2);
    const ice = this.iceberg;
    const ix = ice ? ice.vel.x * 0.55 : 0;
    const iy = ice ? Math.max(0, ice.vel.y) * 0.3 : 0;
    const iz = ice ? ice.vel.z * 0.55 : 0;
    for (let j = 0; j < count; j++) {
      const a = this.rng() * Math.PI * 2;
      const out = this.r(2.5, 6.5) * (0.7 + 0.3 * k);
      const size = this.r(0.22, 0.55) * (0.8 + 0.25 * k);
      this.spawn(
        p.x + this.r(-0.6, 0.6),
        p.y + this.r(0, 1.2),
        p.z + this.r(-0.6, 0.6),
        Math.cos(a) * out + ix,
        this.r(2, 6) * (0.7 + 0.3 * k) + iy,
        Math.sin(a) * out + iz,
        this.r(0.9, 1.7),
        size,
        size * 0.7,
        PAL_ICE,
        1.35,
        1,
        0.4,
        1,
        SHAPE_SHARD,
        this.r(-10, 10),
        F_GROUND,
      );
    }
    const puffs = Math.max(1, Math.round(count / 6));
    for (let j = 0; j < puffs; j++) {
      this.spawn(
        p.x + this.r(-0.8, 0.8),
        p.y + this.r(0.3, 1.4),
        p.z + this.r(-0.8, 0.8),
        this.r(-1, 1) + ix * 0.8,
        this.r(0.5, 1.8),
        this.r(-1, 1) + iz * 0.8,
        this.r(0.5, 0.9),
        this.r(0.8, 1.2) * Math.sqrt(k),
        this.r(1.8, 2.6) * Math.sqrt(k),
        PAL_SNOW,
        1.05,
        0.55,
        1.8,
        0,
        SHAPE_SOFT,
        0,
        F_FADE_IN,
      );
    }
  }

  /** Glacier ice merging in: a puff of snow and ice crumbs that swirls into the iceberg. */
  absorbPuff(p: Vec3, mass: number, newMass: number): void {
    const frac = newMass > 0 ? mass / newMass : 1;
    const count = Math.max(1, Math.round(absorbPuffCount(frac) * this.budget));
    const sk = Math.sqrt(clamp(mass / 6, 0.4, 3));
    for (let j = 0; j < count; j++) {
      const a = this.rng() * Math.PI * 2;
      const rad = this.r(0.4, 1.6) * sk;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const out = this.r(1.5, 3.5);
      const shard = this.rng() < 0.3;
      const size = shard ? this.r(0.18, 0.4) : this.r(0.6, 1.1) * sk;
      this.spawn(
        p.x + ca * rad,
        p.y + this.r(0.2, 1.6) * sk,
        p.z + sa * rad,
        ca * out,
        this.r(1, 3),
        sa * out,
        this.r(0.8, 1.3),
        size,
        shard ? size * 0.6 : size * 0.5,
        shard ? PAL_ICE : PAL_SNOW,
        shard ? 1.2 : 1.05,
        shard ? 1 : 0.7,
        2,
        0,
        shard ? SHAPE_SHARD : SHAPE_SOFT,
        shard ? this.r(-8, 8) : this.r(-1, 1),
        F_ATTRACT | F_FADE_IN,
      );
    }
  }

  /** Avalanche spray: billowing snow low at the sides/rear of a big iceberg, plus powder clumps. */
  avalanche(ice: IcebergState, fx: number, fz: number, speed: number): void {
    const r = ice.radius;
    const rx = -fz;
    const rz = fx;
    const side = this.rng() < 0.5 ? -1 : 1;
    const back = this.r(0.4, 1.1) * r;
    const lat = this.r(0.55, 1.05) * r * side;
    const x = ice.pos.x - fx * back + rx * lat;
    const y = ice.pos.y + this.r(0.05, 0.4) * r;
    const z = ice.pos.z - fz * back + rz * lat;
    const out = this.r(2, 5) * (0.6 + 0.4 * Math.min(1, speed / 25));
    const s0 = this.r(0.3, 0.5) * r;
    this.spawn(
      x,
      y,
      z,
      ice.vel.x * this.r(0.3, 0.5) + rx * side * out,
      this.r(1.2, 3.5),
      ice.vel.z * this.r(0.3, 0.5) + rz * side * out,
      this.r(0.9, 1.5),
      s0,
      s0 * this.r(2.2, 3),
      PAL_SNOW,
      1.05,
      0.35,
      1.4,
      -0.03,
      SHAPE_SOFT,
      this.r(-0.4, 0.4),
      F_FADE_IN,
    );
    if (this.rng() < 0.5) {
      const size = this.r(0.25, 0.5);
      this.spawn(
        x,
        y + 0.3,
        z,
        ice.vel.x * 0.4 + rx * side * this.r(3, 7),
        this.r(3, 7),
        ice.vel.z * 0.4 + rz * side * this.r(3, 7),
        this.r(1, 1.6),
        size,
        size * 0.8,
        PAL_SNOW,
        1.1,
        1,
        0.5,
        1,
        SHAPE_CHUNK,
        this.r(-6, 6),
        F_GROUND,
      );
    }
  }

  /**
   * Calving: ice crumbs and snow dust trickling off the glacier front at p, nudged out along
   * (fx, fz). `snowy` (0..1) is the share of soft snow puffs among them.
   */
  crumbs(p: Vec3, fx: number, fz: number, count: number, snowy: number): void {
    for (let j = 0; j < count; j++) {
      const out = this.r(0.2, 1.1);
      if (this.rng() < snowy) {
        this.spawn(
          p.x + this.r(-0.4, 0.4),
          p.y + this.r(-0.2, 0.2),
          p.z + this.r(-0.4, 0.4),
          fx * out * 0.6 + this.r(-0.3, 0.3),
          this.r(-0.4, 0.3),
          fz * out * 0.6 + this.r(-0.3, 0.3),
          this.r(1.1, 1.9),
          this.r(0.35, 0.6),
          this.r(1.1, 1.8),
          PAL_SNOW,
          1.05,
          0.5,
          1.4,
          0.12,
          SHAPE_SOFT,
          this.r(-0.5, 0.5),
          F_FADE_IN,
        );
        continue;
      }
      const size = this.r(0.1, 0.24);
      this.spawn(
        p.x + this.r(-0.3, 0.3),
        p.y + this.r(-0.1, 0.1),
        p.z + this.r(-0.3, 0.3),
        fx * out + this.r(-0.25, 0.25),
        this.r(0, 0.9),
        fz * out + this.r(-0.25, 0.25),
        this.r(0.9, 1.5),
        size,
        size * 0.8,
        PAL_ICE,
        1.25,
        1,
        0.3,
        1,
        SHAPE_SHARD,
        this.r(-9, 9),
        F_GROUND,
      );
    }
  }

  // --- reactions to game events -------------------------------------------------------------

  private readonly lastHit = new Float64Array(256).fill(-1);

  handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'collision': {
        // Contacts can repeat every step while pushing against something; throttle per obstacle.
        const h = e.obstacleId & 255;
        if (this.time - this.lastHit[h] < 0.15) return;
        this.lastHit[h] = this.time;
        const k = Math.max(0.25, Math.min(2.5, e.impulse / 250));
        this.splash(e.pos, 0, 0, 0, k, Math.round(8 + 14 * k));
        this.debris(e.pos, 0, 0, 0, k, debrisVariantFor(e.kind), Math.round(4 + 10 * k));
        this.sparkle(e.pos, k, Math.round(3 + 3 * k));
        break;
      }
      case 'obstacleBroken': {
        const v = debrisVariantFor(e.kind);
        const n = v === 'concrete' ? 50 : v === 'house' ? 45 : 30;
        this.debris(e.pos, 0, 0, 0, 1.6, v, n);
        if (v === 'house') this.mist(e.pos, 0, 0, 2, 6, PAL_DUST, 0.35);
        if (v === 'concrete') this.mist(e.pos, 0, 0, 3, 10, PAL_DUST, 0.4);
        if (v === 'metal') this.sparks(e.pos, 14);
        if (e.kind === 'pine' || e.kind === 'broadleaf') this.debris(e.pos, 0, 0, 0, 1.2, 'leaves', 18);
        break;
      }
      case 'iceChipped':
        this.iceShards(e.pos, e.amount);
        break;
      case 'absorbed':
        this.absorbPuff(e.pos, e.mass, e.newMass);
        break;
      case 'treeFelled':
        this.debris(e.pos, 0, 0, 0, 1.4, 'leaves', 40);
        this.debris(e.pos, 0, 0, 0, 0.8, 'wood', 8);
        break;
      case 'splash': {
        const k = Math.max(0.2, Math.min(4, e.intensity));
        this.splash(e.pos, 0, 0, 0, k, Math.round(10 + 24 * k));
        break;
      }
      case 'landed': {
        const k = Math.max(0.4, Math.min(3, e.drop / 8));
        this.splash(e.pos, 0, 0, 0, k, Math.round(25 + 40 * k));
        this.foamRing(e.pos, Math.sqrt(k), Math.round(20 + 16 * k));
        this.mist(e.pos, 0, 0, k, Math.round(2 + 3 * k), PAL_WHITE, 0.3);
        break;
      }
      case 'enteredOcean':
        this.splash(e.pos, 0, 0, 0, 2, 70);
        this.foamRing(e.pos, 1.4, 36);
        break;
      case 'waterfallCrossed':
        this.sparkle(e.pos, 2, 24);
        break;
      default:
        break;
    }
  }

  // --- simulation ------------------------------------------------------------------------------

  /** Advance every live particle by dt and refresh the GPU arrays. Returns live count. */
  update(dt: number): number {
    this.time += dt;
    const n = this.capacity;
    const pos = this.positions;
    const vel = this.vel;
    const col = this.colors;
    const misc = this.misc;
    const grid = this.grid;
    const sea = this.seaLevel;
    const t = this.time;
    const ice = this.iceberg;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      const life = this.life[i] - dt;
      this.life[i] = life;
      if (life <= 0) {
        misc[i3] = 0;
        col[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      const k = 1 / (1 + this.drag[i] * dt);
      let vx = vel[i3] * k;
      let vy = vel[i3 + 1] * k - 9.81 * this.grav[i] * dt;
      let vz = vel[i3 + 2] * k;
      const f = this.flags[i];
      if (f & F_FLUTTER) {
        vx += Math.sin(t * 3.1 + i) * 2.5 * dt;
        vz += Math.cos(t * 2.7 + i * 1.7) * 2.5 * dt;
      }
      // Attracted particles move in the iceberg's frame: carried along, pulled in and swirled.
      let cx = 0;
      let cy = 0;
      let cz = 0;
      if (f & F_ATTRACT && ice) {
        const tx = ice.pos.x - pos[i3];
        const ty = ice.pos.y + ice.radius * 0.5 - pos[i3 + 1];
        const tz = ice.pos.z - pos[i3 + 2];
        const d = Math.sqrt(tx * tx + ty * ty + tz * tz) + 1e-3;
        const pull = (ATTRACT_PULL * dt) / d;
        const swirl = (ATTRACT_SWIRL * dt) / d;
        vx += tx * pull - tz * swirl;
        vy += ty * pull;
        vz += tz * pull + tx * swirl;
        cx = ice.vel.x;
        cy = ice.vel.y;
        cz = ice.vel.z;
        if (d < ice.radius * 0.8 && life > 0.12) this.life[i] = 0.12;
      }
      const x = pos[i3] + (vx + cx) * dt;
      let y = pos[i3 + 1] + (vy + cy) * dt;
      const z = pos[i3 + 2] + (vz + cz) * dt;
      if (f & F_GROUND && grid) {
        let g = gridHeight(grid, x, z);
        if (g < sea) g = sea;
        if (y < g + 0.05) {
          y = g + 0.05;
          if (vy < 0) vy = -vy * 0.25;
          vx *= 0.55;
          vz *= 0.55;
          this.spin[i] *= 0.6;
        }
      }
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      const age = 1 - this.life[i] / this.maxLife[i];
      misc[i3] = this.size0[i] + (this.size1[i] - this.size0[i]) * age;
      misc[i3 + 2] += this.spin[i] * dt;
      const fadeOut = Math.min(1, (1 - age) * 4);
      const fadeIn = f & F_FADE_IN ? Math.min(1, age * 5) : 1;
      col[i * 4 + 3] = this.alpha[i] * fadeIn * fadeOut;
    }
    this.alive = alive;
    return alive;
  }
}

function clampCount(fixed: number | undefined, def: number): number {
  return Math.max(1, Math.min(400, Math.round(fixed ?? def)));
}

/** Debris material for an obstacle kind (structures included). */
export function debrisVariantFor(kind: ObstacleKind): ParticleVariant {
  switch (kind) {
    case 'pine':
    case 'broadleaf':
    case 'logPile':
    case 'fence':
    case 'footbridge':
      return 'wood';
    case 'house':
    case 'church':
    case 'chalet':
    case 'barn':
    case 'lighthouse':
      return 'house';
    case 'dam':
    case 'roadBridge':
    case 'coolingTower':
    case 'smokestack':
    case 'factoryHall':
    case 'silo':
    case 'waterTower':
      return 'concrete';
    case 'car':
    case 'truck':
    case 'bus':
    case 'railWagon':
    case 'boat':
    case 'guardrail':
    case 'tank':
    case 'pylon':
    case 'windTurbine':
    case 'skiLiftPylon':
    case 'trafficLight':
      return 'metal';
    case 'iceBlock':
    case 'iceField':
      return 'ice';
    default:
      return 'rock';
  }
}

function debrisPalette(v: ParticleVariant): Float32Array {
  switch (v) {
    case 'wood':
      return PAL_WOOD;
    case 'house':
      return PAL_HOUSE;
    case 'metal':
      return PAL_METAL;
    case 'concrete':
      return PAL_CONCRETE;
    case 'ice':
      return PAL_ICE;
    case 'leaves':
      return PAL_LEAVES;
    default:
      return PAL_ROCK;
  }
}

export const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aMisc;
uniform float uScale;
varying vec4 vColor;
varying float vShape;
varying float vAngle;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vColor = aColor;
  vShape = aMisc.y;
  vAngle = aMisc.z;
  if (aMisc.x <= 0.0 || aColor.a <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aMisc.x * uScale / max(-mvPosition.z, 0.1), 1.0, 512.0);
  #include <fog_vertex>
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
varying vec4 vColor;
varying float vShape;
varying float vAngle;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vAngle);
  float s = sin(vAngle);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 col = vColor.rgb;
  float a = vColor.a;
  if (vShape < 0.5) {
    a *= 1.0 - smoothstep(0.3, 1.0, length(p) * 2.0);
  } else if (vShape < 1.5) {
    if (abs(p.x) * 2.6 + abs(p.y) * 2.2 > 1.0) discard;
    col *= p.x > 0.0 ? 1.0 : 0.72;
  } else if (vShape < 2.5) {
    if (max(abs(p.x), abs(p.y)) > 0.34) discard;
    col *= p.y > p.x ? (p.y > -p.x ? 1.0 : 0.8) : 0.62;
  } else {
    float r = length(vec2(p.x, p.y * 2.6)) * 2.0;
    if (r > 1.0) discard;
    a *= 1.0 - smoothstep(0.6, 1.0, r);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Bottom points of each waterfall run in the river trail (x, y, z, width, dirX, dirZ, budget). */
const FALL_STRIDE = 7;

function scanFalls(river: RiverTrailApi, out: Float32Array): number {
  const s = river.samples;
  let count = 0;
  let i = 0;
  while (i < s.length && count < MAX_FALLS) {
    if (s[i].kind !== 'fall') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < s.length && s[j + 1].kind === 'fall') j++;
    const b = j + 1 < s.length ? s[j + 1] : s[j];
    const o = count * FALL_STRIDE;
    const keep = out[o + 6];
    out[o] = b.x;
    out[o + 1] = b.y;
    out[o + 2] = b.z;
    out[o + 3] = b.width;
    out[o + 4] = b.dirX;
    out[o + 5] = b.dirZ;
    out[o + 6] = keep;
    count++;
    i = j + 1;
  }
  return count;
}

/** Per-frame emission state (fractional budgets carry over so rates are frame-rate independent). */
export interface EmitterState {
  sprayBudget: number;
  wakeBudget: number;
  glintBudget: number;
  avalancheBudget: number;
  fallCount: number;
  fallScanVersion: number;
  fallScanTimer: number;
  lastTime: number;
  dirty: boolean;
}

export function createEmitterState(time: number): EmitterState {
  return {
    sprayBudget: 0,
    wakeBudget: 0,
    glintBudget: 0,
    avalancheBudget: 0,
    fallCount: 0,
    fallScanVersion: -1,
    fallScanTimer: 0,
    lastTime: time,
    dirty: false,
  };
}

/** Optional-effect budget per render quality (the avalanche spray is the big one). */
const QUALITY_BUDGET = { high: 1, medium: 1, low: 0.6 } as const;

/**
 * Pooled particle effects. Registers itself as runtime.fx, listens to runtime events, and emits
 * iceberg spray / wake foam / glints and waterfall mist on its own every frame. Simulation runs on
 * the game clock (runtime.time), so it freezes while paused.
 */
export function Particles({ quality = 'high' }: { quality?: 'high' | 'medium' | 'low' } = {}) {
  const rt = useRuntime();

  const sys = useMemo(() => {
    const pool = new ParticlePool(PARTICLE_CAPACITY, (rt.level.seed ^ 0x9e3779b1) >>> 0);
    pool.grid = rt.terrain.grid;
    pool.seaLevel = rt.level.seaLevel;
    pool.iceberg = rt.iceberg;
    const geometry = new BufferGeometry();
    const posAttr = new BufferAttribute(pool.positions, 3).setUsage(DynamicDrawUsage);
    const colAttr = new BufferAttribute(pool.colors, 4).setUsage(DynamicDrawUsage);
    const miscAttr = new BufferAttribute(pool.misc, 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('aColor', colAttr);
    geometry.setAttribute('aMisc', miscAttr);
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uScale: { value: 600 } }]),
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 10;
    const em = createEmitterState(rt.time);
    return {
      pool,
      geometry,
      material,
      points,
      posAttr,
      colAttr,
      miscAttr,
      em,
      falls: new Float32Array(MAX_FALLS * FALL_STRIDE),
      scratch: { x: 0, y: 0, z: 0 },
    };
  }, [rt]);

  useEffect(() => {
    sys.pool.budget = QUALITY_BUDGET[quality] ?? 1;
  }, [sys, quality]);

  useEffect(() => {
    rt.fx = sys.pool;
    const off = rt.events.on((e) => sys.pool.handleEvent(e));
    return () => {
      off();
      if (rt.fx === sys.pool) rt.fx = null;
      sys.geometry.dispose();
      sys.material.dispose();
    };
  }, [rt, sys]);

  useFrame((state) => {
    const { pool, em, scratch: sp, falls } = sys;
    let dt = rt.time - em.lastTime;
    em.lastTime = rt.time;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;

    const cam = state.camera;
    const fov = cam instanceof PerspectiveCamera ? cam.fov : 55;
    sys.material.uniforms.uScale.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360));

    emitIcebergEffects(rt.phase, rt.iceberg, dt, pool, em, sp);

    em.fallScanTimer -= dt;
    if (em.fallScanTimer <= 0 && rt.river.version !== em.fallScanVersion) {
      em.fallScanTimer = 0.3;
      em.fallScanVersion = rt.river.version;
      em.fallCount = scanFalls(rt.river, falls);
    }
    for (let f = 0; f < em.fallCount; f++) {
      const o = f * FALL_STRIDE;
      const dx = falls[o] - cam.position.x;
      const dz = falls[o + 2] - cam.position.z;
      if (dx * dx + dz * dz > MIST_RANGE * MIST_RANGE) continue;
      const width = Math.max(0.6, Math.min(2, falls[o + 3] / 8));
      falls[o + 6] += dt * 10 * width;
      sp.x = falls[o];
      sp.y = falls[o + 1];
      sp.z = falls[o + 2];
      while (falls[o + 6] >= 1) {
        falls[o + 6] -= 1;
        pool.mist(sp, falls[o + 4], falls[o + 5], width, 1, PAL_WHITE, 0.28);
        if (pool.random() < 0.5) pool.foam(sp, falls[o + 4] * 1.5, falls[o + 5] * 1.5, width, 1);
      }
    }

    const alive = pool.update(dt);
    // One extra upload after the last particle dies so its zeroed slot reaches the GPU.
    if (alive > 0 || em.dirty) {
      sys.posAttr.needsUpdate = true;
      sys.colAttr.needsUpdate = true;
      sys.miscAttr.needsUpdate = true;
      em.dirty = alive > 0;
    }
  });

  return <primitive object={sys.points} />;
}

/**
 * Continuous spray at the iceberg's sides/rear, wake foam, occasional cyan glints and, when the
 * iceberg is big and fast, avalanche snow (budgeted by pool fill and quality).
 */
export function emitIcebergEffects(
  phase: GamePhase,
  ice: IcebergState,
  dt: number,
  pool: ParticlePool,
  em: EmitterState,
  p: Vec3,
): void {
  if (phase !== 'playing' && phase !== 'complete') return;
  const speed = Math.hypot(ice.vel.x, ice.vel.z);
  // heading θ → (sin θ, cos θ); right of (dx, dz) is (-dz, dx)
  const fx = speed > 0.5 ? ice.vel.x / speed : Math.sin(ice.heading);
  const fz = speed > 0.5 ? ice.vel.z / speed : Math.cos(ice.heading);
  const rx = -fz;
  const rz = fx;
  const r = ice.radius;

  em.glintBudget += dt * (3 + speed * 0.15);
  while (em.glintBudget >= 1) {
    em.glintBudget -= 1;
    p.x = ice.pos.x;
    p.y = ice.pos.y + 0.5;
    p.z = ice.pos.z;
    pool.sparkle(p, 0.8, 1);
  }

  if (!ice.grounded || speed < 3) {
    em.sprayBudget = 0;
    em.wakeBudget = 0;
    em.avalancheBudget = 0;
    return;
  }

  if (!ice.inOcean) {
    const scale = ice.radius / ICEBERG_BASE_RADIUS;
    em.avalancheBudget += dt * avalancheRate(scale, speed, pool.alive, pool.capacity) * pool.budget;
    while (em.avalancheBudget >= 1) {
      em.avalancheBudget -= 1;
      pool.avalanche(ice, fx, fz, speed);
    }
  } else {
    em.avalancheBudget = 0;
  }
  const turn = Math.min(1, Math.abs(ice.yawRate) / 0.8);
  // yawRate > 0 is a left turn (θ increasing), whose outside is the right-hand side (+1).
  const outside = ice.yawRate > 0 ? 1 : -1;
  const sp01 = Math.min(1, speed / 25);
  em.sprayBudget += dt * (speed - 3) * 7 * (1 + 1.5 * turn) * (ice.inOcean ? 0.5 : 1);
  while (em.sprayBudget >= 1) {
    em.sprayBudget -= 1;
    let vx: number;
    let vy: number;
    let vz: number;
    if (pool.random() < 0.3) {
      // rear rooster tail
      p.x = ice.pos.x - fx * r;
      p.z = ice.pos.z - fz * r;
      const side = pool.random() * 2 - 1;
      vx = ice.vel.x * 0.2 + rx * side * 1.5;
      vz = ice.vel.z * 0.2 + rz * side * 1.5;
      vy = 2 + 2.5 * sp01;
    } else {
      const side = pool.random() < 0.5 + 0.35 * turn * outside ? 1 : -1;
      const along = pool.random() * 0.8 - 0.4;
      p.x = ice.pos.x + rx * side * r * 0.9 + fx * along * r;
      p.z = ice.pos.z + rz * side * r * 0.9 + fz * along * r;
      const boost = 1 + turn * (side === outside ? 0.8 : 0);
      const out = (1.5 + pool.random() * 3) * (0.5 + 0.5 * sp01) * boost;
      vx = ice.vel.x * 0.35 + rx * side * out;
      vz = ice.vel.z * 0.35 + rz * side * out;
      vy = 1.5 + pool.random() * 2.5 * (0.5 + sp01);
    }
    p.y = ice.pos.y + 0.25;
    pool.spray(p, vx, vy, vz, 1, true);
  }

  em.wakeBudget += dt * speed * 0.6;
  while (em.wakeBudget >= 1) {
    em.wakeBudget -= 1;
    p.x = ice.pos.x - fx * (r + 0.5) + rx * (pool.random() * 2 - 1) * r;
    p.y = ice.pos.y + 0.12;
    p.z = ice.pos.z - fz * (r + 0.5) + rz * (pool.random() * 2 - 1) * r;
    pool.foam(p, fx * speed * 0.2, fz * speed * 0.2, 0.5, 1);
  }
}
