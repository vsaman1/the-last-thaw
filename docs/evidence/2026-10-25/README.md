# Evidence for the report: 25 October 2026

Raw outputs behind the numbers in `deliverables/report.html` and `deliverables/slides.html`. Every live
model call here used `gpt-6-luna` through Portkey on the course key; no `gpt-6-sol` call was made. Usage
records come from the API's own usage object; traces are the server's redacted run traces (keys are never
logged). Machine-specific paths were replaced by repository-relative ones; nothing else was edited.

The measured runs used the development build of 24 October (commit `ba6fa8d`, not in this repository's
history). This repository's code is that build plus four bug fixes, none in the agent service (see the main
README, *Evidence and cost*). The demo video's playthrough ran on the submitted build.

## Which file backs which number

| Folder / file | What it holds | Numbers in the report |
| --- | --- | --- |
| `playthrough/agent-usage.jsonl` | 28 usage records, one per agent turn. The first two (`lt-20261025-035238-974b10`) are a separate chapter 1 run, cut short, approved at its first review ($0.0017). The other 26 are the measured playthrough: `070702-904f6b` (chapter 1), `070843-eed6fb` (chapter 4), `071114-ea4a38` (chapter 6, fell back), `071412-7562b5` (chapter 9), `071412-175641` (epilogue). | One full story: 82 requests, 516,966 input tokens (393,501 cached, 122,499 written), 51,014 output (39,751 reasoning), $0.044851. Per-narrative costs in Figure 7 and the slides. |
| `playthrough/traces/` | The six runs' traces: tool calls, drafts, reviews, validator results. | The traced run in Section 4 (`070702-904f6b`: 20 tool calls, 37.7 s, "passed (29 checks)", the walkers issue). Chapter 4's four issues over two revise reviews (`070843-eed6fb`). The chapter 6 fallback (`071114-ea4a38`). 14 reviews, 9 "revise", 16 issues across the six runs. |
| `injection/` | The live prompt-injection run `lt-20261025-070616-6e3dc1`: the test's evidence file, its usage records and its trace. | Figure 8: the attack reached the model, every check held, 15 allowed tool calls, approved after one review (28 checks), 5 requests, 32,318 tokens, $0.003638. |
| `safety/safety_demo.json` | Scripted safety demonstrations: the validator on a real approved chapter 4 text and six one-sentence inventions, the model lock, the spend cap, loop bounds, an obedient (compromised) model. | Figure 9 (33 checks, six rejections); gpt-6-sol, gpt-4o and gpt-5 refused with 0 requests; 29 holds of $0.0674, the 30th refused; 2 attempts in 514 ms; 6 of 6 rounds; 12 tool calls. |
| `safety/validator_gaps.json` | Twelve paraphrased forbidden sentences run through the validator. | 3 of 12 caught. |
| `safety/unit_tests.json` | The safety test files, run on 25 October. | 158 of 158 tests passed in 13 files. |
| `safety/http_probes.txt`, `safety/http_rate.txt` | Requests to the running server that never reach a model. | 403 cross-origin, 413 for 70 KB, 400 for smuggled keys, 404 for `/constructor`; the 13th POST in a minute gets 429 (Retry-After 60). |
| `safety/bundle_scan.txt`, `safety/repo_key_scan.txt` | Scans for the key value (counts only, never the value). | 0 copies in the production bundle, the repository files or the git history. |
| `tests/act3_test.txt` | The Act III inevitability test, re-run on the measured build. | 19 of 19 passed, including "every tested line breaks many built things (at least 5 / 7 / 8 per chapter)". |
| `tests/test_full_summary.txt` | The summary of `npm test` on the submitted tree. | 2,672 passed, 4 skipped. |
| `video-playthrough/agent-usage.jsonl` | 20 usage records from the second full playthrough, recorded for the demo video on the submitted build. | 69 requests, 491,889 input and 43,764 output tokens, $0.041370; 5 of 5 narratives approved (the epilogue after four reviews). |

The two playthroughs are a small sample (n = 2): 4 of 5 narratives approved in the measured one, 5 of 5 in
the second. The README dry run from a fresh clone made one more live chapter 1 call ($0.0042).
