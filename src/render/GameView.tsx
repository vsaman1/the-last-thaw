import { Component, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { addAfterEffect, addEffect, Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectComposer as EffectComposerImpl } from 'postprocessing';
import { GameSession } from '../core/session';
import { getLevel } from '../core/levels';
import { getRunLog, getSnapshot } from '../core/api';
import { autopilotSteer } from '../core/autopilot';
import type { GamePhase, LevelDef, RoutePoint, SteeringInput } from '../core/types';
import { createSteeringInput } from '../input/input';
import { gameController, registerSession, type SessionControls } from '../game/controller';
import { effectiveQuality, useAppStore, type RenderQuality } from '../state/appStore';
import { emptyHud, useGameStore, type IceFlash } from '../state/gameStore';
import { RuntimeContext } from './RuntimeContext';
import { AUTO_QUALITY_WINDOW, nextAutoQuality } from './autoQuality';
import { Sky } from './Sky';
import { Lighting } from './Lighting';
import { TerrainMesh } from './TerrainMesh';
import { Scenery } from './Scenery';
import { River } from './River';
import { Streams } from './Streams';
import { Ocean } from './Ocean';
import { Obstacles } from './Obstacles';
import { Iceberg } from './Iceberg';
import { Glacier } from './Glacier';
import { Particles } from './Particles';
import { Plumes } from './Plumes';
import { CameraRig } from './CameraRig';
import { GameAudio } from './GameAudio';
import { PhysicsWorld } from '../core/physics/world';
import { Effects } from './Effects';
import { FinishMarker } from './FinishMarker';
import { useWorldCondition, WorldConditionContext } from './worldCondition';
import type { WorldCondition } from '../story/environment';

export interface GameViewProps {
  levelId: string;
  attempt: number;
  /** Story Mode: play a chapter's level and let the story layer watch each session. */
  story?: StoryViewHooks;
}

/**
 * What Story Mode hands the view (src/ui/story/storyRun.ts). The story level is the base level plus
 * the chapter's overlay (src/story/storyLevel.ts), so it is passed in rather than looked up by id;
 * attach() gets every new session (to time events, count story points and build the run's evidence
 * when it ends) and returns its cleanup. A story run is not an arcade run: it is never written to
 * arcade progress (best times / scores).
 */
export interface StoryViewHooks {
  level: LevelDef;
  attach: (session: GameSession) => () => void;
  /**
   * The chapter's world condition (src/story/environment.ts): colours, fog and tints only, read by
   * the scene components through WorldConditionContext. Null or absent = the level as in Arcade.
   */
  world?: WorldCondition | null;
}

const HUD_INTERVAL = 0.1;
/** Speed (m/s) that fills the momentum gauge. */
const CRUISE_SPEED = 22;
/** Rendered frames to wait (behind the loading overlay) before and after compiling shaders. */
const WARMUP_FRAMES = 2;

/** Debug/automation hook: lets scripted tests (and later, agents) observe and steer a run. */
interface DebugHook {
  snapshot: () => ReturnType<typeof getSnapshot>;
  runLog: () => ReturnType<typeof getRunLog>;
  /** Force a steer value (-1..1), or null to return control to the player. */
  setSteer: (steer: number | null) => void;
  /** Let the built-in autopilot drive (lane = lateral offset in metres). */
  autopilot: (on: boolean, lane?: number) => void;
  /** Run the simulation forward `seconds` of game time immediately, using the current steering mode. */
  fastForward: (seconds: number) => ReturnType<typeof getSnapshot>;
  /**
   * Draw calls / triangles of the last complete frame (all passes, incl. post-processing), resources
   * alive, and what produced them: the tier in effect (a step 'auto' queued for the next loading
   * screen shows as pendingAutoQuality), whether the composer is mounted and shadows are on. Counts
   * differ by tier: 'high' adds the composer's render targets and lookup textures.
   */
  renderStats: () => {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    quality: RenderQuality;
    pendingAutoQuality: RenderQuality | null;
    postProcessing: boolean;
    shadows: boolean;
  };
  /**
   * Time `frames` synchronous scene renders (GPU-flushed, no post-processing). Independent of
   * requestAnimationFrame throttling, so it measures real render cost even in a background tab.
   */
  benchmark: (frames?: number) => { msPerFrame: number; fpsEquivalent: number };
  /** Instanced meshes and their live instance counts, plus totals — for checking what is drawn. */
  sceneSummary: () => { meshes: number; instanced: { name: string; count: number; visible: boolean }[] };
  /**
   * Road traffic: vehicles driving (and moving faster than 0.5 m/s), traffic lights and the signal
   * state of every phase of every signalised junction.
   */
  traffic: () => {
    driving: number;
    moving: number;
    lights: number;
    junctions: { x: number; z: number; signals: string[] }[];
  } | null;
  /** Story Mode's world condition on screen (src/story/environment.ts), or null (Arcade, ?world=off). */
  world: () => WorldCondition | null;
  /** Raw R3F state (scene, camera, renderer) for debugging in the console. */
  three: () => RootState;
}

declare global {
  interface Window {
    __iceberg?: DebugHook;
  }
}

/** Completions already written to saved progress (guards against any remount re-recording). */
const recorded = new WeakSet<GameSession>();
/** Sessions playing a Story Mode chapter (their completions stay out of arcade progress). */
const storySessions = new WeakSet<GameSession>();

/**
 * Last chip / absorb flash id issued. Ids grow for the page's lifetime, so a new attempt's flashes
 * never repeat the previous attempt's ids (the overlay announces only ids it has not seen).
 */
let flashSeq = 0;

/** Best guess at why a run failed, from the sampled route (see GameState.failHint). */
function failHintFor(route: readonly RoutePoint[]): 'heldTurn' | 'obstacle' | null {
  if (route.length < 4) return null;
  const end = route[route.length - 1].t;
  const recent = route.filter((p) => p.t >= end - 4);
  const meanSteer = recent.reduce((a, p) => a + Math.abs(p.steer), 0) / recent.length;
  if (meanSteer > 0.7) return 'heldTurn';
  // A sudden loss of more than half the speed within half a second = a heavy hit.
  for (let i = route.length - 1; i > 0 && route[i].t >= end - 6; i--) {
    const before = route.find((p) => p.t >= route[i].t - 0.5) ?? route[i - 1];
    if (before.speed > 4 && route[i].speed < before.speed * 0.5) return 'obstacle';
  }
  return null;
}

function syncPhase(phase: GamePhase, session: GameSession): void {
  const ended = phase === 'complete' || phase === 'failed';
  const result = ended ? { ...session.stats } : null;
  useGameStore.setState({
    phase,
    introProgress: session.introProgress,
    introStage: session.introStage,
    result,
    failReason: phase === 'failed' ? session.failReason : null,
    failHint: phase === 'failed' ? failHintFor(session.route) : null,
  });
  if (phase === 'complete' && result && !recorded.has(session) && !storySessions.has(session)) {
    recorded.add(session);
    useAppStore.getState().recordCompletion(result);
  }
}

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/** A failure of the running 3D view; its message is shown as-is in the error dialog. */
class RenderFailure extends Error {}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Raises a RenderFailure from outside React's render (a useFrame callback, a timer) into the error
 * boundary around the Canvas: the failure is stored, and the calling component's next render throws.
 */
function useFailure(): (failure: RenderFailure) => void {
  const [failure, setFailure] = useState<RenderFailure | null>(null);
  if (failure) throw failure;
  return setFailure;
}

/**
 * Turns a render/WebGL failure into the loading overlay's error panel instead of a blank page. A new
 * attempt (Try Again) clears the failure, so the canvas gets another chance instead of staying empty.
 */
class CanvasErrorBoundary extends Component<{ children: ReactNode; resetKey: number }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey: number }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  componentDidCatch(error: unknown): void {
    const loadError =
      error instanceof RenderFailure ? error.message : `The 3D view could not start: ${errorText(error)}`;
    useGameStore.setState({ phase: 'loading', loadError, contextLost: false });
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** How long (visible) a lost WebGL context may take to come back before the error dialog shows. */
const CONTEXT_RESTORE_MS = 5000;

/**
 * Canvas-lifetime housekeeping: count draw calls over whole frames, release three's shared DFG lookup
 * texture on unmount (it keeps a dispose listener that would otherwise retain this renderer and its
 * detached canvas), and turn failures that bypass React into the error dialog (Try Again remounts the
 * Canvas):
 * - An exception in a useFrame callback or the render: R3F runs them without try/catch, so the view
 *   would freeze while the sim and HUD carry on. Mounted first, this is the first frame callback, so
 *   it sees when the previous frame never reached its after-effects.
 * - A lost WebGL context: pause (Resume waits, see gameController) until the browser restores it, or
 *   give up after CONTEXT_RESTORE_MS.
 */
function CanvasGuards() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const lut = useRef<THREE.Texture | null>(null);
  const fail = useFailure();
  /** Set by the frame's first callback (this one), cleared by its after-effect. */
  const frameOpen = useRef(false);
  const failed = useRef(false);
  /** The last uncaught error on the page: where an exception thrown in a frame callback lands. */
  const lastError = useRef<unknown>(null);

  useEffect(() => {
    let restoreTimer = 0;
    const waitForRestore = (): void => {
      restoreTimer = window.setTimeout(() => {
        // A background tab may only get its context back once it is shown: count visible time only.
        if (document.visibilityState === 'hidden') return waitForRestore();
        fail(
          new RenderFailure(
            'The 3D view lost its graphics context (the GPU was reset or ran out of memory) and the ' +
              'browser did not restore it.',
          ),
        );
      }, CONTEXT_RESTORE_MS);
    };
    const onLost = (e: Event): void => {
      e.preventDefault(); // allows the browser to restore the context
      gameController.pause();
      useGameStore.setState({ contextLost: true });
      window.clearTimeout(restoreTimer);
      waitForRestore();
    };
    const onRestored = (): void => {
      // three rebuilds its GL state and re-uploads lazily; draw a frame even if the loop is idle.
      window.clearTimeout(restoreTimer);
      useGameStore.setState({ contextLost: false });
      invalidate();
    };
    const onError = (e: ErrorEvent): void => {
      lastError.current = e.error ?? e.message;
    };
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    window.addEventListener('error', onError);
    gl.info.autoReset = false;
    const offReset = addEffect(() => gl.info.reset());
    const offAfter = addAfterEffect(() => {
      frameOpen.current = false;
    });
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      window.removeEventListener('error', onError);
      window.clearTimeout(restoreTimer);
      useGameStore.setState({ contextLost: false });
      offReset();
      offAfter();
      lut.current?.dispose();
    };
  }, [gl, invalidate, fail]);

  useFrame(() => {
    if (frameOpen.current && !failed.current) {
      failed.current = true;
      const e = lastError.current;
      fail(new RenderFailure(`The 3D view stopped: ${e ? errorText(e) : 'a frame update failed'}`));
    }
    frameOpen.current = true;
    if (lut.current) return;
    scene.traverse((o) => {
      if (lut.current || !(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      const props = gl.properties.get(o.material) as { uniforms?: { dfgLUT?: { value?: unknown } } };
      const value = props.uniforms?.dfgLUT?.value;
      if (value instanceof THREE.Texture) lut.current = value;
    });
  });

  return null;
}

/**
 * Measures frame times while the intro or gameplay is on screen and, when quality is 'auto', finds
 * the tier to step down to if the machine cannot hold its display's pace (bloom costs ~2/3 of GPU
 * time on integrated graphics). The step is queued, not applied: unmounting post-processing or
 * toggling shadows mid-run relinks every shader synchronously (the freeze the loading warm-up exists
 * to prevent), so GameView applies it at the next loading screen, behind the overlay.
 */
function AutoQuality({ current }: { current: RenderQuality }) {
  const samples = useRef<number[]>([]);
  useEffect(() => {
    samples.current = [];
  }, [current]);
  useFrame((_, delta) => {
    const app = useAppStore.getState();
    if (app.settings.quality !== 'auto' || app.pendingAutoQuality !== null) return;
    const phase = useGameStore.getState().phase;
    if (phase !== 'intro' && phase !== 'playing') return;
    const s = samples.current;
    s.push(delta * 1000);
    if (s.length < AUTO_QUALITY_WINDOW) return;
    const next = nextAutoQuality(current, s);
    samples.current = [];
    if (next) app.queueAutoQuality(next);
  });
  return null;
}

/**
 * gl.compileAsync against the render target the scene is really drawn into. Program variants depend
 * on the target (output colour space; tone mapping): with post-processing the scene is drawn into the
 * composer's input buffer, so compiling against the screen would build sRGB variants nothing uses and
 * leave the real ones to compile on the first visible frames. Only the synchronous part (creating the
 * programs) reads the target, so it is bound just around that call.
 */
function compileFor(
  gl: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget | null,
): Promise<unknown> {
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  try {
    return gl.compileAsync(scene, camera);
  } finally {
    gl.setRenderTarget(previous);
  }
}

interface GameLoopProps {
  session: GameSession;
  /** The post-processing composer while it is mounted ('high' quality), else null. */
  composer: RefObject<EffectComposerImpl | null>;
}

function GameLoop({ session, composer }: GameLoopProps) {
  const gl = useThree((s) => s.gl);
  const worldNow = useWorldCondition();
  const world = useRef(worldNow);
  world.current = worldNow;
  const getThree = useThree((s) => s.get);
  const inputRef = useRef<ReturnType<typeof createSteeringInput> | null>(null);
  const override = useRef<{ steer: number | null; autopilot: boolean; lane: number }>({
    steer: null,
    autopilot: false,
    lane: 0,
  });
  const hudTimer = useRef(0);
  /** Latest chip and absorb, shown by the HUD as brief "−8 % ice" / "+12 t ice" flashes. */
  const chipFlash = useRef<IceFlash | undefined>(undefined);
  const absorbFlash = useRef<IceFlash | undefined>(undefined);
  /** Last flash id handed to the HUD; flashes issued after it are still pending. */
  const flashShown = useRef(flashSeq);
  /** False until shaders are compiled behind the loading overlay; the sim waits for it. */
  const warm = useRef(false);
  const frameWaiters = useRef<{ frames: number; resolve: () => void }[]>([]);

  function currentInput(delta: number): SteeringInput {
    const o = override.current;
    if (o.autopilot) return autopilotSteer(session.iceberg, session.terrain, { lane: o.lane });
    if (o.steer !== null) return { steer: o.steer, source: 'scripted' };
    return inputRef.current?.read(delta) ?? { steer: 0, source: 'none' };
  }

  useEffect(() => {
    let cancelled = false;
    const input = createSteeringInput(gl.domElement, () => useAppStore.getState().settings);
    inputRef.current = input;
    // Chips (or absorbs: several blocks of a field merge in one step) before the next HUD tick add up
    // instead of the later one hiding the earlier; a chip and an absorb are kept apart so both show.
    const addFlash = (prev: IceFlash | undefined, kind: IceFlash['kind'], amount: number): IceFlash => {
      const pending = prev !== undefined && prev.id > flashShown.current;
      return { kind, amount: pending ? prev.amount + amount : amount, id: ++flashSeq };
    };
    const offIce = session.events.on((e) => {
      if (e.type === 'iceChipped') chipFlash.current = addFlash(chipFlash.current, 'chip', e.amount);
      else if (e.type === 'absorbed') absorbFlash.current = addFlash(absorbFlash.current, 'absorb', e.mass);
    });
    let unregister: () => void = () => {};
    const offPhase = session.onPhaseChange((phase, s) => {
      // Entering play (after the intro, a skip, or a resume) must not steer from wherever the
      // cursor was left on a menu or pause button: the mouse re-arms only via the screen centre.
      if (phase === 'playing') input.recentre();
      syncPhase(phase, s);
    });
    const waitFrames = (frames: number): Promise<void> =>
      new Promise((resolve) => frameWaiters.current.push({ frames, resolve }));
    // UI → session. Space / the skip button step through the intro: the flyover skips to the short
    // calving beat (every level starts with the iceberg breaking off), the calving skips to play.
    const controls: SessionControls = {
      pause: () => session.pause(),
      resume: () => session.resume(),
      skipIntro: () => {
        session.skipIntroStep();
        useGameStore.setState({ introProgress: session.introProgress, introStage: session.introStage });
      },
    };

    // Compile every program (scene, shadow depth, post-processing) while the loading overlay still
    // covers the canvas, so the first visible frames don't freeze for 1-2.5 s on a cold shader cache.
    // The rendered warm-up frames compile what the camera and shadow camera see (incl. the composer's
    // passes and shadow depth variants); compileAsync adds every other scene material, in parallel.
    void (async () => {
      await waitFrames(WARMUP_FRAMES);
      const { scene, camera } = getThree();
      try {
        await compileFor(gl, scene, camera, composer.current?.inputBuffer ?? null);
      } catch {
        // compileAsync is an optimisation; rendering compiles anything it missed.
      }
      await waitFrames(WARMUP_FRAMES);
      if (cancelled) return;
      warm.current = true;
      unregister = registerSession(controls);
      if (session.phase === 'playing') input.recentre();
      syncPhase(session.phase, session);
    })();

    window.__iceberg = {
      snapshot: () => getSnapshot(session),
      runLog: () => getRunLog(session),
      setSteer: (steer) => {
        override.current.steer = steer;
      },
      autopilot: (on, lane = 0) => {
        override.current.autopilot = on;
        override.current.lane = lane;
      },
      fastForward: (seconds) => {
        const steps = Math.round(seconds * 60);
        for (let i = 0; i < steps; i++) session.update(1 / 60, currentInput(0));
        return getSnapshot(session);
      },
      renderStats: () => {
        const info = getThree().gl.info;
        const app = useAppStore.getState();
        return {
          calls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length ?? 0,
          quality: effectiveQuality(app.settings.quality, app.autoQuality),
          pendingAutoQuality: app.pendingAutoQuality,
          postProcessing: composer.current !== null,
          shadows: gl.shadowMap.enabled,
        };
      },
      benchmark: (frames = 20) => {
        const { gl: renderer, scene, camera } = getThree();
        const ctx = renderer.getContext();
        const px = new Uint8Array(4);
        renderer.render(scene, camera);
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) {
          renderer.render(scene, camera);
          ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        }
        const ms = (performance.now() - t0) / frames;
        return { msPerFrame: +ms.toFixed(2), fpsEquivalent: +(1000 / ms).toFixed(1) };
      },
      sceneSummary: () => {
        let meshes = 0;
        const instanced: { name: string; count: number; visible: boolean }[] = [];
        getThree().scene.traverse((o) => {
          if (o instanceof THREE.InstancedMesh) {
            instanced.push({ name: o.name || o.geometry.type, count: o.count, visible: o.visible });
          } else if (o instanceof THREE.Mesh) meshes++;
        });
        return { meshes, instanced };
      },
      traffic: () => {
        const w = session.physics;
        const t = w instanceof PhysicsWorld ? w.traffic : null;
        if (!(w instanceof PhysicsWorld) || !t) return null;
        let moving = 0;
        for (let i = 0; i < t.count; i++) if (t.active[i] && t.v[i] > 0.5) moving++;
        return {
          driving: t.driving,
          moving,
          lights: w.bodies.filter((b) => b.active && b.kind === 'trafficLight').length,
          junctions: t.net.junctions
            .filter((j) => j.signalised)
            .map((j) => ({
              x: j.x,
              z: j.z,
              signals: Array.from({ length: j.groups }, (_, g) => t.signal(j.id, g)),
            })),
        };
      },
      world: () => world.current,
      three: () => getThree(),
    };

    return () => {
      cancelled = true;
      offIce();
      input.dispose();
      inputRef.current = null;
      unregister();
      offPhase();
      frameWaiters.current = [];
      if (window.__iceberg) delete window.__iceberg;
    };
  }, [gl, session]);

  // R3F runs frame callbacks without try/catch: the first exception here stops stepping this session
  // and shows the error dialog (Try Again / Back to Menu) instead of freezing the view mid-run.
  const fail = useFailure();
  const failed = useRef(false);
  useFrame((_, delta) => {
    if (failed.current) return;
    try {
      step(delta);
    } catch (error) {
      failed.current = true;
      fail(new RenderFailure(`The 3D view stopped: ${errorText(error)}`));
    }
  });

  function step(delta: number): void {
    const waiters = frameWaiters.current;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (--waiters[i].frames <= 0) {
        waiters[i].resolve();
        waiters.splice(i, 1);
      }
    }
    if (!warm.current) return;

    session.update(delta, currentInput(delta));

    hudTimer.current -= delta;
    if (hudTimer.current <= 0) {
      hudTimer.current = HUD_INTERVAL;
      const snap = getSnapshot(session);
      const o = override.current;
      const scripted = o.autopilot || o.steer !== null;
      flashShown.current = flashSeq;
      useGameStore.setState({
        introProgress: session.introProgress,
        introStage: session.introStage,
        hud: {
          steer: snap.appliedSteer,
          mouseArmed: scripted || (inputRef.current?.isMouseArmed() ?? true),
          keyboardSteered: inputRef.current?.hasKeyboardSteered() ?? false,
          // Crashes chip ice and absorbing grows it on every level, so the gauge always shows.
          ice: snap.ice,
          mass: snap.mass,
          startMass: session.params.mass,
          chipFlash: chipFlash.current,
          absorbFlash: absorbFlash.current,
          progress: snap.progress,
          speed: snap.speed,
          momentum: Math.min(1, snap.speed / CRUISE_SPEED),
          stuck: snap.stuck,
          time: snap.time,
          knockedDown: snap.stats.knockedDown,
          waterfalls: snap.stats.waterfallsCrossed,
          inOcean: snap.inOcean,
        },
      });
    }
  }

  return null;
}

/**
 * The full-screen 3D view for one level. The Canvas (renderer, compiled shaders, post-processing)
 * lives as long as the level is on screen; each attempt gets a fresh GameSession and a fresh
 * session-dependent subtree (keyed by attempt), so Retry/Replay is fast and leak-free.
 */
export function GameView({ levelId, attempt, story }: GameViewProps) {
  // Read at session creation only: a new hooks object (a re-render) must not restart the attempt.
  const storyRef = useRef(story);
  storyRef.current = story;
  // The session is tagged with its attempt: on Retry the old (disposed) session must never be
  // mounted under the new attempt's key, even for the one render before the effect runs.
  const [loaded, setLoaded] = useState<{ attempt: number; session: GameSession } | null>(null);
  const session = loaded !== null && loaded.attempt === attempt ? loaded.session : null;
  const [webgl] = useState(detectWebGL);
  const quality = useAppStore((s) => effectiveQuality(s.settings.quality, s.autoQuality));
  const high = quality === 'high';
  const shadows = quality !== 'low';
  const composer = useRef<EffectComposerImpl | null>(null);
  // Paused (or showing the error dialog) the scene does not change: render only when something asks
  // for a frame (a resize, a restored context) instead of redrawing shadows and bloom at display rate.
  // R3F restarts its clock on a frameloop change, so the first frame after resuming has a tiny delta.
  const idle = useGameStore((s) => s.phase === 'paused' || s.loadError !== null);
  // The first attempt of a visit plays the full intro (unless Skip intros is on); Retry / Replay
  // (later attempts in the same view) replay only the short calving beat.
  const firstAttempt = useRef(attempt);
  // Story Mode's world condition: rendering only (the session never sees it).
  const world = story?.world ?? null;

  // A step 'auto' quality measured during the last attempt takes effect here, behind the loading
  // overlay (the warm-up then compiles the new tier's shaders), or when the level is left.
  useEffect(() => () => useAppStore.getState().applyPendingAutoQuality(), []);
  useEffect(() => {
    useAppStore.getState().applyPendingAutoQuality();
    useGameStore.setState({
      phase: 'loading',
      hud: emptyHud(),
      result: null,
      failReason: null,
      failHint: null,
      loadError: null,
    });
    if (!webgl) {
      useGameStore.setState({
        loadError: 'WebGL is not available in this browser. Enable hardware acceleration or try another browser.',
      });
      return;
    }
    let cancelled = false;
    let created: GameSession | null = null;
    let detach: (() => void) | null = null;
    const hooks = storyRef.current;
    // Let the loading overlay paint before the (synchronous) terrain build blocks the thread.
    const full = attempt === firstAttempt.current && !useAppStore.getState().settings.skipIntros;
    const timer = window.setTimeout(() => {
      GameSession.create({ level: hooks?.level ?? getLevel(levelId), intro: full ? 'full' : 'short' })
        .then((s) => {
          if (cancelled) {
            s.dispose();
            return;
          }
          created = s;
          if (hooks) {
            storySessions.add(s);
            detach = hooks.attach(s);
          }
          setLoaded({ attempt, session: s });
        })
        .catch((err: unknown) => {
          if (!cancelled) useGameStore.setState({ loadError: err instanceof Error ? err.message : String(err) });
        });
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      detach?.();
      created?.dispose();
    };
  }, [levelId, attempt, webgl]);

  if (!webgl) return null;

  return (
    <div className="game-canvas" style={{ position: 'absolute', inset: 0 }}>
      <CanvasErrorBoundary resetKey={attempt}>
        <Canvas
          frameloop={idle ? 'demand' : 'always'}
          shadows={shadows ? 'percentage' : false}
          dpr={high ? [1, 1.25] : [1, 1]}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.NeutralToneMapping }}
          camera={{ fov: 55, near: 0.3, far: 4000, position: [0, 250, -200] }}
          role="img"
          aria-label="3D view: the iceberg sliding down the valley, with the river forming behind it"
        >
          <CanvasGuards />
          <AutoQuality current={quality} />
          {session && (
            <RuntimeContext.Provider key={attempt} value={session}>
              <WorldConditionContext.Provider value={world}>
                <GameLoop session={session} composer={composer} />
                <Suspense fallback={null}>
                  <Sky />
                  <Lighting quality={shadows ? 'high' : 'low'} />
                  <TerrainMesh terrain={session.terrain} />
                  <Scenery terrain={session.terrain} />
                  <Glacier />
                  <Ocean />
                  <River />
                  <Streams />
                  <Obstacles />
                  <Iceberg />
                  <FinishMarker />
                  <Particles quality={quality} />
                  <Plumes quality={quality} />
                  <CameraRig />
                  {/* After the camera rig: the listener is the camera this frame drew from. */}
                  <GameAudio attempt={attempt} />
                </Suspense>
              </WorldConditionContext.Provider>
            </RuntimeContext.Provider>
          )}
          <Effects quality={high ? 'high' : 'low'} composerRef={composer} />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
