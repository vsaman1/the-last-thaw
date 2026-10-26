// @vitest-environment jsdom
/**
 * Pilot-study screens (jsdom): consent gating, part one with skipped questions, the device
 * remembering the code for part two, the debrief's answer key, Escape never discarding a survey,
 * the researcher's CSV/JSON export, withdrawal of one participant and delete-all with confirmation.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FACTUAL_ITEMS, itemsFor } from './instrument';
import { PilotStudy } from './PilotStudy';
import { CODE_PATTERN, PILOT_STORAGE_KEY, loadPilotData } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let onExit: Mock<() => void>;
let downloads: { name: string; href: string }[];
let blobs: Map<string, Blob>;

/** Raw bytes of a download (Blob.text() would silently drop the byte-order mark we check for). */
async function downloadBytes(i: number): Promise<Uint8Array> {
  const blob = blobs.get(downloads[i].href);
  if (!blob) throw new Error(`Download ${i} was not a Blob URL: ${downloads[i].href}`);
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

const text = (): string => container.textContent ?? '';
const heading = (): string => container.querySelector('h1')?.textContent ?? '';
const buttons = (): HTMLButtonElement[] => Array.from(container.querySelectorAll('button'));
function button(name: string | RegExp): HTMLButtonElement {
  const match = (s: string | null) =>
    s !== null && (typeof name === 'string' ? s.trim().startsWith(name) : name.test(s));
  const b = buttons().find((el) => match(el.getAttribute('aria-label')) || match(el.textContent));
  if (!b) throw new Error(`No button "${String(name)}". Buttons: ${buttons().map((x) => x.textContent).join(' | ')}`);
  return b;
}
const click = (el: HTMLElement) => act(() => el.click());
const key = (k: string, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const questions = (): HTMLElement[] => Array.from(container.querySelectorAll('.pilot-q'));
const ribbonCode = (): string => container.querySelector('.pilot-ribbon .pilot-code')?.textContent ?? '';

function render() {
  act(() => root.render(<PilotStudy onExit={onExit} />));
}

/** The researcher's deliberate step: open "For the researcher" and ask for the tools. */
function showResearcherTools() {
  const details = container.querySelector<HTMLDetailsElement>('details.pilot-research')!;
  act(() => {
    details.open = true;
  });
  click(button('I’m running this study'));
}

/** Consent → part one, answering only the first Likert item (4) and the first factual item. */
function doPartOne(): string {
  click(button('Start as a new participant'));
  for (const box of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(box);
  click(button('Begin part one'));
  const fact = FACTUAL_ITEMS[0];
  click(container.querySelector<HTMLInputElement>('input[name="att1_affects_people"][value="4"]')!);
  click(container.querySelector<HTMLInputElement>(`input[name="${fact.id}"][value="${fact.correct}"]`)!);
  const code = ribbonCode();
  click(button('Submit part one'));
  click(button(/^Submit with \d+ blanks$/));
  return code;
}

beforeEach(() => {
  localStorage.clear();
  onExit = vi.fn<() => void>();
  downloads = [];
  blobs = new Map();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    const href = `blob:pilot-test/${blobs.size}`;
    blobs.set(href, b as Blob);
    return href;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('PilotStudy', () => {
  it('opens on the hub with nothing to export, and Escape leaves', () => {
    render();
    expect(heading()).toBe('Pilot study');
    showResearcherTools();
    expect(text()).toContain('Nothing stored yet.');
    expect(button('Export CSV').disabled).toBe(true);
    expect(button('Export JSON').disabled).toBe(true);
    key('Escape');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('cannot begin until both consent boxes are ticked; Escape backs out of consent', () => {
    render();
    click(button('Start as a new participant'));
    expect(heading()).toBe('Before you begin');
    const begin = button('Begin part one');
    expect(begin.disabled).toBe(true);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    click(boxes[0]);
    expect(button('Begin part one').disabled).toBe(true);
    click(boxes[1]);
    expect(button('Begin part one').disabled).toBe(false);
    key('Escape');
    expect(heading()).toBe('Pilot study');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('nothing is stored by consenting and leaving', () => {
    render();
    click(button('Start as a new participant'));
    for (const box of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(box);
    click(button('Begin part one'));
    click(button('Cancel'));
    expect(heading()).toBe('Pilot study');
    expect(localStorage.getItem(PILOT_STORAGE_KEY)).toBeNull();
  });

  it('part one: anonymous code, every pre item, Escape ignored, skipped answers confirmed then saved', () => {
    render();
    click(button('Start as a new participant'));
    for (const box of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(box);
    click(button('Begin part one'));
    expect(heading()).toBe('Before you play');
    expect(document.activeElement?.id).toBe('pilot-title');
    expect(ribbonCode()).toMatch(CODE_PATTERN);
    expect(questions()).toHaveLength(itemsFor('pre').length);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);

    key('Escape');
    expect(onExit).not.toHaveBeenCalled();
    expect(heading()).toBe('Before you play');

    const radio = container.querySelector<HTMLInputElement>('input[name="att1_affects_people"][value="4"]')!;
    click(radio);
    expect(radio.checked).toBe(true);
    expect(radio.closest('label')?.classList.contains('is-on')).toBe(true);
    expect(text()).toContain(`1 of ${itemsFor('pre').length} answered`);

    click(button('Submit part one'));
    const blanks = itemsFor('pre').length - 1;
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain(`${blanks} questions are`);
    expect(localStorage.getItem(PILOT_STORAGE_KEY)).toBeNull();
    click(button(`Submit with ${blanks} blanks`));

    expect(heading()).toBe('Thank you');
    const data = loadPilotData();
    expect(data.participants).toHaveLength(1);
    const p = data.participants[0];
    expect(p.code).toMatch(CODE_PATTERN);
    expect(p.pre?.answers.att1_affects_people).toBe(4);
    expect(p.pre?.answers.att2_past_decisions).toBeNull();
    expect(p.post).toBeNull();
  });

  it('cancelling a started survey asks first', () => {
    render();
    click(button('Start as a new participant'));
    for (const box of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(box);
    click(button('Begin part one'));
    click(container.querySelector<HTMLInputElement>('input[name="att1_affects_people"][value="2"]')!);
    click(button('Cancel'));
    expect(text()).toContain('Leave without submitting?');
    key('Escape', document.activeElement ?? window);
    expect(text()).not.toContain('Leave without submitting?');
    expect(heading()).toBe('Before you play');
    click(button('Cancel'));
    click(button('Leave without saving'));
    expect(heading()).toBe('Pilot study');
    expect(localStorage.getItem(PILOT_STORAGE_KEY)).toBeNull();
  });

  it('part two continues the remembered code, submits a full survey and shows the answer key', () => {
    render();
    const code = doPartOne();
    click(button('Pilot study home'));
    expect(button('I’ve played: continue').textContent).toContain(code);
    click(button('I’ve played: continue'));
    expect(heading()).toBe('After you play');
    expect(ribbonCode()).toBe(code);
    expect(questions()).toHaveLength(itemsFor('post').length);

    // Answer everything: no blank prompt, straight to the thank-you page.
    for (const q of questions()) {
      const first = q.querySelector<HTMLInputElement>('input[type="radio"]');
      if (first) click(first);
    }
    const areas = container.querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(areas).toHaveLength(2);
    type(areas[0], 'The letter in chapter 4. Write me: me@example.com');
    type(areas[1], 'Nothing.');
    expect(text()).toContain(`${itemsFor('post').length} of ${itemsFor('post').length} answered`);
    click(button('Submit part two'));

    expect(heading()).toBe('Thank you');
    const answerKey = container.querySelectorAll('.pilot-key__item');
    expect(answerKey).toHaveLength(FACTUAL_ITEMS.length);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('.pilot-key a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(FACTUAL_ITEMS.map((it) => it.source.url));

    const p = loadPilotData().participants[0];
    expect(p.code).toBe(code);
    expect(p.pre).not.toBeNull();
    expect(p.post?.answers.open1_moment).toBe('The letter in chapter 4. Write me: [email removed]');
    click(button('Back to the menu'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the researcher exports CSV and JSON, withdraws one participant, and deletes everything', async () => {
    render();
    const first = doPartOne();
    click(button('Pilot study home'));
    const second = doPartOne();
    click(button('Pilot study home'));
    showResearcherTools();
    expect(container.querySelectorAll('.pilot-table tbody tr')).toHaveLength(2);

    click(button('Export CSV'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^iceberg-river-pilot-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(blobs.get(downloads[0].href)?.type).toBe('text/csv;charset=utf-8');
    const csvBytes = await downloadBytes(0);
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM, for Excel
    const csv = new TextDecoder().decode(csvBytes);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3); // header + one row each
    expect(csv).toContain(first);
    expect(csv).toContain(second);
    expect(text()).toContain('Exported 2 participants as CSV: 2 rows');

    click(button('Export JSON'));
    expect(downloads[1].name).toMatch(/\.json$/);
    const json = JSON.parse(new TextDecoder().decode(await downloadBytes(1)));
    expect(json.participants.map((p: { code: string }) => p.code)).toEqual([first, second]);

    // Withdrawal: Escape closes the confirmation only.
    click(button(`Delete ${first}`));
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    key('Escape', document.activeElement ?? window);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    click(button(`Delete ${first}`));
    click(button(`Yes, delete ${first}`));
    expect(loadPilotData().participants.map((p) => p.code)).toEqual([second]);
    expect(text()).toContain(`Deleted ${first}.`);

    click(button('Delete all data'));
    click(button('Cancel'));
    expect(loadPilotData().participants).toHaveLength(1);
    click(button('Delete all data'));
    click(button('Yes, delete everything'));
    expect(localStorage.getItem(PILOT_STORAGE_KEY)).toBeNull();
    expect(text()).toContain('Nothing stored yet.');
  });

  it('a participant on the hub sees no one else’s data until the researcher asks for the tools', () => {
    render();
    const first = doPartOne();
    click(button('Pilot study home'));
    // Closed by default, and opening the section only explains what is inside.
    const details = container.querySelector<HTMLDetailsElement>('details.pilot-research')!;
    expect(details.open).toBe(false);
    act(() => {
      details.open = true;
    });
    const hidden = (): void => {
      const panel = container.querySelector('details.pilot-research')!;
      expect(panel.textContent).not.toContain(first);
      expect(panel.textContent).not.toMatch(/Participants\s*\d/);
      expect(container.querySelector('.pilot-table')).toBeNull();
      expect(buttons().some((b) => /^Export|^Delete/.test(b.textContent ?? ''))).toBe(false);
    };
    hidden();
    expect(text()).toContain('If you are taking part in the study, please close this section.');

    click(button('I’m running this study'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Researcher tools');
    expect(container.querySelector('.pilot-table')?.textContent).toContain(first);
    button('Export CSV');
    button(`Delete ${first}`);

    // Closing the section hides the tools again (and drops an open question).
    click(button(`Delete ${first}`));
    act(() => {
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
    });
    act(() => {
      details.open = true;
    });
    hidden();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();

    // So does leaving the hub: the next visitor finds the step in place.
    click(button('I’m running this study'));
    click(button('Start as a new participant'));
    click(button('Not now'));
    hidden();
    expect(loadPilotData().participants.map((p) => p.code)).toEqual([first]);
  });
});
