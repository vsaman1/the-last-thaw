/**
 * Reading screens: the ARCHIVE (every completed chapter's documents, reflection and run facts), the
 * SCIENCE BEHIND THE STORY (real, cited climate facts and where the game is metaphor — on a visibly
 * different surface, so fact never passes for fiction or the other way round), and the epilogue.
 */
import { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/appStore';
import { useStoryStore } from '../../state/storyStore';
import { CHAPTERS } from '../../story/chapters';
import { CLIMATE_FACTS, METAPHOR_NOTES } from '../../story/science';
import { findDocument } from '../../story/select';
import { Button } from '../components';
import { formatInt } from '../format';
import { useArrowNavigation } from '../hooks';
import { ArrowLeftIcon } from '../icons';
import { StoryCredits } from './Credits';
import { DocumentView, ReflectionView, RunFacts } from './parts';
import { chapterLabel, landmarkNamer } from './StoryGame';

/** Escape returns to the chapter list. */
function useEscapeTo(screen: 'story' | 'mainMenu'): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (useAppStore.getState().transitioning) return;
      e.preventDefault();
      useAppStore.getState().goTo(screen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);
}

function BackRow() {
  const ref = useRef<HTMLDivElement>(null);
  useArrowNavigation(ref, { autoFocus: false });
  const goTo = useAppStore((s) => s.goTo);
  return (
    <div className="story-actions story-actions--rule" ref={ref}>
      <Button icon={<ArrowLeftIcon />} onClick={() => goTo('story')}>
        Chapters
      </Button>
      <Button variant="ghost" onClick={() => goTo('mainMenu')}>
        Main Menu
      </Button>
    </div>
  );
}

const dateText = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export function ArchiveScreen() {
  const progress = useStoryStore((s) => s.progress);
  useEscapeTo('story');
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  const entries = CHAPTERS.map((c) => ({ c, e: progress.archive.find((x) => x.chapterId === c.id) })).filter(
    (x) => x.e !== undefined,
  );
  return (
    <main className="screen screen--sub story-screen" aria-labelledby="archive-title">
      <div className="sub story-sub story-sub--narrow">
        <header className="story-head">
          <p className="story-eyebrow">Story Mode</p>
          <h1 className="story-title" id="archive-title" ref={titleRef} tabIndex={-1}>
            The Archive
          </h1>
          <p className="story-standfirst">
            Every chapter you have finished, as it was recorded: the documents your run surfaced, the reflection, and the
            run itself as plain data. Replaying a chapter replaces its entry.
          </p>
        </header>
        {entries.length === 0 && <p className="story-empty">Nothing is archived yet. Finish a chapter to begin the record.</p>}
        {entries.map(({ c, e }) =>
          e ? (
            <section key={c.id} className="story-entry" aria-labelledby={`entry-${c.id}`}>
              <h2 className="story-entry__title" id={`entry-${c.id}`}>
                {chapterLabel(c)}
              </h2>
              <p className="story-entry__meta">
                Recorded {dateText(e.completedAt)} · <span className="num">{formatInt(e.attempts)}</span> attempt
                {e.attempts === 1 ? '' : 's'} · <span className="num">{formatInt(e.evidence.storyPoints)}</span> Topple points
              </p>
              {e.fragmentIds
                .map((id) => findDocument(id))
                .map((doc, i) => (doc ? <DocumentView key={doc.id} doc={doc} /> : <p key={i} className="story-empty">A document from an earlier version of the story.</p>))}
              <ReflectionView reflection={e.reflection} />
              {e.reflection.source === 'ai' && e.reflection.review && (
                <p className="story-entry__meta">
                  Historian: {e.reflection.review.verdict} after <span className="num">{e.reflection.review.rounds}</span> round
                  {e.reflection.review.rounds === 1 ? '' : 's'}
                  {e.reflection.validated ? ' · passed the checks against the run' : ''}
                  {e.reflection.traceId ? ` · trace ${e.reflection.traceId}` : ''}
                </p>
              )}
              <details className="story-details">
                <summary>The run, as recorded</summary>
                <RunFacts evidence={e.evidence} landmarkName={landmarkNamer(c)} />
              </details>
            </section>
          ) : null,
        )}
        {progress.epilogue && (
          <section className="story-entry" aria-labelledby="entry-epilogue">
            <h2 className="story-entry__title" id="entry-epilogue">
              Epilogue
            </h2>
            <ReflectionView reflection={progress.epilogue} />
          </section>
        )}
        <BackRow />
      </div>
    </main>
  );
}

export function ScienceScreen() {
  useEscapeTo('story');
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  return (
    <main className="screen screen--sub story-screen story-science" aria-labelledby="science-title">
      <div className="sub story-sub story-sub--narrow">
        <header className="story-head">
          <p className="story-eyebrow story-eyebrow--science">Real-world science</p>
          <h1 className="story-title" id="science-title" ref={titleRef} tabIndex={-1}>
            The Science Behind the Story
          </h1>
          <p className="story-standfirst">
            The Last Thaw is fiction: its towns, people and records are invented. The statements below are not. Each comes
            from a public scientific source, linked, with the date it was checked.
          </p>
        </header>
        <section aria-labelledby="facts-title">
          <h2 className="story-section-title" id="facts-title">
            What the record shows
          </h2>
          {CLIMATE_FACTS.length === 0 ? (
            <p className="story-empty">The cited facts are not in this build yet.</p>
          ) : (
            <ol className="story-facts-list">
              {CLIMATE_FACTS.map((f) => (
                <li key={f.id} className="story-fact">
                  <p className="story-fact__statement">{f.statement}</p>
                  <p className="story-fact__source">
                    {f.source.org} ·{' '}
                    <a href={f.source.url} target="_blank" rel="noreferrer noopener">
                      {f.source.title}
                    </a>{' '}
                    · checked <span className="num">{f.source.accessed}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-labelledby="metaphor-title">
          <h2 className="story-section-title" id="metaphor-title">
            Where the game is a metaphor
          </h2>
          {METAPHOR_NOTES.length === 0 ? (
            <p className="story-empty">The notes on the game's metaphors are not in this build yet.</p>
          ) : (
            <dl className="story-metaphors">
              {METAPHOR_NOTES.map((m) => (
                <div key={m.id}>
                  <dt>{m.gameElement}</dt>
                  <dd>{m.explanation}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <StoryCredits />
        <BackRow />
      </div>
    </main>
  );
}

export function EpilogueScreen() {
  const epilogue = useStoryStore((s) => s.progress.epilogue);
  useEscapeTo('story');
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  return (
    <main className="screen screen--sub story-screen" aria-labelledby="epilogue-screen-title">
      <div className="sub story-sub story-sub--narrow">
        <header className="story-head">
          <p className="story-eyebrow">Story Mode</p>
          <h1 className="story-title" id="epilogue-screen-title" ref={titleRef} tabIndex={-1}>
            Epilogue
          </h1>
        </header>
        {epilogue ? (
          <ReflectionView reflection={epilogue} headingLevel={2} />
        ) : (
          <p className="story-empty">The epilogue is written when the ninth chapter reaches the sea.</p>
        )}
        <BackRow />
      </div>
    </main>
  );
}
