import type { AgentName, ToolCallRecord, UsageRecord } from '../story/types';
import { COURSE_MODEL, PORTKEY_PROVIDER, providerOf, type ProviderId } from './config';
import type { Trace } from './log';
import { costCeilingUsd, costUsd } from './pricing';
import { validate, type ObjectSchema, type Schema } from './schema';
import type { SpendCap, SpendHold } from './spend';

/**
 * The model boundary. A Transport sends one OpenAI Responses API request (real: Portkey with the course
 * key, or OpenAI directly with the player's own key, via fetch; tests: a scripted fake) and `runAgent`
 * drives one agent through bounded rounds of tool calls until it returns a JSON reply that passes its
 * schema.
 *
 * Everything the model asks for is checked here, whatever the model is: a tool outside the agent's
 * allowlist is refused, arguments are validated against the tool's schema before it runs, results are
 * validated, size-capped and scanned for secrets before they go back, and rounds, tool calls, requests
 * and tokens are bounded. Refusals are returned to the model as tool errors so it can recover; budget
 * and transport failures end the run with an AgentError that the caller turns into NarrativeFailure.
 */

// -------------------------------------------------------------------------------------------------
// Responses API wire types (the subset this service uses)
// -------------------------------------------------------------------------------------------------

export interface FunctionToolSpec {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: ObjectSchema;
  readonly strict: false;
}

export type InputItem =
  | { readonly role: 'user' | 'developer' | 'assistant'; readonly content: string }
  | { readonly type: 'function_call'; readonly call_id: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'function_call_output'; readonly call_id: string; readonly output: string }
  | { readonly type: 'reasoning'; readonly id: string; readonly encrypted_content: string; readonly summary: readonly unknown[] };

export interface ResponsesRequest {
  readonly model: string;
  /** Stable per agent and first in the request, so prompt caching can reuse it across runs. */
  readonly instructions: string;
  readonly input: readonly InputItem[];
  readonly tools: readonly FunctionToolSpec[];
  readonly tool_choice: 'auto' | 'none';
  readonly parallel_tool_calls: boolean;
  readonly max_output_tokens: number;
  /** Stateless: nothing is stored at the provider; reasoning is carried forward encrypted. */
  readonly store: false;
  readonly include: readonly string[];
  readonly text: { readonly format: { readonly type: 'json_schema'; readonly name: string; readonly schema: Schema; readonly strict: false } };
  readonly prompt_cache_key?: string;
}

export interface ResponsesUsage {
  readonly input_tokens?: number;
  /** cache_write_tokens is reported by the course's Portkey route (seen in a real response, 2026-10-21). */
  readonly input_tokens_details?: { readonly cached_tokens?: number; readonly cache_write_tokens?: number };
  readonly output_tokens?: number;
  readonly output_tokens_details?: { readonly reasoning_tokens?: number };
}

export interface ResponsesReply {
  readonly id?: string;
  readonly status?: string;
  readonly output?: readonly unknown[];
  readonly usage?: ResponsesUsage;
  readonly incomplete_details?: { readonly reason?: string } | null;
  readonly error?: { readonly message?: string } | null;
  /** The model that actually answered (the gateway may route to a deployment, e.g. 'gpt-6-luna-global'). */
  readonly model?: string;
  /** Set by the transport from response headers, not part of the API body. */
  readonly meta?: {
    /** x-portkey-cache-status: 'HIT' (or 'SEMANTIC HIT') means Portkey replayed a stored response and no model ran. */
    readonly cacheStatus?: string;
    /** x-portkey-provider of the response: where the gateway actually sent the request. */
    readonly provider?: string;
  };
}

export interface Transport {
  readonly name: string;
  /** The provider whose key this transport holds (the real ones; a test double may leave it out). */
  readonly provider?: ProviderId;
  send(req: ResponsesRequest, signal: AbortSignal): Promise<ResponsesReply>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Replaces every secret (and anything bearer-token shaped) in a string, for error messages and logs. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join('[redacted]');
  return out.replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1[redacted]').replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

/** Largest response body read from the provider (a normal reply is a few KB). */
const MAX_REPLY_BYTES = 512 * 1024;

/** One POST {baseUrl}/responses with Node's built-in fetch; the reply parsed, every error redacted. */
async function postResponses(
  url: string,
  headers: Readonly<Record<string, string>>,
  req: ResponsesRequest,
  signal: AbortSignal,
  secrets: readonly string[],
  fetchImpl: typeof fetch,
): Promise<{ readonly body: ResponsesReply; readonly headers: Headers }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(req), signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TransportError(signal.aborted ? 'request timed out' : `network error: ${redact(msg, secrets).slice(0, 200)}`);
  }
  const text = await res.text();
  if (text.length > MAX_REPLY_BYTES) throw new TransportError('reply too large', res.status);
  if (!res.ok) throw new TransportError(`HTTP ${res.status}: ${redact(text, secrets).slice(0, 300)}`, res.status);
  try {
    return { body: JSON.parse(text) as ResponsesReply, headers: res.headers };
  } catch {
    throw new TransportError('reply is not JSON', res.status);
  }
}

/**
 * The course transport: POST {baseUrl}/responses through Portkey with PORTKEY_API_KEY. It serves
 * gpt-6-luna ONLY, whatever its caller asks ("No other models on the course key"): a request for any
 * other model is refused here, before anything is sent, so no code path can put another model on the
 * course key.
 */
export function portkeyTransport(
  opts: {
    readonly apiKey: string;
    readonly baseUrl: string;
    /**
     * Send x-portkey-cache-force-refresh so every request reaches the model. The course's Portkey
     * route caches responses (verified 2026-10-21: an identical request came back with
     * x-portkey-cache-status HIT and the ORIGINAL usage object), which would make logged usage a replay
     * rather than a measurement. Default true; PORTKEY_CACHE=allow turns it off.
     */
    readonly forceRefresh?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Transport {
  const secrets = [opts.apiKey];
  return {
    name: 'portkey',
    provider: 'course',
    async send(req, signal) {
      if (req.model !== COURSE_MODEL) {
        throw new TransportError(`the course key serves ${COURSE_MODEL} only; a request for another model was not sent`);
      }
      const { body, headers } = await postResponses(
        `${opts.baseUrl}/responses`,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          'x-portkey-provider': PORTKEY_PROVIDER,
          ...(opts.forceRefresh === false ? {} : { 'x-portkey-cache-force-refresh': 'true' }),
        },
        req,
        signal,
        secrets,
        fetchImpl,
      );
      const cacheStatus = headers.get('x-portkey-cache-status') ?? undefined;
      const provider = headers.get('x-portkey-provider') ?? undefined;
      return { ...body, meta: { cacheStatus, provider } };
    },
  };
}

/**
 * The own-key transport: POST {baseUrl}/responses on the OpenAI API itself with the player's
 * OPENAI_API_KEY (billed to them). No gateway, so no x-portkey-* header and no gateway cache. It serves
 * only the own-key models of the allowlist (gpt-6-sol); anything else is refused before it is sent.
 */
export function openaiTransport(opts: { readonly apiKey: string; readonly baseUrl: string }, fetchImpl: typeof fetch = fetch): Transport {
  const secrets = [opts.apiKey];
  return {
    name: 'openai',
    provider: 'own-key',
    async send(req, signal) {
      if (providerOf(req.model) !== 'own-key') {
        throw new TransportError('your own OpenAI key serves only the models chosen for it; a request for another model was not sent');
      }
      const { body } = await postResponses(
        `${opts.baseUrl}/responses`,
        { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        req,
        signal,
        secrets,
        fetchImpl,
      );
      return body;
    },
  };
}

// -------------------------------------------------------------------------------------------------
// Budgets
// -------------------------------------------------------------------------------------------------

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetError';
  }
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Process-wide request budget and per-UTC-day token budget, shared by every run. */
export class Budget {
  private requests = 0;
  private day: string;
  private tokens: number;

  constructor(
    private readonly limits: { readonly maxRequests: number; readonly dailyTokens: number },
    private readonly now: () => number = Date.now,
    /** Tokens already used today (from the usage log), so a restart does not reset the day. */
    seedTokensToday = 0,
  ) {
    this.day = utcDay(this.now());
    this.tokens = seedTokensToday;
  }

  private roll(): void {
    const d = utcDay(this.now());
    if (d !== this.day) {
      this.day = d;
      this.tokens = 0;
    }
  }

  /** Throws BudgetError when another request is not allowed; otherwise counts it. */
  reserveRequest(): void {
    this.roll();
    if (this.requests >= this.limits.maxRequests) throw new BudgetError(`request budget of ${this.limits.maxRequests} for this server process is used up`);
    if (this.tokens >= this.limits.dailyTokens) throw new BudgetError(`daily token budget of ${this.limits.dailyTokens} is used up`);
    this.requests++;
  }

  recordTokens(n: number): void {
    this.roll();
    this.tokens += Math.max(0, n);
  }

  snapshot(): { readonly requests: number; readonly day: string; readonly tokensToday: number } {
    this.roll();
    return { requests: this.requests, day: this.day, tokensToday: this.tokens };
  }
}

// The own-key provider's daily USD limit (SpendCap) is in spend.ts.

// -------------------------------------------------------------------------------------------------
// Tools and agents
// -------------------------------------------------------------------------------------------------

export interface ToolDef<C> {
  readonly name: string;
  readonly description: string;
  readonly parameters: ObjectSchema;
  /** Checked on every result before it goes back to the model. */
  readonly result: Schema;
  readonly run: (args: Record<string, unknown>, ctx: C) => unknown;
}

export interface AgentSpec<C> {
  readonly agent: AgentName;
  readonly instructions: string;
  /** The allowlist: the only tools this agent may call. */
  readonly tools: readonly ToolDef<C>[];
  readonly output: {
    readonly name: string;
    readonly schema: Schema;
    /** Extra checks beyond the schema (returns problems; [] when fine). */
    readonly check?: (value: unknown) => string[];
  };
  readonly maxOutputTokens: number;
}

export interface RunDeps {
  readonly transport: Transport;
  readonly model: string;
  /** Which key pays (recorded in every UsageRecord); defaults to the model's provider on the allowlist. */
  readonly provider?: ProviderId;
  /** The own-key daily USD limit: each request holds its ceiling before it is sent, then settles to its cost. */
  readonly spend?: SpendCap;
  readonly runId: string;
  readonly maxRounds: number;
  readonly maxToolCalls: number;
  readonly timeoutMs: number;
  readonly budget: Budget;
  readonly trace: Trace;
  /** Exact strings that must never go to the model or come back from a tool. */
  readonly secrets: readonly string[];
  readonly now?: () => number;
  /** Cancels the run: a request in flight is aborted and no further one is sent (never retried). */
  readonly signal?: AbortSignal;
}

/** The reason a cancelled run reports (the signal's reason when it is an Error). */
export const cancelMessage = (signal: AbortSignal): string =>
  `cancelled: ${signal.reason instanceof Error ? signal.reason.message : 'the request was stopped'}`;

export interface AgentRun<T> {
  readonly output: T;
  readonly usage: UsageRecord;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly rounds: number;
}

export type AgentErrorKind = 'budget' | 'rounds' | 'transport' | 'invalid' | 'cancelled';

export class AgentError extends Error {
  constructor(
    readonly kind: AgentErrorKind,
    message: string,
    readonly usage: UsageRecord,
    readonly toolCalls: readonly ToolCallRecord[],
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/** Attempts per request when it times out (the first try and one retry). */
export const MAX_TIMEOUT_ATTEMPTS = 2;

/** A tool result bigger than this is refused (the tools are designed to stay far below it). */
export const MAX_TOOL_OUTPUT_CHARS = 8000;
/** Arguments longer than this are refused before parsing. */
export const MAX_TOOL_ARGS_CHARS = 6000;
const LOG_ARGS_CHARS = 400;
/** What a tool name looks like (the real ones are snake_case); anything else is not echoed. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface ParsedReply {
  readonly calls: { readonly callId: string; readonly name: string; readonly args: string }[];
  readonly reasoning: InputItem[];
  readonly text: string;
}

/** Pulls function calls, carried-forward reasoning and the final text out of a reply. */
export function parseReply(reply: ResponsesReply): ParsedReply {
  const calls: ParsedReply['calls'][number][] = [];
  const reasoning: InputItem[] = [];
  let text = '';
  for (const item of reply.output ?? []) {
    if (!isObj(item)) continue;
    if (item.type === 'function_call' && typeof item.name === 'string' && typeof item.call_id === 'string') {
      calls.push({ callId: item.call_id, name: item.name, args: typeof item.arguments === 'string' ? item.arguments : '' });
    } else if (item.type === 'reasoning' && typeof item.id === 'string' && typeof item.encrypted_content === 'string') {
      // Stateless reasoning models need their reasoning back with the tool results; without the
      // encrypted content (store is false) an id alone would point at nothing, so it is dropped.
      reasoning.push({ type: 'reasoning', id: item.id, encrypted_content: item.encrypted_content, summary: [] });
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) if (isObj(c) && c.type === 'output_text' && typeof c.text === 'string') text += c.text;
    }
  }
  return { calls, reasoning, text };
}

/** Parses the agent's final JSON (tolerating a code fence or prose around one object). */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('no JSON object found');
  }
}

const truncateForLog = (v: unknown): unknown => {
  const s = JSON.stringify(v) ?? 'undefined';
  return s.length <= LOG_ARGS_CHARS ? v : `${s.slice(0, LOG_ARGS_CHARS)}…`;
};

/**
 * Runs one tool call through every check. Returns the string sent back to the model as the
 * function_call_output (always JSON: {"ok":true,"result":…} or {"ok":false,"error":…}).
 */
export function executeToolCall<C>(
  spec: AgentSpec<C>,
  call: { readonly name: string; readonly args: string },
  ctx: C,
  secrets: readonly string[],
): { readonly output: string; readonly record: Omit<ToolCallRecord, 'ms'> } {
  // The name is the model's text and the record reaches the browser ("How this was made"): a name that is
  // not tool-shaped is never repeated.
  const name = TOOL_NAME.test(call.name) ? call.name : '(not a tool name)';
  const refuse = (error: string, args: unknown = null): { output: string; record: Omit<ToolCallRecord, 'ms'> } => ({
    output: JSON.stringify({ ok: false, error }),
    record: { agent: spec.agent, tool: name, args: truncateForLog(args), ok: false, error },
  });
  const tool = spec.tools.find((t) => t.name === call.name);
  if (!tool) {
    return refuse(`unknown tool "${name}": you may only call ${spec.tools.map((t) => t.name).join(', ')}`);
  }
  if (call.args.length > MAX_TOOL_ARGS_CHARS) return refuse(`arguments too long (max ${MAX_TOOL_ARGS_CHARS} characters)`);
  let args: unknown;
  try {
    args = call.args.trim() === '' ? {} : JSON.parse(call.args);
  } catch {
    return refuse('arguments are not valid JSON');
  }
  const argErrors = validate(tool.parameters, args, 'args');
  if (argErrors.length) return refuse(`invalid arguments: ${argErrors.join('; ')}`, args);
  let result: unknown;
  try {
    result = tool.run(args as Record<string, unknown>, ctx);
  } catch (e) {
    return refuse(`tool failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}`, args);
  }
  const resErrors = validate(tool.result, result, 'result');
  if (resErrors.length) return refuse(`internal: tool result failed its schema (${resErrors.slice(0, 2).join('; ')})`, args);
  const output = JSON.stringify({ ok: true, result });
  if (output.length > MAX_TOOL_OUTPUT_CHARS) return refuse('result too large; ask for less (use the filters)', args);
  if (secrets.some((s) => s.length >= 6 && output.includes(s))) return refuse('internal: result withheld', args);
  return { output, record: { agent: spec.agent, tool: tool.name, args: truncateForLog(args), ok: true } };
}

/** The tool list as sent to the model. */
export const toolSpecs = <C>(tools: readonly ToolDef<C>[]): FunctionToolSpec[] =>
  tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));

/**
 * Drives one agent: up to `maxRounds` requests; tool calls are executed between them; the last round
 * (or any round after the tool budget is spent) is sent with tool_choice 'none' so the model must
 * answer. Returns the validated JSON output, or throws AgentError (with the usage spent so far).
 */
export async function runAgent<C, T>(
  spec: AgentSpec<C>,
  ctx: C,
  initialInput: readonly InputItem[],
  deps: RunDeps,
): Promise<AgentRun<T>> {
  const now = deps.now ?? Date.now;
  const started = now();
  const provider = deps.provider ?? providerOf(deps.model);
  const input: InputItem[] = [...initialInput];
  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let requests = 0;
  /** Sent, but no usage came back for them (see UsageRecord.unmeteredRequests). */
  let unmeteredRequests = 0;

  const usage = (ok: boolean): UsageRecord => {
    const u = { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens };
    return {
      ts: new Date(now()).toISOString(),
      runId: deps.runId,
      agent: spec.agent,
      model: deps.model,
      ...(provider ? { provider } : {}),
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      reasoningTokens,
      requests,
      unmeteredRequests,
      toolCalls: toolCalls.length,
      durationMs: now() - started,
      costUsd: costUsd(deps.model, u),
      ok,
    };
  };
  const fail = (kind: AgentErrorKind, message: string): AgentError => {
    deps.trace.step(spec.agent, 'error', message);
    return new AgentError(kind, message, usage(false), toolCalls);
  };

  for (let round = 1; round <= deps.maxRounds; round++) {
    const mustAnswer = round === deps.maxRounds || toolCalls.length >= deps.maxToolCalls;
    const req: ResponsesRequest = {
      model: deps.model,
      instructions: spec.instructions,
      input,
      tools: toolSpecs(spec.tools),
      tool_choice: mustAnswer ? 'none' : 'auto',
      parallel_tool_calls: true,
      max_output_tokens: spec.maxOutputTokens,
      store: false,
      include: ['reasoning.encrypted_content'],
      text: { format: { type: 'json_schema', name: spec.output.name, schema: spec.output.schema, strict: false } },
      prompt_cache_key: `last-thaw-${spec.agent}`,
    };
    // Defence in depth: the request must never carry a secret (the key travels only in a header).
    const body = JSON.stringify(req);
    if (deps.secrets.some((s) => s.length >= 6 && body.includes(s))) throw fail('invalid', 'a secret reached the request body; request not sent');
    // Under the own-key limit each attempt first holds the most it could cost (pricing.ts).
    const ceiling = deps.spend ? costCeilingUsd(deps.model, Buffer.byteLength(body, 'utf8'), req.max_output_tokens) : null;
    if (deps.spend && ceiling === null) throw fail('budget', `${deps.model} has no verified price, so its daily limit cannot be enforced`);
    let reply: ResponsesReply | undefined;
    let held: SpendHold | undefined;
    // A request that times out is sent once more: in the live runs of 2026-10-21 about 1 request in 60
    // stalled past 45 s (the 300 that answered took 1.6-29 s), and one stall cost the whole narrative.
    // Other transport errors end the run at once. Each attempt counts against the budgets. A stalled or
    // cancelled attempt had reached the provider (the saved traces show its prompt already cached by the
    // retry), so it may be billed, but no usage comes back: it is counted as unmetered, never estimated,
    // and under the own-key limit it stays charged at its ceiling.
    for (let attempt = 1; reply === undefined; attempt++) {
      // A cancelled run (the browser went, or the narrative's deadline passed) sends nothing more.
      if (deps.signal?.aborted) throw fail('cancelled', cancelMessage(deps.signal));
      held = undefined;
      try {
        if (deps.spend && ceiling !== null) held = deps.spend.hold(ceiling);
        deps.budget.reserveRequest();
      } catch (e) {
        held?.settle(0); // not sent
        throw fail('budget', e instanceof Error ? e.message : 'budget exhausted');
      }
      requests++;
      // One controller per attempt: its own timeout, and the run's cancellation chained to it.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), deps.timeoutMs);
      const onCancel = (): void => ac.abort();
      deps.signal?.addEventListener('abort', onCancel, { once: true });
      try {
        reply = await deps.transport.send(req, ac.signal);
      } catch (e) {
        // Aborted after it left, or answered 2xx but unreadable: tokens may be billed, usage unknown.
        const unmetered = ac.signal.aborted || (e instanceof TransportError && e.status !== undefined && e.status < 300);
        if (unmetered) unmeteredRequests++;
        // Refused by the provider (an HTTP error) or never sent: nothing to charge.
        held?.settle(unmetered ? held.ceilingUsd : 0);
        if (deps.signal?.aborted) throw fail('cancelled', cancelMessage(deps.signal));
        if (ac.signal.aborted && attempt < MAX_TIMEOUT_ATTEMPTS) {
          deps.trace.step(spec.agent, 'error', `round ${round}: request timed out after ${deps.timeoutMs} ms (usage unknown); sending it once more`);
          continue;
        }
        const msg = ac.signal.aborted ? `request timed out after ${deps.timeoutMs} ms` : e instanceof Error ? e.message : String(e);
        throw fail('transport', redact(msg, deps.secrets));
      } finally {
        clearTimeout(timer);
        deps.signal?.removeEventListener('abort', onCancel);
      }
    }
    // Usage straight from the response; a reply without it adds zero (never an estimate) and counts as
    // unmetered. A gateway cache hit replays the original response's usage although no model ran: it is
    // traced, not counted. Any hit status counts ('HIT', and 'SEMANTIC HIT' from Portkey's semantic cache);
    // 'MISS', 'SEMANTIC MISS', 'REFRESH' and 'DISABLED' are real model calls.
    const u = reply.usage ?? {};
    const gatewayHit = /\bhit\b/i.test(reply.meta?.cacheStatus ?? '');
    const noUsage = !gatewayHit && reply.usage === undefined;
    if (noUsage) unmeteredRequests++;
    const inTok = gatewayHit ? 0 : Math.max(0, u.input_tokens ?? 0);
    const outTok = gatewayHit ? 0 : Math.max(0, u.output_tokens ?? 0);
    let cost = 0;
    if (!gatewayHit) {
      const cachedTok = Math.max(0, u.input_tokens_details?.cached_tokens ?? 0);
      const writtenTok = Math.max(0, u.input_tokens_details?.cache_write_tokens ?? 0);
      inputTokens += inTok;
      cachedInputTokens += cachedTok;
      cacheWriteTokens += writtenTok;
      outputTokens += outTok;
      reasoningTokens += Math.max(0, u.output_tokens_details?.reasoning_tokens ?? 0);
      // This response's own cost, from its own usage, at the price table (the same figure the logs sum).
      cost = costUsd(deps.model, { inputTokens: inTok, cachedInputTokens: cachedTok, cacheWriteTokens: writtenTok, outputTokens: outTok }) ?? 0;
    }
    // Under the own-key limit the hold becomes that cost; a reply without usage stays charged at its ceiling.
    held?.settle(noUsage ? held.ceilingUsd : cost);
    deps.budget.recordTokens(inTok + outTok);
    deps.trace.step(
      spec.agent,
      'request',
      gatewayHit
        ? `round ${round}: served from the gateway cache (usage not consumed, not counted)`
        : `round ${round}: ${inTok} in (${u.input_tokens_details?.cached_tokens ?? 0} cached), ${outTok} out`,
      { status: reply.status ?? null, model: reply.model ?? null, gateway: reply.meta ?? null, usage: reply.usage ?? null },
    );
    if (reply.error?.message) throw fail('transport', redact(`provider error: ${reply.error.message}`, deps.secrets).slice(0, 300));

    const parsed = parseReply(reply);
    if (parsed.calls.length > 0) {
      input.push(...parsed.reasoning);
      for (const call of parsed.calls) {
        const t0 = now();
        // Ids are generated by the provider; anything odd is replaced so it cannot carry text.
        const callId = /^[A-Za-z0-9_-]{1,80}$/.test(call.callId) ? call.callId : `call_${toolCalls.length + 1}`;
        const { output, record } =
          toolCalls.length >= deps.maxToolCalls
            ? {
                output: JSON.stringify({ ok: false, error: `tool budget of ${deps.maxToolCalls} calls is used up: write your final answer now` }),
                record: { agent: spec.agent, tool: TOOL_NAME.test(call.name) ? call.name : '(not a tool name)', args: null, ok: false, error: 'tool budget exhausted' },
              }
            : executeToolCall(spec, call, ctx, deps.secrets);
        const full: ToolCallRecord = { ...record, ms: now() - t0 };
        toolCalls.push(full);
        deps.trace.step(spec.agent, 'tool', `${full.tool} ${full.ok ? 'ok' : `refused: ${full.error}`}`, {
          args: full.args,
          output: output.length > 600 ? `${output.slice(0, 600)}…` : output,
        });
        input.push({ type: 'function_call', call_id: callId, name: call.name.slice(0, 64), arguments: call.args.slice(0, MAX_TOOL_ARGS_CHARS) });
        input.push({ type: 'function_call_output', call_id: callId, output });
      }
      continue;
    }

    // A final answer: it must be JSON that passes the schema and the agent's own checks.
    let problems: string[];
    let value: unknown = null;
    if (!parsed.text.trim()) {
      problems = [reply.status === 'incomplete' ? `the reply was cut off (${reply.incomplete_details?.reason ?? 'incomplete'})` : 'the reply was empty'];
    } else {
      try {
        value = parseJsonReply(parsed.text);
        problems = validate(spec.output.schema, value, spec.output.name);
        if (problems.length === 0 && spec.output.check) problems = spec.output.check(value);
      } catch {
        problems = ['the reply is not a JSON object'];
      }
    }
    if (problems.length === 0) {
      return { output: value as T, usage: usage(true), toolCalls, rounds: round };
    }
    deps.trace.step(spec.agent, 'error', `round ${round}: invalid reply`, { problems });
    if (parsed.text.trim()) input.push({ role: 'assistant', content: parsed.text.slice(0, 4000) });
    input.push({
      role: 'user',
      content: `Your reply was not accepted: ${problems.slice(0, 6).join('; ')}. Reply again with only the JSON object for ${spec.output.name}.`,
    });
  }
  throw fail('rounds', `${spec.agent} gave no valid answer within ${deps.maxRounds} rounds`);
}
