import path from 'node:path';
import type { ModelProvider } from '../story/types';
import { loadEnv } from './env';

/**
 * Agent-service configuration: the two providers and the model allowlist, the budgets that bound every
 * run, and the secrets the output scanner must never let through. Built once per process from the
 * merged `.env` view; nothing here is ever sent to the browser except the model ids, whether each can
 * run, and why not.
 *
 * The course rules (project requirements page): "use your PORTKEY_API_KEY with gpt-6-luna only. No other
 * models on the course key." "if you want a different model, use your own personal API key and pay for
 * it yourself." "For an OpenAI key, name it OPENAI_API_KEY." So there are two providers, chosen by the
 * MODEL, never by which key happens to be present:
 *
 *   gpt-6-luna ── 'course'  ── Portkey, PORTKEY_API_KEY ── the default
 *   gpt-6-sol  ── 'own-key' ── OpenAI directly, OPENAI_API_KEY (the player's own, billed to them),
 *                              under a daily USD limit (OPENAI_DAILY_USD_LIMIT)
 */

/** Course protocol: Portkey in front of OpenAI, Responses API (chat/completions rejects function tools). */
export const DEFAULT_BASE_URL = 'https://api.portkey.ai/v1';
/** The own-key provider: the OpenAI API itself, the same Responses API. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
/** The one model the course key may serve. */
export const COURSE_MODEL = 'gpt-6-luna';
export const OWN_KEY_MODEL = 'gpt-6-sol';
export const DEFAULT_MODEL = COURSE_MODEL;
export const PORTKEY_PROVIDER = 'openai';

export type ProviderId = ModelProvider;

/**
 * The model allowlist: each model runs on exactly one provider. A null-prototype map read only through
 * providerOf (an own-property check), so 'constructor', '__proto__' or 'toString' is no model.
 */
export const MODEL_PROVIDERS: Readonly<Record<string, ProviderId>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ProviderId>, {
    [COURSE_MODEL]: 'course',
    [OWN_KEY_MODEL]: 'own-key',
  }),
);

/** The models the server offers, in display order (the default first). */
export const OFFERED_MODELS: readonly string[] = Object.freeze(Object.keys(MODEL_PROVIDERS));

/** The provider of an allowlisted model, or undefined for anything else. */
export const providerOf = (model: unknown): ProviderId | undefined =>
  typeof model === 'string' && Object.hasOwn(MODEL_PROVIDERS, model) ? MODEL_PROVIDERS[model] : undefined;

/** OPENAI_DAILY_USD_LIMIT when unset: what the own-key provider may spend per UTC day. */
export const DEFAULT_OWN_KEY_DAILY_USD = 2;
/** Larger values are capped here (a typo like 2000 should not become a $2,000 day). */
export const MAX_OWN_KEY_DAILY_USD = 20;

/**
 * A fake secret planted in the server config for the prompt-injection tests. It is never placed in any
 * prompt; if it ever shows up in a model's output, the only way it got there is a leak, and the output
 * scanner rejects it like the real key. Not a credential: it opens nothing.
 */
export const SECRET_CANARY = 'SECRET-CANARY-LT-7f3a9c2e41d8';

export interface AgentBudgets {
  /** Model requests per agent invocation (a request that only calls tools counts too). */
  readonly maxRounds: number;
  /** Tool calls per agent invocation; past this every call gets a "budget exhausted" result. */
  readonly maxToolCalls: number;
  /** Historian reviews per narrative (so at most this many minus one Archivist rewrites). */
  readonly maxHistorianRounds: number;
  /** max_output_tokens per request, per agent (reasoning tokens count against it). */
  readonly maxOutputTokens: { readonly archivist: number; readonly historian: number };
  /** Per-request timeout. */
  readonly requestTimeoutMs: number;
  /**
   * Whole-narrative deadline (every agent, round and retry together), just under the browser's wait
   * (REFLECT_TIMEOUT_MS / EPILOGUE_TIMEOUT_MS in src/story/client.ts): past it the run stops and the
   * authored text stands, instead of the server billing an answer nobody will read.
   */
  readonly narrativeDeadlineMs: { readonly reflection: number; readonly epilogue: number };
  /** Model requests this process may make before every further narrative fails with 'budget'. */
  readonly maxRequestsPerProcess: number;
  /** Input + output tokens per UTC day (seeded from logs/agent-usage.jsonl at start-up). */
  readonly dailyTokenBudget: number;
  /** POSTs to /api/story/* per minute (all clients together: this is a local dev server). */
  readonly postsPerMinute: number;
  /** Largest JSON body accepted. */
  readonly maxBodyBytes: number;
}

export const DEFAULT_BUDGETS: AgentBudgets = {
  maxRounds: 6,
  maxToolCalls: 12,
  // Three, not two: in the first live runs (2026-10-21) the Historian's second review still raised
  // fair points of wording, and two rounds would have discarded drafts that a third pass fixes.
  maxHistorianRounds: 3,
  // Reasoning tokens count against the limit. At 1600 / 900 the first live epilogue on real gameplay
  // (2026-10-21, lt-20261021-092254-6b7e8e) was cut off three times mid-answer, each cut-off billed and
  // thrown away, and the run fell back. A limit only caps a reply; it costs nothing unused.
  maxOutputTokens: { archivist: 3200, historian: 1800 },
  requestTimeoutMs: 45_000,
  // The client waits 180 s / 300 s; the slowest saved runs took 146 s (a reflection) and 268 s (an epilogue).
  narrativeDeadlineMs: { reflection: 170_000, epilogue: 290_000 },
  maxRequestsPerProcess: 300,
  dailyTokenBudget: 1_500_000,
  postsPerMinute: 12,
  maxBodyBytes: 64 * 1024,
};

export interface ProviderConfig {
  readonly id: ProviderId;
  /** The variable the key is read from, spelled exactly as the course requires. */
  readonly keyName: 'PORTKEY_API_KEY' | 'OPENAI_API_KEY';
  /** Undefined when the key is not set (or STORY_AI=off): this provider's model is then unavailable. */
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  /** Why this provider cannot run (for GET /api/story/status), or undefined when it can. Never a value. */
  readonly unavailableReason: string | undefined;
}

export interface ServerConfig {
  /** The server's default model: MODEL_NAME when it is on the allowlist, else gpt-6-luna. */
  readonly model: string;
  /** One entry per provider; a key is only ever handed to its own provider's transport. */
  readonly providers: Readonly<Record<ProviderId, ProviderConfig>>;
  /** What the own-key provider may spend per UTC day, in USD (OPENAI_DAILY_USD_LIMIT; 0, or unreadable = gpt-6-sol off). */
  readonly ownKeyDailyUsdLimit: number;
  readonly budgets: AgentBudgets;
  /** Where logs/agent-usage.jsonl and logs/traces/ go. */
  readonly logsDir: string;
  /** Exact strings the output scanner rejects (both keys and the canary). Never sent to a model. */
  readonly secrets: readonly string[];
  /** .env files that were read (paths only), for start-up diagnostics. */
  readonly envFiles: readonly string[];
  /** Bypass the Portkey response cache so logged usage is always a real model call (PORTKEY_CACHE=allow to keep it). */
  readonly forceRefresh: boolean;
  /** Settings that were ignored or corrected, with the reason (logged at start-up; never a value). */
  readonly notes: readonly string[];
}

/** A clean, bounded override: a base URL must be https (or http on localhost for a local proxy). */
function safeBaseUrl(raw: string | undefined, fallback: string, name: string, notes: string[]): string {
  if (!raw?.trim()) return fallback;
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.toString().replace(/\/+$/, '');
  } catch {
    // fall through
  }
  notes.push(`${name} is not an https URL (or http on localhost); using ${fallback}`);
  return fallback;
}

/** Not a hostname a URL can have ('[' only opens an IPv6 address): the one name of every loopback host. */
const LOOPBACK = '[loopback]';

/**
 * The host a base URL actually reaches, for the key-isolation rules below. Compared as written, two
 * spellings of one host get past them: the trailing dot of a fully qualified name ('api.openai.com.',
 * also written 'api.openai.com%2E', is api.openai.com to DNS and to the TLS name check) and the loopback
 * aliases ('localhost', 127.0.0.0/8, [::1] are all this machine, so one local proxy). So: lower case,
 * trailing dots dropped, and every loopback address one host.
 */
export function canonicalHost(url: string): string {
  const h = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
  const loopback =
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h === '[::]' ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(h); // ::ffff:127.x.y.z, as the URL parser writes it
  return loopback ? LOOPBACK : h;
}
const onDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

/** Why gpt-6-sol is off when OPENAI_DAILY_USD_LIMIT cannot be read (shown in /status and Settings). */
export const UNREADABLE_LIMIT_REASON = `OPENAI_DAILY_USD_LIMIT is not a plain number of dollars (like 2.00), so ${OWN_KEY_MODEL} is off until it is fixed`;

/**
 * OPENAI_DAILY_USD_LIMIT: plain dollars ("2", "2.00", "0.5", ".5", "$0.50", "0"); unset is the default.
 * Anything else fails closed: a limit on the player's own money that cannot be read is 0 (gpt-6-sol
 * off, with the reason), never the default, which may be more than they meant ("0,50", "0.5 USD").
 */
function dailyUsdLimit(raw: string | undefined, notes: string[]): { readonly usd: number; readonly unreadable: boolean } {
  const t = raw?.trim() ?? '';
  if (t === '') return { usd: DEFAULT_OWN_KEY_DAILY_USD, unreadable: false };
  const m = /^\$?\s*(\d{0,6}(?:\.\d{0,8})?)$/.exec(t);
  const n = m && /\d/.test(m[1]) ? Number(m[1]) : Number.NaN;
  if (!Number.isFinite(n)) {
    notes.push(UNREADABLE_LIMIT_REASON);
    return { usd: 0, unreadable: true };
  }
  if (n > MAX_OWN_KEY_DAILY_USD) {
    notes.push(`OPENAI_DAILY_USD_LIMIT is above ${MAX_OWN_KEY_DAILY_USD.toFixed(2)}; capped at ${MAX_OWN_KEY_DAILY_USD.toFixed(2)}`);
    return { usd: MAX_OWN_KEY_DAILY_USD, unreadable: false };
  }
  return { usd: n, unreadable: false };
}

/**
 * Builds the config for a project folder. `vars` defaults to the real environment over the `.env`
 * files of `projectRoot` and its parents (nearest wins). STORY_AI=off disables the agents entirely.
 */
export function loadConfig(
  projectRoot: string,
  vars?: Readonly<Record<string, string | undefined>>,
  overrides: Partial<AgentBudgets> = {},
): ServerConfig {
  const loaded = vars ? { vars, files: [] as string[] } : loadEnv(projectRoot);
  const v = loaded.vars;
  const notes: string[] = [];
  const courseKey = v.PORTKEY_API_KEY?.trim() || undefined;
  const ownKey = v.OPENAI_API_KEY?.trim() || undefined;
  const disabled = (v.STORY_AI ?? '').trim().toLowerCase() === 'off';

  // The default model: only an allowlisted one. The value itself is never repeated in a note (a key
  // pasted into the wrong variable would otherwise be printed).
  const rawModel = v.MODEL_NAME?.trim() ?? '';
  let model = DEFAULT_MODEL;
  if (rawModel !== '') {
    if (MODEL_NAME.test(rawModel) && providerOf(rawModel)) model = rawModel;
    else notes.push(`MODEL_NAME is not an offered model (${OFFERED_MODELS.join(', ')}); using ${DEFAULT_MODEL}`);
  }

  // Each key goes only to its own host: an override that points one provider at the other's host (in
  // any spelling of it, see canonicalHost) is refused, so the OpenAI key never reaches Portkey and the
  // course key never reaches OpenAI.
  let courseBase = safeBaseUrl(v.PORTKEY_BASE_URL, DEFAULT_BASE_URL, 'PORTKEY_BASE_URL', notes);
  if (onDomain(canonicalHost(courseBase), 'openai.com')) {
    notes.push('PORTKEY_BASE_URL points at OpenAI; the course key goes only to Portkey, so using the default');
    courseBase = DEFAULT_BASE_URL;
  }
  let ownBase = safeBaseUrl(v.OPENAI_BASE_URL, OPENAI_BASE_URL, 'OPENAI_BASE_URL', notes);
  const ownHost = canonicalHost(ownBase);
  if (onDomain(ownHost, 'portkey.ai') || ownHost === canonicalHost(courseBase)) {
    notes.push('OPENAI_BASE_URL points at the course gateway; your OpenAI key goes only to OpenAI, so using the default');
    ownBase = OPENAI_BASE_URL;
  }

  const { usd: limit, unreadable } = dailyUsdLimit(v.OPENAI_DAILY_USD_LIMIT, notes);
  const where = 'add it to a .env file in the project folder or a parent folder';
  const course: ProviderConfig = {
    id: 'course',
    keyName: 'PORTKEY_API_KEY',
    apiKey: disabled ? undefined : courseKey,
    baseUrl: courseBase,
    unavailableReason: disabled ? 'disabled by STORY_AI=off' : courseKey ? undefined : `PORTKEY_API_KEY not set (${where})`,
  };
  const own: ProviderConfig = {
    id: 'own-key',
    keyName: 'OPENAI_API_KEY',
    apiKey: disabled || limit === 0 ? undefined : ownKey,
    baseUrl: ownBase,
    unavailableReason: disabled
      ? 'disabled by STORY_AI=off'
      : !ownKey
        ? `OPENAI_API_KEY not set (${OWN_KEY_MODEL} runs only on your own OpenAI key, billed to you; ${where})`
        : unreadable
          ? UNREADABLE_LIMIT_REASON
          : limit === 0
            ? 'disabled by OPENAI_DAILY_USD_LIMIT=0'
            : undefined,
  };
  return {
    model,
    providers: { course, 'own-key': own },
    ownKeyDailyUsdLimit: limit,
    budgets: { ...DEFAULT_BUDGETS, ...overrides },
    logsDir: path.join(projectRoot, 'logs'),
    // Both keys whenever they are set (STORY_AI=off included): neither may ever appear in any output.
    secrets: [SECRET_CANARY, ...(courseKey ? [courseKey] : []), ...(ownKey ? [ownKey] : [])],
    envFiles: loaded.files,
    forceRefresh: (v.PORTKEY_CACHE ?? '').trim().toLowerCase() !== 'allow',
    notes,
  };
}
