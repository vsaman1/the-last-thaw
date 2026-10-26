import type { ResponsesReply, ResponsesRequest, Transport } from '../llm';

/**
 * TEST DOUBLE: a scripted model. Each step receives the request (and how many requests this agent's
 * instructions have seen) and returns a reply. Every request is recorded, so tests can assert what was
 * and was not sent. Steps are consumed per agent (keyed by the first words of `instructions`), so an
 * Archivist script and a Historian script can be written separately.
 */

export type Step = (req: ResponsesRequest) => ResponsesReply;

export interface FakeTransport extends Transport {
  readonly requests: ResponsesRequest[];
}

export const agentOf = (req: ResponsesRequest): 'archivist' | 'historian' =>
  req.instructions.startsWith('You are the Historian') ? 'historian' : 'archivist';

let callSeq = 0;

export const usage = (input: number, output: number, cached = 0, reasoning = 0): NonNullable<ResponsesReply['usage']> => ({
  input_tokens: input,
  input_tokens_details: { cached_tokens: cached },
  output_tokens: output,
  output_tokens_details: { reasoning_tokens: reasoning },
});

/** A reply that calls tools. */
export const callTools = (calls: readonly { name: string; args?: unknown }[], u = usage(500, 40)): ResponsesReply => ({
  status: 'completed',
  output: calls.map((c) => ({
    type: 'function_call',
    id: `fc_${++callSeq}`,
    call_id: `call_${callSeq}`,
    name: c.name,
    arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}),
  })),
  usage: u,
});

/** A final message reply carrying JSON (or raw text). */
export const answer = (value: unknown, u = usage(800, 200, 300, 50)): ResponsesReply => ({
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }],
  usage: u,
});

export function fakeTransport(script: { archivist?: Step[]; historian?: Step[] }): FakeTransport {
  const requests: ResponsesRequest[] = [];
  const queues = { archivist: [...(script.archivist ?? [])], historian: [...(script.historian ?? [])] };
  return {
    name: 'fake',
    requests,
    async send(req) {
      // A deep copy: the agent loop keeps appending to its input array after the call.
      requests.push(JSON.parse(JSON.stringify(req)) as ResponsesRequest);
      const step = queues[agentOf(req)].shift();
      if (!step) throw new Error(`fake transport: no scripted reply left for the ${agentOf(req)}`);
      return step(req);
    },
  };
}
