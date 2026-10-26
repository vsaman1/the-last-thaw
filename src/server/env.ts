import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * `.env` loading as the course requires: the project folder first, then each parent folder; the
 * NEAREST file wins for a key, and a variable already set in the real environment always wins over
 * every file. No dotenv dependency: the format we accept is small and the parser below is the whole of
 * it.
 *
 * Nothing here mutates process.env. The merged view is handed to loadConfig, the API key goes from
 * there straight into the transport's closure, and so it never reaches child processes, Vite's
 * client env (which only exposes VITE_* variables anyway), traces or logs.
 */

/** Stop walking up after this many folders (a project nested deeper than this is not our case). */
const MAX_PARENT_DEPTH = 8;
/** A .env bigger than this is not a config file; skip it rather than parse megabytes. */
const MAX_ENV_BYTES = 64 * 1024;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parses `KEY=value` lines: optional `export `, `#` comments (whole-line, or after an unquoted value
 * when preceded by whitespace), single-quoted values literal, double-quoted values with \n \t \" \\
 * escapes. Lines that do not parse are ignored.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!KEY.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (value.startsWith('"')) {
      const closing = findClosingQuote(value);
      value = closing > 0 ? unescapeDouble(value.slice(1, closing)) : value.slice(1);
    } else if (value.startsWith("'")) {
      const closing = value.indexOf("'", 1);
      value = closing > 0 ? value.slice(1, closing) : value.slice(1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    out[key] = value;
  }
  return out;
}

function findClosingQuote(v: string): number {
  for (let i = 1; i < v.length; i++) {
    if (v[i] === '\\') i++;
    else if (v[i] === '"') return i;
  }
  return -1;
}

const unescapeDouble = (s: string): string =>
  s.replace(/\\([nrt"\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c] ?? c);

export interface EnvLoadResult {
  /** Real environment over files, nearest file over farther ones. */
  readonly vars: Readonly<Record<string, string | undefined>>;
  /** .env files read, nearest first (paths only; values are never reported). */
  readonly files: readonly string[];
}

/** Loads `.env` from `startDir` and its parents (nearest wins), under the real environment. */
export function loadEnv(
  startDir: string,
  real: Readonly<Record<string, string | undefined>> = process.env,
): EnvLoadResult {
  const fromFiles: Record<string, string> = {};
  const files: string[] = [];
  let dir = path.resolve(startDir);
  for (let depth = 0; depth <= MAX_PARENT_DEPTH; depth++) {
    const file = path.join(dir, '.env');
    try {
      if (existsSync(file) && statSync(file).isFile() && statSync(file).size <= MAX_ENV_BYTES) {
        const parsed = parseEnv(readFileSync(file, 'utf8'));
        for (const [k, v] of Object.entries(parsed)) if (!Object.hasOwn(fromFiles, k)) fromFiles[k] = v;
        files.push(file);
      }
    } catch {
      // An unreadable .env (permissions, a folder named .env) is skipped, never fatal.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const vars: Record<string, string | undefined> = { ...fromFiles };
  for (const [k, v] of Object.entries(real)) if (v !== undefined) vars[k] = v;
  return { vars, files };
}
