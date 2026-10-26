import { useEffect, useMemo } from 'react';
import { GameView, type StoryViewHooks } from '../render/GameView';
import { useAppStore, type Screen } from '../state/appStore';
import { findLevel, installAttemptReset, levelLabel } from './actions';
import { GameOverlay } from './game/GameOverlay';
import { PolygonBackground } from './PolygonBackground';
import { HowToPlay } from './screens/HowToPlay';
import { LevelSelect } from './screens/LevelSelect';
import { MainMenu } from './screens/MainMenu';
import { QuitScreen } from './screens/QuitScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { chapterById } from '../story/chapters';
import { storyLevel } from '../story/storyLevel';
import { resolveWorldCondition } from '../story/environment';
import { useStoryStore } from '../state/storyStore';
import type { ChapterDef } from '../story/types';
import { PilotStudy } from './pilot/PilotStudy';
import { ArchiveScreen, EpilogueScreen, ScienceScreen } from './story/StoryArchive';
import { chapterLabel, useStorySlots } from './story/StoryGame';
import { ChapterIntro, ChapterProgress } from './story/StoryMenu';
import { attachStorySession } from './story/storyRun';
import './story/story.css';
import { TransitionOverlay } from './TransitionOverlay';
import { useAudioDirector } from './audio/useAudioDirector';

installAttemptReset();

const TITLES: Record<Exclude<Screen, 'game'>, string> = {
  mainMenu: 'Iceberg River',
  levelSelect: 'Level Select · Iceberg River',
  settings: 'Settings · Iceberg River',
  howToPlay: 'How to Play · Iceberg River',
  quit: 'Thanks for playing · Iceberg River',
  story: 'The Last Thaw · Iceberg River',
  storyIntro: 'The Last Thaw · Iceberg River',
  archive: 'The Archive · The Last Thaw',
  science: 'The Science Behind the Story · The Last Thaw',
  epilogue: 'Epilogue · The Last Thaw',
  pilot: 'Pilot study · Iceberg River',
};

/**
 * GameView's story hooks for a chapter (stable per chapter). The world condition reads the Archive
 * as it is when the chapter opens: only earlier chapters count, so this chapter's own completion
 * (or a retry) never changes the world it is played in.
 */
function useStoryHooks(chapter: ChapterDef | undefined): StoryViewHooks | undefined {
  return useMemo(() => {
    if (!chapter) return undefined;
    const level = storyLevel(chapter);
    const archive = useStoryStore.getState().progress.archive;
    const world = resolveWorldCondition(chapter.id, archive, typeof window === 'undefined' ? '' : window.location.search);
    return { level, world, attach: (session) => attachStorySession(session, chapter, level) };
  }, [chapter]);
}

export function App() {
  const screen = useAppStore((s) => s.screen);
  const levelId = useAppStore((s) => s.levelId);
  const attempt = useAppStore((s) => s.attempt);
  const mode = useAppStore((s) => s.mode);
  const chapterId = useAppStore((s) => s.chapterId);
  const chapter = mode === 'story' && chapterId ? chapterById(chapterId) : undefined;
  const storyHooks = useStoryHooks(chapter);
  const storySlots = useStorySlots(chapter);
  const soundAnnouncement = useAudioDirector();

  useEffect(() => {
    if (screen === 'game') {
      const level = findLevel(levelId);
      document.title = chapter
        ? `${chapterLabel(chapter)} · The Last Thaw`
        : level
          ? `${level.name} · Iceberg River`
          : 'Iceberg River';
    } else {
      document.title = TITLES[screen];
    }
  }, [screen, levelId, chapter]);

  const inGame = screen === 'game' && levelId !== null;
  const level = findLevel(levelId);

  return (
    <div className="app" data-screen={inGame ? 'game' : screen}>
      {!inGame && <PolygonBackground />}
      {inGame && levelId !== null ? (
        <main className="game-screen" data-mode={mode} aria-label={chapter ? chapterLabel(chapter) : level ? levelLabel(level) : 'Game'}>
          {/* The view (renderer) lives per level; it starts a fresh session per attempt itself. */}
          <GameView key={`${mode}:${levelId}`} levelId={levelId} attempt={attempt} story={storyHooks} />
          {/* Overlays remount per attempt so they capture a fresh "previous best" record. */}
          <GameOverlay key={`${mode}:${levelId}:${attempt}:overlay`} levelId={levelId} story={storySlots} />
        </main>
      ) : (
        <MenuScreen screen={screen} />
      )}
      <TransitionOverlay />
      {/* M mutes and unmutes all sound; the change is announced here. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="sound-announcement">
        {soundAnnouncement}
      </p>
    </div>
  );
}

function MenuScreen({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'levelSelect':
      return <LevelSelect />;
    case 'settings':
      return <SettingsScreen />;
    case 'howToPlay':
      return <HowToPlay />;
    case 'quit':
      return <QuitScreen />;
    case 'story':
      return <ChapterProgress />;
    case 'storyIntro':
      return <ChapterIntro />;
    case 'archive':
      return <ArchiveScreen />;
    case 'science':
      return <ScienceScreen />;
    case 'epilogue':
      return <EpilogueScreen />;
    case 'pilot':
      return <PilotStudy onExit={() => useAppStore.getState().goTo('mainMenu')} />;
    default:
      return <MainMenu />;
  }
}
