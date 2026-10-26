import { useRef, useState } from 'react';
import { LEVELS } from '../../core/levels';
import { DEFAULT_ICEBERG_PARAMS } from '../../core/sim/params';
import type { LevelDef } from '../../core/types';
import { useAppStore } from '../../state/appStore';
import { isUnlocked, type LevelRecord, type Progress } from '../../state/progress';
import { pickPlayLevel, sortedLevels, startLevel } from '../actions';
import { prepareSoundFor } from '../audio/useAudioDirector';
import { Button, ScreenHeader } from '../components';
import { formatInt, formatMass, formatTime, levelNumber } from '../format';
import { useArrowNavigation, useEscapeToMenu } from '../hooks';
import { ArrowLeftIcon, CheckIcon, LockIcon, NextIcon, UnlockIcon } from '../icons';

export type LevelStatus = 'completed' | 'unlocked' | 'locked';

/** "Iceberg 100 t" for levels that start with a non-default iceberg; null otherwise. */
export function icebergNote(level: Pick<LevelDef, 'iceberg'>): string | null {
  const mass = level.iceberg?.mass;
  if (mass === undefined || !(mass > 0) || mass === DEFAULT_ICEBERG_PARAMS.mass) return null;
  return `Iceberg ${formatMass(mass)}`;
}

export function levelStatus(
  levels: readonly LevelDef[],
  progress: Progress,
  id: string,
  unlockAll = false,
): LevelStatus {
  if (progress.completed[id]) return 'completed';
  return isUnlocked(levels, progress, id, unlockAll) ? 'unlocked' : 'locked';
}

interface CardProps {
  level: LevelDef;
  status: LevelStatus;
  record: LevelRecord | undefined;
  previous: LevelDef | undefined;
  preferFocus: boolean;
  onLockedPress: (level: LevelDef) => void;
}

function LevelCard({ level, status, record, previous, preferFocus, onLockedPress }: CardProps) {
  const locked = status === 'locked';
  const statusId = `level-status-${level.id}`;
  const note = icebergNote(level);
  const onClick = () => (locked ? onLockedPress(level) : startLevel(level.id));
  // The card the player is on: its sounds start baking, so they are ready when it is chosen.
  const onAim = locked ? undefined : () => prepareSoundFor(level.id);
  return (
    <button
      type="button"
      className={`level-card level-card--${status}`}
      data-nav=""
      data-autofocus={preferFocus ? '' : undefined}
      aria-disabled={locked ? 'true' : undefined}
      aria-describedby={statusId}
      onClick={onClick}
      onFocus={onAim}
      onPointerEnter={onAim}
    >
      <span className="level-card__num num" aria-hidden="true">
        {levelNumber(level.index)}
      </span>
      <span className="level-card__body">
        <span className="level-card__name">
          <span className="sr-only">Level {level.index}: </span>
          {level.name}
        </span>
        <span className="level-card__sub">{level.subtitle}</span>
        {note && <span className="level-card__meta num">{note}</span>}
      </span>
      <span className="level-card__status" id={statusId}>
        {status === 'completed' && (
          <>
            <span className="status-tag status-tag--done">
              <CheckIcon size={18} /> Completed
            </span>
            {record && (
              <span className="level-card__best num">
                Best {formatTime(record.bestTime)} · {formatInt(record.bestScore)} pts
              </span>
            )}
          </>
        )}
        {status === 'unlocked' && (
          <span className="status-tag status-tag--open">
            <UnlockIcon size={18} /> Unlocked
          </span>
        )}
        {status === 'locked' && (
          <>
            <span className="status-tag status-tag--locked">
              <LockIcon size={18} /> Locked
            </span>
            <span className="level-card__hint">
              Complete {previous ? `Level ${previous.index}: ${previous.name}` : 'the previous level'} to
              unlock.
            </span>
          </>
        )}
      </span>
      {!locked && (
        <span className="level-card__cta" aria-hidden="true">
          {status === 'completed' ? 'Replay' : 'Play'} <NextIcon size={18} />
        </span>
      )}
    </button>
  );
}

export interface LevelSelectProps {
  /** The levels to list (any order; shown by index). Defaults to the game's LEVELS. */
  levels?: readonly LevelDef[];
}

export function LevelSelect({ levels: all = LEVELS }: LevelSelectProps = {}) {
  const progress = useAppStore((s) => s.progress);
  const unlockAll = useAppStore((s) => s.settings.unlockAllLevels);
  const goTo = useAppStore((s) => s.goTo);
  const groupRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState('');
  useArrowNavigation(groupRef);
  useEscapeToMenu();

  const levels = sortedLevels(all);
  const focusId = pickPlayLevel(all, progress, unlockAll);

  return (
    <main className="screen screen--sub" aria-labelledby="levels-title">
      <div className="sub">
        <ScreenHeader
          eyebrow="Choose a valley"
          title="Level Select"
          titleId="levels-title"
          standfirst={
            unlockAll
              ? 'Every level is unlocked for playtesting (turn it off in Settings). Best times still save.'
              : 'Finish a level to unlock the next. Completed levels can be replayed to beat your best.'
          }
        />
        <div ref={groupRef} className="sub__body">
          <ol className="levels" data-count={levels.length}>
            {levels.map((l, i) => (
              <li key={l.id}>
                <LevelCard
                  level={l}
                  status={levelStatus(all, progress, l.id, unlockAll)}
                  record={progress.completed[l.id]}
                  previous={levels[i - 1]}
                  preferFocus={l.id === focusId}
                  onLockedPress={(lv) =>
                    setNotice(`Level ${lv.index} is locked. Complete Level ${lv.index - 1} first.`)
                  }
                />
              </li>
            ))}
            {levels.length < 3 && (
              <li className="level-soon">
                <span className="level-soon__num num" aria-hidden="true">
                  {levelNumber(levels.length + 1)}
                </span>
                <span>More valleys are on the way.</span>
              </li>
            )}
          </ol>
          <p className="notice" role="status" aria-live="polite">
            {notice}
          </p>
          <div className="sub__actions">
            <Button variant="ghost" icon={<ArrowLeftIcon />} onClick={() => goTo('mainMenu')}>
              Back
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
