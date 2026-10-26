import type { IcebergState, Terrain } from '../types';
import { clamp01, lerp, smoothstep, wrapAngle } from '../math';
import { type GlacierPlacement, getGlacier, glacierTopAt } from '../glacier/glacier';
import {
  type CalvingKeys,
  type CalvingMotion,
  calvingKeys,
  calvingStateAt,
  createCalvingState,
} from '../glacier/calving';
import {
  type CameraPose,
  copyPose,
  createCameraPose,
  enforceClearance,
  followPose,
  followScale,
} from './follow';

/**
 * Camera for the calving beat. It frames the glacier front with the iceberg in its socket (pushing
 * in gently while the cracks spread), then, as the chunk breaks away and slides off, swings round
 * the moving chunk (on the open side) up into the follow pose, which it reaches exactly at the
 * hand-off. Reduced motion: the front shot holds still, then cuts (under the renderer's veil) to the
 * follow pose while the chunk slides. Stays clear of the terrain and of the glacier.
 */

export type CalvingShotKind = 'full' | 'short';

interface ShotSpec {
  /** Angle from straight ahead of the chunk toward the camera side (rad). */
  az: number;
  /** Horizontal distance from the chunk and height above its ground (m, before the size factor). */
  dist: number;
  height: number;
  fov: number;
  /** Distance/height multipliers reached by the break (slow push-in). */
  push: number;
}

export const CALVING_SHOT = {
  /** After the flyover: a three-quarter view of the face (cracks, socket, the glacier behind). */
  full: { az: 0.62, dist: 15, height: 4, fov: 50, push: 0.8 } as ShotSpec,
  /** The short beat: from the side, closer to the follow pose so the swing is short. */
  short: { az: 1.25, dist: 12.5, height: 4.4, fov: 52, push: 0.94 } as ShotSpec,
  /**
   * Clearance kept above the glacier's top (m); less than GLACIER_TUNING.camMargin, so the follow
   * pose the shot ends on is never pushed.
   */
  glacierClearance: 1.2,
  /** Look point height on the chunk, as a fraction of the iceberg's drawn height. */
  pivotUp: 0.45,
  /** Fraction of the swing by which the camera has risen to the follow height. */
  riseBy: 0.65,
  /** Extra height (m) at the middle of the swing. */
  swingLift: 2.5,
} as const;

const smootherstep01 = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

interface Orbit {
  az: number;
  r: number;
  h: number;
  lx: number;
  ly: number;
  lz: number;
  fov: number;
}

const createOrbit = (): Orbit => ({ az: 0, r: 0, h: 0, lx: 0, ly: 0, lz: 0, fov: 55 });

function orbitOf(pose: CameraPose, px: number, py: number, pz: number, out: Orbit): Orbit {
  const dx = pose.position.x - px;
  const dz = pose.position.z - pz;
  // heading convention: offset (sin az, cos az) × r
  out.az = Math.atan2(dx, dz);
  out.r = Math.hypot(dx, dz);
  out.h = pose.position.y - py;
  out.lx = pose.lookAt.x - px;
  out.ly = pose.lookAt.y - py;
  out.lz = pose.lookAt.z - pz;
  out.fov = pose.fov;
  return out;
}

export class CalvingShot {
  readonly terrain: Terrain;
  readonly glacier: GlacierPlacement;
  readonly motion: CalvingMotion;
  private readonly state = createCalvingState();
  private readonly keysCache = new Map<number, CalvingKeys>();
  private readonly pushed = createCameraPose();
  private readonly end = createCameraPose();
  private readonly oa = createOrbit();
  private readonly ob = createOrbit();

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.glacier = getGlacier(terrain);
    const g = this.glacier;
    this.motion = { slide: g.slide, ledge: g.ledge, endSpeed: g.endSpeed };
  }

  keys(duration: number): CalvingKeys {
    let k = this.keysCache.get(duration);
    if (!k) {
      k = calvingKeys(duration);
      this.keysCache.set(duration, k);
    }
    return k;
  }

  /** Front-shot pose for the chunk embedded at the socket; `push` 0..1 eases toward the push-in. */
  private frontShot(kind: CalvingShotKind, ice: IcebergState, push: number, out: CameraPose): CameraPose {
    const g = this.glacier;
    const spec = CALVING_SHOT[kind];
    const fs = followScale(ice.radius > 0 ? ice.radius : g.radius);
    const k = lerp(1, spec.push, push);
    // The chunk at its socket: spawn point moved back along the slide direction.
    const cx = ice.pos.x - g.fx * g.slide;
    const cz = ice.pos.z - g.fz * g.slide;
    const ground = this.terrain.heightAt(cx, cz);
    // heading θ → (sin θ, cos θ); the camera side is right (+1) or left (−1) of travel.
    const ca = Math.cos(spec.az);
    const sa = Math.sin(spec.az) * g.cameraSide;
    const dx = g.fx * ca + g.rx * sa;
    const dz = g.fz * ca + g.rz * sa;
    const dist = spec.dist * fs * k + 2;
    out.position.x = cx + dx * dist;
    out.position.z = cz + dz * dist;
    out.position.y = ground + (spec.height * fs + 1.2) * lerp(1, 0.95, push);
    // Look at the chunk, a little behind its centre (toward the face and its cracks).
    out.lookAt.x = cx - g.fx * 0.3 * g.radius;
    out.lookAt.z = cz - g.fz * 0.3 * g.radius;
    out.lookAt.y = ground + g.ledge + 0.55 * g.faceHeight;
    out.fov = spec.fov - 2 * push;
    this.clear(out);
    return out;
  }

  /**
   * Keeps the camera above the terrain and the glacier. `fade` 0..1 relaxes the glacier clearance
   * toward the hand-off (the follow pose is already clear of it), so the shot lands without a step.
   */
  private clear(pose: CameraPose, fade = 0): void {
    enforceClearance(this.terrain, pose.position, 0, 0, 0, false);
    const top = glacierTopAt(this.glacier, pose.position.x, pose.position.z);
    const need = top + CALVING_SHOT.glacierClearance * (1 - fade);
    if (pose.position.y < need) pose.position.y = need;
  }

  /** The camera at the start of a calving of this kind (the flyover ends here). */
  startPose(kind: CalvingShotKind, ice: IcebergState, out: CameraPose = createCameraPose()): CameraPose {
    return this.frontShot(kind, ice, 0, out);
  }

  /**
   * Pose `t` seconds into a calving lasting `duration`. Equals followPose(ice) from the hand-off on
   * (t ≥ duration), and the start pose at t = 0.
   */
  pose(
    t: number,
    duration: number,
    kind: CalvingShotKind,
    ice: IcebergState,
    reduceMotion: boolean,
    out: CameraPose,
  ): CameraPose {
    const k = this.keys(duration);
    if (!(t < duration)) return followPose(ice, this.terrain, out);
    if (reduceMotion) {
      return t < k.cutAt ? this.frontShot(kind, ice, 0, out) : followPose(ice, this.terrain, out);
    }
    if (t < k.breakAt) {
      return this.frontShot(kind, ice, smootherstep01(t / k.breakAt) * 0.999, out);
    }
    const g = this.glacier;
    const s = calvingStateAt(k, t, this.motion, this.state);
    const pivotUp = CALVING_SHOT.pivotUp * g.iceHeight;
    const u = (t - k.breakAt) / (duration - k.breakAt);
    const e = smootherstep01(u);
    // Rise first, so the camera is up at the follow height before it swings in over the glacier.
    const eh = smootherstep01(u / CALVING_SHOT.riseBy);
    // Pivot: the chunk without its hop (the camera should not bob), the ledge height easing away.
    const cx = ice.pos.x - g.fx * s.along;
    const cz = ice.pos.z - g.fz * s.along;
    const py = this.terrain.heightAt(cx, cz) + pivotUp + g.ledge * (1 - e);
    // From the push-in pose (relative to the chunk at the break) to the follow pose (relative to the
    // chunk at the hand-off).
    this.frontShot(kind, ice, 0.999, this.pushed);
    const bx = ice.pos.x - g.fx * g.slide;
    const bz = ice.pos.z - g.fz * g.slide;
    orbitOf(this.pushed, bx, this.terrain.heightAt(bx, bz) + pivotUp + g.ledge, bz, this.oa);
    followPose(ice, this.terrain, this.end);
    orbitOf(this.end, ice.pos.x, ice.pos.y + pivotUp, ice.pos.z, this.ob);
    const a = this.oa;
    const b = this.ob;
    const az = a.az + wrapAngle(b.az - a.az) * e;
    const r = lerp(a.r, b.r, e);
    out.position.x = cx + Math.sin(az) * r;
    out.position.z = cz + Math.cos(az) * r;
    // A little higher mid-swing (looking down on the chunk leaving the snout), settling with zero
    // vertical speed onto the follow pose.
    const lift = Math.sin(Math.PI * u);
    out.position.y = py + lerp(a.h, b.h, eh) + CALVING_SHOT.swingLift * g.scale ** 0.5 * lift * lift;
    out.lookAt.x = cx + lerp(a.lx, b.lx, e);
    out.lookAt.y = py + lerp(a.ly, b.ly, e);
    out.lookAt.z = cz + lerp(a.lz, b.lz, e);
    out.fov = lerp(a.fov, b.fov, e);
    if (e < 1) this.clear(out, smoothstep(0.75, 1, e));
    else copyPose(this.end, out);
    return out;
  }
}

const shots = new WeakMap<Terrain, CalvingShot>();

export function getCalvingShot(terrain: Terrain): CalvingShot {
  let s = shots.get(terrain);
  if (!s) {
    s = new CalvingShot(terrain);
    shots.set(terrain, s);
  }
  return s;
}
