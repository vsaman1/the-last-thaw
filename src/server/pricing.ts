/**
 * Model prices in USD per 1M tokens, standard short-context rates. An unknown model has no price: its
 * cost is null, never a guess.
 *
 * - gpt-6-luna: Lecture 11 of the course, which cites the OpenAI pricing page (recorded 2026-10-21); the
 *   same page gives the same four figures.
 * - gpt-6-sol: the OpenAI pricing page, https://developers.openai.com/api/docs/pricing (recorded
 *   2026-10-21; cache write = the 30-minute rate). Exactly 20 times luna on every component. Runs only on
 *   the player's own OPENAI_API_KEY (the course key serves luna only).
 */
export interface ModelPrice {
  readonly input: number;
  readonly cachedInput: number;
  /** Applied to input_tokens_details.cache_write_tokens when the response reports them. */
  readonly cacheWrite: number;
  readonly output: number;
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  'gpt-6-sol': { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 10.0 },
};

export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  /** Input tokens written to the provider's prompt cache (0 when not reported). */
  readonly cacheWriteTokens?: number;
  /** Includes reasoning tokens (the API counts them as output). */
  readonly outputTokens: number;
}

/** USD for this usage at the table's price, or null for a model without a verified price. */
export function costUsd(model: string, u: TokenUsage): number | null {
  const p = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined; // MODEL_NAME=constructor has no price
  if (!p) return null;
  const cached = Math.min(u.cachedInputTokens, u.inputTokens);
  const written = Math.min(u.cacheWriteTokens ?? 0, u.inputTokens - cached);
  const usd = ((u.inputTokens - cached - written) * p.input + cached * p.cachedInput + written * p.cacheWrite + u.outputTokens * p.output) / 1e6;
  return Math.round(usd * 1e8) / 1e8;
}

/**
 * The most one request can cost, for the own-key daily limit only (the logs record what responses
 * report, never this): every byte of its JSON body billed as an input token at the dearest input rate
 * (a cache write), plus all the output tokens max_output_tokens allows. A token stands for at least one
 * byte of text, the body carries everything the model reads (earlier reasoning comes back encrypted and
 * base64-encoded, longer than its tokens), and its JSON syntax outweighs the few tokens the API adds per
 * message, so the real cost is lower. Measured on the code playthrough 2 ran (e75c2f0): the first
 * Archivist request of a chapter 1 reflection is 14,163 bytes, and the API counted 2,826 input tokens for
 * it (lt-20261021-185424-9b1f71); the epilogue's, 14,629 bytes for 2,939 (lt-20261021-190124-e8bb8a).
 * Null for a model without a verified price.
 */
export function costCeilingUsd(model: string, requestBytes: number, maxOutputTokens: number): number | null {
  const p = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!p) return null;
  const perInputToken = Math.max(p.input, p.cachedInput, p.cacheWrite);
  const usd = (Math.max(0, requestBytes) * perInputToken + Math.max(0, maxOutputTokens) * p.output) / 1e6;
  return Math.round(usd * 1e8) / 1e8;
}
