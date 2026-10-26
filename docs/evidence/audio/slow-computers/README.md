# Slow computers: check lists

The `scripts/audio-e2e.mjs` check lists behind `docs/evidence/AUDIO_RUNS.md`, *Slow computers*. Each file is the
driver's `summary.md` for one run: the checks with their values, and the notes (the bake's timeline in wall seconds
from chapter 9's start, the bank's pending count, the work per pace, the worker's renders, the frame times). The
per-scenario JSON stayed in the scratch folder and is not committed.

All runs: `node scripts/audio-e2e.mjs --serve --port 5399 --only <scenario> [--cpu-throttle 2] [--audio-worker off]`
from the worktree, Chrome 155 headless, 1280 × 720, Windows 11, seed 42, 2026-10-23 (times in the file names are
UTC). With `--cpu-throttle 2` the pages also get `?audioworkerslow=2` (the worker kept busy twice as long).

| File | Build | Run |
| --- | --- | --- |
| `before-S11E-throttle2-1017.md`, `before-EPI-1015.md` | `cd4357b` (before any change) | the problem, measured again |
| `S1-S13-1041.md` | the change | S1, and S13: every motif's hash on Chrome's main thread and in the worker, each render's time |
| `S11E-throttle2-1042.md`, `-1045.md`, `-1048.md` | the change | the target: S11E at 2x, the standard 20 s read |
| `S11E-1052.md`, `-1055.md`, `-1057.md` | the change | S11E at normal speed |
| `EPI-1123.md`, `EPIW-1125.md` | the change, the final driver | the worst case on the main thread (`?audioworker=off`) and with the worker; EPI's frame-time A/B |
| `EPI-throttle2-1115.md`, `EPIW-throttle2-1127.md` | the change, the final driver | the same at 2x |
| `S11E-throttle2-worker-off-1129.md` | the change, the final driver | S11E at 2x without the worker |
| `S1-S12-1103.md`, `S12-1132.md`, `S12-1139.md` | the change | S1; S12 (Arcade in play against `?audio=off`): the first S12 failed the other way (its `?audio=off` baseline ran at 30 frames a second, machine noise), the next two pass |
| `superseded-*.md` | the change, the driver before a fix | kept for the record: EPI with the five old extra renders (its A/B windows ran out of work: the render is cheaper), EPIW with the old on-time check and no drain at 2x, S11E without the worker read at the run's end (all four motifs played, the old check missed chapter 9's) |

"The change" is the app as committed; edits after the S11E runs touched comments only. The S11E runs before 11:29
used the driver before its chapter 9 check was moved after the moment's wait; their motifs were baked long before,
so the result is the same.
