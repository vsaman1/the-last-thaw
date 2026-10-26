/**
 * Pilot study, logic only (node): the instrument's shape and answer keys, anonymous codes and day
 * stamps, free-text scrubbing, the storage sanitiser, the store operations, and both export formats.
 * The screens are covered by PilotStudy.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CSV_BOM,
  CSV_FIXED_COLUMNS,
  EXPORT_FORMAT,
  FACT_SCORE_COLUMN,
  buildExport,
  correctColumn,
  csvCell,
  csvColumns,
  csvRowCount,
  exportFilename,
  toCsv,
  toJson,
} from './export';
import {
  FACTUAL_ITEMS,
  INSTRUMENT_VERSION,
  ITEMS,
  LIKERT_LABELS,
  OPEN_MAX_LENGTH,
  SECTIONS,
  UNSURE,
  itemsFor,
  type ItemBlock,
  type Phase,
} from './instrument';
import {
  CODE_ALPHABET,
  CODE_PATTERN,
  EMAIL_PLACEHOLDER,
  MAX_PARTICIPANTS,
  NUMBER_PLACEHOLDER,
  PILOT_STORAGE_KEY,
  clearPilotData,
  dayStamp,
  deleteParticipant,
  emptyPilotData,
  loadPilotData,
  newParticipantCode,
  pendingPost,
  recordResponse,
  sanitizeAnswers,
  sanitizeDay,
  sanitizePilotData,
  scrubText,
  summarize,
  type PilotData,
} from './store';

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function useStorage(init: Record<string, string> = {}): Storage {
  const s = memoryStorage(init);
  vi.stubGlobal('localStorage', s);
  return s;
}

const stored = (s: Storage): unknown => JSON.parse(s.getItem(PILOT_STORAGE_KEY) ?? 'null');

/** A deterministic byte source cycling through `seq`. */
const cycle =
  (seq: readonly number[]) =>
  (n: number): Uint8Array => {
    let i = 0;
    return Uint8Array.from({ length: n }, () => seq[i++ % seq.length]);
  };

const CODE_A = 'P-ABCD-EFGH';
const CODE_B = 'P-2345-6789';

/** Every phase item answered with a valid value (first option, Likert 4, short open text). */
function fullAnswers(phase: Phase): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const it of itemsFor(phase)) {
    if (it.type === 'likert') out[it.id] = 4;
    else if (it.type === 'open') out[it.id] = `answer to ${it.id}`;
    else out[it.id] = it.type === 'factual' ? it.correct : it.options[0].id;
  }
  return out;
}

const sample = (): PilotData => ({
  version: 1,
  participants: [
    {
      code: CODE_A,
      consentedOn: '2026-10-20',
      pre: { instrument: INSTRUMENT_VERSION, completedOn: '2026-10-20', answers: sanitizeAnswers('pre', fullAnswers('pre')) },
      post: { instrument: INSTRUMENT_VERSION, completedOn: '2026-10-21', answers: sanitizeAnswers('post', fullAnswers('post')) },
    },
    {
      code: CODE_B,
      consentedOn: '2026-10-21',
      pre: { instrument: INSTRUMENT_VERSION, completedOn: '2026-10-21', answers: sanitizeAnswers('pre', {}) },
      post: null,
    },
  ],
});

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF) to read our own CSV back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = (): void => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// -------------------------------------------------------------------------------------------------
// Instrument
// -------------------------------------------------------------------------------------------------

describe('instrument', () => {
  const count = (phase: Phase, block: ItemBlock) =>
    itemsFor(phase).filter((it) => it.block === block).length;

  it('has the brief’s blocks in the brief’s sizes', () => {
    expect(count('pre', 'attitude')).toBeGreaterThanOrEqual(5);
    expect(count('pre', 'attitude')).toBeLessThanOrEqual(7);
    expect(count('pre', 'factual')).toBeGreaterThanOrEqual(4);
    expect(count('pre', 'factual')).toBeLessThanOrEqual(5);
    expect(count('post', 'usability')).toBe(5);
    expect(count('post', 'emotion')).toBeGreaterThanOrEqual(4);
    expect(count('post', 'emotion')).toBeLessThanOrEqual(5);
    expect(count('post', 'open')).toBe(2);
    // Pre asks attitudes and facts only; nothing about a game they have not played yet.
    expect(new Set(itemsFor('pre').map((it) => it.block))).toEqual(new Set(['attitude', 'factual']));
  });

  it('asks the same attitude and factual items before and after, for a pre/post comparison', () => {
    const ids = (phase: Phase) =>
      itemsFor(phase)
        .filter((it) => it.block === 'attitude' || it.block === 'factual')
        .map((it) => it.id);
    expect(ids('post')).toEqual(ids('pre'));
  });

  it('uses unique snake_case ids that are safe as CSV columns', () => {
    const ids = ITEMS.map((it) => it.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('shows every item of a phase in exactly one section', () => {
    for (const phase of ['pre', 'post'] as const) {
      const blocks = SECTIONS[phase].flatMap((s) => s.blocks);
      expect(new Set(blocks).size).toBe(blocks.length);
      for (const it of itemsFor(phase)) expect(blocks).toContain(it.block);
    }
  });

  it('marks the SUS items it adapts, with SUS’s alternating direction', () => {
    const us = ITEMS.filter((it) => it.block === 'usability');
    for (const it of us) {
      expect(it.type).toBe('likert');
      if (it.type !== 'likert') continue;
      expect(it.susItem).toBeGreaterThanOrEqual(1);
      expect(it.susItem).toBeLessThanOrEqual(10);
      // SUS: odd items positive, even items negative.
      expect(Boolean(it.reverse)).toBe((it.susItem ?? 0) % 2 === 0);
    }
  });

  it('keeps at least one reverse-keyed attitude item (catches straight-lining)', () => {
    expect(ITEMS.some((it) => it.block === 'attitude' && it.type === 'likert' && it.reverse)).toBe(true);
  });

  it('uses a five-point agreement scale', () => {
    expect(LIKERT_LABELS).toHaveLength(5);
  });
});

describe('factual answer keys', () => {
  const HOSTS: Record<string, RegExp> = {
    NASA: /(^|\.)nasa\.gov$/,
    NOAA: /(^|\.)(noaa\.gov|climate\.gov)$/,
    IPCC: /(^|\.)ipcc\.ch$/,
  };

  it('every factual item has a correct option and a NASA / NOAA / IPCC source', () => {
    expect(FACTUAL_ITEMS.length).toBeGreaterThanOrEqual(4);
    for (const it of FACTUAL_ITEMS) {
      const ids = it.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(it.correct);
      expect(it.correct).not.toBe(UNSURE.id);
      expect(ids).toContain(UNSURE.id);
      expect(['NASA', 'NOAA', 'IPCC']).toContain(it.source.org);
      const url = new URL(it.source.url);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toMatch(HOSTS[it.source.org]);
      expect(it.source.title.length).toBeGreaterThan(5);
      expect(it.source.quote.length).toBeGreaterThan(40);
      expect(sanitizeDay(it.source.accessed)).toBe(it.source.accessed);
    }
  });

  it('spreads the correct answers over different positions', () => {
    expect(new Set(FACTUAL_ITEMS.map((it) => it.correct)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('anonymity by construction', () => {
  it('free text exists only in the two open questions, both after play', () => {
    const open = ITEMS.filter((it) => it.type === 'open');
    expect(open.map((it) => it.block)).toEqual(['open', 'open']);
    for (const it of open) {
      expect(it.phases).toEqual(['post']);
      if (it.type === 'open') expect(it.maxLength).toBe(OPEN_MAX_LENGTH);
    }
  });

  it('no question asks for anything that identifies a person', () => {
    const PERSONAL =
      /\b(name|e-?mail|age|born|birth|gender|sex|address|phone|city|school|university|student id|ip)\b/i;
    for (const it of ITEMS) {
      expect(it.text, it.id).not.toMatch(PERSONAL);
      expect(it.id).not.toMatch(PERSONAL);
    }
  });

  it('participant codes have the fixed format and no look-alike characters', () => {
    for (let i = 0; i < 200; i++) expect(newParticipantCode()).toMatch(CODE_PATTERN);
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
    expect(newParticipantCode(cycle([0, 1, 2, 3, 4, 5, 6, 7]))).toBe('P-ABCD-EFGH');
  });

  it('codes draw each symbol uniformly (bytes past the last full cycle are skipped)', () => {
    // 248..255 would bias the first 8 symbols; they are re-drawn, not wrapped.
    expect(newParticipantCode(cycle([255, 248, 0, 30]))).toBe('P-A9A9-A9A9');
  });

  it('codes avoid codes already used on this device, and fail loudly on a broken source', () => {
    const fixed = cycle([0]);
    expect(newParticipantCode(fixed)).toBe('P-AAAA-AAAA');
    expect(() => newParticipantCode(fixed, new Set(['P-AAAA-AAAA']))).toThrow(/not random/);
    expect(() => newParticipantCode(cycle([255]))).toThrow();
  });

  it('dates are days, never times', () => {
    expect(dayStamp(new Date(2026, 9, 21, 23, 59, 59))).toBe('2026-10-21');
    expect(dayStamp(new Date(2027, 0, 2))).toBe('2027-01-02');
    expect(sanitizeDay('2026-10-21T14:32:10.123Z')).toBe('2026-10-21');
    expect(sanitizeDay('2026-10-21 14:32')).toBe('2026-10-21');
    for (const bad of ['21/10/2026', '2026-13-01', '2026-10-00', '1999-01-01', '', 20261021, null]) {
      expect(sanitizeDay(bad)).toBeNull();
    }
  });
});

// -------------------------------------------------------------------------------------------------
// Free text
// -------------------------------------------------------------------------------------------------

describe('scrubText', () => {
  it('removes email addresses and phone-like numbers', () => {
    expect(scrubText('write to Jo.Smith+x@uni.example.ac.uk please')).toBe(
      `write to ${EMAIL_PLACEHOLDER} please`,
    );
    expect(scrubText('call +1 (203) 555-0142 now')).toBe(`call ${NUMBER_PLACEHOLDER} now`);
    expect(scrubText('my id 123456789')).toBe(`my id ${NUMBER_PLACEHOLDER}`);
  });

  it('keeps years, chapter numbers and short ranges', () => {
    const s = 'Chapter 7, the 1998 letter, and 2031-2040 stayed with me. 12 ppm.';
    expect(scrubText(s)).toBe(s);
  });

  it('strips control characters, keeps paragraphs, trims and caps the length', () => {
    expect(scrubText('  a\u0000b\u0007\r\nc\td  ')).toBe('ab\nc\td');
    expect(scrubText('x'.repeat(OPEN_MAX_LENGTH + 50))).toHaveLength(OPEN_MAX_LENGTH);
    expect(scrubText('abcdef', 3)).toBe('abc');
  });
});

// -------------------------------------------------------------------------------------------------
// Sanitising stored data
// -------------------------------------------------------------------------------------------------

describe('sanitizePilotData', () => {
  it('turns anything that is not a version-1 store into an empty one', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}, { version: 2, participants: [] }, { version: 1 }]) {
      expect(sanitizePilotData(raw)).toEqual(emptyPilotData());
    }
  });

  it('round-trips well-formed data unchanged', () => {
    const data = sample();
    expect(sanitizePilotData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('copies whitelisted fields only: extra identifying fields are dropped on load', () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    Object.assign(raw, { researcher: 'someone' });
    Object.assign(raw.participants[0], { name: 'Ada', email: 'ada@example.com', ip: '10.0.0.1' });
    Object.assign(raw.participants[0].pre, { userAgent: 'Mozilla', startedAt: '14:02' });
    // JSON.parse makes "__proto__" an own key, as a hand-edited store would.
    Object.assign(raw.participants[0].pre.answers, JSON.parse('{"name":"Ada","__proto__":{"polluted":1}}'));
    const clean = sanitizePilotData(raw);
    const text = JSON.stringify(clean);
    for (const leak of ['Ada', 'ada@example.com', '10.0.0.1', 'Mozilla', '14:02', 'researcher', 'polluted']) {
      expect(text).not.toContain(leak);
    }
    expect(Object.keys(clean)).toEqual(['version', 'participants']);
    expect(Object.keys(clean.participants[0]).sort()).toEqual(['code', 'consentedOn', 'post', 'pre']);
    expect(Object.keys(clean.participants[0].pre ?? {}).sort()).toEqual([
      'answers',
      'completedOn',
      'instrument',
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps exactly the phase’s items, nulling out-of-range or wrong-typed answers', () => {
    const answers = sanitizeAnswers('pre', {
      att1_affects_people: 6,
      att2_past_decisions: 0,
      att3_irreversible: 2.5,
      att4_unequal_harm: '4',
      att5_wait_for_certainty: 5,
      fact1_co2_ppm: 'z',
      fact2_warming: 'b',
      fact3_main_cause: 4,
      em1_cared_people: 5, // a post item: not part of pre
      open1_moment: 'hello', // a post item: not part of pre
    });
    expect(Object.keys(answers)).toEqual(itemsFor('pre').map((it) => it.id));
    expect(answers.att1_affects_people).toBeNull();
    expect(answers.att2_past_decisions).toBeNull();
    expect(answers.att3_irreversible).toBeNull();
    expect(answers.att4_unequal_harm).toBeNull();
    expect(answers.att5_wait_for_certainty).toBe(5);
    expect(answers.fact1_co2_ppm).toBeNull();
    expect(answers.fact2_warming).toBe('b');
    expect(answers.fact3_main_cause).toBeNull();
    expect(answers).not.toHaveProperty('em1_cared_people');
  });

  it('scrubs open answers on load too (a hand-edited store cannot smuggle an email in)', () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    raw.participants[0].post.answers.open1_moment = 'mail me at a@b.co';
    raw.participants[0].post.answers.open2_change = '   ';
    const p = sanitizePilotData(raw).participants[0];
    expect(p.post?.answers.open1_moment).toBe(`mail me at ${EMAIL_PLACEHOLDER}`);
    expect(p.post?.answers.open2_change).toBeNull();
  });

  it('cuts timestamps to days and falls back to the first completed day for consent', () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    raw.participants[0].pre.completedOn = '2026-10-20T09:15:00Z';
    raw.participants[0].consentedOn = 'yesterday';
    const p = sanitizePilotData(raw).participants[0];
    expect(p.pre?.completedOn).toBe('2026-10-20');
    expect(p.consentedOn).toBe('2026-10-20');
  });

  it('drops malformed participants and phases instead of repairing them', () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    raw.participants.push(
      { code: 'Ada Lovelace', consentedOn: '2026-10-21', pre: raw.participants[1].pre, post: null },
      { code: 'P-ABCD-EFG0', consentedOn: '2026-10-21', pre: raw.participants[1].pre, post: null },
      { code: 'P-ZZZZ-ZZZZ', consentedOn: '2026-10-21', pre: { answers: {} }, post: 'x' },
      { ...raw.participants[0], consentedOn: '2026-01-01' }, // duplicate code: first record wins
      'junk',
    );
    raw.participants[1].pre.instrument = '<script>';
    const clean = sanitizePilotData(raw);
    expect(clean.participants.map((p) => p.code)).toEqual([CODE_A]);
    expect(clean.participants[0].consentedOn).toBe('2026-10-20');
  });

  it('stops at MAX_PARTICIPANTS', () => {
    const one = sample().participants[1];
    const many = Array.from({ length: MAX_PARTICIPANTS + 5 }, (_, i) => ({
      ...one,
      // i in base 31 → distinct codes, so only the cap can drop anyone.
      code: newParticipantCode(cycle([i % 31, Math.floor(i / 31) % 31, Math.floor(i / 961), 0, 1, 2, 3, 4])),
    }));
    expect(new Set(many.map((p) => p.code)).size).toBe(many.length);
    const kept = sanitizePilotData({ version: 1, participants: many }).participants;
    expect(kept).toHaveLength(MAX_PARTICIPANTS);
    expect(kept[0].code).toBe(many[0].code);
  });
});

// -------------------------------------------------------------------------------------------------
// Storage operations
// -------------------------------------------------------------------------------------------------

describe('storage', () => {
  it('loads empty when nothing, garbage or no storage at all is there', () => {
    useStorage();
    expect(loadPilotData()).toEqual(emptyPilotData());
    useStorage({ [PILOT_STORAGE_KEY]: '{not json' });
    expect(loadPilotData()).toEqual(emptyPilotData());
    vi.stubGlobal('localStorage', undefined);
    expect(loadPilotData()).toEqual(emptyPilotData());
  });

  it('sanitises on load', () => {
    const raw = JSON.parse(JSON.stringify(sample()));
    raw.participants[0].name = 'Ada';
    useStorage({ [PILOT_STORAGE_KEY]: JSON.stringify(raw) });
    expect(loadPilotData()).toEqual(sample());
  });

  it('records part one then part two under one code, scrubbing and stamping days', () => {
    const s = useStorage();
    const pre = recordResponse({
      code: CODE_A,
      phase: 'pre',
      consentedOn: '2026-10-20T10:00:00Z',
      answers: { ...fullAnswers('pre'), extra: 'x' },
      today: '2026-10-20',
    });
    expect(pre.ok).toBe(true);
    expect(pendingPost(pre.data).map((p) => p.code)).toEqual([CODE_A]);
    const post = recordResponse({
      code: CODE_A,
      phase: 'post',
      consentedOn: 'ignored for an existing participant',
      answers: { ...fullAnswers('post'), open1_moment: 'the 1998 letter; ada@example.com' },
      today: '2026-10-21',
    });
    expect(post.ok).toBe(true);
    const saved = sanitizePilotData(stored(s));
    expect(saved).toEqual(post.data);
    const p = saved.participants[0];
    expect(p.consentedOn).toBe('2026-10-20');
    expect(p.pre?.completedOn).toBe('2026-10-20');
    expect(p.post?.completedOn).toBe('2026-10-21');
    expect(p.pre?.instrument).toBe(INSTRUMENT_VERSION);
    expect(p.pre?.answers).not.toHaveProperty('extra');
    expect(p.post?.answers.open1_moment).toBe(`the 1998 letter; ${EMAIL_PLACEHOLDER}`);
    expect(pendingPost(saved)).toEqual([]);
    expect(summarize(saved)).toEqual({ participants: 1, pre: 1, post: 1, paired: 1 });
  });

  it('keeps a response saved meanwhile in another tab', () => {
    const s = useStorage();
    recordResponse({ code: CODE_A, phase: 'pre', consentedOn: '2026-10-20', answers: {} });
    // "Another tab" writes CODE_B straight to storage.
    const other = sanitizePilotData(stored(s));
    s.setItem(
      PILOT_STORAGE_KEY,
      JSON.stringify({ ...other, participants: [...other.participants, sample().participants[1]] }),
    );
    const res = recordResponse({ code: CODE_A, phase: 'post', consentedOn: '2026-10-20', answers: {} });
    expect(res.data.participants.map((p) => p.code)).toEqual([CODE_A, CODE_B]);
  });

  it('refuses a malformed code and reports a storage failure', () => {
    useStorage();
    expect(recordResponse({ code: 'Ada', phase: 'pre', consentedOn: '2026-10-20', answers: {} }).ok).toBe(
      false,
    );
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const res = recordResponse({ code: CODE_A, phase: 'pre', consentedOn: '2026-10-20', answers: {} });
    expect(res.ok).toBe(false);
    expect(res.data.participants).toHaveLength(1); // still shown in memory
  });

  it('deletes one participant (withdrawal) or everything', () => {
    const s = useStorage({ [PILOT_STORAGE_KEY]: JSON.stringify(sample()) });
    const res = deleteParticipant(CODE_A);
    expect(res.ok).toBe(true);
    expect(sanitizePilotData(stored(s)).participants.map((p) => p.code)).toEqual([CODE_B]);
    expect(clearPilotData()).toBe(true);
    expect(s.getItem(PILOT_STORAGE_KEY)).toBeNull();
    expect(loadPilotData()).toEqual(emptyPilotData());
  });

  it('summarises counts and pending part twos', () => {
    expect(summarize(sample())).toEqual({ participants: 2, pre: 2, post: 1, paired: 1 });
    expect(pendingPost(sample()).map((p) => p.code)).toEqual([CODE_B]);
  });
});

// -------------------------------------------------------------------------------------------------
// Export
// -------------------------------------------------------------------------------------------------

describe('CSV export', () => {
  it('has fixed columns, every item once, a _correct column per factual item, then the score', () => {
    const cols = csvColumns();
    expect(cols.slice(0, CSV_FIXED_COLUMNS.length)).toEqual([...CSV_FIXED_COLUMNS]);
    expect(new Set(cols).size).toBe(cols.length);
    for (const it of ITEMS) expect(cols).toContain(it.id);
    for (const it of FACTUAL_ITEMS) {
      expect(cols.indexOf(correctColumn(it.id))).toBe(cols.indexOf(it.id) + 1);
    }
    expect(cols.at(-1)).toBe(FACT_SCORE_COLUMN);
    expect(cols).toHaveLength(CSV_FIXED_COLUMNS.length + ITEMS.length + FACTUAL_ITEMS.length + 1);
  });

  it('writes one row per participant per completed phase, CRLF, aligned columns', () => {
    const data = sample();
    const csv = toCsv(data);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/\n/);
    const rows = parseCsv(csv);
    const [header, ...body] = rows;
    expect(header).toEqual(csvColumns());
    expect(body).toHaveLength(csvRowCount(data));
    expect(body).toHaveLength(3);
    for (const r of body) expect(r).toHaveLength(header.length);
    const col = (r: string[], name: string) => r[header.indexOf(name)];
    expect(body.map((r) => [col(r, 'participant_code'), col(r, 'phase')])).toEqual([
      [CODE_A, 'pre'],
      [CODE_A, 'post'],
      [CODE_B, 'pre'],
    ]);
    const [aPre, aPost, bPre] = body;
    // Pre rows leave post-only items blank; post rows fill them.
    expect(col(aPre, 'us1_play_again')).toBe('');
    expect(col(aPost, 'us1_play_again')).toBe('4');
    expect(col(aPost, 'open1_moment')).toBe('answer to open1_moment');
    expect(col(aPre, 'att1_affects_people')).toBe('4');
    // All factual answers right for A; B skipped everything (blank, score 0).
    for (const it of FACTUAL_ITEMS) {
      expect(col(aPre, correctColumn(it.id))).toBe('1');
      expect(col(bPre, it.id)).toBe('');
      expect(col(bPre, correctColumn(it.id))).toBe('');
    }
    expect(col(aPre, FACT_SCORE_COLUMN)).toBe(String(FACTUAL_ITEMS.length));
    expect(col(bPre, FACT_SCORE_COLUMN)).toBe('0');
    expect(col(aPre, 'consented_on')).toBe('2026-10-20');
    expect(col(aPost, 'completed_on')).toBe('2026-10-21');
    expect(col(aPre, 'instrument')).toBe(INSTRUMENT_VERSION);
  });

  it('scores "Not sure" and wrong answers as 0, skipped as blank', () => {
    const data = sample();
    const answers = { ...data.participants[1].pre!.answers };
    answers.fact1_co2_ppm = 'unsure';
    answers.fact2_warming = 'a'; // wrong
    answers.fact3_main_cause = 'd'; // right
    const p = { ...data.participants[1], pre: { ...data.participants[1].pre!, answers } };
    const [header, row] = parseCsv(toCsv({ version: 1, participants: [p] }));
    const col = (name: string) => row[header.indexOf(name)];
    expect(col(correctColumn('fact1_co2_ppm'))).toBe('0');
    expect(col(correctColumn('fact2_warming'))).toBe('0');
    expect(col(correctColumn('fact3_main_cause'))).toBe('1');
    expect(col(correctColumn('fact4_sea_level_committed'))).toBe('');
    expect(col(FACT_SCORE_COLUMN)).toBe('1');
  });

  it('quotes per RFC 4180 and defuses spreadsheet formulas in typed text', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(3)).toBe('3');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, "b"\nc')).toBe('"a, ""b""\nc"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const s of ['+1', '-1', '@SUM(A1)']) expect(csvCell(s)).toBe(`'${s}`);
    const data = sample();
    const post = data.participants[0].post!;
    const evil = '=cmd|"/c calc"!A1, then, a line\nbreak';
    const p = { ...data.participants[0], post: { ...post, answers: { ...post.answers, open2_change: evil } } };
    const [header, , row] = parseCsv(toCsv({ version: 1, participants: [p] }));
    expect(row[header.indexOf('open2_change')]).toBe(`'${evil}`);
  });

  it('is just the header for an empty store; the download adds a UTF-8 BOM', () => {
    expect(toCsv(emptyPilotData())).toBe(csvColumns().join(',') + '\r\n');
    expect(csvRowCount(emptyPilotData())).toBe(0);
    expect(CSV_BOM).toBe('﻿');
    expect(exportFilename('2026-10-21', 'csv')).toBe('iceberg-river-pilot-2026-10-21.csv');
    expect(exportFilename('2026-10-21', 'json')).toBe('iceberg-river-pilot-2026-10-21.json');
  });
});

describe('JSON export', () => {
  it('carries the data, the instrument version and a codebook with every answer source', () => {
    const data = sample();
    const parsed = JSON.parse(toJson(data, '2026-10-21'));
    expect(parsed.format).toBe(EXPORT_FORMAT);
    expect(parsed.version).toBe(1);
    expect(parsed.instrument).toBe(INSTRUMENT_VERSION);
    expect(parsed.exportedOn).toBe('2026-10-21');
    expect(parsed.participants).toEqual(data.participants);
    expect(parsed.codebook.likertScale).toEqual(LIKERT_LABELS.map((label, i) => ({ value: i + 1, label })));
    expect(parsed.codebook.items.map((it: { id: string }) => it.id)).toEqual(ITEMS.map((it) => it.id));
    const facts = parsed.codebook.items.filter((it: { type: string }) => it.type === 'factual');
    expect(facts).toHaveLength(FACTUAL_ITEMS.length);
    for (const f of facts) {
      expect(f.correct).toBeTruthy();
      expect(f.source.url).toMatch(/^https:\/\//);
    }
    expect(parsed.notes.join(' ')).toMatch(/no names, emails, IP addresses or times/);
    // Re-sanitising an export's participants changes nothing: exports hold only what the store may.
    expect(sanitizePilotData({ version: 1, participants: parsed.participants })).toEqual(data);
  });

  it('holds no times of day anywhere', () => {
    const text = toJson(sample(), dayStamp());
    expect(text).not.toMatch(/T\d{2}:\d{2}/);
    expect(text).not.toMatch(/\b\d{2}:\d{2}(:\d{2})?\b/);
  });

  it('builds the same object it serialises', () => {
    const data = sample();
    expect(JSON.parse(toJson(data, '2026-10-21'))).toEqual(
      JSON.parse(JSON.stringify(buildExport(data, '2026-10-21'))),
    );
  });
});
