import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type Camera, Fog, PerspectiveCamera } from 'three';
import {
  CameraController,
  CAMERA_TUNING,
  type RiverViewInput,
  TapDetector,
  createRay,
  effectiveFov,
  raycastGround,
  screenRay,
} from '../core/camera/camera';
import type { Terrain, Vec3 } from '../core/types';
import { calvingShake } from '../core/glacier/calving';
import { getGlacier } from '../core/glacier/glacier';
import { useGameStore } from '../state/gameStore';
import { registerRiverViewControls } from '../state/riverViewControls';
import { createCalvingClock, readCalving } from './calvingClock';
import { usePrefersReducedMotion } from './reducedMotion';
import { useRuntime } from './RuntimeContext';
import { farthestInPlayArea, playAreaOf } from './Sky';

/** Wheel zoom per pixel of (normalised) wheel delta: one 100 px notch ≈ 16 %. */
const WHEEL_ZOOM = 0.0015;
/** Trackpad pinches arrive as ctrl+wheel with small deltas. */
const WHEEL_ZOOM_PINCH = 0.01;
/** Farthest a pointer ray looks for the ground (m). */
const PICK_DISTANCE = 6000;
/** A touch that ends this soon and moved this little is a tap; two taps = fly to the spot. */
const TAP_MS = 300;
const TAP_SLOP_PX = 10;

/** Up to two tracked pointers: one drags (orbit or pan), two pinch (zoom) and pan together. */
interface PointerSlot {
  id: number;
  x: number;
  y: number;
  downX: number;
  downY: number;
  downT: number;
  touch: boolean;
  /** Mouse: right / middle button or Shift held at press → pan instead of orbit. */
  pan: boolean;
  /** A second pointer joined during this press (so it is not a tap). */
  multi: boolean;
}

const newSlot = (): PointerSlot => ({
  id: -1,
  x: 0,
  y: 0,
  downX: 0,
  downY: 0,
  downT: 0,
  touch: false,
  pan: false,
  multi: false,
});

/**
 * Canvas input → the controller's view-the-river orbit, only while that orbit owns the camera:
 * drag orbits; right-drag, middle-drag or Shift-drag pans; wheel / pinch zoom toward the spot
 * under the pointer; double-click / double-tap flies there. Also registers the commands the UI's
 * keys and buttons use (src/state/riverViewControls). V / Esc stay with the UI.
 */
function useRiverOrbitInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  controller: CameraController,
  terrain: Terrain,
): void {
  useEffect(() => {
    const orbit = controller.orbit;
    const slots: PointerSlot[] = [newSlot(), newSlot()];
    const taps = new TapDetector(320, 30);
    const ray = createRay();
    const hit: Vec3 = { x: 0, y: 0, z: 0 };
    let lastTouch = false;
    const active = (): boolean => controller.riverViewActive;
    const slotOf = (id: number): PointerSlot | undefined =>
      slots[0].id === id ? slots[0] : slots[1].id === id ? slots[1] : undefined;

    /** Ground (or sea) point under a client position on the canvas, or null (sky). */
    const pick = (clientX: number, clientY: number): Vec3 | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
      const pose = controller.pose;
      // The projection actually rendered (CameraRig sets it from the R3F size every frame).
      const persp = camera instanceof PerspectiveCamera;
      const aspect = persp ? camera.aspect : rect.width / rect.height;
      screenRay(pose, persp ? camera.fov : effectiveFov(pose.fov, aspect), aspect, nx, ny, ray);
      return raycastGround(terrain, ray, PICK_DISTANCE, hit) ? hit : null;
    };
    const zoomAtClient = (factor: number, clientX: number, clientY: number): void => {
      const p = pick(clientX, clientY);
      if (p) orbit.zoomAt(factor, p, terrain);
      else orbit.zoomBy(factor);
    };
    /** Drag the ground from one client position to another (pan; the spot follows the pointer). */
    const grabClient = (x0: number, y0: number, x1: number, y1: number): void => {
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const nx = (x: number): number => ((x - r.left) / r.width) * 2 - 1;
      const ny = (y: number): number => 1 - ((y - r.top) / r.height) * 2;
      orbit.grab(nx(x0), ny(y0), nx(x1), ny(y1), r.height, terrain);
    };
    const flyToClient = (clientX: number, clientY: number): void => {
      const p = pick(clientX, clientY);
      if (p) orbit.flyTo(p);
    };
    const centreClient = (): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const idleCursor = (): void => {
      if (slots[0].id < 0 && slots[1].id < 0 && active()) canvas.style.cursor = 'grab';
    };

    const release = (e: PointerEvent): void => {
      const s = slotOf(e.pointerId);
      if (!s) return;
      if (e.type === 'pointerup' && s.touch && !s.multi && active()) {
        const moved = Math.hypot(e.clientX - s.downX, e.clientY - s.downY);
        if (moved <= TAP_SLOP_PX && e.timeStamp - s.downT <= TAP_MS) {
          if (taps.tap(e.timeStamp, e.clientX, e.clientY)) flyToClient(e.clientX, e.clientY);
        } else {
          taps.reset();
        }
      }
      s.id = -1;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      idleCursor();
    };

    const onDown = (e: PointerEvent): void => {
      if (!active()) return;
      const touch = e.pointerType !== 'mouse';
      if (!touch && e.button > 2) return;
      const s = slotOf(-1);
      if (!s) return;
      lastTouch = touch;
      s.id = e.pointerId;
      s.x = s.downX = e.clientX;
      s.y = s.downY = e.clientY;
      s.downT = e.timeStamp;
      s.touch = touch;
      s.pan = !touch && (e.button !== 0 || e.shiftKey);
      s.multi = false;
      if (slots[0].id >= 0 && slots[1].id >= 0) {
        slots[0].multi = slots[1].multi = true;
        taps.reset();
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may already be gone (released before this handler ran); drag without capture.
      }
      canvas.style.cursor = s.pan ? 'move' : 'grabbing';
      e.preventDefault();
    };

    const onMove = (e: PointerEvent): void => {
      const s = slotOf(e.pointerId);
      if (!s) return;
      if (!active()) {
        release(e);
        return;
      }
      const h = canvas.clientHeight;
      const o = s === slots[0] ? slots[1] : slots[0];
      if (o.id >= 0) {
        // Two fingers: the midpoint pans, the spread zooms about the spot under the midpoint.
        const before = Math.hypot(s.x - o.x, s.y - o.y);
        const mx = (s.x + o.x) / 2;
        const my = (s.y + o.y) / 2;
        s.x = e.clientX;
        s.y = e.clientY;
        const after = Math.hypot(s.x - o.x, s.y - o.y);
        const nx = (s.x + o.x) / 2;
        const ny = (s.y + o.y) / 2;
        grabClient(mx, my, nx, ny);
        if (before > 1 && after > 1) zoomAtClient(before / after, nx, ny);
        return;
      }
      const x0 = s.x;
      const y0 = s.y;
      s.x = e.clientX;
      s.y = e.clientY;
      if (s.pan || (!s.touch && e.shiftKey)) grabClient(x0, y0, s.x, s.y);
      else orbit.drag(s.x - x0, s.y - y0, h);
    };

    const onWheel = (e: WheelEvent): void => {
      if (!active()) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = Math.max(-400, Math.min(400, e.deltaY * unit));
      zoomAtClient(Math.exp(dy * (e.ctrlKey ? WHEEL_ZOOM_PINCH : WHEEL_ZOOM)), e.clientX, e.clientY);
    };
    const onDblClick = (e: MouseEvent): void => {
      // Touch double taps are handled in release(); some browsers also emulate a dblclick.
      if (!active() || lastTouch) return;
      e.preventDefault();
      flyToClient(e.clientX, e.clientY);
    };
    const onContextMenu = (e: Event): void => {
      if (active()) e.preventDefault();
    };

    const unregister = registerRiverViewControls({
      reset: () => {
        if (active()) orbit.reset();
      },
      zoom: (factor) => {
        if (!active()) return;
        const c = centreClient();
        zoomAtClient(factor, c.x, c.y);
      },
      rotate: (dAz, dEl) => {
        if (active()) orbit.rotateBy(dAz, dEl);
      },
      pan: (right, forward) => {
        if (!active()) return;
        const h = canvas.clientHeight;
        orbit.pan(-right * h, forward * h, h, terrain);
      },
    });

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      unregister();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', release);
      canvas.removeEventListener('pointercancel', release);
      canvas.removeEventListener('lostpointercapture', release);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.style.cursor = '';
    };
  }, [canvas, camera, controller, terrain]);
}

/**
 * Drives the R3F default camera from CameraController. Must run after the session has stepped in
 * the same frame: it uses useFrame priority 0, so mount it after the component that calls
 * session.update() (equal priorities run in mount order).
 * Honours prefers-reduced-motion: no impact or calving shake, no speed-driven field-of-view pumping,
 * no swing round the calving iceberg (the shot holds, then cuts under the glacier's veil), no
 * auto-rotation in the view-the-river orbit, and the complete / failed shots hold once framed.
 * On LEVEL COMPLETE with useGameStore.viewingRiver set, it orbits the river (see
 * useRiverOrbitInput for the gestures). It is the only writer of the camera.
 */
/** Normal near / far clip planes (m); the river view extends the far plane to frame long rivers. */
const CAMERA_NEAR = 0.3;
const CAMERA_FAR = 4000;
/**
 * In the river view the near plane moves out with the orbit distance (it never comes within this
 * fraction of it, up to RIVER_NEAR_MAX m): with the far plane kilometres out, depth precision then
 * still separates the distant coast from the sea.
 */
const RIVER_NEAR_PER_DISTANCE = 0.015;
const RIVER_NEAR_MAX = 20;

export function CameraRig(): null {
  const rt = useRuntime();
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const controller = useMemo(() => new CameraController(), [rt]);
  const reduceMotion = usePrefersReducedMotion();
  const view = useRef<RiverViewInput>({ viewingRiver: false, river: rt.river.samples, aspect: 16 / 9 });
  const wasOrbiting = useRef(false);
  const glacier = useMemo(() => getGlacier(rt.terrain), [rt]);
  const calving = useRef(createCalvingClock());
  useRiverOrbitInput(canvas, camera, controller, rt.terrain);

  useEffect(() => {
    camera.near = CAMERA_NEAR;
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }, [camera]);
  const playArea = useMemo(() => playAreaOf(rt.terrain.course), [rt]);

  useFrame((state, delta) => {
    const aspect = state.size.width / Math.max(1, state.size.height);
    const v = view.current;
    v.viewingRiver = useGameStore.getState().viewingRiver;
    v.river = rt.river.samples;
    v.aspect = aspect;
    v.autoRotate = !reduceMotion;
    controller.reduceMotion = reduceMotion;
    controller.introTimeline = rt.introTimeline;
    const ice = rt.iceberg;
    const pose = controller.update(delta, rt.phase, rt.phaseTime, rt.introProgress, ice, rt.terrain, v);

    // touch-action is 'none' on the game canvas in every phase (styles.css), not just this orbit.
    const orbiting = controller.riverViewActive;
    // Framing a long river puts the camera kilometres out: draw at least to the far end of the play
    // area and to where the river-view fog (Sky) is thick, so the world around the level fades into
    // the haze instead of being clipped; back to the normal range otherwise.
    const fog = state.scene.fog;
    const fogFar = fog instanceof Fog ? fog.far : 0;
    const far = orbiting
      ? Math.max(CAMERA_FAR, farthestInPlayArea(camera.position, playArea) + 1500, fogFar + 200)
      : CAMERA_FAR;
    const p0 = controller.pose;
    const orbitDistance = Math.hypot(
      p0.position.x - p0.lookAt.x,
      p0.position.y - p0.lookAt.y,
      p0.position.z - p0.lookAt.z,
    );
    const near = orbiting
      ? Math.min(RIVER_NEAR_MAX, Math.max(CAMERA_NEAR, RIVER_NEAR_PER_DISTANCE * orbitDistance))
      : CAMERA_NEAR;
    if (Math.abs(camera.far - far) > 50 || Math.abs(camera.near - near) > 0.1 * near) {
      camera.far = far;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    if (orbiting !== wasOrbiting.current) {
      wasOrbiting.current = orbiting;
      canvas.style.cursor = orbiting ? 'grab' : '';
    }

    const p = pose.position;
    const l = pose.lookAt;
    // Small deterministic shake from iceberg impacts and the calving break / landing (render-only,
    // never fed back into the pose).
    const impact = rt.phase === 'playing' && !reduceMotion ? Math.min(1, ice.impact) : 0;
    const c = rt.phase === 'intro' && !reduceMotion ? readCalving(rt, glacier, calving.current) : null;
    const calvingAmp = c && c.active ? calvingShake(c.keys, c.t) : 0;
    const t = rt.time;
    const amp = impact * impact * 0.35 + calvingAmp;
    const sx = amp * Math.sin(t * 47.3) * Math.cos(t * 13.1);
    const sy = amp * Math.sin(t * 39.7 + 1.3);
    camera.position.set(p.x + sx, p.y + sy, p.z);
    camera.lookAt(l.x, l.y + sy * 0.5, l.z);

    if (camera instanceof PerspectiveCamera) {
      const base = reduceMotion && rt.phase === 'playing' ? CAMERA_TUNING.fovBase : pose.fov;
      const fov = effectiveFov(base, aspect);
      if (Math.abs(camera.fov - fov) > 1e-3) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}
