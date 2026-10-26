/**
 * Story Mode inside the game screen: what GameOverlay shows instead of (or beside) the Arcade panels.
 * During play only two quiet things are added — the Topple points counter in the HUD and the chapter's
 * optional caption, which fades by itself and never takes focus — so nothing interrupts steering. The
 * pause menu gains the Points guide (./PointsGuide.tsx).
 * After the run: the ARCHIVE REVELATION panel (authored fragments, then the reflection) or the story
 * fail panel; after chapter 9, the epilogue over the river view.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { gameController } from '../../game/controller';
import { useAppStore } from '../../state/appStore';
import { useGameStore } from '../../state/gameStore';
import { useStoryStore } from '../../state/storyStore';
import { CHAPTERS } from '../../story/chapters';
import type { FailReason } from '../../core/types';
import type { ChapterDef } from '../../story/types';
import { restartAttempt, setViewingRiver } from '../actions';
import { Button } from '../components';
import { formatInt, levelNumber } from '../format';
import { useArrowNavigation } from '../hooks';
import { ArrowLeftIcon, BookIcon, EyeIcon, MenuIcon, NextIcon, RestartIcon } from '../icons';
import type { StoryOverlaySlots } from '../game/GameOverlay';
import { RiverViewBar } from '../game/Panels';
import { DocumentView, EPILOGUE_PENDING_TEXT, ReflectionView, RunFacts } from './parts';
import { POINTS_GUIDE_STANDFIRST, PointsGuideList } from './PointsGuide';
import { LANDMARK_NOTICE_MS, startEpilogue, useStoryRun } from './storyRun';

/** How long the play-start caption stays (ms); CSS fades it in and out within this. */
export const CAPTION_MS = 6500;

export const chapterLabel = (c: Pick<ChapterDef, 'index' | 'title'>): string => `Chapter ${c.index} · ${c.title}`;

const nextChapterOf = (c: ChapterDef): ChapterDef | undefined => CHAPTERS.find((x) => x.index === c.index + 1);

/** A landmark's story name, for run facts. */
export const landmarkNamer =
  (chapter: ChapterDef) =>
  (id: string): string =>
    chapter.landmarks.find((l) => l.id === id)?.name ?? id;

/** The overlay slots for a chapter (stable per chapter). */
export function useStorySlots(chapter: ChapterDef | undefined): StoryOverlaySlots | undefined {
  return useMemo(
    () =>
      chapter && {
        title: {
          eyebrow: `Chapter ${levelNumber(chapter.index)}`,
          name: chapter.title,
          subtitle: `Act ${chapter.act} · ${chapter.actTitle}`,
          label: chapterLabel(chapter),
        },
        counter: <StoryPointsCounter />,
        pointsGuide: { content: <PointsGuideList />, standfirst: POINTS_GUIDE_STANDFIRST },
        caption: chapter.caption ? <StoryCaption text={chapter.caption} /> : undefined,
        notice: <StoryLandmarkNotice />,
        complete: <ArchiveRevelation chapter={chapter} />,
        failed: <StoryFailPanel chapter={chapter} />,
        riverView: <StoryRiverView />,
      },
    [chapter],
  );
}

export function StoryPointsCounter() {
  const points = useStoryRun((s) => s.points);
  return (
    <div className="hud__story-points">
      <dt>
        <span>Topple points</span>
      </dt>
      <dd className="num">{formatInt(points)}</dd>
    </div>
  );
}

/** Shown once per attempt at play start; remounts with the overlay, so a retry shows it again. */
export function StoryCaption({ text }: { text: string }) {
  const narrative = useStoryStore((s) => s.progress.settings.narrative);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setDone(true), CAPTION_MS);
    return () => window.clearTimeout(id);
  }, []);
  if (done || !narrative) return null;
  return (
    <p className="story-caption" data-testid="story-caption">
      {text}
    </p>
  );
}

export { LANDMARK_NOTICE_MS };

/**
 * The in-run notice when one of the chapter's named places breaks (storyRun.ts LandmarkNotice): its
 * name and its label (the sign that stands at it), for a few seconds, never taking focus or input.
 * Playtest 2 review: the Calder processing plant broke in the first three seconds with nothing on
 * screen but "-2% ice" and the knocked count; its label was written but drawn nowhere.
 * It goes at the notice's own `until`, so mounting it again (after a pause) never brings back a place
 * that broke earlier; within its time it carries on where it was (the fade keeps its phase).
 */
export function StoryLandmarkNotice() {
  const notice = useStoryRun((s) => s.landmark ?? null);
  const narrative = useStoryStore((s) => s.progress.settings.narrative);
  const [shown, setShown] = useState<{ seq: number; elapsed: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const left = notice.until - Date.now();
    if (left <= 0) {
      setShown(null);
      return;
    }
    setShown({ seq: notice.seq, elapsed: Math.max(0, LANDMARK_NOTICE_MS - left) });
    const id = window.setTimeout(() => setShown((s) => (s?.seq === notice.seq ? null : s)), left);
    return () => window.clearTimeout(id);
  }, [notice]);
  if (!notice || shown?.seq !== notice.seq || !narrative) return null;
  return (
    <p
      key={notice.seq}
      className="story-landmark"
      role="status"
      data-testid="story-landmark"
      style={shown.elapsed > 0 ? { animationDelay: `-${Math.round(shown.elapsed)}ms` } : undefined}
    >
      <span className="story-landmark__eyebrow">Broken</span>
      <span className="story-landmark__name">{notice.name}</span>
      {notice.label && <span className="story-landmark__label">{notice.label}</span>}
    </p>
  );
}

function continueFrom(chapter: ChapterDef): void {
  const next = nextChapterOf(chapter);
  const app = useAppStore.getState();
  if (!next) {
    startEpilogue();
    setViewingRiver(true);
    return;
  }
  if (useStoryStore.getState().progress.settings.narrative) app.openChapter(next.id);
  else app.playChapter(next.id);
}

export function ArchiveRevelation({ chapter }: { chapter: ChapterDef }) {
  const outcome = useStoryRun((s) => s.outcome);
  const narrativeOn = useStoryStore((s) => s.progress.settings.narrative);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useArrowNavigation(actionsRef, { autoFocus: false });
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  const next = nextChapterOf(chapter);
  const showText = narrativeOn && outcome !== null;

  return (
    <section className="story-panel story-reveal" role="dialog" aria-modal="true" aria-labelledby="reveal-title">
      <div className="story-panel__inner">
        <header className="story-panel__head">
          <p className="story-eyebrow">
            {chapterLabel(chapter)} · {showText ? 'Archive revelation' : 'Chapter complete'}
          </p>
          <h2 className="story-panel__title" id="reveal-title" ref={titleRef} tabIndex={-1}>
            {showText ? 'What the archive kept' : chapter.title}
          </h2>
          {outcome && (
            <p className="story-panel__standfirst">
              <span className="num">{formatInt(outcome.evidence.storyPoints)}</span> Topple points ·{' '}
              {outcome.fragments.length === 0
                ? 'no documents surfaced from this run'
                : `${outcome.fragments.length} document${outcome.fragments.length === 1 ? '' : 's'} surfaced from this run`}
            </p>
          )}
        </header>

        {showText && outcome && (
          <>
            {outcome.fragments.map((f) => (
              <DocumentView key={f.id} doc={f} />
            ))}
            <ReflectionView
              reflection={outcome.narrative.reflection}
              pending={outcome.narrative.status === 'pending'}
              result={outcome.narrative.result}
              failure={outcome.narrative.failure}
            />
          </>
        )}

        {outcome && (
          <details className="story-details">
            <summary>The run, as recorded</summary>
            <RunFacts evidence={outcome.evidence} landmarkName={landmarkNamer(chapter)} />
          </details>
        )}

        <div className="story-actions" ref={actionsRef}>
          <Button icon={<NextIcon />} onClick={() => continueFrom(chapter)}>
            {next ? `Continue to chapter ${next.index}` : 'Continue to the epilogue'}
          </Button>
          <Button variant="ghost" icon={<RestartIcon />} onClick={restartAttempt}>
            Replay chapter
          </Button>
          <Button variant="ghost" icon={<EyeIcon />} onClick={() => setViewingRiver(true)}>
            View the river
          </Button>
          <Button variant="ghost" icon={<BookIcon />} onClick={() => useAppStore.getState().goTo('story')}>
            Chapters
          </Button>
        </div>
      </div>
    </section>
  );
}

const FAIL_TEXT: Record<FailReason, string> = {
  stuck: 'The iceberg came to rest before the sea.',
  outOfBounds: 'The iceberg left the valley.',
  melted: 'The iceberg melted away before the sea.',
  fell: 'The iceberg fell into a ravine.',
};

/**
 * After a failed run. Nothing is archived until a run reaches the sea, but a chapter may have one record
 * written for a run that stopped short (src/story/select.ts failedRunDocument): it is shown here, once,
 * when the story text is on, and kept nowhere.
 */
export function StoryFailPanel({ chapter }: { chapter: ChapterDef }) {
  const failReason = useGameStore((s) => s.failReason);
  const narrativeOn = useStoryStore((s) => s.progress.settings.narrative);
  const failedDocument = useStoryRun((s) => s.failedDocument);
  const doc = narrativeOn && failedDocument?.chapterId === chapter.id ? failedDocument : null;
  const ref = useRef<HTMLDivElement>(null);
  useArrowNavigation(ref);
  return (
    <section className="story-panel story-panel--center" role="alertdialog" aria-modal="true" aria-labelledby="story-fail-title">
      <div className="story-panel__inner story-panel__inner--narrow">
        <p className="story-eyebrow">{chapterLabel(chapter)}</p>
        <h2 className="story-panel__title" id="story-fail-title">
          The river stopped here
        </h2>
        <p className="story-panel__standfirst">{FAIL_TEXT[failReason ?? 'stuck']} Nothing is archived until a run reaches the sea.</p>
        {doc && (
          <div className="story-fail-doc" data-testid="story-fail-doc">
            <p className="story-fail-doc__label">One record turned up on the way. It is not kept in the archive.</p>
            <DocumentView doc={doc} />
          </div>
        )}
        <div className="story-actions story-actions--stack" ref={ref}>
          <Button size="lg" icon={<RestartIcon />} onClick={restartAttempt}>
            Retry
          </Button>
          <Button size="lg" variant="ghost" icon={<BookIcon />} onClick={() => useAppStore.getState().goTo('story')}>
            Chapters
          </Button>
          <Button size="lg" variant="ghost" icon={<MenuIcon />} onClick={gameController.quitToMenu}>
            Main Menu
          </Button>
        </div>
      </div>
    </section>
  );
}

/** After completion: the epilogue over the river once it has started, else the usual river-view bar. */
export function StoryRiverView() {
  const epilogue = useStoryRun((s) => s.epilogue);
  if (!epilogue) return <RiverViewBar />;
  return <EpilogueOverlay />;
}

export function EpilogueOverlay() {
  const epilogue = useStoryRun((s) => s.epilogue);
  const shown = epilogue !== null;
  // Focus starts at the title (the revelation panel that had it is gone): screen readers read the
  // heading, the next Tab goes on from the top of the text, and PageUp / PageDown / Space scroll it.
  // No arrow-key menu here: arrows orbit the river camera underneath.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (shown) titleRef.current?.focus({ preventScroll: true });
  }, [shown]);
  if (!epilogue) return null;
  return (
    <section className="story-epilogue" aria-labelledby="epilogue-title">
      <div className="story-epilogue__scroll">
        <div className="story-epilogue__inner">
          <p className="story-eyebrow">Epilogue</p>
          <h2 className="story-epilogue__title" id="epilogue-title" ref={titleRef} tabIndex={-1}>
            {epilogue.reflection.title ?? 'The Last Thaw'}
          </h2>
          <ReflectionView
            reflection={{ ...epilogue.reflection, title: 'For this journey' }}
            pending={epilogue.status === 'pending'}
            pendingText={EPILOGUE_PENDING_TEXT}
            result={epilogue.result}
            failure={epilogue.failure}
            headingLevel={3}
          />
          <div className="story-actions">
            <Button size="sm" nav={false} icon={<BookIcon />} onClick={() => useAppStore.getState().goTo('archive')}>
              Open the archive
            </Button>
            <Button size="sm" nav={false} variant="ghost" icon={<ArrowLeftIcon />} onClick={() => useAppStore.getState().goTo('story')}>
              Chapters
            </Button>
            <Button size="sm" nav={false} variant="ghost" icon={<EyeIcon />} onClick={() => setViewingRiver(false)}>
              Back to the record
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
