# The epilogue motif's bake: check lists

The `scripts/audio-e2e.mjs` check lists behind `docs/evidence/AUDIO_RUNS.md`, *Epilogue motif bake*. Each file is
the driver's `summary.md` for one run: the checks with their values, and the notes, which carry the bake's
timeline (wall seconds from chapter 9's start, the bank's pending count, the work per pace) and the frame times.
The per-scenario JSON (every window, every trace entry) stayed in the scratch folder and is not committed.

All runs: `node scripts/audio-e2e.mjs --serve --port 5199 --only <scenario>` from the worktree, Chrome 155
headless, 1280 × 720, Windows 11, seed 42, 2026-10-23 (times in the file names are UTC).

| File | Build | Run |
| --- | --- | --- |
| `before-S11E-0343.md` | `e4c9aba` plus the bake watcher in S11E (the driver only) | S11E: the race, the epilogue's motif never baked |
| `S11E-04-48.md`, `S11E-04-50.md`, `S11E-04-52.md` | final (`0df1324`) | S11E three times |
| `EPI-04-58.md`, `EPI-05-00.md` | final | EPI: the Revelation's frame time A/B and the worst case |
| `EPI-04-09-earlier-build.md`, `EPI-04-15-earlier-build.md` | the change without the Revelation's ask and without the set-aside bake; EPI's worst case started the epilogue 1 s after dropping its motif | EPI (the frame-time A/B is the same code path) |
| `S11E-throttle2-04-55.md`, `EPI-throttle2-05-03.md` | final, `--cpu-throttle 2` | a main thread twice as slow |
| `S11E-read60-throttle2-*.md` | final, and final with the Revelation's ask disabled for the run, `--cpu-throttle 2 --read-sec 60` | the value of the Revelation's ask on a slow machine |
| `S1-S12.md` | final | S1 (autoplay) and S12 (performance) |
