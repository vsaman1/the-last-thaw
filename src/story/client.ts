/**
 * Browser client for the agent service (src/server, mounted under /api/story on the Vite dev/preview
 * server). Every call is bounded by a timeout and an optional caller AbortSignal, and every failure —
 * no server (a static build), a network error, a timeout, a non-2xx answer, a malformed body — comes
 * back as a NarrativeFailure, so the UI always has authored material to fall back on and never throws.
 *
 * Privacy and size: a request carries exactly RunEvidence plus the compact HistoryItem[] (rebuilt
 * field by field here, so nothing else a caller's objects happen to hold can leak into a request) and
 * the player's chosen model (always sent, gpt-6-luna unless they chose otherwise: the server's own
 * default never decides whose key pays for a player's request).
 */
import { fallbackReflection } from './select';
import {
  DEFAULT_STORY_MODEL,
  isStoryModel,
  type AiPreference,
  type ChapterDef,
  type EpilogueRequest,
  type HistoryItem,
  type ModelStatus,
  type NarrativeFailure,
  type NarrativeResponse,
  type NarrativeResult,
  type ReflectRequest,
  type RunEvidence,
  type StatusResponse,
  type StoredReflection,
  type StoryModelId,
} from './types';

export const API_BASE = '/api/story';
/**
 * The agents take a while: two models, several tool rounds, up to three reviews. On real runs
 * (docs/evidence/AGENT_RUNS.md) an approved text took 26–131 s, median about 68 s, so the client waits
 * up to three minutes. The player never waits for it: the authored text is on screen from the start,
 * Continue is always available, and a late answer only replaces the text while it still belongs to
 * that completion (src/ui/story/storyRun.ts). Past this the authored text stands.
 */
export const REFLECT_TIMEOUT_MS = 180_000;
/** The epilogue is the longest text and gets one more review round (measured: up to ~4 minutes). */
export const EPILOGUE_TIMEOUT_MS = 300_000;
/** Status is a cheap local check. */
export const STATUS_TIMEOUT_MS = 5_000;

export interface ClientOptions {
  /** Injected in tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Cancels the request (the player left the panel). */
  signal?: AbortSignal;
  timeoutMs?: number;
}

const failure = (reason: NarrativeFailure['reason'], message: string): NarrativeFailure => ({
  ok: false,
  runId: '',
  reason,
  message,
  fallback: true,
  usage: [],
});

/** fetch + JSON with a timeout chained to the caller's signal. Throws on any failure. */
async function getJson(path: string, init: RequestInit, opts: ClientOptions, timeoutMs: number): Promise<unknown> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('fetch is not available');
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort();
  if (opts.signal?.aborted) ctl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? timeoutMs);
  try {
    const res = await doFetch(`${API_BASE}${path}`, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

const errorText = (err: unknown): string =>
  err instanceof DOMException && err.name === 'AbortError' ? 'timed out or cancelled' : err instanceof Error ? err.message : String(err);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const MAX_MODELS = 8;
const MAX_REASON_CHARS = 300;

/** The server's per-model list, entry by entry: anything malformed is dropped, reasons are capped. */
function parseModels(v: unknown): ModelStatus[] {
  if (!Array.isArray(v)) return [];
  const out: ModelStatus[] = [];
  for (const m of v.slice(0, MAX_MODELS)) {
    if (!isObj(m) || typeof m.id !== 'string' || m.id.length > 64 || typeof m.available !== 'boolean') continue;
    if (m.provider !== 'course' && m.provider !== 'own-key') continue;
    out.push({
      id: m.id,
      provider: m.provider,
      available: m.available,
      ...(typeof m.reason === 'string' ? { reason: m.reason.slice(0, MAX_REASON_CHARS) } : {}),
    });
  }
  return out;
}

/** Server status; a missing service reads as "AI unavailable" with the reason. */
export async function fetchStatus(opts: ClientOptions = {}): Promise<StatusResponse> {
  try {
    const body = await getJson('/status', { method: 'GET' }, opts, STATUS_TIMEOUT_MS);
    if (!isObj(body) || typeof body.aiAvailable !== 'boolean') throw new Error('malformed status');
    return {
      aiAvailable: body.aiAvailable,
      model: typeof body.model === 'string' ? body.model : '',
      ...(typeof body.reason === 'string' ? { reason: body.reason.slice(0, MAX_REASON_CHARS) } : {}),
      models: parseModels(body.models),
    };
  } catch (err) {
    return { aiAvailable: false, model: '', reason: `Agent service unreachable (${errorText(err)})`, models: [] };
  }
}

/** The model a request carries: the player's choice when it is an offered one, else the default. */
const requestModel = (m: unknown): StoryModelId => (isStoryModel(m) ? m : DEFAULT_STORY_MODEL);

/** Exactly the RunEvidence fields, nothing a caller's object may carry besides. */
export function compactEvidence(e: RunEvidence): RunEvidence {
  return {
    version: 1,
    chapterId: e.chapterId,
    levelId: e.levelId,
    outcome: e.outcome,
    ...(e.failReason ? { failReason: e.failReason } : {}),
    time: e.time,
    distance: e.distance,
    topSpeed: e.topSpeed,
    startMass: e.startMass,
    endMass: e.endMass,
    peakMass: e.peakMass,
    absorbed: e.absorbed,
    iceLeft: e.iceLeft,
    waterfallsCrossed: e.waterfallsCrossed,
    collisions: e.collisions,
    treesFelled: e.treesFelled,
    knockedDown: e.knockedDown,
    buildingsDestroyed: e.buildingsDestroyed,
    storyPoints: e.storyPoints,
    destroyedByCategory: { ...e.destroyedByCategory },
    destroyedByKind: { ...e.destroyedByKind },
    landmarks: e.landmarks.map((l) => ({ id: l.id, status: l.status, closest: l.closest })),
    notable: e.notable.slice(0, 30).map((n) => ({ ...n })),
    route: e.route.slice(0, 40).map((p) => ({ s: p.s, d: p.d })),
    reachedS: e.reachedS,
    coastS: e.coastS,
  };
}

/** Exactly the HistoryItem fields, excerpt capped. */
export function compactHistory(h: readonly HistoryItem[]): HistoryItem[] {
  return h.map((x) => ({
    chapterId: x.chapterId,
    outcome: x.outcome,
    storyPoints: x.storyPoints,
    destroyedByCategory: { ...x.destroyedByCategory },
    // The world's condition weighs earlier toppling by kind (src/story/environment.ts).
    ...(x.destroyedByKind ? { destroyedByKind: { ...x.destroyedByKind } } : {}),
    landmarks: x.landmarks.map((l) => ({ id: l.id, status: l.status, closest: l.closest })),
    fragmentIds: [...x.fragmentIds],
    reflectionExcerpt: x.reflectionExcerpt.slice(0, 240),
  }));
}

/** A NarrativeResult the UI can trust structurally (the server already validated the content). */
function asResult(body: unknown): NarrativeResponse {
  if (!isObj(body)) throw new Error('malformed response');
  if (body.ok === false) {
    const reasons = ['unavailable', 'budget', 'rejected', 'error'] as const;
    const reason = reasons.find((r) => r === body.reason) ?? 'error';
    return {
      ...failure(reason, typeof body.message === 'string' ? body.message : 'The agents could not write this one.'),
      runId: typeof body.runId === 'string' ? body.runId : '',
      usage: Array.isArray(body.usage) ? (body.usage as NarrativeFailure['usage']) : [],
    };
  }
  const review = body.review;
  const validation = body.validation;
  if (
    body.ok !== true ||
    typeof body.text !== 'string' ||
    body.text.trim() === '' ||
    !isStrings(body.fragmentIds) ||
    !isStrings(body.factIds) ||
    !isObj(review) ||
    (review.verdict !== 'approved' && review.verdict !== 'corrected') ||
    !isObj(validation) ||
    validation.passed !== true
  ) {
    throw new Error('malformed or unvalidated narrative');
  }
  return {
    ok: true,
    source: 'ai',
    runId: typeof body.runId === 'string' ? body.runId : '',
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    text: body.text,
    fragmentIds: body.fragmentIds,
    factIds: body.factIds,
    claims: Array.isArray(body.claims) ? (body.claims as NarrativeResult['claims']) : [],
    review: {
      verdict: review.verdict,
      rounds: typeof review.rounds === 'number' ? review.rounds : 0,
      issues: isStrings(review.issues) ? review.issues : [],
    },
    validation: { passed: true, checked: typeof validation.checked === 'number' ? validation.checked : 0 },
    toolCalls: Array.isArray(body.toolCalls) ? (body.toolCalls as NarrativeResult['toolCalls']) : [],
    usage: Array.isArray(body.usage) ? (body.usage as NarrativeResult['usage']) : [],
  };
}

async function post(path: string, payload: unknown, opts: ClientOptions, timeoutMs: number): Promise<NarrativeResponse> {
  try {
    const body = await getJson(
      path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      opts,
      timeoutMs,
    );
    return asResult(body);
  } catch (err) {
    return failure('error', `Agent service failed: ${errorText(err)}`);
  }
}

export function requestReflection(req: ReflectRequest, opts: ClientOptions = {}): Promise<NarrativeResponse> {
  const payload: ReflectRequest = {
    chapterId: req.chapterId,
    evidence: compactEvidence(req.evidence),
    history: compactHistory(req.history),
    model: requestModel(req.model),
  };
  return post('/reflect', payload, opts, REFLECT_TIMEOUT_MS);
}

export function requestEpilogue(req: EpilogueRequest, opts: ClientOptions = {}): Promise<NarrativeResponse> {
  const payload: EpilogueRequest = {
    evidence: compactEvidence(req.evidence),
    history: compactHistory(req.history),
    model: requestModel(req.model),
  };
  return post('/epilogue', payload, opts, EPILOGUE_TIMEOUT_MS);
}

/** Does this chapter ask the agents under the player's preference? */
export const wantsAi = (chapter: Pick<ChapterDef, 'aiReflection'>, pref: AiPreference): boolean =>
  pref === 'all' || (pref === 'selected' && chapter.aiReflection);

/** An approved NarrativeResult as the Archive stores it. */
export function storedFromResult(r: NarrativeResult): StoredReflection {
  return {
    source: 'ai',
    ...(r.title ? { title: r.title } : {}),
    text: r.text,
    fragmentIds: r.fragmentIds,
    factIds: r.factIds,
    review: { verdict: r.review.verdict, rounds: r.review.rounds },
    validated: true,
    ...(r.runId ? { traceId: r.runId } : {}),
  };
}

export interface ReflectionOutcome {
  readonly reflection: StoredReflection;
  /** The agents' result when they wrote the reflection (for "How this was made"). */
  readonly result?: NarrativeResult;
  /** Why the authored reflection is shown, when the agents were asked and failed. */
  readonly failure?: NarrativeFailure;
}

/** The player's AI settings a reflection request depends on (StoryProgress['settings']). */
export interface AiChoice {
  readonly ai: AiPreference;
  readonly model: StoryModelId;
}

/**
 * The reflection for a completed chapter: the agents' (on the player's chosen model) when the
 * preference asks for them and they succeed, the authored fallback otherwise (never both, never neither).
 */
export async function reflectionFor(
  chapter: ChapterDef,
  evidence: RunEvidence,
  history: readonly HistoryItem[],
  choice: AiChoice,
  opts: ClientOptions = {},
): Promise<ReflectionOutcome> {
  const authored = fallbackReflection(chapter, evidence, history);
  if (!wantsAi(chapter, choice.ai)) return { reflection: authored };
  const res = await requestReflection({ chapterId: chapter.id, evidence, history, model: choice.model }, opts);
  if (res.ok) return { reflection: storedFromResult(res), result: res };
  return { reflection: authored, failure: res };
}
