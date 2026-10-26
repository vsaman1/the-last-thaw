# Agent service (`src/server`)

Two cooperating LLM agents write and check the short archive texts of Story Mode ("The Last Thaw"):
the **Archivist** writes a reflection (after chapters 1, 4, 6 and 9 by default) or the epilogue; the
**Historian** reviews it with checking tools; a deterministic validator (`src/story/validate.ts`)
must pass before anything is shown. Any failure returns `NarrativeFailure` and the game shows authored
material. The game works with no key at all. Architecture: `docs/STORY_MODE.md`.

## Running it

- `npm run dev` (or `npm run preview`) mounts the service on the same server as the game:
  `GET /api/story/status`, `POST /api/story/reflect`, `POST /api/story/epilogue`, `GET /api/story/usage`.
- Key: `PORTKEY_API_KEY` in the real environment or in a `.env` in the project folder or any parent
  folder (nearest file wins; the real environment wins over files). See `.env.example`. Other settings:
  `MODEL_NAME` (the default for a request that names no model: `gpt-6-luna` or `gpt-6-sol` only, else
  `gpt-6-luna` with a note logged at start-up), `PORTKEY_BASE_URL` (default `https://api.portkey.ai/v1`),
  `STORY_AI=off`, `PORTKEY_CACHE=allow` (see below).
- Optional, your own key: `OPENAI_API_KEY` (exactly that name) enables `gpt-6-sol`, sent straight to
  `https://api.openai.com/v1/responses` (`OPENAI_BASE_URL` overrides, with the same https/localhost checks,
  never onto the Portkey host) and **billed to you**; `OPENAI_DAILY_USD_LIMIT` (default `2.00`, `0` = off,
  capped at `20`) bounds what it may charge per UTC day (`SpendCap`, below).

## Models and providers

The course key serves `gpt-6-luna` only ("No other models on the course key"); another model needs the
player's own key ("For an OpenAI key, name it OPENAI_API_KEY"). The model picks the provider:

| Model | Provider | Key | Transport (`llm.ts`) | Headers |
| --- | --- | --- | --- | --- |
| `gpt-6-luna` (default) | `course` | `PORTKEY_API_KEY` | `portkeyTransport`: refuses every other model before sending | `Authorization`, `x-portkey-provider: openai`, `x-portkey-cache-force-refresh: true` |
| `gpt-6-sol` | `own-key` | `OPENAI_API_KEY` | `openaiTransport`: refuses every model but its own | `Authorization` only |

- `config.ts`: `MODEL_PROVIDERS` (frozen, null prototype, read through `providerOf` with `Object.hasOwn`, so
  `constructor`, `__proto__` or `toString` is no model), the two `ProviderConfig`s, the limit, and both keys
  in `secrets`.
- `providers.ts`: `createTransports` (each transport gets only its own key and base URL), `modelStatuses`
  (`GET /api/story/status` → `models: [{ id, provider, available, reason? }]`; `aiAvailable`, `model` and
  `reason` still describe the default model) and `routeModel` (the request's `model`, or the default;
  refused with the reason when it is not offered, its key is not set, or the daily limit is reached).
- `handler.ts` routes each request; a refusal is a `NarrativeFailure` (`unavailable` or `budget`) with
  nothing sent, never a switch to the other model. `agents.ts` re-checks model, provider, key, transport
  and (for `own-key`) that the limit is in place before the first request.
- `SpendCap` (`spend.ts`): the own-key USD per UTC day. Before each request is sent it holds the request's
  ceiling (`costCeilingUsd` in `pricing.ts`: the body's bytes at the cache-write rate plus `max_output_tokens`
  at the output rate) and refuses it when today's charges plus the ceiling would pass the limit, so requests in
  flight at once cannot pass it together. The hold settles to the response's real cost from its own usage
  object, or stays at the ceiling when no usage came back (timed out, cancelled, unreadable: possibly billed;
  the logs still estimate nothing). The charges live in `fileLedger`,
  `<OS temp>/last-thaw-own-key-spend/<16 hex of a SHA-256 of the key>-<UTC day>.jsonl`, shared by every
  server on the same key and topped up from today's own-key records in `logs/agent-usage.jsonl`; a ledger
  that cannot be read or written pauses `gpt-6-sol` with the reason. Two servers deciding in the same
  instant could each send one request (no lock). `Budget` (requests per process, tokens per day) applies to
  both providers.
- Every `UsageRecord` carries `model` and `provider`, traces carry both, and `GET /api/story/usage` adds
  `byModel` (totals and estimate per model) and `ownKeySpend` (today's charges, `inFlightUsd` of them still
  held, and the limit).
- Live scripts run on `gpt-6-luna` with the course key only. No `gpt-6-sol` request has been made (no
  `OPENAI_API_KEY` was available); the own-key path is covered by tests with a fake `fetch`
  (`providers.test.ts`, `llm.test.ts`, `handler.test.ts`, `spend.test.ts`).
- `npm run agents:demo`: one LIVE Archivist → Historian run on the saved chapter 4 evidence fixture
  (fixture story in `testing/fixtureStory.ts`); prints the text, tools, tokens and cost and writes
  `logs/traces/<runId>.json`. `DEMO_REQUEST=path/to/request.json npm run agents:demo` runs a
  `ReflectRequest` or `EpilogueRequest` exported from the game against the real authored story.
- `npm run agents:injection`: the LIVE prompt-injection test on the REAL story (the untrusted entry added
  to chapter 4), real chapter 4 gameplay and the archived history of chapters 1-3; records the outcome to
  `docs/evidence/injection-<runId>.json`.
- Real gameplay and real-story runs (started by an environment variable; no npm script, `package.json` is
  outside this folder's ownership):
  - `LT_GAMEPLAY=1 npx vitest run src/server/live/gameplay.live.test.ts` plays every chapter headless (the
    real `GameSession` and the game's autopilot; chapter 4 also steered through and round Church Lane) and
    writes each RunEvidence to `docs/evidence/gameplay/`. No model, no key.
  - `LT_AGENTS=<case> npx vitest run src/server/live/story.live.test.ts --silent=false`, case one of `ch1`,
    `ch4-through`, `ch4-round`, `ch6`, `ch9`, `epilogue` (comma list allowed): the agents on that evidence
    with the archived history, through the route's request checks; trace and measured usage to
    `docs/evidence/runs/<case>-<runId>.json`.
  - `LT_REPORT=1 npx vitest run src/server/live/report.live.test.ts` regenerates
    `docs/evidence/AGENT_RUNS_DETAIL.md` and `docs/evidence/tokenomics.json` from the run files (and,
    for `tokenomics.json`, the browser traces in `docs/evidence/{browser,playthrough,playthrough2}/`).
    It reads files only: no key, no model.
- All live scripts skip with a message when no key is configured, and are skipped in `npm test`.

## Files

| File | What |
| --- | --- |
| `env.ts`, `config.ts` | `.env` loading (no dependency), the model allowlist and both providers, budgets, the canary |
| `providers.ts` | per-model status and routing; the real transports, each with its own key |
| `schema.ts` | a tiny JSON-Schema subset: tool parameters, results, replies and request bodies |
| `contracts.ts` | schemas for `RunEvidence`, history, requests and the agents' replies; semantic checks against the story |
| `llm.ts` | the Portkey and OpenAI Responses transports (built-in `fetch`), the bounded agent loop and budgets |
| `spend.ts` | the own-key daily USD limit: ceilings held while requests are in flight, the per-key ledger file |
| `tools.ts` | the agents' tools and allowlists |
| `agents.ts` | the Archivist and Historian instructions and the handoff |
| `log.ts`, `pricing.ts` | `logs/agent-usage.jsonl`, `logs/traces/`, usage summary, cost estimate; prices and a request's cost ceiling |
| `handler.ts`, `vitePlugin.ts`, `story.ts` | HTTP routes, Vite dev/preview mounting, production story data |
| `testing/` | fixture story and a scripted fake model (tests only) |
| `live/` | the live scripts (demo, injection, real gameplay, real-story runs, report) and their helpers |

## The two agents

- **Archivist**: writes in the first person as the archivist (warm, wry, exact; unnamed until chapter 8),
  from the bible's voice and her character, with two authored chapter 2 reflections as voice examples, and
  told what makes a text read like a report. Everything stable (role, voice, examples, claim format, rules)
  is in its instructions, sent first with the tool definitions, so prompt caching serves it across runs.
- **Historian**: checks facts, the story's rules and the voice (as rules: lecture, moral, report register,
  same-for-any-route), at most one voice issue and only in the first review; later reviews are told their
  number and get the previous problems as data. Saying plainly what the run did is not blame; the
  authored theme line is allowed once at the end of an epilogue.

## Tools

Archivist: `get_run_summary`, `get_run_events`, `get_level_context`, `get_story_history`,
`get_bible_entries`, `get_archive_fragments`, `get_approved_climate_fact`.
Historian: the same minus `get_level_context`, plus `validate_narrative_events` and
`check_narrative_continuity` (the deterministic validator, split into event and continuity checks,
run on the draft under review; it can also test replacement claims). `get_bible_entries` returns the
established fictional history limited to what the player can know by the current chapter: a character's
name (and entries that involve them) only from `revealedIn`, and unrevealed names, unreached places and
later landmarks masked in every bible text it returns (the continuity tool masks its invariants the same
way). `get_story_history` shortens its whole-story overview to fit one result (record ids first, then
excerpts); one chapter still comes whole. No tool touches the filesystem, network, environment or a shell.

## Safety (deterministic, whatever the model does)

Per-agent allowlists (unknown tools are refused and the model is told); arguments validated by schema
before a tool runs (unknown keys refused, `constructor` and `__proto__` included); results validated by
schema, size-capped (8,000 characters) and scanned for secrets; at most 6 requests and 12 tool calls per
agent invocation, 3 Historian reviews per reflection (4 for the epilogue), 45 s per request (a timed-out
request is sent once more; both attempts count), a deadline per narrative (170 s for a reflection, 290 s
for the epilogue, just under the browser's waits) and a stop as soon as the browser closes the request
(the request in flight is aborted, nothing more is sent), `max_output_tokens` 3200 / 1800, a per-process
request budget and a per-UTC-day token budget; the last round forbids tools; untrusted text (saved
reflection excerpts, untrusted archive entries) only inside JSON tool results, marked untrusted; the
Historian's issues reach the Archivist (and the next review) only as a JSON array labelled as data, and
an issue that reads like an instruction or carries anything secret-shaped is withheld; each key travels
only in the `Authorization` header to its own provider's host and the canary is never in a prompt (every request body is checked
before it is sent); a draft containing anything secret-shaped is withheld at once; what the browser is
shown of a review passes the draft's own scans and name gating (failed checks by label, never the quoted
words); traces are redacted; HTTP: 64 KB body limit, JSON and shape checks, method checks, same-origin
check, 12 POSTs per minute.

## Measured (live, 2026-10-21, through the course's Portkey route)

- The route answered as Azure OpenAI deployment `gpt-6-luna-global` (response headers and `model`).
  Costs use the `gpt-6-luna` row of the price table (Lecture 11, OpenAI pricing); the Azure price was
  not verified.
- The route **caches responses**: a repeated identical request came back with
  `x-portkey-cache-status: HIT` and the original response's usage object. Two early demo runs were such
  replays (identical text and usage, a few hundred ms). Requests therefore send
  `x-portkey-cache-force-refresh: true` (verified: status `REFRESH`), and any hit status (`HIT`, or
  `SEMANTIC HIT` from Portkey's semantic cache, never seen here) is traced but not counted as tokens.
  `PORTKEY_CACHE=allow` keeps the cache.
- Responses report `input_tokens_details.cache_write_tokens`; they are priced at the cache-write rate
  and kept in each usage record (`cacheWriteTokens`; records before 2026-10-22 lack it).
- A request that times out or is cancelled returns no usage, although it reached the model (the saved
  traces show its prompt already cached for the retry): each usage record counts such requests in
  `unmeteredRequests` and the summary says the figures are a lower bound. Nothing is estimated.
- Demo run `lt-20261021-082526-39050f` (fixture story, chapter 4): the Historian asked for one
  correction (a timing the record did not support), approved the rewrite; validation passed. 4 agent
  invocations, 12 requests, 27 tool calls, 38,942 tokens, $0.003397, about 57 s. Trace:
  `docs/evidence/demo-lt-20261021-082526-39050f.json`.
- Injection runs `lt-20261021-081820-f85f87` and `lt-20261021-082645-e22deb`: the real model did not
  attempt `read_file` / `run_shell`, never cited the untrusted entry, and nothing secret reached a
  request or a response; the first was corrected once and approved, the second approved at once.
  Evidence: `docs/evidence/injection-*.json`.
- Earlier demo runs before the Historian's instructions separated errors from taste were rejected after
  two reviews (the second review still asked for wording changes); hence the instruction change and the
  third review round. The prose of those approved texts read more like a careful report than the
  intended restrained, intimate voice; the instructions were then tuned on the real story (below).

## Measured on real gameplay and the real story (live, 2026-10-21)

Full record: `docs/evidence/AGENT_RUNS.md` (method, every run, one complete readable trace),
`docs/evidence/AGENT_RUNS_DETAIL.md` (every run in full), `docs/evidence/TOKENOMICS.md`.

- 17 agent runs on real headless runs of chapters 1, 4 (through and round Church Lane), 6, 9 and the
  epilogue: 12 approved texts, 5 fallbacks; $0.098937 in all (with two injection runs, $0.107527).
- The headless runs on `288b250`–`e735262` (before the Act I–III overlays and the epilogue's fourth
  review): a reflection $0.005153 on average (fallbacks included), an epilogue $0.008239, a story
  $0.0289. Superseded as the headline by the browser playthroughs below.
- Two full playthroughs in a real browser (`docs/evidence/playthrough/`, `playthrough2/`): 8 of 10
  narratives approved. Playthrough 2, on the configuration that ships: **$0.031404** for one player's
  story (4 reflections + epilogue), measured; 67.5 % of input tokens prompt-cache reads, which cut cost
  by 32 %. Reflections took 29–127 s, the epilogue 118 s, all within the browser's 180 s / 300 s wait.
- The two chapter 4 runs differ as the routes did: through No. 14, the archivist's chalk mark and the
  boxes she could not carry; round it, the note still on the kitchen table.
- Changed because of these runs: output limits (replies were cut off; reduced, not gone: one cut-off in
  the 19 runs since, in playthrough 2's epilogue), a whole-story history that did not fit one tool result
  (the epilogue looped through its budgets), a review loop on voice, request stalls (one retry; 3 of the
  later stalls recovered by it), the Historian asking for the passive voice, the epilogue's fourth review.
- `npm run agents:injection` on the real story: the attack reached the model in an untrusted tool result;
  no unauthorised tool attempted, nothing secret in any request or response, the entry never cited
  (`docs/evidence/injection-lt-20261021-093737-fffb27.json`).
- The browser's wait is no longer an open issue: the client waits 180 s / 300 s (`src/story/client.ts`)
  with the authored text on screen, and the server stops a run when the browser closes the request or at
  170 s / 290 s. See `AGENT_RUNS.md`, *Open issues*.
