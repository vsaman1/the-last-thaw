# Sound: browser runs

`scripts/audio-e2e.mjs` drives the real game (Vite dev server, headless Chrome with real WebGL) over the
DevTools protocol and checks by number what the sound does (`docs/AUDIO_DESIGN.md` §11, `docs/AUDIO.md`).
This file records the run on package C's branch, before package A's engine and package B's synthesis were
installed, (*Integrated smoke run*) the first runs after the three packages were merged, and (at the end, *After
the open problems*) the fix round: every scenario on the integrated build. The full check list of that run is `audio/e2e-2026-10-22T13-01-21.md` (with its `.json`); the raw
per-scenario JSON stays under `logs/audio/` (git-ignored).

**Run:** 2026-10-22 13:01–13:20 UTC; the app at commit `e3cc607` of `worktree-wf_aecc4ea7-0f1-3`, the driver
as committed with this file; `node scripts/audio-e2e.mjs --serve --port 5299`; Chrome 155.0.8059.86,
`--headless=new --mute-audio --autoplay-policy=document-user-activation-required`, ANGLE D3D11, Windows 11
(10.0.26200), 1280 × 720; profile seeded with Story AI off, narrative on, every level unlocked, intros
skipped (except where stated), quality low; SEED 42.

## Two kinds of evidence

- **engine**: what the page itself did. The music's real media elements (wrapped before any page script) give
  the file, `volume`, `muted` and `paused` of every recording. Checks that need package A's
  `window.__icebergAudio` (bus gains, meters, voices, offline renders) were **not measurable** on this branch and
  are reported as n/a, never as passes.
- **bridge**: a recording engine (`src/audio/game/testing/recording.ts`) installed in the page, so the real 3D
  view's sound bridge played into a recorder. It proves what was asked for (every request with its layers,
  level and cause; every bell, duck, hold and motif), joined to the run's own event log. It does not prove how
  anything sounds.

## Result

| Scenario | Evidence | Pass | Fail | n/a |
| --- | --- | ---: | ---: | ---: |
| S1 Autoplay | engine | 6 | 0 | 2 |
| S2 Arcade music | engine | 6 | 0 | 1 |
| S3 Event coverage on all nine levels, with S4 magnitude in the wild | bridge | 19 | **1** | 0 |
| S5 Rapid collisions (fastForward bursts) | bridge | 6 | 0 | 1 |
| S6 Volume controls by keyboard, M, persistence | engine | 24 | 0 | 1 |
| S7 Pause, rapid toggles, blur | engine | 7 | 0 | 1 |
| S8 Leave, retry, level change | bridge | 16 | 0 | 0 |
| S9 Hidden tab | engine | 5 | 0 | 1 |
| S10 Church bells | bridge | 20 | 0 | 0 |
| S11 Story moments | bridge | 23 | 0 | 0 |
| CALVE The intro's calving | bridge | 6 | 0 | 0 |
| S12 Performance | engine | 0 | 0 | 1 |
| R Offline renders | engine | 0 | 0 | 1 |
| **Total** | | **138** | **1** | **10** |

The driver exits 1 because of the one failure below.

## What the numbers show

**Autoplay (S1).** Before any gesture: no `AudioContext` or `OfflineAudioContext` constructed, no music element.
After one trusted click the music was unlocked: entering Arcade play started K.545 with no further gesture. No
"AudioContext was not allowed to start" warning, no audio errors in the console in any scenario.

**Arcade music (S2).** One recording plays, `mozart-k545-allegro.mp3`, at `el.volume` 0.4766 = 0.6 × 10^(−2/20)
(2 dB under the effects). Leaving for the menu, it faded and paused in 3,024 ms (the player's 3 s fade).

**Controls (S6).** Every Sound slider reached with Tab, with a visible 3 px focus outline; arrow keys set and
saved master 0.8, music 0.5, ambience 0.6, effects 0.5, read out as "80 percent" … ; Space on *Mute all sound*
toggled it. In play `el.volume` = 0.8 × 0.5 × 10^(−2/20) = 0.3177. **M** stopped the music in the same 10 ms
sample, said "Sound off" in the live region and saved it; M again brought it back ("Sound on"). The settings
survived a reload; garbage values (`"loud"`, −3, 7, `"yes"`) loaded as 1, 0, 1 and false.

**Pause and hidden tab (S7, S9).** Esc dipped the music to exactly 0.1897 (−8 dB) in the first sample; resume
restored 0.4766; ten Esc presses 100 ms apart ended consistent (playing, 0.4766); a window blur paused like Esc. A
hidden tab paused the music at once and the game paused itself; visible again, the music came back under the
pause dip.

**Leaving (S8).** One live session per attempt (the dev build's StrictMode makes a second one that is ended at
once). Retry, a level change and quitting each ended the attempt's session with the 0.12 s fade; nothing was
admitted for an ended session afterwards. Arcade's cue stayed `wonder` across Retry and the level change with no
`null` in between; quitting cleared it. Story kept the chapter's cue (`cost`) on the card, in play (bed −2 dB)
and on the chapter list. The scrape followed the iceberg's own horizontal speed with Pearson r = 1.000 over 47
samples at 10 Hz in real time (98 t iceberg, asphalt and grass).

**Coverage (S3)**, all nine Arcade levels to completion on the autopilot at 3× speed: **535 / 535 events** ended in
the trace (played, merged, or dropped with a reason: 15 `masked` chips under hard hits, 4 `quiet` touches), every
traced event matched the log's type, every hit played its kind's sound (`KIND_SOUNDS`), at most 4 requests were
admitted in a frame and 4 layers in a request, and no Arcade level asked for a narrative duck (only `dam`). 30
different sound ids were asked for. Event types seen: collision 51, splash 171, airborne 69, landed 69,
waterfallCrossed 31, enteredOcean 9, complete 9, iceChipped 29, obstacleBroken 32, absorbed 67. **Not reached** by
these autopilot lines: `treeFelled` and the stone barrier's scatter; those rules are covered by
`router.test.ts`, not by this run.

**Magnitude in the wild (S4)**, 24 played hits and 27 breaks:
- **FAIL: Spearman ρ(impulse, gain) = 0.897**, the design's threshold being 0.9 (0.886 and 0.879 in two earlier
  runs). The model is not broken: within each hit sound the gain never fell as m rose (6 sounds, 0 inversions),
  and ρ over stone hits alone is 1.000. Impulse alone cannot order the gains because m deliberately weighs the
  closing speed as well (a fence grazed at 25.2 m/s with J = 2.1 plays at m 0.37, −29.4 dBFS, above a car
  pushed at 7.1 m/s with J = 4.6, m 0.25, −33.6) and the sounds have different reference levels; ρ(m, gain) =
  0.961. Either the threshold or the speed weight
  needs a decision; neither was changed here.
- Every collapse (an add-on body of an already-broken church excluded) peaked at or above −17.5 dBFS, at least
  12 dB over the small-rock hit (−30.1); the median break (−13.8) sits above the 90th-percentile hit (−19.6). The
  quietest hit was a chalet touch at −35.2, the loudest break a dam at −8.1.

**Rapid collisions (S5).** Power Valley's plant line in 3 s `fastForward` chunks (180 fixed steps a frame): up to
10 events and 5 requests resolved in one frame, 4 admitted (the fifth dropped as `frameCap`), every request ≤ 3
layers, 84 / 84 events accounted for.

**Church bells (S10)**, Arcade at 2× speed: every church rang (pass chapel 5 strikes, St Bride's 7, Clachan kirk
7, lochside kirk 6, fjord chapel 5); each approach hour struck **three**, once per church, 200–343 m before the
church; every run of strokes had 2 to 4 strokes (never one, never more than six). The five levels without a
church: 0 bell requests.

**Story moments (S11)**, chapters 1, 8 and 9 with narrative on:
- Chapter 1 completed: the music was held (`reveal`) and *No. 14* (`act1`) asked for 4.0 s later (a human
  document had surfaced), with the reading duck (−6 dB). "View the river" twice swapped it for the lighter
  river-view level and back, with no second motif. 22.5 s later the hold was gone (the music let back in).
- Chapter 8's card: held, the `ch8` motif at +1.2 s; a second visit played nothing; leaving early faded it (1.5
  s) and released the hold.
- Chapter 9 at 2× speed: the fjord chapel's approach hour struck **six**; the chapel fell on the default line,
  `bell-silenced p29 strikes=9`, zero strikes after, one buried clank, and the `church` duck (−14 dB). Act III's
  late entry (hold, release at the caption, then the entry duck), landmark, scar, aftermath, dam and finally
  `seaCh9` ducks were all asked for. The revelation asked for `act3-bare`; the epilogue then held the music,
  asked for the `epilogue` motif at +4.5 s, faded the revelation motif (1.5 s) and set `epilogueReading`.
- Narrative off, chapter 1 again: no motif and no hold, only the reading level.

**Calving (CALVE, P1).** The first attempt's full intro asked for the groan (−22 dBFS), the crack (−16) and the
landing (−18.2, m 0.7), once each; Retry's short beat asked for only the crack and the landing.

## Not measured here

- Everything inside package A's engine and package B's synthesis: bus gains and meters, the pause gate, voice
  counts and stealing, the limiter, true peak, loudness, the motif's and the bells' rendering (S0, S12, S13, R1–R11
  of the design). The driver has those checks and runs them once `window.__icebergAudio` exists.
- Whether any of it sounds right. Nobody has listened to it (`docs/AUDIO.md`, *What only a human ear can judge*).

## Reproduce

```
node scripts/audio-e2e.mjs --serve            # its own dev server on port 5199 (never 5173), about 20 minutes
node scripts/audio-e2e.mjs --serve --quick    # fewer levels in S3 and S10
node scripts/audio-e2e.mjs --url http://localhost:5199/ --only S2,S6,S11
```

## Integrated smoke run (2026-10-22, after the merge)

The three packages merged and wired (`docs/AUDIO.md`, *Integration*), on a dev server at port 5199 with its own
dependency cache; the same Chrome 155, headless, ANGLE D3D11, 1280 × 720, profile seeded as above. Two kinds of run:

- **Smoke steps** over the DevTools protocol on the real app and the real engine (no recording engine), reading
  `window.__icebergAudio` (state, trace, meter, lab, player) and the stores. Ad hoc (not committed): four step
  files, about 14 minutes in all.
- **`scripts/audio-e2e.mjs`** on the integrated build: S1, S2, S5–S11, CALVE and R (`--quick`), then S2, S6 and R
  again after the driver's fixes below. S3/S4 (all nine levels) and S12 (the real laptop) were not run.

Headless Chrome ran the audio clock at roughly 0.6× wall time here; timings below are on the audio clock where they
say so. Nothing was listened to.

### (a) Audio starts only after a gesture

| When | Engine |
| --- | --- |
| Page loaded, no gesture | `status` locked, no context (`sampleRate` 0), the music player not unlocked and no voice; the only trace entry is `trace on: SEED 42, Web Audio` |
| After Escape (no user activation) | still locked, no context, gesture listeners still armed |
| After one click | `running` at 48,000 Hz, listeners disarmed; trace: `graph built: 152 nodes`, `context starting: gesture`, `context running` |
| Core bake on the menu | 48 buffers, 5,228,800 bytes, checksum `26dbb94c`, in 2.6 s |

e2e S1: 8/8 (0 `AudioContext` and 0 `OfflineAudioContext` constructed before a gesture, one after, running within
500 ms, K.545 unlocked by that click, no "not allowed to start" warning).

### (b) Arcade: music, river and wind, impact-scaled sounds

**Riverside Town, autopilot, real time** (sampled once a second for 20 s):
- Music: cue `wonder`, one voice playing, `el.volume` 0.4766 = 0.6 × 10^(−2/20).
- B's ambience voices were built on the session's own gains and fed by C every frame: the river's input level rose
  with the river (0.11 → 0.87, flow 4.9 → 11.2 m/s) and B's babble gain target with it (0.053 → 0.426); wind amount
  0.4 (level target 0.213, 0.384 while airborne at 16.8 m/s); the scrape at the iceberg's speed (7 → 18.8 m/s, 90 t,
  grass and asphalt).
- Meters (1 s windows, over two runs): ambience −27 to −40 dBFS RMS, effects −24 to −38, master −22 to −36; master
  peaks −9 to −22 dBFS (no clipping).
- 51 events, 51 trace entries; played: four house collapses at −14.0, −17.1, −17.5 and −21.2 dB (the break level
  from the mass), splashes, landings, the plunge, a chip, the calving's crack and landing.

**Power Valley, its set baked first, autopilot plus 8 × 5 s `fastForward`**: hits played at a level that follows the
impact (`gainDb` includes the distance):

| m | Sound | Played | Distance |
| --- | --- | --- | --- |
| 0.25–0.26 (four hits) | `hit.metal.panel` | −32.0 to −36.0 dB | 31–32 m |
| 0.70–0.76 | `hit.metal.heavy` | −20.0 to −27.3 dB | 30–60 m |
| 0.82–0.84 | `hit.metal.heavy`, `hit.masonry` (layer 0 of a break) | −22.2 to −25.4 dB | 76–82 m |
| 0.90 | `hit.masonry` (layer 0 of a break) | −14.8 dB | 20 m |

Breaks: `masonry.collapse.large` −10.3 dB at 20 m, `metal.break.structure` −11.7 at 30 m and −17.2 to −18.6 at
60–82 m, with `machine.winddown` and `liquid.release` layers. Headless, with the real bank and engine on a fake
context, `packages.integration.test.ts` gives Spearman ρ(m, played level) = 0.893 and more than 8 dB (11 in that
run) between the taps (m < 0.3) and the knocks (m > 0.7).

e2e S2: 8/8 (ambience bus −33.9 dBFS RMS over 1 s). e2e R (the lab with B's analysis): R1 stone ladder at m 0.1 …
0.9 = −55.1, −49.9, −44.7, −39.5, −34.3 LUFS momentary max (20.8 LU, inside the design's 18–28); R3 burst (200
collisions, 20 breaks, 40 splashes in 2 s) true peak −8.0 dBTP, 0 clipped samples. Lab renders at the design's
levels: light tap −54.3 LUFS-M, heavy stone hit −38.1, house collapse −23.4 (−27.0 integrated), large masonry
collapse −22.6.

### (c) A Story chapter

Chapter 4 (Riverside Town): cue `cost`, bed −2 dB, `el.volume` 0.4766; 15 sounds played (four house collapses, the
calving, splashes, landings, a chip); the landmark duck (−10 dB) and the scar (−0.5 dB a loss, to −2 dB) took the
recording to 0.168; St Bride's approach hour asked for with **six** strokes. The motif on the engine: `act2` (19.5 s,
baked with chapter 4's set) played on the music bus at −18.4 to −30.9 dBFS peak per second with music at 0.6 (the
design's −14 dBFS at 1.0), and `stopMotif(1.5)` left silence. e2e S11 (bridge): 23/23.

### (d) Pause gates effects and ambience

Esc: phase paused, the gate's scheduled value and its AudioParam both 0, the master meter silent while the sources
kept running (the pre-gate ambience tap still read −27.3 dBFS), music −8 dB (0.1897). Esc again: gate 1, the duck
released, 0.4766. e2e S7: 8/8 (gate under 0.01 within 200 ms; −8 dB in 132 ms; back in 258 ms; ten rapid presses
consistent; a blur pauses like Esc). e2e S9: 6/6 (a hidden tab suspends the context and pauses the music).

### (e) Leaving and switching level stop everything

| Action | The old attempt's ambience sources ended | Its one-shots and bells gone (audio time) | Plays after `end()` |
| --- | --- | --- | --- |
| Retry | 43 / 43 | none were live | 0 |
| Level change | 35 / 35 | `end()` one frame (0.163 s) after the store change, everything gone at 0.275 s | 0 |
| Arcade → Story chapter | 27 / 27 | 0.248 s | 0 |
| Quit to the menu | 43 / 43 | none were live | 0 |

On the menu: no session, 0 voices, every bus meter silent over 1.5 s; the music cue null and both recordings paused
at level 0 within 3.5 s. (A first measurement of the level change read 2.1 s because its polling was starved while
the next level compiled its shaders; the per-frame measurement in the table replaces it.) e2e S8: 16/16.

### (f) Church bells

St Bride's (Riverside Town) is scheduled in both modes: a background phrase of four strokes, then the approach hour,
**three** strokes in Arcade (`bell-hour p44 st-brides strokes=3 ds=259m`) and **six** in Story. With the level's set
baked before play, all seven strikes played and none was dropped. e2e S10 (bridge, `--quick`): 10/10; S11: the
chapter 9 chapel fell silent mid-count, one buried clank, no strike after.

**Open: the bake comes too late in the normal Arcade flow.** The director asks for a level's sounds when the level is
chosen, and the bank bakes them in idle-time slices. With the game loading and then running, headless Chrome took
**47.7 s** to bake Riverside Town's set (play began at 13.2 s); every strike of St Bride's first phrase and of its
approach hour came before that and was dropped as `notReady` (silent), and Power Valley's first metal hits likewise
(6 `notReady` drops). On an idle menu the same set bakes in 9.2 s (Power Valley's in 4.2 s). Options for the lead:
bake the strike before the level's other sounds, bigger slices during the loading screen, bake on the level-select
screen, or a worker; and measure it on the real laptop.

### Fixed during these runs

- The approach hour was traced on every frame while it waited for a phrase to end (40 entries in one chapter 4
  run); it is now traced once (`bells.ts`).
- The driver's S2 and S6 meter reads could pass or fail by accident (the meter starts at its first call, and digital
  silence does not cross CDP); R rendered before the core had baked. All three fixed in `scripts/audio-e2e.mjs`.

### e2e totals on the integrated build

| Scenario | Pass | Fail | n/a |
| --- | ---: | ---: | ---: |
| S1 | 8 | 0 | 0 |
| S2 (after the fix) | 8 | 0 | 0 |
| S5 | 7 | 0 | 0 |
| S6 (after the fix) | 27 | 0 | 0 |
| S7 | 8 | 0 | 0 |
| S8 | 16 | 0 | 0 |
| S9 | 6 | 0 | 0 |
| S10 (`--quick`) | 10 | 0 | 0 |
| S11 | 23 | 0 | 0 |
| CALVE | 6 | 0 | 0 |
| R (after the fix) | 4 | 0 | 0 |

The bridge scenarios (S5, S8, S10, S11, CALVE) install the recording engine in the page, so their "engine" lines
(S5's voice count of 0, for one) describe that recorder, not the real engine. Not run: S3/S4 on all nine levels, S12.

## After the open problems (2026-10-22, the fix round)

The integrated smoke run left these open: the level set baked too late, so St Bride's strikes were dropped;
the Ambience preview was silent from a cold start; `MOTIF_CALIB_DB` was 0; S4's ρ was 0.897 against 0.9;
S3/S4 and S12 had not run. This round fixed them and ran every browser scenario of `AUDIO_DESIGN.md` §11 on
the integrated build.

**Setup.** The same laptop (13th-gen Core i7-1355U, Intel Iris Xe and an RTX 3050 Laptop GPU), Chrome 155
`--headless=new --mute-audio --autoplay-policy=document-user-activation-required`, ANGLE D3D11, 1280 × 720; a
dev server on port 5199 with its own dependency cache and no HMR or file watching (an edit never reaches a page
under test; the server was restarted after every engine change, and every number below comes from the build
that was then current); profiles seeded as above; SEED 42. **Headless Chrome's audio clock runs at 0.84 s per
wall second here** (S0), so every live meter window is timed on the context clock. Nothing was listened to. The
check lists of the final runs: `audio/e2e-2026-10-22-fix-round.md` (and `.json`): **329 checks passed, 0
failed, 2 not applicable**. The last two engine changes (the space's return, `6170b2b`, and the 16 ms loading
slices, `3d27493`) act only after an attempt ends and behind the loading overlay: S0, S1, S2, S3, S3E, S5E, S6,
S7, S8, S9, S10, S10E, S11, S11E, CALVE, S13 and R ran before both; S8E and S12 after the first; S4M, S5, BAKE and BAKEOFF after both.
S0–S2, S7, S9 and S13 overlapped with the bridge runs of S3–S11 by a queueing slip (two browsers at once); their
timing checks passed with room to spare.

Commits, in order: `87cc17e`, `70945d2`, `c7d15f3`, `793a0f1`, `2fe63e2`, `8a1fa54` (the first attempt at this
round, interrupted by a usage limit), `dedca83` (its work in progress, finished in `d728355`), then `a106a76`,
`45c0f90`, `623699b`, `6c6cb55`, `6170b2b`, `d728355`, `3d27493`, `76c43fc` and the documentation.

### 1. The level set bakes in time

**What changed.**
- The bank bakes without an AudioContext (none may exist before a gesture), so the director asks for the set
  of the level most likely next as soon as it is known, before any gesture: the main menu's Play level, the
  focused or hovered level card (held 200 ms), the Story menu's next chapter, the chapter card, the game.
  Retry keeps the set; a new set replaces the old by difference (`70945d2`, `c7d15f3`).
- Order (`87cc17e`, `a106a76`): the level's bell strikes (70–80 ms of work each) and a chapter card's motif;
  then the level's collision sounds (hits, a barrier's scatter, an ice field's absorb: about 60 ms for a whole
  level, measured per recipe in Chrome); the core (St Bride's strike first, kept for the Settings preview); the
  level's other sounds, structural failures first; the shiver and clank; the other motifs. The collision
  sounds were moved up after the first measurements: last of the set, Power Valley's first car-panel hits were
  still dropped in two runs of four.
- Slices paced by the screen (`BAKE_PACE`): timer slices behind the loading overlay, up to 12 ms of a menu's
  idle time, at most 4 ms in play (`87cc17e`). The overlay's slices were 14 ms, then 40 ms (`793a0f1`), and are
  16 ms (`3d27493`, below).
- A bell phrase or hour whose strike is not baked waits for it, traced `bell-deferred` / `bell-ready … after
  N s` (`c7d15f3`); a Story moment waits for a motif still baking (`8a1fa54`); every request or strike dropped
  as `notReady` is counted by sound, summed in the trace at the session's end (`session N notReady drops: …`)
  and reported by `__icebergAudio.bake()` (`70945d2`).

**Measured** with `BAKE` (`node scripts/audio-e2e.mjs --only BAKE`): a fresh profile, the main menu for 1.5 s (a
quick player; one Riverside flow clicks the instant the button exists), one trusted click on *Play* (Arcade) or
on *Story*, the chapter 4 card 0.6 s and *Begin*; that click is also the audio unlock. Intros skipped (play
begins right after the load: the worst case), quality low, the autopilot at 1× for 60 s (45 s in Power Valley).
Seconds after the click, wall clock. `BAKEOFF` runs the same flows with `?audio=off` (no Web Audio, no bake);
BAKE and BAKEOFF alternated three times for each slice size. "Before" is the integrated build `f454922`, one run
of each flow, by the same scenario.

| Flow | Build | Play began | St Bride's strike baked | Sounds and strikes of the set baked | Strikes played | Dropped as notReady |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Riverside Town, Arcade | before | 13.7 | never | never (28 of 95 buffers still pending at 75 s) | **0 of 7** | 2: ice.land.ground, hit.metal.panel |
| | after, 3 runs | 11.4–11.5 | 0.02–0.03 | 14.3–15.9 | **7 of 7** ×3 | **0** ×3 |
| Riverside, click at once | after, 3 runs | 5.0–5.3 | 0.22–0.33 | 16.3–20.0 | **7 of 7** ×3 | **0** ×3 |
| Riverside Town, Story ch4 | before | 7.2 | never | never (44 of 99 pending) | **0 of 10** | 7: hit.masonry ×5, ice.land.ground, hit.metal.panel |
| | after, 3 runs | 5.2–5.6 | 0.08–0.09 | 1.1–3.9 (the act2 motif 22–26) | **10 of 10** ×3 | **0** ×3 |
| Power Valley, Arcade | before | 6.2 | (no church) | never (34 of 83 pending) | – | 11: hit.metal.panel ×4, splash.small ×3, hit.masonry ×2, hit.metal.heavy, ice.land.ground |
| | after, 3 runs | 4.8–5.2 | – | 0.3–3.5 | – | **0** ×3 |

The three 40 ms runs of each flow gave the same: every strike played, nothing dropped. No phrase or hour had to
wait (the strike was baked 0.02–0.45 s after the click); the deferral is the safety net, driven in
`bells.test.ts`. The smoke run's 47.7 s was the time to bake Riverside's whole set; everything a run needs early
is now baked before it is needed.

**Where the bake's main-thread time went** (inside the scheduler, `__icebergAudio.bake().time`), 16 ms runs:

| Flow | Menu idle time | Behind the loading overlay | In play | Longest slice in play |
| --- | ---: | ---: | ---: | ---: |
| Riverside, Arcade | 1.34–1.40 s (104–110 slices) | 115–151 ms (7–9) | 0.47–0.64 s over 60 s (111–151 slices) | 8–12 ms |
| Riverside, click at once | 0.25–0.34 s | 148–169 ms | 1.23–1.33 s over 60 s | 12–13 ms |
| Story ch4 | 1.50–1.60 s | 131–139 ms | 1.81–1.90 s over 60 s (mostly the act2 motif) | 17–19 ms |
| Power Valley | 1.39–1.41 s | 0–54 ms | 0 | – |

In play a slice may overrun its 4 ms deadline by one recipe step (8–19 ms at most).

**The loading overlay's slices cost load time, so they are 16 ms, not 40.** The load (the game screen until the
overlay goes), audio on against `?audio=off`, mean of three each:

| Flow | 40 ms: baked while loading | load, on / off | 16 ms: baked while loading | load, on / off |
| --- | ---: | ---: | ---: | ---: |
| Riverside, Arcade | 284–289 ms | 10.25 / 9.87 s (+0.38) | 115–151 ms | 9.66 / 9.46 s (+0.20) |
| Riverside, at once | 370–405 ms | 4.00 / 3.66 (+0.34) | 148–169 ms | 3.52 / 3.49 (+0.03) |
| Story ch4 | 365–367 ms | 3.76 / 3.33 (+0.43) | 131–139 ms | 3.10 / 3.17 (−0.07) |
| Power Valley | 75–148 ms | 3.38 / 3.21 (+0.17) | 0–54 ms | 3.23 / 3.06 (+0.17) |

The load is a few long main-thread tasks (terrain, shaders) and waits for every slice between them, so a 40 ms
slice lengthened it by about its own length (+0.17 to +0.43 s); `793a0f1`'s "no load measurably longer" did not
hold on these runs. With 16 ms (the top of the lead's 12–16 ms) the difference is +0.08 s on average, inside the
run-to-run spread, and nothing was dropped.

**Frame time in play** (rAF intervals; the overlay hides the load's frames), 16 ms runs: the first 10 s of play,
while the rest of the set bakes, 19.9–21.2 ms mean with audio against 20.3–21.3 without; after 10 s 19.5–19.9
against 19.4–20.1. Long tasks (> 50 ms) in play: 0–203 ms per run with audio, 0–92 without. No cost these runs
can separate from their spread. S12 measures the running sound alone (§5).

**Found, not fixed: the first click costs one 0.25–0.6 s main-thread task.** With audio, the click that unlocks
it is followed by a long task of 250–620 ms (every BAKE run; none with `?audio=off`; 336–733 ms before this
round). A CPU profile of that click (headless Chrome, the core baked on the menu first): `new AudioContext()` 336
ms, package B's noise bank 114 ms (`noiseBankData`), the space IR 61 ms, the graph 47 ms. The constructor cannot
run before a gesture (S1); the noise bank and the IR need no context and could be computed on the menu, which
would take about 175 ms off. On a desktop with a real audio device the constructor is usually much faster; this
needs the real laptop. When the click is *Play*, the task falls between the menu and the loading overlay.

### 2. The Ambience preview from a cold start (`87cc17e`, `70945d2`)

The bank keeps St Bride's strike with its core sounds: the first thing of the core to bake (9 s at 24 kHz,
0.82 MiB; the core is 5.81 MiB of its 6 MiB budget), never evicted by a level change, and baked on the main menu
before the first gesture. The bank's peak is **19.1 MiB of 22**, chapter 9 (its Revelation and the epilogue's motifs
together, 4.91 MiB of motifs: `packages.integration.test.ts` over every set the game asks for); `bank.test.ts`'s own
synthetic sets peak at 17.2 MiB because its chapter 9 set carries only 1.78 MiB of motifs. The preview
still never asks for a bake. **S6**, keyboard only on a fresh profile with nothing played before: releasing the
Ambience slider traced `preview ambience` (a strike from 120 m on the bell pool), then the Effects slider
`preview effects`. The first S6 run missed the Effects preview: the driver tabbed on inside the previews' 0.4 s
throttle, so it now pauses 0.7 s between sliders as a player would (29/29). `manager.test.ts`: a cold start
previews the bell; with nothing baked there is no bell and no duck.

### 3. The motif's calibration (`2fe63e2`, R7, R10)

The lab decodes each recording the way the player plays it (`decodeAudioData` at 48 kHz, both channels, at
`el.volume` 1) and renders each motif through the real graph's `motifBus` at music 1, then measures both with
package B's BS.1770 loudness (`lab.recording`, `lab.renderMotif`):

| Recording (cue) | Length | Sample peak | LUFS-I | Max momentary |
| --- | ---: | ---: | ---: | ---: |
| Mozart K.545 Allegro (wonder) | 133.9 s | −2.64 dBFS | −21.45 | −11.8 |
| Chopin waltz A minor (unease) | 130.7 s | −3.29 | −19.80 | −11.6 |
| Chopin nocturne E minor (cost) | 272.7 s | −3.14 | −23.60 | −13.6 |
| Beethoven Moonlight, Adagio (reckoning) | 335.8 s | −13.65 | −32.41 | −24.3 |
| Schumann, The Poet Speaks (remains) | 164.8 s | −9.05 | −27.94 | −17.4 |
| Schumann, Träumerei (thaw) | 203.0 s | −12.84 | −29.53 | −21.5 |
| **Median** | | | **−25.77** | |

| Motif | LUFS-I, music 1, uncalibrated | Music 0.6, calibrated | Against the target −33.21 |
| --- | ---: | ---: | ---: |
| act1 | −29.07 | −33.31 | −0.1 LU |
| act1 at 0.94 (chapter 3) | −28.23 | −32.47 | +0.7 |
| act2 | −28.99 | −33.22 | −0.0 |
| act3 | −28.13 | −32.37 | +0.8 |
| act3-bare | −28.71 | −32.95 | +0.3 |
| ch8 | −29.14 | −33.38 | −0.2 |
| epilogue | −30.56 | −34.80 | −1.6 |
| **Median** | **−28.99** | **−33.22** | |

Every render peaks at −14.0 dBFS uncalibrated (−18.2 at music 0.6), no clipped sample. §8.5 puts the motif 3 LU
under the recordings' median at the same slider value: −25.77 − 3 − (−28.99) = **+0.22 dB**, pinned as
`MOTIF_CALIB_DB = 0.2`. Both follow the music slider linearly, so one value holds at every volume. **R7 passes:**
the motifs' median at music 0.6 is −33.22 LUFS-I against the target −33.21.

**Open, for the lead and a listener: the median hides a 12.6 LU spread.** The Act III recordings are much quieter
than Act I's (Moonlight −32.4 against the waltz −19.8), and every motif render peaks at −14 dBFS, so the pp Act
III variants come out as loud as Act I's. At the same slider value, each motif (calibrated) against its
chapter's recording at the chapter's bed:

| Chapter | Recording at its bed | Motif | Motif − recording |
| --- | ---: | ---: | ---: |
| 1–2 | wonder −21.45 (0 dB) | act1 −28.87 | −7.4 LU |
| 3 | unease −20.80 (−1) | act1 at 0.94 −28.03 | −7.2 |
| 4–5 | cost −25.60 (−2) | act2 −28.79 | −3.2 |
| 6 | cost −26.60 (−3) | act2 −28.79 | −2.2 |
| 7 | reckoning −36.41 (−4) | act3 −27.93 | **+8.5** |
| 8 | remains −32.94 (−5); on the card −27.94 (0) | ch8 −28.94 | **+4.0**; −1.0 on the card |
| 9 | thaw −34.53 (−5) | act3-bare −28.51 | **+6.0** |
| Epilogue | thaw −37.53 (−8 reading) | epilogue −30.36 | **+7.2** |

The recording is held (faded out) 4 s before the motif, so they never sound together, but in Act III the
Revelation's motif comes in 6–8.5 LU above the music the player was just hearing, against the brief ("lower or
remove the music rather than making every dramatic event louder"). Holding each motif 3 LU under its own
chapter's recording would take per-variant trims of 0 dB for act1, act1 at 0.94 and act2 (never raised), −11.5
(act3), −7.0 (ch8 after play; −2.0 on the card), −9.0 (act3-bare) and −10.2 dB (epilogue), and a way to give
ch8's card and its Revelation different levels. Not applied: it reshapes the motif's arc across the story, a mix
decision for the lead and a listener, not a calibration.

### 4. Magnitude in the wild (S3/S4) and the decision (`623699b`)

**Before.** The integrator's S3 put Spearman ρ(impulse, level of the played hits) at 0.897 (n 24) against the
design's 0.9. Re-run on the integrated build at the start of this round: 0.761 on the bridge's requests (n 28)
and 0.860 on the engine's played levels (n 36, bootstrap 95 % 0.67–0.94). Three things sit between an impulse
and a played level, and one was a fault:

- **The mapping.** m added `0.25·min(1, v/25)` for the closing speed whatever the impulse, so a fast graze that
  moved almost no momentum played like a knock: Highland Maze's fences and chalets brushed at 22–29 m/s with
  J 0.03–2.9 t·m/s came out at m 0.29–0.38 (−29 to −32 dBFS), above a car pushed at 7 m/s with J 4.6 (m 0.25,
  −33.6). That is not "the magnitude of the actual impact".
- **Different hit sounds have different reference levels** (`HIT_LREF`, −12 to −14 dBFS): by design (equal m,
  equal loudness across materials); it costs a little rank order against raw impulse.
- **The engine's jitter (±1.5 dB) and density compensation**: by design (the brief's "subtle variations"; a
  pile-up must not grow linearly). They reorder taps whose levels lie within 3 dB of each other; on the n-36
  sample every played level was within −3.35 to +1.47 dB of its request, inside jitter plus density.

Candidate mappings scored on the same hits (the level each would have asked for) and on every collision of
nine levels on five autopilot lines, 0, ±8 and ±16 m (S4M, audio off, the final run: 204 collisions in 33 runs; the
first run, on which the gate was chosen, had 189, as the autopilot's lines vary a little with frame pacing):

| Mapping | Bridge hits (n 28): ρ(J) / ρ(J·v) | Engine hits (n 36) | Every collision |
| --- | --- | --- | --- |
| design: `+ 0.25·min(1, v/25)` | 0.761 / 0.942 | 0.936 / 0.959 | 0.965 / 0.982 |
| speed weight 0.10 | 0.919 / 0.908 | 0.986 / 0.918 | 0.992 / 0.961 |
| impulse only | 0.961 / 0.769 | 0.989 / 0.877 | 0.995 / 0.940 |
| **speed term × min(1, ln(1+J)/ln(21))** | **0.908 / 0.908** | **0.975 / 0.933** | **0.976 / 0.974** |
| energy: ln(1+J·v) | 0.805 / 0.972 | 0.947 / 0.972 | 0.966 / 0.989 |

J·v (impulse × closing speed) stands for the energy of the impact. **Decision: a better mapping, not a lower
threshold.** The speed term now counts in proportion to the momentum the contact moved, fully from J 20 up
(`COLLISION_MAG.jGate`; a pine that holds is J 23): a fast graze is a tap, and a real knock at speed is still
louder and brighter than the same knock slow. Two candidates keep both measures of impact at or above 0.9 on
every sample: this one and the 0.10 speed weight (0.919 / 0.908, 0.986 / 0.918, 0.992 / 0.961). "Impulse only"
gives the energy measure away (0.769 on the bridge's hits) and the energy mapping the impulse one (0.805). Between
the two that pass, the gated term was preferred for two reasons, and the table alone does not decide it: it
keeps more of the energy measure where most of the collisions are (0.974 against 0.961 over every collision,
0.933 against 0.918 on the engine's hits; on the bridge's 28 hits they tie at 0.908), while the 0.10 weight
ranks impulse better on all three samples (0.919 / 0.986 / 0.992 against 0.908 / 0.975 / 0.976); and it is the
physical reading of "the magnitude of the actual impact" (closing speed counts only as far as momentum
actually changed hands, so a graze stays a tap however fast it is) instead of a smaller constant weight for a
graze and a knock alike. The design table moves only under J 20 (the roll-back tap −34.6 → −34.9 dBFS, the
small rock −29.0 → −29.6). **The gate was chosen on S4M's sample, which includes the ±8 m lanes**: the physics
is deterministic per level, lane and seed, so the ±8 m runs below hit the same obstacles; they are a split of
the sample, not a held-out test (an earlier version of this section called them held out, wrongly).

**The threshold is applied as written, to the mapping.** S4's ρ ≥ 0.9 is checked on the level each played hit
asked for (`requestDb`, now traced next to the played level). What the engine does to that level is checked on
its own (S3E *engine fidelity*: every play within its request ± its family's jitter, minus density compensation,
minus distance), and the ρ of the levels as played is reported with its bootstrap interval, not held to 0.9:
with taps a jitter apart, ±1.5 dB alone moves it by a few hundredths at random (the simulation below).

**After** (`--only S3,S3E`, 28 runs: every level's default line, the two rare lanes and 17 lanes at ±8 m):

| | S3, bridge | S3E, engine |
| --- | --- | --- |
| ρ(impulse, requested level), played hits | **0.961**, n 67, 95 % 0.925–0.975 | **0.959**, n 62, 95 % 0.919–0.975 |
| … on the ±8 m lanes / the other lines (a split, not held out: S4M's sample includes the ±8 m lanes) | 0.948 (n 31) / 0.977 (n 36) | 0.950 (n 29) / 0.980 (n 33) |
| ρ(impulse × speed, requested level) | 0.936 | 0.943 |
| Within one hit sound, a higher m never asks for less | 7 sounds, 0 inversions | 6 sounds, 0 inversions |
| Every collapse ≥ the median small-rock hit + 12 dB | lowest −17.6 (Ravine Run's 1.3 t water tower) vs −30.5: +12.9 | −17.8 vs −30.7: +12.9 |
| The median break above the 90th-percentile hit | −14.3 vs −21.1 (65 breaks) | −14.3 vs −20.4 |
| Engine fidelity, every play | – | 749 plays, 0 outside the bounds; +1.49 to −5.32 dB |
| As played: ρ(impulse, played level at the source) | – | 0.921, 95 % 0.862–0.947 (the requested levels with simulated ±1.5 dB jitter: 0.947, 5–95 % 0.935–0.959); ρ(m, played) 0.944 |

S3's split by lane was computed from the run's JSON (a driver bug lost the lanes' names in that run; fixed).
S4M on the final build checks the game's own `collisionM` and hit levels: over the 197 audible collisions ρ(J,
level) 0.976 and ρ(J·v, level) 0.974 (both ≥ 0.9, pass).

### 5. Every scenario of §11 on the integrated build

"bridge" = the real 3D view playing into a recording engine (what was asked for); "engine" = the page's own
audio (what played: trace, meters, voices); "physics" = audio off. The final run of each scenario.

| Scenario | Evidence | Pass | Fail | n/a | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| S0 Clock sanity | engine | 5 | 0 | 0 | the clock runs at 0.839× wall time (under the design's 0.95: meters are timed on the context clock); a fired stone hit at −12 dBFS reads −14 on the master meter |
| S1 Autoplay | engine | 8 | 0 | 0 | no context and no music element before a gesture; locked after Escape; running 3 ms after a click; one context |
| S2 Arcade basics | engine | 8 | 0 | 0 | K.545 at 0.4766; ambience bus −33 dBFS RMS; fade-out in 3.06 s |
| S3 Event coverage, S4 | bridge | 21 | 0 | 0 | 28 runs; 1,049 of 1,049 events ended in the trace; 36 sound ids; every event type's family played |
| S3E the same on the engine, R11 | engine | 30 | 0 | 0 | 1,040 of 1,040 events; 782 of 782 not capped played; 36 ids played |
| S4M the mapping, every collision | physics | 2 | 0 | 0 | §4; the first run's sample-size check (≥ 200 collisions, read 189) was replaced by these two |
| S5 Rapid collisions | bridge | 6 | 0 | 1 | ≤ 4 admitted per frame (up to 10 events and 5 requests resolved in one frame), the fifth dropped as `frameCap`; 86 of 86 events accounted for; the voice count is S5E's |
| S5E the same on the engine | engine | 7 | 0 | 0 | 34 bursts of 3 s: at most 8 of 24 voices, ≤ 4 admitted per frame, master peak −11.3 dBFS, drops counted by reason |
| S6 Volume controls | engine | 29 | 0 | 0 | after the driver's slider pause (§2) |
| S7 Pause | engine | 8 | 0 | 0 | music −8 dB in 199 ms, gate 0, back in 252 ms; ten rapid Esc presses consistent; blur pauses |
| S8 Leave, retry, level change | bridge | 16 | 0 | 0 | every session ended with the 0.12 s fade; the scrape follows the iceberg's speed at Pearson r 1.000 |
| S8E the same on the engine | engine | 10 | 0 | 0 | the first run was 8/2: *Fixed* below |
| S9 Hidden tab | engine | 6 | 0 | 0 | music paused at once, context suspended, game paused |
| S10 Church bells | bridge | 20 | 0 | 0 | |
| S10E the same on the engine | engine | 20 | 0 | 0 | strikes played: pass chapel 7, St Bride's 9, Clachan kirk 4, lochside kirk 6, fjord chapel 5; 0 notReady; each hour three strokes, 200–346 m out; no bell on the five other levels |
| S11 Story moments | bridge | 23 | 0 | 0 | |
| S11E the same on the engine | engine | 18 | 0 | 0 | the ch8, act1, act3-bare and epilogue motifs played (music bus −33 to −39 dBFS RMS); ch9's hour six strokes, the chapel silent after 9, one clank; story ducks below |
| CALVE The intro's calving | bridge | 6 | 0 | 0 | |
| S12 Performance | engine | 3 | 0 | 0 | below |
| S13 Determinism | engine | 4 | 0 | 1 | two seeded lab sequences agree to 1.3e-6 dB with the same voices; the bank checksum `74a0ca9e` twice. Node's checksum of the same set is also `74a0ca9e` (recorded here after the fact; pinned since by `bank.test.ts`, and S13 now compares against it by default, so the n/a is gone) |
| R Offline renders | engine | 25 | 0 | 0 | below |
| BAKE (16 ms slices), ×3 | engine | 48 | 0 | 0 | §1 |
| BAKEOFF, ×3 | engine | 6 | 0 | 0 | §1 |

**R (offline renders).** R1: a stone hit at m 0.1 … 0.9 rises −55.6, −50.1, −44.8, −37.3, −32.0 LUFS-M max (23.7
LU, inside 18–28); its share under 150 Hz 0.025 → 0.342; breaks at M 0.2 … 1.0 −27.7 … −19.4. R2: tap −56.3 ≤
pine −51.1 − 4 ≤ house −25.4 − 12, house + 3 ≤ dam −20.0, nothing above −8 dBFS, and the same order after a 150
Hz high-pass. R3: 200 collisions, 40 splashes and 20 breaks in 2 s: 24 voices at most, true peak −8.0 dBTP, no
clipped sample. R4: a −20 dBFS sine comes out at −20.0; a full-scale burst band-limited at 16 kHz at −1.29 dBTP
(*Fixed*). R5: effects 0.5 against 1.0 −6.021 dB; ambience 0 and mute all digital silence; the pause gate −215
dB 0.25 s after closing. R6: a bell at 250 m 15 LU under a house collapse at 30 m; at 40 m it peaks at −18 dBFS.
R7, R10: §3. R11 (the S3E runs' plays replayed offline through the real graph): Riverside Town −25.2 LUFS-I,
true peak −9.4 dBTP; Power Valley −27.7, −9.2; Highland Maze −28.5, −13.5; the limiter's reduction 0 dB at p99
and at most (nothing reached its −3 dBFS threshold).

**S12 (performance).** The engine's `frame()` reads 0 ms at the median and the p99 (under `performance.now()`'s
resolution here). A/B against `?audio=off` at high quality, Riverside Town on the autopilot, 30 s of play with
the set baked first, alternated four times: median frame interval 16.9 ms with audio and 16.8 without (+0.1 ms;
the design allows 0.3), p95 33.7 / 33.6, mean 24.8 / 24.2 (+0.56 ms). Underruns cannot be observed headless.

### The requirements, by number

| Requirement | Measured |
| --- | --- |
| Major events trigger their sounds | S3E, on the engine, 28 runs: the scrape (its loop follows the iceberg's speed at r 1.000, S8) and wall scrapes (`ice.wallScrape` 10); river and wind (the ambience bus −28 to −33 dBFS RMS in play, S2, S8E); rocks (`hit.stone.light` 16, `hit.stone.heavy` 11); a stone barrier breaking apart (`stone.scatter` 1, Mountain Valley's +8 m lane); trees (`tree.fall.pine` 9, `tree.fall.broadleaf` 3); houses with timber and glass (`house.collapse` 20, `timber.collapse` 4, `glass.pane` 5, `glass.break` 1); industry (`metal.break.structure` 11, `machine.winddown` 5, `liquid.release` 6, `hit.metal.heavy` 16); dams and the rush (`dam.break` 3; the flood layer fed on the five levels with a reservoir); waterfalls and splashes (`water.plunge` 54, `splash.*` 188); the sea (`ocean.entry` 13 and the surge on every level) |
| Impact magnitude maps to loudness | §4: ρ 0.96 on the requested levels (0.95 on the ±8 m lanes, not held out), 0.92 as played; R1 +23.7 LU from a tap to a hard hit; R2's order across families; every collapse ≥ 12.9 dB over a small-rock hit |
| Rapid collisions stay bounded | S5E: ≤ 8 of 24 voices, ≤ 4 requests admitted a frame, master peak −11.3 dBFS; R3: 24 voices, −8.0 dBTP, 0 clipped samples |
| Volume sliders and mute work | S6: bus gains 0.8 / 0.5 / 0.6 / 0.5 as set, `el.volume` 0.3177 = master × music × −2 dB; M takes the master meter from −36.1 dBFS RMS to digital silence; R5: effects 0.5 = −6.021 dB, ambience 0 and mute silent |
| Pause behaves | S7: music −8 dB in 199 ms, effects and ambience gated to 0, back in 252 ms; R5: the gate −215 dB in 0.25 s; a hidden tab suspends the context (S9) |
| Leaving and level change stop every sound | S8E: after Retry, a level change, quitting and leaving Story, the old session's trace stops (0 plays after its end), and on the menu every bus is digital silence 300–600 ms (audio time) later with 0 voices |
| Bells in every church level | S10E: all five churches strike on the engine, 0 dropped; the hour three strokes in Arcade, six in Story (S11E); BAKE: 7 of 7 and 10 of 10 from a cold start |
| Story ducks never raise the music | S11E: the router's duck product ≤ 0 dB in all 1,208 samples (the ch8 card, chapters 1 and 9, the Revelation, the epilogue), no recording ever above master × music, every duck in chapter 9 ≤ 0 dB |

### Fixed during these runs

- **The reverb rang on after leaving** (S8E, `6170b2b`): quitting to the menu, and leaving Story chapter 4, left
  the effects and ambience meters silent but the master at −72.6 and −76.8 dBFS RMS 300–600 ms later: the shared
  convolver ringing out its 2.2 s impulse response. The space's return now closes with the last attempt and opens
  again once the convolver has emptied, when the next attempt begins, or for a Settings preview. After: digital
  silence on every bus.
- **R11 read 145–159 dB of limiter reduction** (`45c0f90`): Chrome's compressor delays its output by 6 ms (288
  samples, measured), and a block ending on an onset compared the onset before the limiter with the silence
  after it. Aligned by the measured look-ahead: 0 dB.
- **R4 failed at +0.88 dBTP** (`6c6cb55`), the test signal's doing: full-band white noise at a 0 dBFS sample peak
  carries +3.5 dBTP of intersample peaks, and the limiter held its sample peak at −2.52 dBFS. Band-limited at 16
  kHz, where every effect strip's low-pass stops, the burst comes out at −1.29 dBTP (sample peak −2.37). Chrome's
  `DynamicsCompressorNode` limits samples, not true peak; the white-noise number is still reported.
- **The bake's loading slices made loads longer** (`3d27493`, §1): 40 ms → 16 ms.
- Driver: S6's pause between sliders; S5's voice count under the recorder is n/a (S5E measures it); S3's run
  names; digital silence reported as "-Infinity"; S0, and every meter window timed on the context clock.

### Still open

- **The motif's level across the acts** (§3): calibrated to the median as designed, it comes in 4–8.5 LU above the
  Act III chapters' own recordings. A decision for the lead and a listener. *Settled in the second fix round
  (below, §4 and §5): the recordings loudness-matched and every moment's motif trimmed under its recording.*
- **The first click's 0.25–0.6 s main-thread task** (§1): mostly the browser's `AudioContext` constructor in
  headless Chrome; the noise bank and the IR (about 175 ms) could move to the menu. Needs the real laptop.
  *The noise bank and the IR moved to the menu in the second fix round (below, §6); the constructor remains.*
- One run of the audio test files, under load from a concurrent browser run, timed `audio.jsdom.test.ts` out at
  30 s; it passes alone, and the final run of all 40 files under `src/audio` and `src/ui/audio` passed (424
  tests). The full suite is the lead's to run.
- Not built (P1, documented): machines that hum until destroyed. Cut by the lead: the Vey strings.
- Everything only a human ear can judge (`AUDIO_DESIGN.md` §13): nobody has listened to any of this.

## Second fix round (2026-10-22, after the review)

An independent review of the fix round confirmed eighteen findings, and the lead made two decisions: **L1**, the
motif must never sit louder than its chapter's own recording (at least 1 LU under it at its moment, every duck
included), and **L2**, the first click's main-thread task loses the noise bank and the reverb IR. This round fixed
them. Same laptop and browser as above (Chrome 155, `--headless=new --mute-audio
--autoplay-policy=document-user-activation-required`, 1280 × 720), a dev server on port 5199 with its own
dependency cache and no file watching. Nothing was listened to. The probe scripts and their raw logs are in
`audio/fix-round-2/` (its README says which log is which); the `scripts/audio-e2e.mjs` check lists of this round
are `audio/fix-round-2/e2e-R-S14.md` (R, and a first S14 that the driver failed: it clicked a button scrolled
out of view), `e2e-S14.md` (S14 with the button scrolled into view) and `e2e-S1-S6-S11-S11E.md`. "Before" is
HEAD `f5b231e` as the reviewers ran it (their logs, quoted), "after" this round's build.

### 1. A new attempt on the same screen ends the Revelation (review 0 and 5)

Replay chapter, R on the panel and "Continue to chapter N" with narrative off all keep the game screen up; the
Revelation (and the epilogue) used to end only when the screen changed, and the reading level is an app-level
duck that no session end releases.

| Flow | Before (review) | After |
| --- | --- | --- |
| Replay chapter, 5 s into the panel | replayed attempt +8 s: ducks `reading −6/−8/−12`, ambience 0.3185, effects 0.201, hold `reveal`; still so at +28 s | +8 s: ducks {}, ambience 0.8, effects 0.8, holds [], playing `wonder` (`out_s_replay.txt`); the trace has `motif stopped over 1.50 s`, `release 'reveal'` and `reading release` at the click |
| Replay chapter, 1 s into the panel (before the motif) | the motif started about 3 s into the replayed attempt, −18 to −25 dBFS on its bus for 13 s, the recording held out throughout | the motif bus silent for 16 s, the recording back at full level by +4 s (`out_s_replay_motif.txt`); **S14**: music bus −∞ dBFS RMS over 3 s, buses 0.8 / 0.8, no hold |
| Narrative off, Continue to chapter 2 | chapter 2 +30 s: `reading` on, effects 0.201 | +10 s and +30 s: ducks {}, buses 0.8 / 0.8 (`out_s_continue_off.txt`); **S14**: the same |

`StoryMoments` now keeps the run its Revelation or epilogue belongs to and ends it (motif faded over 1.5 s, hold
released, reading level lifted) when the outcome goes, the chapter changes, or the phase goes from `complete` back
to loading or play. Tests: four cases in `moments.test.ts` (Replay / R, the phase leaving `complete`, Continue
with narrative off, R after the epilogue) and three in the director's jsdom test (with the real stores); with the
check disabled, all six that cover a restart fail. **S14** (new, engine): 10 of 10 checks.

### 2. A hidden tab during a motif (review 1 and 6)

The hold's release was a wall-clock timeout, and the router's hold deadlines were wall-clock too, while the motif
waits on the AudioContext, which a hidden tab suspends. Before (review): the release came at frozen context time
21.57, before the motif's start at 24.35; on return the recording faded back in and the whole motif then played
over it. Now the release is checked against `engine.now()` (a timer only wakes the check; while the clock stands
still it comes back), and the router adds the time hidden to every hold's deadline.

- `out_s_hidden_reveal.txt`: hidden 20 s at panel +1 s, the context suspended (its clock 21.69 → 21.77); after
  showing, the hold stays and the recording at volume 0 while the motif plays (ctx 24.58–38.49, −18.5 to −30.9
  dBFS peak on its bus).
- `out_s_hidden_release.txt`: the motif due to end at ctx 40.81, the release due at 44.81; released at **44.82**;
  0 samples with the recording playing during the motif.
- Tests: `moments.test.ts` (a frozen audio clock while 20 s of wall time pass; an audio clock at 0.84× wall time)
  and `musicRouter.test.ts` (a minute hidden does not run the limits out); each fails with the old timing.

### 3. Hot updates of the engine (review 2, development only)

`manager.ts` registered a dispose hook but never accepted its own updates, so an edit propagated to the React
refresh boundaries and Vite never ran it. Now the module accepts its updates by disposing the engine and
reloading the page. `s_hmr.mjs` (three `server.reloadModule` updates, each followed by a click): before, the
document's AudioContexts went 1 → 2 → 3 → 4, all running (`out_hmr_before.txt`); after, one context and a page
reload each time, for `manager.ts` and for `engine/graph.ts` below it (`out_hmr_after.txt`,
`out_hmr_graph_after.txt`).

### 4. The music's level: the recordings loudness-matched (review 3 and 4; `2af04f1`)

The six recordings spanned 12.6 LU (the waltz −19.80 LUFS-I, Moonlight −32.41), and the beds are 0 to −5 dB, so
from chapter 4 on the piano sat far under the game, and a playlist moving on could come in 8.8 LU louder inside
Act III. Four files had their gain raised losslessly (`scripts/mp3-gain.mjs`, every granule's `global_gain`; each
decoded file is the original × 2^(steps/4) to 1.9 × 10⁻⁶, `out_gaincheck.txt`), and the player cuts each file to
−22.1 LUFS-I (`tracks.ts`). **R10** on this build: every recording heard at −22.10 LUFS-I, peaks −1.63 to −5.32
dBFS (`e2e-R.md`). Tests: the shipped files' SHA-256, every file at the target, no playlist step louder, the
chapters' beds descending; the router with the real player plays every playlist through (with the cut removed,
K.545 → the waltz comes out +1.65 LU and the test fails).

Music heard against the game's own master in play (LU; 20 s of context time from 16 s of play, default sliders,
autopilot; the music is the mp3 segment the element played, scaled by its volume; BS.1770 with `analysis.ts`):

| | Arcade | ch1 | ch3 | ch4 | ch6 | ch7 | ch8 | ch9 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before (review, port 5302) | −3.1 | −2.4 | −2.2 | −14.7 | −17.9 | −18.1 | −16.8 | −13.2 |
| After (`out_music_balance.txt`) | −5.3 | −3.9 | −4.5 | −13.6 | −16.5 | −7.6 | −11.0 | −5.8 |
| The played segment against its file's integrated loudness | +0.9 | +0.3 | +0.3 | −5.3 | −5.4 | −0.8 | −2.4 | −0.6 |

Over whole recordings the music now descends by the beds alone (at music 0.6: −26.5 LUFS-I in chapters 1–2, −27.5
in 3, −28.5 in 4–5, −29.5 in 6, −30.5 in 7, −31.5 in 8–9). Act III in play went from 13–18 LU under the master to
6–11. **Act II did not move much in this probe, and that is open:** the window measured is the nocturne's opening
(19.5–39.3 s into the piece), which sits 5.3 LU under the piece's own integrated loudness, and chapter 4's landmark and scar ducks were
on (−11 dB at the end of its window; chapter 6's element averaged 0.27 against 0.40 at its end). A player entering
chapter 4 in order meets that opening. Whether that quiet start reads as intended or as the music vanishing is for
a listener; matching the files on their openings instead of their whole length was not done.

### 5. The motif's level (lead decision L1; review 9)

`MOTIF_CALIB_DB` is §8.5's rule against the matched recordings: −22.1 − 3 − (−28.99) = **+3.9 dB** (it was +0.2
against the unmatched median). **R7** on this build: the seven motifs' median at music 0.6 is −29.52 LUFS-I
against the target −29.54. Each moment then trims its motif (`MOTIF_MOMENT_TRIM_DB`, rounded down to 0.5 dB) to sit
at least 1 LU under its chapter's recording at that moment: the matched recording at the chapter's bed under the
moment's reading level. Rendered by the lab through the same per-motif gain as `playMotif` (both at music 1):

| Moment | Motif, trim | Motif LUFS-I | Recording at that moment | Under by |
| --- | --- | ---: | ---: | ---: |
| ch1, ch2 Revelation | act1, −4 dB | −29.17 | −28.10 (bed 0, reading −6) | 1.07 LU |
| ch3 Revelation | act1 at 0.94, −6 | −30.33 | −29.10 (−1, −6) | 1.23 |
| ch4, ch5 Revelation | act2, −6.5 | −31.59 | −30.10 (−2, −6) | 1.48 |
| ch6 Revelation | act2, −7.5 | −32.59 | −31.10 (−3, −6) | 1.48 |
| ch7 Revelation | act3, −9 | −33.23 | −32.10 (−4, −6) | 1.13 |
| ch8 Revelation | ch8, −9 | −34.24 | −33.10 (−5, −6) | 1.14 |
| ch9 Revelation | act3-bare, −9.5 | −34.31 | −33.10 (−5, −6) | 1.21 |
| ch8 card | ch8, 0 | −25.24 | −22.10 (a Story screen: bed 0, no duck) | 3.14 |
| Epilogue | epilogue, −9.5 | −36.16 | −35.10 (−5, −8) | 1.06 |

Before, at the same reference, the Act III motifs came in 4 to 8.5 LU **above** their chapters' recordings (§3).
The ducks that stay on the recording until the attempt ends are subtracted at the moment, at their targets
(`MusicRouterState.targets`) and as far as the router's −20 dB floor takes the recording: the attempt's scar and
chapter 9's sea (−10 dB; a run completes only in the ocean). So the margins above hold with every duck included.
`moments.test.ts` drives the real moments for every Revelation, the card and the epilogue, with no scar and with
each chapter's deepest one, and checks every margin (it fails with the sea left out: chapter 9's motif would sit
8.8 LU above the recording the sea has taken down). In chapter 9 that makes both motifs very quiet:
**S11E** (engine, a real chapter 9 run with the chapel's fall, the sea and a −3.75 dB scar) played the
Revelation's motif at **−23.3 dB** (its −9.5 trim, the sea's −10, the scar) and the epilogue's at **−21.5 dB** (its
−9.5, then the floor: −20 dB under the −8 dB reading level leaves 12). Over 2 s of the epilogue's motif the music
bus read **−55.6 dBFS RMS against the ambience bus's −37.2**: about 18 dB under the sea and wind, and Träumerei,
which returns after it, is by design only 1 LU louder. By measurement the motif is probably masked there.
That is for a listener and the lead: L1 as it stands, or leaving the sea out of `PERSISTENT_DUCKS` (one line; the
motif then 10 dB louder, about 8.8 LU above the recording the sea has taken down, and still under the ambience).

### 6. The first click (lead decision L2)

The gesture that unlocks audio was one main-thread task of 0.5–0.56 s here. The noise bank's samples and the
48 kHz space IR need no context, so they are now computed as plain `Float32Array`s in the bake's idle slices on
the menu, before any gesture (`SynthesisFactories.warmSteps`, eight steps, 0.2–0.36 s of main thread in all), and
the gesture only builds the context and wraps them. `s_gesture.mjs`: 6 s on the menu, then a trusted click; the
long task at the click, `new AudioContext()`'s own time, and a CPU profile's inclusive times.

| | Long task at the click | `new AudioContext()` | Noise bank | Space IR | Graph |
| --- | --- | --- | --- | --- | --- |
| Before (`out_gesture_before.txt`, 3 runs) | 556, 509, 506 ms | 318, 288, 289 ms | 104–112 ms | 40–49 ms | 41–47 ms |
| After (`out_gesture_final.txt`, 3 runs) | 334, 420, 392 ms | 229, 282, 261 ms | 6 ms (wrapping) | not on the click | 64–91 ms |

The task lost the noise bank and the IR (about 150 ms). What remains is mostly **the `AudioContext` constructor,
which cannot move**: built before a gesture, a context starts suspended and Chrome logs the autoplay warning that
S1 forbids, so it is built in the gesture; it took 229–357 ms in headless Chrome over this round's runs (a real
audio device is usually much faster; not measured on the real laptop). The graph's build varies with the machine's
load (41–91 ms). A gesture before the warm-up ends stops it, and the rest is made with the context
(`manager.test.ts`).

### 7. The smaller findings

- **The aftermath's release** (review 7): it was 4 s everywhere; now the chapter's own (Act I 2 s, Act II 4 s, Act
  III 6 s). `manager.test.ts` reads the router's duck at half and at the end of each act's release.
- **M on a focused slider** (review 8): M now works on a slider, checkbox, radio button or button; only text entry,
  a select's type-ahead and editable text keep the letter. The director's jsdom test presses M on the Settings
  screen's Master slider and gets "Sound off".
- **Honesty** (review 9–17): the docs no longer claim nothing gets louder while the motif did (it no longer does,
  §5 above); libebur128 (MIT) is credited for the K-weighting filter, with ITU-R BS.1770-4, YIN, Schroeder, Kellet
  and the RBJ cookbook (`docs/AUDIO_CREDITS.md`, *Sources*; README); §4 above no longer calls the ±8 m lanes held
  out and gives the real reason for preferring the gated speed term over the 0.10 weight, which also passed; README
  and DEVLOG no longer describe the late Arcade bake; `chipAmountRef` (0.4) and `FALL_Q_REF` (17.5) are pinned by
  value in `integration.test.ts`; the bed descent and Arcade's three strokes are checked where the names say (the
  director's jsdom test over all nine chapters; a real Arcade bridge run on Riverside Town); the bank's peak is 19.1
  MiB (chapter 9), not 18.3 or 17.2; node's checksum of S13's set, `74a0ca9e`, is pinned by `bank.test.ts` and S13
  compares against it by default.

### Still open

- **Nobody has listened.** In particular: whether chapter 9's two motifs (§5: the epilogue's −55.6 dBFS RMS against
  the ambience's −37.2) are heard at all over the sea, which decides whether L1 should leave the sea out there,
  and whether Act II's quiet opening (§4) reads as intended. *Update 2026-10-23: lead decision L1b leaves the
  sea out of the motif's level and lowers the epilogue's ambience 14 dB; see* Epilogue motif bake *below for
  the levels measured after it.*
- The first click's `AudioContext` constructor on the real laptop.
- Not built (P1, documented): machines that hum until destroyed. Cut by the lead: the Vey strings.

## Epilogue motif bake (2026-10-23)

**The race.** In S11E chapter 9 completed and the Revelation's motif played, but when the epilogue began its motif
was never heard: the trace showed `motif epilogue@1: not baked` three times, then the hold was released. The
epilogue's motif is the longest bake, 34.2 s of felt piano: **3.1–3.7 s of main-thread work** in headless Chrome
(EPI below; 3.7–5.7 s in Node). Chapter 9's set bakes it last (core, the level's sounds, the bells, then the motifs),
in play at most 4 ms per slice and after the run at the idle pace, and a moment waited only its start time plus
0.5 s (5 s for the epilogue). Same laptop and browser as above (Chrome 155, `--headless=new --mute-audio`, 1280 ×
720), `node scripts/audio-e2e.mjs --serve --port 5199`, nothing listened to. Times are wall seconds from chapter 9's
start (`motifBakeWatch`, polled every 100 ms) unless marked as the audio clock; "work" is the wall time spent inside
the bake's slices.

**Before** (HEAD `e4c9aba`, one S11E run): play at 5.9 s, the Revelation's motif baked at 24.4 s, the run complete
at 72.0 s, the epilogue at 92.1 s (20 s of reading), the epilogue's motif never baked. From 24.4 s on it was the only
thing left to bake, and it got 3.0 s of work in 47.6 s of play (63 ms/s) and 1.1 s in the 20 s of Revelation at the
idle pace (57 ms/s): idle callbacks are scarce while the river view renders. Its 5 s wait would have added about
0.3 s. Runs vary with the machine's load: in the later runs below the play pace finished it during play.

**What changed** (`3a48bda`, `ee2dbb6`, `0df1324`):

- **A motif a moment wants is baked first, at the loading pace** (`AudioManager.awaitMotif`,
  `SoundBank.prioritize`): when a moment's motif is not baked at its trigger, the bank moves it ahead of everything
  still pending (a bake in progress is set aside and resumed later, sample for sample the same) and, off play,
  bakes in the loading overlay's 16 ms timer slices instead of idle time, until it is baked or the moment ends.
  Play keeps its 4 ms.
- **The epilogue waits up to 15 s** for its motif (`EPILOGUE_MOTIF_WAIT_SEC`; the others keep their start time
  plus 0.5 s, never under 3 s). The music stays held meanwhile; the latest start, the motif and its 6 s of silence
  fit under the router's 60 s `HOLD_MAX_SEC` (a unit test checks it).
- **From chapter 9's Revelation until the epilogue starts, the epilogue's motif is asked for the same way**
  (when no moment is waiting for its own): it plays next, and on a slower main thread its own 15 s wait cannot
  cover its whole bake (below).

**Candidates measured and not kept as worded.** (a), moving the chapter's motifs to the front when a run completes:
at the run's end the bank had **0** entries pending in all nine runs on this machine that recorded it (the motifs were
next in line or done), so the order alone changes nothing; on a 2x throttled main thread the order alone is no help either at the idle pace (13 ms
of work a second behind the Revelation). It is kept only together with the pace, as the third change above. (d),
baking the epilogue earlier during the chapter: it already bakes in play right after the level's sounds and the
Revelation's motif (done by 46–54 s of chapter 9 in the unthrottled runs below); earlier means ahead of the sounds
play needs, or a bigger slice in play, and neither is free in play, so it was not done.

### S11E, three runs on the final build

| Run (UTC) | Play | Revelation motif baked | Run complete | **Epilogue motif baked** | Epilogue starts | **Motif starts after the epilogue's start** (audio clock) | Checks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Before, 03:43 | 5.9 s | 24.4 s | 72.0 s | never | 92.1 s | never (released at the wait's end) | 17 pass, 3 fail |
| 04:48 | 4.6 s | 15.8 s | 66.6 s | **50.1 s** | 86.7 s | **4.50 s** (on time) | 20 pass |
| 04:50 | 4.5 s | 16.8 s | 66.8 s | **50.3 s** | 86.9 s | **4.50 s** | 20 pass |
| 04:52 | 4.5 s | 16.2 s | 67.4 s | **53.5 s** | 87.5 s | **4.50 s** | 20 pass |

In all three the motif was baked during play, so nothing had to wait (these runs exercise the change only by not
breaking anything; EPI below exercises the wait). The epilogue's motif read −48.1 to −48.4 dBFS RMS on the music bus
against −44.9 to −46.3 for the ambience (L1b's levels, for a listener). Six earlier runs of S11E on intermediate
builds of this change also played it on time, baked in play at 46.3–53.6 s (one more was discarded: an edit of a
source file during the run reloaded the page).

### EPI: the worst case, and the frame time on the Revelation

`EPI` (new scenario): chapter 9 at double speed, then on the Revelation, the river view rendering behind it, the
frame time in 4 s windows with nothing to bake and with work pending (the five other motif renders asked for again
before each pair of windows) at the idle pace and at the loading pace, alternated; then the worst case, the
epilogue's motif dropped and asked for again and the epilogue started in the same task, so that nothing of it is
baked when it starts.

| Worst case | Baked after the epilogue's start (wall) | Work | **Motif starts after the epilogue's start** (audio clock) | Checks |
| --- | ---: | ---: | ---: | --- |
| 04:06 (earlier build: the start 1 s after the drop) | | | 4.95 s | worst case passed |
| 04:09 (the same) | 4.93 s | 3,390 ms | 5.02 s | 8 pass |
| 04:15 (the same) | 4.48 s | 3,121 ms | 4.95 s | 8 pass |
| **04:58, final** | **5.50 s** | 3,673 ms | **5.76 s** | 8 pass |
| **05:00, final** | **5.26 s** | 3,609 ms | **5.52 s** | 8 pass |

So from nothing the whole motif bakes in 4.5–5.5 s at the loading pace and starts 5.0–5.8 s after the epilogue's
start, inside the 15 s wait with nearly three times the margin. The old wait made its last attempt 5.0 s after the
start: the two final runs would have missed it. At the idle pace (0.12–0.19 s of work a second in these runs' idle
windows, 0.06 s in the race above) it would need 20 s to a minute.

Frame time on the Revelation (rAF intervals; three idle and three loading windows of 4 s per run, one "nothing to
bake" window):

| Run | Nothing to bake: frames in 4 s, mean | Idle pace, work pending: frames, mean, work | Loading pace: frames, mean, work |
| --- | --- | --- | --- |
| 04:09 | 207, 19.4 ms | 195–208, 19.3–20.6 ms, 142–175 ms/s | 181–188, 21.5–22.1 ms, 708–721 ms/s |
| 04:15 | 201, 19.9 ms | 204–207, 19.4–19.7 ms, 141–185 ms/s | 184–193, 20.8–21.8 ms, 704–721 ms/s |
| **04:58, final** | 193, 20.8 ms | 196–213, 18.9–20.6 ms, 149–177 ms/s | 178–185, 21.7–22.6 ms, 674–723 ms/s |
| **05:00, final** | 209, 19.2 ms | 191–208, 19.3–21.1 ms, 120–151 ms/s | 178–185, 21.7–22.6 ms, 685–711 ms/s |

The median frame interval was 16.7 ms and the 95th percentile 33.3–33.5 ms in every window, with or without the
faster pace. Over the twelve windows of each pace the loading pace gave 184.5 frames in 4 s against 202.6 at the idle
pace (about 9 % fewer; the mean interval 21.8 ms against 19.8), frames over 33 ms 2.0–4.0 a second against 1.0–3.5,
while the bake got about 4.5 times the work done (0.67–0.72 s a second against 0.12–0.19). During the worst case's
own wait, on the epilogue's screen: 166–179 frames in its first 4 s, mean 22.4–23.1 ms, against 193–209 with
nothing to bake on the Revelation. That is the price, paid only while a moment waits for its
motif (or on chapter 9's Revelation until the epilogue's motif is baked), never in play.

### A slower main thread (`--cpu-throttle 2`)

DevTools CPU throttling at 2x, on the final build. S11E as written (20 s on the Revelation): chapter 9's set was
still 21 entries short at the run's end (the play pace got about 21 ms of work a second), and **the Revelation motifs
of chapters 1 and 9 and the epilogue's were all missed**. The loading pace got about 240 ms of work a second there
(EPI at 2x: 280–297 ms/s against 9–11 at the idle pace, with the Revelation at 30 frames a second against 42–43), so
the Revelation's 4.5 s wait was too short for its own motif; the epilogue's, asked for from then on (the abandoned
Revelation motif set aside), got about 3.8 s of work by the epilogue's start and was not baked when its 15 s wait
ended. EPI's worst case missed it too at 2x.

With a minute on the Revelation (`--read-sec 60`), once as built and once with the Revelation's ask for the
epilogue's motif disabled for the run (a local edit, not committed):

| 2x throttle, 60 s read | Epilogue motif baked | Epilogue starts | Epilogue motif |
| --- | --- | ---: | --- |
| As built | 152.1 s: 50.6 s after the run's end, 13.1 s of loading-pace work since | 161.9 s | **played on time**, 4.50 s after the epilogue's start |
| The ask disabled | never (57 s at the idle pace) | 162.3 s | **missed** |

So on a main thread twice as slow the story's last motif plays for a player who reads the Revelation for about a
minute, and only because of the ask; a quicker click still misses it there.

### The rest

- **S1** (autoplay) and **S12** (performance) on the final build: 8 of 8 and 3 of 3 checks pass. S12's A/B
  against `?audio=off` (Riverside Town in play, four runs each): median frame 16.8 ms against 16.9, a change of
  −0.1 ms (the check asks for at most 0.3); the engine's `frame()` median and p99 0 ms. The change never runs in
  play, and this is the evidence it costs nothing there.
- Unit tests: `npx vitest run` on the fifteen files the change touches or depends on, 198 tests pass; `tsc --noEmit`
  clean. `src/audio/story/motifBake.test.ts` drives StoryMoments, the real engine, the real bank and the paced
  scheduler on a simulated main thread with no idle time: chapter 9's Revelation motif, not baked when the run
  completes, goes to the front, bakes in timer slices inside the 4.5 s wait and plays, and the epilogue's is asked for
  next. Without the faster pace, or without the priority, it never bakes in time (checked by disabling each).
  `moments.test.ts` checks the asks, the epilogue's 15 s wait and its fit under `HOLD_MAX_SEC`; `bank.test.ts` the
  priority, the set-aside bake (resumed sample for sample) and that null puts it back; `manager.test.ts` the pace
  (never in play) and the trace.
- The check lists of these runs are in `audio/epilogue-bake/`.

### Still open

- **Nobody has listened.** In particular, whether a motif that starts up to 15 s into the epilogue (in silence, the
  music held and the world 14 dB down) still reads as the story's close, and the epilogue motif's level against the
  ambience (−48 against −45 to −46 dBFS RMS here).
- **A slower machine.** On a 2x throttled main thread the Revelations' motifs are missed and the epilogue's needs
  about a minute on the Revelation (above); the level's own sounds were not all baked after 92 s of play either.
  The render itself is the cost (3.1–3.7 s of main thread for one motif); a cheaper render (stop a partial once it
  has decayed out of hearing) or a bake in a Worker would help every moment there; neither was in scope.
  *Update, same day: the render is about 4.5 times cheaper with the very same samples (no partial culled), and
  the motifs render in a Web Worker; see* Slow computers *below.*

## Slow computers (2026-10-23)

**The problem** (*Epilogue motif bake*, above). On a main thread twice as slow the story's motifs were missed: the
render was the cost (the epilogue's 34.2 s of felt piano took 3.1–3.7 s of main-thread work), and two queue edge
cases could lose a motif's priority or spend the bake on a motif nobody waited for. Measured again today before any
change, on the same laptop and browser (HEAD `cd4357b`, Chrome 155 `--headless=new --mute-audio`, 1280 × 720,
Windows 11, seed 42, `node scripts/audio-e2e.mjs --serve --port 5399`; times in UTC; nothing was listened to):

- S11E with `--cpu-throttle 2` and the standard 20 s read (10:17): 13 checks pass, 7 fail. The chapter 8 card's
  motif started 3.6 s after the card (13 "not baked" looks; on time is +1.2 s); **chapter 1's Revelation motif,
  chapter 9's and the epilogue's were all missed**; chapter 9's set had 25 entries pending at the run's end, the
  two motifs among them.
- EPI at normal speed (10:15), the worst case (the epilogue's motif dropped and asked for again as the epilogue
  starts): baked 5.17 s after the epilogue's start, **3,581 ms of main-thread work**, the motif 5.28 s in (on time is
  4.5 s).

**What changed.**

1. **A cheaper render, the same samples** (`src/audio/synth/piano.ts`). Measured first under node: the per-sample
   loops ran inside the render's generators (so the bank can slice them), and there the engine ran them three to
   four times slower than the same loop in a plain function. Each partial's loop and the room's combs and
   all-passes now run in plain functions between the same yields, and a twinned partial's two strings share one
   loop (their envelope is the same; each string's sample is still added in the order the strings were written).
   The arithmetic and its order are unchanged, so **every motif renders to the very samples it rendered before**:
   the pcmHash of all seven renders the game plays is pinned from the old code (`motifRender.test.ts`), and S13
   checks it in Chrome on the main thread and in the worker. Nothing to listen for. Partial culling (stopping a
   partial once it has decayed out of hearing) was not needed and not tried: it would change the samples and need
   an ear.

   | Render (ms) | act1 | act1@0.94 | act2 | act3 | act3-bare | ch8 | **epilogue** |
   | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
   | node 24, before | 1,729–1,788 | 1,680–1,706 | 2,161–2,239 | 857–906 | 678–696 | 1,071–1,121 | **3,765–3,813** |
   | node 24, after | 281–397 | 296–320 | 391–399 | 179–185 | 147–162 | 215–219 | **673–716** |
   | Chrome main thread, after (S13, 10:41) | 394 | 312 | 409 | 192 | 159 | 223 | **757** |
   | Chrome worker, after (S13) | 418 | 376 | 440 | 209 | 151 | 209 | **677** |

   In the browser the epilogue's bake went from 3,581 ms of main-thread work (EPI before, above; 3.1–3.7 s in the
   earlier runs) to **693 ms** (EPI after, below): about 5 times less.
2. **Motifs in a Web Worker** (`motifRenderer.ts`, `motif.worker.ts`, `motifJob.ts`; Vite's `new Worker(new
   URL(..., import.meta.url), { type: 'module' })`). The bank sends a level set's motifs to it as soon as the set is
   asked for (the Story menu, the chapter card), one at a time and in its own order (a motif a moment waits for
   first); the worker renders and hashes, the samples come back without a copy, and the main thread only wraps
   them. No worker (node, jsdom, a page from `file://`, `?audioworker=off`) or a failed one (an error, no answer in
   30 s): the motifs bake in the main thread's slices as before, the cheaper render included. The samples and the
   bank's checksum are the same either way (S13; `bank.test.ts`, `motifRenderer.test.ts`).
3. **Edge case A**: the bank keeps a moment's request by key, so a motif dropped from the set and asked for again
   (a `prepare()` that drops and re-adds it) is raised again as it is added, and `bakeReport().bank.awaited` says
   what the bank really bakes first. `AudioManager.awaitMotif` no longer swallows a repeat of the same motif, and
   the moments ask again when the moment that wants it changes, so the epilogue, waiting for the motif chapter 9's
   Revelation asked for as the next one, asks for it itself: its own trace line.
4. **Edge case B**: `prioritize(null)` (or another motif) sets a bake of the released motif in progress aside like
   any other, so the queue's own order resumes (the level's sounds first) and the rest of it bakes when its turn
   comes, sample for sample the same.
5. **The driver**: EPI's worst-case check now looks at the epilogue's own trace line (after a mark set just before
   the drop) and at the bank's `awaited` right after the re-add and at the epilogue's start; EPI runs with
   `?audioworker=off` (it measures the main thread's bake and its frame cost) and asks for eleven extra renders (with
   the cheaper render five no longer kept a 4 s window busy); the new **EPIW** runs that worst case as the game
   ships, with the worker. Under `--cpu-throttle N` every page gets `?audioworkerslow=N`: DevTools CPU throttling
   slows the page's main thread only (measured: a loop in a worker ran at full speed with the page at 2x) and a
   worker target refuses it ("Operation is only supported for pages, not workers"), so the worker stays busy N times
   as long, as a thread that much slower would. `--audio-worker off` loads every page without the worker. S11E
   checks chapter 9's Revelation motif once its moment has stopped waiting (5 s into the read, not at the run's end:
   a motif baked inside its wait is only scheduled then). The app's first render may take 180 s (a fresh server
   pre-bundles its dependencies; 60 s was exceeded once), with a message that says so. S13 checks every motif's
   hash in Chrome.

### S11E with the main thread twice as slow (the target)

`--only S11E --cpu-throttle 2`, the standard 20 s read, the worker slowed 2x as well. "Baked" is wall seconds from
chapter 9's start; a motif's entry is its start after its moment (on time: the card +1.2 s, a Revelation +4.0 s, the
epilogue +4.5 s).

| Run (UTC) | ch8 card | ch1 Revelation | Chapter 9 play | act3-bare baked | Epilogue motif baked | ch9 Revelation | **Epilogue** | Checks |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| before, 10:17 | 3.6 s | **missed** | 9.9 s | never | never | **missed** | **missed** | 13 pass, 7 fail |
| 10:42 | +1.2 s | +4.0 s | 9.7 s | 5.5 s | 8.3 s | +4.0 s | **+4.5 s** | 20 pass |
| 10:45 | +1.2 s | +4.0 s | 9.9 s | 5.6 s | 8.4 s | +4.0 s | **+4.5 s** | 20 pass |
| 10:48 | +1.2 s | +4.0 s | 9.8 s | 5.5 s | 8.4 s | +4.0 s | **+4.5 s** | 20 pass |

**3 of 3**: every motif on time; chapter 9's two motifs were baked before its play began. The worker rendered the
five motifs of a run in 3.7–3.8 s of its own time (at the 2x slowdown). The main thread was never asked to hurry
for a motif (0 s at a moment's loading pace, against 39 s before).

Without the worker (`--audio-worker off`, the cheaper render on the throttled main thread alone; 11:29): 20 of 20
checks. The card's motif on time; chapter 1's baked 0.9 s into its moment's wait and started on time; chapter 9's
baked 3.1 s into its 4.5 s wait and started 0.8 s late (scheduled at the retry after the bake; the retry timers run
late on the throttled thread); the epilogue's baked during the read, 7.3 s before the epilogue began, and started
on time. An earlier run of the same (11:18, before S11E's check was moved after the moment's wait) played all four
too (chapter 9's from 2.6 s into its wait), but the old check had read the trace at the run's end and failed it. So
without a worker it holds on this laptop at 2x, with less margin.

Not fixed: on the throttled main thread **the level's own sounds** still lag. In every 2x run chapter 9's set had 10
entries pending at the run's end (25 before, the two motifs among them) and 9 at the epilogue's start, and one
sound was dropped as `notReady` in chapter 9's play. Play gets about 21 ms of bake a second at 2x (1.96 s of work in
95 s of play, in 4 ms slices, as before). That is the recipes' own cost, not the motifs'; their loops could be moved
out of their generators the same way (not done here).

### At normal speed nothing got worse

| Run (UTC) | ch8 card | ch1 | act3-bare baked | Epilogue motif baked (was 46–54 s) | ch9 Revelation | Epilogue | Pending at the run's end | notReady | Checks |
| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: | --- |
| S11E 10:52 | +1.2 s | +4.0 s | 3.2 s | **3.2 s** | +4.0 s | +4.5 s | 0 | 0 | 20 pass |
| S11E 10:55 | +1.2 s | +4.0 s | 3.3 s | **4.0 s** | +4.0 s | +4.5 s | 0 | 0 | 20 pass |
| S11E 10:57 | +1.2 s | +4.0 s | 3.3 s | **3.4 s** | +4.0 s | +4.5 s | 0 | 0 | 20 pass |

Chapter 9's play began 4.5–4.7 s in: both its motifs are now baked before it (the worker's five renders took
1.8–2.0 s of its time). The epilogue's motif read −48.1 to −48.4 dBFS RMS on the music bus (as in the runs above:
the motif is the same), the ambience under it −47.4 to −48.3 this time (−44.9 to −46.3 in the runs above, −39.7 to
−40.5 in the throttled runs: the sea's level varies with the run; nothing here touches the ambience).

**EPI and EPIW, the worst case** (the epilogue's motif dropped and asked for again in the task that starts the
epilogue; nothing else pending):

| Run (UTC) | Path | Baked after the epilogue's start | Main-thread bake work | Worker | **Motif starts** (audio clock; on time 4.5 s) | Checks |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| EPI before, 10:15 | main thread | 5.17 s | **3,581 ms** | | 5.28 s | 8 pass |
| EPI 11:23 | main thread (`?audioworker=off`) | 1.04 s | **693 ms** | | **4.62 s** | 10 pass |
| EPIW 11:25 | worker | 0.71 s | **0 ms** | 721 ms | **4.53 s** | 10 pass |
| EPI 2x, 11:15 | main thread, throttled 2x | 8.55 s | 2,167 ms | | 8.76 s (inside the 15 s wait) | 10 pass |
| EPI 2x, 13:25 (the verifier, a busier machine) | main thread, throttled 2x | 14.83 s | 2,828 ms | | **15.04 s** (the 15 s wait all but used up) | 10 pass |
| EPIW 2x, 11:27 | worker, both slowed 2x | 1.22 s | **0 ms** | 1,405 ms | 4.76 s | 10 pass |

On the main-thread path at 2x the 15 s wait is the margin, and on a busier machine it was nearly all used: the
verifier's run (the Revelation at 30 frames a second with nothing to bake, against 59 in the 11:15 run) started the
motif at +15.04 s, inside the check's 15 s plus 0.3 s. With the worker, the path every browser that can run a module
worker takes, the same worst case started the motif at +4.97 s in the verifier's run.

Every run after the change passed the new checks: the bank still held the epilogue's motif first right after the
drop and at the epilogue's start (`bank.awaited` "epilogue@1": edge case A), and the epilogue's own ask came after
the mark, at the loading pace, and was let go once the motif played. Before this change EPI's worst case missed the
motif at 2x. With the worker the motif was baked well before its start time even at 2x; it started 0.26 s late there
only because the moment's retry timers (every 250 ms) ran late on the throttled main thread.

EPI's frame time on the Revelation (11:23; rAF intervals, 4 s windows; the pace logic is unchanged): nothing to bake
212 frames, mean 18.9 ms; work pending at the idle pace 205–213 frames, mean 18.9–19.5 ms, 164 ms of bake a second;
at the loading pace 184–191 frames, mean 21.0–21.8 ms, 718 ms a second; median 16.7 ms in every window (before:
191–213 and 178–185 frames, 674–723 ms a second). With the worker the main thread does none of a motif's work: in
EPIW's wait the bake took 0 ms of it (194 frames in the first 4 s, mean 20.6 ms).

S1 (autoplay): 8 of 8 (10:41, 11:03). S13: 7 of 7 (10:41): the bank checksum 74a0ca9e as before, and every motif
renders to node's pinned samples on Chrome's main thread and in the worker. S12 (Arcade in play against
`?audio=off`; no motif, no worker, the in-play pace unchanged): 3 of 3 twice (11:32 and 11:39): median frame
16.85 ms against 16.9 (−0.05 ms) and 16.8 against 16.9 (−0.1 ms; the check asks for at most 0.3), the engine's
`frame()` median and p99 0 ms. A first run (11:03) failed the A/B the other way: the `?audio=off` baseline ran at
30 frames a second in three of its four runs (median 33 ms against 16.85 with the sound on), machine noise with
other work running; it is kept in the check lists.

Unit tests: `npx tsc --noEmit` clean; `npx vitest run` on the 15 files the change touches or depends on, 162 tests
pass.
The new tests fail without their fix (each checked by undoing it): `bank.test.ts` edge case A (a re-added entry
keeps its priority) and B (`prioritize(null)` resumes the queue's order before the set-aside motif, which then
finishes sample for sample the same); `motifBake.test.ts` the EPI worst case on the real engine and bank (the drop
before and during the epilogue's wait; its own ask on the trace); `motifRender.test.ts` the render (the old
per-sample loop is kept in the test: the new one gives its samples exactly and is more than twice as fast, 6–7x
measured for the notes). `motifRenderer.test.ts` covers the worker's job and every way a worker can fail;
`bank.test.ts` the bank with a renderer (the main thread never renders a motif, the same checksum, a failed worker
falls back, a reply for a dropped or replaced motif).

The check lists are in `audio/slow-computers/`.

### Still open

- **The level's own sounds on a slow machine** (above): at 2x chapter 9's set was 10 entries short at the run's end
  and one sound was dropped in play. The recipes have the same generator-loop cost the piano had.
- **A slow machine with few cores.** The worker was slowed with `?audioworkerslow` because DevTools cannot throttle
  it; on a real two-core machine it would also compete with the main thread for a core. The verifier approximated
  one by restricting Chrome to two cores with the 2x throttle, which loses most of its effect there (the old code
  also passed 20/20), so it says little. One thing it did show: chapter 8's card motif came back from the worker
  3.1 s late during page load and was missed once in four runs. Since 934cd75 a card's motif bakes on the main
  thread; in those runs it was then 0.01, 1.49 and 1.86 s late, never missed. A real slow machine is not measured.
- **`file://` and browsers without module workers** take the main-thread path; it is measured here only through
  `?audioworker=off` (unit tests cover a worker that cannot start).
- **Nobody has listened.** No sample changed, so there is nothing new to judge in the render; the listening
  questions of the sections above stand (a late motif, the epilogue motif's level against the sea).

## Trees, stones and log piles (2026-10-23, playtest)

**The report.** The student, playtesting: "similar to the house breaking i want trees to have a sound effect as well
and stones and logs". Measured before any change on HEAD `5746ad0` of `feature/last-thaw` (its own worktree, Vite on
port 5702 with its own dependency cache), then on the change. Two kinds of runs, both seed 42; **nothing was listened
to**:

- **Browser**: headless Chrome 155 (`--headless=new`, ANGLE D3D11, 1280 × 720, Windows 11), the real game, engine
  and bank, driven over CDP with a seeker that steers at the obstacles wanted (the autopilot's lane at the next
  placement, or `setSteer` at the nearest body of the kinds asked for, read from the running `GameSession`; the
  seeker gets the iceberg stuck now and then, so some runs end early). For each event the trace
  (`__icebergAudio.trace`) gives what was played, its level as played (with distance and density) and every drop;
  each event's play entries were then rendered offline by the lab (`lab().renderMix`: the real strips, space,
  limiter and makeup, every slider at 1, so 1.9 dB above the game's default effects at 80 %) and measured as
  **LUFS momentary max** (400 ms). The meters gave the bed: the buses with no effect sounding. Before: 13 level
  runs (Arcade Mountain Valley, Rocky Canyon, Ravine Run, Glacier Avalanche, Alpine Pass, Riverside Town; Story
  chapters 1 and 2). After: 18 (the same, plus passes seeking only trees, only rocks and barriers, and the Mountain
  Valley barrier in Arcade and in chapter 1).
- **Node**: the real `WebAudioManager` on the recording fake context, the real bank baked synchronously, the real
  bridge on `GameSession` (Rapier) with the same seeker and a camera 30 m behind and 15 m above; each request's
  layers mixed from the baked buffers at their played levels and measured the same way. Eleven runs of 50–70 s on
  six levels, identical before and after (and four more aimed at the barriers after).

### Why they were not heard

1. **They triggered and they played.** Every felled tree, broken log pile, stone barrier hit and rock hit ended in a
   `play` entry, in both kinds of run. The drops in the browser runs were 9 `culled` (splashes 935–1,570 m away),
   1 `rate` (an ice absorb) and `quiet` grazes (m < 0.08); never one of these. At most 5 effect voices sounded, so
   the busy rule (P3 hits refused at 12 voices) never applied; neither did a family rate, a voice cap or the trees'
   level-of-detail rule (the third tree in a second plays only its crack). The camera was 17–36 m from them, inside
   the 40 m reference distance: no distance loss.
2. **Sound ids.** A felled tree: `hit.wood`, then `tree.fall.pine` (no broadleaf was felled in any run). A log pile:
   `hit.wood`, then `timber.break.medium`, the footbridge's snap and thump. A stone barrier's first hard hit:
   `stone.scatter` alone, at the hit's level. A rock: its hit only (`hit.stone.light`, or the heavy one with the
   weight above m 0.55), 60–120 ms long.
3. **Levels**, as played (the loudest layer) and as heard (LUFS-M max of the request); n is browser / node:

   | Event (before) | n | Loudest layer, dBFS | Browser LUFS-M, median (range) | Node LUFS-M, median (range) | Under a house collapse |
   | --- | ---: | --- | --- | --- | --- |
   | House collapse (the reference) | 2 / 2 | −15.2 | −24.7 (−25.9 to −24.7) | −26.5 (−27.8 to −26.5) | 0 |
   | Tree felled | 2 / 6 | −16.5 | −32.3 (−33.8 to −32.3) | −35.9 (−38.2 to −34.5) | 8–9 LU |
   | Log pile broken | 1 / 7 | −17.6 | −32.1 | −36.0 (−36.9 to −34.4) | 7–9 LU |
   | Stone barrier, first hard hit | 0 / 1 | −21.2 (node) | | −40.7 (m 0.62) | 14 LU |
   | Rock hit | 31 / 31 | −30.8 | −50.8 (−57.7 to −33.4) | −54.4 (−59.1 to −37.3) | 26–28 LU |
   | Tree hit that holds | 6 / 11 | −32.7 | −50.7 | −52.3 | 26 LU |

4. **The bed they had to clear.** With no effect sounding the master read −34.1 dBFS RMS in the median (Alpine Pass
   −27.3, Glacier Avalanche −28.8, Rocky Canyon −33.7, Ravine Run −35.4, Mountain Valley −36.2, Riverside Town −38.4;
   ambience −36.3, the iceberg's slide −38.0), and the recording plays on top, outside the meters, at about −28.5
   LUFS (`wonder` at `el.volume` 0.48). A house collapse rose 8–10 dB above the bed and over the music; a felled
   tree or a log pile only reached the bed and stayed under the music; a rock stayed about 15 dB under the bed.
5. **Why so quiet.** The levels (`BREAK_LEVELS`, `HIT_LREF`) are peaks; a tree's peak was its crack, and its fall
   (creak, rustle, the ground) sat 10–20 dB under it, so at −17 dBFS peak a tree measured 9 LU under a house at
   −14. Its landing was a 250 Hz-low-passed brown-noise rumble with a 60 Hz sine: with everything below 150 Hz
   removed (laptop speakers) the old pine lost another 3.7–4.4 LU. A rock never had more than its knock. A stone
   barrier "breaking apart" played at the hit's level (−12 + 26·(m − 1)), not a break's. A log pile borrowed the
   footbridge's sound.

### What changed

- **Recipes** (`src/audio/synth/recipes/wood.ts`, `stone.ts`): the tree fall (2.2 s: the snap, the fibres ripping,
  the hinge, the creak, the crown swishing down faster and faster, the landing at 1.0–1.15 s with the trunk's thud
  and a bounce, the crown crashing, 6–10 branches snapping, twigs; everything that carries it above 130 Hz);
  `logs.tumble` (2.2 s, new: the blow on the stack, 10–16 log-on-log knocks each at its own pitch, dense then
  thinning, a rolling rumble turning 3–5 times a second, bark scraping, the last knocks at rest); `stone.scatter`
  reworked (1.3 s: cracks, a big block's knock, the blocks grinding, 3–6 blocks tumbling, a rumble, gravel);
  `stone.tumble` (1.6 s, new: the crack of the blow with fracture grit and chips, 5–7 knocks as the rock tumbles
  away, a rolling rumble, gravel). Each ends with `limitCrestSteps` (`blocks.ts`): peaks held within 12–13 dB of
  the loudest 400 ms, so a variant whose tallest click is sharper does not bake quieter (the new pine's two
  variants measured −19.8 and −15.9 LUFS per peak without it, −14.1 and −13.3 with it).

  | Buffer (peak 0 dBFS) | LUFS-M max, before | after | Audible (40 dB), s, before → after |
  | --- | --- | --- | --- |
  | `tree.fall.pine` | −19.1, −18.7 | −14.1, −13.3 | 1.6–1.7 → 1.6–1.7 |
  | `tree.fall.broadleaf` | −15.6, −16.6 | −13.5, −13.2 | 1.6–1.8 → 1.7–1.8 |
  | log pile: `timber.break.medium` → `logs.tumble` | −17.8, −17.6 | −12.6, −13.8 | 0.7 → 1.9–2.0 |
  | `stone.scatter` | −19.6, −19.0 | −13.4, −13.3 | 0.7 → 1.0 |
  | rock: nothing → `stone.tumble` | | −15.4, −16.2, −16.9 | → 1.2–1.3 |
  | `house.collapse` (unchanged) | −12.3, −12.0, −13.5 | | 3.1 |

- **Levels** (`contract.ts` `BREAK_LEVELS`, with a new optional `ceil`): the trees −15.5 dBFS at their typical M
  (ceiling −14), `logs.tumble` −16 at M 0.38 (−14), `stone.scatter` −16.5 at 0.48 (−16), `stone.tumble` −14.25 at
  0.36 (−14). Set from the mixes in `recipes.test.ts`: at a typical impact each is 2.2–2.8 LU under a house
  collapse at its typical level (a 4 t rock 4.0, a 0.8 t rock 6.9), and at its strongest (the hit at m 0.9, the
  main layer at its ceiling) none is above it, every variant, on full range and high-passed at 150 Hz.
- **Rules** (`router.ts`): F6, a barrier's first hard hit is the hit (with its weight), then `stone.scatter` 15 ms
  later at its break level; F6b, a rock or a barrier stone knocked moving (m ≥ 0.2 and impulse / mass ≥ 1 m/s) is
  the hit, then `stone.tumble`, pitched by the rock's mass (rate 1.2 − 0.35·W: 1.16 for 0.8 t, 0.98 for 22 t), once
  per placement in 1.5 s, and no more than three stone breaks a second (the family's rate): beyond that a rock is
  its plain hit, so its knock is never refused together with a tumble. A log pile breaks with `logs.tumble`.
- **Limits**: `scatter` 6 voices, 3 requests a second (burst 3), 1.5 s per key; `tree` 6 voices; `breakLight` 4.
  The bake sets add `stone.tumble` wherever a rock or a barrier is placed and `logs.tumble` for log piles; chapter
  9 peaks at 19.54 MiB of the 22 MiB budget (was 19.1).

### After

The same measures. Browser (18 runs):

| Event (after) | n | Sounds | Loudest layer, dBFS | LUFS-M, median (range) | Under the houses of the same runs |
| --- | ---: | --- | --- | --- | --- |
| House collapse (the reference) | 6 | `hit.masonry`, `house.collapse` | −14.4 | −23.9 (−25.8 to −22.9) | 0 |
| Tree felled | 6 | `hit.wood`, `tree.fall.pine` | −14.8 | −25.7 (−27.1 to −24.5) | 1.8 LU |
| Log pile broken | 5 | `hit.wood`, `logs.tumble` | −15.6 | −26.4 (−27.3 to −24.9) | 2.5 LU |
| Stone barrier breaks apart | 2 | the hit, its weight, `stone.scatter`, the ice | −16.9 | −26.8, −27.0 | 2.9 LU |
| Rock knocked loose | 28 | the hit (and its weight), `stone.tumble` | −14.5 | −27.4 (−32.7 to −26.2) | 3.5 LU |
| Rock hit, not knocked loose | 29 | the hit | −32.6 | −52.2 | unchanged |
| Tree hit that holds | 12 | `hit.wood` | −31.7 | −50.1 | unchanged |

Node (the same eleven runs; houses −26.5 and −27.8): felled trees −29.0 (−30.9 to −27.7, n 6), log piles −29.0
(−31.5 to −28.0, n 7), rocks knocked loose −31.2 (−34.4 to −29.2; 18 of 31 rock hits; the other 13 were grazes or
rocks that barely moved, −55.0); in four more runs at the barriers, four barriers broke apart at −28.1 to −29.5.
Nothing was dropped. Against the bed (median master RMS −33.1 dBFS in these runs) a felled tree now stands about as
far above it as a house collapse did before. The loudest felled tree (−24.5, a 2.5 t pine hit hard) measured louder
than the quietest house collapse of the runs (−25.8, a lighter hit): the ceiling compares with a house at its
typical impact, not with every house.

**The mix rules.** A storm through the real `FrameResolver`, voice pool and graph (`AudioGraph` with its limiter, an
`OfflineAudioContext` at 48 kHz in Chrome, every slider at 1): eight pines felled in a second, ten cluster rocks and
ten small rocks knocked loose, a barrier, two log piles and a house, a graze every frame, then at 2 s one
fastForward-like frame of 56 events (40 rocks and boulders, six trees, two log piles). 57 requests, 19 admitted
(40 layers: four full tree falls and four cracks by the level-of-detail rule, five tumbles, two log piles, the
house); refused: 20 by the frame cap (four requests a frame), 16 `busy` (P3 plain knocks with 12 or more voices
sounding, the minor-kind rule as before), 2 `rate`. At most 18 of 24 voices; peak −10.4 dBFS before and after the
limiter (threshold −3: it never acted, 0.0 dB of reduction), no clipped sample, LUFS-M max −21.0. Without the
three-a-second guard the same storm refused 13 requests for `rate`, each a rock's hit with its tumble: that is why
the guard is there. The ducks are untouched: `ducks.test.ts` passes, and the Story runs traced only `landmark
−10/−2/0`, `scar −0.25/0/0`, `fail −12/0/0` and `reading −6/−8/−12` dB.

**Tests**: `recipes.test.ts` (each typical request 1.5–4 LU under a house, a 4 t rock 2.5–5.5, a small rock 5–9;
the strongest never above it, every variant; on laptop speakers within 6 LU; a tree snaps and lands a second apart
with no gap in its fall, logs knock at least eight times, a tumble at least four times), `router.test.ts` (F6, F6b,
the three-a-second guard, the log pile), `magnitude.test.ts` (the worked rows, the ceilings, the tumble's rate and
gate), `packages.integration.test.ts` (the budgets). `npx tsc --noEmit` is clean and every audio test passes. The
full suite had one failure, `src/core/terrain/mountain.test.ts`'s build-time bound (297 ms against 250) while the
whole suite and a dev server ran; it passed alone, and the change does not touch terrain.

### Still open

- **Nobody has listened.** Whether the tree reads as wood snapping and then a tree falling, the log pile as logs
  rolling, a tumble as stone, and each as distinct from a house; on laptop speakers and on headphones.
- **Rocks are now about as present as a tree.** In Rocky Canyon and Ravine Run the iceberg knocks many: at most
  three a second and once per rock (or cluster) in 1.5 s, but whether that tires the ear over a whole level is for
  a listener.
- **A broadleaf was never felled** in the runs; its recipe and levels are measured in node only.
- **Not changed**: a tree that holds a hit, a loose log knocked after its pile broke, and a graze keep their short
  knock (26 LU under a house).
