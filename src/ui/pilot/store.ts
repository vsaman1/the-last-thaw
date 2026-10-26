/**
 * Pilot-study responses in the browser: the record shape, anonymous participant codes, day stamps,
 * the sanitiser every load and save goes through, and the few operations the UI needs.
 *
 * Privacy rules this module enforces rather than trusts the UI with:
 * - A participant is a random code (P-XXXX-XXXX). There is no field for a name, email, IP, user
 *   agent or anything else; the sanitiser copies whitelisted fields only, so even a hand-edited store
 *   loses anything extra on the next load.
 * - Dates are calendar days (YYYY-MM-DD), never times; a timestamp that sneaks in is cut to its day.
 * - Free text exists only for the instrument's two open questions, and email addresses and long
 *   phone-like digit runs are replaced before the text is stored.
 * - Nothing is stored until a survey is submitted: consenting and then leaving saves nothing.
 *
 * Everything stays in localStorage under PILOT_STORAGE_KEY until the researcher exports it.
 */
import { loadJson } from '../../state/storage';
import {
  INSTRUMENT_VERSION,
  LIKERT_POINTS,
  OPEN_MAX_LENGTH,
  itemsFor,
  type Phase,
  type PilotItem,
} from './instrument';

export const PILOT_STORAGE_KEY = 'iceberg-river.pilot.v1';

export type AnswerValue = number | string | null;
export type Answers = Readonly<Record<string, AnswerValue>>;

export interface PhaseRecord {
  /** INSTRUMENT_VERSION the answers were given under. */
  readonly instrument: string;
  /** Local calendar day the survey was submitted (YYYY-MM-DD). Never a time. */
  readonly completedOn: string;
  /** Every item of the phase, in instrument order; null = skipped. */
  readonly answers: Answers;
}

export interface ParticipantRecord {
  readonly code: string;
  /** Day consent was given (YYYY-MM-DD). */
  readonly consentedOn: string;
  readonly pre: PhaseRecord | null;
  readonly post: PhaseRecord | null;
}

export interface PilotData {
  readonly version: 1;
  /** In the order they first submitted. */
  readonly participants: readonly ParticipantRecord[];
}

export const emptyPilotData = (): PilotData => ({ version: 1, participants: [] });

// -------------------------------------------------------------------------------------------------
// Participant codes and days
// -------------------------------------------------------------------------------------------------

/** 31 symbols with no 0/O and no 1/I/L, so a code copied by hand or read aloud survives. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_PATTERN = /^P-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/;
const CODE_SYMBOLS = 8;
/** Bytes at or above this are re-drawn, so every symbol is equally likely (256 % 31 = 8). */
const BYTE_LIMIT = 256 - (256 % CODE_ALPHABET.length);
const MAX_DRAWS = 64;

export type RandomBytes = (n: number) => Uint8Array;

/** Uses the platform CSPRNG; Math.random only where no Web Crypto exists (very old browsers). */
const platformBytes: RandomBytes = (n) => {
  const out = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
};

/**
 * A fresh anonymous code like "P-7KQ3-M9XD" (31^8 ≈ 8.5e11 possibilities). Deliberately NOT seeded,
 * unlike the game's simulations: a reproducible sequence would let anyone regenerate who got which
 * code in which order. Tests inject `bytes` instead. `taken` avoids reusing a code on this device.
 */
export function newParticipantCode(
  bytes: RandomBytes = platformBytes,
  taken: ReadonlySet<string> = new Set(),
): string {
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    let s = '';
    for (const b of bytes(CODE_SYMBOLS * 2)) {
      if (b < BYTE_LIMIT && s.length < CODE_SYMBOLS) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
    if (s.length < CODE_SYMBOLS) continue;
    const code = `P-${s.slice(0, 4)}-${s.slice(4)}`;
    if (!taken.has(code)) return code;
  }
  throw new Error('Could not draw a participant code: the random source is not random.');
}

/** Local calendar day, YYYY-MM-DD. The only kind of date the study keeps. */
export function dayStamp(d: Date = new Date()): string {
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** A plausible YYYY-MM-DD, or null. A full timestamp is cut to its day (the time is dropped). */
export function sanitizeDay(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = DAY_PREFIX.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// -------------------------------------------------------------------------------------------------
// Free text
// -------------------------------------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/**
 * Nine or more digits with at most two separators between neighbours: phone numbers, student or ID
 * numbers. Years, chapter numbers and short ranges ("2031-2040") stay intact.
 */
const LONG_NUMBER = /\+?\d(?:[ .()/-]{0,2}\d){8,}/g;
/** C0 controls and DEL, except tab and newline (a pasted answer keeps its paragraphs). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const EMAIL_PLACEHOLDER = '[email removed]';
export const NUMBER_PLACEHOLDER = '[number removed]';

/** Normalises an open answer: no control characters, no emails or long numbers, trimmed, capped. */
export function scrubText(raw: string, max: number = OPEN_MAX_LENGTH): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(EMAIL, EMAIL_PLACEHOLDER)
    .replace(LONG_NUMBER, NUMBER_PLACEHOLDER)
    .trim()
    .slice(0, max);
}

// -------------------------------------------------------------------------------------------------
// Sanitising
// -------------------------------------------------------------------------------------------------

/** More than any pilot will need; bounds the work a corrupted or hostile store can cause. */
export const MAX_PARTICIPANTS = 5000;
const INSTRUMENT_ID = /^[\w.-]{1,64}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An in-range answer for `item`, or null (skipped, wrong type, out of range, unknown option). */
export function sanitizeAnswer(item: PilotItem, v: unknown): AnswerValue {
  switch (item.type) {
    case 'likert':
      return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LIKERT_POINTS ? v : null;
    case 'choice':
    case 'factual':
      return typeof v === 'string' && item.options.some((o) => o.id === v) ? v : null;
    case 'open': {
      if (typeof v !== 'string') return null;
      const s = scrubText(v, item.maxLength);
      return s === '' ? null : s;
    }
  }
}

/**
 * Exactly the phase's items, in instrument order, each sanitised; unknown keys (including
 * "__proto__") are never copied because the loop walks the instrument, not the input.
 */
export function sanitizeAnswers(phase: Phase, raw: unknown): Record<string, AnswerValue> {
  const src: Obj = isObj(raw) ? raw : {};
  const out: Record<string, AnswerValue> = {};
  for (const item of itemsFor(phase)) {
    out[item.id] = Object.hasOwn(src, item.id) ? sanitizeAnswer(item, src[item.id]) : null;
  }
  return out;
}

function sanitizePhase(phase: Phase, raw: unknown): PhaseRecord | null {
  if (!isObj(raw)) return null;
  const completedOn = sanitizeDay(raw.completedOn);
  const instrument =
    typeof raw.instrument === 'string' && INSTRUMENT_ID.test(raw.instrument) ? raw.instrument : null;
  if (!completedOn || !instrument) return null;
  return { instrument, completedOn, answers: sanitizeAnswers(phase, raw.answers) };
}

function sanitizeParticipant(raw: unknown): ParticipantRecord | null {
  if (!isObj(raw) || typeof raw.code !== 'string' || !CODE_PATTERN.test(raw.code)) return null;
  const pre = sanitizePhase('pre', raw.pre);
  const post = sanitizePhase('post', raw.post);
  const firstDay = pre?.completedOn ?? post?.completedOn;
  if (!firstDay) return null; // neither phase survived: nothing worth keeping
  return { code: raw.code, consentedOn: sanitizeDay(raw.consentedOn) ?? firstDay, pre, post };
}

/**
 * Whatever was stored → a well-formed PilotData. Malformed participants are dropped, not repaired
 * into something they never said; a duplicated code keeps its first record.
 */
export function sanitizePilotData(raw: unknown): PilotData {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.participants)) return emptyPilotData();
  const seen = new Set<string>();
  const participants: ParticipantRecord[] = [];
  for (const p of raw.participants) {
    if (participants.length >= MAX_PARTICIPANTS) break;
    const clean = sanitizeParticipant(p);
    if (!clean || seen.has(clean.code)) continue;
    seen.add(clean.code);
    participants.push(clean);
  }
  return { version: 1, participants };
}

// -------------------------------------------------------------------------------------------------
// Storage and operations
// -------------------------------------------------------------------------------------------------

const anyJson = (_v: unknown): _v is unknown => true;

export function loadPilotData(): PilotData {
  return sanitizePilotData(loadJson<unknown>(PILOT_STORAGE_KEY, null, anyJson));
}

/**
 * Writes `data`; false when the browser refuses (private mode, quota). Unlike the game's progress
 * save this failure is reported: a participant must not believe answers were kept when they were not.
 */
export function savePilotData(data: PilotData): boolean {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    ls.setItem(PILOT_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearPilotData(): boolean {
  try {
    globalThis.localStorage?.removeItem(PILOT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export interface SaveResult {
  readonly ok: boolean;
  /** The data as it now stands (in memory, even when the write failed). */
  readonly data: PilotData;
}

export interface ResponseInput {
  readonly code: string;
  readonly phase: Phase;
  /** Day consent was given; only used when this is the participant's first record. */
  readonly consentedOn: string;
  readonly answers: Readonly<Record<string, unknown>>;
  /** Submission day; defaults to today. */
  readonly today?: string;
}

/**
 * Stores one completed survey. Re-reads storage first so a response saved meanwhile in another tab
 * is kept, then sanitises the whole store again before writing.
 */
export function recordResponse(input: ResponseInput): SaveResult {
  const current = loadPilotData();
  if (!CODE_PATTERN.test(input.code)) return { ok: false, data: current };
  const record: PhaseRecord = {
    instrument: INSTRUMENT_VERSION,
    completedOn: sanitizeDay(input.today) ?? dayStamp(),
    answers: sanitizeAnswers(input.phase, input.answers),
  };
  const i = current.participants.findIndex((p) => p.code === input.code);
  const prev: ParticipantRecord =
    i >= 0
      ? current.participants[i]
      : {
          code: input.code,
          consentedOn: sanitizeDay(input.consentedOn) ?? record.completedOn,
          pre: null,
          post: null,
        };
  const next: ParticipantRecord = { ...prev, [input.phase]: record };
  const participants =
    i >= 0
      ? current.participants.map((p, j) => (j === i ? next : p))
      : [...current.participants, next];
  const data = sanitizePilotData({ version: 1, participants });
  return { ok: savePilotData(data), data };
}

/** Removes one participant (a withdrawal). */
export function deleteParticipant(code: string): SaveResult {
  const current = loadPilotData();
  const data: PilotData = {
    version: 1,
    participants: current.participants.filter((p) => p.code !== code),
  };
  return { ok: savePilotData(data), data };
}

/** Participants who finished the before-play survey but not the after-play one, oldest first. */
export const pendingPost = (data: PilotData): readonly ParticipantRecord[] =>
  data.participants.filter((p) => p.pre !== null && p.post === null);

export interface PilotSummary {
  readonly participants: number;
  readonly pre: number;
  readonly post: number;
  /** Both phases: the pairs a pre/post comparison can use. */
  readonly paired: number;
}

export function summarize(data: PilotData): PilotSummary {
  const ps = data.participants;
  return {
    participants: ps.length,
    pre: ps.filter((p) => p.pre).length,
    post: ps.filter((p) => p.post).length,
    paired: ps.filter((p) => p.pre && p.post).length,
  };
}
