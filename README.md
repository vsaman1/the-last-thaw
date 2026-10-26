# The Last Thaw

**A 3D browser game about climate change: you steer a melting iceberg down a river to the sea. In Story Mode, the
things you topple come back as the records of the people who built them.**

- **Report:** [`deliverables/report.html`](deliverables/report.html)
- **Slides:** [`deliverables/slides.html`](deliverables/slides.html)
- **Demo video** (optional, 2½ minutes, captioned, with the game's own music and no voice-over): submitted on
  Canvas with the rest of the project, not kept in the repository. Its timed script is
  [`deliverables/narration_script.md`](deliverables/narration_script.md).

Both HTML files are self-contained, with every image embedded. GitHub shows them as source code, so open them
from your clone or download them and double-click.

*Iceberg River*, with Story Mode *The Last Thaw*. MGT 409 final project (Yale SOM), solo, by Saman Verma.
TypeScript, React 19, React Three Fiber, Rapier and Vite. The two in-game agents run on `gpt-6-luna` through
Portkey with the course key.

## Run it in 5 minutes

**You need:** [Node.js](https://nodejs.org/) **22.22.2 or newer on 22, 24.15 or newer on 24, or 26+** (from
`package.json` `engines`; `.nvmrc` says 24; developed and tested on 24.21.0) with npm. You also need git, and a
desktop browser with WebGL 2: a recent Chrome, Edge, Firefox or Safari.

```bash
git clone https://github.com/vsaman1/the-last-thaw
cd the-last-thaw
npm ci
npm run dev
```

Then open the URL that Vite prints: **<http://localhost:5173/>**. The agent service runs inside the same dev
server, so there is no second process to start.

Measured on a Windows laptop from a fresh copy of the repository (2026-10-25):

| Step | Time |
| --- | --- |
| `npm ci` (144 packages, empty npm cache) | about 45 s |
| `npm run dev`, until Vite is ready | 1–2 s |
| The very first page load, while Vite pre-bundles the dependencies once | about 17 s |
| Every later page load | about 2 s |

**The key (optional).** The server looks for a file named `.env` in the **repository folder first, then the folder
above it** (then further up, at most 8 levels). For each variable the nearest file wins, and a variable set in the
real environment wins over every file (`src/server/env.ts`). So a staff `.env` one folder above the clone works as
is:

```
your-folder/
├── .env             ← PORTKEY_API_KEY=…   (OPENAI_API_KEY=… is optional)
└── the-last-thaw/   ← this repository
```

`.env.example` lists the two keys and the optional settings. **Do not copy it to `.env` and leave the keys
blank:** an empty `PORTKEY_API_KEY=` in the repo folder is "nearer", so it hides the key one folder up. To check
that the key was found, open <http://localhost:5173/api/story/status>. It answers `"aiAvailable":true,
"model":"gpt-6-luna"` when the key is there. Vite restarts by itself when the repo folder's `.env` changes. After
you change a `.env` anywhere else, restart `npm run dev`.

**What to click first.** On the main menu, choose **Story Mode — The Last Thaw**, then **Begin** (*Chapter 1 · The
Beginning*), and **Begin** again on the chapter card. **Space** skips the opening flyover. The iceberg slides by
itself. To steer, move the mouse past the centre of the screen, or
use **A / D** or **← / →**. Chapter 1 takes about half a minute. Then the *Archive Revelation* shows the records
your run surfaced and a reflection. With the key, the agents' reflection replaces the authored one when it is
approved: 38 seconds after the chapter ended in the measured run, and 30 seconds to 2 minutes in general. *How this
was made* shows their tool calls, the Historian's verdict and the token cost. To jump ahead to the crowded,
worn-out last chapters, turn on **Settings → Gameplay → Unlock all levels**, which opens every Story chapter as
well.

**Without a key, everything still works.** You get both modes, all nine chapters, the Archive, *Science Behind the
Story* and the pilot questionnaire. Story Mode shows the authored reflections and an authored epilogue built from
your archive, labelled "From the archive · authored for this outcome". `/api/story/status` then says
`PORTKEY_API_KEY not set`.

**Port 5173 already in use?** The dev server stops with "Port 5173 is already in use"; it does not move to another
port by itself. Pick a free port, for example `npm run dev -- --port 5175`, and use it everywhere above. The agent
service works on any port.

## What is new

Most climate games make you the fixer. You set policy, rebuild an ecosystem, or lead survivors. *The Last Thaw*
makes you the consequence. The story bible says it plainly: "The player is that thaw: consequences already set in
motion, not a villain."

The game is about what climate change does once it has started: it keeps going, and it does not care how anyone
feels about it, good or bad. The land itself shows the signs. Over the nine chapters the grass yellows and dies
back, trees go bare, the river turns brown and the sky turns a foggy grey. In the last chapters the valleys are so
crowded with what people built that no tested way down to the sea gets through without breaking something, however
carefully it steers. Chapter 9 ends in a village whose lower terrace stands empty. Its families left "over five
years, one flood at a time": all of them, good and bad alike, because the floods kept coming.

- **Inevitability is part of the level design, and the tests check it.** In Act I the story adds at most two
  structures per chapter, and no tested route even comes within 20 m of them. In Act II no tested way down is free:
  each one destroys at least two built placements. In Act III the story adds 164 to 290 structures to each level.
  On each chapter's four main tested lines (the intended line, a lane beside it and the level's alternative
  routes), at least 5, 7 and 8 built structures break in chapters 7, 8 and 9, and every measured chapter 8 lane
  breaks at least 6. Chapter 7's processing
  plant and pipeline always go, and so does chapter 8's power station. Chapter 9's pipeline, a wellhead and at least
  four of the abandoned houses go too. What you can still choose is smaller: which homes and named places survive
  (`src/story/chapters/overlays.act*.test.ts`).
- **Careful play cannot turn the world green again.** Each chapter's world condition follows a fixed arc: none in
  chapters 1–3, then 0.30, 0.36, 0.42, 0.62, 0.72 and 0.80. The industry and extraction you toppled in earlier
  chapters can only add a little more: at most 0.1, 0.18 or 0.2 per act (`src/story/environment.ts`). The effect
  is rendering only, so the physics stays the same.
- **The score turns on you.** Chapter 1 hands out *Topple points* in a light-hearted way. The points follow the harm
  a structure does when it fails: an oil rig 1,000, a dam 900, an apartment block 750, a fence 10. Later documents
  tell you what those points stood for.
- **What you topple comes back as a human record.** An archive of 100 authored documents (letters, notices,
  logbooks, memories) surfaces at most four per run. They are chosen by what your run actually did, never at
  random. Each chapter card adds one more document, nine in all.
- **Two AI agents reflect on your own run, and are checked before you read a word.** See [The agents](#the-agents).

One fellow student has played the game (an informal session, n = 1, no survey data). The report gives a paraphrase
of his feedback. The built-in pilot questionnaire has not been run with participants.

## The agents

The **Archivist** writes a short reflection on your run after chapters 1, 4, 6 and 9, and a final epilogue. Its
seven read-only tools return only your run's record, the story so far and approved climate facts. The
**Historian** reviews each draft with its own tools and either approves it or sends it back with specific issues.
A **deterministic validator** must also pass, or the authored text stands. Both agents run on `gpt-6-luna` (course
key, Portkey). One full story with the default AI chapters cost **$0.0449**, measured on 2026-10-25 on the 2026-10-24 build. The diagram, a
traced run step by step, and the tokenomics are in the [report](deliverables/report.html). The reference details
are under [Agent service in detail](#agent-service-in-detail).

## Safety

- **The model is never trusted.** Nothing reaches the screen unless the Historian approves and the deterministic
  validator passes (`src/story/validate.ts`). The validator rejects declared claims that contradict the run, and
  casualty or "people inside" wording it recognises. If either check fails, the authored text stays.
- **Keys stay on the server.** Each key is sent only to its own host, only in the `Authorization` header. The
  Portkey transport refuses any model except `gpt-6-luna` before it sends anything. The browser learns only whether
  each model is available. Generated text is scanned for the keys and for a planted canary.
- **Prompt injection.** Archive text and earlier reflections reach the agents only as quoted, untrusted data. The
  agents have no file, shell or network tools. `npm run agents:injection` runs a live injection test.
- **Bounded loops and spending.** Each agent turn gets at most 6 model rounds and 12 tool calls. Each request has
  a 45 s timeout, and each narrative a 170 s deadline (290 s for the epilogue). A server process may make at most
  300 model requests and use at most 1.5 M tokens per UTC day. The API accepts 12 POSTs a minute and bodies up to
  64 KB. The optional `gpt-6-sol` runs only on your own key, under a daily dollar limit ($2.00 by default).
- **What is still open:** the validator matches words, not meaning, so paraphrases are left to the Historian. The
  local API has no login. The details and the measured results are in the report.

## How to play

| Action | Control |
| --- | --- |
| Steer | Move the mouse left/right of the screen centre, or **A / D**, or **← / →** |
| Pause / resume | **Esc** or **P** (or the pause button) |
| Restart level | **R** (or the restart button) |
| Skip intro | **Space** |
| Mute / unmute all sound | **M** (anywhere; the volumes are in *Settings → Sound*) |
| View the river (after completing) | **V** (or the button); **V** / **Esc** to return |
| …in the river view | drag = orbit, scroll = zoom at the pointer, double-click = fly there, right/Shift-drag = pan, arrows = orbit, Shift+arrows = pan, **+ / −** = zoom, **Home** = whole river |

- The iceberg slides downhill on its own; you only steer.
- **Mouse steering starts once the cursor passes the screen centre**, so a cursor left on a menu button never
  steers you into a wall. Keep the cursor centred to go straight. A/D work at any time. A small L–R gauge at the
  bottom shows the current steering.
- The river is created behind you and keeps flowing.
- Gentle curves keep speed; sharp turns and zig-zags bleed momentum. Smooth (mouse) steering is the fastest.
- **What a crash costs depends on momentum.** Anchored things (trees, houses, bridge piers, dams, chimneys, cooling
  towers…) break when your momentum is big enough. A heavy iceberg flattens a house at walking pace; a small one
  needs real speed or bounces off. Smashing costs speed in proportion to what you hit. Loose things (rocks, cars,
  wagons, debris) are shoved aside. A heavy iceberg ploughs on through the rubble of what it smashed (low or light
  rubble is pushed aside or ridden over), while rubble about as heavy as you can still stop you.
- **Road bridges can be ridden across.** On a road bridge that spans a gap, the iceberg rides the deck like a car.
  Keep its centre over the deck: off the side, it tips into whatever the bridge crosses. Footbridges are never
  ridden. Knock out a pier, and the decks resting on it fall.
- **Hard hits chip ice off.** How much depends on how hard the obstacle pushed back on *your* mass. A big iceberg
  barely notices a dam; a small one hitting a house loses a visible bite (the *Ice* gauge flashes and chunks fly).
- **Glacier ice can be absorbed.** Plough into pale glacier blocks and ice fields to merge them. You get heavier
  and bigger (momentum is conserved, so it slows you a little) and can smash things you otherwise couldn't.
  Gather enough and you become an avalanche. Ice above 100 % still scores.
- If you stay slow and are not picking up speed for a few seconds, you are stuck and the run fails. Rocking back
  and forth in a bowl you can't climb out of counts as stuck too (it fails within about 10 s).
- Ramps (kickers) launch you from their exact lip: hit them straight and fast to clear gaps.
- **The river is your iceberg's meltwater.** The *Ice* gauge drains as you lay river on land, and faster when
  your route winds back and forth; the iceberg (and its river) visibly shrinks. If it melts away the run fails
  (*MELTED!*). Smooth lines reach the sea with plenty left, and ice left adds to your score.
- Go over the waterfall and reach the sea. The level completes just past the finish buoys, a short way out.
- On the *Level complete* screen, **View the river** (or **V**) hides the results so you can look around the whole
  river you made (controls above). **V** / **Esc** brings the results back.

Progress (completed levels and chapters, best times) and settings are saved in the browser's local storage.
Finishing a level unlocks the next. For playtesting, **Settings → Gameplay → Unlock all levels** opens every level
and every Story chapter at once.

## Story Mode — The Last Thaw

Main menu → **Story Mode — The Last Thaw**. Nine chapters in three acts play the nine levels with their physics
unchanged: *The Wonder* (chapters 1–3), *The Cost* (4–6) and *The Reckoning* (7–9). Arcade Mode (**Play** and
**Level Select**) is the original game, unchanged.

- **Chapter cards** come before each level: a few lines and an archive document. Chapter 1's card explains the
  score in a light-hearted way: topple structures to earn **Topple points**. A fence is worth a few points; an oil
  rig, a pipeline or a tall apartment block the most. The full list of structures and their points is the
  **Points guide**, in the pause menu during play and on the chapter list (`src/story/scoring.ts`). The story then
  lets you find out what those points stood for.
- **Human structures.** Each chapter adds placements to its level (an overlay of homes, apartment blocks,
  pipelines, oil wells, an offshore rig and monuments) without touching the terrain or the existing obstacles.
  Act I stays almost untouched; Act III is crowded (see [What is new](#what-is-new)). Every story level is
  validated and play-tested headless.
- **The world wears out.** The grass, trees, water, haze and snow follow the chapter's world condition: clear and
  green in Act I, yellowing and hazy in Act II, brown water, grey sky and bare trees in Act III. Your earlier
  record makes later chapters a little worse. The effect is rendering only (`src/story/environment.ts`,
  `docs/STORY_MODE.md`).
- **During play** nothing interrupts steering. There is one short caption at the start and a *Topple points*
  counter in the HUD. A short *Broken* notice names each named landmark that falls. Pause (Esc) for the Points guide;
  Escape closes the guide again.
- **After each chapter comes the Archive Revelation:** records chosen by what your run actually did. Every named
  landmark is recorded as toppled, damaged, left standing (only if your run reached it) or not reached. Nothing
  ever says that people were inside a building. Then comes a reflection. By default the agents write the ones
  after chapters 1, 4, 6 and 9 (*Settings → Story Mode → Reflections by the agents*: Selected chapters / Every
  chapter / Off). Authored reflections cover the other chapters, and any chapter where the AI is off or fails.
  *How this was made* shows the agents' tool calls, the Historian's verdict and the token usage.
- **The Archive** keeps every chapter's run (as plain data), its records and its reflection to reread, in browser
  storage. **Science Behind the Story** lists 19 real, cited facts (IPCC, NASA, NOAA, and the EPA on pollution) and
  explains where the game is metaphor. It is visibly separate from the fiction.
- **The ending.** After chapter 9, an epilogue written from your whole journey is shown over the view of the river
  you made. It is the agents' version when that is approved; otherwise an authored one is composed from your
  archive. The epilogue starts being written as soon as chapter 9 ends.
- **Playing again.** Any archived chapter can be replayed from the chapter list (the new run replaces its entry).
  **Start over…** under the chapter list clears the whole story (chapters, archive, attempts, epilogue) after
  asking once, and keeps the settings. *Settings → Story Mode → Reset story* does the same.
- **Music and sound:** six public-domain / CC0 solo-piano recordings, bright at first and sparser later, each act a
  little quieter than the last (*Settings → Sound*). Each mood has backups: when a piece ends the next one fades
  in, so the music never stops. Losses lower the music rather than raise it. A church's bell stops when its tower
  falls, and the Archive's human documents get their own piano motif ([Sound](#sound), `docs/AUDIO.md`).
- **Pilot study** (main menu): an optional before-and-after questionnaire (25 items) for a real user study, with
  anonymised JSON / CSV export. It is outside the story, and no participants have taken it yet. The export,
  participant list and delete tools sit behind *For the researcher → I'm running this study: show the tools*, so a
  participant on a shared device does not stumble on other people's answers. This is a deliberate step, not a
  password: the data is in the browser's storage either way.

The story bible (cast, timeline, places, decisions, and what must stay consistent) is `src/story/bible.ts`. The
chapters are in `src/story/chapters/`, and the architecture and the writing rules are in `docs/STORY_MODE.md`. The
towns, people and records are invented, and nobody dies in the story: the evacuation plans worked.

## Agent service in detail

Two cooperating LLM agents (`src/server/`) run only at narrative checkpoints, never during play. They use
`gpt-6-luna` via Portkey's Responses API by default, or optionally `gpt-6-sol` on your own OpenAI key (below).

1. The browser builds a compact **RunEvidence** (a few KB) from the real session: events, the route, and which
   physics bodies of which placements broke (`src/story/evidence.ts`). It sends this with a short summary of the
   earlier chapters.
2. The **Archivist** writes a 60–180-word reflection (150–250 for the epilogue) in the archivist's voice. It uses
   these tools: `get_run_summary`, `get_run_events`, `get_level_context`, `get_archive_fragments`,
   `get_bible_entries` (only what the player may know by this chapter), `get_story_history` and
   `get_approved_climate_fact`. It returns the text plus every factual claim it makes (landmark statuses, counts,
   records, facts).
3. The **Historian** checks the draft with its own tools, including the deterministic `validate_narrative_events`
   and `check_narrative_continuity`. It answers *approve* or *revise* with specific issues, and the Archivist
   rewrites. There are at most three reviews, four for the epilogue.
4. A **deterministic validator** (`src/story/validate.ts`) must pass before anything is shown. Every declared
   claim must match the evidence. Numbers must come from the run or a cited fact, and names must be known by this
   chapter. There must be no casualty claims, and "left standing" only for a landmark that was reached and intact.
   Otherwise the authored reflection is shown.

**Models and keys.** The course rules say "use your PORTKEY_API_KEY with gpt-6-luna only. No other models on the
course key." and "if you want a different model, use your own personal API key and pay for it yourself". The
OpenAI key must be named `OPENAI_API_KEY`. So the model decides which key pays, never the key that happens to be
present:

| Model | Key | Sent to | USD per 1M tokens: input / cached / cache write / output |
| --- | --- | --- | --- |
| `gpt-6-luna` (default) | `PORTKEY_API_KEY`, the course key | Portkey, `https://api.portkey.ai/v1` | 0.10 / 0.01 / 0.125 / 0.50 |
| `gpt-6-sol` (optional) | `OPENAI_API_KEY`, your own, **billed to you** | OpenAI, `https://api.openai.com/v1` | 2.00 / 0.20 / 2.50 / 10.00 |

Prices come from the OpenAI pricing page (<https://developers.openai.com/api/docs/pricing>, standard short-context
rates, recorded 2026-10-21 and re-checked 2026-10-25). `gpt-6-sol` is exactly 20 times `gpt-6-luna` on every
component.

- **To use `gpt-6-sol`:** add `OPENAI_API_KEY=...` to the same `.env` (project folder or a parent) and restart
  `npm run dev`. Then choose *Settings → Story Mode → AI model → gpt-6-sol*. Without the key the option is disabled
  and says why. `gpt-6-luna` stays the default and is always one click away.
- **No silent switch.** Each reflection and epilogue request carries the player's choice. The server checks it
  against its allowlist (`MODEL_PROVIDERS` in `src/server/config.ts`) and against what can run now. If `gpt-6-sol`
  is chosen but cannot run (no key, or today's limit spent), nothing is sent. The authored text is shown with the
  reason, and nothing moves to `gpt-6-luna`.
- **Key isolation.** The Portkey transport refuses any model but `gpt-6-luna` before sending, and the OpenAI
  transport refuses anything but `gpt-6-sol`. Each key goes only to its own host. A base-URL override that points
  one at the other's host is refused, in any spelling, such as a trailing dot or another name for this machine.
  Keys travel only in the `Authorization` header, and both are in the output scanner's secrets. The browser learns
  only whether each model is available and, if not, why.
- **Cost and the daily limit.** No `gpt-6-sol` run has been made: there was no `OPENAI_API_KEY` on the
  development machine. So its cost is a **projection, not a measurement**. The playthrough measured on 2026-10-25
  would cost about **$0.90** at sol prices, instead of $0.0449. The 2026-10-21 one would cost $0.63 instead of
  $0.0314 (arithmetic in `docs/evidence/TOKENOMICS.md`). `OPENAI_DAILY_USD_LIMIT` (default **2.00** USD per UTC
  day, so about two such playthroughs) bounds what `gpt-6-sol` charges to your key.
  - Before each request is sent, the server holds the most that request could cost (its *ceiling*). The ceiling
    prices every byte of the request body at the cache-write rate, plus the request's whole output allowance. The
    request is refused if today's charges plus the ceiling would pass the limit.
  - Requests in flight count with their ceilings, so narratives running at once cannot pass the limit together.
    When the answer comes, the hold becomes its real cost from its usage at the price table
    (`src/server/pricing.ts`). A request that returns no usage (timed out or cancelled, so possibly billed) stays
    charged at its ceiling.
  - Once the limit is reached, `gpt-6-sol` is refused until 00:00 UTC. `0` turns it off, and values above 20 are
    capped at 20.
  - The day's charges are kept in a small file per key and day in the OS temp folder, named by a hash of the key
    (never the key). Every server on this machine that uses the same key counts against one limit, and a restart
    keeps the day.
  - Not covered: two servers deciding in the same instant (there is no lock, so each could send one request), and
    the key used on other machines.
- Usage records (`provider` next to `model`) and traces say which model and which key paid. `GET /api/story/usage`
  splits totals by model and reports today's own-key charges.

**Safety in detail:**

- Each agent has its own tool allowlist, with schema-validated tool arguments and results.
- Loops are bounded: 6 model rounds and 12 tool calls per agent, a 45 s timeout per request with one retry, and a
  deadline per narrative (170 s, 290 s for the epilogue). The run stops as soon as the browser gives up.
- Budgets cap requests (300 per server process) and tokens (1.5 M per UTC day). The API has a 64 KB body limit, a
  same-origin check and a rate limit (12 POSTs a minute).
- Untrusted text is passed only as quoted data. That includes the Historian's issues: they reach the Archivist as
  a JSON array labelled as data, and an issue that reads like an instruction is withheld.
- Generated text is scanned for secrets (a planted canary), and rejected if anything leaks. There are no
  filesystem or shell tools.
- *How this was made* shows a Historian issue only if it passes the same safety scans and name gating as a draft.
  It shows a failed deterministic check only by its label, never with the words it caught.

`npm run agents:injection` runs the live prompt-injection test: an archive entry that orders the agents to reveal a
secret and call forbidden tools. Its recorded outcomes are in `docs/evidence/`.

**Evidence and cost.**

- Every model call that returns is logged from the API's own usage object to `logs/agent-usage.jsonl`, with a full
  trace per run in `logs/traces/`. Both are git-ignored.
- A request that times out or is cancelled returns no usage. It is counted as such, never estimated, so every
  token and cost figure is a lower bound.
- Portkey's response cache is bypassed, so every logged token is a real model call.
- The curated agent runs, traces, driver logs, screenshots and cost analysis (2026-10-21) are in
  `docs/evidence/` (`AGENT_RUNS.md`, `TOKENOMICS.md`, `browser/`, `playthrough/`, `playthrough2/`).
- The report's 2026-10-25 evidence is in `docs/evidence/2026-10-25/`: the measured playthrough's usage log and
  traces, the live injection run, the safety, validator and model-lock outputs, and the usage log of the second
  playthrough recorded for the demo video. Its `README.md` says which file backs which number.
- The measured build is the development build of 2026-10-24 (commit `ba6fa8d`, not in this repository's
  history). This repository's code is that build plus four bug fixes, none in the agent service: a landmark
  notice no longer comes back after a pause; chapter 9 lanes +3 and +3.5 reach the sea; a hull arriving outside
  a road-bridge barrier line rides as before; and chapter 7 frame hitches (the renderer, plus Rapier stepped
  without its per-step handle re-mapping, the same simulation). The full suite passed on this tree (see
  *Testing*).
- Costs use the `gpt-6-luna` price. Every response came from the Azure deployment `gpt-6-luna-global`, whose
  price was not verified.

Measured costs:

- **Measured on 2026-10-25, on the 2026-10-24 build:** one full playthrough with the default AI chapters cost
  **$0.0449**: 82 requests; 516,966 input tokens, 393,501 of them cached; and 51,014 output tokens. That covers
  four reflections, one of which fell back, plus the epilogue. At one playthrough per user per month, that is about $4.49 a month
  for 100 players and $449 for 10,000.
- **On the 2026-10-21 build:** the same playthrough cost $0.0314 (`TOKENOMICS.md`).
- **A second playthrough** on the submitted build (the one recorded for the demo video) cost $0.0414: 69
  requests, 5 of 5 narratives approved. Two playthroughs are a small sample.
- **Capacity:** at the measured size of a story (567,980 tokens), the daily token budget allows about 2.6 full
  AI stories per server per day. The report has the tables.

## Sound

Arcade Mode has background music: Mozart's K.545, then a Chopin waltz, 2 dB under the effects. Story Mode plays a
piano piece per chapter.

- **Effects follow the real impact.** Every collision, break, splash and landing has its own sound, and its
  loudness, length and brightness follow the impact: a light tap sits about 20 dB below a house collapse and 26 dB
  below a dam break. The iceberg scrapes and slides by its real speed, mass and ground.
- **Continuous layers.** Rivers, streams, waterfalls (only where water really falls), a dam-break flood, the wind
  and the sea are continuous layers.
- **Church bells** ring in the background wherever a level has a church. They strike the hour as you approach
  (three in Arcade, six in Story) and stop when their tower falls.
- **In Story Mode the sound is a quiet tragedy:** no voices, sirens or explosions. After each real loss the music
  takes a breath and comes back a little lower. After a run, if a document a person wrote surfaced, the chapter's
  piece makes way for an original piano motif, *No. 14*.

*Settings → Sound* has master, music, ambience and effects volumes and two mutes (**M** mutes everything). Pause
dips the music and silences the rest; a hidden tab pauses it all; nothing plays before your first click or key
press. All effects, ambience, bells and the motif are synthesized in the browser, with no samples. `docs/AUDIO.md`
covers how it works, what was measured and what still needs a listener; the sources are in `docs/AUDIO_CREDITS.md`.

## Levels

| # | Level | Iceberg | To the sea | What it is about |
| --- | --- | --- | --- | --- |
| 1 | Mountain Valley | 30 t | ~0.5 km | Short tutorial: steer, one waterfall, a cottage to topple, reach the sea. |
| 2 | Rocky Canyon | 30 t | ~0.9 km | Steep chutes and three waterfalls; a split with a narrow boulder slot or a wide channel with a sinkhole; a ravine you must jump off a kicker (too slow and you fall in). |
| 3 | Alpine Pass | 40 t | ~1.3 km | An open alpine face: ski runs, hairpins, a glacier tongue and a deadly ravine under a road bridge. Which way is down? |
| 4 | Riverside Town | 100 t | ~1.5 km | A whole hillside town on its river: streets, a railway bank, a fatal gorge and a dam funnel split it into branches — which street reaches the sea? |
| 5 | Glacier Avalanche | 18 t → ~100 t | ~1.3 km | Start small, absorb glacier ice to grow, jump the crevasse below the icefall, and burst the dam only a grown iceberg can break. |
| 6 | Power Valley | 220 t | ~1.8 km | A 220-tonne iceberg loose in an industrial mountain valley with a real river: wind farm, rail yard, power plant, a dam and its reservoir. |
| 7 | Ravine Run | 30 t | ~1.4 km | An open red-rock mountainside cut by six fatal ravines: pick your crossing, keep your speed. |
| 8 | Highland Maze | 60 t | ~1.7 km | An open highland with many ways down — crags, blind glens, lochans and a gorge. Most of them end badly. |
| 9 | Summit Labyrinth | 22 t → grows | ~1.8 km | The finale: no marked way down a crevassed summit. Grow on the glacier, burst the dam, fly to the fjord. |

Levels 3–9 are open mountainsides rather than corridors. They have several ways down, dead-end glens, fatal
ravines you must jump with enough momentum, and nothing that marks the way. Every level starts with the iceberg
calving off a glacier.

The natural rivers (levels 3–6 and 9) each have a source. Riverside Town and Power Valley's rivers run out of an
ice portal in that glacier's snout. The others start at a spring pool under a cave in a rock face: the valley
wall, a wall ridge or a rock step. Summit Labyrinth's spring lies under its dam's lake.

Every level has a water budget (the *Ice* gauge), several routes with different risks, and traps where a careless
line gets stuck. Level design notes (key positions, intended line, measured balance) are in each level file's
header in `src/core/levels/`. The authoring rules are in `docs/LEVEL_AUTHORING.md`.

### Graphics quality

*Settings → Graphics quality* offers **Auto** (default), High, Medium and Low:

- *High* adds a bloom glow (post-processing).
- *Medium* keeps shadows without post-processing.
- *Low* drops shadows too.
- *Auto* starts at High and steps down if the measured frame rate stays below ~60 fps, taking 50 Hz screens and
  30 fps power-saving caps into account.

A step-down is applied at the next loading screen, because switching mid-run would freeze while shaders
recompile. It is remembered for later visits; choosing *Auto* again re-measures. If the browser has no WebGL, or the
graphics context is lost and not restored, the game shows an error with *Try again* instead of a blank page.

## What is physics and what is simulated

| Thing | How it works |
| --- | --- |
| Iceberg motion | Custom integrator (not a rigid body): gravity along the terrain slope, friction, drag, steering with grip, airborne flight off cliffs, floating + current in the ocean. Deterministic and unit-tested. |
| Obstacles | Real rigid bodies (Rapier): rocks tumble and roll, trees uproot, and 31 kinds of structures are built from data and shatter into pieces that keep simulating. The kinds are houses, chalets, barns, silos, churches, apartment blocks, monuments, cars, trucks, buses, rail wagons, boats, fences, guardrails, footbridges, road bridges, dams, water towers, lighthouses, pylons, ski-lift pylons, wind turbines, cooling towers, smokestacks, tanks, factory halls, pipelines, pumpjacks, oil rigs, log piles and traffic lights, plus ruined variants for chapter 9. Bridge decks fall when a pier is knocked out. |
| Iceberg ↔ obstacle | One shared momentum rule. Loose bodies exchange `J = 1.25·vn·Mm/(M+m)`; an anchored obstacle breaks iff `1.25·vn·M ≥` its strength (so mass matters as much as speed), and breaking it costs the iceberg the same speed as shoving a loose body of its mass. |
| Ice chipping and growth | How hard the obstacle pushed back on the ice decides the chip (a fraction of the iceberg's *current* ice); chips fly off as melting ice bodies. Absorbing glacier ice adds mass with momentum conserved; size grows with the cube root of the ice. |
| River | A mesh generated from the route you actually took (recorded samples), draped on the terrain; waterfalls are inserted where you flew off a real cliff. The flow look is a shader (advected noise, foam). Not fluid simulation. |
| Water forces | Loose bodies inside the river are pushed along the flow (`flowAt()` queries) and wooden pieces float downstream. |
| Ocean | A large animated wave shader at sea level; the iceberg floats on it. |

## Other scripts

| Command | What it does |
| --- | --- |
| `npm test` | Runs all unit and headless end-to-end tests (vitest). |
| `npm run typecheck` | TypeScript strict type check. |
| `npm run build` | Type-checks and builds a static production bundle into `dist/`. |
| `npm run preview` | Serves the production build locally (the agent service runs there too). |
| `npm run agents:demo` / `agents:injection` | One live Archivist → Historian run on a saved fixture / the live prompt-injection test (needs the key). |
| `npm run agents:gameplay [-- case,case]` | Plays the Story chapters headless and writes their RunEvidence to `docs/evidence/gameplay/` (no model). |
| `npm run agents:story -- <case,case \| all>` | The two agents on that evidence (cases `ch1`, `ch4-through`, `ch4-round`, `ch6`, `ch9`, `epilogue`); real API usage. |
| `npm run agents:report` | Regenerates `docs/evidence/AGENT_RUNS_DETAIL.md` and `tokenomics.json` from the run files. |

## Testing

`npm test` runs 2,676 tests in 181 files, headless. On a fresh install of the submitted build (2026-10-25), 2,672
passed and 4 were skipped, in about 10 minutes. The skipped ones are the five live-model files, which run only
through `npm run agents:*` with a key, and an optional physics stress test (`PHYSICS_PERF=1`). For Story Mode the
suite covers:

- the chapter and archive rules;
- real headless runs of every story level, including the Act I–III escalation tests;
- the agents against a scripted model;
- the validator and the HTTP handler.

For the base game, it includes end-to-end runs of the real level (terrain + physics + river):

- An autopilot completes every level on its intended line, and fails the naive lines where the design says it
  should.
- The river follows the route, and the river geometry has no floating or buried sections on any tested line.
- Getting stuck fails the run.
- Intro, skip, pause and restart work.

Balance and performance measurements are logged in `DEVLOG.md`.

Debug/automation hook in the running game (browser console): `window.__iceberg.snapshot()`, `.runLog()`,
`.setSteer(x | null)`, `.autopilot(true, lane)`, `.fastForward(seconds)`, `.renderStats()`, `.benchmark()`,
`.world()`. The URL flags `?world=off` and `?world=5` preview the world condition.

The sound has its own browser checks. `node scripts/audio-e2e.mjs --serve` starts a dev server on port 5199
(never 5173) and drives the real game in headless Chrome. It checks the music, the controls, pause, leaving, every
level's events, the bells and the Story moments by number (`docs/evidence/AUDIO_RUNS.md`). The sound's debug hook
is `window.__icebergAudio` (`docs/AUDIO.md`).

## Known limitations

- **The agents are slow and sometimes fall back.** A reflection takes about 30 s to 2 minutes, and the epilogue 2
  to 3.5 minutes (measured in the browser). The authored text shows at once, and the agents' version replaces it
  when it is approved. Some runs fall back to the authored text.
  - Earlier sets (`docs/evidence/AGENT_RUNS.md`): 12 of 17 headless runs and 8 of the 10 narratives in the two
    browser playthroughs were approved.
  - On 2026-10-25, in the report's measured playthrough: 4 of 5 were approved. In the second playthrough, on
    the submitted build (the demo video's): 5 of 5.

  Every AI text shown passed the deterministic validator and at least one Historian review. The validator matches
  words, not meaning. Nobody has independently checked the shown texts against the records.
- **Evaluation is thin.** The pilot questionnaire has not been run with participants. The only player feedback is
  one informal session with a fellow student (n = 1).
- **Agent capacity and cost are bounded, not exercised.** One server allows about 2.6 full AI stories a day before
  its token budget stops the agents (the game then shows authored text). `gpt-6-sol` has never run with a real key.
- **The sound has been checked by numbers, not yet by a listener.** The checks were unit and headless tests,
  traces of what was asked for, and browser runs. Whether the synthesized piano, bells and collapses sound right,
  and whether the silences read as consequence, is open (`docs/AUDIO.md`, *What only a human ear can judge*).
  Machines that hum until they are destroyed were planned but not built.
- **The first click or key press has a short delay.** It is the one that unlocks audio. It costs one main-thread
  task of about 0.3–0.45 s in headless Chrome, almost all of it the browser's own `AudioContext` constructor, which
  no page can build before a gesture. On slow machines (the CPU throttled 2x) some of chapter 9's own sounds were
  still baking well into play (`docs/evidence/AUDIO_RUNS.md`, *Slow computers*).
- **The music's level is set by measurement, not by ear** (`docs/MUSIC_CREDITS.md`, `docs/AUDIO.md`).
- **Mouse steering is faster.** Keyboard tap-steering is noticeably slower than smooth mouse steering (measured in
  `DEVLOG.md`).
- **Rendering does not interpolate.** It applies the 60 Hz simulation state directly, so on >60 Hz monitors motion
  can judder slightly.
- **Far-away debris sleeps.** Loose debris far behind goes to sleep to save CPU, so it stops drifting once you are
  ~160 m ahead.
- **The bundle is large and desktop-only.** The production bundle is one ~6.8 MB script (2.5 MB gzipped), because
  Rapier embeds its WebAssembly so the game works offline. `vite build` warns about the size. The game needs a
  desktop browser with WebGL 2, and it is English only.

## Architecture

```
src/
  core/        pure TypeScript game logic — runs headless (no React/DOM/WebGL)
    types.ts       shared data contracts (level, terrain, iceberg, river, obstacles, events, stats)
    terrain/       height-grid terrain + course (valley centreline) from a level definition
    levels/        level data (course, features, obstacle placements, intended line, water budget)
    sim/           iceberg movement integrator + iceberg↔obstacle contact solver
    river/         river trail recording, waterfall insertion, geometry building, flow queries
    physics/       Rapier world: terrain collider, obstacle bodies, destruction, water forces
    obstacles/     obstacle catalog (mass, shape, break thresholds) and spawning
      structures/    data-driven structure kit: one self-registering file per kind
    camera/        follow camera, intro/outro cinematics, river-view orbit camera (pure maths)
    session.ts     one attempt at a level: fixed 60 Hz step, win/lose, stats, events
    api.ts         read-only snapshot of a run (for tools/agents)
    autopilot.ts   scripted steering used by tests and the debug hook
  story/       Story Mode data and logic: bible, chapters + overlays, scoring, evidence, fragment selection,
               validator, world condition, science facts, browser client (shared by the browser and the server)
  server/      the agent service (Node, mounted on the Vite dev and preview servers): Portkey and OpenAI
               transports, tools, Archivist and Historian, budgets, spend cap, usage log and traces; never
               imported by browser code
  render/      React Three Fiber components that draw the core state
  ui/          menus, HUD, overlays (DOM); ui/story/ the Story Mode screens; ui/pilot/ the pilot study
  audio/       music player (a cue per chapter, crossfades), sound engine, synthesis, the game and story sound
               bridge (audio/game, audio/story); docs/AUDIO.md
  input/       mouse/keyboard steering
  state/       zustand stores, saved progress/settings
  game/        UI → session controller
```

Programmatic access: `getSnapshot(session)` in `src/core/api.ts` returns position, velocity, momentum, steering
input, slope, course position, stuck level, progress, distance, time, collision/destruction stats and outcome.
`getRunLog(session)` returns the sampled route and every game event. In the running browser game the same is
available on `window.__iceberg` (see *Testing*).

See `DEVLOG.md` for design decisions, testing notes and known issues. It is a dated log, so its early entries
describe earlier builds.

## Course conventions note

The course-wide `AGENTS.md` is written for Python work (a shared `.venv`, ruff). This project is a Node/TypeScript
application, as the assignment requires, so it uses npm, `tsc` strict mode and vitest instead. The UI is built
with Vite rather than as a single self-contained HTML file, because it needs React, three.js and Rapier. The report
and slides in `deliverables/` are single self-contained HTML files.

## Credits

**Libraries** (all open source, installed by `npm ci`):

- three.js (MIT)
- React and React DOM (MIT)
- React Three Fiber, drei and @react-three/postprocessing (MIT)
- postprocessing (Zlib)
- Rapier, `@dimforge/rapier3d-compat` (Apache-2.0)
- zustand (MIT)
- Vite and @vitejs/plugin-react (MIT)
- Vitest and jsdom (MIT)
- TypeScript (Apache-2.0)

All geometry is procedural, with no third-party art assets. The game loads no web fonts or remote files, so it
runs offline.

**Music.** Six solo-piano recordings from [Musopen](https://musopen.org/), taken from Wikimedia Commons. Story Mode
plays all six, and Arcade Mode the first two. Each file page releases the *recording* into the public domain
(Musopen, `PD-author`, VRT ticket 2008012110017088) or under CC0 1.0. The pieces are:

- Mozart, Sonata K. 545, I. Allegro;
- Chopin, Waltz in A minor, B. 150 (Aya Higuchi);
- Chopin, Nocturne Op. posth. 72 No. 1 (Luke Faulkner);
- Beethoven, "Moonlight" Sonata, I. Adagio sostenuto (Paul Pitman);
- Schumann, Kinderszenen No. 13 "The Poet Speaks" and No. 7 "Träumerei".

Titles, performers, licences and every Commons page are in `docs/MUSIC_CREDITS.md`. The six files in
`public/audio/` (25.4 MB together, the largest 7.2 MB) are the game's only large assets; they ship in the repository
so the game runs offline.

**Sound.** Every sound effect, ambience layer and church bell is original procedural synthesis written for this
game in TypeScript; no samples or recordings are used. The Archive's piano motif, *No. 14*, is an original
composition for this game (2026), played on a synthesized felt piano. The loudness meter's K-weighting filter is
ported from [libebur128](https://github.com/jiixyj/libebur128) (MIT licence, Copyright (c) 2011 Jan Kokemüller;
notice in `src/audio/analysis.ts`). The full list of sources, including ITU-R BS.1770-4, YIN, Schroeder (1965),
Paul Kellet's pink-noise filter and the RBJ Audio EQ Cookbook, is in `docs/AUDIO_CREDITS.md`.

**Science.** The facts in *Science Behind the Story* quote public pages, each linked in the game with the date it
was checked (`src/story/science.ts`):

- the IPCC (AR6 Synthesis Report and WGI Summary for Policymakers headline statements);
- NASA Science (climate change evidence and effects);
- NOAA (Climate.gov on mountain glaciers and global sea level; the National Ocean Service on high tide flooding
  and sea level rise);
- the EPA (pollution pages).

The game shows the same credits under *Science Behind the Story* (`src/ui/story/Credits.tsx`, read from
`src/audio/tracks.ts` and `src/story/science.ts`) and a one-line music credit under the chapter list. The Last
Thaw's towns, people and records are invented.

## AI assistance

- **Code, tests and documents.** This project was built with AI assistance: Claude Code (Anthropic), working as
  a coding agent. That covers the game and agent code, the tests, the sound design and synthesis, the *No. 14*
  motif, the story text and documents, this README, the report and the slides. The author directed the work,
  play-tested it, and reviewed and chose what shipped. He is responsible for every word and number.
- **The research.** The research behind the report (sources, measurements and screenshots) was gathered with the
  same assistance. Every figure was then checked against the app, its logs and the opened sources.
- **The in-game agents.** The Archivist and the Historian are part of the product, not of how it was built. They
  run on `gpt-6-luna` through the course's Portkey gateway.
- **Not AI-generated.** The six music recordings are human performances (Musopen, credited above). The science
  facts quote their sources.
