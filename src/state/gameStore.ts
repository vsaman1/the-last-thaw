import { create } from 'zustand';
import type { FailReason, GamePhase, RunStats } from '../core/types';
import type { IntroStage } from '../core/intro';

/** Throttled copy of the live session for React UI (~10 Hz). Never read this for gameplay. */
export interface HudState {
  /** 0..1 along the course from start to finish line. */
  progress: number;
  /** Horizontal speed, m/s. */
  speed: number;
  /** 0..1 momentum gauge (speed relative to a comfortable cruising speed). */
  momentum: number;
  /** 0..1 how close the stuck timer is to failing the run (0 = fine). */
  stuck: number;
  time: number;
  knockedDown: number;
  waterfalls: number;
  inOcean: boolean;
  /** Applied steer, -1 (full left) .. 1 (full right). Optional: the HUD hides the indicator without it. */
  steer?: number;
  /**
   * False while mouse steering waits for the cursor to pass the screen centre (input.isMouseArmed()).
   * Optional: the HUD shows the "move the mouse to the centre" prompt only when this is exactly false.
   */
  mouseArmed?: boolean;
  /**
   * True once the player has steered with the keyboard this attempt (input.hasKeyboardSteered()):
   * a keyboard player is not asked to centre the mouse.
   */
  keyboardSteered?: boolean;
  /**
   * Ice relative to the starting iceberg (IcebergState.ice): 0..1 while melting, above 1 once it has
   * absorbed glacier ice (shown as "Ice 160%", growing). Optional: the HUD hides the Ice gauge without it.
   */
  ice?: number;
  /** The iceberg's current mass in tonnes (IcebergState.mass). Shown once it differs from the start. */
  mass?: number;
  /** The level's starting mass in tonnes (session.params.mass). Optional: derived as mass / ice. */
  startMass?: number;
  /**
   * The latest chip and the latest absorb, each for a short floating text on the Ice gauge (and a
   * live-region announcement). Kept apart so a chip and an absorb in the same update both show.
   * `id` must change for every new flash (repeating the same object on later updates does not replay
   * it); several events of one kind between two updates arrive as one flash with their total.
   */
  chipFlash?: IceFlash;
  absorbFlash?: IceFlash;
}

/**
 * chip: amount = the fraction of the starting iceberg lost ('iceChipped'.amount); absorb: amount =
 * tonnes absorbed.
 */
export interface IceFlash {
  kind: 'chip' | 'absorb';
  amount: number;
  id: number;
}

export const emptyHud = (): HudState => ({
  progress: 0,
  speed: 0,
  momentum: 0,
  stuck: 0,
  time: 0,
  knockedDown: 0,
  waterfalls: 0,
  inOcean: false,
});

interface GameState {
  phase: GamePhase;
  introProgress: number;
  /** Where the intro is: the course flyover (title card shown), the calving, or done. */
  introStage: IntroStage;
  hud: HudState;
  /** Set when phase becomes 'complete' or 'failed'. */
  result: RunStats | null;
  failReason: FailReason | null;
  /**
   * Why the run most likely failed, derived from the route/events when phase becomes 'failed':
   * 'heldTurn' = steering was held hard to one side (often a resting off-centre mouse),
   * 'obstacle' = a collision took most of the speed shortly before the stop, null = generic.
   */
  failHint: 'heldTurn' | 'obstacle' | null;
  /**
   * After LEVEL COMPLETE the player can hide the results panel and freely look around the whole
   * river (orbit camera). Toggled by the UI; read by the camera rig. Reset on every new attempt.
   */
  viewingRiver: boolean;
  /** Non-null if the level failed to load (e.g. WebGL/WASM unavailable). */
  loadError: string | null;
  /**
   * The WebGL context is lost and the browser has not restored it yet: the run is paused and Resume
   * waits (the canvas would be blank). If it does not come back the error dialog replaces the pause.
   */
  contextLost: boolean;
}

export const useGameStore = create<GameState>(() => ({
  phase: 'loading',
  introProgress: 0,
  introStage: 'flyover',
  hud: emptyHud(),
  result: null,
  failReason: null,
  failHint: null,
  viewingRiver: false,
  loadError: null,
  contextLost: false,
}));
