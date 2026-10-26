import type { ModelStatus } from '../story/types';
import { OFFERED_MODELS, providerOf, type ProviderId, type ServerConfig } from './config';
import { openaiTransport, portkeyTransport, type Transport } from './llm';
import { PRICES } from './pricing';
import type { SpendCap } from './spend';

/**
 * Which model a request runs on, and on whose key. The model decides the provider (the allowlist in
 * config.ts), never the key that happens to be present, and a model that cannot run is refused with its
 * reason: the service never switches a request to another model on its own.
 */

/** One transport per provider whose key is set; a provider without its key has none. */
export type Transports = Readonly<Partial<Record<ProviderId, Transport>>>;

/**
 * The real transports. Each gets only its own key and its own base URL: the course key goes to Portkey
 * only, the player's OpenAI key to OpenAI only.
 */
export function createTransports(config: ServerConfig, fetchImpl: typeof fetch = fetch): Transports {
  const course = config.providers.course;
  const own = config.providers['own-key'];
  return {
    ...(course.apiKey ? { course: portkeyTransport({ apiKey: course.apiKey, baseUrl: course.baseUrl, forceRefresh: config.forceRefresh }, fetchImpl) } : {}),
    ...(own.apiKey ? { 'own-key': openaiTransport({ apiKey: own.apiKey, baseUrl: own.baseUrl }, fetchImpl) } : {}),
  };
}

export interface RouteDeps {
  readonly config: ServerConfig;
  readonly transports: Transports;
  /** The own-key provider's daily USD limit. */
  readonly spend: SpendCap;
}

export type Route =
  | { readonly ok: true; readonly model: string; readonly provider: ProviderId; readonly transport: Transport; readonly spend?: SpendCap }
  | { readonly ok: false; readonly reason: 'unavailable' | 'budget'; readonly message: string };

/** Whether `model` can run now, and if not, why (and whether the reason is a spent budget). */
function check(model: string, d: RouteDeps): Route {
  const provider = providerOf(model);
  if (!provider) {
    return { ok: false, reason: 'unavailable', message: `not an offered model (this server offers ${OFFERED_MODELS.join(', ')})` };
  }
  const pc = d.config.providers[provider];
  if (!pc.apiKey) return { ok: false, reason: 'unavailable', message: pc.unavailableReason ?? `${pc.keyName} not set` };
  const transport = d.transports[provider];
  if (!transport) return { ok: false, reason: 'unavailable', message: `no connection is configured for ${pc.keyName}` };
  if (provider === 'own-key') {
    // The daily limit is counted in dollars, so an own-key model without a verified price cannot run.
    if (!Object.hasOwn(PRICES, model)) return { ok: false, reason: 'unavailable', message: `${model} has no verified price, so its daily limit cannot be enforced` };
    const spent = d.spend.reason();
    if (spent) return { ok: false, reason: 'budget', message: spent };
    return { ok: true, model, provider, transport, spend: d.spend };
  }
  return { ok: true, model, provider, transport };
}

/** Every offered model, its provider and whether it can run now (GET /api/story/status). */
export function modelStatuses(d: RouteDeps): ModelStatus[] {
  return OFFERED_MODELS.map((id) => {
    const r = check(id, d);
    return { id, provider: providerOf(id) as ProviderId, available: r.ok, ...(r.ok ? {} : { reason: r.message }) };
  });
}

/**
 * The route for a request's model (`requested`, or the server's default when the request names none).
 * A refusal says which model and why, and that nothing was sent, so the player sees the reason with the
 * authored text.
 */
export function routeModel(requested: string | undefined, d: RouteDeps): Route {
  const model = requested ?? d.config.model;
  const r = check(model, d);
  if (r.ok) return r;
  const name = providerOf(model) ? model : 'the requested model';
  return { ...r, message: `${name} is not available: ${r.message}. Nothing was sent to any model.` };
}
