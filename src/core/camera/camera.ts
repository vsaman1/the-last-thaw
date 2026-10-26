import type { GamePhase, IcebergState, Terrain } from '../types';
import { clamp01, damp, dirToHeading, lerp, wrapAngle } from '../math';
import { type IntroTimeline, introTimeline } from '../intro';
import {
  CAMERA_TUNING,
  type CameraPose,
  computeFollowTarget,
  copyPose,
  createCameraPose,
  enforceClearance,
  followHeading,
  followScale,
  measureDrop,
} from './follow';
import { introCameraPose, outroShot } from './cinematics';
import { type FitPoint, RIVER_VIEW, RiverOrbit } from './riverView';

export {
  CAMERA_TUNING,
  type CameraPose,
  computeFollowTarget,
  copyPose,
  createCameraPose,
  enforceClearance,
  followHeading,
  followPose,
  followScale,
  groundAt,
  isFinitePose,
  measureDrop,
} from './follow';
export {
  type AerialShotSpec,
  type RouteInfo,
  IntroPath,
  aerialShot,
  getIntroPath,
  introCameraPose,
  introPose,
  outroShot,
  routeInfo,
} from './cinematics';
export { CALVING_SHOT, CalvingShot, getCalvingShot } from './calvingShot';
export {
  type FitPoint,
  type RiverBounds,
  RIVER_VIEW,
  RiverOrbit,
  effectiveFov,
  fitOrbitDistance,
  orbitMinElevation,
  riverBounds,
} from './riverView';
export { type Ray, TapDetector, createRay, raycastGround, screenRay } from './pick';

/** Per-frame input for the LEVEL COMPLETE "view the river" orbit. */
export interface RiverViewInput {
  /** useGameStore.viewingRiver; honoured only during phase 'complete'. */
  viewingRiver: boolean;
  /** What to frame: the river trail samples. */
  river: readonly FitPoint[];
  /** Canvas width / height (the fit accounts for the portrait fov widening). */
  aspect: number;
  /** Slow orbit while the pointer is idle (default true; off for prefers-reduced-motion). */
  autoRotate?: boolean;
}

const T = CAMERA_TUNING;

const smootherstep01 = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Orbit parameters of a camera pose around a pivot, used to animate outro / failed shots. */
interface Orbit {
  az: number;
  r: number;
  h: number;
  /** Look point relative to the pivot. */
  lx: number;
  ly: number;
  lz: number;
  fov: number;
}

const createOrbit = (): Orbit => ({ az: 0, r: 0, h: 0, lx: 0, ly: 0, lz: 0, fov: 55 });

function blendPose(a: CameraPose, b: CameraPose, k: number, out: CameraPose): CameraPose {
  out.position.x = lerp(a.position.x, b.position.x, k);
  out.position.y = lerp(a.position.y, b.position.y, k);
  out.position.z = lerp(a.position.z, b.position.z, k);
  out.lookAt.x = lerp(a.lookAt.x, b.lookAt.x, k);
  out.lookAt.y = lerp(a.lookAt.y, b.lookAt.y, k);
  out.lookAt.z = lerp(a.lookAt.z, b.lookAt.z, k);
  out.fov = lerp(a.fov, b.fov, k);
  return out;
}

function orbitFromPose(pose: CameraPose, px: number, py: number, pz: number, out: Orbit): Orbit {
  const dx = pose.position.x - px;
  const dz = pose.position.z - pz;
  out.az = dirToHeading(dx, dz);
  out.r = Math.hypot(dx, dz);
  out.h = pose.position.y - py;
  out.lx = pose.lookAt.x - px;
  out.ly = pose.lookAt.y - py;
  out.lz = pose.lookAt.z - pz;
  out.fov = pose.fov;
  return out;
}

/**
 * Stateful camera director. Call update() once per rendered frame with the live runtime fields;
 * it returns a smoothed pose (the same object every call — copy it if you need to keep it).
 *
 * - intro: the fly-through from cinematics.ts, then the calving shot (calvingShot.ts), driven by
 *   introProgress over `introTimeline` (set it from the runtime; default: the full intro). When the
 *   timeline changes mid-intro (Space during the flyover starts the short calving) it blends over.
 * - playing: follow pose with frame-rate independent damping (separate lateral/vertical rates)
 *   and a rate-limited direction, plus a short blend when the intro was skipped.
 * - paused: holds the last pose.
 * - complete: spirals back and up to a wide shot from out at sea, then drifts slowly.
 * - failed: slow orbit around the iceberg from slightly higher.
 * - reduceMotion (prefers-reduced-motion): the complete / failed shots still ease into their framing
 *   but then hold still: no endless drift or orbit.
 * - complete + view.viewingRiver: blends (RIVER_VIEW.blend s) into an orbit around the whole river
 *   driven by `orbit` (the renderer forwards drag / zoom / pan / fly-to input to it), and back to
 *   the outro.
 */
export class CameraController {
  /** The pose returned by update(). */
  readonly pose: CameraPose = createCameraPose();
  /** Smoothed follow state (separate from `pose` so skip-intro blending has a clean target). */
  private readonly follow = createCameraPose();
  private readonly target = createCameraPose();
  private readonly from = createCameraPose();
  private readonly outroEnd = createCameraPose();
  private readonly orbitStart = createOrbit();
  private readonly orbitEnd = createOrbit();
  /** View-the-river orbit; feed pointer input here while riverViewActive. */
  readonly orbit = new RiverOrbit();
  /**
   * prefers-reduced-motion: no outro drift and no orbit after failing (the shots hold once framed).
   * May change at any time; the failed orbit then stops or resumes from where it is, without a jump.
   */
  reduceMotion = false;
  /** The runtime's intro timeline (GameRuntime.introTimeline); introProgress runs over its total. */
  introTimeline: IntroTimeline = introTimeline('full');
  private lastTimeline: IntroTimeline | null = null;
  private readonly introFrom = createCameraPose();
  private readonly introTarget = createCameraPose();
  private introBlendT = 0;
  private introBlendDur = 0;
  private readonly orbitPose = createCameraPose();
  /** The pose returned by the previous update (blend source when entering/leaving the river view). */
  private readonly shown = createCameraPose();
  private readonly riverFrom = createCameraPose();
  private readonly fallbackPoint = { x: 0, y: 0, z: 0, width: 40 };
  private readonly fallbackRiver: FitPoint[] = [this.fallbackPoint];
  private riverActive = false;
  private riverLeaving = false;
  private riverT = 0;
  private hasShown = false;
  private sizeScale = 1;

  private terrain: Terrain | null = null;
  private lastPhase: GamePhase | null = null;
  private initialized = false;
  private followReady = false;
  private dirYaw = 0;
  private drop = 0;
  private blendT = 0;
  private blendDur = 0;
  private outroDelta = 0;
  /** Failed shot: orbit time so far (phase time spent with motion allowed) and the last phase time. */
  private failSpinT = 0;
  private failLastT = 0;

  /** Forget all smoothing state (next update snaps). */
  reset(): void {
    this.terrain = null;
    this.lastPhase = null;
    this.lastTimeline = null;
    this.introBlendT = 0;
    this.introBlendDur = 0;
    this.initialized = false;
    this.followReady = false;
    this.blendT = 0;
    this.blendDur = 0;
    this.riverActive = false;
    this.riverLeaving = false;
    this.hasShown = false;
  }

  /** True while the view-the-river orbit owns the camera (pointer input should go to `orbit`). */
  get riverViewActive(): boolean {
    return this.riverActive;
  }

  update(
    dt: number,
    phase: GamePhase,
    phaseTime: number,
    introProgress: number,
    iceberg: IcebergState,
    terrain: Terrain,
    view?: RiverViewInput,
  ): CameraPose {
    if (terrain !== this.terrain) {
      this.reset();
      this.terrain = terrain;
    }
    dt = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
    if (phase !== this.lastPhase) this.enterPhase(this.lastPhase, phase, introProgress, iceberg, terrain);
    this.lastPhase = phase;

    switch (phase) {
      case 'loading':
        introCameraPose(this.introTimeline, 0, terrain, iceberg, this.reduceMotion, this.pose);
        this.lastTimeline = this.introTimeline;
        break;
      case 'intro':
        this.updateIntro(dt, introProgress, iceberg, terrain);
        break;
      case 'paused':
        if (!this.initialized) this.updateFollow(0, iceberg, terrain);
        break;
      case 'playing':
        this.updateFollow(dt, iceberg, terrain);
        break;
      case 'complete':
        this.updateOutro(phaseTime, iceberg, terrain);
        break;
      case 'failed':
        this.updateFailed(phaseTime, iceberg, terrain);
        break;
    }
    this.initialized = true;
    this.updateRiverView(dt, phase, iceberg, terrain, view);
    copyPose(this.pose, this.shown);
    this.hasShown = true;
    return this.pose;
  }

  /** Overrides the phase pose with the river orbit (or a blend into / out of it). */
  private updateRiverView(
    dt: number,
    phase: GamePhase,
    ice: IcebergState,
    terrain: Terrain,
    view: RiverViewInput | undefined,
  ): void {
    const want = phase === 'complete' && view !== undefined && view.viewingRiver;
    if (want !== this.riverActive) {
      copyPose(this.hasShown ? this.shown : this.pose, this.riverFrom);
      this.riverT = 0;
      this.riverActive = want;
      this.riverLeaving = !want && phase === 'complete';
      if (want && view) this.orbit.begin(this.framed(view, ice), this.riverFrom, view.aspect);
    }
    if (this.riverActive && view) {
      const pts = this.framed(view, ice);
      this.orbit.sync(pts, view.aspect, dt);
      this.orbit.update(dt, view.autoRotate ?? true, terrain, this.orbitPose);
      this.riverT += dt;
      blendPose(this.riverFrom, this.orbitPose, smootherstep01(this.riverT / RIVER_VIEW.blend), this.pose);
    } else if (this.riverLeaving) {
      this.riverT += dt;
      if (phase !== 'complete' || this.riverT >= RIVER_VIEW.blend) {
        this.riverLeaving = false;
        return;
      }
      blendPose(this.riverFrom, this.pose, smootherstep01(this.riverT / RIVER_VIEW.blend), this.pose);
    } else {
      return;
    }
    enforceClearance(terrain, this.pose.position, 0, 0, 0, false);
  }

  /** The river samples, or the iceberg alone while there is no river yet. */
  private framed(view: RiverViewInput, ice: IcebergState): readonly FitPoint[] {
    if (view.river.length > 0) return view.river;
    this.fallbackPoint.x = ice.pos.x;
    this.fallbackPoint.y = ice.pos.y;
    this.fallbackPoint.z = ice.pos.z;
    return this.fallbackRiver;
  }

  private enterPhase(
    prev: GamePhase | null,
    next: GamePhase,
    introProgress: number,
    ice: IcebergState,
    terrain: Terrain,
  ): void {
    const p = ice.pos;
    if (next === 'playing') {
      if (prev === 'paused') return;
      this.followReady = false;
      this.blendT = 0;
      // A skipped intro leaves introProgress < 1; a completed one lands exactly on the follow pose.
      const skipped = prev === 'intro' && introProgress < 0.999 && this.initialized;
      this.blendDur = skipped ? T.skipBlend : 0;
      if (skipped) copyPose(this.pose, this.from);
    } else if (next === 'complete') {
      if (!this.initialized) this.updateFollow(0, ice, terrain);
      orbitFromPose(this.pose, p.x, p.y, p.z, this.orbitStart);
      outroShot(terrain, this.outroEnd);
      const e = this.outroEnd;
      orbitFromPose(e, e.lookAt.x, e.lookAt.y, e.lookAt.z, this.orbitEnd);
      this.outroDelta = wrapAngle(this.orbitEnd.az - this.orbitStart.az);
    } else if (next === 'failed') {
      if (!this.initialized) this.updateFollow(0, ice, terrain);
      orbitFromPose(this.pose, p.x, p.y, p.z, this.orbitStart);
      this.failSpinT = 0;
      this.failLastT = 0;
    }
  }

  /**
   * Intro pose at introProgress over the timeline. A timeline switch mid-intro (the flyover skipped
   * into the short calving) blends from the pose on screen into the new shot.
   */
  private updateIntro(dt: number, introProgress: number, ice: IcebergState, terrain: Terrain): void {
    const tl = this.introTimeline;
    if (tl !== this.lastTimeline) {
      if (this.lastTimeline !== null && this.initialized) {
        copyPose(this.pose, this.introFrom);
        this.introBlendT = 0;
        this.introBlendDur = T.introSwitchBlend;
      }
      this.lastTimeline = tl;
    }
    const t = clamp01(introProgress) * tl.total;
    if (this.introBlendT < this.introBlendDur) {
      this.introBlendT += dt;
      introCameraPose(tl, t, terrain, ice, this.reduceMotion, this.introTarget);
      const k = this.reduceMotion ? 1 : smootherstep01(this.introBlendT / this.introBlendDur);
      blendPose(this.introFrom, this.introTarget, k, this.pose);
      enforceClearance(terrain, this.pose.position, 0, 0, 0, false);
    } else {
      introCameraPose(tl, t, terrain, ice, this.reduceMotion, this.pose);
    }
  }

  private updateFollow(dt: number, ice: IcebergState, terrain: Terrain): void {
    const p = ice.pos;
    const yaw = followHeading(ice);
    const speed = Math.hypot(ice.vel.x, ice.vel.z);
    const f = this.follow;
    const scale = followScale(ice.radius);
    if (!this.followReady) {
      this.dirYaw = yaw;
      this.sizeScale = scale;
      this.drop = measureDrop(ice, Math.sin(yaw), Math.cos(yaw), terrain);
      computeFollowTarget(p.x, p.y, p.z, Math.sin(yaw), Math.cos(yaw), speed, this.drop, terrain, f, scale);
      this.followReady = true;
    } else {
      this.sizeScale = damp(this.sizeScale, scale, T.sizeRate, dt);
      let delta = wrapAngle(yaw - this.dirYaw) * (1 - Math.exp(-T.dirRate * dt));
      const maxDelta = T.maxDirRate * dt;
      if (delta > maxDelta) delta = maxDelta;
      else if (delta < -maxDelta) delta = -maxDelta;
      this.dirYaw = wrapAngle(this.dirYaw + delta);
      // heading θ → (sin θ, cos θ)
      const dx = Math.sin(this.dirYaw);
      const dz = Math.cos(this.dirYaw);
      this.drop = damp(this.drop, measureDrop(ice, dx, dz, terrain), T.dropRate, dt);
      const sc = this.sizeScale;
      const t = computeFollowTarget(p.x, p.y, p.z, dx, dz, speed, this.drop, terrain, this.target, sc);
      const kh = 1 - Math.exp(-T.posRateLateral * dt);
      const kv = 1 - Math.exp(-T.posRateVertical * dt);
      const kl = 1 - Math.exp(-T.lookRate * dt);
      f.position.x += (t.position.x - f.position.x) * kh;
      f.position.z += (t.position.z - f.position.z) * kh;
      f.position.y += (t.position.y - f.position.y) * kv;
      f.lookAt.x += (t.lookAt.x - f.lookAt.x) * kl;
      f.lookAt.y += (t.lookAt.y - f.lookAt.y) * kl;
      f.lookAt.z += (t.lookAt.z - f.lookAt.z) * kl;
      f.fov = damp(f.fov, t.fov, T.fovRate, dt);
      enforceClearance(terrain, f.position, p.x, p.y + T.lineTargetUp * sc, p.z);
    }

    if (this.blendT < this.blendDur) {
      this.blendT += dt;
      blendPose(this.from, f, smootherstep01(this.blendT / this.blendDur), this.pose);
      enforceClearance(terrain, this.pose.position, 0, 0, 0, false);
    } else {
      copyPose(f, this.pose);
    }
  }

  private updateOutro(phaseTime: number, ice: IcebergState, terrain: Terrain): void {
    const s = this.orbitStart;
    const e = this.orbitEnd;
    const end = this.outroEnd;
    const k = smootherstep01(phaseTime / T.outroDuration);
    const p = ice.pos;
    const pivX = lerp(p.x, end.lookAt.x, k);
    const pivY = lerp(p.y, end.lookAt.y, k);
    const pivZ = lerp(p.z, end.lookAt.z, k);
    const drift = this.reduceMotion ? 0 : T.outroDrift * phaseTime * k;
    const az = s.az + this.outroDelta * k + drift;
    const r = lerp(s.r, e.r, k);
    const o = this.pose;
    // heading θ → (sin θ, cos θ)
    o.position.x = pivX + Math.sin(az) * r;
    o.position.z = pivZ + Math.cos(az) * r;
    o.position.y = pivY + lerp(s.h, e.h, k);
    o.lookAt.x = lerp(p.x + s.lx, end.lookAt.x, k);
    o.lookAt.y = lerp(p.y + s.ly, end.lookAt.y, k);
    o.lookAt.z = lerp(p.z + s.lz, end.lookAt.z, k);
    o.fov = lerp(s.fov, e.fov, k);
    enforceClearance(terrain, o.position, 0, 0, 0, false);
  }

  private updateFailed(phaseTime: number, ice: IcebergState, terrain: Terrain): void {
    const s = this.orbitStart;
    const p = ice.pos;
    const k = 1 - Math.exp(-1.5 * phaseTime);
    // The orbit clock only runs while motion is allowed, so toggling reduceMotion never jumps.
    const step = phaseTime - this.failLastT;
    this.failLastT = phaseTime;
    if (!this.reduceMotion && step > 0) this.failSpinT += step;
    const t = this.failSpinT;
    // Orbit angle ramps in from zero angular velocity so the hand-off is smooth.
    const az = s.az + T.failOrbitRate * (t - (1 - Math.exp(-2 * t)) / 2);
    const r = lerp(s.r, T.failRadius, k);
    const o = this.pose;
    o.position.x = p.x + Math.sin(az) * r;
    o.position.z = p.z + Math.cos(az) * r;
    o.position.y = p.y + lerp(s.h, T.failHeight, k);
    o.lookAt.x = p.x + s.lx * (1 - k);
    o.lookAt.y = p.y + lerp(s.ly, 1, k);
    o.lookAt.z = p.z + s.lz * (1 - k);
    o.fov = lerp(s.fov, 52, k);
    enforceClearance(terrain, o.position, p.x, p.y + T.lineTargetUp, p.z);
  }
}
