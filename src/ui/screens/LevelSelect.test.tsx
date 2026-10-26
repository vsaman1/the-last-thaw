// @vitest-environment jsdom
/** Level Select with a full set of six levels: grid, statuses in text, focus and the locked notice. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LevelDef } from '../../core/types';
import { useAppStore } from '../../state/appStore';
import { emptyProgress, type Progress } from '../../state/progress';
import { LevelSelect } from './LevelSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lv = (index: number, name: string, subtitle: string, mass?: number): LevelDef =>
  ({
    id: `level${index}`,
    index,
    name,
    subtitle,
    ...(mass ? { iceberg: { scale: Math.cbrt(mass / 30), mass } } : {}),
  }) as LevelDef;

// Deliberately out of order: display follows `index`.
const SIX: LevelDef[] = [
  lv(3, 'Riverside Town', 'A big iceberg meets a small town.', 100),
  lv(1, 'Mountain Valley', 'A short tutorial run to the sea.'),
  lv(2, 'Rocky Canyon', 'Narrow walls, two waterfalls.'),
  lv(6, 'Power Valley', 'A huge iceberg against industry.', 300),
  lv(4, 'Alpine Pass', 'Glaciers to absorb on the way down.'),
  lv(5, 'Glacier Avalanche', 'Grow into an avalanche.'),
];

const record = { bestTime: 61.2, bestScore: 2400, completions: 1 };
let container: HTMLDivElement;
let root: Root;

function mount(progress: Progress): void {
  useAppStore.setState({ screen: 'levelSelect', progress, transitioning: false });
  act(() => root.render(<LevelSelect levels={SIX} />));
}

const cards = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('.level-card'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Level Select with six levels', () => {
  it('shows all six in order in one grid, with completed / unlocked / locked stated in text', () => {
    mount({ version: 1, completed: { level1: record, level2: record } });
    const list = container.querySelector('.levels')!;
    expect(list.getAttribute('data-count')).toBe('6');
    expect(container.querySelector('.level-soon')).toBeNull(); // no "more coming" filler
    const c = cards();
    expect(c.map((el) => el.querySelector('.level-card__name')!.textContent)).toEqual([
      'Level 1: Mountain Valley',
      'Level 2: Rocky Canyon',
      'Level 3: Riverside Town',
      'Level 4: Alpine Pass',
      'Level 5: Glacier Avalanche',
      'Level 6: Power Valley',
    ]);
    expect(c.map((el) => el.className.match(/level-card--(\w+)/)![1])).toEqual([
      'completed',
      'completed',
      'unlocked',
      'locked',
      'locked',
      'locked',
    ]);
    expect(c[0].textContent).toContain('Completed');
    expect(c[0].textContent).toContain('1:01.2');
    expect(c[0].textContent).toContain('2,400 pts');
    expect(c[0].textContent).toContain('Replay');
    expect(c[2].textContent).toContain('Unlocked');
    expect(c[2].textContent).toContain('Play');
    for (const locked of c.slice(3)) {
      expect(locked.textContent).toContain('Locked');
      expect(locked.getAttribute('aria-disabled')).toBe('true');
      expect(locked.querySelector('.level-card__cta')).toBeNull();
    }
    expect(c[3].textContent).toContain('Complete Level 3: Riverside Town to unlock.');
    // The next level to play gets focus.
    expect(document.activeElement).toBe(c[2]);
  });

  it('notes a bigger iceberg on the card (text, not colour)', () => {
    mount(emptyProgress());
    const c = cards();
    expect(c[2].textContent).toContain('Iceberg 100 t');
    expect(c[5].textContent).toContain('Iceberg 300 t');
    expect(c[0].querySelector('.level-card__meta')).toBeNull();
  });

  it('pressing a locked level explains how to unlock it', () => {
    mount(emptyProgress());
    act(() => cards()[4].click());
    expect(container.querySelector('.notice')!.textContent).toBe(
      'Level 5 is locked. Complete Level 4 first.',
    );
    expect(useAppStore.getState().screen).toBe('levelSelect');
  });

  it('every level completed: all replayable', () => {
    const completed = Object.fromEntries(SIX.map((l) => [l.id, record]));
    mount({ version: 1, completed });
    for (const card of cards()) {
      expect(card.textContent).toContain('Completed');
      expect(card.getAttribute('aria-disabled')).toBeNull();
    }
  });
});
