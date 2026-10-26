import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  QUALITY_SETTINGS,
  SENSITIVITY_MAX as SENS_MAX,
  SENSITIVITY_MIN as SENS_MIN,
  useAppStore,
  type QualitySetting,
  type Settings,
} from '../../state/appStore';

/** Story Mode: which chapters ask the agents for a reflection. */
const AI_LABEL: Record<AiPreference, string> = {
  selected: 'Selected chapters',
  all: 'Every chapter',
  off: 'Off',
};
const AI_PREFS: readonly AiPreference[] = ['selected', 'all', 'off'];

const QUALITY_LABEL: Record<QualitySetting, string> = {
  auto: 'Auto',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
import { modelStatus, refreshStoryStatus, useStoryStatus } from '../../state/storyStatus';
import { useStoryStore } from '../../state/storyStore';
import { DEFAULT_STORY_MODEL, STORY_MODELS, type AiPreference, type StoryModelId } from '../../story/types';
import { Button, ScreenHeader } from '../components';
import { useEscapeToMenu } from '../hooks';
import { ArrowLeftIcon, WarningIcon } from '../icons';
import { previewSound } from '../audio/useAudioDirector';

/** Story Mode: which model the agents run on, and on whose key (the course rule: luna only on the course key). */
const MODEL_NOTE: Record<StoryModelId, string> = {
  'gpt-6-luna': '(course key, default)',
  'gpt-6-sol': '(your own OpenAI key, billed to you, about 20 times the cost)',
};
const MODEL_DESC =
  'Which model the Archivist and the Historian run on. gpt-6-sol runs only on your own OPENAI_API_KEY on the server, ' +
  'billed to you and paused for the day at OPENAI_DAILY_USD_LIMIT. The game never switches models on its own: ' +
  'if the one you chose cannot run, the authored text is shown with the reason.';

interface RowProps {
  label: string;
  description: string;
  control: (ids: { labelId: string; descId: string }) => ReactNode;
  /** The control goes under the text, full width (for a list of long options). */
  stacked?: boolean;
}

function SettingRow({ label, description, control, stacked = false }: RowProps) {
  const base = useId();
  const labelId = `${base}-label`;
  const descId = `${base}-desc`;
  return (
    <div className={`setting${stacked ? ' setting--stacked' : ''}`}>
      <div className="setting__text">
        <span className="setting__label" id={labelId}>
          {label}
        </span>
        <span className="setting__desc" id={descId}>
          {description}
        </span>
      </div>
      <div className="setting__control">{control({ labelId, descId })}</div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  labelId: string;
  descId: string;
}

/** Switch that states its value in text ("On"/"Off"), not just colour/position. */
function Toggle({ checked, onChange, labelId, descId }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={descId}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__state">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

interface VolumeSliderProps {
  /** 0..1, linear amplitude like the music slider always was. */
  value: number;
  onChange: (v: number) => void;
  labelId: string;
  descId: string;
  /** Called when the player lets go of the slider (pointer up, or a key that moved it). */
  onRelease?: () => void;
}

/** Keys that move a range input. */
const SLIDER_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

/** A 0–100 % volume slider: arrow keys step 5 %, the value is read out as "NN percent". */
function VolumeSlider({ value, onChange, labelId, descId, onRelease }: VolumeSliderProps) {
  const pct = Math.round(value * 100);
  return (
    <div className="slider">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-valuetext={`${pct} percent`}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        onPointerUp={onRelease}
        onKeyUp={(e) => {
          if (SLIDER_KEYS.has(e.key)) onRelease?.();
        }}
      />
      <output className="slider__value num" aria-hidden="true">
        {pct}%
      </output>
    </div>
  );
}

interface ModelChoiceProps {
  value: StoryModelId;
  onChange: (m: StoryModelId) => void;
  labelId: string;
  descId: string;
}

/**
 * The model list, with what the server says about each. Only the own-key model is ever disabled (while
 * the server has not said it can run it, or says it cannot), with the reason beside it; gpt-6-luna stays
 * choosable, as the default that costs the player nothing. A choice that cannot run is never changed here.
 */
function ModelChoice({ value, onChange, labelId, descId }: ModelChoiceProps) {
  const status = useStoryStatus((s) => s.status);
  const base = useId();
  return (
    <div className="choices" role="radiogroup" aria-labelledby={labelId} aria-describedby={descId}>
      {STORY_MODELS.map((m) => {
        const st = modelStatus(status, m);
        const disabled = m !== DEFAULT_STORY_MODEL && st?.available !== true;
        const why =
          status === null
            ? m === DEFAULT_STORY_MODEL
              ? undefined
              : 'Checking whether the server can run it…'
            : st
              ? st.available
                ? undefined
                : `Unavailable: ${st.reason ?? 'the server cannot run it now'}.`
              : `Unavailable: ${status.reason ?? 'this server does not offer it'}.`;
        const note = why && value === m && status !== null ? `${why} Until it can run, the authored text is shown.` : why;
        const noteId = `${base}-${m}`;
        return (
          <label key={m} className={`choice${value === m ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}>
            <input
              type="radio"
              name="story-model"
              value={m}
              checked={value === m}
              disabled={disabled}
              aria-describedby={note ? noteId : undefined}
              onChange={() => onChange(m)}
            />
            <span className="choice__text">
              <span className="choice__label">
                <span className="choice__id">{m}</span> {MODEL_NOTE[m]}
              </span>
              {note && (
                <span className="choice__note" id={noteId}>
                  {note}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

const SKIP_INTROS_DESC =
  'Start steering straight away instead of watching the flyover. ' +
  'On by default if your system asks for reduced motion.';
const UNLOCK_ALL_DESC =
  'Play any level without finishing the one before it. For playtesting; best times still save.';
const MOUSE_STEERING_DESC =
  'Steer by moving the mouse left or right of the screen centre. A / D and the arrow keys always work.';

export function SettingsScreen() {
  const settings = useAppStore((s) => s.settings);
  const autoQuality = useAppStore((s) => s.autoQuality);
  const update = useAppStore((s) => s.updateSettings);
  const resetProgress = useAppStore((s) => s.resetProgress);
  const completedCount = useAppStore((s) => Object.keys(s.progress.completed).length);
  const goTo = useAppStore((s) => s.goTo);
  const story = useStoryStore((s) => s.progress);
  const updateStory = useStoryStore((s) => s.updateStorySettings);

  // Two destructive resets, each asked first; one question is open at a time. Opening one focuses its
  // Cancel (the safe choice); Cancel, Escape or answering hands focus back to the button that asked,
  // and the result is announced in the status line under Progress.
  const [confirming, setConfirming] = useState(false);
  const [confirmingStory, setConfirmingStory] = useState(false);
  const [status, setStatus] = useState('');
  const resetBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const storyResetBtnRef = useRef<HTMLButtonElement>(null);
  const storyCancelBtnRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const restoreFocus = useRef(false);
  const restoreStoryFocus = useRef(false);

  useEscapeToMenu(!confirming && !confirmingStory);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[role="switch"]')?.focus({ preventScroll: true });
  }, []);

  // Which models the agent service can run now (the AI model choice says why one cannot).
  useEffect(() => {
    void refreshStoryStatus();
  }, []);

  useEffect(() => {
    if (confirming) cancelBtnRef.current?.focus();
    else if (restoreFocus.current) resetBtnRef.current?.focus();
    restoreFocus.current = false;
  }, [confirming]);

  useEffect(() => {
    if (confirmingStory) storyCancelBtnRef.current?.focus();
    else if (restoreStoryFocus.current) storyResetBtnRef.current?.focus();
    restoreStoryFocus.current = false;
  }, [confirmingStory]);

  useEffect(() => {
    if (!confirming && !confirmingStory) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (confirming) {
        restoreFocus.current = true;
        setConfirming(false);
      } else {
        restoreStoryFocus.current = true;
        setConfirmingStory(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, confirmingStory]);

  const askProgress = (): void => {
    setStatus('');
    setConfirmingStory(false);
    setConfirming(true);
  };
  const askStory = (): void => {
    setStatus('');
    setConfirming(false);
    setConfirmingStory(true);
  };
  const closeStory = (): void => {
    restoreStoryFocus.current = true;
    setConfirmingStory(false);
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    update({ [key]: value } as Partial<Settings>);
  };

  return (
    <main className="screen screen--sub" aria-labelledby="settings-title">
      <div className="sub sub--narrow">
        <div className="sub__topbar">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeftIcon />}
            nav={false}
            onClick={() => goTo('mainMenu')}
          >
            Back
          </Button>
        </div>
        <ScreenHeader
          eyebrow="Make it yours"
          title="Settings"
          titleId="settings-title"
          standfirst="Changes apply immediately and are saved in this browser."
        />

        <form className="settings" ref={formRef} onSubmit={(e) => e.preventDefault()}>
          <fieldset className="settings__group">
            <legend className="settings__legend">Controls</legend>
            <SettingRow
              label="Mouse steering"
              description={MOUSE_STEERING_DESC}
              control={(ids) => (
                <Toggle
                  checked={settings.mouseSteering}
                  onChange={(v) => set('mouseSteering', v)}
                  {...ids}
                />
              )}
            />
            <SettingRow
              label="Mouse sensitivity"
              description={
                settings.mouseSteering
                  ? 'Higher = less mouse travel for a full turn.'
                  : 'Only used when mouse steering is on.'
              }
              control={({ labelId, descId }) => (
                <div className="slider">
                  <input
                    type="range"
                    min={SENS_MIN}
                    max={SENS_MAX}
                    step={0.1}
                    value={settings.mouseSensitivity}
                    aria-labelledby={labelId}
                    aria-describedby={descId}
                    aria-valuetext={`${settings.mouseSensitivity.toFixed(1)} times`}
                    onChange={(e) => set('mouseSensitivity', Number(e.currentTarget.value))}
                  />
                  <output className="slider__value num" aria-hidden="true">
                    {settings.mouseSensitivity.toFixed(1)}×
                  </output>
                </div>
              )}
            />
          </fieldset>

          <fieldset className="settings__group">
            <legend className="settings__legend">Display</legend>
            <SettingRow
              label="Graphics quality"
              description={
                'High adds a bloom glow; Medium keeps shadows; Low drops both for slower computers. ' +
                `Auto picks the best that stays smooth (now: ${QUALITY_LABEL[autoQuality]}).`
              }
              control={({ labelId, descId }) => (
                <div
                  className="segmented"
                  role="radiogroup"
                  aria-labelledby={labelId}
                  aria-describedby={descId}
                >
                  {QUALITY_SETTINGS.map((q) => (
                    <label key={q} className={`segmented__opt${settings.quality === q ? ' is-on' : ''}`}>
                      <input
                        type="radio"
                        name="quality"
                        value={q}
                        checked={settings.quality === q}
                        onChange={() => set('quality', q)}
                      />
                      <span>{QUALITY_LABEL[q]}</span>
                    </label>
                  ))}
                </div>
              )}
            />
            <SettingRow
              label="Show speedometer"
              description="Momentum gauge and speed in km/h during play."
              control={(ids) => (
                <Toggle
                  checked={settings.showSpeedometer}
                  onChange={(v) => set('showSpeedometer', v)}
                  {...ids}
                />
              )}
            />
          </fieldset>

          <fieldset className="settings__group">
            <legend className="settings__legend">Gameplay</legend>
            <SettingRow
              label="Skip intros"
              description={SKIP_INTROS_DESC}
              control={(ids) => (
                <Toggle checked={settings.skipIntros} onChange={(v) => set('skipIntros', v)} {...ids} />
              )}
            />
            <SettingRow
              label="Unlock all levels"
              description={UNLOCK_ALL_DESC}
              control={(ids) => (
                <Toggle
                  checked={settings.unlockAllLevels}
                  onChange={(v) => set('unlockAllLevels', v)}
                  {...ids}
                />
              )}
            />
          </fieldset>

          <fieldset className="settings__group">
            <legend className="settings__legend">Story Mode</legend>
            <SettingRow
              label="Narrative"
              description="Chapter cards, archive documents and reflections. Off = gameplay only; runs are still archived."
              control={(ids) => (
                <Toggle checked={story.settings.narrative} onChange={(v) => updateStory({ narrative: v })} {...ids} />
              )}
            />
            <SettingRow
              label="Reflections by the agents"
              description="Which chapters ask the Archivist and the Historian for a reflection on your run. Authored text is shown otherwise, and whenever they fail."
              control={({ labelId, descId }) => (
                <div className="segmented" role="radiogroup" aria-labelledby={labelId} aria-describedby={descId}>
                  {AI_PREFS.map((a) => (
                    <label key={a} className={`segmented__opt${story.settings.ai === a ? ' is-on' : ''}`}>
                      <input
                        type="radio"
                        name="story-ai"
                        value={a}
                        checked={story.settings.ai === a}
                        onChange={() => updateStory({ ai: a })}
                      />
                      <span>{AI_LABEL[a]}</span>
                    </label>
                  ))}
                </div>
              )}
            />
            <SettingRow
              stacked
              label="AI model"
              description={MODEL_DESC}
              control={(ids) => (
                <ModelChoice value={story.settings.model} onChange={(m) => updateStory({ model: m })} {...ids} />
              )}
            />
            <SettingRow
              label="Reset story"
              description={`Forget archived chapters and the epilogue (${story.completed.length} of 9 archived).`}
              control={() =>
                confirmingStory ? null : (
                  <Button variant="ghost" size="sm" nav={false} ref={storyResetBtnRef} onClick={askStory}>
                    Reset story…
                  </Button>
                )
              }
            />
            {confirmingStory && (
              <div className="confirm" role="alertdialog" aria-labelledby="confirm-story-text" aria-modal="false">
                <p className="confirm__text" id="confirm-story-text">
                  <WarningIcon size={20} /> Forget every archived chapter, its records and reflections, and the
                  epilogue? The story starts again from chapter 1; these settings stay. This can’t be undone.
                </p>
                <div className="confirm__actions">
                  <Button
                    variant="danger"
                    size="sm"
                    nav={false}
                    onClick={() => {
                      useStoryStore.getState().resetStory();
                      closeStory();
                      setStatus('Story reset. Chapter 1 is the only open chapter now.');
                    }}
                  >
                    Yes, reset story
                  </Button>
                  <Button variant="ghost" size="sm" nav={false} ref={storyCancelBtnRef} onClick={closeStory}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="settings__group">
            <legend className="settings__legend">Sound</legend>
            <SettingRow
              label="Master volume"
              description="Everything you hear. M mutes all sound."
              control={(ids) => (
                <VolumeSlider value={settings.masterVolume} onChange={(v) => set('masterVolume', v)} {...ids} />
              )}
            />
            <SettingRow
              label="Music volume"
              description="Story Mode plays each chapter's piece; Arcade Mode plays a lighter one."
              control={(ids) => (
                <VolumeSlider value={settings.musicVolume} onChange={(v) => set('musicVolume', v)} {...ids} />
              )}
            />
            <SettingRow
              label="Ambience volume"
              description="River, waterfalls, sea, wind and church bells."
              control={(ids) => (
                <VolumeSlider
                  value={settings.ambienceVolume}
                  onChange={(v) => set('ambienceVolume', v)}
                  onRelease={() => previewSound('ambience')}
                  {...ids}
                />
              )}
            />
            <SettingRow
              label="Effects volume"
              description="Collisions, breaking structures, splashes and the iceberg's slide."
              control={(ids) => (
                <VolumeSlider
                  value={settings.effectsVolume}
                  onChange={(v) => set('effectsVolume', v)}
                  onRelease={() => previewSound('effects')}
                  {...ids}
                />
              )}
            />
            <SettingRow
              label="Mute music"
              description="Silence the music without losing the volume setting."
              control={(ids) => <Toggle checked={settings.musicMuted} onChange={(v) => set('musicMuted', v)} {...ids} />}
            />
            <SettingRow
              label="Mute all sound"
              description="Silence everything without losing the volume settings. Shortcut: M."
              control={(ids) => (
                <Toggle checked={settings.soundMuted} onChange={(v) => set('soundMuted', v)} {...ids} />
              )}
            />
          </fieldset>

          <fieldset className="settings__group">
            <legend className="settings__legend">Progress</legend>
            <SettingRow
              label="Reset progress"
              description={`Forget completed levels and best times (${completedCount} completed).`}
              control={() =>
                confirming ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    nav={false}
                    ref={resetBtnRef}
                    onClick={askProgress}
                  >
                    Reset progress…
                  </Button>
                )
              }
            />
            {confirming && (
              <div
                className="confirm"
                role="alertdialog"
                aria-labelledby="confirm-text"
                aria-modal="false"
              >
                <p className="confirm__text" id="confirm-text">
                  <WarningIcon size={20} /> Erase all completed levels and best times? This can’t be
                  undone.
                </p>
                <div className="confirm__actions">
                  <Button
                    variant="danger"
                    size="sm"
                    nav={false}
                    onClick={() => {
                      resetProgress();
                      restoreFocus.current = true;
                      setConfirming(false);
                      setStatus(
                        settings.unlockAllLevels
                          ? 'Progress reset. Every level stays unlocked while “Unlock all levels” is on.'
                          : 'Progress reset. Only Level 1 is unlocked now.',
                      );
                    }}
                  >
                    Yes, reset progress
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    nav={false}
                    ref={cancelBtnRef}
                    onClick={() => {
                      restoreFocus.current = true;
                      setConfirming(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <p className="notice" role="status" aria-live="polite">
              {status}
            </p>
          </fieldset>
        </form>
      </div>
    </main>
  );
}
