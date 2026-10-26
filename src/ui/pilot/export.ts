/**
 * Pilot-study export: every stored response as JSON (data + codebook, for analysis scripts) or CSV
 * (one row per participant per phase, one column per item, for a spreadsheet). Both are built from
 * the sanitised store, so an export contains exactly what the store may contain: anonymous codes,
 * days, and the answers.
 */
import {
  FACTUAL_ITEMS,
  INSTRUMENT_VERSION,
  ITEMS,
  LIKERT_LABELS,
  type Phase,
  type PilotItem,
} from './instrument';
import type { AnswerValue, ParticipantRecord, PhaseRecord, PilotData } from './store';

export const EXPORT_FORMAT = 'iceberg-river.pilot';

/** Columns every row starts with, before the item columns. */
export const CSV_FIXED_COLUMNS = [
  'participant_code',
  'phase',
  'instrument',
  'consented_on',
  'completed_on',
] as const;

/** Derived per factual item: 1 correct, 0 answered otherwise (incl. "unsure"), blank if skipped. */
export const correctColumn = (itemId: string): string => `${itemId}_correct`;
export const FACT_SCORE_COLUMN = 'fact_score';

/**
 * Header row: fixed columns, then every item of either phase in instrument order (each factual item
 * followed by its _correct column), then fact_score. Pre rows leave the post-only columns blank, so
 * pre and post rows of one participant line up column for column.
 */
export function csvColumns(): string[] {
  const cols: string[] = [...CSV_FIXED_COLUMNS];
  for (const item of ITEMS) {
    cols.push(item.id);
    if (item.type === 'factual') cols.push(correctColumn(item.id));
  }
  cols.push(FACT_SCORE_COLUMN);
  return cols;
}

/** A spreadsheet would run a cell starting with one of these as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One RFC 4180 field. Text that could be read as a formula gets a leading apostrophe (the OWASP
 * advice for CSV injection), since open answers are typed by participants; numbers are left alone.
 */
export function csvCell(v: AnswerValue): string {
  if (v === null) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function factCells(rec: PhaseRecord): { perItem: Map<string, AnswerValue>; score: number } {
  const perItem = new Map<string, AnswerValue>();
  let score = 0;
  for (const item of FACTUAL_ITEMS) {
    const a = rec.answers[item.id] ?? null;
    const right = a === item.correct;
    if (right) score++;
    perItem.set(item.id, a === null ? null : right ? 1 : 0);
  }
  return { perItem, score };
}

function csvRow(p: ParticipantRecord, phase: Phase, rec: PhaseRecord): string {
  const { perItem, score } = factCells(rec);
  const cells: AnswerValue[] = [p.code, phase, rec.instrument, p.consentedOn, rec.completedOn];
  const answerOf = (item: PilotItem): AnswerValue =>
    item.phases.includes(phase) ? (rec.answers[item.id] ?? null) : null;
  for (const item of ITEMS) {
    cells.push(answerOf(item));
    if (item.type === 'factual') cells.push(perItem.get(item.id) ?? null);
  }
  cells.push(score);
  return cells.map(csvCell).join(',');
}

/** Rows a CSV export of `data` will have (excluding the header): one per completed phase. */
export const csvRowCount = (data: PilotData): number =>
  data.participants.reduce((n, p) => n + (p.pre ? 1 : 0) + (p.post ? 1 : 0), 0);

/** CSV text with CRLF line ends (RFC 4180). Participants in stored order, pre before post. */
export function toCsv(data: PilotData): string {
  const lines = [csvColumns().join(',')];
  for (const p of data.participants) {
    if (p.pre) lines.push(csvRow(p, 'pre', p.pre));
    if (p.post) lines.push(csvRow(p, 'post', p.post));
  }
  return lines.join('\r\n') + '\r\n';
}

export interface PilotExport {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: 1;
  readonly instrument: string;
  /** Day of export (YYYY-MM-DD). */
  readonly exportedOn: string;
  readonly notes: readonly string[];
  readonly codebook: {
    readonly likertScale: readonly { readonly value: number; readonly label: string }[];
    readonly items: readonly PilotItem[];
  };
  readonly participants: PilotData['participants'];
}

const NOTES: readonly string[] = [
  'Participants are random codes; no names, emails, IP addresses or times are collected.',
  'Likert answers are raw values 1-5 (see likertScale); items with reverse: true are NOT flipped.',
  'Usability items adapt five of the ten System Usability Scale items (susItem = SUS item number); ' +
    'they are not a full SUS, so no 0-100 SUS score applies.',
  'null = skipped. Factual "unsure" is a deliberate answer and is never correct.',
  'Open answers had email addresses and long digit runs replaced before storage.',
];

export function buildExport(data: PilotData, exportedOn: string): PilotExport {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    instrument: INSTRUMENT_VERSION,
    exportedOn,
    notes: NOTES,
    codebook: {
      likertScale: LIKERT_LABELS.map((label, i) => ({ value: i + 1, label })),
      items: ITEMS,
    },
    participants: data.participants,
  };
}

export const toJson = (data: PilotData, exportedOn: string): string =>
  JSON.stringify(buildExport(data, exportedOn), null, 2) + '\n';

export const exportFilename = (day: string, ext: 'json' | 'csv'): string =>
  `iceberg-river-pilot-${day}.${ext}`;

/**
 * Saves `text` as a file through a temporary link (no server: the game runs offline). A Blob URL
 * where available, else a data: URL.
 */
export function downloadText(filename: string, mime: string, text: string): void {
  const doc = globalThis.document;
  if (!doc) return;
  const canBlob = typeof URL.createObjectURL === 'function';
  const href = canBlob
    ? URL.createObjectURL(new Blob([text], { type: mime }))
    : `data:${mime},${encodeURIComponent(text)}`;
  const a = doc.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.hidden = true;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  if (canBlob) setTimeout(() => URL.revokeObjectURL(href), 0);
}

/**
 * CSV download with a UTF-8 byte-order mark: Excel only reads a CSV as UTF-8 when it has one, and
 * open answers may contain any character. (pandas: read_csv(..., encoding='utf-8-sig').)
 */
export const CSV_BOM = String.fromCharCode(0xfeff);

export function downloadCsv(data: PilotData, day: string): void {
  downloadText(exportFilename(day, 'csv'), 'text/csv;charset=utf-8', CSV_BOM + toCsv(data));
}

export function downloadJson(data: PilotData, day: string): void {
  downloadText(exportFilename(day, 'json'), 'application/json', toJson(data, day));
}
