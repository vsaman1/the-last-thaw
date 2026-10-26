# The second fix round's own measurements

The scripts and raw logs behind `docs/evidence/AUDIO_RUNS.md`, *Second fix round*. Each step module runs under
`rdriver.mjs` (headless Chrome over the DevTools protocol, a fresh profile per run in `profiles/` next to it,
deleted at the end, `--mute-audio --autoplay-policy=document-user-activation-required`, 1280 × 720) against a dev
server on port 5199 (never 5173) started with `vite.evidence.config.mjs`, which adds two development-only
endpoints: `/__orig/<file>` serves the recordings as they were published (for the before/after decode) and
`/__fix2_hmr?file=<abs path>` triggers Vite's `server.reloadModule` (an edit's hot update without editing the
file). The config and the scripts hold absolute paths of the machine they ran on; adjust them to rerun.

    node rdriver.mjs <step.mjs>                          # from this folder
    node mix/driver.mjs mix/music-balance.step.mjs http://localhost:5199/

| File | Measures | Log |
| --- | --- | --- |
| `s_gaincheck.mjs` | The lossless gain: each recording decoded before and after (sample-by-sample ratio, length, peak) and its loudness as shipped (the lab's `recording()`) | `out_gaincheck.txt` |
| `s_gesture.mjs` | The first click's main-thread task (lead decision L2): the long task, the `AudioContext` constructor's own time, and a CPU profile's inclusive time per function, after 6 s on the menu | `out_gesture_before.txt` (the click path as at `f5b231e`), `out_gesture_after.txt` (the work-in-progress build), `out_gesture_final.txt` (this round's final tree) |
| `s_hmr.mjs` | Three hot updates of `src/audio/manager.ts` (or `HMR_FILE`), each followed by a click: the AudioContexts in the document and whether the page reloaded (needs `FIX2_HMR=1` for the server) | `out_hmr_before.txt`, `out_hmr_after.txt`, `out_hmr_graph_after.txt` |
| `s_replay.mjs` | Story chapter 1 completed, Replay chapter 5 s into the revelation: buses, ducks and holds in the replayed attempt | `out_s_replay.txt` |
| `s_replay_motif.mjs` | Replay pressed 1 s into the revelation, before the motif starts: the motif bus and the recording for 16 s | `out_s_replay_motif.txt` |
| `s_continue_off.mjs` | Narrative off, "Continue to chapter 2": buses and ducks in chapter 2 at +10 s and +30 s | `out_s_continue_off.txt` |
| `s_hidden_reveal.mjs`, `s_hidden_release.mjs` | The tab hidden 20 s during the revelation, then shown: the hold, the motif bus, the recording, and when the hold is released on the audio clock | `out_s_hidden_reveal.txt`, `out_s_hidden_release.txt` |
| `mix/music-balance.step.mjs` | The recorded music heard against the game's own master, ambience and effects buses, per Arcade level and chapter (20 s of context time from 16 s of play; BS.1770 with `src/audio/analysis.ts`) | `out_music_balance.txt`, `mix/music-balance-fix2.json` |
| `scripts/audio-e2e.mjs` | The committed driver's check lists of this round: R (R7 per moment, R10), S14, S1, S6, S11 and S11E | `e2e-R-S14.md`, `e2e-S14.md`, `e2e-S1-S6-S11-S11E.md` |

`rdriver.mjs`, `lib.mjs`, `lib2.mjs` and `mix/` are the review's own probes (written by the reviewers of the
first fix round), reused with the port changed and their evaluate timeouts cleared, so the before and after
numbers come from the same code. The "before" logs of the lifecycle and hidden-tab findings are the reviewers'
(quoted in AUDIO_RUNS.md), run on `f5b231e`.
