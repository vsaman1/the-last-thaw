import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NarrativeMode, StoryData } from '../../story/validate';
import type { NarrativeDeps } from '../agents';
import { COURSE_MODEL, loadConfig, type ServerConfig } from '../config';
import { checkEpilogueRequest, checkReflectRequest, type CheckedRequest } from '../contracts';
import { Budget, portkeyTransport, type ResponsesRequest, type Transport } from '../llm';
import { fileLogger, type UsageLogger } from '../log';
import { levelSummaryFor, STORY } from '../story';
import { CH1_HISTORY, ch4Evidence, chapterOf, FIXTURE_LEVEL, FIXTURE_STORY } from '../testing/fixtureStory';

/**
 * Shared set-up for the LIVE runs (npm run agents:demo / agents:injection). They call the real model
 * through Portkey, so they run only when started by their npm script (npm_lifecycle_event) and skip
 * with a message when no PORTKEY_API_KEY is configured. Never part of the normal test suite. They run on
 * gpt-6-luna with the course key only (the course transport refuses any other model).
 */

export const PROJECT_ROOT = process.cwd();

export const isLive = (script: string): boolean => process.env.npm_lifecycle_event === script;

export interface LiveEnv {
  readonly config: ServerConfig;
  /** Every request actually sent, for checking what left the machine. */
  readonly sent: ResponsesRequest[];
  readonly transport: Transport;
  /** Writes logs/agent-usage.jsonl and logs/traces/<runId>.json, and keeps the traces in memory. */
  readonly logger: UsageLogger & { readonly traces: Map<string, unknown> };
}

/** Undefined (with the reason printed) when there is no key. */
export function liveEnv(script: string): LiveEnv | undefined {
  const loaded = loadConfig(PROJECT_ROOT);
  const course = loaded.providers.course;
  if (!course.apiKey) {
    console.log(`[${script}] skipped: ${course.unavailableReason}`);
    return undefined;
  }
  // The live scripts measure the course configuration: gpt-6-luna on the course key, whatever MODEL_NAME says.
  const config: ServerConfig = { ...loaded, model: COURSE_MODEL };
  const real = portkeyTransport({ apiKey: course.apiKey, baseUrl: course.baseUrl, forceRefresh: config.forceRefresh });
  const sent: ResponsesRequest[] = [];
  const transport: Transport = {
    name: real.name,
    provider: real.provider,
    send: (req, signal) => {
      sent.push(JSON.parse(JSON.stringify(req)) as ResponsesRequest);
      return real.send(req, signal);
    },
  };
  const file = fileLogger(config.logsDir);
  const traces = new Map<string, unknown>();
  const logger = {
    traces,
    appendUsage: file.appendUsage,
    readUsage: file.readUsage,
    writeTrace: (runId: string, trace: unknown) => {
      traces.set(runId, trace);
      file.writeTrace(runId, trace);
    },
  };
  console.log(`[${script}] model ${config.model} via ${course.baseUrl}; .env files: ${config.envFiles.length}`);
  return { config, sent, transport, logger };
}

export function narrativeDeps(env: LiveEnv, story: StoryData, fixtureLevel: boolean): NarrativeDeps {
  const b = env.config.budgets;
  return {
    config: env.config,
    transport: env.transport,
    story,
    level: fixtureLevel ? () => FIXTURE_LEVEL : levelSummaryFor,
    budget: new Budget({ maxRequests: b.maxRequestsPerProcess, dailyTokens: b.dailyTokenBudget }),
    logger: env.logger,
  };
}

/**
 * The demo's input. Default: the saved chapter 4 evidence fixture on the fixture story. With
 * DEMO_REQUEST=<path to a ReflectRequest or EpilogueRequest JSON exported from the game>, that request
 * against the real authored story instead (validated exactly as the HTTP route validates it).
 */
export function demoInput(): { mode: NarrativeMode; request: CheckedRequest; story: StoryData; fixture: boolean; label: string } {
  const file = process.env.DEMO_REQUEST;
  if (!file) {
    return {
      mode: 'reflection',
      request: { chapter: chapterOf('ch4-people'), evidence: ch4Evidence(), history: [CH1_HISTORY] },
      story: FIXTURE_STORY,
      fixture: true,
      label: 'fixture story, saved chapter 4 evidence (src/server/testing/fixtureStory.ts)',
    };
  }
  const body: unknown = JSON.parse(readFileSync(path.resolve(PROJECT_ROOT, file), 'utf8'));
  const isEpilogue = typeof body === 'object' && body !== null && !('chapterId' in body);
  const checked = isEpilogue ? checkEpilogueRequest(body, STORY) : checkReflectRequest(body, STORY);
  if (!checked.ok) throw new Error(`DEMO_REQUEST is not a valid request: ${checked.errors.join('; ')}`);
  return { mode: isEpilogue ? 'epilogue' : 'reflection', request: checked.value, story: STORY, fixture: false, label: file };
}
