/**
 * Minimal in-play HUD. Reads the ~10 Hz throttled useGameStore().hud; bars move with CSS
 * transform transitions so they glide between updates without per-frame React work.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gameController } from '../../game/controller';
import { useAppStore } from '../../state/appStore';
import { type IceFlash, useGameStore } from '../../state/gameStore';
import { findLevel, levelLabel, restartAttempt } from '../actions';
import { formatIcePercent, formatInt, formatMass, formatPercent, iceFlashText, toKmh } from '../format';
import { PauseIcon, RestartIcon, RockIcon, WarningIcon, WaterfallIcon, WaveIcon } from '../icons';

/** hud.stuck above this shows the "Losing momentum!" warning. */
export const STUCK_WARNING = 0.25;

/** hud.ice below this shows the "Melting fast" line (GameOverlay also announces it once). */
export const ICE_WARNING = 0.25;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Where the coast sits on the 0..1 start→finish progress bar. */
export function coastFraction(level: { startS: number; coastS: number; finishS: number }): number {
  const span = level.finishS - level.startS;
  return span > 0 ? clamp01((level.coastS - level.startS) / span) : 1;
}

/** Spoken/visible description of an applied steer value (-1 left .. 1 right). */
export function steerText(steer: number): string {
  const pct = Math.round(Math.min(1, Math.abs(steer)) * 100);
  if (pct === 0) return 'Straight';
  return `Turning ${steer < 0 ? 'left' : 'right'}, ${pct}%`;
}

/** Thin left–right gauge: centre tick, end labels and a marker at the applied steer. */
function SteerIndicator({ steer }: { steer: number }) {
  const s = Number.isFinite(steer) ? Math.min(1, Math.max(-1, steer)) : 0;
  return (
    <div
      className="hud__steer"
      role="meter"
      aria-label="Steering"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(s * 100)}
      aria-valuetext={steerText(s)}
    >
      <span className="hud__steer-end" aria-hidden="true">
        L
      </span>
      <div className="hud__steer-track" aria-hidden="true">
        <div className="hud__steer-tick" />
        <div className="hud__steer-rail" style={{ transform: `translateX(${((s + 1) / 2) * 100}%)` }}>
          <div className="hud__steer-marker" />
        </div>
      </div>
      <span className="hud__steer-end" aria-hidden="true">
        R
      </span>
    </div>
  );
}

/** How long a chip / absorb flash stays up (ms); matches the CSS animation. */
export const ICE_FLASH_MS = 1600;

/** Ice at or above this (displayed as at least 101%) counts as grown. */
const GROWN = 1.01;

/**
 * The mass readout ("48 t") once it differs from the starting mass as displayed; null otherwise.
 * Without startMass the start is derived as mass / ice.
 */
export function massLabel(mass?: number, startMass?: number, ice?: number): string | null {
  if (mass === undefined || !Number.isFinite(mass)) return null;
  const start = startMass ?? (ice !== undefined && ice > 0.05 ? mass / ice : undefined);
  if (start === undefined || !Number.isFinite(start)) return null;
  const now = formatMass(mass);
  return now === formatMass(start) ? null : now;
}

interface IceGaugeProps {
  ice: number;
  mass?: number;
  startMass?: number;
  chipFlash?: IceFlash;
  absorbFlash?: IceFlash;
}

/** Bar scale with float noise removed (1.6 − 1 → 0.6, not 0.6000000000000001). */
const barScale = (v: number): number => Math.round(clamp01(v) * 1000) / 1000;

/**
 * Ice: label, bar and a tabular percentage; amber fill when low (the text line says so too). Past
 * 100% (absorbed glacier ice) the bar stays full and a hatched band over it shows the growth (full
 * from 200%); the value gets an up-arrow and "Growing". The mass in tonnes shows once it has changed.
 * Chip / absorb flashes float next to it (both at once when they land together).
 */
function IceGauge({ ice, mass, startMass, chipFlash, absorbFlash }: IceGaugeProps) {
  const v = Number.isFinite(ice) ? Math.max(0, ice) : 0;
  const grown = v >= GROWN;
  const low = v < ICE_WARNING;
  const pct = formatIcePercent(v);
  const tonnes = massLabel(mass, startMass, v);
  const spokenMass = tonnes ? `, ${tonnes.replace(/ t$/, ' tonnes')}` : '';
  const pctNum = Math.floor(v * 100 + 1e-9);
  const cls =
    `hud__chip hud__gauge hud__gauge--ice${low ? ' is-low' : ''}${grown ? ' is-growing' : ''}` +
    (tonnes ? ' has-mass' : '');
  return (
    <div className={cls}>
      <span className="hud__gauge-label">
        Ice
        {grown && <span className="hud__gauge-tag">Growing</span>}
      </span>
      {tonnes && <span className="hud__gauge-mass num">{tonnes}</span>}
      <div
        className="hud__gauge-track"
        role="meter"
        aria-label="Ice"
        aria-valuemin={0}
        aria-valuemax={Math.max(100, pctNum)}
        aria-valuenow={pctNum}
        aria-valuetext={grown ? `${pct} ice, growing${spokenMass}` : `${pct} ice left${spokenMass}`}
      >
        <div className="hud__gauge-fill" style={{ transform: `scaleX(${barScale(v)})` }} />
        {grown && (
          <div className="hud__gauge-grow" style={{ transform: `scaleX(${barScale(v - 1)})` }} />
        )}
      </div>
      <span className="hud__gauge-value num">
        {grown && (
          <span className="hud__gauge-arrow" aria-hidden="true">
            ▲
          </span>
        )}
        {pct}
      </span>
      <div className="hud__flashes">
        <IceFlashText flash={absorbFlash} />
        <IceFlashText flash={chipFlash} />
      </div>
    </div>
  );
}

/**
 * Short floating "−8% ice" / "+12 t ice" by the Ice gauge for each new hud.chipFlash / absorbFlash
 * (by id). The flash present when the HUD mounts (e.g. on resume) is treated as already seen. Visual
 * only: the overlay's live region speaks the same event.
 */
function IceFlashText({ flash }: { flash: IceFlash | undefined }) {
  const [shown, setShown] = useState<IceFlash | null>(null);
  const seen = useRef(flash?.id);
  // Keyed on the id alone: the 10 Hz feed re-sends the same flash as a new object.
  const id = flash?.id;
  useEffect(() => {
    if (!flash || id === seen.current) return;
    seen.current = id;
    setShown(flash);
  }, [id]);
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), ICE_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);
  if (!shown) return null;
  return (
    <p key={shown.id} className={`hud__flash hud__flash--${shown.kind} num`} aria-hidden="true">
      {iceFlashText(shown)}
    </p>
  );
}

export interface HudProps {
  levelId: string;
  showHint: boolean;
  /** Story Mode: the chapter label shown instead of the level label. */
  label?: string;
  /** Story Mode: one more counter (a <div> with <dt>/<dd>), e.g. story points. */
  extraCounter?: ReactNode;
}

export function Hud({ levelId, showHint, label, extraCounter }: HudProps) {
  const hud = useGameStore((s) => s.hud);
  const showSpeedometer = useAppStore((s) => s.settings.showSpeedometer);
  const mouseSteering = useAppStore((s) => s.settings.mouseSteering);
  const level = findLevel(levelId);

  const progress = clamp01(hud.progress);
  const momentum = clamp01(hud.momentum);
  const coast = level ? coastFraction(level) : 1;
  const warning = hud.stuck > STUCK_WARNING;
  const showIce = hud.ice !== undefined;
  const lowIce = hud.ice !== undefined && clamp01(hud.ice) < ICE_WARNING;
  // Once the keyboard has steered, the player has found the controls: stop asking for the mouse.
  const awaitingMouse = mouseSteering && hud.mouseArmed === false && hud.keyboardSteered !== true;
  // A warning outranks the controls hint (on small screens they share the same space).
  const hintVisible = showHint && !warning && !lowIce;
  const pct = formatPercent(progress);

  return (
    <div className="hud">
      <div className="hud__top">
        <p className="hud__chip hud__level">{label ?? (level ? levelLabel(level) : levelId)}</p>

        <div className="hud__chip hud__progress">
          <div
            className="hud__track"
            role="progressbar"
            aria-label="Progress to the ocean"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(progress * 100)}
            aria-valuetext={`${pct} of the way to the finish`}
          >
            <div className="hud__sea" style={{ left: `${coast * 100}%` }} />
            <div className="hud__fill" style={{ transform: `scaleX(${progress})` }} />
            <div className="hud__coast" style={{ left: `${coast * 100}%` }}>
              <span className="hud__coast-label">
                <WaveIcon size={12} />
                Coast
              </span>
            </div>
            {/* Rail spans the track, so translateX(%) maps progress to track width without layout. */}
            <div className="hud__marker-rail" style={{ transform: `translateX(${progress * 100}%)` }}>
              <div className="hud__marker" />
            </div>
          </div>
          <span className="hud__pct num">{pct}</span>
        </div>

        <div className="hud__buttons">
          <button
            type="button"
            className="icon-btn"
            aria-label="Pause (Esc)"
            title="Pause (Esc / P)"
            onClick={gameController.pause}
          >
            <PauseIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Restart level (R)"
            title="Restart (R)"
            onClick={restartAttempt}
          >
            <RestartIcon />
          </button>
        </div>
      </div>

      {/* Visual only: GameOverlay's persistent live region announces it (a region mounted with its
          text already inside is usually skipped by screen readers). */}
      {hud.inOcean && (
        <p className="hud__banner">
          <WaveIcon size={18} /> Open water — sail out past the finish buoys
        </p>
      )}

      {/* One grid band (gauges | steering | counters) so the centre can never overlap a side. */}
      <div className="hud__bottom">
        <div className="hud__bottom-left">
          {warning && (
            <p className="hud__warning" role="alert">
              <WarningIcon size={18} />
              <span className="hud__warning-text">
                <strong>Losing momentum!</strong>{' '}
                <span className="hud__warning-do">Straighten out or you’ll get stuck</span>
              </span>
            </p>
          )}
          {lowIce && (
            <p className="hud__chip hud__melt">
              <WarningIcon size={16} />
              <span>Melting fast — steer smoothly</span>
            </p>
          )}
          {(showSpeedometer || showIce) && (
            <div className="hud__gauges">
              {showSpeedometer && (
                <div className={`hud__chip hud__gauge${warning ? ' is-low' : ''}`}>
                  <span className="hud__gauge-label">Momentum</span>
                  <div
                    className="hud__gauge-track"
                    role="meter"
                    aria-label="Momentum"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(momentum * 100)}
                  >
                    <div className="hud__gauge-fill" style={{ transform: `scaleX(${momentum})` }} />
                  </div>
                  <span className="hud__speed">
                    <span className="num">{toKmh(hud.speed)}</span>
                    <span className="hud__unit">km/h</span>
                  </span>
                </div>
              )}
              {hud.ice !== undefined && (
                <IceGauge
                  ice={hud.ice}
                  mass={hud.mass}
                  startMass={hud.startMass}
                  chipFlash={hud.chipFlash}
                  absorbFlash={hud.absorbFlash}
                />
              )}
            </div>
          )}
        </div>

        <div className="hud__bottom-centre">
          {awaitingMouse && (
            <p className="hud__chip hud__prompt">Move the mouse to the centre to steer, or use A / D</p>
          )}
          {hud.steer !== undefined && <SteerIndicator steer={hud.steer} />}
        </div>

        <dl className="hud__chip hud__counters">
          <div>
            <dt>
              <RockIcon size={16} />
              <span>Knocked</span>
            </dt>
            <dd className="num">{formatInt(hud.knockedDown)}</dd>
          </div>
          <div>
            <dt>
              <WaterfallIcon size={16} />
              <span>Falls</span>
            </dt>
            <dd className="num">{formatInt(hud.waterfalls)}</dd>
          </div>
          {extraCounter}
        </dl>
      </div>

      <p className={`hud__chip hud__hint${hintVisible ? '' : ' is-hidden'}`} aria-hidden={!hintVisible}>
        {mouseSteering ? (
          <>
            Cursor left/right of centre steers — keep it centred to go straight · A/D also work
            <span className="hud__hint-line">Sharp turns cost speed · Reach the ocean</span>
          </>
        ) : (
          <>Steer: A / D or ← → · Sharp turns cost speed · Reach the ocean</>
        )}
      </p>
    </div>
  );
}
