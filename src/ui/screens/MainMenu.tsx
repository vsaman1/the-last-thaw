import { useRef } from 'react';
import { LEVELS } from '../../core/levels';
import { useAppStore } from '../../state/appStore';
import { nextChapter, useStoryStore } from '../../state/storyStore';
import { CHAPTERS } from '../../story/chapters';
import { findLevel, levelLabel, pickPlayLevel, startLevel } from '../actions';
import { Button, Kbd } from '../components';
import { useArrowNavigation } from '../hooks';
import { BookIcon, ExitIcon, GearIcon, GridIcon, IcebergMark, ListIcon, PlayIcon } from '../icons';

export function MainMenu() {
  const progress = useAppStore((s) => s.progress);
  const goTo = useAppStore((s) => s.goTo);
  const navRef = useRef<HTMLElement>(null);
  useArrowNavigation(navRef);

  const playId = pickPlayLevel(LEVELS, progress);
  const playTarget = findLevel(playId);
  const storyDone = useStoryStore((s) => s.progress.completed.length);
  const storyNext = useStoryStore((s) => CHAPTERS.find((c) => c.id === nextChapter(s.progress)));

  return (
    <main className="screen screen--menu" aria-labelledby="menu-title">
      <div className="menu">
        <header className="menu__masthead">
          <p className="eyebrow">A downhill low-poly arcade run</p>
          <h1 className="title" id="menu-title">
            <IcebergMark size={64} className="title__mark" />
            <span className="title__text">ICEBERG RIVER</span>
          </h1>
          <p className="standfirst">
            Steer a glowing iceberg down the valley and carve a river all the way to the sea.
          </p>
        </header>

        <nav className="menu__list" aria-label="Main menu" ref={navRef}>
          <Button
            size="lg"
            icon={<PlayIcon />}
            meta={playTarget ? levelLabel(playTarget) : undefined}
            onClick={() => playId && startLevel(playId)}
            disabled={!playId}
          >
            Play
          </Button>
          <Button
            size="lg"
            icon={<BookIcon />}
            meta={storyDone === 0 || !storyNext ? 'Nine chapters' : `Chapter ${storyNext.index} · ${storyNext.title}`}
            onClick={() => goTo('story')}
          >
            Story Mode — The Last Thaw
          </Button>
          <Button size="lg" icon={<GridIcon />} onClick={() => goTo('levelSelect')}>
            Level Select
          </Button>
          <Button size="lg" icon={<BookIcon />} onClick={() => goTo('howToPlay')}>
            How to Play
          </Button>
          <Button size="lg" icon={<GearIcon />} onClick={() => goTo('settings')}>
            Settings
          </Button>
          <Button size="lg" icon={<ListIcon />} onClick={() => goTo('pilot')}>
            Pilot study
          </Button>
          <Button size="lg" icon={<ExitIcon />} onClick={() => goTo('quit')}>
            Quit
          </Button>
        </nav>

        <p className="menu__footer">
          <Kbd srLabel="Up arrow">↑</Kbd>
          <Kbd srLabel="Down arrow">↓</Kbd> choose <span className="dot" aria-hidden="true">·</span>{' '}
          <Kbd>Enter</Kbd> select
        </p>
      </div>
    </main>
  );
}
