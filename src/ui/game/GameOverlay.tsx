/**
 * Everything drawn over the 3D view during the 'game' screen. Mount it next to <GameView> with the
 * same key (levelId:attempt) so per-attempt state (hint timer, previous best snapshot) resets.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FailReason, GamePhase } from '../../core/types';
import { INTRO_TIMING } from '../../core/intro';
import { INTRO_DURATION } from '../../core/runtime';
import { gameController } from '../../game/controller';
import { useAppStore } from '../../state/appStore';
import { type HudState, type IceFlash, useGameStore } from '../../state/gameStore';
import type { LevelRecord } from '../../state/progress';
import { findLevel, levelLabel, restartAttempt } from '../actions';
import { Button } from '../components';
import { iceFlashSpeech, levelNumber } from '../format';
import { useArrowNavigation, useGameKeys } from '../hooks';
import { ArrowLeftIcon, RestartIcon, WarningIcon } from '../icons';
import { Hud, ICE_WARNING } from './Hud';
import { CompletePanel, FailedPanel, PauseMenu, RiverViewBar } from './Panels';

/** How long the controls hint stays up once play starts (seconds of unpaused play). */
export const HINT_SECONDS = 7;

/** Share of the full intro that is the flyover (the title card's progress bar spans just that). */
const FLYOVER_SHARE = INTRO_TIMING.flyover / INTRO_DURATION;

/** Spoken once per attempt when the ice first drops below ICE_WARNING. */
export const LOW_ICE_ANNOUNCEMENT =
  `Ice below ${Math.round(ICE_WARNING * 100)}%: melting fast. Steer smoothly to save water.`;

/** Spoken once per attempt when the iceberg reaches the sea (the HUD banner is visual only). */
export const OPEN_WATER_ANNOUNCEMENT = 'Open water. Sail out past the finish buoys.';

/**
 * Appended to an announcement identical to the one already in the live region: screen readers only
 * speak a region when its text changes, so a repeat (two equal chips) would otherwise be silent.
 */
const REPEAT_MARK = ' ';

/** The text to put in the live region so that `next` is spoken even if it repeats `current`. */
export function nextAnnouncement(current: string, next: string): string {
  return next !== '' && current === next ? next + REPEAT_MARK : next;
}

/** Newest chip / absorb flash id in a HUD snapshot (ids grow for the page's lifetime), or 0. */
const latestFlashId = (hud: HudState): number =>
  Math.max(hud.chipFlash?.id ?? 0, hud.absorbFlash?.id ?? 0);

const FAIL_ANNOUNCEMENT: Record<FailReason, string> = {
  stuck: 'Run over: the iceberg got stuck.',
  outOfBounds: 'Run over: the iceberg left the valley.',
  melted: 'Run over: the iceberg melted away.',
  fell: 'Run over: the iceberg fell into a ravine.',
};

export interface AnnouncementContext {
  /** Level as it should be spoken, e.g. "Level 1, Mountain Valley". */
  spokenLevel: string;
  loadError: string | null;
  failReason: FailReason | null;
  mouseSteering: boolean;
}

/**
 * What the polite live region says for each phase. The 3D view is opaque to assistive tech, so this
 * is the only cue that the intro started, play began or the run ended.
 */
export function phaseAnnouncement(phase: GamePhase, ctx: AnnouncementContext): string {
  switch (phase) {
    case 'loading':
      return ctx.loadError ? '' : `Loading ${ctx.spokenLevel}.`; // the error dialog speaks for itself
    case 'intro':
      return `${ctx.spokenLevel}. Intro playing — press Space to skip the flyover.`;
    case 'playing':
      return ctx.mouseSteering
        ? 'Playing. Steer with A and D or the arrow keys, or the mouse left or right of centre; ' +
            'Escape pauses.'
        : 'Playing. Steer with A and D or the arrow keys; Escape pauses.';
    case 'paused':
      return 'Paused.';
    case 'failed':
      return FAIL_ANNOUNCEMENT[ctx.failReason ?? 'stuck'];
    case 'complete':
      return 'Level complete.';
    default:
      return '';
  }
}

export interface GameOverlayProps {
  levelId: string;
  /** Story Mode's replacements and additions; Arcade passes nothing and is unchanged. */
  story?: StoryOverlaySlots;
}

/**
 * What Story Mode puts in the overlay (src/ui/story/StoryGame.tsx). Narrative never interrupts
 * steering: during play only the HUD counter and the brief caption are added.
 */
export interface StoryOverlaySlots {
  /** The intro title card's heading and subtitle (the chapter instead of the level). */
  title: { eyebrow: string; name: string; subtitle: string; label: string };
  /** An extra HUD counter (Topple points). */
  counter: ReactNode;
  /**
   * The pause menu's Points guide (each structure kind and its Topple points). Arcade has none: its
   * score is a different sum (src/core/session.ts computeScore) with no per-structure table.
   */
  pointsGuide?: { content: ReactNode; standfirst: string };
  /** Shown during play; fades out by itself, never takes focus or input. */
  caption?: ReactNode;
  /** A brief in-run notice when a named place breaks (the same rules as the caption). */
  notice?: ReactNode;
  /** Replaces LEVEL COMPLETE. */
  complete: ReactNode;
  /** Replaces the failed panel. */
  failed: ReactNode;
  /** Replaces the river-view bar after completion (the epilogue sits over the river). */
  riverView?: ReactNode;
}

export function GameOverlay({ levelId, story }: GameOverlayProps) {
  const phase = useGameStore((s) => s.phase);
  const loadError = useGameStore((s) => s.loadError);
  const introProgress = useGameStore((s) => s.introProgress);
  const introStage = useGameStore((s) => s.introStage);
  const skipIntros = useAppStore((s) => s.settings.skipIntros);
  const mouseSteering = useAppStore((s) => s.settings.mouseSteering);
  const failReason = useGameStore((s) => s.failReason);
  const viewingRiver = useGameStore((s) => s.viewingRiver);
  const lowIce = useGameStore(
    (s) => s.phase === 'playing' && s.hud.ice !== undefined && s.hud.ice < ICE_WARNING,
  );
  const openWater = useGameStore((s) => s.phase === 'playing' && s.hud.inOcean);
  const level = findLevel(levelId);

  // Snapshot the stored best BEFORE this attempt can be recorded, so "New best" compares
  // against the previous record no matter when the integrator calls recordCompletion.
  const [prevRecord] = useState<LevelRecord | null>(
    () => useAppStore.getState().progress.completed[levelId] ?? null,
  );

  useGameKeys();

  // Skip intros skips the flyover only: every level still starts with the short calving beat (the
  // session normally starts with it already; this covers the setting changing mid-flyover).
  useEffect(() => {
    if (phase === 'intro' && skipIntros && introStage === 'flyover') gameController.skipIntro();
  }, [phase, introProgress, skipIntros, introStage]);

  // Leftover focus on a panel button would let Enter/Space re-trigger it during play.
  useEffect(() => {
    if (phase !== 'playing') return;
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && !el.closest('.hud')) el.blur();
  }, [phase]);

  const [hintDone, setHintDone] = useState(false);
  const playedMs = useRef(0);
  useEffect(() => {
    if (phase !== 'playing' || hintDone) return;
    const start = performance.now();
    const id = window.setTimeout(
      () => setHintDone(true),
      Math.max(0, HINT_SECONDS * 1000 - playedMs.current),
    );
    return () => {
      playedMs.current += performance.now() - start;
      window.clearTimeout(id);
    };
  }, [phase, hintDone]);

  const name = level?.name ?? levelId;

  // The live region must exist (empty) before text lands in it, or screen readers skip the text.
  const message = phaseAnnouncement(phase, {
    spokenLevel: level ? `Level ${level.index}, ${level.name}` : name,
    loadError,
    failReason,
    mouseSteering,
  });
  const [announced, setAnnounced] = useState('');
  useEffect(() => setAnnounced(message), [message]);
  // Event announcements may repeat word for word, so they go through nextAnnouncement. Declared
  // after the phase effect so they win if both change in the same commit.
  const announce = (text: string): void => setAnnounced((current) => nextAnnouncement(current, text));
  const meltWarned = useRef(false);
  useEffect(() => {
    if (!lowIce || meltWarned.current) return;
    meltWarned.current = true;
    announce(LOW_ICE_ANNOUNCEMENT);
  }, [lowIce]);
  const openWaterSaid = useRef(false);
  useEffect(() => {
    if (!openWater || openWaterSaid.current) return;
    openWaterSaid.current = true;
    announce(OPEN_WATER_ANNOUNCEMENT);
  }, [openWater]);
  // Chips / absorbs (the HUD's floating text is visual only). The ids alone are selected so the
  // 10 Hz HUD feed does not re-render the overlay; a chip and an absorb together are both spoken.
  const chipId = useGameStore((s) => (s.phase === 'playing' ? s.hud.chipFlash?.id : undefined));
  const absorbId = useGameStore((s) => (s.phase === 'playing' ? s.hud.absorbFlash?.id : undefined));
  const flashSeen = useRef(latestFlashId(useGameStore.getState().hud));
  useEffect(() => {
    const hud = useGameStore.getState().hud;
    const fresh = [hud.absorbFlash, hud.chipFlash].filter(
      (f): f is IceFlash => f !== undefined && f.id > flashSeen.current,
    );
    if (fresh.length === 0) return;
    flashSeen.current = latestFlashId(hud);
    announce(fresh.map(iceFlashSpeech).join(' '));
  }, [chipId, absorbId]);

  // A 3D failure mid-run comes back as phase 'loading' + loadError; the dialog words it accordingly.
  const started = useRef(false);
  if (phase !== 'loading') started.current = true;

  // After a look at the river, the results panel returns focus to its "View the river" button.
  const [viewedRiver, setViewedRiver] = useState(false);
  useEffect(() => {
    if (viewingRiver) setViewedRiver(true);
  }, [viewingRiver]);

  return (
    <div className="overlay-layer" data-phase={phase}>
      <p className="sr-only" aria-live="polite" data-testid="announcer">
        {announced}
      </p>
      {phase === 'loading' && <LoadingOverlay name={name} error={loadError} started={started.current} />}
      {phase === 'intro' && !skipIntros && introStage === 'flyover' && level && (
        <IntroCard
          index={level.index}
          name={story?.title.name ?? level.name}
          subtitle={story?.title.subtitle ?? level.subtitle}
          eyebrow={story?.title.eyebrow}
          progress={introProgress / FLYOVER_SHARE}
        />
      )}
      {phase === 'playing' && (
        <Hud levelId={levelId} showHint={!hintDone} label={story?.title.label} extraCounter={story?.counter} />
      )}
      {/* Mounted from play start for the attempt (a pause does not replay it). */}
      {(phase === 'playing' || phase === 'paused') && story?.caption}
      {/* Likewise the landmark notice (hidden by CSS while paused): resuming never shows an old one. */}
      {(phase === 'playing' || phase === 'paused') && story?.notice}
      {phase === 'paused' && (
        <PauseMenu
          label={story?.title.label ?? (level ? levelLabel(level) : name)}
          pointsGuide={story?.pointsGuide?.content}
          pointsGuideStandfirst={story?.pointsGuide?.standfirst}
        />
      )}
      {phase === 'failed' && (story ? story.failed : <FailedPanel />)}
      {phase === 'complete' &&
        (viewingRiver ? (
          (story?.riverView ?? <RiverViewBar />)
        ) : story ? (
          story.complete
        ) : (
          <CompletePanel levelId={levelId} prevRecord={prevRecord} focusViewButton={viewedRiver} />
        ))}
    </div>
  );
}

interface LoadingOverlayProps {
  name: string;
  error: string | null;
  /** The level was already on screen: the error stopped it rather than kept it from starting. */
  started: boolean;
}

function LoadingOverlay({ name, error, started }: LoadingOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNavigation(ref, { autoFocus: error !== null, focusKey: error });
  if (error) {
    return (
      <section className="modal modal--center" role="alertdialog" aria-labelledby="load-err-title">
        <div className="modal__panel">
          <p className="eyebrow eyebrow--warn">
            <WarningIcon size={18} /> {started ? 'The level stopped' : 'Couldn’t start the level'}
          </p>
          <h2 className="modal__title" id="load-err-title">
            {name}
          </h2>
          <p className="modal__text">{error}</p>
          <p className="modal__text modal__text--muted">
            This game needs WebGL and WebAssembly. Try another browser, enable hardware acceleration,
            or close other heavy tabs.
          </p>
          <div className="stack" ref={ref}>
            <Button icon={<RestartIcon />} onClick={restartAttempt}>
              Try Again
            </Button>
            <Button variant="ghost" icon={<ArrowLeftIcon />} onClick={gameController.quitToMenu}>
              Back to Menu
            </Button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="loading__label">Loading</p>
      <p className="loading__name">{name}</p>
    </div>
  );
}

interface IntroCardProps {
  index: number;
  name: string;
  subtitle: string;
  progress: number;
  /** Story Mode: 'Chapter 01' instead of 'Level 01'. */
  eyebrow?: string;
}

function IntroCard({ index, name, subtitle, progress, eyebrow }: IntroCardProps) {
  const fading = progress > 0.9;
  return (
    <section className={`intro${fading ? ' is-fading' : ''}`} aria-labelledby="intro-title">
      <div className="intro__band">
        <p className="eyebrow num">{eyebrow ?? `Level ${levelNumber(index)}`}</p>
        <h2 className="intro__title" id="intro-title">
          {name}
        </h2>
        <p className="intro__sub">{subtitle}</p>
      </div>
      <button type="button" className="intro__skip" onClick={gameController.skipIntro}>
        PRESS SPACE TO SKIP THE FLYOVER
      </button>
      <div className="intro__progress" aria-hidden="true">
        <div style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
      </div>
    </section>
  );
}
