# The Last Thaw — Story Mode architecture

Story Mode turns the nine existing levels into a nine-chapter narrative. The game is unchanged: same
terrain, physics, iceberg, steering, collisions. Story Mode adds chapter data, a few human structures per
chapter (an overlay of extra placements), an Archive that records what really happened in each run, two
LLM agents that write and check a short reflection after selected chapters, a personalised epilogue,
music, a "Science Behind the Story" section and an optional pilot-study survey. Arcade Mode (the
original game, its scoring and its LEVEL COMPLETE panel) stays exactly as it is.

Theme: *"You cannot undo the river behind you. You can still decide where it goes next."*

Contracts live in `src/story/types.ts`. Read it first.

## Data flow

```
 level (src/core/levels) + chapter overlay ──► story LevelDef ──► GameSession (unchanged engine)
                                                                      │ events, route, physics bodies
                                                                      ▼
                                          src/story/evidence.ts ──► RunEvidence (compact, ~2–6 KB)
                                                                      │
                      ┌───────────────────────────────────────────────┤
                      ▼                                               ▼
   src/story/select.ts: authored fragments            POST /api/story/reflect (chapters 1, 4, 6, 9 by
   chosen by condition (always works, offline)        default) → Archivist ⇄ Historian → deterministic
                      │                               validation → NarrativeResult or NarrativeFailure
                      ▼                                               │
                 ArchiveEntry (localStorage)  ◄──────── reflection (AI if approved, else authored)
                      │
                      ▼  chapter 9 + all entries
            POST /api/story/epilogue → personalised epilogue (or authored fallback)
```

## Layout and ownership

| Path | What | Notes |
| --- | --- | --- |
| `src/story/types.ts` | contracts | change only with care: everything depends on it |
| `src/story/bible.ts` | the story bible (`StoryBible`) | authored; the single source of narrative truth |
| `src/story/chapters/*.ts`, `src/story/chapters/index.ts` | nine `ChapterDef`s (intro, tutorial, landmarks, overlay, fragments, fallback reflections) | `CHAPTERS` in order |
| `src/story/science.ts` | `ClimateFact[]` (NASA/NOAA/IPCC, and EPA/NOAA on pollution; verified URLs, quoted exactly) and `MetaphorNote[]` | real, cited, separate from fiction |
| `src/story/scoring.ts` | `STRUCTURE_CATEGORY`, Topple points per kind (`STORY_POINTS`), the Points guide's bands | Story Mode only; arcade score untouched |
| `src/story/evidence.ts` | `buildRunEvidence(session, chapter, story level)` | pure, runs headless in tests |
| `src/story/select.ts` | fragment conditions (at most four documents per run), fallback reflection, fallback epilogue, and the one record a failed run shows on the fail panel (never archived) | deterministic |
| `src/story/validate.ts` | deterministic checks of narrative claims and text | shared by server and tests |
| `src/story/storyLevel.ts` | `storyLevel(chapter)`: base level + overlay, landmark → placement index | never mutates the base level |
| `src/story/environment.ts`, `src/render/worldCondition.ts` | the world's condition per chapter, and how the view shows it | colours, fog and tints only; Arcade never reads it |
| `src/server/**` | agent service (Node, runs inside the Vite dev/preview server) | never imported by browser code |
| `src/state/storyStore.ts` | Story progress + Archive (zustand + localStorage) | |
| `src/ui/story/**` | Story Mode screens | subdued variant of the game's visual identity |
| `src/audio/music.ts`, `src/audio/tracks.ts` | the recorded music (HTMLAudio crossfades), a cue per chapter | public-domain / CC0 recordings, `docs/MUSIC_CREDITS.md` |
| `src/audio/**` (the rest), `src/ui/audio/**` | sound: engine, synthesis, the game and story bridge, the director | all synthesized; `docs/AUDIO.md`, `docs/AUDIO_CREDITS.md` |
| `src/ui/pilot/**` | optional pilot-study surveys (pre/post, export) | outside the narrative |

## The agent service (`src/server`)

- Mounted as a Vite plugin (`configureServer` and `configurePreviewServer`), so `npm run dev` starts the
  game and the agents together. Routes: `GET /api/story/status`, `POST /api/story/reflect`,
  `POST /api/story/epilogue`, `GET /api/story/usage`.
- `.env` is read from the project folder, then each parent folder (nearest wins), as the course requires.
  Keys never reach the browser; the client only ever sees `StatusResponse` (per model: its provider,
  whether it can run, and why not).
- Model access (verified from the course materials, 2026-10-21): Portkey, base URL
  `https://api.portkey.ai/v1`, `Authorization: Bearer $PORTKEY_API_KEY`, header
  `x-portkey-provider: openai`, model `gpt-6-luna`, **Responses API** (`POST
  /v1/responses`) because chat/completions rejects function tools on this model (course starter repo
  `agents/config.py`). Price (Lecture 11, citing the OpenAI pricing page): input $0.10, cached input
  $0.01, cache write $0.125, output $0.50 per 1M tokens.
- **Two providers, chosen by the model** (the course rules: "use your PORTKEY_API_KEY with gpt-6-luna
  only. No other models on the course key."; "if you want a different model, use your own personal API
  key and pay for it yourself"; "For an OpenAI key, name it OPENAI_API_KEY."):

  ```
  request { …, model } ──► allowlist (MODEL_PROVIDERS, config.ts; own-property lookups)
     gpt-6-luna ──► 'course'  ── Portkey, PORTKEY_API_KEY, x-portkey-* headers   (the default)
     gpt-6-sol  ──► 'own-key' ── api.openai.com/v1/responses, OPENAI_API_KEY, no gateway headers,
                                 under OPENAI_DAILY_USD_LIMIT (USD per UTC day, default 2.00)
     anything else, or a model that cannot run now ──► NarrativeFailure with the reason (nothing sent)
  ```

  The player picks the model in *Settings → Story Mode → AI model* (`settings.model` in the story save,
  sanitised to an offered model, default `gpt-6-luna`); the client sends it with every reflection and
  epilogue request. `MODEL_NAME` only sets the server's default for a request that names none, and only
  to an allowlisted model (anything else falls back to `gpt-6-luna`, logged at start-up). The service
  never switches a request to another model. Defences behind the routing: the Portkey transport refuses
  any model but `gpt-6-luna` before sending; the OpenAI transport refuses anything but `gpt-6-sol`;
  `generateNarrative` re-checks the model's provider, key, transport and (for own-key) the daily limit;
  each key goes only to its own host (an override pointing one at the other's host, in any spelling of it,
  is refused); both keys are in the output scanner's secrets. Under the daily limit each `gpt-6-sol`
  request holds the most it could cost while it is in flight (`src/server/spend.ts`), so narratives running
  at once cannot pass the limit together, and every server on the same key shares one count. `gpt-6-sol` price (OpenAI pricing page, recorded 2026-10-21):
  $2.00 / $0.20 / $2.50 / $10.00, exactly 20 times `gpt-6-luna`; its cost per playthrough is projected,
  not measured (`docs/evidence/TOKENOMICS.md`).
- **Portkey response cache.** The course's route caches whole responses: an identical request came back
  with `x-portkey-cache-status: HIT` and the original response's usage (verified 2026-10-21). Every request
  therefore sends `x-portkey-cache-force-refresh: true` (status `REFRESH`), so logged usage is always a
  real model call; any hit status (`HIT`, `SEMANTIC HIT`) is traced and not counted. `PORTKEY_CACHE=allow`
  keeps the gateway cache. This is separate from the model's **prompt caching**, which the service relies
  on: the instructions and tool definitions are a stable prefix sent first with
  `prompt_cache_key: last-thaw-<agent>`; measured on the shipped configuration, about two thirds of input
  tokens are cache reads (`docs/evidence/TOKENOMICS.md`).
- **Archivist** (writer) tools: `get_level_context`, `get_run_summary`, `get_run_events`,
  `get_story_history`, `get_bible_entries`, `get_archive_fragments`, `get_approved_climate_fact`. It
  writes in the first person as the archivist (unnamed until chapter 8), with two authored reflections in
  its instructions as voice examples, and returns JSON: `{ title, text, fragmentIds, factIds, claims }`.
- **Historian** (checker) tools: `get_run_summary`, `get_run_events`, `get_story_history`,
  `get_bible_entries`, `get_archive_fragments`, `get_approved_climate_fact`, `validate_narrative_events`,
  `check_narrative_continuity`. It checks facts, the story's rules and the voice (as rules: no lecture, no
  moral, no report), voice only in the first review, and **clarity**: a sentence that is ungrammatical, a
  riddle or poetic fragment a student would not follow on first reading (the playtest's example, "I keep the
  note beside it, the bowl still there in the written line", is quoted to both agents as what not to write,
  with two approved sentences that still left readers guessing: "I keep that fact beside Tomas's note" and
  "the kettles he asked me not to identify"), a person named by an initial, or a word that needs a gloss. At most two clarity issues per review; after
  the first review only for sentences the rewrite changed. It returns `{ verdict: 'approve' | 'revise', issues }`.
  On `revise` the Archivist gets the issues, as a JSON array labelled as data, and rewrites (at most 3
  reviews for a reflection, 4 for the epilogue); then the deterministic validator (`src/story/validate.ts`)
  must pass before anything is shown.
- `get_bible_entries` returns the established fictional history (premise, characters, places, timeline,
  decisions, relationships, revelations, invariants, style) limited to what the player can know by the
  current chapter: characters appear from `firstAppears`, their names and the entries that involve them from
  `revealedIn`, and every bible text it returns has names the player cannot know yet masked ("someone not
  yet named", "(a place not yet reached)"). The validator applies the same name gating, so the archivist
  is never named before chapter 8.
- Safety: per-agent tool allowlists, JSON-schema-validated arguments and results, bounded iterations
  and tool calls, request/token budgets, a deadline per narrative (170 s / 290 s) and a stop as soon as
  the browser closes the request, payload size limits, untrusted text (fragments, evidence strings, the
  Historian's issues) passed only as quoted data, no filesystem/shell tools, generated text scanned for
  secrets, casualty claims and unsupported numbers; what *How this was made* shows of a review is scanned
  the same way. Every failure returns `NarrativeFailure` and the UI shows authored material.
- Evidence: `logs/agent-usage.jsonl` (one `UsageRecord` per agent run, real API usage numbers, cache writes
  included, with the `model` and the `provider` that paid; a request that returned no usage, e.g. one that
  timed out, is counted, not estimated) and
  `logs/traces/<runId>.json` (full trace: evidence summary, every tool call, drafts, review, validation,
  final text). `logs/` is git-ignored; selected traces are copied to `docs/evidence/` for the report.
  Live runs on real headless gameplay and the real story, their traces, cost per player and the
  injection re-run: `docs/evidence/AGENT_RUNS.md` and `docs/evidence/TOKENOMICS.md`.

## Rules for all writing and generation

1. Never claim people were inside a destroyed building, never invent deaths or casualties.
2. "Left standing" / "spared" only for a landmark whose status is `intact` **and** that the run reached.
3. Fiction is fiction: characters, towns and records are invented. Real science appears only as an
   approved `ClimateFact` with its source, in clearly separate UI ("Science Behind the Story").
4. Responsibility is unequal and spread over decades: households, councils, an energy company,
   national governments, global emissions. Nobody is a cartoon villain; no single decision caused it.
5. The iceberg is a metaphor for consequences already set in motion, not a model of glacier physics.
6. Restraint: short documents, no slogans, no lectures, no repeated moralising. Let objects and
   records carry the feeling.
7. Nothing interrupts steering: narrative appears before a level, after it, or in the Archive.
8. Plain English (the student's playtest, 2026-10-23). Every document, reflection and epilogue part reads
   on one quick pass: complete, grammatical sentences; plain modern words ("invalid ballot", not "spoilt";
   "pen", not "biro"; "church", not "kirk"); people by their full names the first time, never by an
   initial. The bible's cast and `MINOR_PEOPLE` (`src/story/bible.ts`) hold every full name; before
   chapter 8 the archivist is "the archivist", "my sister" or "Miss Vey". Act I stays light; the cost
   arrives gradually. `chapters.test.ts` rejects bare initials and the words the playtest stumbled on
   ("spoilt", "font", "biro", "bothy", "kirk", "larder", "knoll" and a few more); the deterministic
   validator applies the same patterns (`src/story/plainWords.ts`, form checks `initial` and
   `plain-words`) to every AI text, so they are enforced, not only asked for. The Archivist's
   instructions and the shared rules ask for the same, and the Historian sends back unclear sentences.

## The world's condition (Story Mode)

The valleys age with the story, so what people do shows in the land itself, not only in the text.
`src/story/environment.ts` gives each chapter a `WorldCondition`; the view (`src/render/worldCondition.ts`)
turns it into colours, fog and material tints. Arcade never has one and renders exactly as before.

| Act | Chapters | What the player sees |
| --- | --- | --- |
| I, The Wonder | 1-3 | the world as it was: green grass, clear blue water, clean air (the few log piles of chapters 1-2 weigh too little to show in chapter 3) |
| II, The Cost | 4-6 | first signs: grass yellowing in patches, a light haze, the river a little greyer; Power Valley keeps its own smog on top |
| III, The Reckoning | 7-9 | clearly worn: brown grass everywhere, dead trees (rust-brown or bare grey crowns) among the living, a brown river, thick grey-brown haze, dulled snow |

- **The arc.** `WORLD_ARC` places each chapter between 0 (healthy) and 1; the channels (dry grass, its
  cover and browning, dead and yellowing trees, water murk, haze, soot on snow) follow from that severity.
- **The player's own record.** The Archive's latest run of every *earlier* chapter counts the extraction,
  industry and energy structures toppled there, weighted by their story points (a cooling tower far more
  than a log pile; homes, churches, dams and trees do not count). That toll saturates
  (`1 − e^(−points / 6000)`) and can add at most `TOLL_BOOST` to the arc: 0.1 in Act I (never more
  than a faint haze), 0.18 in Act II, 0.2 in Act III. A chapter's own completion or a retry never
  changes its world; a heavy Power Valley shows in chapters 7-9 as browner grass, more dead trees and
  thicker haze.
- **Rendering only.** The terrain, scenery and backdrop materials get a per-vertex step (after the vertex
  colours) that dries plant-coloured vertices toward straw, then brown, in ~45 m patches; scenery trees
  can stand dead; snow dulls with soot. Which colours count as plants is one hue/saturation test shared by
  the GLSL and its CPU mirror (`plantAmount`, checked against every theme's palette); which ground dries
  at a given cover is `COVER_THRESHOLD` (CPU mirror `coverAmount`): Act II dries patches, and from
  chapter 8 on (cover 1) every patch is dry, with no green island left. Water, sky, fog and light change
  only uniform colours and fog distances; obstacle trees only their instance colours. No new models.
- **In words, for the agents and the validator (2026-10-24).** `src/story/worldLook.ts` names the same
  condition in levels the player can see (water clear / greyer / brown, sky clear / hazy / grey, grass,
  trees, snow) and says whether the player's earlier toppling added to it (`fromYourRecord`: none / a
  little / clearly, with the places in `toppledIn`). `get_run_summary` returns it as `world`, computed
  from the history the browser sends (each history item now carries its counts by kind, so the server
  sees the world the renderer draws). The validator's `world` check rejects a text that calls the river
  brown or the sky grey in a chapter that does not show it, or that blames the look on the player's
  earlier toppling when their record added nothing or names a place where they toppled none of it
  (`worldLook.test.ts`). The authored records follow the same arc: greyer water and haze in Act II (the
  Riverside gasworks, the Kessel guestbook, Ruth Vey's river clean-up), brown streams, litter and a grey
  sky in Act III (the Red Mesa after the plant, the Clachan's stream, the abandoned lower terrace).
- **Checked (2026-10-23, headless Chrome on the target laptop's Iris Xe, ANGLE D3D11, 1280×720).**
  - *Physics and gameplay unchanged.* A whole chapter 8 run on fixed 1/60 s steps under the autopilot
    (79.5 s to the coast, 6 knocked down) gave byte-identical snapshots every second and an identical
    final snapshot with the condition off (`?world=off`), on, and on after a heavy-destruction Archive
    (toll 26 100 points, severity 0.92). `src/render/Obstacles.test.ts` checks the same in unit form.
  - *No frame-time cost.* Same page and view, the 292 patched meshes drawn with their patched materials
    or with unpatched clones, alternating (18 × 60 synchronous frames each): median 25.2 vs 27.1 ms per
    frame at high quality, 23.9 vs 25.2 ms at low; whole pages with the condition off vs on: medians
    27.8 / 28.0 ms off, 25.5 / 27.9 ms on (two loads each, 6 × 60 frames per load). The differences
    are within run-to-run noise (and favour the condition), so the cost is not measurable. The patched
    materials add six shader programs, compiled in the loading warm-up before play starts.
  - *Text stays readable.* The HUD and caption sit on their own scrims (74 % and 72 % opaque), so even
    over pure white their dimmest text keeps 4.8:1 (HUD muted labels) and the rest 6.2:1 or more; the
    haze's lightest colour (`smogHorizon`) is darker than white, so it only raises those ratios.
- **Debugging.** `?world=off` plays a chapter in its healthy world; `?world=5` (or a chapter id) shows
  another chapter's arc on this chapter's level; `window.__iceberg.world()` returns the condition on screen.

## Sound (Story Mode)

The same rules hold for what the player hears (`docs/AUDIO.md` has the whole system):

- **A quiet tragedy, not a disaster film.** No voices of any kind, no sirens, no explosions, no stingers,
  no toll. Structural failures are heavy and long, but made of their materials (timber, glass that gives
  way, stone, metal groaning), never of booms.
- **Moments only lower or remove the music.** The six recordings are loudness-matched, so each act's
  recording is heard lower than the last (by its bed, 0 to −5 dB); a loss of 100 Topple points or more takes a
  breath out of it and leaves a small scar for the rest of the attempt; a landmark lowers it by 10 dB, a
  church by 14 dB. No duck or bed raises anything, and the Archive's motif is trimmed to sit at least 1 LU
  under the chapter's recording at that moment, every duck on the recording included: the bed, the reading
  level, and what stays on it to the attempt's end (the scar of the attempt's losses, chapter 9's sea). In
  chapter 9 that makes the Revelation's and the epilogue's motifs very quiet, as quiet as the recording the sea
  has taken down; whether they are still heard over the sea is for a listener (`docs/AUDIO.md`).
- **What stops sounding carries the consequence.** A church's bell rings in the background all level and
  strikes six as the iceberg approaches; when its tower falls the bell stops, mid-count if it was striking,
  for the rest of the attempt.
- **The motif belongs to the people.** *No. 14*, an original piano piece, plays after a run only if a human
  document surfaced (a letter or memory not written by an institution, a photograph, a character's own
  record: `src/audio/story/human.ts`), alone, with the chapter's recording held out of the way. Its only
  full close is in the epilogue. Arcade Mode never plays it.
- **Audio only listens**: the sound bridge has its own points tracker and never touches the run
  (`src/audio/game/listenOnly.test.ts`).

## Topple points (Story Mode)

Story Mode's score is **Topple points**: every structure the iceberg topples earns its points, once
per placement (`src/story/scoring.ts`). Chapter 1 frames it light-heartedly: *topple structures to
earn points*, a fence is worth a few, an oil rig, a pipeline or a tall apartment block the most. The
tutorial does not say why, and nothing the player reads in Act I talks of destruction or harm
(`src/ui/story/StoryUi.test.tsx` checks the cards, the HUD, the guide and the revelation's own
wording; archive documents aside).

Behind the numbers, the weights follow how much harm a structure's failure does to the environment and
to people (an offshore rig or a pipeline more than a fence; an apartment block more than a barn), not
its size. The story lets the player discover that later, when the records of Act II say it back in the
archivist's words (chapter 4's Station Court sheet: "A block of flats scores a lot of points. This sheet
is what those points stood for"; chapter 6's Rig Four card: "An oil rig scores more points than anything
else, because nothing on this coast could do more harm if it broke"). Arcade scoring is unchanged.

**The Points guide** lists every structure that topples and its Topple points, in four friendly bands
(*The big ones*, *Worth a lot*, *Worth a bit*, *Small change*; rocks, glacier ice, parked cars and stone walls are pushed, never toppled, and
earn nothing). It is not on the chapter card: it opens from Story Mode's pause menu (*Points guide*;
Back or Escape returns to the menu, focus on the button) and from the chapter list (a disclosure
under the buttons; Escape closes it before Escape leaves the screen). Arcade's pause menu has none:
Arcade's score is a different sum with no per-structure table. The run facts read *Topple points*,
*Structures toppled* and a landmark as *toppled* (the data keeps `destroyed`).
