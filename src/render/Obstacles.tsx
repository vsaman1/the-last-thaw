import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { geomRegistry, type GeomDef, type GeomKey } from '../core/obstacles/shapes';
import type { BodyPart, PartSpin, SignalLamp } from '../core/obstacles/specs';
import { PHYSICS_TUNING as T } from '../core/physics/tuning';
import { PhysicsWorld, type ObstacleBody } from '../core/physics/world';
import { useRuntime } from './RuntimeContext';
import { obstacleTreeTint, useWorldCondition, type ObstacleTint } from './worldCondition';

/**
 * One InstancedMesh per shape-kit geometry (and per material: traffic-light lamps glow). New bodies
 * take the next slots; a removed body's slots are hidden until a full layout compacts them.
 */
interface Batch {
  mesh: InstancedMesh;
  /** Slots handed out (the draw count): live parts plus the hidden slots of removed bodies. */
  count: number;
  /** Slots of live bodies (the batch is drawn while it has any). */
  live: number;
  /** Instance matrices written since the last upload. */
  dirty: boolean;
}

/** One rendered part: its batch slot and its body-local matrix (and spin, for rotor blades). */
interface Slot {
  batch: Batch;
  index: number;
  local: Matrix4;
  spin: PartSpin | undefined;
}

/**
 * A body's slots, whether its last write included a shake offset, and for bodies with spinning
 * parts how long they have turned (s): frozen once the body stops spinning.
 */
interface Run {
  body: ObstacleBody;
  slots: Slot[];
  shaken: boolean;
  spins: boolean;
  spinTime: number;
}

/** A traffic-light lamp slot and the colour it was last given (-1 = none yet, 0 dim, 1 lit). */
interface LampSlot {
  batch: Batch;
  index: number;
  body: ObstacleBody;
  lamp: SignalLamp;
  lit: number;
}

/**
 * Lamp colours (linear RGB): lit ones are HDR so they bloom on 'high' and read as glowing on every
 * tier (an unlit material); unlit ones are the dark glass of a switched-off lamp.
 */
export const LAMP_COLORS: Readonly<Record<SignalLamp, { lit: readonly number[]; dim: readonly number[] }>> = {
  red: { lit: [4.2, 0.28, 0.16], dim: [0.06, 0.012, 0.01] },
  amber: { lit: [4.0, 1.7, 0.18], dim: [0.06, 0.035, 0.008] },
  green: { lit: [0.25, 3.4, 1.3], dim: [0.008, 0.05, 0.025] },
};

const _spinQ = new Quaternion();
const _spinM = new Matrix4();
const _shift = new Matrix4();
const _spinOut = new Matrix4();

/**
 * The extra transform of a spinning part in its body's frame after `time` s of spinning: a turn of
 * rate × time about the part's axis through its pivot (written into `out`).
 */
export function spinMatrix(spin: PartSpin, time: number, out: Matrix4): Matrix4 {
  const { pivot, axis } = spin;
  _spinQ.setFromAxisAngle(_axis.set(axis.x, axis.y, axis.z), spin.rate * time);
  out.makeTranslation(pivot.x, pivot.y, pivot.z);
  out.multiply(_spinM.makeRotationFromQuaternion(_spinQ));
  return out.multiply(_shift.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

const _p = new Vector3();
const _q = new Quaternion();
const _shakeQ = new Quaternion();
const _axis = new Vector3();
const _s = new Vector3();
const _bodyM = new Matrix4();
const _m = new Matrix4();
const _c = new Color();
/** The matrix of a removed body's slot: scaled to nothing, it draws no pixel and casts no shadow. */
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** Render geometry straight from the shape kit's mesh (the same vertices the colliders use). */
function geometryFor(g: GeomDef): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(g.mesh.positions, 3));
  geo.setAttribute('normal', new BufferAttribute(g.mesh.normals, 3));
  // Shape-kit colours are sRGB; vertex colours are read in the linear working space.
  const src = g.mesh.colors;
  const lin = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    _c.setRGB(src[i], src[i + 1], src[i + 2], SRGBColorSpace);
    lin[i] = _c.r;
    lin[i + 1] = _c.g;
    lin[i + 2] = _c.b;
  }
  geo.setAttribute('color', new BufferAttribute(lin, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A count-0 instanced mesh set up like a real ice batch (vertex colours, instance colours, casts but
 * does not receive shadows), never culled: rendering or compiling it builds the batch's programs.
 */
export function prewarmMesh(material: MeshStandardMaterial | MeshBasicMaterial): InstancedMesh {
  const geo = new BufferGeometry();
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  geo.setAttribute('position', new BufferAttribute(tri, 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(9).fill(1), 3));
  const mesh = new InstancedMesh(geo, material, 1);
  mesh.setColorAt(0, _c.setHex(0xffffff));
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function localMatrix(part: BodyPart): Matrix4 {
  _p.set(part.offset.x, part.offset.y, part.offset.z);
  _q.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
  return new Matrix4().compose(_p, _q, new Vector3(part.scale.x, part.scale.y, part.scale.z));
}

/**
 * Imperative instanced renderer for every obstacle body. Owns its three.js objects; React only
 * mounts `group`. Per frame it rewrites only bodies whose PhysicsWorld stamp changed (plus the
 * ones shaking), allocation-free, and uploads only the batches it wrote. Bodies coming and going
 * touch only their own slots (restructure); a full layout runs when a batch has no room left.
 */
export class ObstacleBatches {
  readonly group = new Group();
  /** Traffic-light lamps: unlit (they emit), tinted per instance with the lit or dim colour. */
  private readonly glow = new MeshBasicMaterial({ vertexColors: true });
  private readonly solid = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
  });
  /** Glacier ice and chunks: translucent, glossy, pale blue from the facet colours. Not emissive. */
  private readonly ice = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.22,
    metalness: 0,
    transparent: true,
    opacity: 0.82,
  });
  private readonly geometries = new Map<GeomKey, BufferGeometry>();
  /** Keyed by geometry, plus LAMP_KEY for traffic-light lamps (their own glowing material). */
  private readonly batches = new Map<string, Batch>();
  private readonly locals = new WeakMap<BodyPart, Matrix4>();
  private runs: Run[] = [];
  private lamps: LampSlot[] = [];
  /** Runs with spinning parts (rotor heads), rewritten every frame while they turn. */
  private spinRuns: Run[] = [];
  private structure = -1;
  /** physics.bodies.length when the slots were last brought up to date (bodies are only appended). */
  private known = 0;
  /** PhysicsWorld.stampSeq at the last write; bodies stamped later have changed. */
  private seen = -1;
  /** Render clock (s) at the last update (spin animation). */
  private clock = NaN;
  /** Empty glow batch so the warm-up compiles the lamp material on every level. */
  private readonly glowPrewarm: InstancedMesh;

  /**
   * An empty batch with the ice material, so the loading warm-up compiles its programs (colour and
   * shadow depth, instanced with instance colours) even on levels with no glacier ice: otherwise the
   * first ice chip compiles them mid-run. three still sets the program for a mesh with count 0.
   */
  private readonly icePrewarm: InstancedMesh;

  /**
   * @param tint Story Mode's world condition on obstacle trees (obstacleTreeTint): recolours a part's
   *   instance colour as it is laid out. Render-only: the bodies and their parts are never changed.
   */
  constructor(
    private readonly physics: PhysicsWorld,
    private readonly tint: ObstacleTint | null = null,
  ) {
    this.group.name = 'obstacles';
    this.icePrewarm = prewarmMesh(this.ice);
    this.icePrewarm.name = 'obstacles-ice-prewarm';
    this.group.add(this.icePrewarm);
    this.glowPrewarm = prewarmMesh(this.glow);
    this.glowPrewarm.name = 'obstacles-lamp-prewarm';
    this.glowPrewarm.castShadow = false;
    this.group.add(this.glowPrewarm);
  }

  private batchFor(name: string, needed: number): Batch {
    let batch = this.batches.get(name);
    if (batch && batch.mesh.instanceMatrix.count >= needed) return batch;
    const lamp = name.endsWith(LAMP_KEY);
    const key = lamp ? name.slice(0, -LAMP_KEY.length) : name;
    const def = geomRegistry().get(key);
    if (!def) throw new Error(`Unknown obstacle geometry: ${key}`);
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = geometryFor(def);
      this.geometries.set(key, geo);
    }
    // Headroom for runtime spawns (debris, chunks) so they do not reallocate the buffers every time.
    const capacity = Math.max(needed + 8, Math.ceil(needed * 1.25));
    const material = lamp ? this.glow : def.surface === 'ice' ? this.ice : this.solid;
    const mesh = new InstancedMesh(geo, material, capacity);
    mesh.name = `obstacles-${name}`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = !lamp;
    mesh.receiveShadow = !lamp && def.surface !== 'ice';
    // Instances move every frame; a stale bounding sphere would cull visible bodies.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    if (batch) {
      this.group.remove(batch.mesh);
      batch.mesh.dispose();
      batch.mesh = mesh;
    } else {
      batch = { mesh, count: 0, live: 0, dirty: false };
      this.batches.set(name, batch);
    }
    this.group.add(mesh);
    return batch;
  }

  /**
   * Bodies were added or removed (spawns, breaks, absorbs, melts): hide the removed bodies' slots
   * and give the new bodies the next free slots of their batches, leaving every other slot as it
   * is. A break then costs its own parts instead of a full layout of the level (chapter 7: 9,500
   * parts, 6-13 ms plus re-writing and re-uploading every matrix, at each tank that broke). Slots
   * stay in body order (new bodies have the highest ids), as a full layout puts them. Falls back to
   * the full layout, which compacts the hidden slots, when a batch has no room left.
   */
  private restructure(): void {
    const bodies = this.physics.bodies;
    const extra = new Map<string, number>();
    for (let i = this.known; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.active) continue;
      for (const part of b.parts) {
        const name = batchName(part);
        extra.set(name, (extra.get(name) ?? 0) + 1);
      }
    }
    for (const [name, n] of extra) {
      const batch = this.batches.get(name);
      // A geometry new to the level (the iceberg's first chip of each shape) gets its own batch.
      if (!batch) this.batchFor(name, n);
      else if (batch.count + n > batch.mesh.instanceMatrix.count) {
        this.layout();
        return;
      }
    }
    const touched = new Set<Batch>();
    let removed = false;
    for (const run of this.runs) {
      if (run.body.active) continue;
      removed = true;
      for (const slot of run.slots) {
        slot.batch.mesh.setMatrixAt(slot.index, HIDDEN);
        slot.batch.live--;
        touched.add(slot.batch);
      }
    }
    if (removed) {
      this.runs = this.runs.filter((r) => r.body.active);
      this.spinRuns = this.spinRuns.filter((r) => r.body.active);
      this.lamps = this.lamps.filter((l) => l.body.active);
    }
    for (let i = this.known; i < bodies.length; i++) {
      if (bodies[i].active) this.place(bodies[i], 0, touched);
    }
    for (const batch of touched) {
      batch.mesh.count = batch.count;
      batch.mesh.visible = batch.live > 0;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
    this.known = bodies.length;
    this.structure = this.physics.structureVersion;
    // The new bodies' stamps are newer than `seen`: update() writes their matrices.
  }

  /** Re-assign every instance slot in body order, compacting the hidden ones (a batch is full). */
  private layout(): void {
    const needed = new Map<string, number>();
    for (const b of this.physics.bodies) {
      if (!b.active) continue;
      for (const part of b.parts) {
        const name = batchName(part);
        needed.set(name, (needed.get(name) ?? 0) + 1);
      }
    }
    for (const [name, n] of needed) this.batchFor(name, n);
    for (const batch of this.batches.values()) {
      batch.count = 0;
      batch.live = 0;
    }

    const old = new Map<ObstacleBody, number>(this.spinRuns.map((r) => [r.body, r.spinTime]));
    this.runs = [];
    this.lamps = [];
    this.spinRuns = [];
    for (const body of this.physics.bodies) {
      if (body.active) this.place(body, old.get(body) ?? 0, null);
    }
    for (const batch of this.batches.values()) {
      batch.mesh.count = batch.count;
      batch.mesh.visible = batch.count > 0;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
    this.known = this.physics.bodies.length;
    this.structure = this.physics.structureVersion;
    this.seen = -1;
  }

  /** Give a body's parts the next slots of their batches (colour, lamp, spin) and add its run. */
  private place(body: ObstacleBody, spinTime: number, touched: Set<Batch> | null): void {
    const slots: Slot[] = [];
    let spins = false;
    for (const part of body.parts) {
      const batch = this.batches.get(batchName(part));
      if (!batch) continue;
      let local = this.locals.get(part);
      if (!local) {
        local = localMatrix(part);
        this.locals.set(part, local);
      }
      const index = batch.count++;
      batch.live++;
      touched?.add(batch);
      if (part.lamp) {
        const c = LAMP_COLORS[part.lamp].dim;
        batch.mesh.setColorAt(index, _c.setRGB(c[0], c[1], c[2]));
        this.lamps.push({ batch, index, body, lamp: part.lamp, lit: -1 });
      } else {
        _c.setHex(part.color);
        this.tint?.(body, part, _c);
        batch.mesh.setColorAt(index, _c);
      }
      // Debris pieces keep their parts' spin data but never turn (their frame has moved).
      const spin = body.state === 'broken' ? undefined : part.spin;
      if (spin) spins = true;
      slots.push({ batch, index, local, spin });
    }
    const run: Run = { body, slots, shaken: false, spins, spinTime };
    this.runs.push(run);
    if (spins) this.spinRuns.push(run);
  }

  /**
   * Body transform into _bodyM: position, rotation, melt scale, plus the 'shook' wobble while an
   * anchored body is shaking. Returns whether a shake offset was applied.
   */
  private bodyMatrix(b: ObstacleBody, time: number): boolean {
    _p.set(b.pos.x, b.pos.y, b.pos.z);
    _q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    let shaking = false;
    const s = b.shake;
    if (b.anchored && s.amp > 0) {
      const t = time - s.t0;
      if (t >= 0 && t < T.shakeDuration) {
        shaking = true;
        const env = (1 - t / T.shakeDuration) ** 2;
        const wave = Math.sin(t * T.shakeFrequency) * env * s.amp;
        if (b.shakeStyle === 'tilt') {
          // Tilt about the base, top swinging along the push direction.
          _axis.set(s.dirZ, 0, -s.dirX);
          _q.premultiply(_shakeQ.setFromAxisAngle(_axis, wave * T.shakeTreeTilt));
        } else {
          _p.x += s.dirX * wave * T.shakeHouseOffset;
          _p.z += s.dirZ * wave * T.shakeHouseOffset;
        }
      }
    }
    const k = b.renderScale;
    _bodyM.compose(_p, _q, _s.set(k, k, k));
    return shaking;
  }

  /**
   * Write changed bodies' instance matrices (and spinning rotors, every frame while they turn) and
   * relight traffic-light lamps whose signal changed. `clock`: the render clock (s, the runtime's
   * game clock; it freezes while paused) that spins rotors.
   */
  update(clock = this.physics.time): void {
    const physics = this.physics;
    if (physics.structureVersion !== this.structure) this.restructure();
    const time = physics.time;
    const dt = Number.isFinite(this.clock) ? Math.min(Math.max(clock - this.clock, 0), 0.25) : 0;
    this.clock = clock;
    for (const run of this.spinRuns) if (run.body.spinning) run.spinTime += dt;
    const seen = this.seen;
    let wrote = false;
    for (const run of this.runs) {
      const b = run.body;
      const shakingNow = b.anchored && b.shake.amp > 0 && time - b.shake.t0 < T.shakeDuration;
      const spinning = run.spins && b.spinning && dt > 0;
      // Unchanged and not wobbling (a body that just stopped shaking needs one rest-pose write).
      if (b.stamp <= seen && !shakingNow && !run.shaken && !spinning) continue;
      run.shaken = this.bodyMatrix(b, time);
      for (const slot of run.slots) {
        if (slot.spin) {
          _m.multiplyMatrices(_bodyM, spinMatrix(slot.spin, run.spinTime, _spinOut)).multiply(slot.local);
        } else {
          _m.multiplyMatrices(_bodyM, slot.local);
        }
        slot.batch.mesh.setMatrixAt(slot.index, _m);
        slot.batch.dirty = true;
      }
      wrote = true;
    }
    this.seen = physics.stampSeq;
    this.relight();
    if (!wrote) return;
    // Upload only the batches written (a moving car or a falling plate: not the level's 9,500 parts).
    for (const batch of this.batches.values()) {
      if (!batch.dirty) continue;
      batch.dirty = false;
      if (batch.count > 0) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Lamps glow while their traffic light shows their colour (dark once it is knocked over). */
  private relight(): void {
    for (const l of this.lamps) {
      const lit = this.physics.signalOf(l.body) === l.lamp ? 1 : 0;
      if (lit === l.lit) continue;
      l.lit = lit;
      const c = lit ? LAMP_COLORS[l.lamp].lit : LAMP_COLORS[l.lamp].dim;
      l.batch.mesh.setColorAt(l.index, _c.setRGB(c[0], c[1], c[2]));
      if (l.batch.mesh.instanceColor) l.batch.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Lit lamp count (tests, debugging). */
  get litLamps(): number {
    let n = 0;
    for (const l of this.lamps) n += l.lit === 1 ? 1 : 0;
    return n;
  }

  /** Seconds the rotor of `body` has turned (render clock), or 0. */
  spinTimeOf(body: ObstacleBody): number {
    return this.spinRuns.find((r) => r.body === body)?.spinTime ?? 0;
  }

  /** Free GPU resources. The objects stay valid (three re-uploads them if they render again). */
  dispose(): void {
    for (const batch of this.batches.values()) batch.mesh.dispose();
    for (const geo of this.geometries.values()) geo.dispose();
    this.icePrewarm.geometry.dispose();
    this.icePrewarm.dispose();
    this.glowPrewarm.geometry.dispose();
    this.glowPrewarm.dispose();
    this.solid.dispose();
    this.ice.dispose();
    this.glow.dispose();
  }
}

/** Batch suffix of traffic-light lamps (same geometry, glowing material). */
const LAMP_KEY = '#lamp';

const batchName = (part: BodyPart): string => (part.lamp ? part.geom + LAMP_KEY : part.geom);

/**
 * Every obstacle body (rocks, barrier stones, trees, the kit's structures and their debris,
 * glacier ice and chunks) drawn from the physics world's live transforms: one InstancedMesh per
 * shape-kit geometry, low-poly and flat-shaded, tinted per instance; ice is translucent. Anchored
 * bodies hit below their threshold wobble ('shook'); melting chunks shrink.
 */
export function Obstacles() {
  const rt = useRuntime();
  const physics = rt.physics;
  const world = useWorldCondition();
  const batches = useMemo(
    () => (physics instanceof PhysicsWorld ? new ObstacleBatches(physics, obstacleTreeTint(world)) : null),
    [physics, world],
  );
  useEffect(() => () => batches?.dispose(), [batches]);
  useFrame(() => batches?.update(rt.time));
  return batches ? <primitive object={batches.group} /> : null;
}
