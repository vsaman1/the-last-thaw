# audio-e2e, the fix round (2026-10-22)

The final run of every scenario on the integrated build (worktree `wf_aecc4ea7-0f1-4`), `node scripts/audio-e2e.mjs --url http://localhost:5199/ --only …`; Chrome 155.0.8059.86 headless, ANGLE D3D11, Windows 11 (10.0.26200), 1280 × 720, SEED 42. BAKE and BAKEOFF ran three times each, alternated, with 16 ms loading slices. "bridge" = the real 3D view playing into a recording engine; "engine" = the page's own audio; "physics" = audio off. Discussion: `docs/evidence/AUDIO_RUNS.md`, *After the open problems*.

**Total: 329 checks passed, 0 failed, 2 not applicable.**

| Scenario | Run (UTC) | Evidence | Pass | Fail | n/a | Wall s |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| S0 Clock sanity: the audio clock against the wall clock, a fired sound on the meter | 2026-10-22T17-24-27 | engine | 5 | 0 | 0 | 8 |
| S1 Autoplay: nothing before a gesture, unlock on the first click | 2026-10-22T17-24-27 | engine | 8 | 0 | 0 | 17 |
| S2 Arcade basics: K.545 under the effects, the fade on leaving | 2026-10-22T17-24-27 | engine | 8 | 0 | 0 | 23 |
| S3 Event coverage on every level, and magnitude in the wild (S4) | 2026-10-22T17-29-21 | bridge | 21 | 0 | 0 | 751 |
| S3E S3/S4 on the real engine: coverage, magnitude in the wild, mix replays (R11) | 2026-10-22T17-52-14 | engine | 30 | 0 | 0 | 804 |
| S4M The magnitude mapping against every collision of nine levels on five lines (audio off) | 2026-10-22T19-35-56 | physics | 2 | 0 | 0 | 658 |
| S5 Rapid collisions: fastForward bursts stay bounded | 2026-10-22T19-35-56 | bridge | 6 | 0 | 1 | 50 |
| S5E S5 on the real engine: fastForward bursts on the plant line; voices, master peak, drops | 2026-10-22T17-52-14 | engine | 7 | 0 | 0 | 57 |
| S6 Volume controls by keyboard, the M key, persistence | 2026-10-22T17-52-14 | engine | 29 | 0 | 0 | 26 |
| S7 Pause, rapid toggles and blur | 2026-10-22T17-24-27 | engine | 8 | 0 | 0 | 23 |
| S8 Leave, retry, level change: every attempt's sound ends | 2026-10-22T17-29-21 | bridge | 16 | 0 | 0 | 42 |
| S8E S8 on the real engine: Retry, level change, quit and leaving Story end every sound | 2026-10-22T18-18-43 | engine | 10 | 0 | 0 | 85 |
| S9 Hidden tab | 2026-10-22T17-24-27 | engine | 6 | 0 | 0 | 19 |
| S10 Church bells: every church rings, the hour, levels without a church | 2026-10-22T17-29-21 | bridge | 20 | 0 | 0 | 335 |
| S10E S10 on the real engine: every church level from the menu, strikes played or dropped | 2026-10-22T17-52-14 | engine | 20 | 0 | 0 | 343 |
| S11 Story moments: revelation, river view, ch8 card, ch9 chapel and sea, epilogue, narrative off | 2026-10-22T17-29-21 | bridge | 23 | 0 | 0 | 126 |
| S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue | 2026-10-22T17-52-14 | engine | 18 | 0 | 0 | 137 |
| CALVE The intro's calving (P1): full on the first attempt, the short beat on Retry | 2026-10-22T17-29-21 | bridge | 6 | 0 | 0 | 28 |
| S12 Performance | 2026-10-22T18-59-34 | engine | 3 | 0 | 0 | 402 |
| S13 Determinism: the same lab sequence twice; the bank checksum (R9) | 2026-10-22T17-24-27 | engine | 4 | 0 | 1 | 14 |
| R Offline renders (lab) | 2026-10-22T17-52-14 | engine | 25 | 0 | 0 | 100 |
| BAKE The level set from a cold start straight into play: bells, notReady drops, frame times | 2026-10-22T19-07-08 | engine | 16 | 0 | 0 | 268 |
| BAKE The level set from a cold start straight into play: bells, notReady drops, frame times | 2026-10-22T19-16-07 | engine | 16 | 0 | 0 | 268 |
| BAKE The level set from a cold start straight into play: bells, notReady drops, frame times | 2026-10-22T19-25-06 | engine | 16 | 0 | 0 | 267 |
| BAKEOFF The same flows with ?audio=off (the frame-time baseline) | 2026-10-22T19-11-38 | engine | 2 | 0 | 0 | 266 |
| BAKEOFF The same flows with ?audio=off (the frame-time baseline) | 2026-10-22T19-20-38 | engine | 2 | 0 | 0 | 266 |
| BAKEOFF The same flows with ?audio=off (the frame-time baseline) | 2026-10-22T19-29-36 | engine | 2 | 0 | 0 | 266 |

## S0 Clock sanity: the audio clock against the wall clock, a fired sound on the meter (2026-10-22T17-24-27)

- PASS the context runs after one click: `5`
- PASS the audio clock runs (currentTime advances; live meter windows are timed on it): `0.839` (want > 0.5)
- PASS the master meter sees a fired reference sound (hit.stone.heavy at -12 dBFS): `-14` (want > -30 dBFS)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: currentTime advances 0.839 s per wall second, under the design's 0.95: headless Chrome's audio clock is slow, so the meter windows in S2, S6, S11E and S8E are timed on the context clock, not the wall clock

## S1 Autoplay: nothing before a gesture, unlock on the first click (2026-10-22T17-24-27)

- PASS before any gesture: no AudioContext constructed: `{"contexts":0,"offline":0,"media":0,"active":false}` (want 0 and 0)
- PASS before any gesture: no music element: `0` (want 0)
- PASS after Escape (no activation): not running: `"locked"` (want != running)
- PASS after a click: running within 500 ms: `3` (want <= 500 ms)
- PASS one AudioContext: `1` (want 1)
- PASS the music was unlocked by the first click (K.545 plays in Arcade): `[{"file":"mozart-k545-allegro.mp3","volume":0.4765969408345689,"muted":false,"paused":false,"time":9.435443}]` (want K.545 playing)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S2 Arcade basics: K.545 under the effects, the fade on leaving (2026-10-22T17-24-27)

- PASS Arcade plays one recording: `1` (want 1)
- PASS it is the wonder cue (Mozart K.545): `"mozart-k545-allegro.mp3"` (want mozart-k545-allegro.mp3)
- PASS el.volume = 0.6 × 10^(−2/20) after the fade (Arcade sits 2 dB under the effects): `0.4765969408345689` (want 0.4766)
- PASS engine: cue wonder: `"wonder"` (want wonder)
- PASS engine: ambience bus above −50 dBFS RMS while playing (1 s window): `-33.05557013968486` (want > −50)
- PASS quitting to the menu: the music fades and pauses within 3.0–3.3 s: `3055` (want 3000–3300 ms)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S3 Event coverage on every level, and magnitude in the wild (S4) (2026-10-22T17-29-21)

- PASS 100 % of events end in the trace (played, merged, or dropped with a reason): `"1049/1049"` (want 100 %)
- PASS every traced event matches the run log's type: `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]`
- PASS hits play their kind's sound (KIND_SOUNDS): `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]`
- PASS at most 4 requests admitted per frame: `[2,2,2,4,2,2,3,3,3,2,3,2,2,2,2,3,2,3,1,1,2,3,1,1,4,2,1,1]`
- PASS at most 4 layers per request: `[2,2,1,4,3,3,3,2,4,4,2,4,4,3,3,3,3,2,3,3,3,3,1,1,2,1,1,1]`
- PASS Arcade: no narrative duck in any level (only pause, fail, dam): `["dam"]`
- PASS collision: at least one played request of its family: `"hit 67, scatter 1"`
- PASS obstacleBroken: at least one played request of its family: `"breakStructure 43, breakLight 7, dam 3, scatter 1, hit 67"`
- PASS treeFelled: at least one played request of its family: `"tree 13"`
- PASS splash: at least one played request of its family: `"splash 226"`
- PASS landed: at least one played request of its family: `"land 76, plunge 54"`
- PASS waterfallCrossed: at least one played request of its family: `"plunge 54"`
- PASS enteredOcean: at least one played request of its family: `"ocean 13"`
- PASS iceChipped: at least one played request of its family: `"chip 43, hit 67"`
- PASS absorbed: at least one played request of its family: `"absorb 48"`
- PASS S4 (bridge): Spearman ρ(impulse, requested level) of played hits >= 0.9: `{"rho":0.961,"n":67,"ci95":[0.925,0.975]}` (want >= 0.9)
- PASS S4 (bridge): within each hit sound, the requested level never falls as m rises: `{"sounds":7,"inverted":[]}`
- PASS S4 (bridge): every collapse >= the median small-rock hit + 12 dB: `{"lowestCollapse":-17.6,"what":"waterTower 1.3 t","smallRockMedian":-30.5,"collapses":45}` (want +12 dB)
- PASS S4 (bridge): the median break is above the 90th-percentile hit: `{"breakMedian":-14.3,"hitP90":-21.1,"breaks":65}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: event types seen: collision 137, splash 315, airborne 142, landed 141, waterfallCrossed 54, enteredOcean 13, complete 13, iceChipped 80, obstacleBroken 59, absorbed 67, treeFelled 13, failed 15
- note: sounds asked for: 36 ids (dam.break, glass.break, glass.pane, hit.ice, hit.masonry, hit.metal.heavy, hit.metal.panel, hit.stone.heavy, hit.stone.light, hit.wood, house.collapse, ice.absorb, ice.calve.crack, ice.chip, ice.land.ground, ice.land.water, ice.wallScrape, liquid.release, machine.winddown, masonry.collapse.large, masonry.collapse.small, metal.break.light, metal.break.structure, metal.break.vehicle, ocean.entry, splash.large, splash.medium, splash.small, stone.scatter, timber.break.light, timber.break.medium, timber.collapse, tree.fall.broadleaf, tree.fall.pine, water.plunge, weight.thump)
- note: S4 (bridge): ρ(impulse × closing speed, requested level) 0.936; ρ(m, requested level) 0.983

## S3E S3/S4 on the real engine: coverage, magnitude in the wild, mix replays (R11) (2026-10-22T17-52-14)

- PASS 100 % of events end in the engine trace (played, merged, or dropped with a reason): `"1040/1040"` (want 100 %)
- PASS >= 90 % of the events not dropped by a rate, cap or mask are played: `"782/782"` (want >= 90 %)
- PASS every traced event matches the run log's type: `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]`
- PASS hits play their kind's sound (KIND_SOUNDS): `[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]`
- PASS at most 4 requests admitted per frame: `[2,2,2,4,2,2,3,3,2,2,3,2,1,2,2,3,2,3,1,1,2,3,1,1,4,1,1,1]`
- PASS at most 4 layers per request: `[2,2,1,4,3,3,3,2,4,3,2,4,4,3,3,3,3,2,3,3,3,3,1,1,2,1,1,1]`
- PASS no request dropped as notReady (the set baked in time): `[]`
- PASS collision: at least one played sound of its family on the engine: `"hit 124, scatter 2"`
- PASS obstacleBroken: at least one played sound of its family on the engine: `"breakStructure 100, breakLight 16, dam 6, scatter 2, hit 124"`
- PASS treeFelled: at least one played sound of its family on the engine: `"tree 26"`
- PASS splash: at least one played sound of its family on the engine: `"splash 188"`
- PASS landed: at least one played sound of its family on the engine: `"land 76, plunge 54"`
- PASS waterfallCrossed: at least one played sound of its family on the engine: `"plunge 54"`
- PASS enteredOcean: at least one played sound of its family on the engine: `"ocean 13"`
- PASS iceChipped: at least one played sound of its family on the engine: `"chip 43, hit 124"`
- PASS absorbed: at least one played sound of its family on the engine: `"absorb 35"`
- PASS S4 (engine): Spearman ρ(impulse, requested level) of played hits >= 0.9: `{"rho":0.959,"n":62,"ci95":[0.919,0.975]}` (want >= 0.9)
- PASS S4 (engine): within each hit sound, the requested level never falls as m rises: `{"sounds":6,"inverted":[]}`
- PASS S4 (engine): every collapse >= the median small-rock hit + 12 dB: `{"lowestCollapse":-17.8,"what":"waterTower 1.3 t","smallRockMedian":-30.7,"collapses":45}` (want +12 dB)
- PASS S4 (engine): the median break is above the 90th-percentile hit: `{"breakMedian":-14.3,"hitP90":-20.4,"breaks":65}`
- PASS engine fidelity: every play = its request + jitter (± its family’s gainDb) + density (≤ 0) + distance: `{"plays":749,"outside":[],"maxUp":1.49,"maxDown":-5.32}`
- PASS S4 as played: rho(m, played gain at the source) >= 0.9 (the engine keeps the mapping’s order up to its jitter): `0.944` (want >= 0.9)
- PASS R11 riverside-town: master true peak <= -1 dBTP: `-9.37` (want <= -1)
- PASS R11 riverside-town: limiter reduction p99 <= 0.5 dB: `{"p99":0,"max":0,"lufsI":-25.2}` (want <= 0.5 dB)
- PASS R11 power-valley: master true peak <= -1 dBTP: `-9.23` (want <= -1)
- PASS R11 power-valley: limiter reduction p99 <= 0.5 dB: `{"p99":0,"max":0,"lufsI":-27.7}` (want <= 0.5 dB)
- PASS R11 highland-maze: master true peak <= -1 dBTP: `-13.46` (want <= -1)
- PASS R11 highland-maze: limiter reduction p99 <= 0.5 dB: `{"p99":0,"max":0,"lufsI":-28.5}` (want <= 0.5 dB)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: event types seen: collision 135, splash 304, airborne 144, landed 143, waterfallCrossed 54, enteredOcean 13, complete 13, iceChipped 80, obstacleBroken 59, absorbed 67, treeFelled 13, failed 15
- note: sounds played: 36 ids (dam.break 3, glass.break 1, glass.pane 5, hit.ice 39, hit.masonry 32, hit.metal.heavy 16, hit.metal.panel 16, hit.stone.heavy 11, hit.stone.light 16, hit.wood 36, house.collapse 20, ice.absorb 35, ice.calve.crack 28, ice.chip 59, ice.land.ground 102, ice.land.water 2, ice.wallScrape 10, liquid.release 6, machine.winddown 5, masonry.collapse.large 5, masonry.collapse.small 1, metal.break.light 2, metal.break.structure 11, metal.break.vehicle 2, ocean.entry 13, splash.large 7, splash.medium 34, splash.small 147, stone.scatter 1, timber.break.light 3, timber.break.medium 3, timber.collapse 4, tree.fall.broadleaf 3, tree.fall.pine 9, water.plunge 54, weight.thump 8)
- note: S4 (engine): over the held-out lines only (S4_LANES, not used to choose jGate): ρ 0.950, n 29; the other lines ρ 0.980, n 33
- note: S4 (engine): ρ(impulse × closing speed, requested level) 0.943; ρ(m, requested level) 0.983
- note: S4 as played (engine): n 62; rho(impulse, played gain at the source) 0.921 [bootstrap 95 % 0.862 to 0.947]; the requested levels alone 0.959; the requested levels with simulated ±1.5 dB jitter: mean 0.947 (5-95 % 0.935 to 0.959); rho(m, played at the source) 0.944; rho(impulse x speed, played at the source) 0.933

## S4M The magnitude mapping against every collision of nine levels on five lines (audio off) (2026-10-22T19-35-56)

- PASS S4M: the mapping in use orders every audible collision by impulse, ρ(J, level) >= 0.9: `{"rho":0.976,"audible":197}` (want >= 0.9)
- PASS …and by impulse × closing speed (the energy of the impact), ρ(J·v, level) >= 0.9: `{"rho":0.974,"audible":197}` (want >= 0.9)
- note: design: 0.75 ln(1+J)/ln 1501 + 0.25 min(1, v/25): 201 audible (3 silent); ρ(J, level) 0.965, ρ(J·v, level) 0.982; with ±1.5 dB jitter ρ(J) 0.956 (5 % 0.951)
- note: speed weight 0.10: 198 audible (6 silent); ρ(J, level) 0.992, ρ(J·v, level) 0.961; with ±1.5 dB jitter ρ(J) 0.982 (5 % 0.979)
- note: impulse only: 197 audible (7 silent); ρ(J, level) 0.995, ρ(J·v, level) 0.940; with ±1.5 dB jitter ρ(J) 0.985 (5 % 0.983)
- note: speed term gated by the impulse, J0 10: 197 audible (7 silent); ρ(J, level) 0.975, ρ(J·v, level) 0.977; with ±1.5 dB jitter ρ(J) 0.964 (5 % 0.960)
- note: speed term gated by the impulse, J0 20: 197 audible (7 silent); ρ(J, level) 0.976, ρ(J·v, level) 0.974; with ±1.5 dB jitter ρ(J) 0.966 (5 % 0.962)
- note: speed term gated by the impulse, J0 50: 197 audible (7 silent); ρ(J, level) 0.978, ρ(J·v, level) 0.972; with ±1.5 dB jitter ρ(J) 0.969 (5 % 0.965)
- note: energy: ln(1+Jv)/ln(1+1500*25): 199 audible (5 silent); ρ(J, level) 0.966, ρ(J·v, level) 0.989; with ±1.5 dB jitter ρ(J) 0.955 (5 % 0.950)
- note: 204 collisions over 33 runs with at least one
- note: collisionM in use at (J, v) = (2, 2), (10, 10), (0.4, 25), (2.1, 25), (4.6, 7.1), (160, 15): 0.12, 0.325, 0.062, 0.209, 0.217, 0.671

## S5 Rapid collisions: fastForward bursts stay bounded (2026-10-22T19-35-56)

- PASS fastForward bursts: at most 4 requests admitted in any frame: `4` (want <= 4)
- PASS the overflow is bounded and counted (ring overflow, frame cap): `{"frameCap":1,"masked":5}`
- PASS every request carries at most 4 layers: `3`
- PASS 100 % of events accounted for (ended or counted in the overflow): `"86+0/86"`
- n/a engine: active voices ≤ 24, master peak ≤ −1 dBFS: `null` (want the recording engine is installed in this run; measured on the real engine in S5E)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: 86 events; up to 10 events and 5 requests resolved in one frame; run ended complete

## S5E S5 on the real engine: fastForward bursts on the plant line; voices, master peak, drops (2026-10-22T17-52-14)

- PASS engine: never more than 24 effect voices: `8` (want <= 24)
- PASS engine: at most 4 requests admitted per frame: `4` (want <= 4)
- PASS engine: the master peak stays at or under -1 dBFS (no clipping): `-11.3` (want <= -1 dBFS)
- PASS engine: drops are counted by reason: `{"frameCap":1,"masked":5}`
- PASS engine: 100 % of events accounted for: `"85+0/85"`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: 85 events in 34 bursts of 3 s; drops {"frameCap":1,"masked":5}; master peak -11.3 dBFS, effects RMS -28.1 dBFS over the bursts

## S6 Volume controls by keyboard, the M key, persistence (2026-10-22T17-52-14)

- PASS Master volume: reached by Tab: `10` (want >= 0 presses)
- PASS Master volume: visible focus ring: `"solid 3px"` (want an outline)
- PASS Music volume: reached by Tab: `1` (want >= 0 presses)
- PASS Music volume: visible focus ring: `"solid 3px"` (want an outline)
- PASS Ambience volume: reached by Tab: `1` (want >= 0 presses)
- PASS Ambience volume: visible focus ring: `"solid 3px"` (want an outline)
- PASS Effects volume: reached by Tab: `1` (want >= 0 presses)
- PASS Effects volume: visible focus ring: `"solid 3px"` (want an outline)
- PASS engine: releasing Ambience previews a church bell from a cold start (the core keeps St Bride’s strike): `["preview -6/0/0 dB","preview ambience","preview -6/0/0 dB","preview effects"]`
- PASS engine: releasing Effects previews a stone hit: `["preview -6/0/0 dB","preview ambience","preview -6/0/0 dB","preview effects"]`
- PASS arrow keys set and save masterVolume: `0.8` (want 0.8)
- PASS arrow keys set and save musicVolume: `0.5` (want 0.5)
- PASS arrow keys set and save ambienceVolume: `0.6` (want 0.6)
- PASS arrow keys set and save effectsVolume: `0.5` (want 0.5)
- PASS sliders read out in percent: `["80 percent","50 percent","60 percent","50 percent"]`
- PASS Space on "Mute all sound" mutes: `true`
- PASS el.volume = master × music × 10^(−2/20): `0.3177312938897126` (want 0.3177)
- PASS engine: bus gains follow the settings: `{"master":0.8,"music":0.5,"ambience":0.6,"effects":0.5,"gate":1}` (want ambience 0.6, effects 0.5, master 0.8)
- PASS engine: the master meter hears the game before M: `-36.10109561886857` (want > −80)
- PASS M mutes all sound: the music stops at once (≤ 150 ms): `0` (want <= 150 ms)
- PASS M is announced in the live region: `"Sound off"`
- PASS M is saved: `true`
- PASS engine: master below −100 dBFS from 150 ms after M: `"-Infinity"` (want < −100)
- PASS M again: the music comes back: `0`
- PASS …announced "Sound on": `"Sound on"`
- PASS the settings persist across a reload: `{"masterVolume":0.8,"effectsVolume":0.5,"soundMuted":false}`
- PASS garbage settings load as defaults (or clamped): `{"masterVolume":1,"ambienceVolume":0,"effectsVolume":1,"soundMuted":false}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S7 Pause, rapid toggles and blur (2026-10-22T17-24-27)

- PASS Esc: the music dips 8 dB within 400 ms: `{"ms":199,"volume":0.18973665961010275}` (want 0.1897 in <= 400 ms)
- PASS …and the game is paused: `"paused"`
- PASS engine: effects and ambience gated (gate → 0 within 200 ms): `0` (want < 0.01)
- PASS resume: back to the play level within 0.8 s: `252` (want <= 800 ms)
- PASS 10 rapid Esc presses: a consistent end state (phase and music agree): `{"phase":"playing","music":[{"file":"mozart-k545-allegro.mp3","volume":0.4765969408345689,"muted":false,"paused":false,"time":16.689186}]}` (want playing: 0.4766)
- PASS window blur pauses like Esc (music at the pause level): `{"phase":"paused","music":[{"file":"mozart-k545-allegro.mp3","volume":0.18973665961010275,"muted":false,"paused":false,"time":18.050392}]}` (want 0.1897)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S8 Leave, retry, level change: every attempt's sound ends (2026-10-22T17-29-21)

- PASS recording engine installed in the page: `true`
- PASS play has one live session, Arcade, for the level: `[[1,"riverside-town",0.12],[2,"riverside-town",null]]`
- PASS the session asked for sounds: `{"plays":4,"bells":0}`
- PASS the scrape is driven by the iceberg's real speed (Pearson r, 10 Hz, real time): `{"r":1,"samples":48,"ground":["asphalt","grass"],"massT":98.21585467616741}` (want r >= 0.95)
- PASS R (retry): a new live session: `1095`
- PASS …and the old one ended with the 0.12 s fade: `{"ended":0.12,"live":1}`
- PASS nothing was admitted for the old session after its end: `{"before":5,"after":5}`
- PASS a level change ends the attempt's session: `[[1,"riverside-town",0.12],[2,"riverside-town",0.12],[3,"riverside-town",0.12],[4,"riverside-town",0.12],[5,"mountain-valley",null]]`
- PASS Arcade music continues across retry and level change (no cue null in between): `{"cue":"wonder","nulls":0}`
- PASS quitting to the menu ends the session and clears the cue: `{"live":0,"cue":null}`
- PASS every session ended, with the 0.12 s fade: `[[1,1,0.12],[2,1,0.12],[3,1,0.12],[4,1,0.12],[5,1,0.12]]`
- PASS Story: the chapter's cue on the card, in play and on the chapter list: `["cost","cost","cost"]`
- PASS Story ch4 play: the bed sits 2 dB under the card: `[-2,0]`
- PASS Story session ended on leaving: `{"token":6,"level":"riverside-town","mode":"story","chapter":"ch4-people","ended":0.12,"endCalls":1,"plays":2,"admitted":2,"bells":0,"ducks":[],"calve":[{"sound":"ice.calve.crack","gainDb":-16,"frame":25},{"sound":"ice.land.ground","gainDb":-18.2,"frame":46}]}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: StrictMode (dev): 2 sessions for the first attempt, 1 ended at once

## S8E S8 on the real engine: Retry, level change, quit and leaving Story end every sound (2026-10-22T18-18-43)

- PASS Riverside Town in play: the effects and ambience buses are sounding before anything is left: `{"ambience":-28.1,"effects":-25.8,"session":2}`
- PASS Retry: the old attempt’s session ended and nothing of it played afterwards: `{"ended":true,"end":"session 2 ends: 5 voices faded over 0.120 s","playsBefore":14,"after":0,"afterWhat":[]}`
- PASS Level change: the old attempt’s session ended and nothing of it played afterwards: `{"ended":true,"end":"session 4 ends: 0 voices faded over 0.120 s","playsBefore":4,"after":0,"afterWhat":[]}`
- PASS Quit to the menu: the session ended: `{"ended":true,"end":"session 5 ends: 3 voices faded over 0.120 s","playsBefore":12,"after":0,"afterWhat":[]}`
- PASS Quit to the menu: every bus below -90 dBFS RMS 300-600 ms (audio time) after leaving, no effect voice left: `{"master":"-Infinity","effects":"-Infinity","ambience":"-Infinity","voices":0,"session":null}`
- PASS Quit to the menu: nothing of the session played afterwards: `{"ended":true,"end":"session 5 ends: 3 voices faded over 0.120 s","playsBefore":12,"after":0,"afterWhat":[]}`
- PASS Leaving Story chapter 4 for the chapter list: every bus below -90 dBFS RMS 300-600 ms (audio time) after leaving, no effect voice left: `{"master":"-Infinity","effects":"-Infinity","ambience":"-Infinity","voices":0,"session":null}`
- PASS Leaving Story chapter 4: the session ended and nothing of it played afterwards: `{"ended":true,"end":"session 6 ends: 0 voices faded over 0.120 s","playsBefore":4,"after":0,"afterWhat":[]}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S9 Hidden tab (2026-10-22T17-24-27)

- PASS hidden tab: the music pauses at once: `0` (want <= 200 ms)
- PASS engine: suspended while hidden: `"suspended"`
- PASS the game paused itself too: `"paused"`
- PASS visible again: the music comes back (under the pause duck): `0`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S10 Church bells: every church rings, the hour, levels without a church (2026-10-22T17-29-21)

- PASS alpine-pass: pass-chapel rings: `5` (want > 0 strikes)
- PASS alpine-pass: the approach hour strikes three in Arcade (once per church): `["bell-hour p50 pass-chapel strokes=3 ds=201m"]`
- PASS alpine-pass: no run of strokes is a single stroke, none longer than 6 (never a toll): `[2,3]`
- PASS riverside-town: st-brides rings: `7` (want > 0 strikes)
- PASS riverside-town: the approach hour strikes three in Arcade (once per church): `["bell-hour p44 st-brides strokes=3 ds=202m"]`
- PASS riverside-town: no run of strokes is a single stroke, none longer than 6 (never a toll): `[2,3,2]`
- PASS highland-maze: clachan-kirk rings: `7` (want > 0 strikes)
- PASS highland-maze: loch-kirk rings: `6` (want > 0 strikes)
- PASS highland-maze: the approach hour strikes three in Arcade (once per church): `["bell-hour p4 clachan-kirk strokes=3 ds=257m","bell-hour p28 loch-kirk strokes=3 ds=345m"]`
- PASS highland-maze: no run of strokes is a single stroke, none longer than 6 (never a toll): `[4,3,3,3]`
- PASS summit-labyrinth: fjord-chapel rings: `5` (want > 0 strikes)
- PASS summit-labyrinth: the approach hour strikes three in Arcade (once per church): `["bell-hour p29 fjord-chapel strokes=3 ds=304m"]`
- PASS summit-labyrinth: no run of strokes is a single stroke, none longer than 6 (never a toll): `[2,3]`
- PASS mountain-valley has no church: no bell: `0` (want 0)
- PASS rocky-canyon has no church: no bell: `0` (want 0)
- PASS glacier-avalanche has no church: no bell: `0` (want 0)
- PASS power-valley has no church: no bell: `0` (want 0)
- PASS ravine-run has no church: no bell: `0` (want 0)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S10E S10 on the real engine: every church level from the menu, strikes played or dropped (2026-10-22T17-52-14)

- PASS alpine-pass: pass-chapel rings on the engine: `7` (want > 0 strikes played)
- PASS alpine-pass: no strike dropped as notReady: `0` (want 0)
- PASS alpine-pass: the approach hour strikes three in Arcade (once per church): `["bell-hour p50 pass-chapel strokes=3 ds=202m"]`
- PASS riverside-town: st-brides rings on the engine: `9` (want > 0 strikes played)
- PASS riverside-town: no strike dropped as notReady: `0` (want 0)
- PASS riverside-town: the approach hour strikes three in Arcade (once per church): `["bell-hour p44 st-brides strokes=3 ds=200m"]`
- PASS highland-maze: clachan-kirk rings on the engine: `4` (want > 0 strikes played)
- PASS highland-maze: loch-kirk rings on the engine: `6` (want > 0 strikes played)
- PASS highland-maze: no strike dropped as notReady: `0` (want 0)
- PASS highland-maze: the approach hour strikes three in Arcade (once per church): `["bell-hour p4 clachan-kirk strokes=3 ds=256m","bell-hour p28 loch-kirk strokes=3 ds=346m"]`
- PASS summit-labyrinth: fjord-chapel rings on the engine: `5` (want > 0 strikes played)
- PASS summit-labyrinth: no strike dropped as notReady: `0` (want 0)
- PASS summit-labyrinth: the approach hour strikes three in Arcade (once per church): `["bell-hour p29 fjord-chapel strokes=3 ds=310m"]`
- PASS mountain-valley has no church: no bell on the engine: `0` (want 0)
- PASS rocky-canyon has no church: no bell on the engine: `0` (want 0)
- PASS glacier-avalanche has no church: no bell on the engine: `0` (want 0)
- PASS power-valley has no church: no bell on the engine: `0` (want 0)
- PASS ravine-run has no church: no bell on the engine: `0` (want 0)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S11 Story moments: revelation, river view, ch8 card, ch9 chapel and sea, epilogue, narrative off (2026-10-22T17-29-21)

- PASS ch1 completes (the revelation opens): `"complete"`
- PASS M1: the music is held (reveal) at completion: `["reveal"]`
- PASS M1: "No. 14" (act1) asked for 4.0 s after: `[{"variant":"act1","tempoScale":1,"delaySec":4,"at":18,"stopped":null}]`
- PASS M1: the reading duck (music −6 dB) under the panel: `[{"key":"reading","on":true,"music":-6}]`
- PASS "View the river" swaps reading for the lighter readingRiver, and back: `[{"key":"reading","on":false,"music":null},{"key":"readingRiver","on":true,"music":-6},{"key":"readingRiver","on":false,"music":null},{"key":"reading","on":true,"music":-6}]`
- PASS toggling the river view twice adds no second motif: `1`
- PASS M1: the music is let back in after the motif and 4 s of quiet: `{"holds":[],"afterSec":22.5}`
- PASS M3: the ch8 card holds the music and asks for the ch8 motif at +1.2 s: `{"holds":["card"],"card":{"variant":"ch8","tempoScale":1,"delaySec":1.2,"at":42.67,"stopped":null}}`
- PASS M3: once per app session (a second visit plays nothing): `2`
- PASS M3: leaving the card early fades the motif (1.5 s) and lets the music in: `{"stopped":1.5,"holds":[]}`
- PASS ch9: the chapel falls silent, no strike after (both modes): `{"silenced":"bell-silenced p29 strikes=9","strikesAfter":0}`
- PASS ch9: the church moment lowers the music (church duck, −14 dB): `[{"key":"church","music":-14,"frame":3016}]`
- PASS ch9: one dull buried clank under the collapse, no toll: `1`
- PASS ch9: the approach hour strikes six in Story: `"bell-hour p29 fjord-chapel strokes=6 ds=465m"`
- PASS M7: the sea takes the music down in ch9 (seaCh9): `["act3Entry","landmark","scar","dam","dam","scar","aftermath","landmark","scar","church","scar","landmark","scar","seaCh9"]`
- PASS M8: Act III held the music until the caption (act3Entry hold, then the duck): `["hold act3Entry","hold act3Entry","release act3Entry"]`
- PASS ch9 revelation: the bare Act III motif: `{"variant":"act3-bare","tempoScale":1,"delaySec":4,"at":112.99,"stopped":null}`
- PASS M2: the epilogue holds the music and asks for the epilogue motif at +4.5 s: `{"holds":["epilogue"],"epi":{"variant":"epilogue","tempoScale":1,"delaySec":4.5,"at":113.77,"stopped":null}}`
- PASS M2: the revelation motif fades (1.5 s) when the epilogue begins: `[{"variant":"act1","tempoScale":1,"delaySec":4,"at":18,"stopped":1.5},{"variant":"ch8","tempoScale":1,"delaySec":1.2,"at":42.67,"stopped":1.5},{"variant":"act3-bare","tempoScale":1,"delaySec":4,"at":112.99,"stopped":1.5},{"variant":"epilogue","tempoScale":1,"delaySec":4.5,"at":113.77,"stopped":null}]`
- PASS M2: epilogueReading replaces reading: `[{"key":"reading","on":true,"music":-6},{"key":"reading","on":false,"music":null},{"key":"epilogueReading","on":true,"music":-8}]`
- PASS narrative off: no motif and no hold at completion (M1′): `{"motifs":0,"holds":[]}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S11E S11 on the real engine: the ch8 card, chapter 1 and chapter 9 motifs, the chapel, the epilogue (2026-10-22T17-52-14)

- PASS M3 (engine): the ch8 card plays the ch8 motif: `[[2.43,"motif","motif ch8@1: not baked"],[2.68,"motif","motif ch8@1 at +0.95 s, 18.4 s"]]`
- PASS M3 (engine): the motif is heard on the music bus (RMS > -40 dBFS): `-33.3` (want > -40)
- PASS ch1 completes: `"complete"`
- PASS M1 (engine): the recording is out (el.volume <= 0.001 or paused) by +3.1 s: `2904` (want <= 3100 ms)
- PASS M1 (engine): "No. 14" (act1) played, not skipped: `[[2.43,"motif","motif ch8@1: not baked"],[2.68,"motif","motif ch8@1 at +0.95 s, 18.4 s"],[6.51,"motif","motif stopped over 1.50 s"],[28.26,"motif","motif act1@1 at +4.00 s, 13.9 s"]]`
- PASS M1 (engine): the motif is heard on the music bus while it plays (RMS > -40 dBFS): `-34.3` (want > -40)
- PASS ch9 (engine): the chapel falls silent: no strike played after bell-silenced: `{"silenced":"bell-silenced p29 strikes=9","strikesAfter":0}`
- PASS ch9 (engine): the church duck lowers the music by 14 dB: `["church -14/-3/0 dB"]`
- PASS ch9 (engine): the approach hour strikes six in Story: `"bell-hour p29 fjord-chapel strokes=6 ds=460m"`
- PASS ch9 (engine): no strike dropped as notReady: `0` (want 0)
- PASS every duck asked for in ch9 lowers the music (<= 0 dB): `["act3Entry -12/0/0 dB","landmark -10/-2/0 dB","scar -0.75/0/0 dB","makeRoom -3/-4/0 dB","dam -10/0/0 dB","dam release","scar -1.5/0/0 dB","makeRoom -3/-4/0 dB","aftermath -8/0/0 dB","landmark -10/-2/0 dB","scar -2.25/0/0 dB","makeRoom -3/-4/0 dB","church -14/-3/0 dB","scar -3/0/0 dB","makeRoom -3/-4/0 dB","makeRoom -3/-4/0 dB","makeRoom -3/-4/0 dB","landmark -10/-2/0 dB","scar -3.75/0/0 dB","makeRoom -3/-4/0 dB"]`
- PASS ch9 (engine): the revelation motif act3-bare played: `[[6.51,"motif","motif stopped over 1.50 s"],[28.26,"motif","motif act1@1 at +4.00 s, 13.9 s"],[34.7,"motif","motif stopped over 1.50 s"],[102.88,"motif","motif act3-bare@1 at +4.00 s, 19.4 s"]]`
- PASS M2 (engine): the epilogue motif played: `[[102.88,"motif","motif act3-bare@1 at +4.00 s, 19.4 s"],[122.96,"motif","motif stopped over 1.50 s"],[122.96,"motif","motif epilogue@1 at +4.50 s, 34.2 s"]]`
- PASS M2 (engine): heard on the music bus (RMS > -40 dBFS): `-38.9` (want > -40)
- PASS story ducks never raise the music: the router’s duck product stayed <= 0 dB, every 100 ms over the ch8 card, ch1, ch9, the revelation and the epilogue: `{"samples":1208,"maxDuckDb":"0","maxTrimDb":"0"}`
- PASS …and no recording ever played above the sliders (el.volume <= master × music): `{"maxOverSlider":"0"}`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: ch9: bell-silenced p29 strikes=9; strikes played 9, clanks 1, notReady 0

## CALVE The intro's calving (P1): full on the first attempt, the short beat on Retry (2026-10-22T17-29-21)

- PASS the full intro ends in play: `19315`
- PASS full calving: groan, crack, landing, once each: `[{"sound":"ice.calve.groan","gainDb":-22,"frame":481},{"sound":"ice.calve.crack","gainDb":-16,"frame":526},{"sound":"ice.land.ground","gainDb":-18.2,"frame":571}]`
- PASS …at their fixed levels (−22, −16 dBFS; the landing at m 0.7 = −18.2): `[-22,-16,-18.2]`
- PASS Retry (the short beat): the crack and the landing only: `[{"sound":"ice.calve.crack","gainDb":-16,"frame":25},{"sound":"ice.land.ground","gainDb":-18.2,"frame":47}]`
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## S12 Performance (2026-10-22T18-59-34)

- PASS engine: frame() median ≤ 0.05 ms: `0`
- PASS engine: frame() p99 ≤ 0.3 ms: `0`
- PASS S12: median frame-time change <= 0.3 ms (rAF, high quality): `0.1` (want <= 0.3 ms)
- note: bank: {"ready":95,"pending":0,"bytes":14457600,"checksum":"4013dcb7"}
- note: S12 A/B (median of 4 runs each): audio on median 16.9 ms, p95 33.7, mean 24.775; ?audio=off median 16.8, p95 33.6, mean 24.215
- note: Headless Chrome on this laptop (Iris Xe and an RTX 3050 Laptop GPU; ANGLE D3D11 picks the GPU), not a visible window: frame pacing differs from a real session, and audio underruns cannot be observed headless.

## S13 Determinism: the same lab sequence twice; the bank checksum (R9) (2026-10-22T17-24-27)

- PASS the same seeded lab sequence twice (jitter and shuffled variants on): the same render within 0.001 dB, the same voice count: `{"maxDiffDb":0.0000012851476682840257,"voices":[19,19]}` (want <= 0.001 dB)
- PASS R9: two bank builds in this browser give the same checksum: `["74a0ca9e","74a0ca9e"]`
- n/a R9: the browser's checksum equals node's: `null` (want NODE_BANK_CHECKSUM not given (the node value is in docs/evidence/AUDIO_RUNS.md))
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])

## R Offline renders (lab) (2026-10-22T17-52-14)

- PASS engine: the core and the burst's sounds bake on the menu: `17816` (want >= 0 ms)
- PASS R1: hit loudness rises strictly with m: `[-55.6,-50.1,-44.8,-37.3,-32]`
- PASS R3: stress burst true peak ≤ −1 dBTP: `-8.001499649866332`
- PASS R3: no clipped samples: `0`
- PASS R3: at most 24 concurrent voices: `24` (want <= 24)
- PASS R1: break loudness rises strictly with M: `[-27.7,-25.3,-22.9,-20.5,-19.4]`
- PASS R1: hit ΔL(0.1 → 0.9) is 18–28 LU: `23.7`
- PASS R1: the low band (< 150 Hz) share rises with m (light at 0.1 against heavy at 0.9): `[0.025,0.0245,0.0245,0.2535,0.3422]`
- PASS R2: tap <= pine hit - 4 LU <= house collapse - 12 LU: `{"tap":-56.3,"pine":-51.1,"house":-25.4}`
- PASS R2: house + 3 LU <= dam break: `{"house":-25.4,"dam":-20}`
- PASS R2: nothing above -8 dBFS: `[-36.6,-29.9,-16,-10.8]`
- PASS R2: tap <= pine hit - 4 LU <= house collapse - 12 LU (after a 150 Hz high-pass): `{"tap":-55.6,"pine":-49.9,"house":-23.9}`
- PASS R2: house + 3 LU <= dam break (after a 150 Hz high-pass): `{"house":-23.9,"dam":-18.3}`
- PASS R4: a -20 dBFS sine through preMaster comes out at -20 ± 0.3 dBFS: `-20` (want -20 ± 0.3)
- PASS R4: a full-scale burst (band-limited at 16 kHz) comes out at <= -1 dBTP: `{"whole":-1.29,"fromPoint1s":-1.29,"samplePeak":-2.37}` (want <= -1)
- PASS R5: effects 0.5 vs 1.0 = -6.02 ± 0.05 dB: `-6.021`
- PASS R5: ambience 0 renders below -120 dBFS (a bell at 40 m): `"-240"` (want < -120 dBFS)
- PASS R5: mute all renders silence: `"-240"` (want < -120 dBFS)
- PASS R5: the pause gate reaches -60 dB within 0.25 s: `-214.9` (want <= -60 dB)
- PASS R6: a bell at 250 m is >= 12 LU below a house collapse at 30 m: `{"bell250":-38.3,"house30":-23.4}`
- PASS R6: a bell at 40 m peaks at <= -16 dBFS: `-18` (want <= -16)
- PASS R10: every recording measured (integrated loudness): `[-21.45,-19.8,-23.6,-32.41,-27.94,-29.53]`
- PASS R10: the recordings peak at or under 0 dBFS (music is outside the limiter): `[-2.64,-3.29,-3.14,-13.65,-9.05,-12.84]`
- PASS R7: the motifs' median at music 0.6 = the recordings' median at el.volume 0.6 − 3 ± 1 LU: `{"motifMedian":-33.22,"target":-33.21}`
- PASS R7: no clipping in the motif: `[0,0,0,0,0,0,0]`
- note: bank after the bake: {"ready":69,"pending":0,"bytes":23798676,"checksum":"d59b106d"}
- note: R1 breaks: one buffer at the levels the break law gives (rate 1, no low-pass): the gain law and the analysis, not a timbre change with M
- note: R1: spectral centroid by m: 961, 1121, 1297, 1049, 1109 Hz
- note: R4: full-band white noise at a 0 dBFS sample peak comes out at sample peak -2.52 dBFS but 0.88 dBTP: the noise itself carries about 3.5 dB of intersample peaks, and Chrome's DynamicsCompressorNode limits samples, not true peak (no oversampling)
- note: R4: a -6 dBFS noise burst comes out at -5.87 dBTP (-5.87 from 0.1 s); the R3 stress burst of game sounds at -8.00
- note: R10 mozart-k545-allegro.mp3: 2 ch, 48000 Hz, 133.9 s, peak -2.64 dBFS, -21.45 LUFS-I, max momentary -11.8
- note: R10 chopin-waltz-a-minor-b150.mp3: 2 ch, 48000 Hz, 130.7 s, peak -3.29 dBFS, -19.80 LUFS-I, max momentary -11.6
- note: R10 chopin-nocturne-e-minor-op72-1.mp3: 2 ch, 48000 Hz, 272.7 s, peak -3.14 dBFS, -23.60 LUFS-I, max momentary -13.6
- note: R10 beethoven-moonlight-adagio.mp3: 2 ch, 48000 Hz, 335.8 s, peak -13.65 dBFS, -32.41 LUFS-I, max momentary -24.3
- note: R10 schumann-the-poet-speaks.mp3: 2 ch, 48000 Hz, 164.8 s, peak -9.05 dBFS, -27.94 LUFS-I, max momentary -17.4
- note: R10 schumann-traumerei.mp3: 2 ch, 48000 Hz, 203.0 s, peak -12.84 dBFS, -29.53 LUFS-I, max momentary -21.5
- note: R7: recordings' median -25.77 LUFS-I at el.volume 1; the motifs' median before calibration -28.99 LUFS-I at music 1; calibration wanted 0.22 dB, in use 0.2
- note: R7 act1@1: -29.07 LUFS-I raw (peak -14.0); at music 0.6 calibrated -33.31 (peak -18.2), target -33.21
- note: R7 act1@0.94: -28.23 LUFS-I raw (peak -14.0); at music 0.6 calibrated -32.47 (peak -18.2), target -33.21
- note: R7 act2@1: -28.99 LUFS-I raw (peak -14.0); at music 0.6 calibrated -33.22 (peak -18.2), target -33.21
- note: R7 act3@1: -28.13 LUFS-I raw (peak -14.0); at music 0.6 calibrated -32.37 (peak -18.2), target -33.21
- note: R7 act3-bare@1: -28.71 LUFS-I raw (peak -14.0); at music 0.6 calibrated -32.95 (peak -18.2), target -33.21
- note: R7 ch8@1: -29.14 LUFS-I raw (peak -14.0); at music 0.6 calibrated -33.38 (peak -18.2), target -33.21
- note: R7 epilogue@1: -30.56 LUFS-I raw (peak -14.0); at music 0.6 calibrated -34.80 (peak -18.2), target -33.21
- note: R7: each variant against that target (LU): act1@1 -0.1, act1@0.94 0.7, act2@1 -0.0, act3@1 0.8, act3-bare@1 0.3, ch8@1 -0.2, epilogue@1 -1.6

## BAKE The level set from a cold start straight into play: bells, notReady drops, frame times (2026-10-22T19-07-08)

- PASS riverside-arcade: every bell strike asked for was played (none dropped as notReady): `{"played":7,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-arcade: the bell strike was baked before play began: `{"bell":0.02,"play":11.46}`
- PASS riverside-arcade: every sound and bell strike of the set baked by the end of the run: `{"sounds":14.63,"withMotifs":15.06}`
- PASS riverside-arcade: no sound dropped as notReady: `{}` (want 0)
- PASS riverside-arcade-instant: every bell strike asked for was played (none dropped as notReady): `{"played":7,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-arcade-instant: the bell strike was baked before play began: `{"bell":0.22,"play":5.04}`
- PASS riverside-arcade-instant: every sound and bell strike of the set baked by the end of the run: `{"sounds":16.29,"withMotifs":16.61}`
- PASS riverside-arcade-instant: no sound dropped as notReady: `{}` (want 0)
- PASS riverside-ch4: every bell strike asked for was played (none dropped as notReady): `{"played":10,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-ch4: the bell strike was baked before play began: `{"bell":0.08,"play":5.3}`
- PASS riverside-ch4: every sound and bell strike of the set baked by the end of the run: `{"sounds":1.05,"withMotifs":22.2}`
- PASS riverside-ch4: no sound dropped as notReady: `{}` (want 0)
- PASS power-valley: every sound and bell strike of the set baked by the end of the run: `{"sounds":0.31,"withMotifs":0.31}`
- PASS power-valley: no sound dropped as notReady: `{}` (want 0)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: riverside-arcade: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: riverside-arcade-instant: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: power-valley: the main menu's Play reads "PlayLevel 6 · Power Valley"

## BAKE The level set from a cold start straight into play: bells, notReady drops, frame times (2026-10-22T19-16-07)

- PASS riverside-arcade: every bell strike asked for was played (none dropped as notReady): `{"played":7,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-arcade: the bell strike was baked before play began: `{"bell":0.02,"play":11.37}`
- PASS riverside-arcade: every sound and bell strike of the set baked by the end of the run: `{"sounds":14.32,"withMotifs":14.83}`
- PASS riverside-arcade: no sound dropped as notReady: `{}` (want 0)
- PASS riverside-arcade-instant: every bell strike asked for was played (none dropped as notReady): `{"played":7,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-arcade-instant: the bell strike was baked before play began: `{"bell":0.32,"play":5.32}`
- PASS riverside-arcade-instant: every sound and bell strike of the set baked by the end of the run: `{"sounds":16.81,"withMotifs":17.23}`
- PASS riverside-arcade-instant: no sound dropped as notReady: `{}` (want 0)
- PASS riverside-ch4: every bell strike asked for was played (none dropped as notReady): `{"played":10,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-ch4: the bell strike was baked before play began: `{"bell":0.08,"play":5.59}`
- PASS riverside-ch4: every sound and bell strike of the set baked by the end of the run: `{"sounds":1.09,"withMotifs":25.14}`
- PASS riverside-ch4: no sound dropped as notReady: `{}` (want 0)
- PASS power-valley: every sound and bell strike of the set baked by the end of the run: `{"sounds":3.54,"withMotifs":3.54}`
- PASS power-valley: no sound dropped as notReady: `{}` (want 0)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: riverside-arcade: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: riverside-arcade-instant: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: power-valley: the main menu's Play reads "PlayLevel 6 · Power Valley"

## BAKE The level set from a cold start straight into play: bells, notReady drops, frame times (2026-10-22T19-25-06)

- PASS riverside-arcade: every bell strike asked for was played (none dropped as notReady): `{"played":7,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-arcade: the bell strike was baked before play began: `{"bell":0.03,"play":11.44}`
- PASS riverside-arcade: every sound and bell strike of the set baked by the end of the run: `{"sounds":15.87,"withMotifs":16.66}`
- PASS riverside-arcade: no sound dropped as notReady: `{}` (want 0)
- PASS riverside-arcade-instant: every bell strike asked for was played (none dropped as notReady): `{"played":7,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-arcade-instant: the bell strike was baked before play began: `{"bell":0.33,"play":5.26}`
- PASS riverside-arcade-instant: every sound and bell strike of the set baked by the end of the run: `{"sounds":20.01,"withMotifs":20.34}`
- PASS riverside-arcade-instant: no sound dropped as notReady: `{}` (want 0)
- PASS riverside-ch4: every bell strike asked for was played (none dropped as notReady): `{"played":10,"notReady":0,"cap":0}` (want played > 0, notReady 0)
- PASS riverside-ch4: the bell strike was baked before play began: `{"bell":0.09,"play":5.24}`
- PASS riverside-ch4: every sound and bell strike of the set baked by the end of the run: `{"sounds":3.9,"withMotifs":25.54}`
- PASS riverside-ch4: no sound dropped as notReady: `{}` (want 0)
- PASS power-valley: every sound and bell strike of the set baked by the end of the run: `{"sounds":0.34,"withMotifs":0.34}`
- PASS power-valley: no sound dropped as notReady: `{}` (want 0)
- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: riverside-arcade: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: riverside-arcade-instant: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: power-valley: the main menu's Play reads "PlayLevel 6 · Power Valley"

## BAKEOFF The same flows with ?audio=off (the frame-time baseline) (2026-10-22T19-11-38)

- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: riverside-arcade: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: riverside-arcade-instant: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: power-valley: the main menu's Play reads "PlayLevel 6 · Power Valley"

## BAKEOFF The same flows with ?audio=off (the frame-time baseline) (2026-10-22T19-20-38)

- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: riverside-arcade: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: riverside-arcade-instant: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: power-valley: the main menu's Play reads "PlayLevel 6 · Power Valley"

## BAKEOFF The same flows with ?audio=off (the frame-time baseline) (2026-10-22T19-29-36)

- PASS no "AudioContext was not allowed to start" warning: `0` (want 0)
- PASS no audio errors in the console: `[]` (want [])
- note: riverside-arcade: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: riverside-arcade-instant: the main menu's Play reads "PlayLevel 4 · Riverside Town"
- note: power-valley: the main menu's Play reads "PlayLevel 6 · Power Valley"
