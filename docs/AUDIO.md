# Sound in Iceberg River

What the player hears, how it is built, how to drive it and how it was checked. The agreed design, with
its reasoning and every formula, is `docs/AUDIO_DESIGN.md`; the frozen shared types and tables are
`src/audio/contract.ts`. This file describes what was built. Sources and licences: `docs/AUDIO_CREDITS.md`
(sound) and `docs/MUSIC_CREDITS.md` (the six recordings).

The sound was built in three packages against one contract: **A**, the engine (the `AudioManager`, its
channels, voices, limits, ducks and the music router); **B**, the synthesis (every effect, ambience voice,
bell and the felt piano, baked in TypeScript); **C**, the bridge from the game and the story to the engine,
the music direction, the settings UI, these docs and the browser checks. The sections below say which
package owns what. The three were merged and wired together on 2026-10-22 (*Integration*, at the end);
the numbers under *Evidence (package C)* were measured before that, against a recording engine, and the
integrated smoke run is under *Evidence (integrated)*.

## What you hear

**Arcade Mode** has music and sound effects. The game screen plays the `wonder` cue (Mozart's K.545
Allegro, then Chopin's A-minor waltz when it ends), 2 dB under the effects. It continues across Retry and
level changes and fades out over 3 s when you leave for a menu; the menus stay silent. Every collision,
break, splash and landing has its sound, scaled by the real impact. A felled tree snaps and falls, a log
pile's logs knock and roll away, a stone barrier breaks apart and a rock knocked loose cracks and tumbles off,
each about as clear as a house collapse and never louder (since the playtest of 2026-10-23; *Evidence
(trees, stones and log piles)* below). Church bells ring wherever a level has a church, and the approach hour
strikes **three**.

**Story Mode** is the same physical world, sounded as a quiet tragedy. The six recordings are
loudness-matched, and each chapter's sits a little lower than the last (0 dB in Act I to −5 dB in Act III),
and after every loss that matters the music takes a breath and comes back a little lower for the rest of the
attempt. In Act III the piano does not
enter until the opening caption has gone: the flyover is wind, water and ice. The approach hour strikes
**six** ("at ten past six", chapter 4). When a church tower falls, its bell stops, mid-count if it was
striking, and the music drops by 14 dB for ten seconds: the moment is the absence. After a run, if a
document written, remembered or photographed by a person surfaced, the recording fades out and an original
piano motif, *No. 14*, plays alone. There are no voices, no sirens, no explosions and no stingers anywhere.

## Controls

| Control | Where | What it does |
| --- | --- | --- |
| Master volume | Settings → Sound | Everything, recorded music included (default 100 %) |
| Music volume | Settings → Sound | The recordings and the motif (default 60 %) |
| Ambience volume | Settings → Sound | River, waterfalls, sea, wind, church bells (default 80 %) |
| Effects volume | Settings → Sound | Collisions, breaking structures, splashes, the iceberg's slide (default 80 %) |
| Mute music | Settings → Sound | Silences the music only |
| Mute all sound | Settings → Sound, or **M** anywhere but a text field | Silences everything, keeps the volumes; M is announced ("Sound off" / "Sound on") |

The sliders are linear in amplitude, like the music slider always was, step 5 % with the arrow keys and
read out as "NN percent". Letting go of the Effects or Ambience slider (pointer up, or a key that moved it)
asks the engine for a preview of that channel, at most every 0.4 s: a stone knock 30 m away, or St Bride's
bell at 120 m, with the music dipped while it plays (`audio.preview`, package A). The bank keeps St Bride's strike
with its core sounds, so the bell preview works from a cold start, before any level has been played. M is ignored
with Ctrl, Alt or Meta, where a letter types or picks something (a text field, a select's type-ahead, editable
text), on key repeat and during the screen transition; on a focused slider, checkbox, radio button or button it
works, since letters mean nothing there. Settings live in `iceberg-river.settings.v1`; older saves
pick up the defaults, and wrong-typed or out-of-range values fall back to them.

**Pause** (Esc, P, the button, a lost window focus or a hidden tab) dips the music 8 dB and gates effects and
ambience; their sources keep running, so nothing restarts on resume. **A hidden tab** pauses the music and
suspends the audio. **Autoplay:** nothing is created before your first click, tap or key press; that gesture
unlocks both the music and the engine. **Leaving** an attempt (Retry, a level change, quitting, the "3D view
stopped" dialog) fades everything of that attempt out within 0.15 s.

## How it fits together

```
App (React)
  useAudioDirector (C)  settings → levels, unlock on the first gesture, hidden tab, the cue and the bed
                        per screen, the bake set of the level most likely next (asked for on the
                        menus, before any gesture), the loading overlay, the Archive's moments, M
        │ audioEngine(): package A's `audio` singleton (tests install a recording fake)
        ▼
  AudioManager (A)  music router over the existing HTMLAudio player · effects / ambience / motif buses,
                    limiter · voice pool, limits, ducks · sound bank (B) · one SessionAudio per attempt
GameView (R3F)
  <GameAudio/> (C), right after <CameraRig/>: one SessionBridge per attempt
     session.events ─► event ring ─► frame resolver ─► SessionAudio.play()      (one-shots)
     iceberg / river / water / sea state ─► ambience inputs ─► B's live voices  (loops)
     church towers ─► bell scheduler ─► SessionAudio.playBell()
     Story: its own points tracker ─► landmark, church, aftermath, scar, dam, sea ducks
```

**Audio only listens.** The bridge subscribes to the session's event stream and reads its state; it never
writes to the session, its bodies or its events. `src/audio/game/listenOnly.test.ts` runs the real
`GameSession` (terrain, Rapier, river, water) on autopilot for 40 s, once with nothing listening and once
with the whole bridge, on Mountain Valley (Arcade), Riverside Town (Story chapter 4) and Rocky Canyon with the
full intro (flyover and calving first): the iceberg, the stats, the events, the route, the river and the physics
stats come out **bit-identical**. A listener that
throws is caught; after five errors the bridge goes quiet for that attempt (one console warning), so a bug in
the sound can never become the "3D view stopped" dialog.

### Package C's files

| File | What |
| --- | --- |
| `src/audio/game/engine.ts` | The port: `audioEngine()` returns package A's `audio` (the Null manager where there is no Web Audio, which still drives the recorded music); `installAudioEngine()` lets a test put a recording manager in its place |
| `src/audio/game/eventRing.ts` | The session listener: a 128-slot ring of preallocated events, the body looked up at listen time (placement, part, mass), the gone-rock kind cache; on overflow the least important entry is replaced and counted |
| `src/audio/game/magnitude.ts` | The impact model (below), pure |
| `src/audio/game/router.ts` | The frame resolver: rules F1–F11, pooled requests, sorted by priority × loudness |
| `src/audio/game/ambienceInputs.ts` | Scrape (30 Hz), wind, river and sea (10 Hz), ground under the ice (5 Hz), the terrain wall detector |
| `src/audio/game/waterSources.ts` | Waterfalls (where water really crosses a drop), the dam-break flood, the dam's moment |
| `src/audio/game/bells.ts` | Church towers, the bell scheduler (a turret clock), shiver, silence, clank |
| `src/audio/game/calving.ts` | The intro's calving, read from the session's intro clock (P1) |
| `src/audio/game/levelSet.ts` | Each level's bake set: core, the kinds it places (and the Story overlay's), its bells, the chapter's motifs |
| `src/audio/game/sessionBridge.ts` | One attempt's sound, without React (the 3D view and the headless tests run the same object) |
| `src/audio/story/human.ts` | Which documents are human |
| `src/audio/story/storyAudio.ts` | Story inside an attempt: landmark, church, aftermath, scar, dam, sea, Act III entry |
| `src/audio/story/moments.ts` | Story after an attempt: the Revelation, the epilogue, the chapter 8 card |
| `src/render/GameAudio.tsx` | Mounts the bridge after `CameraRig`, attempt-scoped, ends it on unmount |
| `src/ui/audio/useAudioDirector.ts` | The app-level director and the M key's live region |
| `src/ui/story/music.ts` | Which cue and which bed play on which screen |
| `src/audio/game/testing/*` | Recording fakes of the contract's `AudioManager` / `SessionAudio`, headless runs |
| `scripts/audio-e2e.mjs` | The browser checks (below) |

## Events to sounds

The resolver runs once per animation frame, after the game loop and the camera. Every event ends in the
trace: played, merged into another request, or dropped with a reason (`quiet`, `masked`, `frameCap`,
`overflow`, …).

| Event | Sound |
| --- | --- |
| `collision` | The kind's hit (`KIND_SOUNDS`: stone light / heavy, ice, wood, metal panel / heavy, masonry), the heavy variant from m 0.55; a weight thump above m 0.55; the iceberg's own ice layer from m 0.3; a pane of glass on vehicles hit hard. **Stones** (F6, F6b): a stone barrier's first real hit (m ≥ 0.45) is the hit, then `stone.scatter` 15 ms later at its break level (it breaks apart without a break event; once per barrier in 2 s); a rock or a barrier stone **knocked moving** (m ≥ 0.2 and at least 1 m/s given to it: impulse / its mass) is the hit, then `stone.tumble` (the crack, then the rock tumbling away), pitched by its mass, once per placement in 1.5 s. A graze, or a boulder that barely moved, is the hit alone |
| `obstacleBroken` | The kind's break: house collapse (timber, glass that gives way, slump, settle), timber collapse, masonry small / large (stained glass for churches), metal light / vehicle / structure (groan and rivets, plus machinery winding down and liquid release where they apply), the dam break (concrete and the rush that hands over to the flood), a **log pile**'s logs knocking on each other and rolling away (`logs.tumble`). The hit that caused it is layer 0, the break 15 ms later. A church's or a dam's several bodies are one break, plus at most two add-ons. Story adds a quiet debris settle |
| `treeFelled` | Pine or broadleaf **fall**: the wood snapping (the snap, the fibres ripping, the hinge giving way), the creak of the lean, the crown swishing down, the landing (the trunk's thud and bounce, the crown crashing, branches snapping); from the third tree in a second only the crack |
| `splash` | Small / medium / large by intensity, merged over 120 ms |
| `landed` | Ice on ground or on water by mass × drop; silent under 0.4 m |
| `waterfallCrossed` | The plunge (replaces that frame's landing) |
| `enteredOcean` | The ocean entry once, and the next wave moves back so the two never double up |
| `iceChipped` | Ice pings, as a layer on the hit that caused them, masked under a hard hit |
| `absorbed` | The glacier-ice crunch, merged over 100 ms |
| Terrain wall or bank (no event) | `ice.wallScrape`, from a rise in the iceberg's impact with no collision or landing that frame |
| The intro's calving (no event: the intro clock) | The ice groaning at the shudder (the full calving only), the crack at the break (−16 dBFS), the landing at m 0.7, all with the act's larger calving echo send (`ChapterMix.calveSend`); Retry's short beat keeps only the crack and the landing. A key the clock skips past (Space) is never played late |
| `airborne`, `complete`, `failed` | No one-shot: the scrape cuts, the phase drives the ducks |

### Magnitude: small collisions quiet and light, failures heavy

```
collision  m = clamp01(0.75·ln(1+J)/ln(1501) + 0.25·min(1, v/25)·min(1, ln(1+J)/ln(21)))
           J impulse (t·m/s), v closing speed; the speed counts as far as the contact moved momentum
           silent below 0.08; level = Lref + 26·(m − 1) dBFS; rate 1.06 − 0.12·m; low-pass 1500·2^(3.2·m) Hz
break      M = clamp01(0.7·W + 0.3·mHit), W = log10(1 + broken mass)/log10(151)
           level = clamp(ltyp + span·(M − mtyp), ltyp − 12, ceil ?? ltyp + 4); rate 1.05 − 0.10·M
stones     a barrier breaking apart or a rock or barrier stone knocked moving (F6, F6b): the break level
           with M = stoneM = clamp01(0.1·W + 0.9·m), the hit weighing most (its m already grows with the
           stone's mass through J); a tumble at rate 1.2 − 0.35·W (a small rock higher), once per placement in 1.5 s
```

So a roll-back tap (J 2, v 2) peaks at −34.9 dBFS, a pine that holds at −27.9, a house that holds at −20.6,
a house collapse at about −14 and a dam break at −9: a light tap sits about 20 dB below a house collapse
and 26 dB below a dam, and the big sounds also last ten to twenty times longer. The worked tables of
`AUDIO_DESIGN.md` §6.2 are pinned by `magnitude.test.ts` (±0.01 in m, ±0.2 dB), except the rows the playtest
of 2026-10-23 changed (below).

**Trees, log piles and stones** (`BREAK_LEVELS`, since the playtest): a felled pine at −15.5 dBFS (was
−17.0), a log pile at −15.9 (it played the footbridge's `timber.break.medium` at −18.5), a stone barrier
breaking apart at −16.4 (it played `stone.scatter` at the hit's own level, −21.9 at m 0.62), a 4 t rock
tumbling at −14.4 and a 0.8 t one at −17.8 (a rock had nothing but its knock, 60–120 ms long, −31 dBFS as
played in the median). Levels are peaks, and these sounds are denser than a knock, so what counts is loudness:
at a typical impact each is **2.2–2.8 LU under a house collapse** at its typical level (a 4 t rock 4.2, a small
rock 7.8), and each has a **ceiling** (`BreakLevel.ceil`: −14 for the trees and the log pile, −16 for the
barrier, −14 for a tumble) that keeps it, with the hardest hit that comes with it (m 0.9), **at or under a house
collapse**; `recipes.test.ts` mixes the router's requests and checks both, every variant, on full range and
with everything below 150 Hz removed (laptop speakers). Above their typical impact they grow by at most 0.4–2
dB (a tumble 0.4, the barrier 0.4, the trees 1.5, the log pile 2; the hit under them grows with m as before);
below it they fall away like every other break.

**A knocked rock follows its knock** (review of 2026-10-24). With the break mapping's M = 0.7·W + 0.3·m a
boulder (22 t, W 0.62) tumbled at the −14 ceiling from the knock threshold up, an 8 t cluster from m 0.3 and a
4 t rock from m 0.6: a nudge that barely moved a boulder (m 0.34) mixed within 1 LU of a full-speed strike
(m 0.71), and the sound jumped about 19 dB at the threshold. The stones now take `stoneM` (0.1·W + 0.9·m) with
`stone.tumble` at −14.4 for M 0.437 (span 22) and `stone.scatter` at −16.4 for M 0.6 (span 20), so the typical
levels stay and the tumble follows the hit: a 4 t rock knocked at m 0.2 plays at −19.4, 5 dB under one knocked
at m 0.45, and a boulder reaches the ceiling only from m 0.44. Mixed with its hit (`recipes.test.ts`), a
boulder nudged at m 0.34 sits 5.4 LU under a house collapse and one struck at m 0.71 2.8 LU under (2.6 LU
apart, was under 1); a 4 t rock rises from 9.1 LU under at m 0.2 to 4.2 at m 0.45. Between m 0.45 and 0.6 a
boulder stays level (its tumble at the ceiling, its hit still quiet).

The last factor of `m` came out of the browser runs (S4, `docs/evidence/AUDIO_RUNS.md`): with the speed term
simply added, a fence or a chalet brushed at 25 m/s that moved almost no momentum (J 0.03–2.9) played as
loud as a real knock, above a car pushed hard, and the rank correlation of impulse with level was 0.76–0.86
against the design's 0.9. The speed now counts in proportion to the impulse up to J 20 (`jGate`; a pine
that holds is J 23), fully above it: a hard knock at speed is still louder and brighter than the same knock
slow, and a graze is a tap.

`EVENT_MAG.chipAmountRef` is 0.4: the 95th percentile of `amount` over headless autopilot runs of all
nine levels (29 chips; median 0.034, p95 0.417). The design's 0.004 was a placeholder below nearly every
real chip (a 10 m/s knock already chips 0.045 of an iceberg), so every chip would have played at its
loudest; the contract was changed at integration, and `integration.test.ts` pins it.

### Repetition and density

Package A applies per-family limits and jitter (`FAMILY_LIMITS`, `VARIATION`): seeded variant shuffle
bags with no immediate repeat, a few tens of cents of pitch and a decibel of level, 24 effect voices, 4
requests a frame, token buckets on audio time, stealing by priority and loudness (a structural failure is
never stolen except by another), and density compensation so a pile-up does not grow linearly. The bridge
adds its own bounds before that: the ring keeps the 128 most important events of a `fastForward` burst, a
frame builds at most its pool of requests, and every request has at most four layers. Since the playtest a
rock tumbles at most once per placement in 1.5 s (a cluster is one placement) and a barrier scatters once in
2 s; the `scatter` family (scatters and tumbles) has 6 voices, 3 requests a second (burst 3) and a 1.5 s
per-key interval, `tree` 6 voices and `breakLight` 4, so three felled trees or a log pile beside a fence
overlap without stealing each other.

## Ambience

| Layer | Input (C) | Rate |
| --- | --- | --- |
| Scrape and slide | the iceberg's own horizontal speed, grounded / afloat / airborne / wading, mass and radius (bigger is lower, faster is brighter, heavier has more rumble), the ground under it (grass, rock, sand, seabed, refined to asphalt, gravel or dirt where a road or track is painted) | 30 Hz; ground 5 Hz |
| Wind | the level's exposure (`LEVEL_WIND`), the act's colour, airborne speed | 10 Hz |
| River and streams | the newest river sample's flow, the flow at the listener, the inland water under the camera (depth, speed) | 10 Hz |
| Waterfalls | only where water crosses a drop (stream cells flagged as falls, the river trail's fall runs; a dry cliff is silent); the two loudest within 300 m, 15 % hysteresis, a third slot fades a reassigned one out over 1.5 s | sources every 0.5 s, slots every 0.25 s |
| Flood | the breached reservoir's outflow at the breach, the flood front downstream (the nearest cell above its steady depth, 256 cells a tick) | 10 Hz |
| Sea | proximity to the coast (heard from 260 m), at sea after `enteredOcean`, seaward pan | 10 Hz |
| Machines that run until destroyed | not built (P1) | |

## Church bells

Every church any level places rings: the pass chapel (Alpine Pass), St Bride's (Riverside Town), the
cracked Clachan kirk and the true lochside kirk (Highland Maze), the fjord chapel (Summit Labyrinth). The
Story overlays add no church; one that did would ring with St Bride's voicing. The bell sits at the tower
foot plus 15.5 m × the church's scale.

- **In the background**, all level: phrases of two to four strokes, never one, 45–75 s apart, the first
  6–14 s in (during the flyover when there is one), two churches at least 20 s apart, heard within 1.5 km.
- **The hour, on approach**, once per church per attempt, while playing: six strokes in Story, three in
  Arcade, timed to end before the iceberg arrives; never once it has passed the church.
- **A tower that holds a blow shivers**: the hum, prime and tierce only, no clapper. Nobody rang it.
- **A tower that falls stops the bell** in both modes: its ringing strikes are choked, a dull buried clank
  plays under the collapse 1.1 s later, and it never strikes again in that attempt. If it falls mid-hour the
  clock stops at, say, four (the trace says `bell-silenced p29 strikes=4 (mid-hour)`). No toll follows.
- Strokes live in session time, so a pause loses and doubles nothing and a `fastForward` never catches up.
- **A bell is never lost to the bake.** A level's strikes are the first thing its set bakes (70–80 ms of work), and
  a phrase or an hour whose strike is still baking waits for it (`SessionAudio.bellReady`); the trace says
  `bell-deferred p44 st-brides phrase (strike not baked)` and, when it can ring, `bell-ready p44 st-brides after
  N s`. An hour asked for in time strikes when its strike arrives, even if the iceberg has passed by then.

## Music

The six recordings stay on the existing HTMLAudio crossfade player (`src/audio/music.ts`), outside the
Web Audio graph, so the music still works where Web Audio is missing or locked. Package A's music router is
the only caller of the player: volume = master × music × 10^((bed + ducks)/20), ducks floored at −20 dB
during play, muted when either mute is on or the tab is hidden; a **hold** plays no cue at all (the player's
own 3 s fade-out) until it is released, and the piece resumes where it paused. Every duck and every bed is
≤ 0 dB. The holds' safety limits stop counting while the tab is hidden (the motif waits on the suspended audio
clock, so the recording must too).

**The recordings are loudness-matched** (`src/audio/tracks.ts`). As published they span 12.6 LU (the waltz
−19.80 LUFS-I, Moonlight −32.41), so the beds could not make a descent: from chapter 4 on the piano sat 11–18 LU
under the game. Four files had their gain raised losslessly (`scripts/mp3-gain.mjs`, the mp3gain method:
Moonlight +10.54 dB, Träumerei +7.53, The Poet Speaks +6.02, the nocturne +1.51; `docs/MUSIC_CREDITS.md`),
since a media element's volume cannot exceed 1, and the player cuts each file to −22.1 LUFS-I
(`MUSIC_TARGET_LUFS`, the quietest as shipped): K.545 −0.65 dB, the waltz −2.30, Moonlight −0.23, The Poet
Speaks −0.17, Träumerei −0.10, the nocturne 0. Every recording is then heard at the same loudness before its
bed, so the beds are the descent, and a playlist that moves on to its next file is never louder (Moonlight's
end used to bring the nocturne in 8.8 LU louder, inside Act III).

| Ch | Act | Recording | Bed | Enters | Breath after a loss | Scar per loss (cap) | Revelation motif |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1–2 | I | wonder (K.545) | 0 dB | with the flyover | −2 dB | 0.25 (1.5) dB | act1 |
| 3 | I | unease (Chopin waltz) | −1 | flyover | −3 | 0.25 (1.5) | act1, slower |
| 4–5 | II | cost (Nocturne) | −2 | flyover | −5 | 0.5 (3) | act2 (ch5 rarely: its documents are institutional) |
| 6 | II | cost | −3 | flyover | −6 | 0.5 (3) | act2 |
| 7 | III | reckoning (Moonlight) | −4 | after the opening caption | −8 | 0.75 (4) | act3 |
| 8 | III | remains (The Poet Speaks) | −5 | after the caption | −8 | 0.75 (4) | ch8 (also on the chapter card) |
| 9 | III | thaw (Träumerei) | −5, then −10 at the sea | after the caption | −8 | 0.75 (4) | act3, no left hand |
| Epilogue | | thaw | −8 reading | after the motif | | | epilogue: the only full close |

### "No. 14", the recurring motif

An original composition (2026) for this game, named after No. 14 Church Lane, the Vey house with "a piano
nobody had tuned since 2020". F major / D minor, 3/4, a felt piano 10 cents flat with its D keys out of
tune. Every variant opens with the same cell, F4 A4 E5 | D5: a reach up and an imperfect landing. Act I
ends on an open question, Act II hangs, Act III leaves a hole where the answer should be, chapter 8 starts
again and stops after two notes, and only the epilogue finishes it. Arcade never hears it, so it stays tied
to the Archive.

It plays only over a **human document**: a letter or memory not written by an institution of the story
bible, a caption that is a photograph, or a record kept by one of the bible's characters
(`src/audio/story/human.ts`; every fragment of the nine chapters is classified in `human.test.ts`). A
ministry's reply or a council notice is not a human voice.

Its level: `MOTIF_CALIB_DB` = +3.9 dB puts it 3 LU under the (matched) recordings at the same music volume, the
design's rule (it was +0.2 against the unmatched recordings' median), and then **each moment trims it to sit at
least 1 LU under its chapter's recording at that moment** (lead decision: the motif never sits louder than the
music it replaces). The reference is the matched recording at the chapter's bed under the moment's own reading
level (−6 dB for a Revelation, −8 dB for the epilogue, none on the chapter card): `MOTIF_MOMENT_TRIM_DB` is −4 dB
in chapters 1–2, −6 in 3, −6.5 in 4–5, −7.5 in 6, −9 in 7 and 8, −9.5 in 9 and the epilogue, 0 on the chapter 8
card. The scar of the attempt's losses stays on the recording until the attempt ends (`PERSISTENT_DUCKS`), so the
motif is lowered by as much, at its target and as far as the router's −20 dB floor takes the recording.
Chapter 9's sea duck (−10 dB) is left out (lead decision L1b, 2026-10-23): following it put the epilogue's motif,
the story's only resolution, about 18 dB under the waves (−55.6 dBFS RMS against −37.2 for the ambience in the
second fix round). The motif keeps its chapter's level, and the epilogue lowers the world around it instead
(`epilogueReading` takes the ambience down 14 dB, was 6), so the moment still gets quieter, never louder. Measured
after L1b in S11E: the chapter 9 Revelation's motif at −13.3 dB (its −9.5 trim and a −3.75 scar), the
epilogue's at −48.1 to −48.4 dBFS RMS on the music bus against −44.9 to −46.3 for the ambience. `moments.test.ts`
drives the real moments for every Revelation, the card and the epilogue, with and without the deepest scar, and
checks each margin; the lab measures the trims (R7) and S11E the chapter 9 gains on the engine
(`docs/evidence/AUDIO_RUNS.md`, *Second fix round*). A motif still baking when its moment comes is waited for
until its start time plus 0.5 s (never less than 3 s; the epilogue's up to 15 s from its start, its text takes
minutes to read), then starts late or not at all, and the music comes back. While a moment waits, the bank bakes
its motif ahead of everything else, in the loading overlay's 16 ms timer slices instead of idle time
(*Evidence (epilogue motif bake)* below). Where the browser can start a Web Worker the motifs render there, as
soon as the chapter's set is asked for (the Story menu, the chapter card), so a moment rarely has to wait: with
the CPU throttled 2x every motif played on time (*Evidence (slow computers)* below).

### Moments: the music lowers or leaves

A Revelation or an epilogue belongs to the run it follows: Replay chapter, R on the panel, "Continue to chapter N"
with narrative off (all three keep the game screen up) and leaving the screen each end it, so the motif fades over
1.5 s, the hold is released and the reading level lifts before the next attempt plays. The music comes back after
the motif on the audio clock, so a hidden tab (which suspends the context) holds both the motif and the return.

| Moment | Music | Ambience / effects |
| --- | --- | --- |
| Archive Revelation (a run completes, narrative on, a human document surfaced) | held: the piece fades over 3 s; *No. 14* 4 s later; 4 s of quiet after it; the piece returns under the reading level (−6 dB) | −8 / −12 dB |
| … no human document, narrative off, or no motif to play | reading level only | same |
| "View the river" from the panel | the lighter river-view level, no second motif | −2 / −6 dB |
| Epilogue (after chapter 9) | whatever plays makes way; held; the epilogue motif at +4.5 s (later, up to +15 s, if it is still baking); Träumerei returns at −8 dB | −6 / −12 dB |
| Chapter 8's card (Callum's letter names Mara) | held; the ch8 motif at +1.2 s, once per app session; Begin early fades it | |
| A Story landmark destroyed in play | −10 dB, 6 s, released over 8 s | −2 dB |
| A church falls | −14 dB, 10 s, released over 10 s; the bell is silent | −3 dB |
| A loss of ≥ 100 story points | the chapter's breath, 0.3 s after it falls (released over the chapter's own time: 2 s in Act I, 4 s in Act II, 6 s in Act III), and the scar | |
| A dam breaks | Story −10 dB while it pours (15 s at most), Arcade −4 dB for 4 s | the flood rises by itself |
| Chapter 9 reaches the sea | −10 dB over 4 s, until the end | |
| Act III level start | held until the caption ends (or 3 s into play with narrative off), then in from −12 dB over 6 s | |
| Pause / fail panel | −8 dB / Story −12 dB, Arcade −6 dB | gated / unchanged |

Nothing plays on the Archive or Science screens, and the agents' late reflection text makes no sound.

## Determinism

Every random choice comes from a seeded stream: `hash(SEED = 42, level, attempt, stream)` with separate
`sfx`, `amb`, `bells`, `motif` and `bake` streams, so a change in one subsystem never shifts another. Two
headless runs of the same level give the same trace, request for request (`integration.test.ts`). The seed
is reported in the engine's `state().seed` and in the trace header.

## Debugging

- `window.__icebergAudio` (package A; dev builds or `?audiodebug=1`): `state()` (context status, levels,
  bus gains, ducks, voices, bells, bank, the music router, frame cost), `trace(sinceSeq)` (every event,
  request, drop, duck, hold, bell and motif, with its cause), `meter()` (per-bus peak and RMS), `lab()`
  (offline renders). `?audio=off` disables Web Audio for A/B performance runs; `?audioworker=off` bakes the
  motifs on the main thread (the fallback), and `?audioworkerslow=N` (measurement only) keeps the motif worker
  busy N times as long, as the driver's `--cpu-throttle N` cannot slow a worker.
- `window.__iceberg` (the game's own hook): `snapshot()`, `runLog()`, `autopilot(true, lane)`,
  `fastForward(seconds)`, `setSteer(x)`.
- The bell scheduler writes `bell-hour p<placement> <voicing> strokes=<n>` and `bell-silenced p<placement>
  strikes=<n>` into the trace.

## Evidence (package C)

**Unit and headless tests** (`npx vitest run src/audio/game src/audio/story src/ui/audio …`): the magnitude
tables, every resolver rule F1–F11, the bell scheduler with an injected clock (first phrase 6–14 s, never one
stroke, the hour once with six or three strokes ending before arrival, a tower falling mid-hour, no catch-up
after a 60 s jump, pause loses nothing, no bells without a church, shiver threshold and cooldown), ambience
inputs and water sources, each level's bake set, the human-document table, Story's in-play ducks, the
Archive moments, the listen-only proof, real headless runs where every event ends in the trace and the trace
repeats at SEED 42, the director (cues, beds, holds, M, unlock, hidden tab) and the Settings controls.

**Browser** (`scripts/audio-e2e.mjs`, headless Chrome with real WebGL; results in
`docs/evidence/AUDIO_RUNS.md`): on the real game, the recorded music's media elements and a recording
engine installed in the page show what was asked for and when. What a browser run without package A cannot
show (bus gains, meters, voices, offline renders) is reported as "not measurable", never as a pass. The run of
2026-10-22: 138 checks passed, 10 were not measurable, and one failed: the design's "Spearman ρ(impulse, gain)
≥ 0.9" came out 0.897, because m weighs the closing speed as well as the impulse (within each sound the gain
never falls as m rises). Settled in the fix round by a better mapping (*Evidence (fix round)* below).

**What only a human ear can judge** (`AUDIO_DESIGN.md` §13): whether the felt piano sounds like a quiet,
slightly untuned real piano and whether *No. 14* carries weight (or accidentally quotes a known tune);
whether the bells sound like bells at a distance and Clachan sounds wrong in the intended way; whether a
collapse has weight without spectacle and the dam reads as concrete and water; whether the silences (the
breath, the scar, a clock that stops mid-count) feel like consequence rather than a bug; the balance of the
recorded grands against the synthesized world on laptop speakers and headphones; fatigue over 40+
collisions. None of this has been listened to by a person yet.

## Evidence (integrated)

After the merge, a smoke run in headless Chrome on the real engine, synthesis and bridge (details and every
number in `docs/evidence/AUDIO_RUNS.md`, *Integrated smoke run*):

- **Autoplay:** before any gesture the engine is `locked` with no context; Escape builds none; the first
  click gives one running context at 48 kHz, and the core set (48 buffers, 4.99 MiB) bakes on the menu in
  2.6 s.
- **Arcade (Riverside Town):** `wonder` at `el.volume` 0.4766; B's ambience voices built for the session
  and fed by C (river level 0.87 at 11.2 m/s, wind 0.4, the scrape at the iceberg's speed); ambience bus
  −27 to −33 dBFS RMS, master peaks −9 to −22 dBFS; houses collapsing at −14 to −21 dB by mass.
  **Power Valley:** hits at m 0.25 played at −32 to −36 dB, at m 0.70–0.76 at −20 to −27 dB, a masonry hit at
  m 0.90 at −14.8 dB.
- **Story (chapter 4):** `cost` at the −2 dB bed; the landmark and scar ducks took the recording to 0.168.
- **Pause:** gate 0 and the master silent while the sources run; the music −8 dB; resume restores both.
- **Leaving:** Retry, a level change, entering Story and quitting each stopped every ambience source of the
  old attempt (43/43, 35/35, 27/27, 43/43) and its effects and bells within 0.28 s of audio time; nothing
  played after `end()`; on the menu every bus read digital silence.
- **Bells:** St Bride's phrase and its approach hour (three strokes in Arcade, six in Story) are scheduled; with
  the level baked they all played. Open then, fixed in the fix round (below): when the set baked only after the
  level was chosen (the normal Arcade flow), headless Chrome took 47.7 s to bake Riverside Town's set while the
  level loaded and played, and all seven strikes were dropped as `notReady` (silent).
- **Motif and previews:** `act2` played on the music bus at −18.4 dBFS peak with music at 0.6; the Effects preview
  plays the stone hit; the Ambience preview was silent until a level with a church had been baked (fixed: the
  core keeps St Bride's strike).
- `scripts/audio-e2e.mjs` on the integrated build: S1, S2, S5–S11, CALVE and R, 123 checks passed and none failed
  (after three fixes to the driver's own reads); S3/S4 and S12 were not run then (they were in the fix round).

## Evidence (fix round)

The integration's open problems were fixed and every browser scenario of `AUDIO_DESIGN.md` §11 was run on the
integrated build: 21 scenarios and the bake runs, 329 checks passed, 0 failed, 2 not applicable (every number
in `docs/evidence/AUDIO_RUNS.md`, *After the open problems*). Headless Chrome on this laptop, its audio clock at
0.84× wall time (every meter window is timed on the context clock); nothing was listened to.

- **The level set bakes in time.** The bank bakes without an AudioContext, so the director asks for the next
  level's set on the menus (the Play button's level, the focused level card, the Story menu's next chapter, the
  chapter card); a level's bell strikes bake first, then its collision sounds, then the core and its heavy
  sounds; slices are paced by the screen (16 ms behind the loading overlay, up to 12 ms of a menu's idle time,
  at most 4 ms in play); a bell whose strike is still baking waits for it; every `notReady` drop is counted and
  traced. From a cold start straight into play (three runs each of Riverside Town in Arcade, the same with a
  click the instant the menu appears, Story chapter 4 and Power Valley): every St Bride's strike played, 7 of 7
  and 10 of 10 (before: 0 of 7, 0 of 10), the strike baked 0.02–0.33 s after the click, and nothing dropped as
  `notReady` (before: 2, 7 and 11 hits). The load is 0.08 s longer on average than with `?audio=off` (40 ms
  slices had made it 0.17–0.43 s longer); no frame-time cost in play could be separated from the run-to-run
  spread.
- **The Ambience preview works from a cold start**: the core keeps St Bride's strike (S6 on a fresh profile:
  `preview ambience` and `preview effects`).
- **The motif is calibrated**: `MOTIF_CALIB_DB` +0.2 dB (the six recordings' median −25.77 LUFS-I at `el.volume`
  1, the seven motifs' −28.99 at music 1, the design's 3 LU under); R7 −33.22 against −33.21 at music 0.6.
- **Magnitude (S4)**: the closing-speed term now counts only as far as the contact moved momentum (fully from
  J 20). ρ(impulse, requested level) of played hits 0.961 (bridge, n 67) and 0.959 (engine, n 62), 0.948 and
  0.950 on the ±8 m lanes (not held out: the gate was chosen on S4M's sample, which includes them); as played,
  with the jitter and density compensation, 0.921. Before:
  0.761 and 0.860. Every play stays within its request ± jitter (749 plays).
- **Leaving the game leaves nothing ringing**: the shared reverb's return closes with the last attempt (S8E: every
  bus at digital silence 300–600 ms after quitting; the master had read −72.6 dBFS, the reverb's tail).
- **Requirements by number** (AUDIO_RUNS.md has the table): every listed category's sounds played on the engine;
  collisions bounded at ≤ 8 of 24 voices and −11.3 dBFS peak in fastForward bursts; the sliders, M and the pause
  on the meters; bells in all five churches, none dropped; the music's duck product never above 0 dB in 1,208
  samples of Story; S12 +0.1 ms median frame time against `?audio=off`.

**Left open by the fix round** (both taken up in the second fix round, below): the motif sat 4–8.5 LU above the
Act III chapters' own recordings (calibrated to the median as designed: the recordings spanned 12.6 LU); the
first click's unlock was one 0.25–0.6 s main-thread task in headless Chrome (the `AudioContext` constructor 336
ms, the noise bank 114 ms, the IR 61 ms).

## Evidence (second fix round)

A review of the fix round confirmed eighteen findings; they were fixed with the lead's two decisions (every
number in `docs/evidence/AUDIO_RUNS.md`, *Second fix round*; headless Chrome; nothing was listened to):

- **A new attempt on the same screen ends the Revelation.** Replay chapter, R and "Continue" with narrative off
  used to carry the reading level (−6/−8/−12 dB), the hold and the motif into the next attempt; now the
  replayed attempt and the next chapter play at the sliders, and the motif fades over 1.5 s (S14, 10 of 10).
- **A hidden tab** no longer lets the recording back over a motif that has not finished: the return is timed on
  the audio clock (released at ctx 44.82 against 44.81 due, after 20 s hidden).
- **The recordings are loudness-matched** (R10: all six heard at −22.10 LUFS-I), so the beds are the descent and no
  playlist step is louder. In play Act III went from 13–18 LU under the game's master to 6–11; Act II's opening
  still measures 13.6–16.5 LU under, because the nocturne's opening is 5.3 LU under its own integrated loudness
  and chapter 4's ducks were on (open, for a listener).
- **The motif never sits above its chapter's recording** (lead decision): R7 measures every Revelation, the
  chapter 8 card and the epilogue 1.06–1.48 LU under the recording at that moment (3.14 on the card). In this
  round chapter 9's sea −10 dB was subtracted too, which left the epilogue's motif at −55.6 dBFS RMS against the
  ambience's −37.2, probably masked; lead decision L1b (above) leaves the sea out and lowers the ambience instead.
- **The first click** lost the noise bank and the IR (about 150 ms, now made on the menu): its task went from
  506–556 ms to 334–420 ms; the rest is mostly `new AudioContext()` (229–357 ms), which has to stay in the gesture.
- The aftermath's release is the chapter's own; M works on a focused slider; libebur128 (MIT) and the DSP sources
  are credited; HMR of the engine reloads the page instead of leaving AudioContexts running.

## Evidence (epilogue motif bake)

S11E lost the epilogue's motif: chapter 9's last bake (34.2 s of felt piano, 3.1–3.7 s of main-thread work in
headless Chrome) was still going when the epilogue began, the idle pace behind the river view baked about 0.06–0.19 s
of work a second, and the moment waited only 5 s. Now (every number in `docs/evidence/AUDIO_RUNS.md`, *Epilogue
motif bake*; headless Chrome; nothing was listened to):

- **A motif a moment wants is baked first, at the loading pace**: not baked at the moment's trigger, it goes ahead
  of everything still pending (a bake in progress is set aside and resumed, with the same samples) and bakes in
  16 ms timer slices instead of idle time until it is baked. Never in play.
- **The epilogue waits up to 15 s** for it (the other moments keep their start time plus 0.5 s). With nothing of it
  baked when the epilogue starts (EPI, five runs), it was baked 4.5–5.5 s later and started 5.0–5.8 s after the
  epilogue's start (on time is 4.5 s); two of the five would have missed the old 5 s wait.
- **From chapter 9's Revelation until the epilogue, the epilogue's motif is asked for the same way.** On a main
  thread twice as slow (DevTools CPU throttling) with a minute on the Revelation, this is what made it play (on time;
  with the ask disabled it was never baked).
- S11E, three runs: the epilogue's motif was baked during play (50.1–53.5 s into chapter 9) and started on time,
  4.50 s after the epilogue's start; 20 of 20 checks each.
- The cost, on the Revelation with work pending: the median frame interval stays 16.7 ms, the mean rises by about
  2 ms (about 9 % fewer frames), and the bake gets about 4.5 times the work (0.67–0.72 s a second against
  0.12–0.19). It is paid only while a moment wants a motif that is not baked yet, never in play: S12 reads −0.1 ms
  against `?audio=off`, and S1 passes.
- **Open then:** on a main thread twice as slow the Revelations' motifs were missed and the epilogue's needed about
  a minute on the Revelation; the render's cost was the limit. Fixed the same day (next section). Whether a motif
  up to 15 s late still closes the story is for a listener.

## Evidence (slow computers)

Every number in `docs/evidence/AUDIO_RUNS.md`, *Slow computers* (headless Chrome 155 on this laptop; nothing was
listened to). Before, with the CPU throttled 2x and a 20 s read, S11E missed chapter 1's Revelation motif,
chapter 9's and the epilogue's; EPI's worst case took 3,581 ms of main-thread work for the epilogue's motif.

- **The render is about 5 times cheaper, with the same samples.** The felt piano's per-sample loops ran inside the
  generators the bank slices, where the engine ran them three to four times slower; they now run as plain
  functions between the same yields (a twinned partial's two strings in one loop). The arithmetic and its order are
  unchanged: all seven motif renders hash exactly as before, in node and in Chrome (`motifRender.test.ts`, S13).
  The epilogue: 3.8 s → 0.7 s in node, 0.76 s on Chrome's main thread. Nothing changed for a listener.
- **The motifs render in a Web Worker** (`src/audio/synth/motifRenderer.ts`, `motif.worker.ts`), sent by the bank
  as soon as a set is asked for, in its own order; the main thread only wraps what comes back. No worker (node,
  jsdom, `file://`, `?audioworker=off`) or a failed one: the main-thread bake, as before. The samples and the bank's
  checksum are the same either way (S13 checks them in Chrome).
- **Two queue edge cases fixed.** A motif a moment waits for keeps its priority when the set drops it and asks for
  it again (the bank keeps the request by key; `bakeReport().bank.awaited` says what it really bakes first), and the
  epilogue asks for its own motif after the Revelation asked for it as the next one. Letting a motif go sets its
  bake in progress aside, so the level's sounds come first again.
- **Measured:** at 2x (the worker slowed as much: DevTools throttling cannot reach a worker), S11E played every
  motif on time in 3 of 3 runs, chapter 9's two baked before its play began; on the main thread alone all four
  played too, with less margin. At normal speed S11E 3 of 3, the epilogue's motif baked 3.2–4.0 s into chapter 9
  (was 46–54 s); EPI's worst case 693 ms of main-thread work and the motif 4.62 s in (on time 4.5), EPIW (the
  worker) 0 ms and 4.53 s; S1 and S13 pass; S12 −0.05 and −0.1 ms against `?audio=off` (a first S12 failed the
  other way on a 30 fps `?audio=off` baseline, machine noise).
- **Open:** at 2x chapter 9's own sounds still lag (10 of its set pending at the run's end, one dropped in play):
  the recipes have the same generator-loop cost. A real two-core machine, where the worker competes for a core,
  was not measured.

## Evidence (trees, stones and log piles)

The playtest of 2026-10-23: "similar to the house breaking i want trees to have a sound effect as well and stones
and logs". Every number is in `docs/evidence/AUDIO_RUNS.md`, *Trees, stones and log piles*: headless Chrome 155
on this laptop and seeded node runs of the real engine and bank; **nothing was listened to**.

- **Why they were not heard: they played, too quietly.** Every felled tree, broken log pile, barrier and rock hit
  in the runs before the change ended in a `play`: no `busy`, `rate`, `cap`, `perKey`, `culled` or `notReady`
  drop (at most 5 voices sounding), 17–36 m from the camera, inside the 40 m reference (no distance loss). Through
  the lab (`renderMix` of each event's layers, the real graph and limiter) a felled tree peaked at −32 to −34 LUFS
  momentary and a log pile at −32, against −24.7 to −25.9 for a house collapse; a rock −51 in the median; in node a
  stone barrier −41. The bed they had to clear (river, wind, the iceberg's slide) reads −34 dBFS RMS on the master
  in the median (−26 to −38 by level), with the recording at about −28.5 LUFS on top: a house rose 8–10 dB above
  it, a tree only reached it, a rock stayed 15 dB under. The causes: levels set as peaks for sounds whose loudness
  sits far under their peak (a tree's crack 10–20 dB over its fall), a tree's landing that was a 250 Hz-low-passed
  rumble a laptop cannot play, a rock that never had more than its knock, and a log pile that played the
  footbridge's snap.
- **What changed.** New recipes: the tree fall (snap, fibres ripping, the hinge, the creak, the crown swishing
  down, the landing, branches, twigs), the stone barrier breaking apart, `stone.tumble` (a rock cracking and
  tumbling away) and `logs.tumble` (logs knocking and rolling), each crest-limited at the bake
  (`limitCrestSteps`) so its variants are equally loud. The levels above, with their ceilings. Rule F6b (rocks
  knocked moving), F6 now hit-then-scatter, and a guard of three stone breaks a second so a cluster ploughed at
  speed keeps its plain hits instead of losing them to the family's rate. Family voices raised (`scatter` 6,
  `tree` 6, `breakLight` 4). Held trees, grazes and loose logs knocked later keep their knock.
- **After**, the same lab measure: felled trees −24.5 to −27.1 (median −25.7), log piles −24.9 to −27.3
  (−26.4), a barrier breaking apart −26.8 and −27.0, rocks knocked loose −26.2 to −32.7 (−27.4), against house
  collapses at −22.9 to −25.8 (−23.9) in the same runs (Arcade and Story chapters 1 and 2). In node: trees −29.0,
  log piles −29.0, barriers −29.1, tumbles −31.2 against houses −26.5. None dropped.
- **The mix rules hold.** A storm through the real resolver, voice pool and graph (eight trees in a second, twenty
  rocks, a barrier, two log piles, a house, then a fastForward frame of 56 events): 18 of 24 voices at most, a peak
  of −10.4 dBFS, the limiter (threshold −3) never reached, no clipped sample; the frame cap admitted 4 requests a
  frame, the busy rule dropped minor hits only (rocks' plain knocks, P3, as before), two requests met a family
  rate. The ducks are unchanged and never above 0 dB (`ducks.test.ts`; the Story runs traced −10, −0.25, −12).
- **For a listener**: whether the tree reads as wood snapping and then a tree falling, the log pile as logs, a
  tumble as stone, on laptop speakers and headphones; whether rocks, now about as present as a tree, get
  tiring in Rocky Canyon (three a second at most, once per rock in 1.5 s); whether a tree that is as loud as a
  house at its strongest is right. A felled broadleaf never happened in the runs (only pines fell); its recipe is
  checked in node only.

## Integration (as wired, 2026-10-22)

The packages were merged in the order A, B, C, the contract requests were decided in one commit (listed
at the top of `AUDIO_DESIGN.md`), and the temporary seams were replaced by the real pieces:

- `src/audio/synthesis.ts` hands the engine package B's `createSoundBank`, `createNoiseBank`,
  `createAmbienceVoices` and `generateSpaceIR`; the bank bakes on B's `pacedScheduler` (since the fix round:
  16 ms timer slices behind the loading overlay, and since the epilogue fix while a moment waits for its motif,
  up to 12 ms of a menu's idle time, at most 4 ms in play; it
  was `idleScheduler`, requestIdleCallback with 4 ms slices, which starved under load). Since the slow-computers
  fix the bank is given the browser's motif worker (`browserMotifRenderer`), so motifs render off the main thread
  where one can start. The space IR carries its 15 ms predelay and unit energy, so the convolver runs with
  `normalize = false` and no DelayNode.
- `src/audio/game/engine.ts` returns package A's `audio`; package C's stand-in manager and pass-through
  router are gone. The director turns settings into levels with A's `levelsFromSettings`, and the bridge
  uses A's `spatial.ts` (C's copy, `space.ts`, is gone).
- `window.__icebergAudio.lab()` measures with package B's `analysis.ts` (BS.1770 loudness, spectra).
- `src/audio/packages.integration.test.ts` runs the three together headless: A's manager on the recording
  fake context, B's real bank (baked synchronously), noise and ambience voices, C's bridge on real
  autopilot runs of Riverside Town and Power Valley. Real buffers play with no `notReady` drop, B's voices
  are built and fed, St Bride's rings, every event is traced, the hits' levels follow the impact
  (m 0.25 near −34 dB, m 0.75 near −20 dB), `end()` leaves no source running, and the game is
  bit-identical to a run with no sound. It also checks every bake set C asks for against B's budgets.
- Chapter 9 bakes its Revelation motif and the epilogue together (the epilogue plays inside chapter 9's
  game screen): 4.91 MiB of motifs against the 4 MiB motif budget; the bank's peak is 19.1 MiB of 22, in chapter 9
  (`packages.integration.test.ts` over every set the game asks for; `bank.test.ts`'s synthetic sets give 17.2).
- The director arms its own unlock listeners and package A's context arms its own; both call the
  idempotent `unlock()`. Holds are a per-key set: the director and the attempt's Story audio both take
  `act3Entry`, and one release lets it go.
- In the dev build React's StrictMode mounts each attempt's `GameAudio` twice; the first `SessionAudio` is
  ended at once (`end(0.12)`), so a dev page shows two sessions per attempt with one live.
- The Settings preview never asks for a bake: its bell is St Bride's strike, which the bank keeps with its
  core sounds since the fix round (before, on a fresh start no level set was baked yet, so the Ambience preview
  was silent until a church level had been chosen).
- Not built (P1): `src/audio/game/emitters.ts` (machines that run down when destroyed); B's four machine
  slots exist and are fed nothing. Built (P1): the calving (with its own echo send) and the Settings preview.
