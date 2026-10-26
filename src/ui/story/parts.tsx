/**
 * Building blocks shared by the Story Mode panels and screens: an archive document, a reflection with
 * its provenance label (and, for the agents' text, the "How this was made" record), and a run's facts
 * as plain data. Fiction is set in the document serif; the run facts are tabular numerals.
 */
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { categoryOf, CATEGORY_LABEL, kindLabel } from '../../story/scoring';
import { documentAuthor } from '../../story/select';
import type {
  ArchiveDocument,
  ArchiveFragment,
  ChapterId,
  NarrativeFailure,
  NarrativeResult,
  RunEvidence,
  StoredReflection,
  StructureCategory,
} from '../../story/types';
import { formatDistance, formatInt, formatTime } from '../format';

/** The exact provenance line for an approved AI reflection (the brief's wording). */
export const AI_LABEL = 'Written by the Archivist · reviewed by the Historian · checked against your run';
export const AUTHORED_LABEL = 'From the archive · authored for this outcome';
/**
 * The quiet line under the authored text while the agents work (real runs take about a minute, up to
 * two): nothing waits for them, and their text takes this one's place only if it passes the checks.
 */
export const PENDING_TEXT =
  'The Archivist is writing a reflection on this run; the Historian will check it. This can take a minute or two. ' +
  'Read on or continue whenever you like: if it passes, it takes this text’s place here and in the Archive.';
export const EPILOGUE_PENDING_TEXT =
  'The Archivist is writing an epilogue for your whole journey; the Historian will check it. This can take a ' +
  'minute or two. If it passes, it takes this text’s place here and in the Archive.';

const KIND_NAME: Record<ArchiveDocument['kind'], string> = {
  letter: 'Letter',
  notice: 'Notice',
  report: 'Report',
  newspaper: 'Newspaper',
  memory: 'Memory',
  record: 'Record',
  caption: 'Caption',
  reflection: 'Reflection',
};

export interface DocumentViewProps {
  doc: ArchiveDocument | ArchiveFragment;
  headingLevel?: 2 | 3 | 4;
  /** The chapter the document belongs to (a fragment knows its own); gates the author's name. */
  chapterId?: ChapterId;
}

export function DocumentView({ doc, headingLevel = 3, chapterId }: DocumentViewProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const author = documentAuthor(doc.author, chapterId ?? ('chapterId' in doc ? doc.chapterId : undefined));
  const meta = [KIND_NAME[doc.kind], doc.date, author].filter(Boolean).join(' · ');
  return (
    <article className="story-doc" data-kind={doc.kind}>
      <p className="story-doc__meta">{meta}</p>
      <H className="story-doc__title">{doc.title}</H>
      {doc.body.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="story-doc__body">
          {para}
        </p>
      ))}
    </article>
  );
}

export interface ReflectionViewProps {
  reflection: StoredReflection;
  /** Waiting for the agents: the authored text is shown meanwhile, marked as provisional. */
  pending?: boolean;
  result?: NarrativeResult;
  failure?: NarrativeFailure;
  headingLevel?: 2 | 3 | 4;
  /** The waiting line (defaults to the reflection's). */
  pendingText?: string;
}

export function ReflectionView({
  reflection,
  pending = false,
  result,
  failure,
  headingLevel = 3,
  pendingText = PENDING_TEXT,
}: ReflectionViewProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const ai = reflection.source === 'ai';
  return (
    <section className={`story-reflection${ai ? ' is-ai' : ''}`} aria-busy={pending}>
      <H className="story-reflection__title">{reflection.title ?? 'Reflection'}</H>
      {reflection.text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="story-reflection__text">
          {para}
        </p>
      ))}
      <p className="story-reflection__label">{ai ? AI_LABEL : AUTHORED_LABEL}</p>
      {pending && (
        <p className="story-reflection__status" role="status">
          {pendingText}
        </p>
      )}
      {!pending && failure && (
        <p className="story-reflection__status">
          The agents' reflection is not shown ({failureText(failure)}); this one was written in advance.
        </p>
      )}
      {!pending && failure && failureDetail(failure) && (
        <p className="story-reflection__status">{failureDetail(failure)}</p>
      )}
      {result && <HowMade result={result} />}
    </section>
  );
}

function failureText(f: NarrativeFailure): string {
  switch (f.reason) {
    case 'unavailable':
      return 'the agent service is not available';
    case 'budget':
      return 'the request budget was reached';
    case 'rejected':
      return 'it did not pass the checks against your run';
    default:
      return 'the request failed';
  }
}

/**
 * The server's own reason, for the two failures it words itself (not model text): which model could
 * not run and why, or which budget was reached, e.g. that gpt-6-sol needs the player's OPENAI_API_KEY.
 */
function failureDetail(f: NarrativeFailure): string | undefined {
  if ((f.reason !== 'unavailable' && f.reason !== 'budget') || !f.message.trim()) return undefined;
  return f.message.length > 300 ? `${f.message.slice(0, 299)}…` : f.message;
}

const fmtTokens = (n: number): string => formatInt(n);

/** The record of how an AI reflection was produced: tool calls, the Historian's review, token usage. */
export function HowMade({ result }: { result: NarrativeResult }) {
  const id = useId();
  const total = result.usage.reduce(
    (a, u) => ({ input: a.input + u.inputTokens, output: a.output + u.outputTokens, cost: a.cost + (u.costUsd ?? 0) }),
    { input: 0, output: 0, cost: 0 },
  );
  return (
    <details className="story-how">
      <summary>How this was made</summary>
      <div className="story-how__body">
        <h4 className="story-how__h" id={`${id}-review`}>
          Historian's review
        </h4>
        <p>
          Verdict: <strong>{result.review.verdict === 'approved' ? 'approved' : 'approved after corrections'}</strong>
          {' · '}
          <span className="num">{result.review.rounds}</span> round{result.review.rounds === 1 ? '' : 's'}
          {' · '}deterministic checks passed (<span className="num">{result.validation.checked}</span> claims)
        </p>
        {result.review.issues.length > 0 && (
          <ul className="story-how__issues" aria-labelledby={`${id}-review`}>
            {result.review.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
        <h4 className="story-how__h" id={`${id}-tools`}>
          Tool calls
        </h4>
        {result.toolCalls.length === 0 ? (
          <p>None recorded.</p>
        ) : (
          <TableScroll labelledBy={`${id}-tools`}>
            <table className="story-table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Tool</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="is-num">
                    ms
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.toolCalls.map((c, i) => (
                  <tr key={i}>
                    <td>{c.agent}</td>
                    <td className="mono">{c.tool}</td>
                    <td>{c.ok ? 'ok' : `rejected${c.error ? `: ${c.error}` : ''}`}</td>
                    <td className="is-num num">{formatInt(c.ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <h4 className="story-how__h" id={`${id}-usage`}>
          Token usage
        </h4>
        {result.usage.length === 0 ? (
          <p>Not reported.</p>
        ) : (
          <TableScroll labelledBy={`${id}-usage`}>
            <table className="story-table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Model</th>
                  <th scope="col" className="is-num">
                    Input
                  </th>
                  <th scope="col" className="is-num">
                    Cached
                  </th>
                  <th scope="col" className="is-num">
                    Output
                  </th>
                  <th scope="col" className="is-num">
                    Requests
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.usage.map((u, i) => (
                  <tr key={i}>
                    <td>{u.agent}</td>
                    <td className="mono">{u.model}</td>
                    <td className="is-num num">{fmtTokens(u.inputTokens)}</td>
                    <td className="is-num num">{fmtTokens(u.cachedInputTokens)}</td>
                    <td className="is-num num">{fmtTokens(u.outputTokens)}</td>
                    <td className="is-num num">{formatInt(u.requests)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Total{total.cost > 0 ? ` · US$${total.cost.toFixed(4)}` : ''}
                  </th>
                  <td className="is-num num">{fmtTokens(total.input)}</td>
                  <td />
                  <td className="is-num num">{fmtTokens(total.output)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableScroll>
        )}
        {result.runId && <p className="story-how__trace mono">Trace {result.runId}</p>}
      </div>
    </details>
  );
}

/**
 * A table wider than a phone scrolls sideways inside its own box instead of widening the whole panel
 * (WCAG 1.4.10 allows two-dimensional scrolling for data tables). The box is a named region and takes
 * focus. On the game screen the steering input and the river camera keep the arrow keys from scrolling
 * anything, so a focused box that overflows scrolls itself on ← / → and keeps those two keys.
 */
function TableScroll({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const box = e.currentTarget;
    if (e.target !== box || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || box.scrollWidth <= box.clientWidth) return;
    e.preventDefault();
    e.stopPropagation();
    box.scrollLeft += (e.key === 'ArrowRight' ? 1 : -1) * Math.max(40, box.clientWidth / 4);
  };
  return (
    <div className="story-table-wrap" role="region" aria-labelledby={labelledBy} tabIndex={0} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** Landmark outcomes as the player reads them (the data keeps 'destroyed'; the screen says toppled). */
const STATUS_TEXT: Record<RunEvidence['landmarks'][number]['status'], string> = {
  destroyed: 'toppled',
  damaged: 'damaged',
  intact: 'left standing',
  notReached: 'not reached',
};

/**
 * Built structures destroyed: placements of every category but 'nature' (trees, rocks, ice). Felled
 * trees are reported on their own, so the headline figure never counts a pine as a structure.
 */
export function structuresDestroyed(evidence: Pick<RunEvidence, 'destroyedByCategory'>): number {
  const cats = Object.entries(evidence.destroyedByCategory) as [StructureCategory, number | undefined][];
  return cats.reduce((a, [c, n]) => (c === 'nature' ? a : a + (n ?? 0)), 0);
}

/** A run's facts as plain data: what the evidence (and so the narrative) is built from. */
export function RunFacts({ evidence, landmarkName }: { evidence: RunEvidence; landmarkName?: (id: string) => string }) {
  const kinds = Object.entries(evidence.destroyedByKind).filter(([, n]) => (n ?? 0) > 0) as [string, number][];
  return (
    <div className="story-facts">
      <dl className="story-facts__grid">
        <Fact label="Outcome" value={evidence.outcome === 'complete' ? 'reached the sea' : 'run ended'} />
        <Fact label="Topple points" value={formatInt(evidence.storyPoints)} num />
        <Fact label="Time" value={formatTime(evidence.time)} num />
        <Fact label="Distance" value={formatDistance(evidence.distance)} num />
        <Fact label="Structures toppled" value={formatInt(structuresDestroyed(evidence))} num />
        <Fact label="Trees felled" value={formatInt(evidence.treesFelled)} num />
        <Fact label="Waterfalls" value={formatInt(evidence.waterfallsCrossed)} num />
      </dl>
      {kinds.length > 0 && (
        <p className="story-facts__line">
          {kinds
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${n} × ${kindLabel(k)} (${CATEGORY_LABEL[categoryOf(k)].toLowerCase()})`)
            .join(' · ')}
        </p>
      )}
      {evidence.landmarks.length > 0 && (
        <ul className="story-facts__landmarks">
          {evidence.landmarks.map((l) => (
            <li key={l.id} data-status={l.status}>
              <span>{landmarkName?.(l.id) ?? l.id}</span>
              <span className="story-facts__status">{STATUS_TEXT[l.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, value, num = false }: { label: string; value: string; num?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={num ? 'num' : undefined}>{value}</dd>
    </div>
  );
}
