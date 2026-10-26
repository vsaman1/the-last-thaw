# The fix round's own measurements

The scripts behind the numbers in `docs/evidence/AUDIO_RUNS.md` (*After the open problems*) that
`scripts/audio-e2e.mjs` does not produce itself. Each needs the dev server (`--port 5199`, never 5173) unless
it reads `s4-hits.json`.

| File | What it measured | Run |
| --- | --- | --- |
| `s4-hits.json` | The played hits of S3 (bridge, requested levels) and S3E (engine, played levels) before the magnitude change, and of S3 after it, with its runs in order | data |
| `s4-counterfactual.mjs` | §4's candidate mappings on the hits played before the change (the bridge and engine columns of the table) | `node docs/evidence/audio/fix-round/s4-counterfactual.mjs` |
| `s4-heldout.mjs` | §4's split of the final S3 run by lane (the ±8 m lanes and the rest; not held out: S4M's sample, on which `jGate` was chosen, includes the ±8 m lanes) | `node docs/evidence/audio/fix-round/s4-heldout.mjs` |
| `bake-aggregate.mjs` | §1's tables: BAKE and BAKEOFF runs grouped by flow (load, play, bake time per pace, frame times, long tasks) | `node docs/evidence/audio/fix-round/bake-aggregate.mjs logs/audio` after `--only BAKE` and `--only BAKEOFF` runs |
| `first-click-profile.mjs` | §1's profile of the click that unlocks the audio (`new AudioContext()` 336 ms, the noise bank 114 ms, the IR 61 ms, the graph 47 ms) | `node docs/evidence/audio/fix-round/first-click-profile.mjs http://localhost:5199/ 1500` (Chrome's Windows path is in the script) |
| `bake-cost.step.mjs` | The main-thread cost of baking each sound and each level's set (why a level's collision sounds, about 60 ms, bake right after its strikes) | a step module for a minimal CDP driver that passes `{ evaluate, wait, log }` |
| `limiter-true-peak.step.mjs` | R4: full-band white noise at a 0 dBFS sample peak is +3.5 dBTP before the limiter and +0.79 after; band-limited at 16 kHz, +0.22 and −1.09 | the same kind of step module |

The S4M scenario of `scripts/audio-e2e.mjs` reproduces the "every collision" column of §4, and its R scenario
reports the white-noise burst next to the band-limited one.
