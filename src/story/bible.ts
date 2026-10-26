import type { StoryBible } from './types';

/**
 * THE LAST THAW — the story bible: the single source of narrative truth for the chapters
 * (src/story/chapters), the authored fallbacks and the agents (which may retell it, never rewrite it).
 *
 * Shape of the story, in one paragraph: a fictional mountain coast (the Vell massif, its glacier and
 * the valleys below it) told through the archive one woman kept of it. Over sixty years the glacier
 * was measured, warned about, argued over and partly defended; in August 2039 its last great mass of
 * ice let go and the thaw came down the valleys to the sea. The player is that thaw: consequences
 * already set in motion, not a villain. Each level is one place the water went. The archivist is
 * unnamed until chapter 8, where she turns out to be Mara Vey of Church Lane, Riverside.
 *
 * Writing rules the whole story keeps (tested in src/story/chapters/chapters.test.ts):
 * - Nobody is ever inside a building that falls; the archive records no deaths and no injuries. The
 *   evacuation plans, practised for years, worked: that is part of the story, not a loophole.
 * - Responsibility is unequal. Households made small choices under real constraints; a council, a
 *   water board, a ministry and an energy company made larger ones; most of the warming came from far
 *   away. No one is a cartoon villain and no single decision caused it.
 * - Fiction only: invented people, towns and records. Real science lives in src/story/science.ts.
 * - Some things were saved because someone acted early (the drills, the Upper Vell dam, the late flood
 *   wall). Destruction is never presented as wholly unavoidable.
 * - Plain English (the student's playtest, 2026-10-23): every document, reflection and epilogue part
 *   reads without stopping. Complete, grammatical sentences; plain modern words (no "spoilt" ballots,
 *   "biro", "the font", "bothy", "bund"); people by their full names, never by an initial (the bible's
 *   characters, and the MINOR_PEOPLE below). Before chapter 8 the archivist is "the archivist", "my
 *   sister" or "Miss Vey", never "M.". Act I stays light and curious; the cost arrives in Acts II-III.
 */

/**
 * People the documents name who are not characters of the bible: one full name each, first used in
 * `chapterId`, so a person stays the same person in every document (tested in
 * src/story/chapters/chapters.test.ts). Documents that once gave them only an initial ("Mrs H.",
 * "Love, J.") now name them in full.
 */
export const MINOR_PEOPLE: readonly { readonly name: string; readonly chapterId: string; readonly who: string }[] = [
  { name: 'Jean Harper', chapterId: 'ch1-beginning', who: 'a summer visitor at Vell Foot in 1962, who sent a postcard home' },
  { name: 'Greta Huber', chapterId: 'ch3-warning', who: 'a pass villager, the last to arrive at the 2034 drill' },
  { name: 'Hanna Roth', chapterId: 'ch3-warning', who: 'lives in the last chalet on the Alpine Pass valley road, where the siren cannot be heard' },
  { name: 'Daniel Okafor', chapterId: 'ch4-people', who: 'street warden at No. 2 Church Lane, who took the minutes' },
  { name: 'Dorothy Pell', chapterId: 'ch4-people', who: 'the Veys\' neighbour at No. 16 Church Lane, a street warden' },
  { name: 'Sean Duffy', chapterId: 'ch4-people', who: 'street warden of Station Court, flat 2' },
  { name: 'Ada Hollins', chapterId: 'ch7-escape', who: 'the grandmother of Hollins farm on the Red Mesa, who wrote to Calder about the plant\'s tanks' },
  { name: 'Isla Munro', chapterId: 'ch8-remains', who: 'keeper of the Clachan power station for twenty-two years' },
  { name: 'Morag Dunn', chapterId: 'ch8-remains', who: 'head teacher of Clachan Primary School' },
];

/**
 * Institutions the archive quotes (document authors and decision makers that are not characters).
 * Kept here so tests and the agents can check an `author` or `who` against one list.
 */
export const INSTITUTIONS: readonly string[] = [
  'Vell Valley Water Board',
  'Riverside Town Council',
  'Riverside households',
  'Riverside Street Wardens',
  'Riverside Courier',
  'Ministry of Infrastructure',
  'Calder Energy',
  'Red Mesa ranger post',
  'Clachan residents',
  'Clachan community council',
  "The world's largest emitters",
];

export const BIBLE: StoryBible = {
  title: 'The Last Thaw',
  premise:
    'A fictional mountain coast, the Vell massif and the valleys below its glacier, told through the archive one ' +
    'woman kept of it. For sixty years the ice was measured, warned about, argued over and partly defended. In ' +
    'August 2039 its last great mass of ice let go and the thaw came down nine valleys to the sea. The player is ' +
    'that thaw: not a villain, but consequences already set in motion. The archive, kept by a voice that is only ' +
    'named late, records the people, measurements and decisions behind everything the water met, and changes ' +
    "with what each run actually broke or left standing.",
  theme: 'You cannot undo the river behind you. You can still decide where it goes next.',

  characters: [
    {
      id: 'mara-vey',
      name: 'Mara Vey',
      role: 'The archivist; former records clerk of Riverside',
      born: 2006,
      description:
        'Silver-haired since nineteen ("my grandmother\'s hair, arriving early"), pale grey eyes with a pearly ' +
        'sheen that photographs badly, and long dark second-hand dresses chosen for their pockets. People expect ' +
        'a tragic heroine; she asks them where they keep their minutes. Writes in pencil, small, in margins. ' +
        'Warm, wry, exact, stubborn; funniest when frightened.',
      history:
        'Grew up at No. 14 Church Lane, Riverside; daughter of Ruth Vey, older sister of Elias. Spent childhood ' +
        'summers at her grandparents\' farm, Achadh, in the Clachan. Studied archives in Carran and came home in ' +
        '2028 to the county records office, where she began copying Tomas Lind\'s glacier notebooks. When the ' +
        'office closed in 2033 she moved its local collection into her mother\'s front room. For six years she ' +
        'read the measurements aloud at council meetings, posted Anna Sorel\'s reports to anyone with a letterbox ' +
        'and organised the Church Lane street wardens. She chalked the last door on her list, left on the last ' +
        'train her brother drove, with four boxes, and keeps the archive in a rented room in Carran, where she ' +
        'is still adding to it.',
      locations: ['riverside', 'the-clachan', 'upper-vell'],
      firstAppears: 'ch1-beginning',
      revealedIn: 'ch8-remains',
    },
    {
      id: 'ruth-vey',
      name: 'Ruth Vey',
      role: "Primary teacher in Riverside; Mara and Elias's mother",
      born: 1979,
      description:
        'Small, brisk, reading glasses on a cord and a whistle she claims never to use. Runs the house by a ' +
        'kitchen calendar in four colours of pen; green means good news.',
      history:
        'Born at Achadh farm in the Clachan; married in the Clachan church in 2004 and moved to Riverside. Her ' +
        'husband, Mara and Elias\'s father, a ship\'s engineer, went back to sea in 2015; they parted kindly in 2018, ' +
        'and he is alive and well on the far coast and telephones on birthdays. The archive mentions him once, on ' +
        'the back of a wedding photograph. Taught at ' +
        'Riverside primary for thirty-two years and, from 2031, timed the school\'s walk to the station with a ' +
        'stopwatch every term. Voted for the 2017 flood levy and lost. Bought a share in the valley\'s turbine ' +
        'co-op. Left with her school on the first evacuation train, timing it.',
      locations: ['riverside', 'the-clachan', 'power-valley'],
      firstAppears: 'ch4-people',
    },
    {
      id: 'elias-vey',
      name: 'Elias Vey',
      role: "Train driver on the valley line; Mara's younger brother",
      born: 2012,
      description:
        'Tall, quiet, permanently hungry; sings to the train when he thinks the cab radio is off. Keeps a log ' +
        'in the driver\'s style even when nobody asks for one.',
      history:
        'Started at eighteen in Calder Energy\'s rail yard in Power Valley, coupling coal wagons, and spent half ' +
        'his first wage on a fireproof document chest for his sister. Drove passenger trains on the valley line from 2035. On ' +
        '12 August 2039 he drove the school out on the first train and drove the last train out of Riverside at ' +
        '21:52, his sister asleep on her boxes at the back of the train.',
      locations: ['riverside', 'power-valley'],
      firstAppears: 'ch4-people',
    },
    {
      id: 'tomas-lind',
      name: 'Tomas Lind',
      role: 'Glaciologist; kept the Vell Glacier stake line, 1979-2031',
      born: 1951,
      description:
        'Weathered and unhurried, a beard that went white in sections, the same green wool hat in every ' +
        'photograph for fifty years. Talks to survey stakes. Keeps a kettle in every hut he has ever used, and ' +
        'notes on every door.',
      history:
        'Came to the Vell as a graduate student in 1979, bolted a benchmark into a boulder at Vell Foot and drilled ' +
        'the first line of thirty stakes. Measured them every September for fifty-two years, first for the ' +
        'university, then for the Water Board, finally for nobody but himself. His reports (1987, 1998, 2011) ' +
        'recorded the shrinking ice, the lake forming above Kessel and what a sudden flood from it would do ' +
        'downstream. Gave his ' +
        'notebooks to Mara in 2031, the year his knees ended the climbing; lives with his daughter in Carran.',
      locations: ['vell-foot', 'red-canyon', 'kessel', 'upper-vell'],
      firstAppears: 'ch1-beginning',
    },
    {
      id: 'anna-sorel',
      name: 'Anna Sorel',
      role: 'Engineer, Vell Valley Water Board',
      born: 1968,
      description:
        'Blunt in person and funny in writing; her reports carry jokes in the footnotes that nobody at the Board ' +
        'ever mentioned, which is how she knew nobody read the footnotes.',
      history:
        'Joined the Water Board in 1994. Proposed the Riverside dam spillway and the lower-town flood wall (2009, ' +
        '2016), co-wrote the Alpine Pass evacuation plan (2021) and the Kessel dam report (2024), and designed the ' +
        'Upper Vell dam in six weeks (2029). Saw her proposals deferred, built late or built in a hurry. Retired ' +
        'in 2033 and stayed on as unpaid adviser to Riverside\'s street wardens.',
      locations: ['riverside', 'alpine-pass', 'kessel', 'upper-vell'],
      firstAppears: 'ch3-warning',
    },
    {
      id: 'gil-harrow',
      name: 'Gil Harrow',
      role: 'Leader of Riverside Town Council, 2008-2030',
      born: 1955,
      description:
        'Big, courteous, remembers everyone\'s children\'s names; signs every letter "Yours, as ever". Kept a ' +
        'photograph of the harbour light on his council desk.',
      history:
        'A harbour pilot for nineteen years before politics. Kept the library, the school roof and the harbour ' +
        'jobs funded through lean decades, and deferred the dam spillway twice: in 2009 for want of money, and in ' +
        '2016 on the strength of the 2014 national inspection, done on paper, that called the dam satisfactory. (His 2038 letter ' +
        'gives the inspectors as a reason for both deferrals; for 2009 it was not true.) In 2038 he answered, in writing, the question Mara had ' +
        'asked him at every meeting.',
      locations: ['riverside'],
      firstAppears: 'ch4-people',
    },
    {
      id: 'ines-moreno',
      name: 'Ines Moreno',
      role: 'Regional operations director, Calder Energy',
      born: 1974,
      description:
        'Neat, tired and sharp; writes memos that argue both sides fairly and then, in the last paragraph, ' +
        'choose one.',
      history:
        'Grew up in Power Valley, where her father worked the cooling towers. Joined Calder in 1999. Defended the ' +
        '2019 pipeline route through the Kessel avalanche track on the company\'s own risk assessment; in 2027 ' +
        'argued inside Calder for moving the tank farm and sharing the cost of the Kessel spillway, and won only a ' +
        'higher earth wall around the tanks. ' +
        'On 12 August 2039 kept the plant running with eleven volunteers so the valley line had power for its ' +
        'trains.',
      locations: ['power-valley', 'kessel', 'upper-vell'],
      firstAppears: 'ch5-denial',
    },
    {
      id: 'callum-reid',
      name: 'Callum Reid',
      role: "Postman in the Clachan; Mara's oldest friend",
      born: 2005,
      description:
        'Red-faced and cheerful, and unreasonably proud of his post van. Reads every postcard he delivers and ' +
        'denies it.',
      history:
        'Grew up at Balnacoil, the farm next to Achadh, and has known Mara since they were six. Carried her ' +
        'parcels of photocopies to the Board for years, and in 2032 carried the Clachan\'s petition for a second ' +
        'power line from Carran, which Calder Energy turned down. On 12 August 2039 he drove everyone over seventy ' +
        'in the glen to Carran in the post van, four trips before nine, with the clinic\'s vaccines in a cool box ' +
        'on the front seat. Has been in love with Mara, quietly, for longer than either of them admits.',
      locations: ['the-clachan'],
      firstAppears: 'ch8-remains',
    },
  ],

  timeline: [
    {
      id: 't1890-ice-stone',
      year: 1890,
      summary: 'Surveyors set a stone at the glacier edge above Kessel. By 2039 it stands in the village street, a long walk below the ice.',
      locations: ['kessel'],
    },
    { id: 't1936-pass-road', year: 1936, summary: 'The Alpine Pass road opens. Its builders set a stone with the date on it beside the summit car park.', locations: ['alpine-pass'] },
    { id: 't1952-riverside-dam', year: 1952, summary: 'The Riverside dam is built above the lower town for the mill race and the town water.', locations: ['riverside'] },
    {
      id: 't1958-clachan-station',
      year: 1958,
      summary:
        'The national grid stops far below the Clachan, so the hamlet builds its own small hydro power station on the glacier stream at the head of the glen. For eighty-one years it lights and heats every house and runs the water pumps, the school and the clinic.',
      locations: ['the-clachan'],
    },
    {
      id: 't1971-mesa-plant',
      year: 1971,
      summary:
        'Calder Energy opens the Red Mesa oil field and builds its processing plant at the head of the mesa, where the oil is separated from the salty, oily water that comes up with it. The waste water is kept in tanks above every farm on the mesa.',
      locations: ['red-mesa'],
    },
    {
      id: 't1979-stake-line',
      year: 1979,
      summary: 'Tomas Lind bolts a benchmark into a boulder at Vell Foot and drills the first line of thirty stakes on the glacier.',
      characters: ['tomas-lind'],
      locations: ['vell-foot', 'upper-vell'],
    },
    {
      id: 't1987-first-report',
      year: 1987,
      summary: 'Tomas Lind\'s first report: the glacier is thinner at every stake. The university files it and sends a copy to the Water Board.',
      characters: ['tomas-lind'],
      locations: ['vell-foot', 'red-canyon'],
    },
    {
      id: 't1994-plant-expansion',
      year: 1994,
      summary: 'Calder Energy expands the Power Valley plant: jobs, cheap power, a school roof paid from business rates, more smoke.',
      locations: ['power-valley'],
    },
    {
      id: 't1998-thirty-stakes',
      year: 1998,
      summary: 'Tomas Lind\'s report "Thirty Stakes and a Lake": a lake of meltwater is filling behind a bank of loose rock above Kessel; if the bank gave way, the flood would reach Riverside within a day.',
      characters: ['tomas-lind'],
      locations: ['kessel', 'riverside'],
    },
    { id: 't2006-mara-born', year: 2006, summary: 'Mara Vey is born in Riverside.', characters: ['mara-vey', 'ruth-vey'], locations: ['riverside'] },
    {
      id: 't2009-spillway-proposal',
      year: 2009,
      summary: 'Anna Sorel proposes raising the Riverside dam spillway and a flood wall for the lower town. The cost is worked out, and the work is put off.',
      characters: ['anna-sorel', 'gil-harrow'],
      locations: ['riverside'],
    },
    {
      id: 't2011-third-report',
      year: 2011,
      summary: 'Tomas Lind\'s third report: the ice is shrinking back twice as fast as in 1987. It is presented to the Water Board, which notes it.',
      characters: ['tomas-lind'],
      locations: ['upper-vell'],
    },
    {
      id: 't2014-desk-review',
      year: 2014,
      summary: 'The Ministry\'s inspectors rate the Riverside dam "satisfactory" from its paperwork, without visiting it.',
      locations: ['riverside'],
    },
    {
      id: 't2016-second-proposal',
      year: 2016,
      summary: 'Anna Sorel proposes the spillway a second time; the council pays for a study instead.',
      characters: ['anna-sorel', 'gil-harrow'],
      locations: ['riverside'],
    },
    {
      id: 't2017-levy-vote',
      year: 2017,
      summary: 'Riverside votes on a yearly flood levy on every household. It fails, 1,402 to 1,618.',
      characters: ['ruth-vey'],
      locations: ['riverside'],
    },
    {
      id: 't2019-pipeline',
      year: 2019,
      summary: 'Calder\'s coastal gas pipeline is approved on a route across the Kessel avalanche track, on the company\'s own risk assessment.',
      characters: ['ines-moreno'],
      locations: ['kessel'],
    },
    {
      id: 't2021-pass-plan',
      year: 2021,
      summary: 'The Alpine Pass evacuation plan sends everyone to two assembly points, the chapel and the summit car park, when the siren on the chapel roof sounds. The siren cannot be heard on the valley road. Annex F, a second siren mast for the valley road, has its cost worked out and is put aside; on drill days the post bus drives the valley road sounding its horn instead.',
      characters: ['anna-sorel'],
      locations: ['alpine-pass'],
    },
    {
      id: 't2024-kessel-report',
      year: 2024,
      summary: 'Anna Sorel\'s report: the Kessel dam spillway is too small for the glacier lake. After an election the national government withdraws its share of the cost, and the work is postponed.',
      characters: ['anna-sorel'],
      locations: ['kessel'],
    },
    {
      id: 't2027-moreno-memo',
      year: 2027,
      summary: 'Ines Moreno asks Calder\'s board to move the tank farm and share the cost of the Kessel spillway. The board raises the earth wall around the tanks by a metre and shelves the rest.',
      characters: ['ines-moreno'],
      locations: ['power-valley', 'kessel'],
    },
    {
      id: 't2028-mara-returns',
      year: 2028,
      summary: 'Mara returns to Riverside\'s county records office and begins copying Tomas Lind\'s notebooks.',
      characters: ['mara-vey', 'tomas-lind'],
      locations: ['riverside'],
    },
    {
      id: 't2029-upper-vell-dam',
      year: 2029,
      summary: 'Emergency national money builds the Upper Vell dam in eleven months, sized for the summit lake as surveyed that March.',
      characters: ['anna-sorel'],
      locations: ['upper-vell'],
    },
    {
      id: 't2031-last-stake',
      year: 2031,
      summary: 'Tomas Lind\'s last September on the ice: the edge of the ice is 2.4 km from his 1979 benchmark. He gives his fifty-two notebooks to Mara. Ruth Vey starts timing the school drills.',
      characters: ['tomas-lind', 'mara-vey', 'ruth-vey'],
      locations: ['upper-vell', 'riverside'],
    },
    {
      id: 't2032-clachan-line',
      year: 2032,
      summary:
        'The Clachan asks Calder Energy for a second power line from Carran, so that the glen will not depend on one station standing in the path of the glacier stream. Callum Reid carries the petition. Calder turns it down: fourteen kilometres of line for two hundred people would not pay.',
      characters: ['callum-reid'],
      locations: ['the-clachan'],
    },
    {
      id: 't2033-records-office',
      year: 2033,
      summary: 'The county records office closes; Mara moves its local collection into the front room at No. 14 Church Lane.',
      characters: ['mara-vey'],
      locations: ['riverside'],
    },
    {
      id: 't2036-flood-wall',
      year: 2036,
      summary: 'Riverside\'s lower-town flood wall is built at last, with national money, to the 2009 design.',
      characters: ['anna-sorel'],
      locations: ['riverside'],
    },
    {
      id: 't2038-harrow-letter',
      year: 2038,
      summary: 'Gil Harrow writes to Mara explaining why the spillway was put off: "Three of those reasons were true."',
      characters: ['gil-harrow', 'mara-vey'],
      locations: ['riverside'],
    },
    {
      id: 't2039-last-thaw',
      year: 2039,
      summary:
        'August 2039: the Vell\'s lakes break out, the Kessel dam is overtopped and the thaw comes down the valleys to the sea. The evacuation plans, practised for years, move the valleys\' people out ahead of it; by the night of 12 August every list is accounted for.',
      characters: ['mara-vey', 'ruth-vey', 'elias-vey', 'ines-moreno', 'callum-reid'],
      locations: ['vell-foot', 'red-canyon', 'alpine-pass', 'riverside', 'kessel', 'power-valley', 'red-mesa', 'the-clachan', 'upper-vell'],
    },
  ],

  locations: [
    {
      id: 'vell-foot',
      name: 'Vell Foot',
      chapterId: 'ch1-beginning',
      description: 'The high valley below where the glacier used to end, and the short valley to the sea: a waterfall, a rowan tree, a bolted boulder and Tomas Lind\'s survey hut on the shore.',
      landmarkIds: ['bolted-stone', 'gate-stones', 'falls-rowan', 'survey-hut'],
    },
    {
      id: 'red-canyon',
      name: 'The Red Canyon',
      chapterId: 'ch2-measurements',
      description: 'Where the Vell\'s meltwater cut down through red rock to the sea: Lind\'s gauging footbridge, his field cabin, the trading post, the water tower and the moorings.',
      landmarkIds: ['gauging-bridge', 'long-bridge', 'lind-cabin', 'trading-post', 'canyon-tower', 'canyon-boat', 'stake-zero'],
    },
    {
      id: 'alpine-pass',
      name: 'The Alpine Pass',
      chapterId: 'ch3-warning',
      description: 'The pass road over the summit and the road builders\' stone, the ski area and its lift, the hairpins, Lochbach village and its chapel with the siren on its roof, and the valley road on the far side of the Tobel ravine, where the siren cannot be heard.',
      landmarkIds: ['post-bus', 'lift-pylon', 'hairpin-chalet', 'village-guesthouse', 'pass-chapel', 'valley-chalet', 'road-stone'],
    },
    {
      id: 'riverside',
      name: 'Riverside',
      chapterId: 'ch4-people',
      description: 'A hill town on its river: Church Lane and St Bride\'s, the gasworks, the railway and its level crossing, the Gorge Road viaduct, the 1952 dam, the harbour and its light.',
      landmarkIds: ['vey-house', 'pell-house', 'st-brides', 'gas-holder', 'level-crossing-train', 'viaduct', 'riverside-dam', 'harbour-light', 'station-court', 'harbour-view', 'flood-stone'],
    },
    {
      id: 'kessel',
      name: 'Kessel',
      chapterId: 'ch5-denial',
      description: 'An alpine dairy village on the avalanche track below the glacier lake, and the 1958 Kessel dam in the gorge beneath it.',
      landmarkIds: ['kessel-dam', 'dairy-chalet', 'kessel-barn', 'kessel-guesthouse', 'gorge-chalet', 'kessel-lift', 'coop-silo', 'kessel-pipeline', 'ice-stone', 'kessel-lodge'],
    },
    {
      id: 'power-valley',
      name: 'Power Valley',
      chapterId: 'ch6-price',
      description: 'Calder Energy\'s valley: the plant and its cooling towers, the rail yard, the tank farm, the co-op turbines, the Calder dam, the highway bridge and the port.',
      landmarkIds: ['calder-cottages', 'coop-turbine', 'coal-train', 'north-tower', 'turbine-hall', 'tank-farm', 'calder-dam', 'highway-bridge', 'bench-wells', 'works-pipeline', 'calder-house', 'calder-rig-four'],
    },
    {
      id: 'red-mesa',
      name: 'The Red Mesa',
      chapterId: 'ch7-escape',
      description:
        'The mesa farms south of the valley and their one way out: the ranger road round six ravines, two rope bridges and the ranger post. Above them all, at the head of the mesa, stands the Calder processing plant with its tanks of oily waste water.',
      landmarkIds: [
        'first-cut-bridge',
        'hollins-farm',
        'leap-farm',
        'ranger-tank',
        'ranger-post',
        'rope-bridge',
        'road-end-farm',
        'beach-house',
        'mesa-wells',
        'mesa-pipeline',
        'field-hostel',
        'mesa-plant',
      ],
    },
    {
      id: 'the-clachan',
      name: 'The Clachan',
      chapterId: 'ch8-remains',
      description:
        'A highland hamlet with its own small power station at the head of the glen: Achadh and Balnacoil farms, the church with the cracked bell, the mill above the falls and the lochside village; the shepherd\'s hut above the Leap. In its last ten years the glen filled up, with new cottages on every road, flats by the loch and families whose own towns had flooded, and the stream below them ran grey and then brown.',
      landmarkIds: [
        'clachan-station',
        'bothy',
        'achadh',
        'achadh-barn',
        'clachan-kirk',
        'balnacoil',
        'mill-house',
        'loch-kirk',
        'lochside-flats',
        'glen-pipeline',
        'market-cross',
      ],
    },
    {
      id: 'upper-vell',
      name: 'The Upper Vell',
      chapterId: 'ch9-last-thaw',
      description:
        'The summit basin where the ice began, the 2029 Upper Vell dam on its meltwater stream, the lift village above the fjord, and the sea. The village\'s lower terrace was flooded by the summit stream in 2031, 2034 and 2036 and then abandoned: its houses, chalets and barns stand empty and half ruined, with boarded windows and mud lines on the walls.',
      landmarkIds: [
        'upper-dam',
        'village-lift',
        'first-chalet',
        'lind-chalet',
        'fjord-chapel',
        'village-barn',
        'fjord-chalet',
        'rig-seven',
        'landfall-pipeline',
        'summit-apartments',
        'thaw-stone',
        'abandoned-houses',
      ],
    },
  ],

  decisions: [
    {
      id: 'd1994-plant-expansion',
      year: 1994,
      who: 'Calder Energy',
      decision: 'Expanded the Power Valley plant on coal and gas, with national backing.',
      consequence: 'Jobs, cheap power and a school roof for the valley, and a larger share of its emissions, which were still a small part of the world\'s.',
      responsibility: 'industry',
    },
    {
      id: 'd-distant-emissions',
      year: 1995,
      who: "The world's largest emitters",
      decision: 'Kept burning at scale for decades after the warnings were understood, in economies far larger and richer than the valley\'s.',
      consequence: 'Most of the warming that reached the Vell came from far away. The valley\'s own choices decided what the thaw met, not whether it came.',
      responsibility: 'global',
    },
    {
      id: 'd2009-spillway-deferred',
      year: 2009,
      who: 'Riverside Town Council',
      decision: 'Put off Anna Sorel\'s spillway and flood wall to the next building plan (council leader Gil Harrow).',
      consequence: 'The dam met 2039 at its 1952 height; the flood wall came in 2036, built to the 2009 design.',
      responsibility: 'local',
    },
    {
      id: 'd2014-desk-review',
      year: 2014,
      who: 'Ministry of Infrastructure',
      decision: 'Rated the Riverside dam satisfactory from its paperwork, without visiting it.',
      consequence: 'Every later deferral in Riverside cited it.',
      responsibility: 'national',
    },
    {
      id: 'd2016-study',
      year: 2016,
      who: 'Riverside Town Council',
      decision: 'Funded a study of the spillway instead of the works.',
      consequence: 'The study agreed with the 2009 proposal and was filed beside it.',
      responsibility: 'local',
    },
    {
      id: 'd2017-levy-vote',
      year: 2017,
      who: 'Riverside households',
      decision: 'Voted down a yearly flood levy by 216 votes.',
      consequence: 'Many who voted no were already short of money; one invalid ballot paper had "I would if I could" written on the back. The money came nineteen years later from elsewhere.',
      responsibility: 'household',
    },
    {
      id: 'd2019-pipeline-route',
      year: 2019,
      who: 'Calder Energy',
      decision: 'Routed the coastal gas pipeline straight across the Kessel avalanche track, the cheapest line, on its own risk assessment.',
      consequence: 'The pipeline lay in the path of anything that came down from the glacier lake.',
      responsibility: 'industry',
    },
    {
      id: 'd2019-pipeline-permit',
      year: 2019,
      who: 'Vell Valley Water Board',
      decision: 'Approved the pipeline route over residents\' objections.',
      consequence: 'Kessel\'s request for a longer route was answered with "very unlikely during the pipeline\'s working life".',
      responsibility: 'regional',
    },
    {
      id: 'd2021-second-siren',
      year: 2021,
      who: 'Vell Valley Water Board',
      decision: 'Adopted the Alpine Pass evacuation plan but left its Annex F, a second siren mast for the valley road, unfunded ("not this year").',
      consequence: 'The houses on the valley road never heard the siren. On every drill day, and on the real day, the post bus driver drove the valley road and sounded his horn at each gate instead.',
      responsibility: 'regional',
    },
    {
      id: 'd2024-cofunding-withdrawn',
      year: 2024,
      who: 'Ministry of Infrastructure',
      decision: 'Withdrew co-funding for the Kessel dam spillway after an election.',
      consequence: 'The Water Board postponed the works; the dam met the lake as built in 1958.',
      responsibility: 'national',
    },
    {
      id: 'd2026-line-31',
      year: 2026,
      who: 'Vell Valley Water Board',
      decision: 'Put off Line 31, paving the Red Mesa ranger road and replacing its rope bridges, in four building plans in a row.',
      consequence: 'The mesa\'s evacuation ran on one lane of gravel and an eleven-seat minibus.',
      responsibility: 'regional',
    },
    {
      id: 'd2036-mesa-tanks',
      year: 2036,
      who: 'Calder Energy',
      decision:
        'Answered a mesa farmer\'s letter asking for the Red Mesa plant\'s waste water tanks to be emptied before the field closed by saying it would consider the request; the tanks were left full while the field wound down.',
      consequence:
        'On 12 August 2039 the tanks stood full at the head of the mesa, above every stream, farm well and field on the way to the sea.',
      responsibility: 'industry',
    },
    {
      id: 'd2027-tank-bund',
      year: 2027,
      who: 'Calder Energy',
      decision: 'Answered Ines Moreno\'s memo by raising the earth wall around the tank farm by one metre; shelved moving the tanks and sharing the cost of the Kessel spillway as "not the company\'s role".',
      consequence: 'The board accepted the risk that remained; the space for who would bear its cost was left blank.',
      responsibility: 'industry',
    },
    {
      id: 'd2029-upper-vell-dam',
      year: 2029,
      who: 'Ministry of Infrastructure',
      decision: 'Paid for the Upper Vell dam from an emergency fund: a real fix, built fast, sized for the lake of 2029.',
      consequence: 'It bought the summit village time, and on the morning of the thaw the village used it.',
      responsibility: 'national',
    },
    {
      id: 'd2031-school-drills',
      year: 2031,
      who: 'ruth-vey',
      decision: 'Began timing the school\'s walk to the station every term.',
      consequence: 'On the day, the school knew the way: eleven minutes.',
      responsibility: 'household',
    },
    {
      id: 'd2032-clachan-line',
      year: 2032,
      who: 'Calder Energy',
      decision: 'Turned down the Clachan\'s request for a second power line from Carran: fourteen kilometres of line for two hundred people did not pay.',
      consequence: 'The glen kept one power station, at the head of the glen where the water would come down. When it went, the whole Clachan lost its light, heat and water at once, and most of its families spent the winter in Carran.',
      responsibility: 'industry',
    },
  ],

  relationships: [
    { a: 'mara-vey', b: 'ruth-vey', kind: 'daughter and mother' },
    { a: 'mara-vey', b: 'elias-vey', kind: 'older sister and younger brother' },
    { a: 'mara-vey', b: 'tomas-lind', kind: 'keeper of his notebooks; friends since 2028' },
    { a: 'mara-vey', b: 'anna-sorel', kind: 'allies: Mara posted her reports to anyone who would read them' },
    { a: 'mara-vey', b: 'gil-harrow', kind: 'opponents at every council meeting, with respect on both sides' },
    { a: 'mara-vey', b: 'callum-reid', kind: 'oldest friends; he would like more, she knows, the archive suspects she would too' },
    { a: 'ruth-vey', b: 'callum-reid', kind: 'the neighbour\'s boy from Balnacoil, fed at her mother\'s table' },
    { a: 'elias-vey', b: 'ines-moreno', kind: 'his first employer; she kept the power on for his trains' },
    { a: 'tomas-lind', b: 'anna-sorel', kind: 'his measurements, her designs' },
    { a: 'anna-sorel', b: 'gil-harrow', kind: 'proposals and deferrals, cordially, for twenty years' },
    { a: 'anna-sorel', b: 'ines-moreno', kind: 'opposite sides of the 2019 pipeline hearing; allies by 2027' },
  ],

  revelations: [
    { id: 'rv1-keeper', chapterId: 'ch1-beginning', text: 'Someone kept this archive: pencil notes in the margins, no name.' },
    { id: 'rv2-measurements', chapterId: 'ch2-measurements', text: 'The warnings are old and measured: Tomas Lind recorded the retreat for fifty-two years. The copies are in the archivist\'s handwriting.' },
    { id: 'rv3-plans', chapterId: 'ch3-warning', text: 'Plans existed and were practised; one page of them was left unfunded. The archivist grew up below these roads.' },
    { id: 'rv4-riverside', chapterId: 'ch4-people', text: 'The archivist is from Riverside: the archive lived in the front room of No. 14 Church Lane, the Vey house.' },
    { id: 'rv5-postponed', chapterId: 'ch5-denial', text: 'Denial had dates and letterheads: a postponed spillway, a pipeline route, a withdrawn grant, a memo answered with a higher wall around the fuel tanks.' },
    { id: 'rv6-family', chapterId: 'ch6-price', text: 'The archivist is Ruth Vey\'s daughter and Elias\'s sister. The plant that warmed the coast also powered the evacuation trains; its costs fell on the people nearest it.' },
    {
      id: 'rv7-escape',
      chapterId: 'ch7-escape',
      text: 'The evacuation worked because people practised and left early; what could not be moved were the places, the roads nobody paved and the waste water nobody emptied.',
    },
    { id: 'rv8-mara', chapterId: 'ch8-remains', text: 'The archivist is Mara Vey. She kept all of it because somebody should, and she had the boxes.' },
    { id: 'rv9-after', chapterId: 'ch9-last-thaw', text: 'Mara is in Carran, still adding to the archive. Every list is accounted for. Some things were saved because someone acted early enough.' },
  ],

  invariants: [
    'The archivist is Mara Vey (born 2006) of No. 14 Church Lane, Riverside. She is not named before chapter 8.',
    'The thaw came in August 2039; the decisive day was 12 August. Lind\'s first warning report was 1987.',
    'Every building the water reached was empty: the archive never says anyone was inside, hurt or lost, and records every list as accounted for.',
    'Mara is alive. She left Riverside on the last train, driven by her brother Elias, with four boxes, and keeps the archive in Carran.',
    'Tomas Lind measured the Vell every September from 1979 to 2031 and gave his notebooks to Mara.',
    'Responsibility is unequal: households, a town council, a water board, a ministry, an energy company and distant economies made different choices with different weight. No single decision caused the thaw.',
    'Some actions worked: the drills, the Upper Vell dam (2029), the late flood wall (2036).',
    'The player\'s iceberg is the thaw, consequences already set in motion; never a person, never a villain.',
    'The fiction depicts no real places, organisations or climate statistics; real science appears only in "Science Behind the Story". Every place is invented; a few invented names (Carran, Kessel, Red Mesa, Balnacoil) happen to match small real places elsewhere, and none of them is meant.',
  ],

  variables: [
    'Each landmark\'s fate (destroyed, damaged, still standing, not reached) follows the run\'s evidence; "still standing" only when the run reached it intact.',
    'Fragments about a home or a bridge depend on whether that structure fell or stood; spared places unlock quieter documents.',
    'How much the archivist says about loss follows the counts the run destroyed, by category (homes, extraction, transport).',
    'Chapters 4-9 and the epilogue remember earlier runs: whether No. 14, the last chalet on the Alpine Pass valley road or the Kessel dam stood, and whether the Clachan\'s power station fell.',
    'Failing a level, reaching the sea, crossing waterfalls and how much ice the iceberg gathered each unlock different records.',
    'How the land looks follows the story and the player: clear in the first three chapters, greyer water, haze and yellowing grass in the middle three, brown rivers, a grey sky, brown grass, bare trees and grey snow in the last three; worse still after earlier runs that toppled extraction, industry and energy. The records describe the waste, smoke and runoff behind it.',
    'AI reflections (chapters 1, 4, 6, 9) may choose different fragments and words but never change an invariant.',
  ],

  style: {
    voice:
      'The archivist\'s: first person, unnamed until chapter 8; plain, exact, warm, wry when it hurts. Plain modern ' +
      'English that a student reads once, without stopping: complete, grammatical sentences, each with a clear ' +
      'subject and verb; no riddles, poetic fragments or images the reader has to decode. People by their full ' +
      'names the first time (Tomas Lind), never by an initial; after that a first name the reader already knows. ' +
      'Specific objects carry the feeling: a kitchen calendar, a survey stake, a ticket stub, a kettle on a shelf, ' +
      'chalk on a door. Documents keep their own kinds (field notes, minutes, notices, letters, logs) and may be ' +
      'dull, because records are, but they are written in full sentences, so who wrote each one, to whom and why it ' +
      'matters is clear on first reading. Humour is welcome. Say a hard thing once. The early chapters are light ' +
      'and curious; the cost appears gradually.',
    avoid: [
      'initials in place of names: write "Tomas Lind", never "T." or "T.L."',
      'regional or old-fashioned words that need explaining (a "spoilt" ballot, a "biro", "the font")',
      'riddles, poetic fragments and sentences without a main verb whose meaning is not clear on first reading',
      'slogans, calls to action and lectures about climate change',
      'telling the reader what to feel, or repeating a moral point',
      'cartoon villains, or treating everyone as equally responsible',
      'inventing deaths, injuries or casualties of any kind',
      'saying anyone was inside a building that fell',
      'claiming a place was spared unless the run reached it and left it intact',
      'real climate statistics, real organisations or real places inside the fiction',
      'claims that humanity ended or went extinct',
      'triumph at destruction, or contempt for the player',
      'naming Mara before chapter 8',
    ],
  },
};
