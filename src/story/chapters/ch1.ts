import type { ChapterDef } from '../types';
import { fragmentsOf, type OverlayRequest } from './authoring';

/**
 * CHAPTER 1 — "The Beginning" (Act I, The Wonder). Level 1, Mountain Valley: the Vell cirque, a
 * falls, and the short valley to the sea. The chapter's job is delight: speed, the falls, the river
 * laying itself down behind you. The tutorial sets the hook the story later turns around (toppling a
 * structure earns Topple points, and the biggest targets earn the most). The only human trace is Lind's
 * survey hut and the boulder he bolted a benchmark into in 1979: the first, quiet warning.
 *
 * Base placements used (src/core/levels/level1.ts): 9 boulder s 222 d -7, 12 stoneBarrier s 276 d 6,
 * 17 broadleaf s 448 d 15, 18 house s 470 d -12 (the centre line clears it; a left line smashes it).
 */

const F = fragmentsOf('ch1-beginning');

/** Act I asks for nothing extra: the valley is as the level builds it. */
export const OVERLAY_REQUESTS: readonly OverlayRequest[] = [];

/**
 * OVERLAY (level design, Act I): none. Nothing was requested and the chapter's job is wonder, so the
 * story plays level 1 itself (storyLevel returns the base LevelDef and shares its cached terrain).
 * Validation: chapterBindingIssues [], validateLevel [] (the base level's own checks).
 * Measured (headless, real session, water budget and chipping on; src/story/chapters/overlays.act1.test.ts):
 *   line        complete 32.5 s · ice 42 % · 0 pts · nothing destroyed · hut 13 m off, intact
 *   hut-left    complete 33.8 s · ice 37 % · 250 pts · home 1 (lane -12 for s 380–480: the survey hut)
 */

export const CH1: ChapterDef = {
  id: 'ch1-beginning',
  index: 1,
  levelId: 'mountain-valley',
  act: 1,
  actTitle: 'The Wonder',
  title: 'The Beginning',
  intro: {
    lines: [
      'High in the mountains of the Vell, the ice has been here for longer than anyone can remember.',
      'This summer, it starts to move.',
      'Go where the ground takes you. The river will follow.',
    ],
    document: {
      id: 'ch1-postcard-1962',
      kind: 'letter',
      title: 'Jean Harper\'s postcard home from Vell Foot',
      date: 'July 1962',
      body:
        'Dear Mum, the glacier comes right down to the top of the valley here. It is as blue as a gas flame, and at ' +
        'night you can hear it creak like an old ship. The man at the inn says it was here long before there were ' +
        'any people to look at it. We went swimming (very briefly!). Please tell Dad that the fishing is hopeless ' +
        'but the view is wonderful. We will be home on Sunday. Love, Jean',
    },
  },
  tutorial: [
    {
      title: 'Steer the thaw',
      body: 'You are a block of glacier ice on its way to the sea. Steer left and right; gravity does the rest. The river forms behind you, exactly where you went.',
    },
    {
      title: 'Topple structures, earn points',
      body: 'Anything built that you knock over earns Topple points: fences, cars, barns, cottages. If it topples, it counts.',
    },
    {
      title: 'Bigger targets, bigger points',
      body:
        'A fence is worth a few points. An oil rig, a pipeline or a tall apartment block is worth the most. Aim for them. The Points guide in the pause menu lists them all.',
    },
    {
      title: 'Reach the sea',
      body: 'Every river ends at the sea. You melt as you go, so smooth lines keep more ice. Get there with some to spare.',
    },
  ],
  caption: 'The top of the Vell valley, with the sea somewhere below.',
  landmarks: [
    {
      id: 'bolted-stone',
      name: 'The bolted stone',
      category: 'nature',
      bind: { source: 'base', index: 9 },
      bibleRefs: ['tomas-lind', 't1979-stake-line', 'vell-foot'],
      label: 'VELL 1979 · BENCHMARK 1',
    },
    { id: 'gate-stones', name: 'The Gate', category: 'nature', bind: { source: 'base', index: 12 }, bibleRefs: ['vell-foot'] },
    {
      id: 'falls-rowan',
      name: 'The rowan below the falls',
      category: 'nature',
      bind: { source: 'base', index: 17 },
      bibleRefs: ['vell-foot'],
    },
    {
      id: 'survey-hut',
      name: 'The survey hut at Vell Foot',
      category: 'home',
      bind: { source: 'base', index: 18 },
      bibleRefs: ['tomas-lind', 'vell-foot', 't1979-stake-line'],
      label: 'Kettle on the shelf',
    },
  ],
  overlay: { obstacles: [] },
  fragments: [
    F({
      id: 'ch1-hut-door-note',
      kind: 'notice',
      title: 'Note pinned to the survey hut door',
      date: 'September 1983',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { always: true },
      priority: 5,
      body:
        'I have gone up the glacier to measure the stakes, and I will be back before dark, probably. The kettle is ' +
        'on the shelf. The tea is in the tin marked NAILS, and the nails are in the tin marked TEA (it is a long ' +
        'story). If you are a walker and the weather has turned, please come in and stay. If you are the man from ' +
        'the university about the unpaid bill, I have gone to the stakes for several weeks. Tomas Lind',
    }),
    F({
      id: 'ch1-notebook-1987',
      kind: 'record',
      title: 'Field notebook: measuring the glacier',
      date: 'September 1987',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { always: true },
      priority: 4,
      body:
        'Stake 4 has melted out of the ice again and is lying on the surface like a dropped pencil. I drilled it ' +
        'back in, two metres down. The ice is thinner at every stake, from 1 to 30, than when I last measured it. ' +
        'The edge of the glacier is now 212 metres from the brass bolt I set in the boulder. I measured it twice, ' +
        'because I did not like the number. Note for my report: say it plainly. Note to myself: they will file it ' +
        'away anyway.',
    }),
    F({
      id: 'ch1-benchmark-register',
      kind: 'record',
      title: 'Survey register: the bolted stone at Vell Foot',
      date: '1979',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { landmark: 'bolted-stone', status: ['intact', 'damaged'] },
      priority: 6,
      body:
        'Benchmark 1, a fixed point for survey measurements. Today I set a brass bolt into a granite boulder on the ' +
        'valley floor, below the glacier. All thirty measuring stakes on the Vell Glacier are measured from this ' +
        'bolt. Distance from the bolt to the edge of the ice, measured with a tape along the valley floor: 61 ' +
        'metres. The bolt is stamped VELL 1979. Measure again every September. Do not move the boulder (a joke). ' +
        'Signed, Tomas Lind. [Added in pencil many years later, in the archivist\'s handwriting: He did measure it, ' +
        'every September.]',
    }),
    F({
      id: 'ch1-hut-gone',
      kind: 'memory',
      title: 'Margin note, in pencil',
      when: { landmark: 'survey-hut', status: 'destroyed' },
      priority: 8,
      body:
        'The survey hut at Vell Foot was empty the summer the water came. I checked, because checking is the kind ' +
        'of thing I do. The kettle went, and so did the tin marked NAILS. The door went too, with sixty years of ' +
        'notes pinned to it, and it is somewhere on its way to the sea. I like to think the last note is still ' +
        'pinned to it, promising that someone will be back before dark.',
    }),
    F({
      id: 'ch1-hut-stands',
      kind: 'memory',
      title: 'Margin note, in pencil',
      when: { landmark: 'survey-hut', status: 'intact' },
      priority: 8,
      body:
        'The survey hut at Vell Foot still stands, with its door shut and the kettle on the shelf. Someone has ' +
        'pinned a new note to the door, in handwriting I do not recognise: "Went up to look at the stakes. Could ' +
        'not find them. Left the tea." Nobody signed it. I have left the note where it is, because an archive ' +
        'does not have to be a box. Sometimes it can be a place.',
    }),
    F({
      id: 'ch1-rowan-photo',
      kind: 'caption',
      title: 'Photograph, undated',
      when: { landmark: 'falls-rowan', status: ['destroyed', 'damaged'] },
      priority: 3,
      body:
        'A rowan tree below the waterfall at Vell Foot, with a red ribbon tied to its lowest branch. On the back ' +
        'someone has written: "For luck on the ice." It does not say whose luck, or whether it worked.',
    }),
    F({
      id: 'ch1-leaflet',
      kind: 'newspaper',
      title: 'Vell Foot: A Day Out (leaflet)',
      date: '1996',
      when: { waterfallsAtLeast: 1 },
      priority: 2,
      body:
        'Follow the path from the shore to the foot of the waterfall, where meltwater from the Vell Glacier drops ' +
        'fifteen metres into the valley. In early summer you may hear the glacier "singing" as the ice moves. ' +
        'Please keep to the path, and please do not climb on the survey marker stones. The survey hut is not a ' +
        'café, however much it looks like one.',
    }),
    F({
      id: 'ch1-clean-run',
      kind: 'caption',
      title: 'Margin note',
      when: { all: [{ destroyedAtMost: 0 }, { outcome: 'complete' }] },
      priority: 6,
      body: 'A clean run: nothing that anyone built was broken. There is nothing to add to the archive this time, and that is worth writing down too.',
    }),
    F({
      id: 'ch1-turned-back',
      kind: 'record',
      title: 'Field notebook: a day I turned back',
      date: 'September 1993',
      author: 'tomas-lind',
      characters: ['tomas-lind'],
      when: { outcome: 'failed' },
      priority: 7,
      body:
        'I had to turn back at stake 12. First the cloud came down on the ice, then sleet, then the kind of wind ' +
        'that makes your decisions for you. The ice does not mind going unmeasured for a day, but I mind a great ' +
        'deal. I will try again tomorrow if it clears. Also, the kettle in the hut has started to leak, which ' +
        'feels personal.',
    }),
  ],
  fallbackReflections: [
    F({
      id: 'ch1-reflection-hut-gone',
      kind: 'reflection',
      title: 'Vell Foot',
      when: { landmark: 'survey-hut', status: 'destroyed' },
      priority: 5,
      body:
        'You came down the Vell in a rush, the way water does when it has been waiting a long time, and at the ' +
        'bottom you went straight through the survey hut. I do not hold that against you. The hut was empty. It ' +
        'belonged to Tomas Lind, who measured the glacier from there for years. What strikes me, reading his notes ' +
        'again, is how ordinary they are: stake numbers, tea, the weather, a kettle that leaked. Every September he ' +
        'measured the same thirty stakes and wrote the results down in pencil. Every year the ice was a little ' +
        'thinner.',
    }),
    F({
      id: 'ch1-reflection-hut-stands',
      kind: 'reflection',
      title: 'Vell Foot',
      when: { landmark: 'survey-hut', status: 'intact' },
      priority: 5,
      body:
        'You left the survey hut alone. You did not have to; it would have earned you points. But it still stands ' +
        'at the bottom of the valley with its door shut, and in the morning there may be a note on the door saying ' +
        'that someone has gone up to measure the stakes. The stakes are poles drilled into the glacier in a ' +
        'numbered line, and every year the ice around them is a little lower. Hardly anyone in the valley paid them ' +
        'much attention. The postcards people sent home from Vell Foot are all about the view.',
    }),
    F({
      id: 'ch1-reflection',
      kind: 'reflection',
      title: 'Vell Foot',
      when: { always: true },
      priority: 0,
      body:
        'Every archive has to start somewhere. This one starts with old ice high in the mountains of the Vell and a ' +
        'run down to the sea, and it was lovely, wasn\'t it? You had the speed, the waterfall, and the river forming ' +
        'behind you exactly where you went. Hold on to that feeling; it was real. Below the waterfall there is a boulder with a ' +
        'brass bolt in it. Tomas Lind set it there in 1979 so that he could measure, every year, how far the ice ' +
        'had moved back. The distance is written in his notebook. It is not a large number yet.',
    }),
  ],
  aiReflection: true,
  music: 'wonder',
};
