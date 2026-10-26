# Tokenomics of the Story Mode agents (measured 2026-10-21)

Every figure below is computed from saved runs, with the API's own usage objects, by
`src/server/live/report.live.test.ts` (`npm run agents:report`, LT_REPORT=1; it reads files only and calls
no model), which writes them to [`tokenomics.json`](tokenomics.json). Two kinds of saved run feed it:

- the **headless runs** on real gameplay, `docs/evidence/runs/*.json` (method: [`AGENT_RUNS.md`](AGENT_RUNS.md));
- the **real-browser sessions**, `docs/evidence/{browser,playthrough,playthrough2}/*trace_*.json`: the
  traces the service wrote while the game was played in Chrome.

**Prices** (`src/server/pricing.ts`, `gpt-6-luna`, Lecture 11 citing the OpenAI pricing page), USD per 1M
tokens: input $0.10, cached input $0.01, cache write $0.125, output $0.50 (reasoning tokens are billed as
output). Every response came from the Azure deployment `gpt-6-luna-global`; its Azure price was not
verified. Portkey's own fees are not included.

Every measured figure in this file is `gpt-6-luna` on the course key. The optional `gpt-6-sol` (the player's own
`OPENAI_API_KEY`, billed to them) has **no run yet**; its cost appears only as a labelled projection in
[*gpt-6-sol: a projection*](#gpt-6-sol-a-projection-not-a-measurement) below.

## Which configuration each set measures

| Set | When (UTC) | Code | Same as what ships? |
| --- | --- | --- | --- |
| 17 headless runs | 09:16–09:55 | `07ba0f7` … `e735262` | No (see the next row) |
| 8 headless runs on `288b250`–`e735262` (called "final configuration" in earlier versions of this file) | 09:40–09:55 | `288b250`–`e735262` | **No**: before the Act I–III overlays (merged 15:40–16:12 UTC), which changed what the chapters hold (chapter 6: 8 landmarks and 3,650 story points in the headless run, 12 landmarks and 4,450 points in both playthroughs); before `e75c2f0` (the epilogue's fourth review, the epilogue asked for when chapter 9 completes) |
| Browser playthrough 1 | 17:11–17:22 | `39aea91` | Reflections yes; the epilogue no (at most 3 reviews, asked for on Continue) |
| **Browser playthrough 2** | 18:54–19:03 | `e75c2f0` and later | **Yes**: the one complete playthrough on the configuration that ships |

Changes after playthrough 2, not re-measured (no live calls were made for them): `3dc41d2` moved one
slag heap in Power Valley (chapter 6) off a street; on 2026-10-22 the Historian's issues started going to
the Archivist as a JSON array labelled as data (one more sentence, about 30 tokens, in each agent's cached
instructions), the run stops at a deadline or when the browser closes the request, and requests that return
no usage are logged as such.

## What was measured

| Set | Runs (approved) | Mean input | Mean cached | Mean written to cache | Mean output (reasoning) | Requests | Tool calls | Mean cost | Mean wall time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All 17 headless runs | 17 (12) | 59,627 | 43,226 | 16,326 | 6,679 (4,938) | 11.2 | 26.5 | $0.005820 | 91.7 s |
| Headless `288b250`–`e735262`, all | 8 (6) | 51,693 | 35,578 | 16,074 | 6,590 (4,843) | 10.9 | 25.4 | $0.005664 | 89.1 s |
| Headless `288b250`–`e735262`, reflections | 7 (5) | 44,294 | 30,152 | 14,111 | 6,169 (4,488) | 10.6 | 24.3 | $0.005153 | 86.3 s |
| Headless epilogues on instructions v3 | 2 (2) | 89,529 | 61,635 | 27,820 | 8,277 (6,210) | 12.5 | 29.5 | $0.008239 | 100.9 s |
| Browser playthrough 1, all 5 narratives | 5 (4) | 52,730 | 36,058 | 16,628 | 5,835 (4,158) | 10.6 | 24.6 | $0.005361 | 90.8 s |
| **Browser playthrough 2 (shipped), all 5 narratives** | 5 (4) | 56,373 | 38,075 | 18,250 | 7,228 (5,547) | 11.4 | 26.0 | **$0.006281** | 88.5 s |
| Browser reflections, both playthroughs | 8 (7) | 42,425 | 28,401 | 13,996 | 4,934 (3,524) | 9.6 | 22.8 | $0.004504 | 72.0 s |
| Shipped epilogue (playthrough 2) | 1 (1) | 98,264 | 68,663 | 29,487 | 12,590 (10,318) | 14 | 34 | $0.010679 | 118.1 s |

The means deliberately **include the runs that fell back** (two in the headless `288b250`–`e735262` set,
one in each playthrough): a run that
ends in the authored fallback is still billed, so this is the expected cost of asking. Every set is small;
treat the figures as indicative. Single narratives on the shipped configuration cost $0.0024–0.0107
(`AGENT_RUNS.md`, *Real-browser sessions*).

Where the money goes on the shipped configuration (playthrough 2): **output is 57.5 % of the cost** and
**77 % of output tokens are reasoning**; input is almost all cache reads (67.5 %) or cache writes (32.4 %):
only 240 of 281,864 input tokens were billed at the plain input price.

## Cost per player

One player, one full playthrough, the default **'selected'** AI setting: reflections after chapters 1, 4,
6 and 9, plus the epilogue; every chapter completed once (`perPlayerStory` in `tokenomics.json`).

**Headline, measured on the shipped configuration (browser playthrough 2):**

| Narrative | Run | Result | Cost |
| --- | --- | --- | ---: |
| Chapter 1 reflection | `185424-9b1f71` | corrected, 2 reviews | $0.003696 |
| Chapter 4 reflection | `185629-73cdb5` | approved, 1 review | $0.002396 |
| Chapter 6 reflection | `185816-dd515b` | corrected, 3 reviews (one stalled request, retried) | $0.005563 |
| Chapter 9 reflection | `190124-adf44c` | fallback: rejected after 3 reviews (billed all the same) | $0.009070 |
| Epilogue | `190124-e8bb8a` | corrected, 2 reviews | $0.010679 |
| **One playthrough** | | | **$0.031404** |

$0.003696 + $0.002396 + $0.005563 + $0.009070 + $0.010679 = **$0.031404**; 57 model requests, 281,864
input and 36,140 output tokens.

Two other readings of the same question, for scale:

- **Pooled over both playthroughs**: 4 × $0.004504 (the mean of the 8 browser reflections, which ran on the
  shipped reflection configuration in both playthroughs) + $0.010679 (the one shipped epilogue) =
  **$0.028695**. Playthrough 1 as a whole cost $0.002157 + $0.003639 + $0.004996 + $0.004511 + $0.011501 =
  $0.026804, its epilogue on the old three-review configuration (it fell back).
- **The previous headline** (headless, `288b250`–`e735262`, before the overlays): 4 × $0.005153 + $0.008239 =
  $0.028851. It no longer describes what ships and is kept here only for comparison.

The headline is one playthrough (n = 1), and a **lower bound**: its chapter 6 reflection had one request
that stalled past the 45 s timeout; that attempt returned no usage and is in no figure here (see *What
the figures leave out*).

Consistency check, not an independent one: the service's own estimator (`estimateCosts` in
`src/server/log.ts`), fed the usage records of playthrough 2, averages $0.006281 per narrative and multiplies
by 5: $0.031404, necessarily the same sum. Fed the 8 headless records it gives $0.028322 against $0.028851:
the same runs weighted per narrative instead of per reflection and epilogue.

## Per user per month, and at 100 and 10,000 users

| Scenario | Per user per month | 100 users | 10,000 users |
| --- | ---: | ---: | ---: |
| **One playthrough a month, 'selected' (default): measured, playthrough 2** | **$0.0314** | **$3.14** | **$314.04** |
| The same, pooled: 4 × $0.004504 + $0.010679 | $0.0287 | $2.87 | $286.95 |
| One playthrough, **'all'** AI setting: 9 × $0.004504 + $0.010679 | $0.0512 | $5.12 | $512.15 |
| Engaged player: each AI chapter finished 3 times, so 12 reflections and 3 epilogues: 12 × $0.004504 + 3 × $0.010679 | $0.0861 | $8.61 | $860.85 |

Assumptions, all of them:
- Costs scale linearly: no volume discount, no Portkey fee, the cache hit rate stays as measured (about two
  thirds of input). With many concurrent players the shared prefix would, if anything, stay warmer.
- **Every completion of chapter 9 with AI on asks for, and bills, one epilogue**, whether or not the player
  opens it: the request starts as soon as chapter 9 completes (`prefetchEpilogue` in `src/ui/story/storyRun.ts`).
  A replay of chapter 9 drops the earlier answer in the browser, but that request runs to the end on the
  server and is billed. Hence 3 epilogues in the engaged row.
- A replay of an AI chapter asks the agents again (the archive keeps the latest completion per chapter);
  failed attempts before a completion ask nothing (the agents run only after a completed chapter).
- The 'all' row uses the chapter 1, 4, 6 and 9 reflection mean for chapters 2, 3, 5, 7 and 8, which were never
  run with the agents.
- Narratives that fall back are billed for what they used (included in the means above); showing the
  authored text instead costs nothing more.
- The authored text is free: players with AI off, or without a key, cost $0.
- Prices as above; a different route price (the Azure deployment) would change every figure linearly.
- Capacity, not money, is the first limit of the present design: each local server process allows 300
  model requests and 1.5M tokens per UTC day (`DEFAULT_BUDGETS`), about 4–5 full playthroughs (playthrough
  2 used 57 requests and 318,004 tokens). That is right for one player on their own machine; a shared
  server for many players would need its budgets set per user, not per process.

## gpt-6-sol: a projection, not a measurement

`gpt-6-sol` runs only on the player's own `OPENAI_API_KEY` (the course key serves `gpt-6-luna` only). No such key
was available when this was written, so **no `gpt-6-sol` request has been made and nothing in this section is
measured**: it prices the **measured `gpt-6-luna` token counts** of the shipped playthrough (browser playthrough
2) at `gpt-6-sol` rates. Prices: the OpenAI pricing page (<https://developers.openai.com/api/docs/pricing>, standard
short-context, recorded 2026-10-21), USD per 1M tokens:

| Model | Input | Cached input | Cache write (30 min) | Output |
| --- | ---: | ---: | ---: | ---: |
| `gpt-6-luna` | 0.10 | 0.01 | 0.125 | 0.50 |
| `gpt-6-sol` | 2.00 | 0.20 | 2.50 | 10.00 |

`gpt-6-sol` is exactly 20 times `gpt-6-luna` on every component, so at the same token counts it costs exactly 20
times as much.

**The arithmetic.** Playthrough 2 used 281,864 input tokens, of which 190,373 were cache reads and 91,251 cache
writes, so 281,864 − 190,373 − 91,251 = 240 at the plain input rate; and 36,140 output tokens (`tokenomics.json`,
`sets.browserPlaythrough2.total`). Tokens × USD per 1M tokens, in millionths of a dollar:

| | Plain input | Cache reads | Cache writes | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `gpt-6-luna` (measured) | 240 × 0.10 = 24.00 | 190,373 × 0.01 = 1,903.73 | 91,251 × 0.125 = 11,406.375 | 36,140 × 0.50 = 18,070.00 | 31,404.105 = **$0.031404** |
| `gpt-6-sol` (projected) | 240 × 2.00 = 480.00 | 190,373 × 0.20 = 38,074.60 | 91,251 × 2.50 = 228,127.50 | 36,140 × 10.00 = 361,400.00 | 628,082.10 = **$0.628082** |

$0.628082 = 20 × $0.031404105. Per narrative (20 × the measured luna costs above): chapter 1 $0.073920, chapter 4
$0.047920, chapter 6 $0.111260, chapter 9 $0.181400 (it fell back, billed all the same), epilogue $0.213580; sum
**$0.628080** (the per-run figures are rounded to the microdollar). `src/server/log.test.ts` recomputes both totals
from these token counts.

| Scenario, projected for `gpt-6-sol` | Per user per month | 100 users | 10,000 users |
| --- | ---: | ---: | ---: |
| One playthrough a month, 'selected' (default): 20 × $0.031404 | $0.6281 | $62.81 | $6,280.82 |
| The same, pooled: 20 × $0.028695 | $0.5739 | $57.39 | $5,739.00 |
| One playthrough, 'all' AI setting: 20 × $0.051215 | $1.0243 | $102.43 | $10,243.00 |
| Engaged player (12 reflections, 3 epilogues): 20 × $0.086085 | $1.7217 | $172.17 | $17,217.00 |

These are the player's own costs, on their own key: a player on the default `gpt-6-luna` costs what the sections
above say, and the course key is never used for `gpt-6-sol`.

**The daily limit.** `OPENAI_DAILY_USD_LIMIT` (default $2.00 per UTC day) bounds what `gpt-6-sol` charges to the
player's key. At the projected $0.6281 a playthrough that is 3 playthroughs (3 × $0.6281 = $1.8842); a fourth starts
with $0.1158 left and stops at the first request whose ceiling no longer fits (below), its later narratives falling
back to the authored text. With the 'all' setting it is about 1.95 playthroughs.

How it is enforced (`src/server/spend.ts`): before a request is sent it holds its **ceiling**, the most it could cost
(`costCeilingUsd` in `src/server/pricing.ts`: every byte of the request body at the cache-write rate, since a token
stands for at least one byte, plus the whole `max_output_tokens` at the output rate), and it is refused if today's
charges plus that ceiling would pass the limit. Holds of requests in flight count, so narratives running at once (the
chapter 9 reflection and the prefetched epilogue already do) cannot pass the limit together. When the response
arrives the hold becomes its real cost from its usage at the price table; a request that returns no usage (timed
out, cancelled) may still be billed, so it stays charged at its ceiling. For playthrough 2's first request (the
chapter 1 reflection's first Archivist request, `185424-9b1f71`, 14,163 bytes on the code that ran it):

| | Input | Output | Total |
| --- | ---: | ---: | ---: |
| Ceiling at `gpt-6-sol` rates | 14,163 bytes × 2.50 = 35,407.5 | 3,200 allowed × 10.00 = 32,000.0 | **$0.0674075** |
| Measured tokens at `gpt-6-sol` rates | 3 × 2.00 + 2,823 written × 2.50 = 7,063.5 | 88 × 10.00 = 880.0 | **$0.0079435** |

(millionths of a dollar; the API counted 2,826 input tokens for those 14,163 bytes, about 5 bytes a token, and the
epilogue's first request was 14,629 bytes for 2,939). So the day's total stays within the limit as long as no
request costs more than its ceiling, however many run at once. The price is headroom: once less is left than the
next request's ceiling (about $0.07 for a first request, more for a later round with a longer body), the rest of the
day's limit goes unused. The charges are kept in a file per key and UTC day in the OS temp folder, shared by every
server on the machine that uses the same key, so a second server or a restart does not start the day again. Not
covered: two servers deciding in the same instant (no lock), the key used elsewhere, and cache writes the API does not
report (see below), which the limit, like the logs, counts at the plain input rate.

**Why the real figure may differ** (every one of these is untested until a `gpt-6-sol` run is made):

- **Same tokens assumed.** A different model may reason longer or shorter (reasoning was 77 % of luna's output),
  call more or fewer tools, need more or fewer Historian reviews, and fall back more or less often. Any of these
  moves the cost more than the rounding above.
- **Same caching assumed.** The projection keeps playthrough 2's 67.5 % cache reads and 32.4 % cache writes. Those
  were observed through Portkey on the Azure deployment, not on the OpenAI API directly. The service prices cache
  writes only when a response reports `input_tokens_details.cache_write_tokens`; if the OpenAI API does not report
  them, those tokens are logged (and counted against the daily limit) at the plain input rate, $2.00 instead of
  $2.50: on playthrough 2's mix, 91,251 × 0.50 = $0.0456 too low, 7.3 % of $0.6281.
- **Still a lower bound.** Requests that stall return no usage and are in no figure (see below), for either model.
  The daily limit does count them, at their ceiling: that is the limit's own count, and the logs still estimate
  nothing.
- **Capacity.** The per-process budgets (300 requests, 1.5M tokens per UTC day) apply to both models: about 4.7
  playthroughs of playthrough 2's 318,004 tokens, so for `gpt-6-sol` the default $2.00 limit is reached first.

## What the figures leave out

- **Requests that stalled.** Six requests in the saved evidence stalled past the 45 s timeout:
  `092555-8873fb`, `094436-26cf7d`, the injection run `093604-fe037d`, `171714-a15cce`, `171905-232d7e` and
  `185816-dd515b`. A stalled request returns no usage, so its tokens are in no figure here, yet it reached
  the model and was probably billed: the retry of `171714`'s rewrite found 3,243 of its 3,246 input tokens
  already cached and wrote none, and that rewrite prompt was new, so only the stalled attempt could have
  written it; `171905`'s round-4 retry found 7,014 of 7,017 cached; the first v2 epilogue request
  (`092650-b77121`) found 2,899 of 2,902 cached, and the only earlier v2 request was `092555`'s, which
  timed out. The size of the gap was not measured: at most one prompt prefill per stall (about 3,000–7,000
  input tokens), plus any output generated before the abort. **Every per-narrative, per-player and per-month
  figure is therefore a lower bound.** Since 2026-10-22 the service records such requests in each usage
  record (`unmeteredRequests`) instead of silently adding nothing.
- **Cache writes in the injection files.** `docs/evidence/injection-*.json` kept only the per-invocation
  usage records, which did not record cache writes. Their costs (computed by the service at the time, with
  the writes) cannot be recomputed from the published prices with the file alone: for `093737-fffb27` the
  recorded tokens give $0.007218 against the recorded $0.007746, a gap that implies about 21,100 written
  tokens (`093604`: about 5,650; `082645`: about 5,200). Those write counts are inferred, not recorded. The run
  files and browser traces are unaffected (raw per-request usage). Usage records now keep `cacheWriteTokens`,
  and the injection script saves the raw per-request usage too.

## Prompt caching

- **Layout.** The instructions (role, voice, the two authored voice examples, claim format, rules) and the
  tool definitions are identical for every run of an agent and come first; per-run data comes later, as the
  task message and tool results. Each request carries `prompt_cache_key: last-thaw-<agent>`. The route
  reports `cached_tokens` and `cache_write_tokens`.
- **Across runs.** The first request of a headless run is about 2,806–2,939 input tokens (instructions +
  tools + the task). In 13 of the 16 headless runs with a first request, **2,773–2,936 of those tokens (≈ 99 %)
  were served from the cache**; the 3 cold starts were the first run of the session and the first epilogue on
  each of two new versions of the instructions (v1 and v3; the epilogue's last paragraph differs from the
  reflection's, and a changed prefix is a new cache entry). The first v2 epilogue's prefix had been cached by
  a request that timed out (above).
- **Within a run.** Every round resends the conversation so far, so each round's input is the previous
  round's input plus new tool results: the old part comes from the cache, the new part is written to it.
- **Measured effect.** Shipped configuration (playthrough 2): 67.5 % of input tokens were cache reads, 32.4 %
  cache writes; the same tokens at the plain input price would have cost $0.046256 instead of $0.031404:
  **caching cut the cost by 32 %** (33 % on the 8 headless runs on `288b250`–`e735262`, 37 % over all 17).
  Writes cost 25 % more than plain input; the reads at 10 % of the price more than pay for them.

## What was done to cut cost, and whether it hurt quality

| Measure | Measured effect | Quality |
| --- | --- | --- |
| **AI only at checkpoints** (chapters 1, 4, 6, 9 and the epilogue by default; the other chapters use authored reflections) | $0.0287 per playthrough instead of $0.0512 with every chapter (pooled browser means): **−44 %** | The authored reflections are the story's own voice (and the agents' voice examples); nothing is lost on the other five chapters. |
| **Compact evidence**: the client sends a compacted RunEvidence (capped event list and route) and history (240-character excerpts) | Request bodies 1,591 bytes (chapter 1, no history) to 10,122 bytes (chapter 9, eight chapters of history), headless runs | The texts still turn on specific records and events (the chalk mark, the plums, Mrs Pell's receipt, the dam breach order); no text in these runs needed something the compact evidence left out. |
| **Tools instead of a stuffed prompt**: the agents fetch the slices they need; results capped at 8,000 characters | 17–33 tool calls per narrative on the headless runs on `288b250`–`e735262`, 12–37 in the playthroughs | Each look at the evidence is recorded and checkable (the Historian re-reads the same records). |
| **Stable prefix + prompt cache key** | −32 % cost on the shipped configuration (above) | None: the prefix is fixed text. |
| **Bounded rounds**: ≤ 6 requests and ≤ 12 tool calls per agent invocation, ≤ 3 Historian reviews for a reflection and ≤ 4 for the epilogue; since 2026-10-22 also a whole-narrative deadline (170 s / 290 s) | The worst run measured (`092650-b77121`, epilogue on v2) stopped at 22 requests, 83 tool calls, $0.017518 | A bound ends a stuck run in the authored fallback, never in an unapproved draft: 2 of the 8 headless runs on `288b250`–`e735262` and 2 of the 10 playthrough narratives fell back. That costs AI coverage. |
| **Fixes made after measuring** (2026-10-21) | Output limit 1600/900 → 3200/1800: the 10 cut-off replies of the earlier runs (14,800 output tokens, $0.0074, billed and thrown away) fell to **one** in the 19 runs since `86fe5ba` (both playthroughs included): the Historian's third request in the shipped epilogue `e8bb8a` hit the 1,800 limit (1,800 output tokens, all reasoning, about $0.0009 of output billed and discarded; the next request answered). History overview that fits one call: the epilogue went from $0.017518 and a rejection to $0.007236–0.011501, approved in 3 of the 4 epilogues since. Tool calls in one round; one retry on a stalled request. | Fewer fallbacks. A limit only caps a reply; a reply that hits it is still billed. |

**Not done, and why.** Reasoning is 77 % of output tokens and output is 57 % of cost (shipped
configuration), so the reasoning-effort setting is the largest remaining lever; it was not changed because
no run measured its effect on accuracy, and the Historian's checks are where reasoning pays. Skipping the
Historian when the deterministic checks pass would roughly halve the cost, but the trace in `AGENT_RUNS.md`
shows the Historian catching unsupported statements the deterministic checks passed.

## Latency (a cost the player pays)

Wall time per narrative in the browser sessions: reflections 29–127 s (8 runs, mean 72 s), the shipped
epilogue 118 s, playthrough 1's epilogue 202 s (it fell back). On the headless runs: 86 s per reflection
and 101 s per epilogue on `288b250`–`e735262` (successful runs overall 25.7–130.6 s, median 68 s).

The browser client waits up to 180 s for a reflection and 300 s for the epilogue (`REFLECT_TIMEOUT_MS` and
`EPILOGUE_TIMEOUT_MS` in `src/story/client.ts`); the authored text is on screen from the start and the
player can always continue. Every AI narrative in both playthroughs came back inside that wait (driver logs:
reflections 28–124 s after the chapter completed; playthrough 1's epilogue, then asked for on Continue, 177 s
after it; the shipped epilogue, asked for when chapter 9 completed, was ready 2.0 s after the player
pressed Continue: `epi ai settled ms 2024` in `playthrough2/2026-10-21_full_playthrough_2.log`). Since 2026-10-22 the server also stops a narrative when
the browser closes the request and at 170 s / 290 s, so an answer nobody will read is no longer billed to
the end (covered by tests; not exercised in a live run).

Single requests: the 300 that answered in the saved runs and traces took 1.6–29.0 s (7 of the 188 headless
ones and 2 of the 112 browser ones over 21 s); the 6 stalls above did not answer within 45 s.
