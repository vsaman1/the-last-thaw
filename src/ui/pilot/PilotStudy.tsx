/**
 * THE LAST THAW — the optional pilot-study screens: information and consent, the before-play and
 * after-play surveys, a thank-you/debrief, and a researcher panel (counts, JSON/CSV export,
 * withdrawal of one participant, delete everything) that stays hidden until the researcher asks
 * for it.
 *
 * Kept outside the narrative on purpose: nothing here is reachable from a chapter and nothing in
 * the story waits for it, so the surveys never interrupt play. A participant answers part one,
 * plays, and comes back to this screen for part two; the device remembers their anonymous code,
 * so nobody needs to type an identifier.
 *
 * Accessibility: every question is a native fieldset/legend with real radio inputs (arrow keys move
 * within a question, Tab between questions); every option is labelled in words and the chosen one
 * is marked with a tick as well as colour; each new page moves focus to its heading.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, ScreenHeader } from '../components';
import { ArrowLeftIcon, CheckIcon, WarningIcon } from '../icons';
import { csvRowCount, downloadCsv, downloadJson } from './export';
import {
  FACTUAL_ITEMS,
  LIKERT_LABELS,
  SECTIONS,
  itemsFor,
  type ChoiceItem,
  type FactualItem,
  type LikertItem,
  type OpenItem,
  type Phase,
  type PilotItem,
} from './instrument';
import {
  clearPilotData,
  dayStamp,
  deleteParticipant,
  emptyPilotData,
  loadPilotData,
  newParticipantCode,
  pendingPost,
  recordResponse,
  summarize,
  type AnswerValue,
  type PilotData,
} from './store';
import './pilot.css';

type View =
  | { readonly name: 'hub' }
  | { readonly name: 'consent' }
  | {
      readonly name: 'survey';
      readonly phase: Phase;
      readonly code: string;
      readonly consentedOn: string;
    }
  | { readonly name: 'done'; readonly phase: Phase; readonly code: string; readonly saved: boolean };

const TITLE_ID = 'pilot-title';
const PHASE_TITLE: Record<Phase, string> = { pre: 'Before you play', post: 'After you play' };
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Escape inside a confirm box closes the box only. React's handler runs (at the root) before the
 * page's window listener, so preventDefault there is the signal the page listener respects.
 */
function closeOnEscape(close: () => void) {
  return (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  };
}

export function PilotStudy({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<View>({ name: 'hub' });
  const [data, setData] = useState<PilotData>(() => loadPilotData());

  const go = (next: View): void => {
    // Re-read on the way back to the hub: another tab may have saved a response meanwhile.
    if (next.name === 'hub') setData(loadPilotData());
    setView(next);
  };

  // Escape leaves the hub or the thank-you page, and backs out of the consent page. Never inside a
  // survey: one stray key must not throw away a page of answers. (Re-bound every render so the
  // handler always sees the current view.)
  useEffect(() => {
    if (view.name === 'survey') return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (view.name === 'consent') go({ name: 'hub' });
      else onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const startPartOne = (): void => {
    const taken = new Set(data.participants.map((p) => p.code));
    const code = newParticipantCode(undefined, taken);
    go({ name: 'survey', phase: 'pre', code, consentedOn: dayStamp() });
  };

  const startPartTwo = (code: string): void => {
    const p = data.participants.find((x) => x.code === code);
    if (p) go({ name: 'survey', phase: 'post', code, consentedOn: p.consentedOn });
  };

  const submit = (v: Extract<View, { name: 'survey' }>, answers: Record<string, AnswerValue>): void => {
    const res = recordResponse({ code: v.code, phase: v.phase, consentedOn: v.consentedOn, answers });
    setData(res.data);
    go({ name: 'done', phase: v.phase, code: v.code, saved: res.ok });
  };

  // The key remounts the page: scroll returns to the top and the new heading takes focus.
  const pageKey = 'phase' in view ? `${view.name}-${view.phase}` : view.name;

  return (
    <main className="screen screen--sub pilot" aria-labelledby={TITLE_ID} key={pageKey}>
      <div className="sub sub--narrow pilot__sheet">
        {view.name === 'hub' && (
          <Hub
            data={data}
            onData={setData}
            onExit={onExit}
            onStart={() => go({ name: 'consent' })}
            onContinue={startPartTwo}
          />
        )}
        {view.name === 'consent' && (
          <Consent onAgree={startPartOne} onBack={() => go({ name: 'hub' })} />
        )}
        {view.name === 'survey' && (
          <Survey
            phase={view.phase}
            code={view.code}
            onCancel={() => go({ name: 'hub' })}
            onSubmit={(answers) => submit(view, answers)}
          />
        )}
        {view.name === 'done' && (
          <Done
            phase={view.phase}
            code={view.code}
            saved={view.saved}
            onExit={onExit}
            onHome={() => go({ name: 'hub' })}
          />
        )}
      </div>
    </main>
  );
}

// -------------------------------------------------------------------------------------------------
// Hub: take part, or (researcher) export and manage the data
// -------------------------------------------------------------------------------------------------

interface HubProps {
  data: PilotData;
  onData: (d: PilotData) => void;
  onExit: () => void;
  onStart: () => void;
  onContinue: (code: string) => void;
}

type Confirming = { readonly kind: 'all' } | { readonly kind: 'one'; readonly code: string } | null;

function Hub({ data, onData, onExit, onStart, onContinue }: HubProps) {
  const pending = pendingPost(data);
  const latest = pending.length > 0 ? pending[pending.length - 1].code : '';
  const [chosen, setChosen] = useState(latest);
  const code = pending.some((p) => p.code === chosen) ? chosen : latest;
  const sum = summarize(data);
  const rows = csvRowCount(data);
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState<Confirming>(null);
  // The hub is the screen every participant sees, so the tools that list, export and delete everyone's
  // answers sit behind a deliberate step inside the closed "For the researcher" section. Not a lock (the
  // data is in this browser's storage either way): it keeps other people's answers out of casual reach.
  // Closing the section, or leaving the hub, hides the tools again.
  const [toolsShown, setToolsShown] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const selectId = useId();

  // Shown: focus moves to the tools' first line, so the next Tab reaches the exports.
  useEffect(() => {
    if (toolsShown) toolsRef.current?.focus({ preventScroll: true });
  }, [toolsShown]);

  // Open: focus Cancel (the safe choice). Closed: back to whatever opened the box, or to the panel's
  // summary when that control is gone (its row was deleted) or disabled (nothing left to delete).
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
      return;
    }
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const back = returnFocus.current as HTMLButtonElement | null;
    if (back?.isConnected && !back.disabled) back.focus();
    else summaryRef.current?.focus();
  }, [confirming]);

  const openConfirm = (c: Confirming): void => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setStatus('');
    setConfirming(c);
  };
  const closeConfirm = (): void => {
    restoreFocus.current = true;
    setConfirming(null);
  };

  const exportAs = (kind: 'json' | 'csv'): void => {
    // Export what is stored now, not what this screen loaded: another tab may have added a response.
    const fresh = loadPilotData();
    onData(fresh);
    const day = dayStamp();
    if (kind === 'json') downloadJson(fresh, day);
    else downloadCsv(fresh, day);
    const who = plural(fresh.participants.length, 'participant');
    setStatus(
      kind === 'csv'
        ? `Exported ${who} as CSV: ${plural(csvRowCount(fresh), 'row')}, one per completed survey.`
        : `Exported ${who} as JSON, with the codebook and the answer sources.`,
    );
  };

  const confirmDelete = (): void => {
    if (!confirming) return;
    if (confirming.kind === 'all') {
      const ok = clearPilotData();
      onData(ok ? emptyPilotData() : loadPilotData());
      setStatus(ok ? 'All pilot-study data deleted from this browser.' : 'This browser refused to delete.');
    } else {
      const res = deleteParticipant(confirming.code);
      onData(res.data);
      setStatus(res.ok ? `Deleted ${confirming.code}.` : 'This browser would not save the change.');
    }
    closeConfirm();
  };

  return (
    <>
      <div className="sub__topbar">
        <Button variant="ghost" size="sm" icon={<ArrowLeftIcon />} nav={false} onClick={onExit}>
          Back
        </Button>
      </div>
      <ScreenHeader
        eyebrow="Optional · outside the story"
        title="Pilot study"
        titleId={TITLE_ID}
        focusTitle
        standfirst="Two short surveys, one before you play and one after. Nothing here changes the game."
      />

      <section className="pilot-section pilot-section--first" aria-labelledby="pilot-take-part">
        <h2 className="pilot-section__title" id="pilot-take-part">
          Taking part
        </h2>
        <div className="pilot-stack">
          {pending.length > 0 && (
            <div className="pilot-continue">
              {pending.length > 1 && (
                <div className="pilot-field">
                  <label htmlFor={selectId} className="pilot-field__label">
                    Your participant code
                  </label>
                  <select
                    id={selectId}
                    className="pilot-select num"
                    value={code}
                    onChange={(e) => setChosen(e.currentTarget.value)}
                  >
                    {[...pending].reverse().map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.code} · part one {p.pre?.completedOn}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                size="lg"
                meta={<span className="num">Part two for {code}</span>}
                onClick={() => onContinue(code)}
              >
                I’ve played: continue
              </Button>
            </div>
          )}
          <Button
            size="lg"
            variant={pending.length > 0 ? 'ghost' : 'primary'}
            meta="Information and consent, then part one"
            onClick={onStart}
          >
            Start as a new participant
          </Button>
        </div>
      </section>

      <details
        className="pilot-research"
        onToggle={(e) => {
          if (!e.currentTarget.open) {
            setConfirming(null);
            setToolsShown(false);
          }
        }}
      >
        <summary ref={summaryRef}>For the researcher</summary>
        {!toolsShown ? (
          <div className="pilot-research__gate">
            <p className="pilot-note">
              The tools here list every participant on this device and export or delete their answers.
              If you are taking part in the study, please close this section.
            </p>
            <div className="pilot-actions">
              <Button size="sm" variant="ghost" nav={false} onClick={() => setToolsShown(true)}>
                I’m running this study: show the tools
              </Button>
            </div>
          </div>
        ) : (
          <div className="pilot-research__body" ref={toolsRef} tabIndex={-1} role="region" aria-label="Researcher tools">
            <p className="pilot-note">
              Responses are kept only in this browser (localStorage) until you export them. Exports hold
              anonymous codes, days and answers; nothing else is collected. Closing this section hides
              the tools again.
            </p>
            <dl className="pilot-stats">
              <div>
                <dt>Participants</dt>
                <dd className="num">{sum.participants}</dd>
              </div>
              <div>
                <dt>Part one</dt>
                <dd className="num">{sum.pre}</dd>
              </div>
              <div>
                <dt>Part two</dt>
                <dd className="num">{sum.post}</dd>
              </div>
              <div>
                <dt>Paired</dt>
                <dd className="num">{sum.paired}</dd>
              </div>
            </dl>

            <div className="pilot-actions">
              <Button size="sm" nav={false} disabled={rows === 0} onClick={() => exportAs('json')}>
                Export JSON
              </Button>
              <Button size="sm" nav={false} disabled={rows === 0} onClick={() => exportAs('csv')}>
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="ghost"
                nav={false}
                disabled={rows === 0 || confirming !== null}
                onClick={() => openConfirm({ kind: 'all' })}
              >
                Delete all data…
              </Button>
            </div>
            {rows === 0 && <p className="pilot-note">Nothing stored yet.</p>}

            {confirming && (
              <div
                className="confirm"
                role="alertdialog"
                aria-modal="false"
                aria-labelledby="pilot-confirm-text"
                onKeyDown={closeOnEscape(closeConfirm)}
              >
                <p className="confirm__text" id="pilot-confirm-text">
                  <WarningIcon size={20} />
                  {confirming.kind === 'all'
                    ? `Delete every response in this browser (${plural(sum.participants, 'participant')})? ` +
                      'Export first: this can’t be undone.'
                    : `Delete all answers from ${confirming.code}? This can’t be undone.`}
                </p>
                <div className="confirm__actions">
                  <Button variant="danger" size="sm" nav={false} onClick={confirmDelete}>
                    {confirming.kind === 'all' ? 'Yes, delete everything' : `Yes, delete ${confirming.code}`}
                  </Button>
                  <Button variant="ghost" size="sm" nav={false} ref={cancelRef} onClick={closeConfirm}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {data.participants.length > 0 && (
              <div className="pilot-table-wrap">
                <table className="pilot-table">
                  <caption>Stored participants. To honour a withdrawal, delete that code.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">Consented</th>
                      <th scope="col">Part one</th>
                      <th scope="col">Part two</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.participants.map((p) => (
                      <tr key={p.code}>
                        <th scope="row" className="num">
                          {p.code}
                        </th>
                        <td className="num">{p.consentedOn}</td>
                        <td className="num">{p.pre ? p.pre.completedOn : 'Not done'}</td>
                        <td className="num">{p.post ? p.post.completedOn : 'Not done'}</td>
                        <td>
                          <button
                            type="button"
                            className="pilot-link-btn"
                            disabled={confirming !== null}
                            aria-label={`Delete ${p.code}`}
                            onClick={() => openConfirm({ kind: 'one', code: p.code })}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="notice" role="status" aria-live="polite">
              {status}
            </p>
          </div>
        )}
      </details>
    </>
  );
}

// -------------------------------------------------------------------------------------------------
// Information and consent
// -------------------------------------------------------------------------------------------------

const PRE_COUNT = itemsFor('pre').length;
const POST_COUNT = itemsFor('post').length;

function Consent({ onAgree, onBack }: { onAgree: () => void; onBack: () => void }) {
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const ready = adult && agree;
  return (
    <>
      <div className="sub__topbar">
        <Button variant="ghost" size="sm" icon={<ArrowLeftIcon />} nav={false} onClick={onBack}>
          Not now
        </Button>
      </div>
      <ScreenHeader
        eyebrow="Pilot study · information"
        title="Before you begin"
        titleId={TITLE_ID}
        focusTitle
        standfirst="Please read this first. It is short, and it is everything we ask."
      />
      <div className="pilot-prose">
        <h2>What this is</h2>
        <p>
          A small pilot study for a student final project (MGT 409). It checks whether the game’s
          story and these questions work as intended. It is not a test of you.
        </p>
        <h2>What you would do</h2>
        <p>
          Answer <span className="num">{PRE_COUNT}</span> short questions now, play Story Mode for as
          long as you like, then come back here for <span className="num">{POST_COUNT}</span> more.
        </p>
        <h2>About the game</h2>
        <p>
          The story is fiction, but it is about climate change, and about homes and towns being
          destroyed.
        </p>
        <h2>Your choice</h2>
        <p>
          Taking part is voluntary. You can skip any question and stop at any time, without giving
          a reason.
        </p>
        <h2>What is recorded</h2>
        <p>
          Only your answers, under a random code such as{' '}
          <span className="pilot-code">P-7KQ3-M9XD</span>. No name, email or contact details are
          asked for, and dates are kept to the day, not the time. Please don’t write identifying
          details in the two open questions; email addresses and long numbers are removed
          automatically.
        </p>
        <h2>Where it goes</h2>
        <p>
          Answers stay in this browser on this device until the person running the study exports
          them as an anonymous file. If you change your mind later, tell them your code and your
          answers will be deleted.
        </p>
      </div>

      <form
        className="pilot-consent"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onAgree();
        }}
      >
        <fieldset className="pilot-consent__group">
          <legend className="settings__legend">Consent</legend>
          <label className="pilot-check">
            <input
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.currentTarget.checked)}
            />
            <span>I am 18 or older.</span>
          </label>
          <label className="pilot-check">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.currentTarget.checked)}
            />
            <span>I have read the information above and I agree to take part.</span>
          </label>
        </fieldset>
        <div className="sub__actions">
          <Button
            type="submit"
            size="md"
            nav={false}
            disabled={!ready}
            aria-describedby="pilot-consent-hint"
          >
            Begin part one
          </Button>
          <Button variant="ghost" size="md" nav={false} onClick={onBack}>
            Not now
          </Button>
        </div>
        <p className="pilot-note" id="pilot-consent-hint" aria-live="polite">
          {ready ? 'Ready when you are.' : 'Tick both boxes to begin.'}
        </p>
      </form>
    </>
  );
}

// -------------------------------------------------------------------------------------------------
// Survey
// -------------------------------------------------------------------------------------------------

const isAnswered = (v: AnswerValue | undefined): boolean =>
  v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/** The phase's items grouped by section, in display order (numbering follows this order). */
function sectionsOf(phase: Phase) {
  const items = itemsFor(phase);
  return SECTIONS[phase]
    .map((section) => ({ section, items: items.filter((it) => section.blocks.includes(it.block)) }))
    .filter((s) => s.items.length > 0);
}

interface SurveyProps {
  phase: Phase;
  code: string;
  onCancel: () => void;
  onSubmit: (answers: Record<string, AnswerValue>) => void;
}

function Survey({ phase, code, onCancel, onSubmit }: SurveyProps) {
  const groups = sectionsOf(phase);
  const ordered = groups.flatMap((g) => g.items);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [confirm, setConfirm] = useState<'blank' | 'leave' | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const answered = ordered.filter((it) => isAnswered(answers[it.id])).length;
  const blanks = ordered.length - answered;

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  const set = (id: string, v: AnswerValue): void => setAnswers((a) => ({ ...a, [id]: v }));

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (blanks > 0 && confirm !== 'blank') {
      setConfirm('blank');
      return;
    }
    onSubmit(answers);
  };

  const goToFirstBlank = (): void => {
    setConfirm(null);
    const item = ordered.find((it) => !isAnswered(answers[it.id]));
    const q = item ? document.getElementById(`q-${item.id}`) : null;
    q?.scrollIntoView?.({ block: 'center' });
    q?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  };

  let n = 0;
  return (
    <>
      <div className="sub__topbar">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeftIcon />}
          nav={false}
          disabled={confirm === 'leave'}
          onClick={() => (answered > 0 ? setConfirm('leave') : onCancel())}
        >
          Cancel
        </Button>
        {confirm === 'leave' && (
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="false"
            aria-labelledby="pilot-leave-text"
            onKeyDown={closeOnEscape(() => setConfirm(null))}
          >
            <p className="confirm__text" id="pilot-leave-text">
              <WarningIcon size={20} /> Leave without submitting? Your answers on this page will not
              be kept.
            </p>
            <div className="confirm__actions">
              <Button variant="danger" size="sm" nav={false} onClick={onCancel}>
                Leave without saving
              </Button>
              <Button
                variant="ghost"
                size="sm"
                nav={false}
                ref={confirmRef}
                onClick={() => setConfirm(null)}
              >
                Keep answering
              </Button>
            </div>
          </div>
        )}
      </div>
      <ScreenHeader
        eyebrow={phase === 'pre' ? 'Pilot study · part one' : 'Pilot study · part two'}
        title={PHASE_TITLE[phase]}
        titleId={TITLE_ID}
        focusTitle
        standfirst={`${ordered.length} short questions. You can skip any of them.`}
      />
      <p className="pilot-ribbon">
        Participant code <span className="pilot-code">{code}</span>
        {phase === 'pre' && (
          <span className="pilot-ribbon__hint">
            Note it down if you can. This device remembers it for part two.
          </span>
        )}
      </p>

      <form className="pilot-form" onSubmit={handleSubmit} noValidate>
        {groups.map(({ section, items }, si) => {
          const headingId = `pilot-sec-${phase}-${si}`;
          return (
            <section key={section.title} className="pilot-section" aria-labelledby={headingId}>
              <h2 className="pilot-section__title" id={headingId}>
                <span className="pilot-section__n num" aria-hidden="true">
                  {String(si + 1).padStart(2, '0')}
                </span>
                {section.title}
              </h2>
              <p className="pilot-section__lede">{section.lede}</p>
              {items.map((item) => {
                n += 1;
                return (
                  <Question
                    key={item.id}
                    item={item}
                    n={n}
                    value={answers[item.id] ?? null}
                    onChange={set}
                  />
                );
              })}
            </section>
          );
        })}

        <div className="pilot-submit">
          <p className="pilot-progress">
            <span className="num">{answered}</span> of <span className="num">{ordered.length}</span>{' '}
            answered
          </p>
          {confirm === 'blank' && blanks > 0 ? (
            <div
              className="confirm"
              role="alertdialog"
              aria-modal="false"
              aria-labelledby="pilot-blank-text"
              onKeyDown={closeOnEscape(() => setConfirm(null))}
            >
              <p className="confirm__text" id="pilot-blank-text">
                <WarningIcon size={20} />
                {blanks === 1 ? 'One question is' : `${blanks} questions are`} still blank. That is
                fine: you can skip any question.
              </p>
              <div className="confirm__actions">
                <Button type="submit" size="sm" nav={false} ref={confirmRef}>
                  Submit with {blanks === 1 ? 'one blank' : `${blanks} blanks`}
                </Button>
                <Button variant="ghost" size="sm" nav={false} onClick={goToFirstBlank}>
                  Go to the first blank
                </Button>
              </div>
            </div>
          ) : (
            <div className="sub__actions pilot-submit__actions">
              <Button type="submit" size="md" nav={false} icon={<CheckIcon />}>
                {phase === 'pre' ? 'Submit part one' : 'Submit part two'}
              </Button>
            </div>
          )}
        </div>
      </form>
    </>
  );
}

interface QuestionProps<T extends PilotItem> {
  item: T;
  n: number;
  value: AnswerValue;
  onChange: (id: string, v: AnswerValue) => void;
}

function Question(props: QuestionProps<PilotItem>) {
  const { item } = props;
  switch (item.type) {
    case 'likert':
      return <LikertQuestion {...props} item={item} />;
    case 'choice':
    case 'factual':
      return <ChoiceQuestion {...props} item={item} />;
    case 'open':
      return <OpenQuestion {...props} item={item} />;
  }
}

function Legend({ n, text }: { n: number; text: string }) {
  return (
    <legend className="pilot-q__text">
      <span className="pilot-q__n num">{n}.</span> <span>{text}</span>
    </legend>
  );
}

function LikertQuestion({ item, n, value, onChange }: QuestionProps<LikertItem>) {
  return (
    <fieldset className="pilot-q" id={`q-${item.id}`}>
      <Legend n={n} text={item.text} />
      <div className="pilot-likert">
        {LIKERT_LABELS.map((label, i) => {
          const v = i + 1;
          const on = value === v;
          return (
            <label key={v} className={`pilot-opt pilot-opt--likert${on ? ' is-on' : ''}`}>
              <input
                type="radio"
                name={item.id}
                value={v}
                checked={on}
                onChange={() => onChange(item.id, v)}
              />
              <span className="pilot-opt__n num" aria-hidden="true">
                {v}
              </span>
              <span className="pilot-opt__label">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ChoiceQuestion({ item, n, value, onChange }: QuestionProps<ChoiceItem | FactualItem>) {
  return (
    <fieldset className="pilot-q" id={`q-${item.id}`}>
      <Legend n={n} text={item.text} />
      <div className="pilot-choices">
        {item.options.map((o) => {
          const on = value === o.id;
          return (
            <label key={o.id} className={`pilot-opt pilot-opt--row${on ? ' is-on' : ''}`}>
              <input
                type="radio"
                name={item.id}
                value={o.id}
                checked={on}
                onChange={() => onChange(item.id, o.id)}
              />
              <span className="pilot-opt__mark" aria-hidden="true" />
              <span className="pilot-opt__label">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function OpenQuestion({ item, n, value, onChange }: QuestionProps<OpenItem>) {
  const text = typeof value === 'string' ? value : '';
  const inputId = `q-${item.id}-input`;
  const hintId = `q-${item.id}-hint`;
  return (
    <div className="pilot-q pilot-q--open" id={`q-${item.id}`}>
      <label className="pilot-q__text" htmlFor={inputId}>
        <span className="pilot-q__n num">{n}.</span> <span>{item.text}</span>
      </label>
      <textarea
        id={inputId}
        className="pilot-textarea"
        rows={4}
        maxLength={item.maxLength}
        aria-describedby={hintId}
        value={text}
        onChange={(e) => onChange(item.id, e.currentTarget.value)}
      />
      <p className="pilot-q__hint" id={hintId}>
        <span>Optional. Emails and long numbers are removed automatically.</span>
        <span className="num" aria-hidden="true">
          {text.length} / {item.maxLength}
        </span>
      </p>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Thank you (and, after part two, the debrief with the factual answers and their sources)
// -------------------------------------------------------------------------------------------------

interface DoneProps {
  phase: Phase;
  code: string;
  saved: boolean;
  onExit: () => void;
  onHome: () => void;
}

function Done({ phase, code, saved, onExit, onHome }: DoneProps) {
  return (
    <>
      <ScreenHeader
        eyebrow={phase === 'pre' ? 'Part one done' : 'Both parts done'}
        title="Thank you"
        titleId={TITLE_ID}
        focusTitle
        standfirst={
          phase === 'pre'
            ? 'Now play Story Mode. When you have finished, come back to Pilot study for part two.'
            : 'That is everything. Your answers will help decide what the game should change.'
        }
      />
      {!saved && (
        <p className="confirm pilot-error" role="alert">
          <WarningIcon size={20} /> This browser would not save your answers (private browsing or
          full storage). Please tell the person running the study.
        </p>
      )}
      <p className="pilot-ribbon">
        Participant code <span className="pilot-code">{code}</span>
        <span className="pilot-ribbon__hint">
          {phase === 'pre'
            ? 'After playing, choose “I’ve played: continue” on the Pilot study screen.'
            : 'Quote it if you ever want your answers deleted.'}
        </span>
      </p>

      {phase === 'post' && (
        <section className="pilot-section" aria-labelledby="pilot-answers">
          <h2 className="pilot-section__title" id="pilot-answers">
            The factual questions, answered
          </h2>
          <p className="pilot-section__lede">
            The people, towns and records in The Last Thaw are invented. These facts are not.
          </p>
          <ol className="pilot-key">
            {FACTUAL_ITEMS.map((item) => (
              <li key={item.id} className="pilot-key__item">
                <p className="pilot-key__q">{item.text}</p>
                <p className="pilot-key__a">
                  <CheckIcon size={18} />
                  <span>{item.options.find((o) => o.id === item.correct)?.label}</span>
                </p>
                <p className="pilot-key__src">
                  Source:{' '}
                  <a href={item.source.url} target="_blank" rel="noreferrer">
                    {item.source.org}, {item.source.title}
                  </a>
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="sub__actions">
        <Button size="md" nav={false} onClick={onExit}>
          {phase === 'pre' ? 'Go to the main menu' : 'Back to the menu'}
        </Button>
        <Button variant="ghost" size="md" nav={false} onClick={onHome}>
          Pilot study home
        </Button>
      </div>
    </>
  );
}
