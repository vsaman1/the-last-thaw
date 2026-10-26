// @vitest-environment jsdom
/**
 * Story Mode UI smoke tests (jsdom, like App.test.tsx): menus and unlocking, the chapter card, the
 * Points guide (pause menu and chapter list), the in-game additions (Topple points), the ARCHIVE
 * REVELATION panel replacing LEVEL COMPLETE (and
 * Arcade keeping it), the fail panel, continuing, the epilogue over the river view, and the reading
 * screens. GameView is mocked (no WebGL in jsdom); the story bridge is driven through its store.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStats } from '../../core/types';
import { registerSession } from '../../game/controller';
import { defaultSettings, TRANSITION_MS, useAppStore } from '../../state/appStore';
import { emptyHud, useGameStore } from '../../state/gameStore';
import { emptyProgress } from '../../state/progress';
import { emptyStoryProgress, sanitizeStoryProgress, STORY_KEY, useStoryStore } from '../../state/storyStore';
import { CHAPTERS } from '../../story/chapters';
import { evidenceFixture } from '../../story/fixtures';
import { CUE_TRACKS } from '../../audio/tracks';
import { CLIMATE_FACTS } from '../../story/science';
import { STORY_POINTS } from '../../story/scoring';
import { composeEpilogue, documentAuthor, historyBefore } from '../../story/select';
import type { ArchiveFragment, ChapterId, NarrativeResult } from '../../story/types';
import { App } from '../App';
import { formatInt } from '../format';
import { AI_LABEL, AUTHORED_LABEL } from './parts';
import { StoryLandmarkNotice } from './StoryGame';
import { LANDMARK_NOTICE_MS, useStoryRun, type RunOutcome } from './storyRun';

vi.mock('../../render/GameView', () => ({
  GameView: ({ levelId, attempt, story }: { levelId: string; attempt: number; story?: { level: { id: string } } }) => (
    <div data-testid="gameview" data-level={levelId} data-attempt={attempt} data-story-level={story?.level.id ?? ''} />
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const session = {
  pause: vi.fn(() => useGameStore.setState({ phase: 'paused' })),
  resume: vi.fn(() => useGameStore.setState({ phase: 'playing' })),
  skipIntro: vi.fn(() => useGameStore.setState({ phase: 'playing' })),
};

const text = (): string => container.textContent ?? '';
const buttons = (): HTMLButtonElement[] => Array.from(container.querySelectorAll('button'));
function button(name: string): HTMLButtonElement {
  const b = buttons().find((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().startsWith(name));
  if (!b) throw new Error(`No button "${name}". Buttons: ${buttons().map((x) => x.textContent).join(' | ')}`);
  return b;
}
const click = (el: HTMLElement) => act(() => el.click());
const press = (key: string) =>
  act(() => {
    (document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
const setGame = (patch: Partial<ReturnType<typeof useGameStore.getState>>) => act(() => useGameStore.setState(patch));

const ch = (i: number) => CHAPTERS[i];
const stats = (): RunStats => ({
  levelId: ch(0).levelId,
  time: 80,
  distance: 900,
  topSpeed: 20,
  knockedDown: 3,
  buildingsDestroyed: 1,
  treesFelled: 2,
  waterfallsCrossed: 1,
  collisions: 4,
  iceLeft: 0.8,
  absorbed: 0,
  peakMass: 30,
  score: 4321,
});

const fragment: ArchiveFragment = {
  id: 'test-letter',
  chapterId: 'ch1-beginning',
  kind: 'letter',
  title: 'A letter about the mill',
  date: 'March 2031',
  body: 'The mill wheel turned all winter.',
  when: { always: true },
  priority: 1,
};

function enterStoryGame(chapterId: ChapterId): void {
  const c = CHAPTERS.find((x) => x.id === chapterId)!;
  act(() =>
    useAppStore.setState((s) => ({ screen: 'game', mode: 'story', chapterId, levelId: c.levelId, attempt: s.attempt + 1 })),
  );
}

function completeWith(outcome: Partial<RunOutcome> = {}, chapterId: ChapterId = 'ch1-beginning'): void {
  const evidence = evidenceFixture({ chapterId });
  act(() =>
    useStoryRun.setState({
      points: evidence.storyPoints,
      outcome: {
        chapterId,
        completedAt: '2026-10-21T10:00:00.000Z',
        evidence,
        fragments: [fragment],
        narrative: {
          status: 'ready',
          reflection: { source: 'authored', title: 'What stayed', text: 'An authored reflection.', fragmentIds: [], factIds: [] },
        },
        ...outcome,
      },
    }),
  );
  setGame({ phase: 'complete', result: stats() });
}

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
  useStoryRun.setState({ points: 0, outcome: null, epilogue: null, failedDocument: null });
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('story menus', () => {
  it('main menu → chapters: chapter 1 open, later chapters locked; Begin opens the chapter card', () => {
    click(button('Story Mode — The Last Thaw'));
    expect(useAppStore.getState().screen).toBe('story');
    expect(text()).toContain('The Last Thaw');
    expect(text()).toContain('0 of 9 chapters archived');
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.story-chapter__btn'));
    expect(rows).toHaveLength(9);
    expect(rows[0].disabled).toBe(false);
    expect(rows.slice(1).every((r) => r.disabled)).toBe(true);
    expect(rows[1].getAttribute('aria-label')).toContain('Locked');
    click(button('Begin'));
    expect(useAppStore.getState()).toMatchObject({ screen: 'storyIntro', mode: 'story', chapterId: 'ch1-beginning' });
  });

  it('chapter 1 card: light-hearted Topple points cards, no points table; Begin plays the story level', async () => {
    act(() => useAppStore.getState().openChapter('ch1-beginning'));
    expect(text()).toContain(ch(0).title);
    const tutorial = container.querySelector('.story-tutorial')!;
    expect(tutorial.querySelector('h2')?.textContent).toBe('How to play');
    expect(tutorial.textContent).toContain('Topple points');
    expect(tutorial.textContent).toContain('Points guide');
    // The per-structure numbers live in the Points guide now, not on the card.
    expect(container.querySelector('table')).toBeNull();
    expect(text()).not.toContain(formatInt(STORY_POINTS.oilRig));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(button('Begin'));
    await act(async () => {
      vi.advanceTimersByTime(TRANSITION_MS);
    });
    vi.useRealTimers();
    expect(useAppStore.getState()).toMatchObject({ screen: 'game', mode: 'story', levelId: ch(0).levelId });
    const view = container.querySelector('[data-testid="gameview"]')!;
    expect(view.getAttribute('data-level')).toBe(ch(0).levelId);
    // The view is handed the chapter's story level (its own id once the chapter adds an overlay).
    expect(view.getAttribute('data-story-level')).toContain(ch(0).levelId);
  });

  it('a completed chapter unlocks the next and offers replay; narrative off plays without the card', async () => {
    act(() =>
      useStoryStore.getState().recordChapter({
        chapterId: 'ch1-beginning',
        completedAt: '2026-10-21T10:00:00.000Z',
        evidence: evidenceFixture(),
        fragmentIds: [],
        reflection: { source: 'authored', text: 'x', fragmentIds: [], factIds: [] },
      }),
    );
    act(() => useStoryStore.getState().updateStorySettings({ narrative: false }));
    act(() => useAppStore.getState().goTo('story'));
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.story-chapter__btn'));
    expect(rows[0].textContent).toContain('Replay');
    expect(rows[0].textContent).toContain(`${formatInt(evidenceFixture().storyPoints)} Topple points`);
    expect(rows[0].getAttribute('aria-label')).toContain(`${evidenceFixture().storyPoints} Topple points. Replay`);
    expect(rows[1].disabled).toBe(false);
    expect(rows[2].disabled).toBe(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(rows[1]);
    expect(useAppStore.getState().transitioning).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(TRANSITION_MS);
    });
    vi.useRealTimers();
    expect(useAppStore.getState()).toMatchObject({ screen: 'game', mode: 'story', chapterId: 'ch2-measurements' });
  });

  it('the chapter list opens the Points guide below its buttons; Escape closes it before leaving', () => {
    act(() => useAppStore.getState().goTo('story'));
    const open = button('Points guide');
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#story-points-guide')).toBeNull();
    act(() => open.focus());
    click(open);
    const guide = container.querySelector<HTMLElement>('#story-points-guide')!;
    expect(guide).not.toBeNull();
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('aria-controls')).toBe('story-points-guide');
    expect(document.activeElement?.id).toBe('story-guide-title');
    expect(guide.textContent).toContain('The big ones');
    expect(guide.textContent).toContain('Oil rig');
    expect(guide.textContent).toContain(formatInt(STORY_POINTS.oilRig));
    press('Escape');
    expect(useAppStore.getState().screen).toBe('story');
    expect(container.querySelector('#story-points-guide')).toBeNull();
    expect(document.activeElement).toBe(button('Points guide'));
    // Close by its own button too; then Escape leaves as before.
    click(button('Points guide'));
    click(button('Close the guide'));
    expect(container.querySelector('#story-points-guide')).toBeNull();
    expect(document.activeElement).toBe(button('Points guide'));
    press('Escape');
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });

  it('Start over asks first, then clears every chapter and the epilogue but keeps the settings', () => {
    act(() => useAppStore.getState().goTo('story'));
    // Nothing to start over from yet.
    expect(buttons().some((b) => b.textContent?.startsWith('Start over'))).toBe(false);
    for (const chapterId of ['ch1-beginning', 'ch2-measurements'] as const) {
      act(() => {
        useStoryStore.getState().recordChapter({
          chapterId,
          completedAt: '2026-10-21T10:00:00.000Z',
          evidence: evidenceFixture({ chapterId }),
          fragmentIds: [],
          reflection: { source: 'authored', text: 'x', fragmentIds: [], factIds: [] },
        });
      });
    }
    act(() => {
      useStoryStore.getState().recordFailure('ch3-warning');
      useStoryStore.getState().setEpilogue({ source: 'authored', text: 'The end.', fragmentIds: [], factIds: [] });
      useStoryStore.getState().updateStorySettings({ narrative: false, ai: 'off' });
    });
    expect(text()).toContain('2 of 9 chapters archived');

    // Cancel leaves everything as it was and hands focus back.
    click(button('Start over'));
    expect(text()).toContain('Start the story again from chapter 1?');
    expect(document.activeElement?.textContent).toBe('Cancel');
    click(button('Cancel'));
    expect(text()).not.toContain('Start the story again from chapter 1?');
    expect(useStoryStore.getState().progress.completed).toHaveLength(2);
    expect(document.activeElement?.textContent).toBe('Start over…');

    click(button('Start over'));
    click(button('Yes, start over'));
    const { progress, failures } = useStoryStore.getState();
    expect(progress.completed).toEqual([]);
    expect(progress.archive).toEqual([]);
    expect(progress.epilogue).toBeNull();
    expect(failures).toEqual({});
    expect(progress.settings).toEqual({ narrative: false, ai: 'off', model: 'gpt-6-luna' });
    // Saved too: a reload starts from chapter 1.
    expect(sanitizeStoryProgress(JSON.parse(localStorage.getItem(STORY_KEY)!)).completed).toEqual([]);
    expect(text()).toContain('0 of 9 chapters archived');
    expect(text()).toContain('The story starts again from chapter 1.');
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.story-chapter__btn'));
    expect(rows[0].disabled).toBe(false);
    expect(rows.slice(1).every((r) => r.disabled)).toBe(true);
    expect(buttons().some((b) => b.textContent?.startsWith('Start over'))).toBe(false);
    expect(buttons().some((b) => b.textContent === 'Epilogue')).toBe(false);
    expect(document.activeElement?.textContent).toContain('Begin');
  });

  it('Escape while Start over asks cancels the question instead of leaving the chapter list', () => {
    act(() =>
      useStoryStore.getState().recordChapter({
        chapterId: 'ch1-beginning',
        completedAt: '2026-10-21T10:00:00.000Z',
        evidence: evidenceFixture(),
        fragmentIds: [],
        reflection: { source: 'authored', text: 'x', fragmentIds: [], factIds: [] },
      }),
    );
    act(() => useAppStore.getState().goTo('story'));
    click(button('Start over'));
    expect(document.activeElement?.textContent).toBe('Cancel');
    press('Escape');
    expect(useAppStore.getState().screen).toBe('story');
    expect(text()).not.toContain('Start the story again from chapter 1?');
    expect(useStoryStore.getState().progress.completed).toEqual(['ch1-beginning']);
    expect(document.activeElement?.textContent).toBe('Start over…');
    // With the question closed, Escape leaves as before.
    press('Escape');
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });
});

describe('story in the game screen', () => {
  it('during play: the chapter label and a points counter; Arcade has neither', () => {
    enterStoryGame('ch1-beginning');
    setGame({ phase: 'playing' });
    act(() => useStoryRun.setState({ points: 1250 }));
    const hud = container.querySelector('.hud')!;
    expect(hud.textContent).toContain(`Chapter 1 · ${ch(0).title}`);
    expect(container.querySelector('.hud__story-points dt')?.textContent).toBe('Topple points');
    expect(container.querySelector('.hud__story-points dd')?.textContent).toBe('1,250');

    act(() => useAppStore.getState().playLevel(ch(0).levelId));
    setGame({ phase: 'playing' });
    expect(container.querySelector('.hud__story-points')).toBeNull();
    expect(container.querySelector('.hud')!.textContent).toContain('Level 1');
  });

  it('during play: a named place that breaks is named in a brief notice with its label', () => {
    vi.useFakeTimers();
    try {
      enterStoryGame('ch7-escape');
      setGame({ phase: 'playing' });
      expect(container.querySelector('[data-testid="story-landmark"]')).toBeNull();
      act(() =>
        useStoryRun.setState({
          landmark: {
            id: 'mesa-plant',
            name: 'The Calder processing plant',
            label: 'Calder processing plant · holds the oil field\'s waste water',
            seq: 1,
            until: Date.now() + LANDMARK_NOTICE_MS,
          },
        }),
      );
      const notice = container.querySelector('[data-testid="story-landmark"]');
      expect(notice?.getAttribute('role')).toBe('status');
      expect(notice?.textContent).toContain('Broken');
      expect(notice?.textContent).toContain('The Calder processing plant');
      expect(notice?.textContent).toContain('holds the oil field\'s waste water');
      // It goes by itself and never takes focus.
      expect(document.activeElement?.closest('[data-testid="story-landmark"]')).toBeNull();
      act(() => vi.advanceTimersByTime(5000));
      expect(container.querySelector('[data-testid="story-landmark"]')).toBeNull();
    } finally {
      vi.useRealTimers();
      act(() => useStoryRun.setState({ landmark: null }));
    }
  });

  it('during play: a pause never brings back a landmark notice that has gone (playtest 2 follow-up)', () => {
    vi.useFakeTimers();
    try {
      enterStoryGame('ch8-remains');
      setGame({ phase: 'playing' });
      act(() =>
        useStoryRun.setState({
          landmark: { id: 'bothy', name: 'The shepherd\'s hut above the Leap', seq: 1, until: Date.now() + LANDMARK_NOTICE_MS },
        }),
      );
      expect(container.querySelector('[data-testid="story-landmark"]')?.textContent).toContain('shepherd');
      act(() => vi.advanceTimersByTime(LANDMARK_NOTICE_MS + 500));
      expect(container.querySelector('[data-testid="story-landmark"]')).toBeNull();
      // 14 s later the player pauses and resumes: the hut is still the run's last landmark, but its
      // notice has had its time.
      act(() => vi.advanceTimersByTime(14_000));
      setGame({ phase: 'paused' });
      setGame({ phase: 'playing' });
      expect(container.querySelector('[data-testid="story-landmark"]')).toBeNull();
      // A pause while a notice is up keeps it mounted (hidden by CSS) and it still goes on time.
      act(() =>
        useStoryRun.setState({
          landmark: { id: 'loch-kirk', name: 'The loch kirk', seq: 2, until: Date.now() + LANDMARK_NOTICE_MS },
        }),
      );
      act(() => vi.advanceTimersByTime(1000));
      setGame({ phase: 'paused' });
      expect(container.querySelector('[data-testid="story-landmark"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(4000));
      setGame({ phase: 'playing' });
      expect(container.querySelector('[data-testid="story-landmark"]')).toBeNull();
    } finally {
      vi.useRealTimers();
      act(() => useStoryRun.setState({ landmark: null }));
    }
  });

  it('a landmark notice mounted again after its time shows nothing; within its time, only what is left', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    try {
      act(() => useStoryStore.getState().updateStorySettings({ narrative: true }));
      act(() =>
        useStoryRun.setState({
          landmark: { id: 'mesa-plant', name: 'The Calder processing plant', seq: 1, until: Date.now() + LANDMARK_NOTICE_MS },
        }),
      );
      act(() => r.render(<StoryLandmarkNotice />));
      expect(host.querySelector('[data-testid="story-landmark"]')).not.toBeNull();
      act(() => r.render(<></>));
      act(() => vi.advanceTimersByTime(2000));
      // Remounted 2 s in: shown, with its fade carried on from 2 s, and gone 2.5 s later.
      act(() => r.render(<StoryLandmarkNotice />));
      const el = host.querySelector<HTMLElement>('[data-testid="story-landmark"]');
      expect(el).not.toBeNull();
      expect(el?.style.animationDelay).toBe('-2000ms');
      act(() => vi.advanceTimersByTime(2600));
      expect(host.querySelector('[data-testid="story-landmark"]')).toBeNull();
      // Unmounted and mounted again after its time: nothing.
      act(() => r.render(<></>));
      act(() => vi.advanceTimersByTime(10_000));
      act(() => r.render(<StoryLandmarkNotice />));
      expect(host.querySelector('[data-testid="story-landmark"]')).toBeNull();
    } finally {
      act(() => r.unmount());
      host.remove();
      vi.useRealTimers();
      act(() => useStoryRun.setState({ landmark: null }));
    }
  });

  it('pause menu: the Points guide lists every structure and its Topple points; Escape closes it, not the pause', () => {
    enterStoryGame('ch1-beginning');
    setGame({ phase: 'paused' });
    expect(text()).toContain('PAUSED');
    const open = button('Points guide');
    act(() => open.focus());
    click(open);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="points-guide-title"]')!;
    expect(dialog).not.toBeNull();
    expect(text()).not.toContain('PAUSED');
    expect(document.activeElement?.id).toBe('points-guide-title');
    expect(dialog.textContent).toContain(`Chapter 1 · ${ch(0).title}`);
    // Every structure that topples, by name, with its real points; nothing harsh in the wording.
    const rows = Array.from(dialog.querySelectorAll('.points-guide__list > div')).map((d) => [
      d.querySelector('dt')?.textContent,
      d.querySelector('dd')?.textContent,
    ]);
    expect(rows).toContainEqual(['Oil rig', `${formatInt(STORY_POINTS.oilRig)} points`]);
    expect(rows).toContainEqual(['Fence', `${formatInt(STORY_POINTS.fence)} points`]);
    expect(rows).toContainEqual(['Pine tree', `${formatInt(STORY_POINTS.pine)} points`]);
    expect(rows.length).toBe(Object.values(STORY_POINTS).filter((p) => p > 0).length);
    expect(dialog.textContent).toContain('Rocks, glacier ice, parked cars and stone walls are pushed aside, never toppled');
    expect(rows.map(([name]) => name)).not.toContain('Car');
    expect(rows.map(([name]) => name)).not.toContain('Stone wall');
    expect(dialog.textContent).not.toMatch(/destr|harm/i);
    const resumes = session.resume.mock.calls.length;
    press('Escape');
    expect(useGameStore.getState().phase).toBe('paused');
    expect(session.resume.mock.calls.length).toBe(resumes);
    expect(text()).toContain('PAUSED');
    expect(document.activeElement?.textContent).toBe('Points guide');
    // Back from the guide by its button too; then Escape resumes as before.
    click(button('Points guide'));
    click(button('Back'));
    expect(text()).toContain('PAUSED');
    expect(document.activeElement?.textContent).toBe('Points guide');
    press('Escape');
    expect(session.resume.mock.calls.length).toBe(resumes + 1);

    // Arcade's pause menu has no Points guide (its score is not Topple points).
    act(() => useAppStore.getState().playLevel(ch(0).levelId));
    setGame({ phase: 'paused' });
    expect(text()).toContain('PAUSED');
    expect(buttons().some((b) => b.textContent === 'Points guide')).toBe(false);
  });

  it('Act I speaks of Topple points, never of destruction or harm (UI and copy; archive documents aside)', () => {
    const chrome = (): string => {
      const copy = container.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.story-doc').forEach((d) => d.remove());
      return copy.textContent ?? '';
    };
    const HARSH = /destr|harm/i;
    for (const c of CHAPTERS.filter((x) => x.act === 1)) {
      act(() => useAppStore.getState().openChapter(c.id));
      expect(chrome(), `${c.id} card`).not.toMatch(HARSH);
      enterStoryGame(c.id);
      setGame({ phase: 'playing' });
      expect(chrome(), `${c.id} HUD`).not.toMatch(HARSH);
      setGame({ phase: 'paused' });
      click(button('Points guide'));
      expect(chrome(), `${c.id} guide`).not.toMatch(HARSH);
      completeWith({ fragments: [] }, c.id);
      expect(chrome(), `${c.id} revelation`).toContain('Topple points');
      expect(chrome(), `${c.id} revelation`).not.toMatch(HARSH);
    }
  });

  it('completion: the ARCHIVE REVELATION replaces LEVEL COMPLETE (fragments, then the labelled reflection)', () => {
    enterStoryGame('ch1-beginning');
    completeWith();
    expect(text()).toContain('What the archive kept');
    expect(text()).not.toContain('LEVEL COMPLETE');
    expect(text()).toContain('A letter about the mill');
    expect(text()).toContain('Letter · March 2031');
    expect(text()).toContain('An authored reflection.');
    expect(text()).toContain(AUTHORED_LABEL);
    expect(text()).not.toContain(AI_LABEL);
    expect(text().indexOf('A letter about the mill')).toBeLessThan(text().indexOf('An authored reflection.'));
    // Arcade still gets its own panel.
    act(() => useAppStore.getState().playLevel(ch(0).levelId));
    setGame({ phase: 'complete', result: stats() });
    expect(text()).toContain('LEVEL COMPLETE');
    expect(text()).not.toContain('What the archive kept');
  });

  it('an approved AI reflection carries its label and the "How this was made" record', () => {
    const result: NarrativeResult = {
      ok: true,
      source: 'ai',
      runId: 'trace-1',
      text: 'Written by the agents.',
      fragmentIds: [],
      factIds: [],
      claims: [],
      review: { verdict: 'corrected', rounds: 2, issues: ['Removed "spared": the run never reached it.'] },
      validation: { passed: true, checked: 4 },
      toolCalls: [{ agent: 'archivist', tool: 'get_run_summary', args: {}, ok: true, ms: 12 }],
      usage: [
        { ts: '', runId: 'trace-1', agent: 'archivist', model: 'm', inputTokens: 1200, cachedInputTokens: 0, outputTokens: 300, requests: 2, toolCalls: 1, durationMs: 900, costUsd: 0.0003, ok: true },
      ],
    };
    enterStoryGame('ch1-beginning');
    completeWith({
      narrative: { status: 'ready', reflection: { source: 'ai', text: result.text, fragmentIds: [], factIds: [] }, result },
    });
    expect(text()).toContain(AI_LABEL);
    const details = container.querySelector('details.story-how')!;
    expect(details.textContent).toContain('How this was made');
    expect(details.textContent).toContain('get_run_summary');
    expect(details.textContent).toContain('approved after corrections');
    expect(details.textContent).toContain('Removed "spared"');
    expect(details.textContent).toContain('1,200');

    // Each table sits in its own focusable, labelled box (on a phone it scrolls there, not the panel),
    // and a box that overflows scrolls itself on ← / → instead of handing the keys to the game.
    const boxes = Array.from(details.querySelectorAll<HTMLDivElement>('.story-table-wrap'));
    expect(boxes.map((b) => [b.getAttribute('role'), b.tabIndex, document.getElementById(b.getAttribute('aria-labelledby')!)?.textContent])).toEqual([
      ['region', 0, 'Tool calls'],
      ['region', 0, 'Token usage'],
    ]);
    const box = boxes[1];
    Object.defineProperty(box, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 300 });
    const seenByWindow = vi.fn();
    window.addEventListener('keydown', seenByWindow);
    try {
      act(() => box.focus());
      press('ArrowRight');
      expect(box.scrollLeft).toBe(75);
      expect(seenByWindow).not.toHaveBeenCalled();
      press('ArrowLeft');
      expect(box.scrollLeft).toBe(0);
    } finally {
      window.removeEventListener('keydown', seenByWindow);
    }
  });

  it('while the agents write, the authored text shows, marked as waiting', () => {
    enterStoryGame('ch1-beginning');
    completeWith({
      narrative: { status: 'pending', reflection: { source: 'authored', text: 'Meanwhile.', fragmentIds: [], factIds: [] } },
    });
    expect(text()).toContain('Meanwhile.');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(text()).toContain('The Archivist is writing');
  });

  it("when the chosen model cannot run, the authored text shows with the server's reason", () => {
    const message =
      'gpt-6-sol is not available: OPENAI_API_KEY not set (gpt-6-sol runs only on your own OpenAI key, billed to you). Nothing was sent to any model.';
    enterStoryGame('ch1-beginning');
    completeWith({
      narrative: {
        status: 'ready',
        reflection: { source: 'authored', text: 'Written in advance.', fragmentIds: [], factIds: [] },
        failure: { ok: false, runId: 'r', reason: 'unavailable', message, fallback: true, usage: [] },
      },
    });
    expect(text()).toContain('Written in advance.');
    expect(text()).toContain(AUTHORED_LABEL);
    expect(text()).toContain("The agents' reflection is not shown (the agent service is not available)");
    expect(text()).toContain(message);
    // A daily limit reached reads the same way; other failures keep their message to themselves.
    completeWith({
      narrative: {
        status: 'ready',
        reflection: { source: 'authored', text: 'Written in advance.', fragmentIds: [], factIds: [] },
        failure: { ok: false, runId: 'r', reason: 'budget', message: "today's spending on your own OpenAI key reached OPENAI_DAILY_USD_LIMIT", fallback: true, usage: [] },
      },
    });
    expect(text()).toContain('reached OPENAI_DAILY_USD_LIMIT');
    completeWith({
      narrative: {
        status: 'ready',
        reflection: { source: 'authored', text: 'Written in advance.', fragmentIds: [], factIds: [] },
        failure: { ok: false, runId: 'r', reason: 'error', message: 'HTTP 502: upstream text', fallback: true, usage: [] },
      },
    });
    expect(text()).toContain('(the request failed)');
    expect(text()).not.toContain('upstream text');
  });

  it('the run facts count built structures only: felled trees are a fact of their own', () => {
    const fact = (label: string): string | null | undefined => {
      const row = Array.from(container.querySelectorAll('.story-facts__grid > div')).find(
        (d) => d.querySelector('dt')?.textContent === label,
      );
      return row?.querySelector('dd')?.textContent;
    };
    enterStoryGame('ch1-beginning');
    // A run through the pines that broke no building (a real chapter 1 lane gives exactly this).
    const evidence = evidenceFixture({
      treesFelled: 3,
      buildingsDestroyed: 0,
      destroyedByCategory: { nature: 3 },
      destroyedByKind: { pine: 2, broadleaf: 1 },
    });
    completeWith({ evidence });
    expect(fact('Structures toppled')).toBe('0');
    expect(fact('Trees felled')).toBe('3');
    expect(container.querySelector('.story-facts__line')?.textContent).toContain('2 × pine tree (trees and land)');

    // The fixture's mixed run: one house, two pines.
    completeWith();
    expect(fact('Structures toppled')).toBe('1');
    expect(fact('Trees felled')).toBe('2');
    expect(fact('Topple points')).toBe(formatInt(evidenceFixture().storyPoints));
  });

  it('narrative off: no documents or reflection, still the points and the buttons', () => {
    act(() => useStoryStore.getState().updateStorySettings({ narrative: false }));
    enterStoryGame('ch1-beginning');
    completeWith();
    expect(text()).toContain('Chapter complete');
    expect(text()).not.toContain('A letter about the mill');
    expect(text()).toContain('Topple points');
    expect(text()).not.toContain('story points');
    button('Replay chapter');
  });

  it('Continue opens the next chapter card; Replay starts a new attempt', () => {
    enterStoryGame('ch1-beginning');
    completeWith();
    const attempt = useAppStore.getState().attempt;
    click(button('Replay chapter'));
    expect(useAppStore.getState().attempt).toBe(attempt + 1);
    completeWith();
    click(button('Continue to chapter 2'));
    expect(useAppStore.getState()).toMatchObject({ screen: 'storyIntro', chapterId: 'ch2-measurements' });
  });

  it('a failed run shows the story fail panel; Retry and the pause menu route stay in Story Mode', () => {
    enterStoryGame('ch1-beginning');
    setGame({ phase: 'failed', failReason: 'stuck' });
    expect(text()).toContain('The river stopped here');
    const attempt = useAppStore.getState().attempt;
    click(button('Retry'));
    expect(useAppStore.getState().attempt).toBe(attempt + 1);
    // The pause menu's "Level Select" leads back to the chapters in Story Mode.
    act(() => useAppStore.getState().goTo('levelSelect'));
    expect(useAppStore.getState().screen).toBe('story');
  });

  it("a failed run's one record is shown on the fail panel, not archived, and only with the story text on", () => {
    enterStoryGame('ch3-warning');
    const doc = ch(2).fragments.find((f) => f.id === 'ch3-annex-c')!;
    act(() => useStoryRun.setState({ failedDocument: doc }));
    setGame({ phase: 'failed', failReason: 'fell' });
    const shown = container.querySelector('[data-testid="story-fail-doc"]');
    expect(shown?.textContent).toContain(doc.title);
    expect(shown?.textContent).toContain('It is not kept in the archive');
    expect(text()).toContain('Nothing is archived until a run reaches the sea.');
    expect(useStoryStore.getState().progress.archive).toHaveLength(0);
    // Retry still comes first among the actions.
    expect(container.querySelector('.story-actions button')?.textContent).toContain('Retry');
    // Story text off: the panel is the plain one.
    act(() => useStoryStore.getState().updateStorySettings({ narrative: false }));
    expect(container.querySelector('[data-testid="story-fail-doc"]')).toBeNull();
    // A record of another chapter (a stale state) is never shown.
    act(() => useStoryStore.getState().updateStorySettings({ narrative: true }));
    act(() => useStoryRun.setState({ failedDocument: ch(0).fragments.find((f) => f.id === 'ch1-turned-back')! }));
    expect(container.querySelector('[data-testid="story-fail-doc"]')).toBeNull();
  });

  it('after chapter 9, Continue starts the epilogue over the river view', () => {
    enterStoryGame('ch9-last-thaw');
    completeWith({}, 'ch9-last-thaw');
    const cont = button('Continue to the epilogue');
    act(() => cont.focus());
    click(cont);
    expect(useGameStore.getState().viewingRiver).toBe(true);
    const ep = container.querySelector('.story-epilogue')!;
    expect(ep).not.toBeNull();
    expect(ep.textContent).toContain('Epilogue');
    expect(useStoryStore.getState().progress.epilogue).not.toBeNull();
    // Focus does not fall to <body> with the panel it was on: it starts at the epilogue's title, inside
    // the box that scrolls, so screen readers read the heading and PageDown pages through the text.
    const title = ep.querySelector<HTMLElement>('.story-epilogue__scroll #epilogue-title')!;
    expect(title).not.toBeNull();
    expect(document.activeElement).toBe(title);
    expect(title.tabIndex).toBe(-1);
    // Back to the record and into the river view again: the title takes focus each time it appears.
    click(button('Back to the record'));
    expect(document.activeElement?.id).toBe('reveal-title');
    act(() => useGameStore.setState({ viewingRiver: true }));
    expect(document.activeElement?.id).toBe('epilogue-title');
  });
});

describe('the epilogue, end to end', () => {
  it('chapter 9 → river view with the composed epilogue (AI off) → stored in the Archive → reread after a reload', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      act(() => useStoryStore.getState().updateStorySettings({ ai: 'off' }));
      // Chapters 1–8 archived (the history the epilogue draws on), then chapter 9 completes.
      act(() => {
        for (const c of CHAPTERS.slice(0, 8)) {
          useStoryStore.getState().recordChapter({
            chapterId: c.id,
            completedAt: `2026-10-${10 + c.index}T10:00:00.000Z`,
            evidence: evidenceFixture({ chapterId: c.id, levelId: c.levelId, landmarks: c.landmarks.map((l) => ({ id: l.id, status: 'destroyed', closest: 0 })) }),
            fragmentIds: [],
            reflection: { source: 'authored', text: `Chapter ${c.index} kept.`, fragmentIds: [], factIds: [] },
          });
        }
      });
      const c9 = ch(8);
      const evidence = evidenceFixture({ chapterId: c9.id, levelId: c9.levelId, landmarks: c9.landmarks.map((l) => ({ id: l.id, status: 'intact', closest: 20 })) });
      enterStoryGame(c9.id);
      completeWith({ evidence, fragments: [] }, c9.id);
      expect(text()).toContain('Continue to the epilogue');

      click(button('Continue to the epilogue'));
      // The river view (the camera's whole-river framing down to the sea) with the epilogue over it.
      expect(useGameStore.getState().viewingRiver).toBe(true);
      const expected = composeEpilogue(evidence, historyBefore(useStoryStore.getState().progress.archive, c9.id));
      expect(expected.source).toBe('authored');
      const ep = container.querySelector('.story-epilogue')!;
      expect(ep).not.toBeNull();
      expect(ep.querySelector('[aria-busy="true"]')).toBeNull(); // AI off: nothing pending
      expect(ep.textContent).toContain(AUTHORED_LABEL);
      const paras = Array.from(ep.querySelectorAll('.story-reflection__text')).map((p) => p.textContent);
      expect(paras.join('\n\n')).toBe(expected.text);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Stored in the Archive, and readable there.
      expect(useStoryStore.getState().progress.epilogue).toEqual(expected);
      click(button('Open the archive'));
      expect(useAppStore.getState().screen).toBe('archive');
      const entry = container.querySelector('[aria-labelledby="entry-epilogue"]')!;
      expect(entry.textContent).toContain(expected.text.split(/\n{2,}/)[0]);

      // After a reload: the stored copy repairs to the same epilogue; the chapter list offers it again.
      const stored = sanitizeStoryProgress(JSON.parse(localStorage.getItem(STORY_KEY) ?? 'null'));
      expect(stored.epilogue).toEqual(expected);
      act(() => useStoryStore.setState({ progress: stored }));
      act(() => useAppStore.getState().goTo('story'));
      click(button('Epilogue'));
      expect(useAppStore.getState().screen).toBe('epilogue');
      expect(text()).toContain(expected.text.split(/\n{2,}/)[0]);
      expect(document.activeElement?.id).toBe('epilogue-screen-title');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('reading screens', () => {
  it('the Archive lists entries with their run facts; Science is a separate, labelled section', () => {
    act(() =>
      useStoryStore.getState().recordChapter({
        chapterId: 'ch1-beginning',
        completedAt: '2026-10-21T10:00:00.000Z',
        evidence: evidenceFixture(),
        fragmentIds: [],
        reflection: { source: 'authored', title: 'Kept', text: 'The archived reflection.', fragmentIds: [], factIds: [] },
      }),
    );
    act(() => useAppStore.getState().goTo('archive'));
    expect(text()).toContain('The Archive');
    expect(text()).toContain(`Chapter 1 · ${ch(0).title}`);
    expect(text()).toContain('The archived reflection.');
    expect(text()).toContain('The run, as recorded');
    expect(text()).toContain('left standing');
    expect(container.querySelector('.story-entry__meta')?.textContent).toContain(
      `${formatInt(evidenceFixture().storyPoints)} Topple points`,
    );

    act(() => useAppStore.getState().goTo('science'));
    expect(container.querySelector('.story-science')).not.toBeNull();
    expect(text()).toContain('Real-world science');
    expect(text()).toContain('The Science Behind the Story');
  });

  it('documents show their author by name, never an id: revelation panel, chapter card, Archive', () => {
    const metas = (): string[] => Array.from(container.querySelectorAll('.story-doc__meta')).map((m) => m.textContent ?? '');
    // The revelation panel (a fragment by a character).
    enterStoryGame('ch1-beginning');
    completeWith({ fragments: [{ ...fragment, author: 'tomas-lind' }] });
    expect(metas()).toEqual([expect.stringContaining('Tomas Lind')]);
    expect(text()).not.toMatch(/tomas-lind/i);
    // A chapter card whose opening document has an author.
    const carded = CHAPTERS.find((c) => c.intro.document?.author);
    if (carded) {
      act(() => useAppStore.getState().openChapter(carded.id));
      const shown = documentAuthor(carded.intro.document!.author, carded.id)!;
      expect(metas()[0]).toContain(shown);
      if (shown !== carded.intro.document!.author) expect(metas()[0]).not.toContain(carded.intro.document!.author);
    }
    // The Archive (real chapter 1 records by Tomas Lind).
    act(() =>
      useStoryStore.getState().recordChapter({
        chapterId: 'ch1-beginning',
        completedAt: '2026-10-21T10:00:00.000Z',
        evidence: evidenceFixture(),
        fragmentIds: ['ch1-hut-door-note', 'ch1-notebook-1987'],
        reflection: { source: 'authored', text: 'Kept.', fragmentIds: [], factIds: [] },
      }),
    );
    act(() => useAppStore.getState().goTo('archive'));
    expect(metas()).toHaveLength(2);
    for (const m of metas()) expect(m).toContain('Tomas Lind');
    expect(text()).not.toMatch(/tomas-lind/i);
  });

  it('credits: the music (Musopen, each Commons page) and the science sources, from the tables the game uses', () => {
    act(() => useAppStore.getState().goTo('story'));
    expect(container.querySelector('.story-credits__line')?.textContent).toContain('Musopen');
    act(() => useAppStore.getState().goTo('science'));
    const credits = container.querySelector('.story-credits')!;
    expect(credits).not.toBeNull();
    const links = Array.from(credits.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(links).toContain('https://musopen.org/');
    const tracks = [...new Set(Object.values(CUE_TRACKS).map((t) => t.source))];
    for (const src of tracks) expect(links).toContain(src);
    for (const f of CLIMATE_FACTS) expect(links).toContain(f.source.url);
    expect(credits.textContent).toMatch(/public domain/i);
    expect(credits.textContent).toContain('CC0');
    // The synthesized sound and the motif are credited too (docs/AUDIO_CREDITS.md has the table).
    expect(credits.textContent).toContain('Arcade Mode plays the first two');
    expect(credits.textContent).toMatch(/synthesized in the browser/);
    expect(credits.textContent).toMatch(/original composition for this game \(2026\)/);
  });

  it('the pilot study opens from the main menu and returns', () => {
    click(button('Pilot study'));
    expect(useAppStore.getState().screen).toBe('pilot');
    click(button('Back'));
    expect(useAppStore.getState().screen).toBe('mainMenu');
  });
});
