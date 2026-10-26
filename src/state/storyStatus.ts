/**
 * What the agent service says it can run (GET /api/story/status): which models, on whose key, and why
 * one cannot run. Fetched when Settings opens (at most once per STATUS_MAX_AGE_MS), never persisted:
 * the answer changes when the server's keys or today's spending change. Nothing about a key reaches the
 * browser beyond each model's `available` boolean and reason.
 */
import { create } from 'zustand';
import { fetchStatus, type ClientOptions } from '../story/client';
import type { ModelStatus, StatusResponse } from '../story/types';

/** A status younger than this is reused instead of asked again. */
export const STATUS_MAX_AGE_MS = 30_000;

interface StoryStatusState {
  /** Null until the first answer (or the first failure to reach the service). */
  status: StatusResponse | null;
  /** Date.now() of that answer. */
  checkedAt: number;
}

export const useStoryStatus = create<StoryStatusState>(() => ({ status: null, checkedAt: 0 }));

let inflight: Promise<void> | null = null;

/** Ask the service again unless a fresh answer is at hand; concurrent calls share one request. */
export function refreshStoryStatus(opts: ClientOptions & { maxAgeMs?: number } = {}): Promise<void> {
  const { status, checkedAt } = useStoryStatus.getState();
  if (status && Date.now() - checkedAt < (opts.maxAgeMs ?? STATUS_MAX_AGE_MS)) return Promise.resolve();
  inflight ??= fetchStatus(opts)
    .then((s) => useStoryStatus.setState({ status: s, checkedAt: Date.now() }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** A model's entry in the status, if the service listed it. */
export const modelStatus = (status: StatusResponse | null, id: string): ModelStatus | undefined =>
  status?.models.find((m) => m.id === id);
