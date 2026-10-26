import type { ClimateFact, MetaphorNote } from './types';

/**
 * "Science Behind the Story": the only real-world claims in Story Mode, kept apart from the fiction
 * (docs/STORY_MODE.md, rule 3). The Archivist may cite a fact by id (get_approved_climate_fact) and must
 * quote or closely paraphrase its statement; the deterministic validator then allows only the figures in
 * that fact's `numbers`. So a statement here is a promise: it says nothing its source page does not say.
 *
 * HOW THESE WERE CHECKED (2026-10-21). Every source page was downloaded that day and every sentence of
 * every statement was found, character for character, in the page's text (markup removed, HTML entities
 * decoded, curly quotes, dashes and whitespace normalised), then read in context; each page's <title> is
 * the recorded title. So each statement is the page's own wording: one to three whole sentences from one
 * page, joined, nothing reworded. Cut from IPCC headline statements: the confidence tags ("(high
 * confidence)") and the braced section references, which belong to the report's apparatus rather than the
 * claim. A claim that a page did not support was dropped rather than softened into one it did. Sources
 * are NASA (science.nasa.gov), NOAA (climate.gov, oceanservice.noaa.gov) and the IPCC Sixth Assessment
 * Report (AR6) headline statements of the Working Group I and Synthesis Report Summaries for
 * Policymakers, chosen because those pages are stable and written for a general reader. Each entry's
 * comment says where on its page the words are.
 *
 * THE FOUR POLLUTION FACTS (added 2026-10-24, after the second playtest asked the story to show how
 * people's waste and activity make the land ugly: the brown water, the grey skies, the litter, the
 * runoff). Checked the same way that day: each page was downloaded, its text extracted and normalised,
 * and every sentence below found in it character for character, then read in context. Sources: three US
 * EPA pages (nonpoint source pollution, flooding, visibility and haze) and NOAA Ocean Service's "What is
 * marine debris?". They carry no figures. They tie the game's look (src/story/environment.ts) to the
 * real processes behind it: runoff carries pollutants into rivers, flood water carries sewage and the
 * contents of damaged tanks, pollution particles make haze, and drains and sewers carry litter to the
 * shore. A fifth (added the same day, after the playtest 2 review found chapter 7's premise uncited):
 * the EPA's Class II injection wells page on the brine, saltier than seawater, that oil and gas bring up,
 * and what it does to water and land: the salty, oily water in the Calder processing plant's tanks and
 * the salted fields below them. Checked the same way (downloaded, normalised, found word for word).
 *
 * NUMBERS. `numbers` lists every digit run in the statement exactly as printed, without its unit, and
 * nothing else: '1.1' for "1.1°C", '2023' and '24' for "2023/24", '37' for "37th", '8' and '9' for "8–9".
 * Bare figures, because that is what a validator extracts from generated text; science.test.ts holds the
 * two lists equal. Figures the pages write as words ("twice", "three complete decades") are not listed:
 * the check works on digits.
 *
 * WHY THESE NINETEEN. They follow the story's arc rather than a textbook's: people warmed the climate, and
 * not all people equally; the ice that feeds rivers is going; land ice raises the sea; water reaches
 * further inland; the things people built stand in its way, and what they built and threw away runs
 * downhill with the water (the five pollution facts); some of it cannot be undone; and yet the amount
 * still depends on what is done next, and waiting narrows the choices. The theme ("You cannot undo the
 * river behind you. You can still decide where it goes next.") is set-in-motion and
 * limited-not-unavoidable, in the agencies' own words.
 */

/** Theme tags (FactTheme) let the agents and the UI pick a fact that fits a chapter. */
export const FACT_THEMES = [
  'human-influence',
  'responsibility',
  'glaciers',
  'ice-sheets',
  'sea-level',
  'coastal-flooding',
  'river-flooding',
  'infrastructure',
  'irreversibility',
  'adaptation',
  'mitigation',
  'delay',
  'pollution',
] as const;

export type FactTheme = (typeof FACT_THEMES)[number];

/** The date every source below was opened and checked. */
const ACCESSED = '2026-10-21';

const SYR = {
  org: 'IPCC',
  title: 'AR6 Synthesis Report: Summary for Policymakers Headline Statements',
  url: 'https://www.ipcc.ch/report/ar6/syr/resources/spm-headline-statements/',
  accessed: ACCESSED,
} as const;

const WGI = {
  org: 'IPCC',
  title:
    'WGI Summary for Policymakers Headline Statements | Climate Change 2021: The Physical Science Basis',
  url: 'https://www.ipcc.ch/report/ar6/wg1/resources/spm-headline-statements/',
  accessed: ACCESSED,
} as const;

const NASA_EVIDENCE = {
  org: 'NASA',
  title: 'Evidence - NASA Science',
  url: 'https://science.nasa.gov/climate-change/evidence/',
  accessed: ACCESSED,
} as const;

const NASA_EFFECTS = {
  org: 'NASA',
  title: 'Effects - NASA Science',
  url: 'https://science.nasa.gov/climate-change/effects/',
  accessed: ACCESSED,
} as const;

const NOAA_GLACIERS = {
  org: 'NOAA',
  title: 'Climate change: mountain glaciers | NOAA Climate.gov',
  url: 'https://www.climate.gov/news-features/understanding-climate/climate-change-mountain-glaciers',
  accessed: ACCESSED,
} as const;

const NOAA_SEA_LEVEL = {
  org: 'NOAA',
  title: 'Climate Change: Global Sea Level | NOAA Climate.gov',
  url: 'https://www.climate.gov/news-features/understanding-climate/climate-change-global-sea-level',
  accessed: ACCESSED,
} as const;

const NOS_HIGH_TIDE = {
  org: 'NOAA',
  title: 'What is high tide flooding?',
  url: 'https://oceanservice.noaa.gov/facts/high-tide-flooding.html',
  accessed: ACCESSED,
} as const;

const NOS_SEA_LEVEL = {
  org: 'NOAA',
  title: 'Is sea level rising?',
  url: 'https://oceanservice.noaa.gov/facts/sealevel.html',
  accessed: ACCESSED,
} as const;

/** The date the five pollution sources were opened and checked. */
const ACCESSED_POLLUTION = '2026-10-24';

const EPA_NPS = {
  org: 'EPA',
  title: 'Basic Information about Nonpoint Source (NPS) Pollution | US EPA',
  url: 'https://www.epa.gov/nps/basic-information-about-nonpoint-source-nps-pollution',
  accessed: ACCESSED_POLLUTION,
} as const;

const EPA_FLOODING = {
  org: 'EPA',
  title: 'Flooding | US EPA',
  url: 'https://www.epa.gov/natural-disasters/flooding',
  accessed: ACCESSED_POLLUTION,
} as const;

const EPA_VISIBILITY = {
  org: 'EPA',
  title: 'Basic Information about Visibility | US EPA',
  url: 'https://www.epa.gov/visibility/basic-information-about-visibility',
  accessed: ACCESSED_POLLUTION,
} as const;

const NOS_MARINE_DEBRIS = {
  org: 'NOAA',
  title: 'What is marine debris?',
  url: 'https://oceanservice.noaa.gov/facts/marinedebris.html',
  accessed: ACCESSED_POLLUTION,
} as const;

const EPA_CLASS_II = {
  org: 'EPA',
  title: 'Class II Oil and Gas Related Injection Wells | US EPA',
  url: 'https://www.epa.gov/uic/class-ii-oil-and-gas-related-injection-wells',
  accessed: ACCESSED_POLLUTION,
} as const;

/** A fact whose theme tags are checked against FACT_THEMES at compile time. */
type ThemedFact = ClimateFact & { readonly themes: readonly FactTheme[] };

/** Approved, cited climate facts, in the order of the story's arc (see the module comment). */
export const CLIMATE_FACTS: readonly ClimateFact[] = [
  {
    // SYR headline A.1, first sentence.
    id: 'human-caused-warming',
    statement:
      'Human activities, principally through emissions of greenhouse gases, have unequivocally caused ' +
      'global warming, with global surface temperature reaching 1.1°C above 1850–1900 in 2011–2020.',
    source: SYR,
    themes: ['human-influence'],
    numbers: ['1.1', '1850', '1900', '2011', '2020'],
  },
  {
    // SYR headline A.1, second sentence, and A.2, its sentence on who is affected. The brief asks the
    // story not to suggest that all humans were equally responsible; this is the source that says so.
    id: 'unequal-contributions',
    statement:
      'Global greenhouse gas emissions have continued to increase, with unequal historical and ongoing ' +
      'contributions arising from unsustainable energy use, land use and land-use change, lifestyles and ' +
      'patterns of consumption and production across regions, between and within countries, and among ' +
      'individuals. Vulnerable communities who have historically contributed the least to current climate ' +
      'change are disproportionately affected.',
    source: SYR,
    themes: ['responsibility', 'human-influence'],
    numbers: [],
  },
  {
    // Climate.gov glaciers: the article's second sentence, then the "Highlights" line on acceleration.
    id: 'glacier-loss-accelerating',
    statement:
      'Based on preliminary data, 2023/24 was the 37th year in a row that the reference glaciers tracked ' +
      'by the World Glacier Monitoring Service lost rather than gained ice. Ice loss in mountain glaciers ' +
      'is accelerating: each of the last three complete decades has brought bigger declines than the ' +
      'decade before.',
    source: NOAA_GLACIERS,
    themes: ['glaciers'],
    numbers: ['2023', '24', '37'],
  },
  {
    // NASA Evidence, "The Ice Sheets Are Shrinking" (GRACE gravity data).
    id: 'ice-sheets-shrinking',
    statement:
      "The Greenland and Antarctic ice sheets have decreased in mass. Data from NASA's Gravity Recovery " +
      'and Climate Experiment show Greenland lost an average of 279 billion tons of ice per year between ' +
      '1993 and 2019, while Antarctica lost about 148 billion tons of ice per year.',
    source: NASA_EVIDENCE,
    themes: ['ice-sheets'],
    numbers: ['279', '1993', '2019', '148'],
  },
  {
    // Climate.gov sea level: the first two sentences of the article body.
    id: 'sea-level-land-ice',
    statement:
      'Global mean sea level has risen about 8–9 inches (21–24 centimeters) since 1880. The rising ' +
      'water level is mostly due to a combination of melt water from glaciers and ice sheets and ' +
      'thermal expansion of seawater as it warms.',
    source: NOAA_SEA_LEVEL,
    themes: ['sea-level', 'glaciers', 'ice-sheets'],
    numbers: ['8', '9', '21', '24', '1880'],
  },
  {
    // NOAA Ocean Service, high tide flooding: two sentences of the body. ("U.S." is the page's scope.)
    id: 'high-tide-flooding',
    statement:
      'As relative sea level rises, it no longer takes a strong storm or a hurricane to cause coastal ' +
      'flooding. Because of rising seas, land subsidence, and the loss of natural barriers, high tide ' +
      'flooding is now twice as frequent in U.S. coastal communities as it was 20 years ago.',
    source: NOS_HIGH_TIDE,
    themes: ['coastal-flooding', 'sea-level'],
    numbers: ['20'],
  },
  {
    // Climate.gov glaciers, "Impacts of glacier loss". The nearest real thing to the game's dam breaks.
    id: 'glacial-outburst-floods',
    statement:
      'As glaciers melt, some are experiencing dangerous “outburst floods.” These events occur when ' +
      'fragile ice dams or moraines holding back newly formed meltwater lakes give way and release huge ' +
      'pools of meltwater over hours or days.',
    source: NOAA_GLACIERS,
    themes: ['river-flooding', 'glaciers'],
    numbers: [],
  },
  {
    // NOAA Ocean Service, "Is sea level rising?": the last two sentences of the page. It names the very
    // structures Story Mode scores (oil and gas wells, power plants, bridges), which is why it was chosen.
    id: 'infrastructure-at-risk',
    statement:
      'In urban settings, rising seas threaten infrastructure necessary for local jobs and regional ' +
      'industries. Roads, bridges, subways, water supplies, oil and gas wells, power plants, sewage ' +
      'treatment plants, landfills—virtually all human infrastructure—is at risk from sea level rise.',
    source: NOS_SEA_LEVEL,
    themes: ['infrastructure', 'sea-level', 'coastal-flooding'],
    numbers: [],
  },
  {
    // EPA, nonpoint source pollution: the third and fourth sentences of the Overview. "NPS" is the
    // page's own abbreviation for nonpoint source, spelled out in its title. Why the rivers run brown.
    id: 'polluted-runoff',
    statement:
      'NPS pollution is caused by rainfall or snowmelt moving over and through the ground. As the runoff ' +
      'moves, it picks up and carries away natural and human-made pollutants, finally depositing them into ' +
      'lakes, rivers, wetlands, coastal waters and ground waters.',
    source: EPA_NPS,
    themes: ['pollution', 'river-flooding'],
    numbers: [],
  },
  {
    // EPA, flooding: the third sentence under "During flooding" (after the two on whom to contact), then
    // the first under "Underground Storage Tanks". What flood water carries out of the towns and tanks it
    // reaches.
    id: 'flood-water-contamination',
    statement:
      'Avoid contact with flood water due to potentially elevated levels of contamination associated with ' +
      'raw sewage and other hazardous or toxic substances that may be in the flood water. During a flood, ' +
      'underground storage tank (UST) systems may become displaced or damaged and release their contents ' +
      'into the environment, causing soil, surface water, and groundwater contamination.',
    source: EPA_FLOODING,
    themes: ['pollution', 'river-flooding', 'infrastructure'],
    numbers: [],
  },
  {
    // EPA, visibility: the first and fourth sentences of the answer to "What is haze?", then the sentence
    // on manmade sources under "Where does haze-forming pollution come from?". The grey skies.
    id: 'haze-from-pollution',
    statement:
      'Haze is caused when sunlight encounters tiny pollution particles in the air. More pollutants mean ' +
      'more absorption and scattering of light, which reduce the clarity and color of what we see. Manmade ' +
      'sources can include motor vehicles, electric utility and industrial fuel burning, and manufacturing ' +
      'operations.',
    source: EPA_VISIBILITY,
    themes: ['pollution', 'human-influence'],
    numbers: [],
  },
  {
    // NOAA Ocean Service, "What is marine debris?": the second sentence of the article's first paragraph
    // and the second of its third. The litter the records find in streams, fences and ditches (the game
    // draws none; the documents of chapters 6 to 9 describe it).
    id: 'litter-from-drains',
    statement:
      'Our ocean and waterways are polluted with a wide variety of marine debris ranging from soda cans and ' +
      'plastic bags to derelict fishing gear and abandoned vessels. A majority of the trash and debris that ' +
      'covers our beaches comes from storm drains and sewers, as well as from shoreline and recreational ' +
      'activities such as picnicking and beachgoing.',
    source: NOS_MARINE_DEBRIS,
    themes: ['pollution'],
    numbers: [],
  },
  {
    // EPA, Class II injection wells: the three sentences under "Protecting drinking water resources"
    // (the page, last updated June 3, 2026, also says "Class II fluids are primarily brines (salt water)
    // that are brought to the surface while producing oil and gas"). The salty water chapter 7's
    // processing plant keeps in its tanks, and what it does to the fields it reaches.
    id: 'oil-field-brine',
    statement:
      'Extraction of oil and gas usually produces large amounts of brine. Often saltier than seawater, this ' +
      'brine can contain toxic metals and radioactive substances. Brines can damage the environment and ' +
      'public health if discharged to water or land.',
    source: EPA_CLASS_II,
    themes: ['pollution'],
    numbers: [],
  },
  {
    // WGI headline B.5, whole.
    id: 'irreversible-ice-and-sea',
    statement:
      'Many changes due to past and future greenhouse gas emissions are irreversible for centuries to ' +
      'millennia, especially changes in the ocean, ice sheets and global sea level.',
    source: WGI,
    themes: ['irreversibility', 'ice-sheets', 'sea-level'],
    numbers: [],
  },
  {
    // SYR headline B.3, first two sentences: irreversible is not the same as fixed in size.
    id: 'limited-not-unavoidable',
    statement:
      'Some future changes are unavoidable and/or irreversible but can be limited by deep, rapid and ' +
      'sustained global greenhouse gas emissions reduction. The likelihood of abrupt and/or irreversible ' +
      'changes increases with higher global warming levels.',
    source: SYR,
    themes: ['irreversibility', 'mitigation'],
    numbers: [],
  },
  {
    // NASA Effects, the whole answer to "Is it too late to prevent climate change?": consequences already
    // set in motion, and what stopping would still change.
    id: 'set-in-motion',
    statement:
      'Humans have caused major climate changes to happen already, and we have set in motion more changes ' +
      'still. However, if we stopped emitting greenhouse gases today, the rise in global temperatures ' +
      'would begin to flatten within a few years. Temperatures would then plateau but remain well-elevated ' +
      'for many, many centuries.',
    source: NASA_EFFECTS,
    themes: ['irreversibility', 'mitigation', 'human-influence'],
    numbers: [],
  },
  {
    // SYR headline C.3, last sentence: the options existed.
    id: 'options-available',
    statement:
      'Feasible, effective, and low-cost options for mitigation and adaptation are already available, with ' +
      'differences across systems and regions.',
    source: SYR,
    themes: ['mitigation', 'adaptation'],
    numbers: [],
  },
  {
    // SYR headline B.4, first two sentences: the options narrow as warming grows.
    id: 'adaptation-narrows',
    statement:
      'Adaptation options that are feasible and effective today will become constrained and less ' +
      'effective with increasing global warming. With increasing global warming, losses and damages will ' +
      'increase and additional human and natural systems will reach adaptation limits.',
    source: SYR,
    themes: ['adaptation', 'delay'],
    numbers: [],
  },
  {
    // SYR headline C.2, second sentence: what waiting costs.
    id: 'delay-locks-in',
    statement:
      'Delayed mitigation and adaptation action would lock-in high-emissions infrastructure, raise risks ' +
      'of stranded assets and cost-escalation, reduce feasibility, and increase losses and damages.',
    source: SYR,
    themes: ['delay', 'infrastructure', 'mitigation', 'adaptation'],
    numbers: [],
  },
] satisfies readonly ThemedFact[];

/**
 * Where the game is metaphor, not simulation. Shown beside the facts so that nothing in play is mistaken
 * for a model of the real thing. Written without figures on purpose: a note is not a measurement, and an
 * agent quoting one must not pick up a number the validator would (rightly) reject. Where a note leans on
 * a real fact it names the agency, and the fact itself is in CLIMATE_FACTS or on the cited page (NOAA's
 * "What is an iceberg?", oceanservice.noaa.gov/facts/iceberg.html, for the first note).
 */
export const METAPHOR_NOTES: readonly MetaphorNote[] = [
  {
    id: 'iceberg-on-land',
    gameElement: 'An iceberg sliding downhill over land',
    explanation:
      'A real iceberg is ice that has broken off a glacier or an ice shelf and floats in open water ' +
      '(NOAA). Icebergs do not travel over land, and glaciers, which do move downhill, move slowly. In ' +
      'the game the iceberg stands for consequences already set in motion by earlier decades: the player ' +
      'steers it but cannot stop it. It is not a model of how ice moves.',
  },
  {
    id: 'river-behind',
    gameElement: 'A river forming behind the iceberg along its exact route',
    explanation:
      'The game draws its river from the iceberg’s own meltwater, along the exact line the player took, ' +
      'and it keeps flowing after the iceberg has passed. Real rivers gather rain, snowmelt, groundwater ' +
      'and, in many mountain regions, glacier meltwater from a whole landscape, and their channels form ' +
      'over long periods. The river is a picture of the theme: what is done behind you stays done.',
  },
  {
    id: 'melt-by-distance',
    gameElement: 'Melting with distance travelled, and faster on a winding route',
    explanation:
      'The Ice gauge drains with every stretch of river laid on land, and faster when the route winds back ' +
      'and forth. That rule rewards smooth, decided lines; it is a game rule. Real ice melts because of ' +
      'heat, from warm air, sunlight and warm water, not because of the path it takes or how often it turns.',
  },
  {
    id: 'growth-by-absorbing',
    gameElement: 'Growing by absorbing glacier ice',
    explanation:
      'Ploughing into glacier blocks makes the iceberg heavier and able to break more. Real glaciers do ' +
      'not merge like this: they gain mass from snowfall, and from snow carried onto them by wind and ' +
      'avalanches, and lose it by melting, sublimation and, where they end in water, calving icebergs ' +
      '(NOAA). In the game, growth is how consequences gather weight as the story goes on.',
  },
  {
    id: 'reaching-the-sea',
    gameElement: 'Reaching the sea to finish a level',
    explanation:
      'A level ends when the iceberg floats out to sea. Meltwater from land ice that reaches the real ' +
      'ocean adds to sea level rise (NOAA), but the game does not model sea level: the sea does not rise ' +
      'while you play, and no score stands for water.',
  },
  {
    id: 'destruction-points',
    gameElement: 'Points for destruction',
    explanation:
      'Story Mode weights each broken structure by how much harm it could do to people and the environment ' +
      'if it failed: an oil rig or a pipeline more than a fence, an apartment block more than a barn. The ' +
      'weights are a design choice, there to make the player notice what they are hitting. They are not ' +
      'measurements of emissions, pollution, cost or loss, and a building broken in the game never means ' +
      'that anyone was inside it.',
  },
  {
    id: 'floods-and-dams',
    gameElement: 'Floods and dam breaks',
    explanation:
      'When the iceberg breaks a dam, the reservoir behind it drains through the gap and the flood can ' +
      'carry vehicles and debris away. The water is a simplified model of streams and reservoirs built ' +
      'for play, not a simulation of how real dams fail, and it is not a claim about any real dam. The ' +
      'nearest real hazard is the glacial outburst flood, when ice or moraine holding back a meltwater ' +
      'lake gives way (NOAA).',
  },
  {
    id: 'fictional-world',
    gameElement: 'The towns, the people and their records',
    explanation:
      'Every town, character, letter, logbook and decision in the story is invented. What the Archive ' +
      'records about your runs is measured from the game itself; the lives behind the objects are ' +
      'imagined. Real science appears only in this section, quoted from NASA, NOAA, the IPCC and the EPA ' +
      'with links to the pages it comes from.',
  },
  {
    id: 'worn-land',
    gameElement: 'Brown rivers, grey skies and dry grass in the later chapters',
    explanation:
      'From the middle of the story on, the rivers turn greyer and then brown, a haze closes in, the grass ' +
      'dries and some trees stand bare, and the land looks worse still after a run that toppled plants, ' +
      'wells and tanks. That is a picture of the waste, smoke and runoff the records describe, drawn to be ' +
      'seen. The game does not model pollution, and the look is not a measurement of how dirty any real ' +
      'river or sky is. The real processes behind it, runoff, flood water, haze, litter and the salty ' +
      'water that comes up from oil wells, are quoted above from the EPA and NOAA.',
  },
  {
    id: 'time-compression',
    gameElement: 'Decades compressed into a single descent',
    explanation:
      'Each chapter is one short run down a mountainside, while the history behind it unfolds far more ' +
      'slowly. Real glacier loss has been measured over decades, and the IPCC finds that many changes ' +
      'to the ocean, ice sheets and sea level are irreversible for centuries to millennia. The game ' +
      'compresses that time so that a long history can be felt in one descent.',
  },
];

export const factById = (id: string): ClimateFact | undefined => CLIMATE_FACTS.find((f) => f.id === id);

/** Facts tagged with a theme, in arc order (for get_approved_climate_fact and the Science screen). */
export const factsByTheme = (theme: FactTheme): readonly ClimateFact[] =>
  CLIMATE_FACTS.filter((f) => f.themes.includes(theme));
