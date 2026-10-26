// @vitest-environment jsdom
/**
 * Click-through smoke test of the whole UI shell: every screen, every menu button and every
 * in-game overlay, driven through the real stores with the 3D view and session faked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from '../core/levels';
import type { RunStats } from '../core/types';
import { registerSession } from '../game/controller';
import { TRANSITION_MS, defaultSettings, useAppStore } from '../state/appStore';
import { emptyHud, useGameStore } from '../state/gameStore';
import { emptyProgress, nextLevelId } from '../state/progress';
import { useStoryStatus } from '../state/storyStatus';
import { emptyStoryProgress, STORY_KEY, useStoryStore } from '../state/storyStore';
import { evidenceFixture } from '../story/fixtures';
import type { StatusResponse } from '../story/types';
import { registerRiverViewControls } from '../state/riverViewControls';
import { App } from './App';
import { OPEN_WATER_ANNOUNCEMENT, nextAnnouncement } from './game/GameOverlay';
import { ICE_FLASH_MS } from './game/Hud';
import { FAIL_TIPS, failTip } from './game/Panels';

vi.mock('../render/GameView', () => ({
  GameView: ({ levelId, attempt }: { levelId: string; attempt: number }) => (
    <div data-testid="gameview" data-level={levelId} data-attempt={attempt} />
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const level = [...LEVELS].sort((a, b) => a.index - b.index)[0];
let container: HTMLDivElement;
let root: Root;
const session = {
  pause: vi.fn(() => useGameStore.setState({ phase: 'paused' })),
  resume: vi.fn(() => useGameStore.setState({ phase: 'playing' })),
  skipIntro: vi.fn(() => useGameStore.setState({ phase: 'playing' })),
};

const text = (): string => container.textContent ?? '';
const buttons = (): HTMLButtonElement[] => Array.from(container.querySelectorAll('button'));
function button(name: string | RegExp): HTMLButtonElement {
  const match = (s: string | null) =>
    s !== null && (typeof name === 'string' ? s.trim().startsWith(name) : name.test(s));
  const b = buttons().find((el) => match(el.getAttribute('aria-label')) || match(el.textContent));
  if (!b) {
    const all = buttons().map((x) => x.textContent).join(' | ');
    throw new Error(`No button "${String(name)}". Buttons: ${all}`);
  }
  return b;
}
const click = (el: HTMLElement) => act(() => el.click());
const press = (key: string, code = key, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));
  });
type GameStatePatch = Partial<ReturnType<typeof useGameStore.getState>>;
const setGame = (patch: GameStatePatch) => act(() => useGameStore.setState(patch));

const result = (over: Partial<RunStats> = {}): RunStats => ({
  levelId: level.id,
  time: 83.46,
  distance: 612,
  topSpeed: 27,
  knockedDown: 14,
  buildingsDestroyed: 2,
  treesFelled: 5,
  waterfallsCrossed: 3,
  collisions: 9,
  iceLeft: 1,
  absorbed: 0,
  peakMass: 30,
  score: 12345,
  ...over,
});

const SOL_NO_KEY =
  'OPENAI_API_KEY not set (gpt-6-sol runs only on your own OpenAI key, billed to you; add it to a .env file in the project folder or a parent folder)';
/** What GET /api/story/status answers for these keys. */
const statusWith = (keys: { luna: boolean; sol: boolean }): StatusResponse => ({
  aiAvailable: keys.luna,
  model: 'gpt-6-luna',
  ...(keys.luna ? {} : { reason: 'PORTKEY_API_KEY not set' }),
  models: [
    { id: 'gpt-6-luna', provider: 'course', available: keys.luna, ...(keys.luna ? {} : { reason: 'PORTKEY_API_KEY not set' }) },
    { id: 'gpt-6-sol', provider: 'own-key', available: keys.sol, ...(keys.sol ? {} : { reason: SOL_NO_KEY }) },
  ],
});

beforeAll(() => {
  registerSession(session);
});

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  useAppStore.setState({
    screen: 'mainMenu',
    levelId: null,
    mode: 'arcade',
    chapterId: null,
    attempt: 0,
    transitioning: false,
    settings: { ...defaultSettings },
    progress: emptyProgress(),
  });
  useStoryStore.setState({ progress: emptyStoryProgress(), failures: {} });
  // A fresh answer, so opening Settings asks the agent service nothing (a test below asks for real).
  useStoryStatus.setState({ status: statusWith({ luna: true, sol: false }), checkedAt: Date.now() });
  useGameStore.setState({
    phase: 'loading',
    introStage: 'flyover',
    hud: emptyHud(),
    result: null,
    failReason: null,
    failHint: null,
    viewingRiver: false,
    loadError: null,
    contextLost: false,
  });
  session.pause.mockClear();
  session.resume.mockClear();
  session.skipIntro.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function enterGameViaLevelSelect(): Promise<void> {
  click(button('Level Select'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  click(container.querySelector<HTMLButtonElement>('.level-card')!);
  expect(useAppStore.getState().transitioning).toBe(true);
  expect(container.ownerDocument.querySelector('[data-testid="transition"]')).not.toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(TRANSITION_MS);
  });
  vi.useRealTimers();
  expect(useAppStore.getState().transitioning).toBe(false);
  expect(useAppStore.getState().screen).toBe('game');
}

describe('menus', () => {
  it('main menu: title, the working buttons, Play focused, arrow keys move focus', () => {
    expect(text()).toContain('ICEBERG RIVER');
    for (const name of ['Play', 'Story Mode — The Last Thaw', 'Level Select', 'How to Play', 'Settings', 'Pilot study', 'Quit']) {
      button(name);
    }
    expect(document.activeElement).toBe(button('Play'));
    press('ArrowDown');
    expect(document.activeElement).toBe(button('Story Mode — The Last Thaw'));
    press('ArrowUp');
    press('ArrowUp');
    expect(document.activeElement).toBe(button('Quit'));
    expect(button('Play').textContent).toContain(`Level ${level.index} · ${level.name}`);
  });

  it('How to Play explains the rules and both buttons work', () => {
    click(button('How to Play'));
    expect(useAppStore.getState().screen).toBe('howToPlay');
    const phrases = [
      'slides downhill',
      'river',
      'zig-zags',
      'Losing momentum!',
      'waterfalls',
      'buoys',
      // melting
      'meltwater',
      'winding routes use more',
      'melts away',
      // chunks breaking off, and growing by absorbing glacier ice
      'chunks of ice break off',
      'bigger icebergs lose less',
      'glacier ice',
      'slows you down at first',
      'hit harder',
    ];
    for (const phrase of phrases) {
      expect(text()).toContain(phrase);
    }
    // Nothing refills the ice and there is nothing to collect: no pickup step, no crystals.
    expect(text().toLowerCase()).not.toContain('refill');
    expect(text().toLowerCase()).not.toContain('crystal');
    expect(text().toLowerCase()).not.toContain('collect');
    expect(container.querySelectorAll('.howto__item')).toHaveLength(11);
    click(button('Back'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
    click(button('How to Play'));
    press('Escape');
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('settings: every control writes the store; reset progress needs confirmation', () => {
    useAppStore.setState({
      progress: { version: 1, completed: { [level.id]: { bestTime: 70, bestScore: 900, completions: 1 } } },
    });
    click(button('Settings'));
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    // Controls, display and gameplay (4), Story Mode's narrative switch, then Sound's two mutes.
    expect(switches).toHaveLength(7);
    expect(switches[0].textContent).toContain('On');
    click(switches[0]);
    expect(useAppStore.getState().settings.mouseSteering).toBe(false);
    expect(switches[0].textContent).toContain('Off');
    click(switches[1]);
    expect(useAppStore.getState().settings.showSpeedometer).toBe(false);
    click(switches[2]);
    expect(useAppStore.getState().settings.skipIntros).toBe(true);
    click(switches[3]);
    expect(useAppStore.getState().settings.unlockAllLevels).toBe(true);
    click(switches[4]);
    expect(useStoryStore.getState().progress.settings.narrative).toBe(false);
    click(switches[5]);
    expect(useAppStore.getState().settings.musicMuted).toBe(true);
    click(switches[6]);
    expect(useAppStore.getState().settings.soundMuted).toBe(true);
    expect(useAppStore.getState().settings.musicMuted).toBe(true);
    click(container.querySelector<HTMLInputElement>('input[name="story-ai"][value="off"]')!);
    expect(useStoryStore.getState().progress.settings.ai).toBe('off');

    click(container.querySelector<HTMLInputElement>('input[value="low"]')!);
    expect(useAppStore.getState().settings.quality).toBe('low');

    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '1.7');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useAppStore.getState().settings.mouseSensitivity).toBeCloseTo(1.7);

    // Sound: master, music, ambience and effects sliders in that order, each read out in percent.
    const sound = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]')).slice(1);
    const label = (el: HTMLInputElement) => document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent;
    expect(sound.map(label)).toEqual(['Master volume', 'Music volume', 'Ambience volume', 'Effects volume']);
    expect(sound.map((el) => el.getAttribute('aria-valuetext'))).toEqual(['100 percent', '60 percent', '80 percent', '80 percent']);
    const fields = ['masterVolume', 'musicVolume', 'ambienceVolume', 'effectsVolume'] as const;
    sound.forEach((el, i) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(el, '0.35');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(useAppStore.getState().settings[fields[i]]).toBeCloseTo(0.35);
    });
    expect(sound[2].getAttribute('aria-valuetext')).toBe('35 percent');

    click(button('Reset progress'));
    expect(text()).toContain('can’t be undone');
    click(button('Cancel'));
    expect(Object.keys(useAppStore.getState().progress.completed)).toHaveLength(1);
    click(button('Reset progress'));
    click(button('Yes, reset progress'));
    expect(useAppStore.getState().progress).toEqual(emptyProgress());
    expect(text()).toContain('Progress reset');

    click(button('Back'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('settings: the AI model — gpt-6-sol disabled with the reason when the server cannot run it', async () => {
    // Ask the (faked) service for real: nothing is known until it answers.
    useStoryStatus.setState({ status: null, checkedAt: 0 });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(statusWith({ luna: true, sol: false })), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      click(button('Settings'));
      const radio = (m: string): HTMLInputElement => container.querySelector<HTMLInputElement>(`input[name="story-model"][value="${m}"]`)!;
      const group = radio('gpt-6-luna').closest<HTMLElement>('[role="radiogroup"]')!;
      expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('AI model');
      expect(group.textContent).toContain('gpt-6-luna (course key, default)');
      expect(group.textContent).toContain('gpt-6-sol (your own OpenAI key, billed to you, about 20 times the cost)');
      // Before the answer: luna chosen and choosable, sol disabled while the server is asked.
      expect(radio('gpt-6-luna').checked).toBe(true);
      expect(radio('gpt-6-sol').disabled).toBe(true);
      expect(group.textContent).toContain('Checking whether the server can run it');
      await act(async () => {
        await vi.waitFor(() => expect(useStoryStatus.getState().status).not.toBeNull());
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/story/status', expect.objectContaining({ method: 'GET' }));
      // After it: still disabled, and the reason is visible and tied to the option.
      const sol = radio('gpt-6-sol');
      expect(sol.disabled).toBe(true);
      const note = document.getElementById(sol.getAttribute('aria-describedby')!);
      expect(note?.textContent).toBe(`Unavailable: ${SOL_NO_KEY}.`);
      expect(note?.closest('label')).toBe(sol.closest('label'));
      expect(radio('gpt-6-luna').disabled).toBe(false);
      expect(radio('gpt-6-luna').hasAttribute('aria-describedby')).toBe(false);
      // Clicking a disabled option changes nothing.
      click(sol);
      expect(useStoryStore.getState().progress.settings.model).toBe('gpt-6-luna');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('settings: the AI model — gpt-6-sol chosen when available, persisted, and never switched back on its own', () => {
    act(() => useStoryStatus.setState({ status: statusWith({ luna: true, sol: true }), checkedAt: Date.now() }));
    click(button('Settings'));
    const radio = (m: string): HTMLInputElement => container.querySelector<HTMLInputElement>(`input[name="story-model"][value="${m}"]`)!;
    expect(radio('gpt-6-sol').disabled).toBe(false);
    expect(radio('gpt-6-sol').hasAttribute('aria-describedby')).toBe(false);
    click(radio('gpt-6-sol'));
    expect(useStoryStore.getState().progress.settings.model).toBe('gpt-6-sol');
    expect(JSON.parse(localStorage.getItem(STORY_KEY)!).settings.model).toBe('gpt-6-sol');
    expect(radio('gpt-6-sol').checked).toBe(true);
    expect(radio('gpt-6-sol').closest('label')?.className).toContain('is-on');
    // The key goes away (the server says so): the choice stays, disabled, with the reason and what happens.
    act(() => useStoryStatus.setState({ status: statusWith({ luna: true, sol: false }), checkedAt: Date.now() }));
    expect(radio('gpt-6-sol').checked).toBe(true);
    expect(radio('gpt-6-sol').disabled).toBe(true);
    const note = document.getElementById(radio('gpt-6-sol').getAttribute('aria-describedby')!);
    expect(note?.textContent).toBe(`Unavailable: ${SOL_NO_KEY}. Until it can run, the authored text is shown.`);
    expect(useStoryStore.getState().progress.settings.model).toBe('gpt-6-sol');
    // gpt-6-luna is always one keypress away.
    click(radio('gpt-6-luna'));
    expect(useStoryStore.getState().progress.settings.model).toBe('gpt-6-luna');
  });

  it('settings: the AI model — gpt-6-luna stays choosable even when the server cannot run it or cannot be reached', () => {
    const unreachable: StatusResponse = { aiAvailable: false, model: '', reason: 'Agent service unreachable (HTTP 502)', models: [] };
    for (const status of [statusWith({ luna: false, sol: false }), unreachable]) {
      act(() => {
        useStoryStore.getState().updateStorySettings({ model: 'gpt-6-sol' });
        useStoryStatus.setState({ status, checkedAt: Date.now() });
      });
      click(button('Settings'));
      const radio = (m: string): HTMLInputElement => container.querySelector<HTMLInputElement>(`input[name="story-model"][value="${m}"]`)!;
      const label = status.models.length ? 'luna unavailable' : 'service unreachable';
      expect(radio('gpt-6-sol').checked, label).toBe(true);
      expect(radio('gpt-6-sol').disabled, label).toBe(true);
      // A player whose gpt-6-sol cannot run is never stuck on it: the default is always one click away.
      expect(radio('gpt-6-luna').disabled, label).toBe(false);
      click(radio('gpt-6-luna'));
      expect(useStoryStore.getState().progress.settings.model, label).toBe('gpt-6-luna');
      expect(JSON.parse(localStorage.getItem(STORY_KEY)!).settings.model, label).toBe('gpt-6-luna');
      click(button('Back'));
    }
  });

  it('settings: reset story asks first; Cancel takes focus, Escape cancels, focus returns to the button', () => {
    act(() =>
      useStoryStore.getState().recordChapter({
        chapterId: 'ch1-beginning',
        completedAt: '2026-10-21T10:00:00.000Z',
        evidence: evidenceFixture(),
        fragmentIds: [],
        reflection: { source: 'authored', text: 'x', fragmentIds: [], factIds: [] },
      }),
    );
    click(button('Settings'));
    const ask = (): HTMLButtonElement => button('Reset story');
    expect(text()).toContain('1 of 9 archived');

    // Opening: a warning that says what goes, and focus on Cancel, not on the destructive button.
    act(() => ask().focus());
    click(ask());
    const dialog = container.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('can’t be undone');
    expect(dialog.textContent).toContain('archived chapter');
    expect(document.activeElement).toBe(button('Cancel'));
    expect(buttons().some((b) => b.textContent === 'Reset story…')).toBe(false);

    // Escape cancels the question and stays on Settings, with focus back on the button that asked.
    press('Escape');
    expect(useAppStore.getState().screen).toBe('settings');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(ask());
    expect(useStoryStore.getState().progress.completed).toHaveLength(1);

    // Cancel does the same.
    click(ask());
    click(button('Cancel'));
    expect(document.activeElement).toBe(ask());
    expect(useStoryStore.getState().progress.completed).toHaveLength(1);

    // One question at a time: asking about progress closes the story question.
    click(ask());
    click(button('Reset progress'));
    expect(container.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('completed levels');
    press('Escape');

    // Yes: the story is reset, announced, and focus lands on the (still present) button again.
    click(ask());
    click(button('Yes, reset story'));
    expect(useStoryStore.getState().progress.completed).toEqual([]);
    expect(useStoryStore.getState().progress.archive).toEqual([]);
    expect(text()).toContain('Story reset.');
    expect(text()).toContain('0 of 9 archived');
    expect(document.activeElement).toBe(ask());

    // With no question open, Escape leaves Settings as before.
    press('Escape');
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('quit screen says goodbye and returns to the menu', () => {
    click(button('Quit'));
    expect(text()).toContain('Thanks for playing — you can close this tab now.');
    click(button('Return to Menu'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('level select shows status in text and locks later levels', () => {
    click(button('Level Select'));
    const cards = container.querySelectorAll('.level-card');
    expect(cards.length).toBe(LEVELS.length);
    expect(cards[0].textContent).toContain('Unlocked');
    expect(cards[0].getAttribute('aria-disabled')).toBeNull();
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].textContent).toContain('Locked');
      expect(cards[i].getAttribute('aria-disabled')).toBe('true');
    }
    click(button('Back'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('with “Unlock all levels” on, every level card is playable', () => {
    useAppStore.getState().updateSettings({ unlockAllLevels: true });
    click(button('Level Select'));
    const cards = container.querySelectorAll('.level-card');
    expect(cards.length).toBe(LEVELS.length);
    for (const card of cards) {
      expect(card.textContent).toContain('Unlocked');
      expect(card.getAttribute('aria-disabled')).toBeNull();
    }
    expect(text()).toContain('unlocked for playtesting');
    useAppStore.getState().updateSettings({ unlockAllLevels: false });
  });

  it('a completed level shows best time/score and stays replayable', () => {
    useAppStore.setState({
      progress: {
        version: 1,
        completed: { [level.id]: { bestTime: 83.46, bestScore: 12345, completions: 2 } },
      },
    });
    click(button('Level Select'));
    const card = container.querySelector('.level-card')!;
    expect(card.textContent).toContain('Completed');
    expect(card.textContent).toContain('1:23.5');
    expect(card.textContent).toContain('12,345');
    expect(card.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('in-game overlays', () => {
  it('loading → intro → HUD → pause → resume → restart', async () => {
    await enterGameViaLevelSelect();
    const view = container.querySelector('[data-testid="gameview"]')!;
    expect(view.getAttribute('data-level')).toBe(level.id);
    expect(text()).toContain('Loading');
    expect(text()).toContain(level.name);

    setGame({ phase: 'intro', introProgress: 0.2 });
    expect(text()).toContain('PRESS SPACE TO SKIP THE FLYOVER');
    expect(text()).toContain(level.subtitle);
    press(' ', 'Space');
    expect(session.skipIntro).toHaveBeenCalledTimes(1);

    setGame({ phase: 'playing', hud: { ...emptyHud(), progress: 0.42, speed: 20, momentum: 0.8 } });
    expect(text()).toContain(`Level ${level.index} · ${level.name}`);
    expect(text()).toContain('42%');
    expect(text()).toContain('72'); // 20 m/s in km/h
    expect(text()).toContain(
      'Cursor left/right of centre steers — keep it centred to go straight · A/D also work',
    );
    expect(text()).not.toContain('Losing momentum!');
    setGame({ hud: { ...emptyHud(), stuck: 0.5 } });
    expect(text()).toContain('Losing momentum!');

    press('Escape');
    expect(session.pause).toHaveBeenCalledTimes(1);
    expect(text()).toContain('PAUSED');
    expect(document.activeElement).toBe(button('Resume'));
    for (const name of ['Resume', 'Restart', 'Level Select', 'Main Menu']) button(name);
    click(button('Resume'));
    expect(session.resume).toHaveBeenCalledTimes(1);

    click(button('Pause (Esc)'));
    expect(session.pause).toHaveBeenCalledTimes(2);
    press('p', 'KeyP');
    expect(session.resume).toHaveBeenCalledTimes(2);

    const before = useAppStore.getState().attempt;
    press('r', 'KeyR');
    expect(useAppStore.getState().attempt).toBe(before + 1);
    expect(useGameStore.getState().phase).toBe('loading');
    expect(container.querySelector('[data-testid="gameview"]')!.getAttribute('data-attempt')).toBe(
      String(before + 1),
    );

    setGame({ phase: 'playing' });
    press('r', 'KeyR', { ctrlKey: true });
    expect(useAppStore.getState().attempt).toBe(before + 1);
    click(button('Restart level (R)'));
    expect(useAppStore.getState().attempt).toBe(before + 2);
  });

  it('failed panel: STUCK! with tip and working buttons', async () => {
    await enterGameViaLevelSelect();
    setGame({
      phase: 'failed',
      failReason: 'stuck',
      result: result(),
      hud: { ...emptyHud(), progress: 0.31 },
    });
    expect(text()).toContain('STUCK!');
    expect(text()).toContain('The iceberg ran out of momentum.');
    expect(text()).toContain('Gentle curves keep your speed; avoid zig-zags and heavy boulders');
    expect(text()).toContain('31%');
    expect(document.activeElement).toBe(button('Retry'));
    const before = useAppStore.getState().attempt;
    click(button('Retry'));
    expect(useAppStore.getState().attempt).toBe(before + 1);
    expect(text()).not.toContain('STUCK!');

    setGame({ phase: 'failed', failReason: 'outOfBounds' });
    expect(text()).toContain('OFF COURSE!');
    setGame({ phase: 'failed', failReason: 'fell', failHint: 'heldTurn' });
    expect(text()).toContain('FELL INTO THE RAVINE!');
    expect(text()).toContain('Not enough momentum to fly across.');
    expect(text()).toContain(FAIL_TIPS.fell);
    click(button('Level Select'));
    expect(useAppStore.getState().screen).toBe('levelSelect');
  });

  it('level complete: stats, New best against the pre-run record, four buttons', async () => {
    const record = { bestTime: 90, bestScore: 20000, completions: 1 };
    useAppStore.setState({ progress: { version: 1, completed: { [level.id]: record } } });
    await enterGameViaLevelSelect();
    // The session records the completion as the phase flips; the overlay must still compare
    // against the record from before this run.
    act(() => {
      useAppStore.getState().recordCompletion(result());
      useGameStore.setState({ phase: 'complete', result: result() });
    });
    expect(text()).toContain('LEVEL COMPLETE');
    for (const s of ['1:23.5', '612 m', '14', '2', '3', '12,345']) expect(text()).toContain(s);
    // Time beat 90 s, score did not beat 20,000 → exactly one "New best".
    expect(text().match(/New best/g)).toHaveLength(1);

    const next = nextLevelId(LEVELS, level.id);
    if (next === null) {
      const nb = button('Next Level — coming soon');
      expect(nb.disabled).toBe(true);
      expect(document.activeElement).toBe(button('Replay Level'));
    } else {
      expect(button('Next Level').disabled).toBe(false);
      expect(document.activeElement).toBe(button('Next Level'));
    }

    const before = useAppStore.getState().attempt;
    click(button('Replay Level'));
    expect(useAppStore.getState().attempt).toBe(before + 1);
    expect(text()).not.toContain('LEVEL COMPLETE');

    setGame({ phase: 'complete', result: result() });
    click(button('Main Menu'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('load error shows the message and a way back', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'loading', loadError: 'WebGL is not available.' });
    expect(text()).toContain('WebGL is not available.');
    expect(text()).toContain('Couldn’t start the level');
    click(button('Back to Menu'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('a 3D failure mid-run says the level stopped, and Try Again starts a new attempt', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud() } });
    setGame({ phase: 'loading', loadError: 'The 3D view stopped: boom' });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(text()).toContain('The level stopped');
    expect(text()).toContain('The 3D view stopped: boom');
    const before = useAppStore.getState().attempt;
    click(button('Try Again'));
    expect(useAppStore.getState().attempt).toBe(before + 1);
  });

  it('while the WebGL context is lost, Resume waits and says why', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'paused', contextLost: true });
    const resume = button('Resume');
    expect(resume.getAttribute('aria-disabled')).toBe('true');
    expect(resume.getAttribute('aria-describedby')).toBe('pause-restoring');
    expect(container.querySelector('#pause-restoring')!.textContent).toContain('graphics context');
    click(resume);
    press('Escape');
    expect(session.resume).not.toHaveBeenCalled();
    expect(useGameStore.getState().phase).toBe('paused');
    setGame({ contextLost: false });
    expect(button('Resume').getAttribute('aria-disabled')).toBeNull();
    click(button('Resume'));
    expect(session.resume).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().phase).toBe('playing');
  });

  it('skip-intros setting skips the intro automatically', async () => {
    useAppStore.setState({ settings: { ...defaultSettings, skipIntros: true } });
    await enterGameViaLevelSelect();
    setGame({ phase: 'intro', introProgress: 0 });
    expect(session.skipIntro).toHaveBeenCalled();
  });

  it('skip-intros still lets the calving beat play, and the title card leaves with the flyover', async () => {
    useAppStore.setState({ settings: { ...defaultSettings, skipIntros: true } });
    await enterGameViaLevelSelect();
    setGame({ phase: 'intro', introStage: 'calving', introProgress: 0 });
    setGame({ introProgress: 0.5 });
    expect(session.skipIntro).not.toHaveBeenCalled();
    act(() => useAppStore.getState().updateSettings({ skipIntros: false }));
    setGame({ phase: 'intro', introStage: 'flyover', introProgress: 0.3 });
    expect(text()).toContain('PRESS SPACE TO SKIP THE FLYOVER');
    setGame({ introStage: 'calving', introProgress: 0.75 });
    expect(text()).not.toContain('PRESS SPACE TO SKIP THE FLYOVER');
    // Space during the calving still reaches the session (it jumps to the hand-off).
    press(' ', 'Space');
    expect(session.skipIntro).toHaveBeenCalledTimes(1);
  });
});

describe('first-run guidance and accessibility', () => {
  const announcer = (): HTMLElement => {
    const el = container.querySelector<HTMLElement>('[data-testid="announcer"]');
    if (!el) throw new Error('no announcer');
    return el;
  };

  it('Losing momentum! says what to do about it', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), stuck: 0.5 } });
    const warning = container.querySelector('[role="alert"]')!;
    expect(warning.textContent).toContain('Losing momentum!');
    expect(warning.textContent).toContain('Straighten out or you’ll get stuck');
  });

  it('prompts to centre the mouse while mouse steering is not armed', async () => {
    await enterGameViaLevelSelect();
    const prompt = 'Move the mouse to the centre to steer';
    setGame({ phase: 'playing', hud: { ...emptyHud(), mouseArmed: false } });
    expect(text()).toContain(prompt);
    setGame({ hud: { ...emptyHud(), mouseArmed: true } });
    expect(text()).not.toContain(prompt);
    setGame({ hud: { ...emptyHud() } }); // not reported yet → no prompt
    expect(text()).not.toContain(prompt);
    // The prompt names the keys too, and a keyboard player who has steered is not nagged.
    setGame({ hud: { ...emptyHud(), mouseArmed: false } });
    expect(container.querySelector('.hud__prompt')!.textContent).toContain('or use A / D');
    setGame({ hud: { ...emptyHud(), mouseArmed: false, keyboardSteered: true } });
    expect(text()).not.toContain(prompt);
    act(() => useAppStore.getState().updateSettings({ mouseSteering: false }));
    setGame({ hud: { ...emptyHud(), mouseArmed: false } });
    expect(text()).not.toContain(prompt);
    expect(text()).toContain('Steer: A / D or ← →');
  });

  it('steering indicator: centre tick plus a marker at the applied steer, stated in text', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud() } });
    expect(container.querySelector('[aria-label="Steering"]')).toBeNull();
    setGame({ hud: { ...emptyHud(), steer: -0.5 } });
    const meter = container.querySelector<HTMLElement>('[aria-label="Steering"]')!;
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('-50');
    expect(meter.getAttribute('aria-valuetext')).toBe('Turning left, 50%');
    expect(meter.querySelector('.hud__steer-tick')).not.toBeNull();
    expect(meter.querySelector('.hud__steer-marker')).not.toBeNull();
    // The rail spans the track, so translateX(%) of it is the marker's position along the track.
    const rail = meter.querySelector<HTMLElement>('.hud__steer-rail')!;
    expect(rail.style.transform).toBe('translateX(25%)');
    expect(meter.textContent).toContain('L');
    expect(meter.textContent).toContain('R');
    setGame({ hud: { ...emptyHud(), steer: 0 } });
    expect(meter.getAttribute('aria-valuetext')).toBe('Straight');
    setGame({ hud: { ...emptyHud(), steer: 3 } });
    expect(meter.getAttribute('aria-valuetext')).toBe('Turning right, 100%');
  });

  it('failed panel picks the tip from failHint', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'failed', failReason: 'stuck', failHint: 'heldTurn' });
    expect(text()).toContain('You held a full turn — centre the mouse or release A/D to go straight');
    setGame({ failHint: 'obstacle' });
    expect(text()).toContain(
      'A heavy obstacle stopped you — steer around boulders and the stone wall, or hit them faster',
    );
    setGame({ failHint: null });
    expect(text()).toContain('Gentle curves keep your speed; avoid zig-zags and heavy boulders');
    setGame({ failHint: 'heldTurn' });
    press('r', 'KeyR');
    expect(useGameStore.getState().failHint).toBeNull(); // a new attempt starts clean
  });

  it('failTip: the cause wins; an obstacle tip never explains leaving the valley', () => {
    expect(failTip('stuck', 'heldTurn')).toBe(FAIL_TIPS.heldTurn);
    expect(failTip('outOfBounds', 'heldTurn')).toBe(FAIL_TIPS.heldTurn);
    expect(failTip('stuck', 'obstacle')).toBe(FAIL_TIPS.obstacle);
    expect(failTip('outOfBounds', 'obstacle')).toBe(FAIL_TIPS.outOfBounds);
    expect(failTip('stuck', null)).toBe(FAIL_TIPS.stuck);
    expect(failTip(null, null)).toBe(FAIL_TIPS.stuck);
    // Melting has one cause (water used up), so its own tip always wins over the route hints.
    expect(failTip('melted', 'heldTurn')).toBe(FAIL_TIPS.melted);
    expect(failTip('melted', 'obstacle')).toBe(FAIL_TIPS.melted);
    expect(failTip('melted', null)).toBe(FAIL_TIPS.melted);
    // So does a fall into a ravine: the tip says how to fly it or go round.
    expect(failTip('fell', 'heldTurn')).toBe(FAIL_TIPS.fell);
    expect(failTip('fell', 'obstacle')).toBe(FAIL_TIPS.fell);
    expect(FAIL_TIPS.fell).toMatch(/faster/);
    expect(FAIL_TIPS.fell).toMatch(/kicker/);
    expect(FAIL_TIPS.fell).toMatch(/another way/);
  });

  it('a persistent polite live region announces each phase', async () => {
    await enterGameViaLevelSelect();
    const region = announcer();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toContain('sr-only');
    expect(region.textContent).toBe(`Loading Level ${level.index}, ${level.name}.`);
    setGame({ phase: 'intro', introProgress: 0.1 });
    expect(announcer()).toBe(region);
    expect(region.textContent).toBe(
      `Level ${level.index}, ${level.name}. Intro playing — press Space to skip the flyover.`,
    );
    setGame({ phase: 'playing' });
    expect(region.textContent).toContain('Playing. Steer with A and D or the arrow keys');
    expect(region.textContent).toContain('Escape pauses');
    setGame({ phase: 'paused' });
    expect(region.textContent).toBe('Paused.');
    setGame({ phase: 'failed', failReason: 'stuck' });
    expect(region.textContent).toBe('Run over: the iceberg got stuck.');
    setGame({ phase: 'failed', failReason: 'fell' });
    expect(region.textContent).toBe('Run over: the iceberg fell into a ravine.');
    setGame({ phase: 'complete', result: result() });
    expect(region.textContent).toBe('Level complete.');
    expect(announcer()).toBe(region);
  });

  it('open water: a visual banner, announced once per attempt by the live region', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud() } });
    const region = announcer();
    setGame({ hud: { ...emptyHud(), inOcean: true } });
    const banner = container.querySelector('.hud__banner')!;
    expect(banner.textContent).toContain('Open water');
    expect(banner.getAttribute('role')).toBeNull(); // not a second, late-mounted live region
    expect(region.textContent).toBe(OPEN_WATER_ANNOUNCEMENT);
    press('Escape');
    press('Escape');
    setGame({ hud: { ...emptyHud(), inOcean: true } });
    expect(region.textContent).toContain('Playing.'); // no repeat after a pause
    press('r', 'KeyR');
    setGame({ phase: 'playing', hud: { ...emptyHud(), inOcean: true } });
    expect(announcer().textContent).toBe(OPEN_WATER_ANNOUNCEMENT);
  });

  it('the bottom band is one grid: gauges | steering + prompt | counters', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 1, steer: 0, mouseArmed: false } });
    const band = container.querySelector('.hud__bottom')!;
    const columns = Array.from(band.children).map((el) => el.className);
    expect(columns).toEqual(['hud__bottom-left', 'hud__bottom-centre', 'hud__chip hud__counters']);
    const centre = band.querySelector('.hud__bottom-centre')!;
    expect(centre.querySelector('.hud__prompt')).not.toBeNull();
    expect(centre.querySelector('.hud__steer')).not.toBeNull();
    // Laid out by a grid, so the centre column moves aside rather than overlapping the gauges.
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    const rule = /\.hud__bottom \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(max-content, 1fr\) auto minmax\(max-content, 1fr\)/);
  });
});

describe('melting and viewing the river', () => {
  const announcer = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="announcer"]')!;
  const iceMeter = (): HTMLElement | null => container.querySelector<HTMLElement>('[aria-label="Ice"]');
  const MELT_LINE = 'Melting fast — steer smoothly';
  const LOW_ICE = 'Ice below 25%: melting fast. Steer smoothly to save water.';
  const CHIP = 'Your river';
  /** Value cell of the complete-panel stat with this exact label, or null. */
  const statValue = (label: string): string | null => {
    const stat = Array.from(container.querySelectorAll('.stats .stat')).find(
      (el) => el.querySelector('dt')?.textContent === label,
    );
    return stat?.querySelector('dd')?.textContent ?? null;
  };

  it('Ice gauge: hidden without data; label, bar and tabular percentage; warning below 25%', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud() } });
    expect(iceMeter()).toBeNull();
    expect(text()).not.toContain(MELT_LINE);

    setGame({ hud: { ...emptyHud(), ice: 0.42 } });
    const meter = iceMeter()!;
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('42');
    expect(meter.getAttribute('aria-valuetext')).toBe('42% ice left');
    const gauge = meter.closest('.hud__gauge')!;
    expect(gauge.querySelector('.hud__gauge-label')!.textContent).toBe('Ice');
    expect(gauge.querySelector('.num')!.textContent).toBe('42%');
    expect(gauge.classList.contains('is-low')).toBe(false);
    // Sits beside the momentum gauge in the same group.
    const group = container.querySelector('.hud__gauges')!;
    expect(group.contains(container.querySelector('[aria-label="Momentum"]'))).toBe(true);
    expect(group.contains(meter)).toBe(true);

    const hint = (): Element => container.querySelector('.hud__hint')!;
    setGame({ hud: { ...emptyHud(), ice: 0.25 } });
    expect(text()).not.toContain(MELT_LINE);
    expect(hint().classList.contains('is-hidden')).toBe(false);
    setGame({ hud: { ...emptyHud(), ice: 0.2 } });
    expect(text()).toContain(MELT_LINE);
    expect(iceMeter()!.closest('.hud__gauge')!.classList.contains('is-low')).toBe(true);
    expect(hint().classList.contains('is-hidden')).toBe(true); // the warning outranks the hint
    expect(container.querySelector('[role="alert"]')).toBeNull(); // spoken once by the announcer

    // Ice is a resource, not a speed readout: it stays when the speedometer is switched off.
    act(() => useAppStore.getState().updateSettings({ showSpeedometer: false }));
    expect(container.querySelector('[aria-label="Momentum"]')).toBeNull();
    expect(iceMeter()).not.toBeNull();
  });

  it('HUD counters are just Knocked and Falls; the controls hint promises no refills', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 0.8, knockedDown: 4, waterfalls: 1 } });
    const labels = Array.from(container.querySelectorAll('.hud__counters dt')).map((dt) => dt.textContent);
    expect(labels).toEqual(['Knocked', 'Falls']);
    const values = Array.from(container.querySelectorAll('.hud__counters dd')).map((dd) => dd.textContent);
    expect(values).toEqual(['4', '1']);
    const hint = container.querySelector('.hud__hint')!.textContent!;
    expect(hint).toContain('Sharp turns cost speed · Reach the ocean');
    expect(hint.toLowerCase()).not.toContain('refill');
  });

  it('announces low ice once per attempt, and the melted fail', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 0.6 } });
    const region = announcer();
    expect(region.textContent).toContain('Playing.');
    setGame({ hud: { ...emptyHud(), ice: 0.2 } });
    expect(region.textContent).toBe(LOW_ICE);

    press('Escape');
    expect(region.textContent).toBe('Paused.');
    press('Escape');
    expect(region.textContent).toContain('Playing.');
    setGame({ hud: { ...emptyHud(), ice: 0.1 } }); // still low after the pause: no repeat
    expect(region.textContent).toContain('Playing.');

    setGame({ phase: 'failed', failReason: 'melted' });
    expect(region.textContent).toBe('Run over: the iceberg melted away.');

    press('r', 'KeyR'); // a new attempt warns again
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 0.2 } });
    expect(announcer().textContent).toBe(LOW_ICE);
  });

  it('failed panel: MELTED! says the iceberg ran out of water, with its own tip', async () => {
    await enterGameViaLevelSelect();
    setGame({
      phase: 'failed',
      failReason: 'melted',
      failHint: 'heldTurn',
      hud: { ...emptyHud(), progress: 0.55 },
    });
    expect(text()).toContain('MELTED!');
    expect(text()).toContain('Your iceberg ran out of water.');
    expect(text()).toContain('55%');
    expect(text()).toContain('Winding routes use more water — steer smoothly to save it.');
    expect(text()).not.toContain('STUCK!');
    expect(text()).not.toContain(FAIL_TIPS.heldTurn);
    expect(document.activeElement).toBe(button('Retry'));
  });

  it('level complete lists five stats, ending with ice left', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'complete', result: result({ iceLeft: 0.42 }) });
    const labels = Array.from(container.querySelectorAll('.stats .stat dt')).map((dt) => dt.textContent);
    expect(labels).toEqual([
      'Distance',
      'Objects knocked down',
      'Buildings destroyed',
      'Waterfalls crossed',
      'Ice left',
    ]);
    expect(statValue('Ice left')).toBe('42%');
    expect(statValue('Distance')).toBe('612 m');
    setGame({ result: result({ iceLeft: 1 }) });
    expect(statValue('Ice left')).toBe('100%');
  });

  it('View the river hides the results for a free look; V, Esc or the button bring them back', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'complete', result: result() });
    const view = button('View the river');
    expect(view.getAttribute('aria-keyshortcuts')).toBe('V');
    // A secondary control: the four big stacked buttons are unchanged and keep initial focus.
    expect(view.classList.contains('btn--lg')).toBe(false);
    const big = Array.from(container.querySelectorAll('.complete .stack .btn--lg'));
    expect(big.map((b) => b.querySelector('.btn__label')!.textContent)).toEqual([
      nextLevelId(LEVELS, level.id) ? 'Next Level' : 'Next Level — coming soon',
      'Replay Level',
      'Level Select',
      'Main Menu',
    ]);
    expect(document.activeElement).not.toBe(view);

    click(view);
    expect(useGameStore.getState().viewingRiver).toBe(true);
    expect(container.querySelector('.complete')).toBeNull(); // panel and dimming gone
    expect(text()).not.toContain('LEVEL COMPLETE');
    expect(text()).toContain(CHIP);
    expect(document.activeElement).toBe(button('Show results'));

    press('v', 'KeyV');
    expect(useGameStore.getState().viewingRiver).toBe(false);
    expect(text()).toContain('LEVEL COMPLETE');
    expect(text()).not.toContain(CHIP);
    expect(document.activeElement).toBe(button('View the river'));

    press('v', 'KeyV');
    expect(useGameStore.getState().viewingRiver).toBe(true);
    press('Escape');
    expect(useGameStore.getState().viewingRiver).toBe(false);
    expect(document.activeElement).toBe(button('View the river'));

    // Esc / P on the results panel do nothing at all (no pause, no view toggle).
    press('Escape');
    press('p', 'KeyP');
    expect(session.pause).not.toHaveBeenCalled();
    expect(useGameStore.getState().phase).toBe('complete');
    expect(useGameStore.getState().viewingRiver).toBe(false);
    expect(text()).toContain('LEVEL COMPLETE');

    click(button('View the river'));
    click(button('Show results'));
    expect(useGameStore.getState().viewingRiver).toBe(false);
    expect(document.activeElement).toBe(button('View the river'));
  });

  it('V only works on LEVEL COMPLETE; the view resets on a new attempt and on leaving', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud() } });
    press('v', 'KeyV');
    expect(useGameStore.getState().viewingRiver).toBe(false);
    setGame({ phase: 'failed', failReason: 'stuck' });
    press('v', 'KeyV');
    expect(useGameStore.getState().viewingRiver).toBe(false);

    setGame({ phase: 'complete', result: result() });
    press('v', 'KeyV', { ctrlKey: true }); // Ctrl+V is left alone
    expect(useGameStore.getState().viewingRiver).toBe(false);
    press('v', 'KeyV');
    expect(useGameStore.getState().viewingRiver).toBe(true);

    const before = useAppStore.getState().attempt;
    press('r', 'KeyR'); // replay straight from the river view
    expect(useAppStore.getState().attempt).toBe(before + 1);
    expect(useGameStore.getState().viewingRiver).toBe(false);
    setGame({ phase: 'complete', result: result() });
    expect(text()).toContain('LEVEL COMPLETE');

    press('v', 'KeyV');
    expect(useGameStore.getState().viewingRiver).toBe(true);
    act(() => useAppStore.getState().goTo('mainMenu'));
    expect(useGameStore.getState().viewingRiver).toBe(false);
  });
});

describe('growing, chipping and inspecting the river', () => {
  const iceMeter = (): HTMLElement => container.querySelector<HTMLElement>('[aria-label="Ice"]')!;
  const iceGauge = (): HTMLElement => iceMeter().closest<HTMLElement>('.hud__gauge')!;
  const flash = (): HTMLElement | null => container.querySelector<HTMLElement>('.hud__flash');
  const flashes = (): string[] =>
    Array.from(container.querySelectorAll('.hud__flash')).map((el) => el.textContent ?? '');
  const announcer = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="announcer"]')!;
  const statLabels = (): string[] =>
    Array.from(container.querySelectorAll('.stats .stat dt')).map((dt) => dt.textContent ?? '');
  const statValue = (label: string): string | null => {
    const stat = Array.from(container.querySelectorAll('.stats .stat')).find(
      (el) => el.querySelector('dt')?.textContent === label,
    );
    return stat?.querySelector('dd')?.textContent ?? null;
  };

  it('Ice gauge past 100%: growing style, overflow band and mass in tonnes, all in text', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 1.6, mass: 48, startMass: 30 } });
    const gauge = iceGauge();
    expect(gauge.classList.contains('is-growing')).toBe(true);
    expect(gauge.classList.contains('is-low')).toBe(false);
    expect(gauge.querySelector('.hud__gauge-value')!.textContent).toContain('160%');
    expect(gauge.querySelector('.hud__gauge-mass')!.textContent).toBe('48 t');
    expect(gauge.textContent).toContain('Growing');
    const meter = iceMeter();
    expect(meter.getAttribute('aria-valuenow')).toBe('160');
    expect(Number(meter.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(160);
    expect(meter.getAttribute('aria-valuetext')).toBe('160% ice, growing, 48 tonnes');
    // The base bar is full; the growth shows as a separate hatched band on top of it.
    expect(gauge.querySelector<HTMLElement>('.hud__gauge-fill')!.style.transform).toBe('scaleX(1)');
    expect(gauge.querySelector<HTMLElement>('.hud__gauge-grow')!.style.transform).toBe('scaleX(0.6)');
    setGame({ hud: { ...emptyHud(), ice: 3.5, mass: 105, startMass: 30 } });
    expect(iceGauge().querySelector<HTMLElement>('.hud__gauge-grow')!.style.transform).toBe('scaleX(1)');
    expect(iceGauge().querySelector('.hud__gauge-value')!.textContent).toContain('350%');
  });

  it('mass shows only once it differs from the starting mass', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 1, mass: 30, startMass: 30 } });
    expect(iceGauge().querySelector('.hud__gauge-mass')).toBeNull();
    expect(iceGauge().classList.contains('is-growing')).toBe(false);
    expect(iceMeter().getAttribute('aria-valuetext')).toBe('100% ice left');
    setGame({ hud: { ...emptyHud(), ice: 0.8, mass: 24, startMass: 30 } });
    expect(iceGauge().querySelector('.hud__gauge-mass')!.textContent).toBe('24 t');
    expect(iceMeter().getAttribute('aria-valuetext')).toBe('80% ice left, 24 tonnes');
    // Without startMass the start is derived from mass / ice.
    setGame({ hud: { ...emptyHud(), ice: 1, mass: 100 } });
    expect(iceGauge().querySelector('.hud__gauge-mass')).toBeNull();
    setGame({ hud: { ...emptyHud(), ice: 2, mass: 200 } });
    expect(iceGauge().querySelector('.hud__gauge-mass')!.textContent).toBe('200 t');
  });

  it('chips and absorbs flash a short text that fades, is announced, and never replays', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 0.9 } });
    expect(flash()).toBeNull();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const chip1 = { kind: 'chip', amount: 0.08, id: 1 } as const;
    setGame({ hud: { ...emptyHud(), ice: 0.82, chipFlash: chip1 } });
    expect(flash()!.textContent).toBe('−8% ice');
    expect(flash()!.classList.contains('hud__flash--chip')).toBe(true);
    expect(flash()!.getAttribute('aria-hidden')).toBe('true'); // spoken by the live region instead
    expect(announcer().textContent).toBe('Ice broke off: 8% lost.');
    // The 10 Hz HUD feed repeats the same flash: it must not restart or extend it.
    act(() => vi.advanceTimersByTime(ICE_FLASH_MS / 2));
    setGame({ hud: { ...emptyHud(), ice: 0.82, chipFlash: { ...chip1 } } });
    act(() => vi.advanceTimersByTime(ICE_FLASH_MS / 2 + 10));
    expect(flash()).toBeNull();

    const absorb2 = { kind: 'absorb', amount: 12.3, id: 2 } as const;
    setGame({ hud: { ...emptyHud(), ice: 1.2, chipFlash: chip1, absorbFlash: absorb2 } });
    expect(flashes()).toEqual(['+12 t ice']);
    expect(flash()!.classList.contains('hud__flash--absorb')).toBe(true);
    expect(announcer().textContent).toBe('Absorbed 12 tonnes of glacier ice.');
    // A newer flash replaces the current one of its kind at once; the other kind stays up.
    const chip3 = { kind: 'chip', amount: 0.1, id: 3 } as const;
    setGame({ hud: { ...emptyHud(), ice: 1.1, chipFlash: chip3, absorbFlash: absorb2 } });
    expect(flashes()).toEqual(['+12 t ice', '−10% ice']);
    const chip4 = { kind: 'chip', amount: 0.05, id: 4 } as const;
    setGame({ hud: { ...emptyHud(), ice: 1.05, chipFlash: chip4, absorbFlash: absorb2 } });
    expect(flashes()).toEqual(['+12 t ice', '−5% ice']);
    act(() => vi.advanceTimersByTime(ICE_FLASH_MS + 10));
    expect(flash()).toBeNull();
    vi.useRealTimers();

    // Pausing unmounts the HUD; on resume the last (old) flash is not shown again.
    press('Escape');
    press('Escape');
    expect(useGameStore.getState().phase).toBe('playing');
    expect(flash()).toBeNull();
  });

  it('a chip and an absorb in the same update both show and are both announced', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 1 } });
    setGame({
      hud: {
        ...emptyHud(),
        ice: 1.3,
        chipFlash: { kind: 'chip', amount: 0.08, id: 5 },
        absorbFlash: { kind: 'absorb', amount: 12.3, id: 6 },
      },
    });
    expect(flashes()).toEqual(['+12 t ice', '−8% ice']);
    expect(announcer().textContent).toBe('Absorbed 12 tonnes of glacier ice. Ice broke off: 8% lost.');
  });

  it('a repeated, word-for-word identical announcement still changes the live region', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'playing', hud: { ...emptyHud(), ice: 0.9 } });
    setGame({ hud: { ...emptyHud(), ice: 0.82, chipFlash: { kind: 'chip', amount: 0.08, id: 7 } } });
    const first = announcer().textContent;
    expect(first).toBe('Ice broke off: 8% lost.');
    setGame({ hud: { ...emptyHud(), ice: 0.74, chipFlash: { kind: 'chip', amount: 0.08, id: 8 } } });
    const second = announcer().textContent!;
    expect(second).not.toBe(first); // the region changed, so it is spoken again
    expect(second.trim()).toBe(first);
    setGame({ hud: { ...emptyHud(), ice: 0.66, chipFlash: { kind: 'chip', amount: 0.08, id: 9 } } });
    expect(announcer().textContent).toBe(first);
    expect(nextAnnouncement('Paused.', 'Paused.')).not.toBe('Paused.');
    expect(nextAnnouncement('Paused.', 'Playing.')).toBe('Playing.');
  });

  it('touches on the 3D view are never taken over for page panning or pinch-zoom', () => {
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    const rule = /\.game-canvas,\s*\.game-canvas canvas \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/touch-action:\s*none/);
    // Panels over the view must stay scrollable: nothing above them in the tree disables touch.
    expect(css).not.toMatch(/\.(game-screen|overlay-layer|modal)\s*\{[^}]*touch-action:\s*none/);
  });

  it('focus rings drawn on the 3D scene get a dark halo behind them', () => {
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    for (const sel of ['.hud__buttons .icon-btn:focus-visible', '.intro__skip:focus-visible']) {
      const at = css.indexOf(`${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf('}', at));
      // Wider than the ring's 3 px offset + 3 px width, in the scrim colour.
      expect(body, sel).toMatch(/0 0 0 9px var\(--c-scrim\)/);
    }
    // The skip button's breathing glow animates box-shadow, so it stops while focused.
    const skip = css.slice(css.indexOf('.intro__skip:focus-visible {'));
    expect(skip.slice(0, skip.indexOf('}'))).toMatch(/animation:\s*none/);
  });

  it('flash animation respects prefers-reduced-motion', () => {
    // Not new URL(…, import.meta.url): under jsdom Vite rewrites that to an http: URL.
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.hud__flash[^{]*\{[^}]*animation-name:\s*fade-out/);
  });

  it('results add Ice absorbed and Peak mass (tonnes) only when the iceberg grew', async () => {
    await enterGameViaLevelSelect();
    setGame({ phase: 'complete', result: result({ iceLeft: 1.4, absorbed: 18.4, peakMass: 52.2 }) });
    expect(statLabels()).toEqual([
      'Distance',
      'Objects knocked down',
      'Buildings destroyed',
      'Waterfalls crossed',
      'Ice left',
      'Ice absorbed',
      'Peak mass',
    ]);
    expect(statValue('Ice absorbed')).toBe('18 t');
    expect(statValue('Peak mass')).toBe('52 t');
    expect(statValue('Ice left')).toBe('140%');
    // Seven figures on two full rows (4 + 3) instead of 3 + 2.
    expect(container.querySelector('.stats')!.getAttribute('data-count')).toBe('7');
    setGame({ result: result({ absorbed: 0, peakMass: 100 }) });
    expect(statLabels()).toHaveLength(5);
    expect(container.querySelector('.stats')!.getAttribute('data-count')).toBe('5');
  });

  describe('river view chip', () => {
    const calls: string[] = [];
    let unregister: () => void = () => {};
    beforeEach(() => {
      calls.length = 0;
      unregister = registerRiverViewControls({
        reset: () => calls.push('reset'),
        zoom: (f) => calls.push(f < 1 ? 'zoom-in' : 'zoom-out'),
        rotate: (a, e) => calls.push(`rotate ${Math.sign(a)} ${Math.sign(e)}`),
        pan: (r, f) => calls.push(`pan ${Math.sign(r)} ${Math.sign(f)}`),
      });
    });
    afterEach(() => unregister());

    async function viewing(): Promise<void> {
      await enterGameViaLevelSelect();
      setGame({ phase: 'complete', result: result() });
      press('v', 'KeyV');
      expect(useGameStore.getState().viewingRiver).toBe(true);
    }

    it('explains every gesture and key, and Reset view returns to the whole river', async () => {
      await viewing();
      const chip = container.querySelector('.riverview')!;
      for (const s of [
        'Your river',
        'Drag',
        'orbit',
        'Scroll',
        'zoom at the pointer',
        'Double-click',
        'fly there',
        'Right-drag',
        'Shift-drag',
        'pan',
        'Home',
        'reset',
        'results',
      ]) {
        expect(chip.textContent).toContain(s);
      }
      expect(document.activeElement).toBe(button('Show results'));
      const reset = button('Reset view');
      expect(reset.getAttribute('aria-keyshortcuts')).toBe('Home');
      click(reset);
      expect(calls).toEqual(['reset']);
      expect(useGameStore.getState().viewingRiver).toBe(true); // still in the river view
    });

    it('keys: Home resets, + / − zoom, arrows orbit, Shift+arrows pan', async () => {
      await viewing();
      press('Home');
      press('+', 'Equal', { shiftKey: true });
      press('=', 'Equal');
      press('-', 'Minus');
      press('+', 'NumpadAdd');
      press('-', 'NumpadSubtract');
      press('ArrowLeft');
      press('ArrowRight');
      press('ArrowUp');
      press('ArrowDown');
      press('ArrowLeft', 'ArrowLeft', { shiftKey: true });
      press('ArrowUp', 'ArrowUp', { shiftKey: true });
      expect(calls).toEqual([
        'reset',
        'zoom-in',
        'zoom-in',
        'zoom-out',
        'zoom-in',
        'zoom-out',
        'rotate -1 0',
        'rotate 1 0',
        'rotate 0 1',
        'rotate 0 -1',
        'pan -1 0',
        'pan 0 1',
      ]);
      // Browser zoom (Ctrl + / −) is left alone.
      press('=', 'Equal', { ctrlKey: true });
      expect(calls).toHaveLength(12);
    });

    it('those keys do nothing outside the river view', async () => {
      await enterGameViaLevelSelect();
      setGame({ phase: 'playing', hud: { ...emptyHud() } });
      for (const k of ['Home', '+', '-', 'ArrowLeft']) press(k);
      setGame({ phase: 'complete', result: result() });
      for (const k of ['Home', '+', '-']) press(k);
      expect(calls).toEqual([]);
    });

    it('on a touch screen the chip explains touch gestures', async () => {
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => ({
        matches: q.includes('coarse'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      try {
        await viewing();
        const chip = container.querySelector('.riverview')!.textContent!;
        for (const s of ['Pinch', 'Two-finger drag', 'Double-tap']) expect(chip).toContain(s);
        expect(chip).not.toContain('Right-drag');
      } finally {
        window.matchMedia = original;
      }
    });
  });
});
