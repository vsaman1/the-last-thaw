import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { getGeom } from '../core/obstacles/shapes';
import type { BodyPart, PlumeKind } from '../core/obstacles/specs';
import { PhysicsWorld, type ObstacleBody } from '../core/physics/world';
import { createRng } from '../core/rng';
import { palette, PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './Particles';
import { useRuntime } from './RuntimeContext';
import { WIND } from './Sky';

/**
 * Smoke and steam (render-only, no sim cost): plumes rise from the parts marked `plume` (smokestack
 * mouths: dark smoke; cooling-tower throats: big slow white steam; house and chalet chimneys and a
 * factory-hall vent: a thin wisp), slow as they climb and drift off with the wind the clouds sail on
 * (Sky.tsx WIND), growing and fading. An emitter stops for good once its body is broken, knocked
 * off or toppled (PlumeEmitters.standing). Its own particle pool (not the shared effects pool, which
 * hits and breaks must never be starved of), drawn with the effects' point shader; the quality tier
 * scales the rates and the pool, and 'low' leaves out the thin wisps. Far emitters stay quiet.
 */

export interface PlumeStyle {
  /** Puffs per second at full quality. */
  rate: number;
  life: readonly [number, number];
  /** Size (m) at birth and at the end of life. */
  size0: readonly [number, number];
  size1: readonly [number, number];
  /** Initial rise speed (m/s), decaying at riseDecay (1/s). */
  rise: readonly [number, number];
  riseDecay: number;
  alpha: number;
  pal: Float32Array;
  /** Sideways jitter of the puffs (m/s) and the slow wobble on top of the wind (m/s). */
  spread: number;
  wobble: number;
}

export const PLUME_STYLE: Readonly<Record<PlumeKind, PlumeStyle>> = {
  smoke: {
    rate: 6,
    life: [8, 11],
    size0: [1.8, 2.6],
    size1: [10, 15],
    rise: [3.6, 4.6],
    riseDecay: 0.22,
    alpha: 0.5,
    pal: palette('#3F4144', '#4B4D50', '#57595C'),
    spread: 0.35,
    wobble: 0.6,
  },
  steam: {
    rate: 5,
    life: [11, 15],
    size0: [10, 13],
    size1: [28, 40],
    rise: [3.4, 4.2],
    riseDecay: 0.12,
    alpha: 0.55,
    pal: palette('#F4F6F7', '#E8ECEE', '#FFFFFF'),
    spread: 0.6,
    wobble: 0.9,
  },
  thin: {
    rate: 2.2,
    life: [4.5, 6.5],
    size0: [0.5, 0.8],
    size1: [2.6, 3.8],
    rise: [1.3, 1.9],
    riseDecay: 0.3,
    alpha: 0.32,
    pal: palette('#9EA1A4', '#B4B6B8'),
    spread: 0.2,
    wobble: 0.35,
  },
};

export type PlumeQuality = 'high' | 'medium' | 'low';

/** Rate share, pool size and whether thin wisps show, per render quality. */
export const PLUME_QUALITY: Readonly<
  Record<PlumeQuality, { rate: number; capacity: number; thin: boolean }>
> = {
  high: { rate: 1, capacity: 1800, thin: true },
  medium: { rate: 0.6, capacity: 1100, thin: true },
  low: { rate: 0.3, capacity: 500, thin: false },
};

/** Emitters farther than this (m) from the camera do not emit. */
export const PLUME_RANGE = 900;
/** Seconds over which a puff takes up the wind. */
const WIND_UP = 2.5;

/** A plume source: a marked part of a body, its mouth in the body frame and its radius (m). */
export interface PlumeEmitter {
  readonly body: ObstacleBody;
  readonly kind: PlumeKind;
  readonly lx: number;
  readonly ly: number;
  readonly lz: number;
  readonly radius: number;
  budget: number;
}

const _q = new Quaternion();
const _v = new Vector3();

/** Top centre of a part (body frame) and its mouth radius. */
function mouthOf(part: BodyPart): { x: number; y: number; z: number; r: number } {
  const g = getGeom(part.geom);
  _v.set(0, g.max.y * part.scale.y, 0);
  _q.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
  _v.applyQuaternion(_q);
  const r = 0.5 * Math.min((g.max.x - g.min.x) * part.scale.x, (g.max.z - g.min.z) * part.scale.z);
  return { x: part.offset.x + _v.x, y: part.offset.y + _v.y, z: part.offset.z + _v.z, r };
}

/** The plume emitters of a physics world's bodies, kept in step with its structure changes. */
export class PlumeEmitters {
  list: PlumeEmitter[] = [];
  private structure = -1;

  constructor(private readonly physics: PhysicsWorld) {}

  /** Rescan the bodies when bodies came or went (keeps the budgets of emitters that stay). */
  refresh(): void {
    if (this.physics.structureVersion === this.structure) return;
    this.structure = this.physics.structureVersion;
    const old = new Map<string, number>();
    for (const e of this.list) old.set(`${e.body.id}:${e.lx}:${e.ly}:${e.lz}`, e.budget);
    const out: PlumeEmitter[] = [];
    for (const b of this.physics.bodies) {
      if (!b.active || b.state === 'broken') continue;
      for (const part of b.parts) {
        if (!part.plume) continue;
        const m = mouthOf(part);
        const budget = old.get(`${b.id}:${m.x}:${m.y}:${m.z}`) ?? 0;
        out.push({ body: b, kind: part.plume, lx: m.x, ly: m.y, lz: m.z, radius: m.r, budget });
      }
    }
    this.list = out;
  }

  /**
   * True while the emitter's body still stands where it was built: active, not broken or toppled,
   * and (bodies resting on another, a chimney's top) asleep where they were put.
   */
  standing(e: PlumeEmitter): boolean {
    const b = e.body;
    if (!b.active || b.state === 'broken') return false;
    if (b.anchored) return b.state === 'intact';
    if (!b.sleeping) return false;
    const dx = b.pos.x - b.spawn.x;
    const dy = b.pos.y - b.spawn.y;
    const dz = b.pos.z - b.spawn.z;
    if (dx * dx + dy * dy + dz * dz > 0.09) return false;
    // Upright: the body's up axis within ~18° of vertical.
    const { x, z } = b.quat;
    return 1 - 2 * (x * x + z * z) > 0.95;
  }

  /** World position of the emitter's mouth into `out`. */
  mouth(e: PlumeEmitter, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const b = e.body;
    _v.set(e.lx, e.ly, e.lz).applyQuaternion(_q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w));
    out.x = b.pos.x + _v.x;
    out.y = b.pos.y + _v.y;
    out.z = b.pos.z + _v.z;
    return out;
  }
}

/** CPU particle pool for plumes, laid out for the effects' point shader (aColor, aMisc). */
export class PlumePool {
  readonly capacity: number;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly misc: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly rise: Float32Array;
  private readonly decay: Float32Array;
  private readonly alpha: Float32Array;
  private readonly wobble: Float32Array;
  private readonly rng: () => number;
  private cursor = 0;
  private time = 0;
  alive = 0;

  constructor(capacity: number, seed: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    this.misc = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 2);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.rise = new Float32Array(capacity);
    this.decay = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.wobble = new Float32Array(capacity);
    this.rng = createRng(seed >>> 0);
  }

  private r(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  /** One puff of `kind` from a mouth at (x, y, z) of radius `radius` (m). */
  emit(kind: PlumeKind, x: number, y: number, z: number, radius: number): void {
    const st = PLUME_STYLE[kind];
    // Recycle the oldest slot in ring order, preferring a dead one nearby.
    let i = this.cursor;
    for (let k = 0; k < 8; k++) {
      const j = (this.cursor + k) % this.capacity;
      if (this.life[j] <= 0) {
        i = j;
        break;
      }
    }
    this.cursor = (i + 1) % this.capacity;
    if (this.life[i] <= 0) this.alive++;
    const a = this.rng() * Math.PI * 2;
    const rr = Math.sqrt(this.rng()) * radius * 0.7;
    const i3 = i * 3;
    this.positions[i3] = x + Math.cos(a) * rr;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z + Math.sin(a) * rr;
    this.vel[i * 2] = this.r(-st.spread, st.spread);
    this.vel[i * 2 + 1] = this.r(-st.spread, st.spread);
    this.age[i] = 0;
    this.life[i] = this.r(st.life[0], st.life[1]);
    this.size0[i] = this.r(st.size0[0], st.size0[1]);
    this.size1[i] = this.r(st.size1[0], st.size1[1]);
    this.rise[i] = this.r(st.rise[0], st.rise[1]);
    this.decay[i] = st.riseDecay;
    this.alpha[i] = st.alpha * this.r(0.85, 1.1);
    this.wobble[i] = st.wobble;
    const c = Math.floor(this.rng() * (st.pal.length / 3)) * 3;
    const shade = this.r(0.92, 1.06);
    const i4 = i * 4;
    this.colors[i4] = st.pal[c] * shade;
    this.colors[i4 + 1] = st.pal[c + 1] * shade;
    this.colors[i4 + 2] = st.pal[c + 2] * shade;
    this.colors[i4 + 3] = 0;
    this.misc[i3] = this.size0[i];
    this.misc[i3 + 1] = 0; // soft round puff
    this.misc[i3 + 2] = this.rng() * Math.PI * 2;
  }

  /** Advance every puff by dt: rise (slowing), wind drift, growth and fade. Returns live count. */
  update(dt: number): number {
    this.time += dt;
    const t = this.time;
    let alive = 0;
    const wx = WIND.speed * WIND.x;
    const wz = WIND.speed * WIND.z;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.life[i] = 0;
        this.misc[i3] = 0;
        this.colors[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      this.age[i] = age;
      const w = Math.min(1, age / WIND_UP);
      const wob = this.wobble[i];
      const vx = this.vel[i * 2] * (1 - w) + wx * w + Math.sin(t * 0.7 + i * 1.3) * wob;
      const vz = this.vel[i * 2 + 1] * (1 - w) + wz * w + Math.cos(t * 0.6 + i * 0.9) * wob;
      const vy = this.rise[i] * Math.exp(-this.decay[i] * age);
      this.positions[i3] += vx * dt;
      this.positions[i3 + 1] += vy * dt;
      this.positions[i3 + 2] += vz * dt;
      const f = age / this.life[i];
      this.misc[i3] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(f);
      this.misc[i3 + 2] += dt * 0.15;
      this.colors[i * 4 + 3] = this.alpha[i] * Math.min(1, f / 0.12) * (1 - f) ** 1.5;
    }
    this.alive = alive;
    return alive;
  }
}

/**
 * Emit puffs for every standing emitter within range of the camera at (cx, cz) for `dt` seconds of
 * game time; returns how many puffs were emitted.
 */
export function emitPlumes(
  emitters: PlumeEmitters,
  pool: PlumePool,
  quality: PlumeQuality,
  dt: number,
  cx: number,
  cz: number,
  scratch: { x: number; y: number; z: number },
): number {
  const q = PLUME_QUALITY[quality];
  let n = 0;
  for (const e of emitters.list) {
    if (e.kind === 'thin' && !q.thin) continue;
    if (!emitters.standing(e)) continue;
    const m = emitters.mouth(e, scratch);
    const dx = m.x - cx;
    const dz = m.z - cz;
    if (dx * dx + dz * dz > PLUME_RANGE * PLUME_RANGE) {
      e.budget = 0;
      continue;
    }
    e.budget += dt * PLUME_STYLE[e.kind].rate * q.rate;
    while (e.budget >= 1) {
      e.budget -= 1;
      pool.emit(e.kind, m.x, m.y, m.z, e.radius);
      n++;
    }
  }
  return n;
}

/** Smoke and steam plumes from the physics world's chimneys, cooling towers and vents. */
export function Plumes({ quality = 'high' }: { quality?: PlumeQuality } = {}) {
  const rt = useRuntime();
  const sys = useMemo(() => {
    const physics = rt.physics instanceof PhysicsWorld ? rt.physics : null;
    const pool = new PlumePool(PLUME_QUALITY[quality].capacity, (rt.level.seed ^ 0x51ad7e) >>> 0);
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
    points.name = 'plumes';
    points.frustumCulled = false;
    points.renderOrder = 9;
    return {
      emitters: physics ? new PlumeEmitters(physics) : null,
      pool,
      geometry,
      material,
      points,
      posAttr,
      colAttr,
      miscAttr,
      last: rt.time,
      dirty: false,
      scratch: { x: 0, y: 0, z: 0 },
    };
  }, [rt, quality]);

  useEffect(
    () => () => {
      sys.geometry.dispose();
      sys.material.dispose();
    },
    [sys],
  );

  useFrame((state) => {
    let dt = rt.time - sys.last;
    sys.last = rt.time;
    if (!(dt > 0) || !sys.emitters) return;
    if (dt > 0.1) dt = 0.1;
    const cam = state.camera;
    const fov = cam instanceof PerspectiveCamera ? cam.fov : 55;
    const scale = (state.size.height * state.viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360));
    sys.material.uniforms.uScale.value = scale;
    sys.emitters.refresh();
    emitPlumes(sys.emitters, sys.pool, quality, dt, cam.position.x, cam.position.z, sys.scratch);
    const alive = sys.pool.update(dt);
    if (alive > 0 || sys.dirty) {
      sys.posAttr.needsUpdate = true;
      sys.colAttr.needsUpdate = true;
      sys.miscAttr.needsUpdate = true;
      sys.dirty = alive > 0;
    }
  });

  return <primitive object={sys.points} />;
}
