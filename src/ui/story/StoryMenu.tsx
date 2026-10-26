/**
 * Story Mode menus: the chapter-progress view (three acts, nine chapters, completion, replay, and the
 * Points guide) and a chapter's card before its level (title, act, lines, an optional document;
 * chapter 1 adds the light-hearted tutorial: topple structures to earn points, the hook the story
 * later turns around).
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { archiveEntry, isChapterUnlocked, nextChapter, useStoryStore } from '../../state/storyStore';
import { chapterById, CHAPTERS } from '../../story/chapters';
import { THEME_LINE } from '../../story/select';
import type { ChapterDef } from '../../story/types';
import { prepareSoundFor } from '../audio/useAudioDirector';
import { Button } from '../components';
import { formatInt, levelNumber } from '../format';
import { useArrowNavigation, useEscapeToMenu } from '../hooks';
import { ArrowLeftIcon, BookIcon, CheckIcon, LockIcon, PlayIcon, RestartIcon, StarIcon } from '../icons';
import { MUSIC_CREDIT_LINE } from './Credits';
import { DocumentView } from './parts';
import { POINTS_GUIDE_STANDFIRST, PointsGuideList } from './PointsGuide';
import { chapterLabel } from './StoryGame';

const ROMAN = ['I', 'II', 'III'];

/** Start a chapter the way the player's settings ask: its card first, or straight into play. */
export function enterChapter(chapter: ChapterDef): void {
  const app = useAppStore.getState();
  if (useStoryStore.getState().progress.settings.narrative) app.openChapter(chapter.id);
  else app.playChapter(chapter.id);
}

export function ChapterProgress() {
  const progress = useStoryStore((s) => s.progress);
  const unlockAll = useAppStore((s) => s.settings.unlockAllLevels);
  const goTo = useAppStore((s) => s.goTo);
  const navRef = useRef<HTMLDivElement>(null);
  useArrowNavigation(navRef);
  const next = chapterById(nextChapter(progress));
  const acts = [1, 2, 3].map((act) => CHAPTERS.filter((c) => c.act === act));
  // Start over: the whole story again from chapter 1 (archive, epilogue and attempts cleared; the
  // narrative, AI and sound settings stay). Asked twice, because the archive cannot be brought back.
  // While the question is open, Escape answers it with Cancel instead of leaving the screen.
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  // The Points guide opens below the buttons; while it is open, Escape closes it instead.
  const [guideOpen, setGuideOpen] = useState(false);
  useEscapeToMenu(!confirmingRestart && !guideOpen);
  const [restartNote, setRestartNote] = useState('');
  // Where focus goes once the view has re-rendered: the buttons it was on come and go.
  const [focusNext, setFocusNext] = useState<'cancel' | 'startOver' | 'begin' | 'guide' | 'guideButton' | null>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const startOverRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const guideTitleRef = useRef<HTMLHeadingElement>(null);
  const guideButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusNext === null) return;
    const refs = {
      cancel: cancelRef,
      startOver: startOverRef,
      begin: beginRef,
      guide: guideTitleRef,
      guideButton: guideButtonRef,
    };
    refs[focusNext].current?.focus();
    setFocusNext(null);
  }, [focusNext]);
  const hasProgress = progress.completed.length > 0 || progress.archive.length > 0 || progress.epilogue !== null;
  const askRestart = (): void => {
    setRestartNote('');
    setGuideOpen(false);
    setConfirmingRestart(true);
    setFocusNext('cancel');
  };
  const toggleGuide = (): void => {
    if (guideOpen) {
      setGuideOpen(false);
      return;
    }
    setConfirmingRestart(false);
    setGuideOpen(true);
    setFocusNext('guide');
  };
  const closeGuide = (): void => {
    setGuideOpen(false);
    setFocusNext('guideButton');
  };
  useEffect(() => {
    if (!guideOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setGuideOpen(false);
      setFocusNext('guideButton');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guideOpen]);
  const cancelRestart = (): void => {
    setConfirmingRestart(false);
    setFocusNext('startOver');
  };
  useEffect(() => {
    if (!confirmingRestart) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setConfirmingRestart(false);
      setFocusNext('startOver');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmingRestart]);
  const startOver = (): void => {
    useStoryStore.getState().resetStory();
    setConfirmingRestart(false);
    setRestartNote('The story starts again from chapter 1. The archive is empty.');
    setFocusNext('begin');
  };

  return (
    <main className="screen screen--sub story-screen" aria-labelledby="story-title">
      <div className="sub story-sub" ref={navRef}>
        <header className="story-head">
          <p className="story-eyebrow">Story Mode</p>
          <h1 className="story-title" id="story-title">
            The Last Thaw
          </h1>
          <p className="story-standfirst">{THEME_LINE}</p>
          <p className="story-progress-line">
            <span className="num">{progress.completed.length}</span> of <span className="num">{CHAPTERS.length}</span>{' '}
            chapters archived
          </p>
        </header>

        {next && (
          <div className="story-actions">
            <Button
              ref={beginRef}
              size="lg"
              icon={<PlayIcon />}
              meta={chapterLabel(next)}
              preferFocus
              onClick={() => enterChapter(next)}
            >
              {progress.completed.length === 0 ? 'Begin' : 'Continue'}
            </Button>
          </div>
        )}

        {acts.map((chapters, i) => (
          <section key={i} className="story-act" aria-labelledby={`act-${i + 1}`}>
            <h2 className="story-act__title" id={`act-${i + 1}`}>
              Act {ROMAN[i]} · {chapters[0]?.actTitle}
            </h2>
            <ol className="story-chapters">
              {chapters.map((c) => {
                const unlocked = isChapterUnlocked(progress, c.id, unlockAll);
                const entry = archiveEntry(progress, c.id);
                const status = entry ? 'Archived' : unlocked ? 'Open' : 'Locked';
                return (
                  <li key={c.id} className="story-chapter" data-status={status.toLowerCase()}>
                    <button
                      type="button"
                      className="story-chapter__btn"
                      data-nav=""
                      disabled={!unlocked}
                      aria-label={`${chapterLabel(c)}. ${status}${entry ? `, ${entry.evidence.storyPoints} Topple points. Replay` : ''}`}
                      onClick={() => enterChapter(c)}
                      onFocus={unlocked ? () => prepareSoundFor(c.levelId, c.id) : undefined}
                      onPointerEnter={unlocked ? () => prepareSoundFor(c.levelId, c.id) : undefined}
                    >
                      <span className="story-chapter__num num">{levelNumber(c.index)}</span>
                      <span className="story-chapter__title">{c.title}</span>
                      <span className="story-chapter__status">
                        {entry ? <CheckIcon size={16} /> : unlocked ? null : <LockIcon size={16} />}
                        {status}
                        {entry && (
                          <>
                            {' · '}
                            <span className="num">{formatInt(entry.evidence.storyPoints)}</span> Topple points
                            <span className="story-chapter__replay">
                              <RestartIcon size={14} /> Replay
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        <div className="story-actions story-actions--rule">
          <Button variant="ghost" icon={<BookIcon />} onClick={() => goTo('archive')}>
            The Archive
          </Button>
          <Button variant="ghost" icon={<BookIcon />} onClick={() => goTo('science')}>
            Science Behind the Story
          </Button>
          <Button
            ref={guideButtonRef}
            variant="ghost"
            icon={<StarIcon />}
            aria-expanded={guideOpen}
            aria-controls={guideOpen ? 'story-points-guide' : undefined}
            onClick={toggleGuide}
          >
            Points guide
          </Button>
          {progress.epilogue && (
            <Button variant="ghost" icon={<BookIcon />} onClick={() => goTo('epilogue')}>
              Epilogue
            </Button>
          )}
          {hasProgress && !confirmingRestart && (
            <Button ref={startOverRef} variant="ghost" icon={<RestartIcon />} onClick={askRestart}>
              Start over…
            </Button>
          )}
          <Button variant="ghost" icon={<ArrowLeftIcon />} onClick={() => goTo('mainMenu')}>
            Main Menu
          </Button>
        </div>
        {confirmingRestart && (
          <div className="story-restart" role="group" aria-labelledby="story-restart-q">
            <p className="story-restart__q" id="story-restart-q">
              Start the story again from chapter 1? Every archived chapter, its records and reflections, and the
              epilogue will be cleared. Your settings stay.
            </p>
            <div className="story-actions">
              <Button variant="danger" icon={<RestartIcon />} onClick={startOver}>
                Yes, start over
              </Button>
              <Button ref={cancelRef} variant="ghost" onClick={cancelRestart}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <p className="story-restart__note" role="status" aria-live="polite">
          {restartNote}
        </p>
        {guideOpen && (
          <section className="story-guide" id="story-points-guide" aria-labelledby="story-guide-title">
            <h2 className="story-section-title story-guide__title" id="story-guide-title" ref={guideTitleRef} tabIndex={-1}>
              Points guide
            </h2>
            <p className="story-guide__standfirst">{POINTS_GUIDE_STANDFIRST}</p>
            <PointsGuideList />
            <div className="story-actions">
              <Button variant="ghost" icon={<ArrowLeftIcon />} aria-keyshortcuts="Escape" onClick={closeGuide}>
                Close the guide
              </Button>
            </div>
          </section>
        )}
        <p className="story-credits__line">{MUSIC_CREDIT_LINE}</p>
      </div>
    </main>
  );
}

export function ChapterIntro() {
  const chapterId = useAppStore((s) => s.chapterId);
  const playChapter = useAppStore((s) => s.playChapter);
  const goTo = useAppStore((s) => s.goTo);
  const chapter = (chapterId && chapterById(chapterId)) || CHAPTERS[0];
  const actionsRef = useRef<HTMLDivElement>(null);
  useArrowNavigation(actionsRef);
  useEscapeToStory();
  const showTutorial = (chapter.tutorial?.length ?? 0) > 0;
  const begin = (): void => playChapter(chapter.id);

  return (
    <main className="screen screen--sub story-screen story-intro" aria-labelledby="chapter-title">
      <div className="sub story-sub story-sub--narrow">
        <div className="story-intro__skip">
          <Button size="sm" variant="ghost" nav={false} onClick={begin}>
            Skip
          </Button>
        </div>
        <header className="story-head">
          <p className="story-eyebrow">
            Act {ROMAN[chapter.act - 1]} · {chapter.actTitle} · Chapter <span className="num">{levelNumber(chapter.index)}</span>
          </p>
          <h1 className="story-title" id="chapter-title">
            {chapter.title}
          </h1>
        </header>
        {chapter.intro.lines.length > 0 && (
          <div className="story-lines">
            {chapter.intro.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
        {chapter.intro.document && <IntroDocument chapter={chapter} />}
        {showTutorial && <Tutorial chapter={chapter} />}
        <div className="story-actions story-actions--rule" ref={actionsRef}>
          <Button size="lg" icon={<PlayIcon />} preferFocus onClick={begin}>
            Begin
          </Button>
          <Button size="lg" variant="ghost" icon={<ArrowLeftIcon />} onClick={() => goTo('story')}>
            Chapters
          </Button>
        </div>
      </div>
    </main>
  );
}

function IntroDocument({ chapter }: { chapter: ChapterDef }) {
  return chapter.intro.document ? <DocumentView doc={chapter.intro.document} headingLevel={2} chapterId={chapter.id} /> : null;
}

/**
 * Chapter 1: how to play and earn Topple points (the writer's cards). The per-structure numbers are
 * not on the card: they are in the Points guide (pause menu, chapter list), which the cards point to.
 */
function Tutorial({ chapter }: { chapter: ChapterDef }) {
  return (
    <section className="story-tutorial" aria-labelledby="tutorial-title">
      <h2 className="story-section-title" id="tutorial-title">
        How to play
      </h2>
      {(chapter.tutorial ?? []).map((card, i) => (
        <div key={i} className="story-tutorial__card">
          <h3>{card.title}</h3>
          <p>{card.body}</p>
        </div>
      ))}
    </section>
  );
}

/** Escape from a chapter card returns to the chapter list (not the main menu). */
function useEscapeToStory(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (useAppStore.getState().transitioning) return;
      e.preventDefault();
      useAppStore.getState().goTo('story');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
