# The Last Thaw: demo video script

The demo video (`demo_video.mp4`, 2:31, 1280 × 720, 30 fps) is submitted on Canvas, not kept in this
repository. It is captioned and scored with the game's own music; no voice-over has been recorded for it.
This is the script for one: about 350 words, timed to the cut at no more than 150 words a minute.

## What the footage is

- **Real gameplay, one playthrough.** Every scene was recorded in real time from the running game (the
  repository's own dev server, headless Chrome at 1280 × 720, 25 October 2026). The game's built-in
  autopilot steered; the Story settings were the defaults (agents on the selected chapters, gpt-6-luna),
  with intros skipped. The cut skips the stretches between scenes; nothing was staged or edited inside a
  scene.
- **The agents' text is live.** The epilogue on screen, and the reflections after chapters 1, 4, 6 and 9
  in the same run, were written during that playthrough by the Archivist and the Historian on gpt-6-luna
  through Portkey on the course key. All five were approved. The epilogue passed after four reviews, and
  the validator ran 36 checks on its final draft (the game labels that number "claims"; it counts
  checks, and the draft declared 12 claims).
- **This is a second live playthrough, not the report's.** It ran on the submitted build and cost
  $0.0414 (69 requests, 491,889 input and 43,764 output tokens, 5 of 5 approved). The report's measured
  playthrough cost $0.0449, with 4 of 5 approved. Both usage logs are in `docs/evidence/2026-10-25/`.
- **Music:** the game's own public-domain recordings (Musopen via Wikimedia Commons): Mozart K. 545
  (I. Allegro) under the title and chapter 1, Beethoven's "Moonlight" Sonata (I. Adagio sostenuto, Paul
  Pitman) under chapters 4 to 8, and Schumann's "Träumerei" from chapter 9 to the end. The end card
  credits them. The bed sits at about −23 LUFS, so a voice can sit on top.

## The script

The captions burned into the video are the "cue on screen" column.

| Time | On screen | Cue on screen | Narration |
| --- | --- | --- | --- |
| 0:00–0:09 | Title card, then the Chapter 1 card with Jean Harper's 1962 postcard | (title card) | Hi, I'm Saman Verma. This is *The Last Thaw*, Story Mode of my game Iceberg River, in nine chapters. |
| 0:09–0:20 | Chapter 1: a green valley; the blue meltwater river forms behind the glowing iceberg | Act I is green: clear water, clear sky. | You steer a melting iceberg down a mountain river to the sea. Chapter one is green and clear, and knocking things over just earns you points. |
| 0:20–0:27 | Chapter 4, Riverside: the iceberg breaks No. 14 Church Lane (0:22), then the Pells' house next door | Then the valley fills with homes. | By chapter four the valley is full of people's homes, and the ice goes straight through them. |
| 0:27–0:35 | The archive after the chapter: Mara Vey's memory "No. 14", the chalk mark on her door | What you topple comes back as a human record. | After each chapter, what you toppled comes back as a human record: one woman's chalk mark on her door. |
| 0:35–0:42 | Chapter 6, Power Valley: the north cooling tower falls under a hazy sky; the grass is yellowing | The water greys. The sky hazes over. | And the world changes, whatever you do: the water greys, the sky hazes, the grass yellows. |
| 0:42–0:57 | The Chapter 7 card, then the Red Mesa: the plant's tanks stand across the only way down; "Broken: The Calder processing plant" at 0:48; the river is brown | Every tested route down breaks the Calder plant. | This is the heart of it. By chapter seven the river runs brown, and the Calder processing plant stands across the only way down. Steer as carefully as you like: every route we tested breaks it. |
| 0:57–1:04 | The Water Board's notice, 14 August 2039: "Red Mesa: do not use the water" | Two days later: do not use the water. | Two days later, the notice: do not drink from any well or stream on the mesa. |
| 1:04–1:24 | Chapter 8: the Clachan power station breaks in the first seconds (1:06), then the overcrowded glen under a grey sky | So crowded that every way down we tested breaks something. | Chapter eight is so crowded that every way down we tested breaks something, starting with the power station. The grey sky and dying grass come with the chapter; careful play can't bring the green back. Climate change doesn't care about feelings, good or bad. |
| 1:24–1:50 | Chapter 9: the grown iceberg bursts the Upper Vell dam (1:25), then the abandoned lower terrace (1:31), the fjord chapel (1:41), the sea | Grey snow, brown water, a dam built too late. / Abandoned after repeated floods, by everyone. | Chapter nine. The dam was built late, and it goes. Below it, the lower terrace was abandoned before you got here. Flood after flood emptied it, and everyone left, good people and bad alike, because the water did not choose. Every way we tested through the village breaks something; you can only reach the sea. |
| 1:50–1:58 | The archive: Mara Vey's memory "The lower terrace" | They left one flood at a time. | The archive puts it plainly: they left one flood at a time, each family hoping it was the last. |
| 1:58–2:11 | The epilogue "Where the River Goes", written by the agents, over the river this run carved | The Archivist writes from your own record. / The Historian checks it against that record. | What's new is the two agents, on gpt-6-luna. The Archivist wrote this epilogue from this run's record; the Historian checked it against that record, over four rounds of review. |
| 2:11–2:17 | "How this was made": the Historian's corrections and the validator's 36 checks | Four reviews, then a validator, before you read it. | Then a validator checks each claim; if anything fails, you read text written in advance. |
| 2:17–2:31 | A last look at the brown mesa (from chapter 7), then the end card: repo link, how to run it, credits | (end card) | One classmate played it. In my words, not his: he tried to avoid people's lives and infrastructure, but people had already done too much damage, so he could only destroy, until he felt almost numb. |

## What each claim rests on

- **"Every route we tested breaks it"** (chapter 7), **"every way down we tested breaks something"**
  (chapters 8 and 9): the repository's test `src/story/chapters/overlays.act3.test.ts` plays the routes
  with the real physics. Every chapter 7 run that reaches the sea breaks the Calder processing plant; all
  106 of the 221 chapter 8 steering plans that reached the sea broke the power station; on each chapter's
  four main tested lines at least 5, 7 and 8 built structures break in chapters 7, 8 and 9. The claim is
  about tested routes: in the same chapters some named places can still be spared.
- **"The grey sky and dying grass come with the chapter"**: the world's look is set per chapter
  (`src/story/environment.ts`); what was toppled earlier can make it only a little worse, so a perfectly
  careful player still sees the brown and grey in chapters 7 to 9.
- **"The dam was built late"**: the Upper Vell dam's label reads "Built 2029, in eleven months", and Mara
  Vey's memory says it was "done late and only once."
- **"Everyone left ... one flood at a time"**: the abandoned houses carry the label "Abandoned after the
  floods"; Mara Vey's memory says people "left over five years, one flood at a time," and the last family
  moved out after the flood of 2036. Nobody dies anywhere in the story: every evacuation worked.
- **"Good people and bad alike, because the water did not choose"**: the author's reading of the chapter.
  The archive spreads responsibility over many people and decades and names no villains.
- **The agents**: the Archivist writes, the Historian reviews (up to 3 reviews for a reflection, 4 for the
  epilogue), and the deterministic validator checks the declared claims and blocks casualty wording it
  recognises. It catches wording, not every paraphrase, which is why the Historian also reads every draft.
  If any of it fails, the authored text stays on screen. The story text and documents were written with
  AI assistance (see the README).
- **The classmate**: one fellow student, informal feedback, no survey data (n = 1). The line is the
  author's paraphrase of what he said, not a quotation, and adds nothing he did not say. The game's
  built-in pilot questionnaire has not been run with participants yet.
