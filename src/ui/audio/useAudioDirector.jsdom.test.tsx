// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARCADE_CUE, CHAPTER_MIX, DUCK_PRESETS } from '../../audio/contract';
import { installAudioEngine } from '../../audio/game/engine';
import { RecordingAudioManager } from '../../audio/game/testing/recording';
import { defaultSettings, useAppStore } from '../../state/appStore';
import { useGameStore } from '../../state/gameStore';
import { useStoryStore } from '../../state/storyStore';
import { emptyProgress } from '../../state/progress';
import { CHAPTERS } from '../../story/chapters';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useStoryRun } from '../story/storyRun';
import {
  FOCUS_PREPARE_MS,
  isMuteKey,
  prepareSoundFor,
  resetPreviewThrottle,
  SOUND_OFF_TEXT,
  SOUND_ON_TEXT,
  useAudioDirector,
  useSoundAnnouncement,
} from './useAudioDirector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const text = useAudioDirector();
  return (
    <>
      <input data-testid="field" />
      <p role="status" aria-live="polite" data-testid="live">
        {text}
      </p>
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
let engine: RecordingAudioManager;
let uninstall: () => void;

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, ...init }));
  });

function mount(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
}

beforeEach(() => {
  localStorage.clear();
  engine = new RecordingAudioManager();
  uninstall = installAudioEngine(engine);
  useSoundAnnouncement.setState({ text: '' });
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  uninstall();
});

describe('the bake set is asked for as early as the next level is known', () => {
  const bellsOf = (): readonly string[] | undefined => engine.prepared.at(-1)?.bells;

  it("the main menu asks for the Play button's level, before any gesture", () => {
    useAppStore.setState({
      progress: { version: 1, completed: Object.fromEntries(['mountain-valley', 'rocky-canyon', 'alpine-pass'].map((id) => [id, { bestTime: 1, bestScore: 1, completions: 1 }])) },
    });
    mount(<Probe />);
    expect(engine.unlocks).toBe(0);
    expect(engine.prepared).toHaveLength(1);
    expect(bellsOf()).toEqual(['st-brides']); // Riverside Town, level 4
    // Pressing Play changes nothing: the set is already there, and the game screen asks for the same.
    act(() => useAppStore.setState({ screen: 'game', mode: 'arcade', levelId: 'riverside-town', attempt: 1 }));
    expect(engine.prepared).toHaveLength(1);
    // Retry keeps it.
    act(() => useAppStore.setState({ attempt: 2 }));
    expect(engine.prepared).toHaveLength(1);
  });

  it('the level select asks for the card in focus (the latest held for 200 ms wins)', () => {
    vi.useFakeTimers();
    try {
      mount(<Probe />);
      act(() => useAppStore.setState({ screen: 'levelSelect' }));
      const n = engine.prepared.length;
      prepareSoundFor('power-valley');
      prepareSoundFor('highland-maze');
      act(() => vi.advanceTimersByTime(FOCUS_PREPARE_MS - 1));
      expect(engine.prepared).toHaveLength(n);
      act(() => vi.advanceTimersByTime(1));
      expect(engine.prepared).toHaveLength(n + 1);
      expect(bellsOf()).toEqual(['clachan-kirk', 'loch-kirk']);
      // A focus belongs to its screen: back on the main menu, the Play target again.
      act(() => useAppStore.setState({ screen: 'mainMenu' }));
      expect(bellsOf()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the Story menu asks for the chapter to continue with, or the one in focus', () => {
    vi.useFakeTimers();
    try {
      useStoryStore.setState((st) => ({ progress: { ...st.progress, completed: ['ch1-beginning', 'ch2-measurements', 'ch3-warning'] } }));
      mount(<Probe />);
      act(() => useAppStore.setState({ screen: 'story', mode: 'story' }));
      expect(engine.prepared.at(-1)?.motifs.map((m) => m.variant)).toEqual(['act2']); // chapter 4
      expect(bellsOf()).toEqual(['st-brides']);
      prepareSoundFor('summit-labyrinth', 'ch9-last-thaw');
      act(() => vi.advanceTimersByTime(FOCUS_PREPARE_MS));
      expect(engine.prepared.at(-1)?.motifs.map((m) => m.variant)).toEqual(['act3-bare', 'epilogue']);
    } finally {
      vi.useRealTimers();
      useStoryStore.setState((st) => ({ progress: { ...st.progress, completed: [] } }));
    }
  });

  it('the loading overlay is passed on (bigger bake slices behind it), and taken back', () => {
    mount(<Probe />);
    act(() => useGameStore.setState({ phase: 'loading' }));
    expect(engine.loadingScreens).toEqual([]);
    act(() => useAppStore.setState({ screen: 'game', mode: 'arcade', levelId: 'mountain-valley', attempt: 1 }));
    expect(engine.loadingScreens).toEqual([true]);
    act(() => useGameStore.setState({ phase: 'intro' }));
    expect(engine.loadingScreens).toEqual([true, false]);
    // Retry: the store goes back to loading.
    act(() => useGameStore.setState({ phase: 'loading' }));
    act(() => useGameStore.setState({ phase: 'playing' }));
    act(() => useAppStore.setState({ screen: 'levelSelect' }));
    expect(engine.loadingScreens).toEqual([true, false, true, false]);
  });
});

describe('the sound director', () => {
  it('Arcade play gets its cue, 2 dB under the effects; menus are silent; Story chapters sit lower by act', () => {
    mount(<Probe />);
    expect(engine.music.cue).toBeNull();
    act(() => useAppStore.setState({ screen: 'game', mode: 'arcade', levelId: 'mountain-valley', attempt: 1 }));
    expect(engine.music.cue).toBe(ARCADE_CUE);
    expect(engine.music.trimDb).toBe(-2);
    expect(engine.prepared.at(-1)?.sounds).toContain('hit.wood');
    act(() => useAppStore.setState({ screen: 'levelSelect' }));
    expect(engine.music.cue).toBeNull();
    // The fade-out keeps the bed it had (no step up as the piece leaves).
    expect(engine.music.trimDb).toBe(-2);
    expect(engine.music.calls.slice(-3)).toEqual(['trim -2', 'cue wonder', 'cue null']);
    act(() => useAppStore.setState({ screen: 'storyIntro', mode: 'story', chapterId: 'ch4-people' }));
    expect(engine.music.cue).toBe('cost');
    expect(engine.music.trimDb).toBe(0);
    // The chapter's level is baked while its card is read.
    expect(engine.prepared.at(-1)?.bells).toEqual(['st-brides']);
    act(() => useAppStore.setState({ screen: 'game', levelId: 'riverside-town' }));
    expect(engine.music.trimDb).toBe(CHAPTER_MIX['ch4-people'].musicBedDb);
    // Lower by act: no chapter's bed above the one before it, and every act below the one before.
    const beds = CHAPTERS.map((c) => CHAPTER_MIX[c.id].musicBedDb);
    for (let i = 1; i < beds.length; i++) expect(beds[i], CHAPTERS[i].id).toBeLessThanOrEqual(beds[i - 1]);
    const byAct = (act: number) => CHAPTERS.filter((c) => c.act === act).map((c) => CHAPTER_MIX[c.id].musicBedDb);
    expect([1, 2, 3].map((a) => byAct(a).length)).toEqual([3, 3, 3]);
    expect(Math.max(...byAct(2))).toBeLessThan(Math.min(...byAct(1)));
    expect(Math.max(...byAct(3))).toBeLessThan(Math.min(...byAct(2)));
    // And the director passes each chapter's own bed in play.
    for (const c of CHAPTERS) {
      act(() => useAppStore.setState({ screen: 'game', mode: 'story', chapterId: c.id, levelId: c.levelId }));
      expect(engine.music.trimDb, c.id).toBe(CHAPTER_MIX[c.id].musicBedDb);
    }
  });

  it('Act III enters late: held from the moment the level is chosen, let go on leaving', () => {
    mount(<Probe />);
    act(() => useAppStore.setState({ screen: 'game', mode: 'story', chapterId: 'ch7-escape', levelId: 'ravine-run' }));
    expect(engine.music.holds.has('act3Entry')).toBe(true);
    act(() => useAppStore.setState({ screen: 'story' }));
    expect(engine.music.holds.has('act3Entry')).toBe(false);
    act(() => useAppStore.setState({ screen: 'game', chapterId: 'ch4-people', levelId: 'riverside-town' }));
    expect(engine.music.holds.size).toBe(0);
  });

  describe('the revelation ends with its run, on the same screen too', () => {
    const fragment = { id: 'f1', kind: 'letter', author: 'ruth-vey', title: 'Note left on the kitchen table', body: '' };
    const outcome = (chapterId: 'ch1-beginning' | 'ch2-measurements', completedAt: string) =>
      ({ chapterId, completedAt, evidence: {}, fragments: [fragment], narrative: { status: 'ready', reflection: {} } }) as unknown as NonNullable<
        ReturnType<typeof useStoryRun.getState>['outcome']
      >;
    const readingNow = () => engine.ducks.filter((d) => d.key === 'reading').at(-1)?.levels ?? null;
    /** Chapter 1 in play, then completed with a human document on screen. */
    function completeChapter1(narrative: boolean): void {
      useStoryStore.setState((st) => ({ progress: { ...st.progress, settings: { ...st.progress.settings, narrative } } }));
      mount(<Probe />);
      act(() => useGameStore.setState({ phase: 'playing', viewingRiver: false }));
      act(() => useAppStore.setState({ screen: 'game', mode: 'story', chapterId: 'ch1-beginning', levelId: 'mountain-valley', attempt: 1 }));
      act(() => useGameStore.setState({ phase: 'complete' }));
      act(() => useStoryRun.setState({ outcome: outcome('ch1-beginning', '2026-10-22T10:00:00Z') }));
      expect(readingNow()).toEqual(DUCK_PRESETS.reading.story);
    }
    afterEach(() => {
      useStoryRun.setState({ points: 0, outcome: null, epilogue: null });
      useStoryStore.setState((st) => ({ progress: { ...st.progress, settings: { ...st.progress.settings, narrative: true } } }));
    });

    it('Replay chapter (and R): the attempt is bumped, the outcome reset: the reading level, the hold and the motif go', () => {
      completeChapter1(true);
      expect(engine.music.holds.has('reveal')).toBe(true);
      expect(engine.motifs.map((m) => m.motif.variant)).toEqual(['act1']);
      // restartAttempt → appStore.restartLevel (screen stays 'game'), then attachStorySession and the load.
      act(() => useAppStore.getState().restartLevel());
      act(() => useStoryRun.setState({ points: 0, outcome: null, epilogue: null }));
      act(() => useGameStore.setState({ phase: 'loading' }));
      act(() => useGameStore.setState({ phase: 'playing' }));
      expect(useAppStore.getState().screen).toBe('game');
      expect(readingNow()).toBeNull();
      expect(engine.music.holds.size).toBe(0);
      expect(engine.motifs[0].stopped).toBe(1.5);
    });

    it('Continue to chapter 2 with narrative off: chapter 2 plays with no reading level left on', () => {
      completeChapter1(false);
      expect(engine.motifs).toHaveLength(0);
      act(() => useAppStore.setState({ chapterId: 'ch2-measurements', levelId: 'rocky-canyon', attempt: 2 }));
      act(() => useStoryRun.setState({ points: 0, outcome: null, epilogue: null }));
      act(() => useGameStore.setState({ phase: 'loading' }));
      act(() => useGameStore.setState({ phase: 'playing' }));
      expect(useAppStore.getState().screen).toBe('game');
      expect(readingNow()).toBeNull();
      expect(engine.ducks.filter((d) => d.levels !== null).map((d) => d.key)).toEqual(['reading']);
    });

    it('control: leaving the game screen releases it as before', () => {
      completeChapter1(true);
      act(() => useAppStore.setState({ screen: 'story' }));
      expect(readingNow()).toBeNull();
      expect(engine.music.holds.size).toBe(0);
    });
  });

  it('settings reach the engine as levels, on every change', () => {
    mount(<Probe />);
    expect(engine.settings.at(-1)).toEqual({ master: 1, music: 0.6, ambience: 0.8, effects: 0.8, musicMuted: false, soundMuted: false });
    act(() => useAppStore.getState().updateSettings({ effectsVolume: 0.25, masterVolume: 0.5 }));
    expect(engine.settings.at(-1)).toMatchObject({ master: 0.5, effects: 0.25 });
  });

  it('M mutes and unmutes all sound, saved, and announced; ignored in fields, with modifiers, on repeat, mid-transition', () => {
    mount(<Probe />);
    const live = () => container.querySelector('[data-testid="live"]')!.textContent;
    press('m');
    expect(useAppStore.getState().settings.soundMuted).toBe(true);
    expect(engine.settings.at(-1)?.soundMuted).toBe(true);
    expect(live()).toBe(SOUND_OFF_TEXT);
    expect(JSON.parse(localStorage.getItem('iceberg-river.settings.v1')!).soundMuted).toBe(true);
    press('M', { shiftKey: true });
    expect(useAppStore.getState().settings.soundMuted).toBe(false);
    expect(live()).toBe(SOUND_ON_TEXT);
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { repeat: true }]) press('m', init);
    press('m', {}, container.querySelector('[data-testid="field"]')!);
    act(() => useAppStore.setState({ transitioning: true }));
    press('m');
    expect(useAppStore.getState().settings.soundMuted).toBe(false);
  });

  it('M works with a Settings slider focused (letters mean nothing there), not where a letter is typed', () => {
    const el = (html: string): Element => {
      const box = document.createElement('div');
      box.innerHTML = html;
      return box.firstElementChild!;
    };
    const key = (target: Element): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key: 'm', code: 'KeyM' });
      Object.defineProperty(e, 'target', { value: target });
      return e;
    };
    for (const html of ['<input type="range">', '<input type="checkbox">', '<input type="radio">', '<button>Mute</button>']) expect(isMuteKey(key(el(html))), html).toBe(true);
    for (const html of ['<input>', '<input type="text">', '<input type="search">', '<input type="number">', '<textarea></textarea>', '<select><option>a</option></select>', '<div contenteditable="true"></div>']) {
      const t = el(html);
      if (html.includes('contenteditable')) Object.defineProperty(t, 'isContentEditable', { value: true });
      expect(isMuteKey(key(t)), html).toBe(false);
    }
    // On the real Settings screen: the Master volume slider focused, M mutes and is announced.
    mount(<SettingsScreen />);
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const probeRoot = createRoot(probe);
    act(() => probeRoot.render(<Probe />));
    const master = container.querySelectorAll<HTMLInputElement>('input[type="range"]')[1];
    master.focus();
    press('m', {}, master);
    expect(useAppStore.getState().settings.soundMuted).toBe(true);
    expect(probe.querySelector('[data-testid="live"]')!.textContent).toBe(SOUND_OFF_TEXT);
    act(() => probeRoot.unmount());
    probe.remove();
  });

  it('the same announcement twice in a row still changes the live region (so it is read again)', () => {
    mount(<Probe />);
    const live = () => container.querySelector('[data-testid="live"]')!.textContent;
    press('m');
    expect(live()).toBe(SOUND_OFF_TEXT);
    // Settings → Mute all sound switched it back on in between.
    act(() => useAppStore.getState().updateSettings({ soundMuted: false }));
    press('m');
    expect(useAppStore.getState().settings.soundMuted).toBe(true);
    expect(live()).not.toBe(SOUND_OFF_TEXT);
    expect(live()?.trim()).toBe(SOUND_OFF_TEXT);
  });

  it('under StrictMode one key press toggles once (one live subscription)', () => {
    mount(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    press('m');
    expect(useAppStore.getState().settings.soundMuted).toBe(true);
  });

  it('the first gesture unlocks audio; once the context runs the listeners are gone', () => {
    mount(<Probe />);
    expect(engine.unlocks).toBe(0);
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(engine.unlocks).toBe(1);
    expect(engine.status()).toBe('running');
    act(() => {
      window.dispatchEvent(new Event('click'));
      window.dispatchEvent(new Event('touchend'));
    });
    expect(engine.unlocks).toBe(1);
  });

  it('a hidden tab is passed on (the music pauses, the context suspends) and back', () => {
    mount(<Probe />);
    const set = (v: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    set('hidden');
    expect(engine.hidden).toBe(true);
    set('visible');
    expect(engine.hidden).toBe(false);
  });

  it('the Sound sliders are keyboard-reachable, labelled and read out in percent', () => {
    mount(<SettingsScreen />);
    const sliders = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]')).slice(1);
    expect(sliders).toHaveLength(4);
    for (const s of sliders) {
      expect(s.tabIndex).toBe(0);
      expect(s.disabled).toBe(false);
      expect(s.getAttribute('aria-valuetext')).toMatch(/^\d+ percent$/);
      expect(document.getElementById(s.getAttribute('aria-describedby')!)?.textContent?.length).toBeGreaterThan(10);
      s.focus();
      expect(document.activeElement).toBe(s);
    }
    const mute = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).at(-1)!;
    expect(document.getElementById(mute.getAttribute('aria-labelledby')!)?.textContent).toBe('Mute all sound');
  });

  it('releasing the Effects or Ambience slider previews that channel (at most every 0.4 s)', () => {
    resetPreviewThrottle();
    mount(<SettingsScreen />);
    const [master, music, ambience, effects] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="range"]')).slice(1);
    const previews = () => engine.calls.filter((c) => c.startsWith('preview'));
    const keyup = (el: HTMLElement, key: string) =>
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      });
    const pointerup = (el: HTMLElement) =>
      act(() => {
        el.dispatchEvent(new Event('pointerup', { bubbles: true }));
      });
    keyup(effects, 'ArrowLeft');
    expect(previews()).toEqual(['preview effects']);
    keyup(effects, 'ArrowLeft'); // within 0.4 s: throttled
    expect(previews()).toHaveLength(1);
    resetPreviewThrottle();
    pointerup(ambience);
    expect(previews()).toEqual(['preview effects', 'preview ambience']);
    resetPreviewThrottle();
    // Keys that do not move a slider, and the master and music sliders, preview nothing.
    keyup(effects, 'Tab');
    keyup(master, 'ArrowRight');
    pointerup(music);
    expect(previews()).toHaveLength(2);
  });

  it('the Mute all sound switch says what M does', () => {
    mount(<SettingsScreen />);
    const mute = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).at(-1)!;
    expect(document.getElementById(mute.getAttribute('aria-labelledby')!)?.textContent).toBe('Mute all sound');
    expect(document.getElementById(mute.getAttribute('aria-describedby')!)?.textContent).toContain('Shortcut: M');
  });
});
