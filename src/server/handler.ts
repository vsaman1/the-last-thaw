import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChapterDef, NarrativeFailure, StatusResponse } from '../story/types';
import type { NarrativeMode, StoryData } from '../story/validate';
import { generateNarrative, newRunId } from './agents';
import { loadConfig, type ServerConfig } from './config';
import { checkEpilogueRequest, checkReflectRequest } from './contracts';
import { Budget } from './llm';
import { fileLogger, summarizeUsage, tokensOnDay, usdOnDay, type UsageLogger } from './log';
import { createTransports, modelStatuses, routeModel, type Transports } from './providers';
import { defaultLedgerDir, fileLedger, memoryLedger, SpendCap } from './spend';
import { levelSummaryFor, STORY } from './story';
import type { LevelSummary } from './tools';

/**
 * HTTP surface of the agent service, mounted under /api/story on the Vite dev and preview servers
 * (src/server/vitePlugin.ts):
 *
 *   GET  /api/story/status    → StatusResponse (each model, its provider, whether it can run and, if not,
 *                               why; never a key, nor more about one than that boolean)
 *   POST /api/story/reflect   → NarrativeResponse for a ReflectRequest
 *   POST /api/story/epilogue  → NarrativeResponse for an EpilogueRequest
 *   GET  /api/story/usage     → token usage, cost and the cost estimate from logs/agent-usage.jsonl
 *
 * Request errors are 4xx with a short JSON reason (bad method, body too large, not JSON, wrong shape,
 * too many requests, cross-origin). A request that is well-formed always gets a NarrativeResponse with
 * status 200, including every failure (reason 'unavailable' | 'budget' | 'rejected' | 'error'): the
 * client shows authored material for those. A request runs on the model it names (the player's
 * choice) or the server's default; a model that cannot run (its key not set, its daily limit reached)
 * fails with the reason, and the service never switches to another model on its own.
 */

export const API_PREFIX = '/api/story/';

/** Fixed one-minute sliding window over all POSTs (a local dev server has one player). */
export class RateLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the next request is allowed (0 = allowed now; the request is then counted). */
  take(): number {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.perMinute) return Math.max(1, Math.ceil((60_000 - (t - this.stamps[0])) / 1000));
    this.stamps.push(t);
    return 0;
  }
}

export interface HandlerDeps {
  readonly config: ServerConfig;
  readonly story: StoryData;
  /** One transport per provider whose key is set (src/server/providers.ts). */
  readonly transports: Transports;
  /** Requests per process and tokens per UTC day, shared by both providers. */
  readonly budget: Budget;
  /** The own-key provider's USD per UTC day (OPENAI_DAILY_USD_LIMIT). */
  readonly spend: SpendCap;
  readonly logger: UsageLogger;
  readonly level: (chapter: ChapterDef) => LevelSummary | undefined;
  readonly rate: RateLimiter;
  readonly now?: () => number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: readonly string[],
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
  if (res.headersSent || res.destroyed) return; // destroyed: the browser has gone
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(json);
}

/** Reads the body up to `limit` bytes; past that the rest is drained and the request fails with 413. */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > limit;
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => (tooLarge ? reject(new HttpError(413, `body larger than ${limit} bytes`)) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', () => reject(new HttpError(400, 'could not read the request body')));
  });
}

/** Browsers send Origin on cross-site POSTs: only this server's own pages may call the service. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const ROUTES: Readonly<Record<string, 'GET' | 'POST'>> = { status: 'GET', reflect: 'POST', epilogue: 'POST', usage: 'GET' };

export function createStoryHandler(deps: HandlerDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { config } = deps;

  // aiAvailable, model and reason describe the default model, as before gpt-6-sol was added.
  const status = (): StatusResponse => {
    const models = modelStatuses(deps);
    const def = models.find((m) => m.id === config.model);
    return {
      aiAvailable: def?.available === true,
      model: config.model,
      ...(def?.reason ? { reason: def.reason } : {}),
      models,
    };
  };

  async function narrative(mode: NarrativeMode, req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const type = String(req.headers['content-type'] ?? '');
    if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'Content-Type must be application/json');
    const wait = deps.rate.take();
    if (wait > 0) throw new HttpError(429, 'too many requests; try again shortly', undefined, { 'Retry-After': String(wait) });
    const raw = await readBody(req, config.budgets.maxBodyBytes);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'the body is not valid JSON');
    }
    const checked = mode === 'epilogue' ? checkEpilogueRequest(body, deps.story) : checkReflectRequest(body, deps.story);
    if (!checked.ok) throw new HttpError(400, 'invalid request', checked.errors);
    // The model decides the provider. One that cannot run is refused with its reason: nothing is sent,
    // and the request is never moved to another model.
    const route = routeModel(checked.value.model, deps);
    if (!route.ok) {
      const runId = newRunId((deps.now ?? Date.now)());
      const refused: NarrativeFailure = { ok: false, runId, reason: route.reason, message: route.message, fallback: true, usage: [] };
      return refused;
    }
    // The agents stop when the browser goes (its fetch timed out or the page closed: the connection
    // closes before the answer is written) and at a deadline just under the browser's wait. Either way
    // the run ends at its next request, logs what it spent and answers with the authored fallback.
    const stop = new AbortController();
    const onClose = (): void => {
      if (!res.writableEnded) stop.abort(new Error('the browser closed the request'));
    };
    res.on('close', onClose);
    // The browser may have gone already (while the body was read or checked): its 'close' then fired
    // before this listener existed, and the run would otherwise go on for nobody. The connection is
    // what to ask: req.destroyed is true for any request whose body has been read to its end.
    if (res.destroyed || req.socket.destroyed) onClose();
    const limit = config.budgets.narrativeDeadlineMs[mode];
    const deadline = setTimeout(() => stop.abort(new Error(`the ${mode} passed its ${Math.round(limit / 1000)} s deadline`)), limit);
    try {
      return await generateNarrative(mode, checked.value, {
        config,
        transport: route.transport,
        model: route.model,
        ...(route.spend ? { spend: route.spend } : {}),
        story: deps.story,
        level: deps.level,
        budget: deps.budget,
        logger: deps.logger,
        now: deps.now,
        signal: stop.signal,
      });
    } finally {
      clearTimeout(deadline);
      res.off('close', onClose);
    }
  }

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length).replace(/\/$/, '') : '';
      const method = Object.hasOwn(ROUTES, route) ? ROUTES[route] : undefined; // never 'constructor' etc.
      if (!method) throw new HttpError(404, 'not found');
      if (req.method !== method) throw new HttpError(405, `use ${method}`, undefined, { Allow: method });
      if (!sameOrigin(req)) throw new HttpError(403, 'cross-origin requests are not allowed');
      switch (route) {
        case 'status':
          return send(res, 200, status());
        case 'usage':
          return send(res, 200, {
            ...summarizeUsage(deps.logger.readUsage()),
            budget: deps.budget.snapshot(),
            ownKeySpend: deps.spend.snapshot(),
          });
        case 'reflect':
          return send(res, 200, await narrative('reflection', req, res));
        case 'epilogue':
          return send(res, 200, await narrative('epilogue', req, res));
      }
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.details ? { details: e.details } : {}) }, e.headers);
      send(res, 500, { error: 'internal error' });
    }
  };
}

/**
 * Production wiring: config from .env files, the real story, file logs, one transport per provider
 * whose key is set. Settings that were ignored or corrected are logged here (reasons only, never values).
 * The own-key limit's ledger is shared by every server on the same OPENAI_API_KEY (`ledgerDir`, the OS
 * temp folder unless a test says otherwise) and topped up from today's own-key records in this
 * checkout's usage log.
 */
export function defaultDeps(
  projectRoot: string,
  log: (msg: string) => void = (m) => console.warn(m),
  opts: { readonly ledgerDir?: string } = {},
): HandlerDeps {
  const config = loadConfig(projectRoot);
  for (const note of config.notes) log(`[last-thaw agents] ${note}`);
  const logger = fileLogger(config.logsDir);
  const today = new Date().toISOString().slice(0, 10);
  let seedTokens = 0;
  let seedUsd = 0;
  try {
    const records = logger.readUsage();
    seedTokens = tokensOnDay(records, today);
    seedUsd = usdOnDay(records, today, 'own-key');
  } catch {
    // an unreadable log starts the day at zero
  }
  const ownKey = config.providers['own-key'].apiKey;
  return {
    config,
    story: STORY,
    transports: createTransports(config),
    budget: new Budget({ maxRequests: config.budgets.maxRequestsPerProcess, dailyTokens: config.budgets.dailyTokenBudget }, Date.now, seedTokens),
    spend: new SpendCap(config.ownKeyDailyUsdLimit, Date.now, seedUsd, ownKey ? fileLedger(opts.ledgerDir ?? defaultLedgerDir(), ownKey) : memoryLedger()),
    logger,
    level: levelSummaryFor,
    rate: new RateLimiter(config.budgets.postsPerMinute),
  };
}

let singleton: { readonly root: string; readonly handle: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined;

/**
 * Entry point for the Vite plugin (loaded with ssrLoadModule at request time). One handler per project
 * root, created on first use, so the budgets and the rate limit live as long as the module does.
 */
export async function handleStoryRequest(req: IncomingMessage, res: ServerResponse, projectRoot: string): Promise<void> {
  if (!singleton || singleton.root !== projectRoot) singleton = { root: projectRoot, handle: createStoryHandler(defaultDeps(projectRoot)) };
  await singleton.handle(req, res);
}
