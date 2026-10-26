/** Modal panels shown over the paused / failed / completed 3D scene. */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LEVELS } from '../../core/levels';
import type { FailReason, RunStats } from '../../core/types';
import { gameController } from '../../game/controller';
import { useAppStore } from '../../state/appStore';
import { useGameStore } from '../../state/gameStore';
import { nextLevelId, type LevelRecord } from '../../state/progress';
import { riverViewControls } from '../../state/riverViewControls';
import { findLevel, levelLabel, restartAttempt, setViewingRiver } from '../actions';
import { Button, Kbd } from '../components';
import {
  formatDistance,
  formatIcePercent,
  formatInt,
  formatMass,
  formatPercent,
  formatTime,
} from '../format';
import { useArrowNavigation } from '../hooks';
import {
  ArrowLeftIcon,
  EyeIcon,
  FrameIcon,
  GridIcon,
  ListIcon,
  MenuIcon,
  NextIcon,
  PlayIcon,
  RestartIcon,
  StarIcon,
  WarningIcon,
} from '../icons';

function ControlsReminder() {
  return (
    <dl className="reminder">
      <div>
        <dt>Steer</dt>
        <dd>
          Mouse left/right of centre · <Kbd>A</Kbd> <Kbd>D</Kbd> · <Kbd srLabel="Left arrow">←</Kbd>{' '}
          <Kbd srLabel="Right arrow">→</Kbd>
        </dd>
      </div>
      <div>
        <dt>Pause</dt>
        <dd>
          <Kbd>Esc</Kbd> <Kbd>P</Kbd>
        </dd>
      </div>
      <div>
        <dt>Restart</dt>
        <dd>
          <Kbd>R</Kbd>
        </dd>
      </div>
    </dl>
  );
}

export interface PauseMenuProps {
  label: string;
  /**
   * Story Mode: the Points guide's content. Adds a "Points guide" button; the guide opens in the
   * same panel, and Back or Escape returns to the menu with focus on that button.
   */
  pointsGuide?: ReactNode;
  /** The guide's one-line standfirst. */
  pointsGuideStandfirst?: string;
}

export function PauseMenu({ label, pointsGuide, pointsGuideStandfirst }: PauseMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [backFromGuide, setBackFromGuide] = useState(false);
  // focusKey: coming back from the guide re-runs the menu's first focus, onto "Points guide".
  useArrowNavigation(ref, { focusKey: guideOpen });
  // While the WebGL context is lost, Resume waits (gameController ignores it) and says why.
  const contextLost = useGameStore((s) => s.contextLost);
  if (guideOpen && pointsGuide) {
    return (
      <PausePointsGuide
        label={label}
        standfirst={pointsGuideStandfirst}
        onClose={() => {
          setBackFromGuide(true);
          setGuideOpen(false);
        }}
      >
        {pointsGuide}
      </PausePointsGuide>
    );
  }
  return (
    <section className="modal modal--center" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="modal__panel">
        <p className="eyebrow">{label}</p>
        <h2 className="modal__title modal__title--display" id="pause-title">
          PAUSED
        </h2>
        {contextLost ? (
          <p className="modal__text" id="pause-restoring">
            <WarningIcon size={16} /> The 3D view lost its graphics context. Waiting for the browser to
            restore it…
          </p>
        ) : (
          <p className="modal__text modal__text--muted">The river will wait for you.</p>
        )}
        <div className="stack" ref={ref}>
          <Button
            size="lg"
            icon={<PlayIcon />}
            onClick={gameController.resume}
            aria-disabled={contextLost || undefined}
            aria-describedby={contextLost ? 'pause-restoring' : undefined}
          >
            Resume
          </Button>
          <Button size="lg" icon={<RestartIcon />} onClick={restartAttempt}>
            Restart
          </Button>
          {pointsGuide && (
            <Button size="lg" icon={<StarIcon />} preferFocus={backFromGuide} onClick={() => setGuideOpen(true)}>
              Points guide
            </Button>
          )}
          <Button size="lg" icon={<GridIcon />} onClick={gameController.toLevelSelect}>
            Level Select
          </Button>
          <Button size="lg" icon={<MenuIcon />} onClick={gameController.quitToMenu}>
            Main Menu
          </Button>
        </div>
        <ControlsReminder />
      </div>
    </section>
  );
}

interface PausePointsGuideProps {
  label: string;
  standfirst?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The Points guide inside the pause panel. Escape closes the guide, not the pause: it is caught on
 * the way down (capture phase) before useGameKeys would read it as Resume. P and R keep their usual
 * meanings. Focus starts on the title, so a screen reader reads it and Tab goes on through the list.
 */
function PausePointsGuide({ label, standfirst, onClose, children }: PausePointsGuideProps) {
  const navRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useArrowNavigation(navRef, { autoFocus: false });
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <section
      className="modal modal--center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="points-guide-title"
      aria-describedby={standfirst ? 'points-guide-standfirst' : undefined}
    >
      <div className="modal__panel modal__panel--guide">
        <p className="eyebrow">{label}</p>
        <h2 className="modal__title" id="points-guide-title" ref={titleRef} tabIndex={-1}>
          Points guide
        </h2>
        {standfirst && (
          <p className="modal__text modal__text--muted" id="points-guide-standfirst">
            {standfirst}
          </p>
        )}
        {children}
        <div className="stack" ref={navRef}>
          <Button size="lg" icon={<ArrowLeftIcon />} aria-keyshortcuts="Escape" onClick={onClose}>
            Back
          </Button>
        </div>
      </div>
    </section>
  );
}

type FailHint = ReturnType<typeof useGameStore.getState>['failHint'];

export const FAIL_TIPS = {
  heldTurn: 'You held a full turn — centre the mouse or release A/D to go straight.',
  obstacle:
    'A heavy obstacle stopped you — steer around boulders and the stone wall, or hit them faster.',
  outOfBounds: 'Stay between the canyon walls; gentle curves keep your speed.',
  stuck: 'Gentle curves keep your speed; avoid zig-zags and heavy boulders.',
  melted: 'Winding routes use more water — steer smoothly to save it.',
  fell:
    'Hit the ravine faster and straight on — line up with a kicker or a drop to fly it — ' +
    'or find another way round.',
} as const;

/**
 * The specific cause (from the run log) wins over the generic tip for the fail reason. Melting and
 * falling into a ravine each have one cause, so their tips always win.
 */
export function failTip(failReason: FailReason | null, failHint: FailHint): string {
  if (failReason === 'melted') return FAIL_TIPS.melted;
  if (failReason === 'fell') return FAIL_TIPS.fell;
  if (failHint === 'heldTurn') return FAIL_TIPS.heldTurn;
  if (failHint === 'obstacle' && failReason !== 'outOfBounds') return FAIL_TIPS.obstacle;
  return failReason === 'outOfBounds' ? FAIL_TIPS.outOfBounds : FAIL_TIPS.stuck;
}

const FAIL_COPY: Record<FailReason, { title: string; text: string }> = {
  stuck: { title: 'STUCK!', text: 'The iceberg ran out of momentum.' },
  outOfBounds: { title: 'OFF COURSE!', text: 'The iceberg left the valley.' },
  melted: { title: 'MELTED!', text: 'Your iceberg ran out of water.' },
  fell: { title: 'FELL INTO THE RAVINE!', text: 'Not enough momentum to fly across.' },
};

export function FailedPanel() {
  const failReason = useGameStore((s) => s.failReason);
  const failHint = useGameStore((s) => s.failHint);
  const progress = useGameStore((s) => s.hud.progress);
  const ref = useRef<HTMLDivElement>(null);
  useArrowNavigation(ref);
  const { title, text } = FAIL_COPY[failReason ?? 'stuck'];
  return (
    <section
      className="modal modal--center modal--failed"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fail-title"
      aria-describedby="fail-text"
    >
      <div className="modal__panel">
        <p className="eyebrow eyebrow--warn">
          <WarningIcon size={18} /> Run over
        </p>
        <h2 className="modal__title modal__title--display" id="fail-title">
          {title}
        </h2>
        <p className="modal__text" id="fail-text">
          {text} You made it <span className="num">{formatPercent(progress)}</span> of the way.
        </p>
        <p className="tip">
          <span className="tip__label">Tip</span>
          {failTip(failReason, failHint)}
        </p>
        <div className="stack" ref={ref}>
          <Button size="lg" icon={<RestartIcon />} onClick={restartAttempt}>
            Retry
          </Button>
          <Button size="lg" icon={<GridIcon />} onClick={gameController.toLevelSelect}>
            Level Select
          </Button>
          <Button size="lg" icon={<MenuIcon />} onClick={gameController.quitToMenu}>
            Main Menu
          </Button>
        </div>
      </div>
    </section>
  );
}

export interface BestFlags {
  time: boolean;
  score: boolean;
}

/** Which figures beat the record that existed before this run (a first clear beats nothing). */
export function compareWithBest(
  result: Pick<RunStats, 'time' | 'score'>,
  prev: LevelRecord | null,
): BestFlags {
  if (!prev) return { time: true, score: true };
  return { time: result.time < prev.bestTime, score: result.score > prev.bestScore };
}

function NewBest() {
  return (
    <span className="badge">
      <StarIcon size={14} /> New best
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value num">{value}</dd>
    </div>
  );
}

export interface CompletePanelProps {
  levelId: string;
  /** Record as it was before this attempt finished (see GameOverlay). */
  prevRecord: LevelRecord | null;
  /** Coming back from the river view: focus "View the river" instead of the first big button. */
  focusViewButton?: boolean;
}

export function CompletePanel({ levelId, prevRecord, focusViewButton = false }: CompletePanelProps) {
  const result = useGameStore((s) => s.result);
  const playLevelWithTransition = useAppStore((s) => s.playLevelWithTransition);
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  useArrowNavigation(ref, { autoFocus: !focusViewButton });
  useEffect(() => {
    if (focusViewButton) viewRef.current?.focus();
  }, [focusViewButton]);

  const level = findLevel(levelId);
  const nextId = nextLevelId(LEVELS, levelId);
  const next = findLevel(nextId);
  const best = result ? compareWithBest(result, prevRecord) : { time: false, score: false };
  const dash = '—';
  // Peak mass only means something once glacier ice was absorbed (it is the start mass otherwise).
  const grew = result !== null && result.absorbed > 0;

  return (
    <section className="complete" role="dialog" aria-modal="true" aria-labelledby="complete-title">
      <div className="complete__panel">
        <header className="complete__head">
          <h2 className="complete__title" id="complete-title">
            LEVEL COMPLETE
          </h2>
          {level && <p className="eyebrow">{levelLabel(level)}</p>}
        </header>

        <dl className="complete__headline">
          <div className="headline-stat headline-stat--score">
            <dt className="stat__label">Score</dt>
            <dd className="headline-stat__value">
              <span className="num">{result ? formatInt(result.score) : dash}</span>
              {result && best.score && <NewBest />}
            </dd>
          </div>
          <div className="headline-stat">
            <dt className="stat__label">Time</dt>
            <dd className="headline-stat__value">
              <span className="num">{result ? formatTime(result.time) : dash}</span>
              {result && best.time && <NewBest />}
            </dd>
          </div>
        </dl>

        <dl className="stats" data-count={grew ? 7 : 5}>
          <Stat label="Distance" value={result ? formatDistance(result.distance) : dash} />
          <Stat label="Objects knocked down" value={result ? formatInt(result.knockedDown) : dash} />
          <Stat label="Buildings destroyed" value={result ? formatInt(result.buildingsDestroyed) : dash} />
          <Stat label="Waterfalls crossed" value={result ? formatInt(result.waterfallsCrossed) : dash} />
          <Stat label="Ice left" value={result ? formatIcePercent(result.iceLeft) : dash} />
          {result && grew && (
            <>
              <Stat label="Ice absorbed" value={formatMass(result.absorbed)} />
              <Stat label="Peak mass" value={formatMass(result.peakMass)} />
            </>
          )}
        </dl>
        {prevRecord && (
          <p className="complete__prev num">
            Previous best {formatTime(prevRecord.bestTime)} · {formatInt(prevRecord.bestScore)} pts
          </p>
        )}

        <Button
          ref={viewRef}
          variant="ghost"
          size="sm"
          nav={false}
          className="complete__view"
          icon={<EyeIcon size={18} />}
          aria-keyshortcuts="V"
          onClick={() => setViewingRiver(true)}
        >
          View the river{' '}
          <span aria-hidden="true">
            <Kbd>V</Kbd>
          </span>
        </Button>

        <div className="stack stack--wide" ref={ref}>
          {next && nextId ? (
            <Button
              size="lg"
              icon={<NextIcon />}
              meta={levelLabel(next)}
              onClick={() => playLevelWithTransition(nextId)}
            >
              Next Level
            </Button>
          ) : (
            <>
              <Button size="lg" icon={<NextIcon />} disabled aria-describedby="next-note">
                Next Level — coming soon
              </Button>
              <p className="stack__note" id="next-note">
                You’ve finished every level available so far.
              </p>
            </>
          )}
          <Button size="lg" icon={<RestartIcon />} onClick={restartAttempt}>
            Replay Level
          </Button>
          <Button size="lg" icon={<GridIcon />} onClick={gameController.toLevelSelect}>
            Level Select
          </Button>
          <Button size="lg" icon={<MenuIcon />} onClick={gameController.quitToMenu}>
            Main Menu
          </Button>
        </div>
      </div>
    </section>
  );
}

const TOUCH_SCREEN = '(hover: none) and (pointer: coarse)';

const isTouchScreen = (): boolean => {
  try {
    return globalThis.matchMedia?.(TOUCH_SCREEN).matches === true;
  } catch {
    return false;
  }
};

/** One "gesture — what it does" entry of the river-view help. */
function Help({ act, children }: { act: ReactNode; children: ReactNode }) {
  return (
    <li>
      <span className="riverview__act">{act}</span> {children}
    </li>
  );
}

/**
 * Replaces the LEVEL COMPLETE panel while the player orbits the finished river: one small chip, no
 * dimming, so the scene gets the pointer (the camera rig handles the gestures it lists). Touch
 * screens get the touch gestures instead of mouse and keys.
 */
export function RiverViewBar() {
  const ref = useRef<HTMLButtonElement>(null);
  const [touch] = useState(isTouchScreen);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section className="riverview" aria-label="River view">
      <div className="riverview__text" id="riverview-text">
        <p className="riverview__title">Your river</p>
        {touch ? (
          <ul className="riverview__help">
            <Help act="Drag">orbit</Help>
            <Help act="Pinch">zoom</Help>
            <Help act="Two-finger drag">pan</Help>
            <Help act="Double-tap">fly there</Help>
          </ul>
        ) : (
          <ul className="riverview__help">
            <Help act="Drag">orbit</Help>
            <Help act="Scroll">zoom at the pointer</Help>
            <Help act="Double-click">fly there</Help>
            <Help act="Right-drag / Shift-drag">pan</Help>
            <Help act="Arrows">orbit</Help>
            <Help act="Shift + arrows">pan</Help>
            <Help
              act={
                <>
                  <Kbd>+</Kbd> <Kbd srLabel="minus">−</Kbd>
                </>
              }
            >
              zoom
            </Help>
            <Help act={<Kbd>Home</Kbd>}>reset</Help>
            <Help
              act={
                <>
                  <Kbd>V</Kbd> <Kbd>Esc</Kbd>
                </>
              }
            >
              results
            </Help>
          </ul>
        )}
      </div>
      <div className="riverview__actions">
        <Button
          variant="ghost"
          size="sm"
          nav={false}
          icon={<FrameIcon size={18} />}
          aria-keyshortcuts="Home"
          onClick={riverViewControls.reset}
        >
          Reset view
        </Button>
        <Button
          ref={ref}
          size="sm"
          nav={false}
          icon={<ListIcon size={18} />}
          aria-describedby="riverview-text"
          aria-keyshortcuts="V Escape"
          onClick={() => setViewingRiver(false)}
        >
          Show results
        </Button>
      </div>
    </section>
  );
}
