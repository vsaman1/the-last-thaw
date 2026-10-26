import type { ReactNode } from 'react';
import { LEVELS } from '../../core/levels';
import { useAppStore } from '../../state/appStore';
import { pickPlayLevel, startLevel } from '../actions';
import { Button, Kbd, ScreenHeader } from '../components';
import { useEscapeToMenu } from '../hooks';
import { ArrowLeftIcon, PlayIcon } from '../icons';

const GRASS = '#5BD43A';
const GRASS_DARK = '#3FA62A';
const ROCK = '#4A4A55';
const BROWN = '#6B5040';
const RIVER = '#1450E6';
const CYAN = '#5FF3FF';
const ICE_TOP = '#7FFFF4';
const ICE_SIDE = '#1C8FD6';
const OCEAN = '#0B3A8C';
const WHITE = '#FFFFFF';
const AMBER = '#FFC24A';
const GLACIER = '#DDF4FF';

function Diagram({ children }: { children: ReactNode }) {
  return (
    <svg className="howto__fig" viewBox="0 0 160 96" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Small low-poly iceberg centred at (x, y). */
function Berg({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const p = (pts: number[]) => pts.map((v, i) => (i % 2 ? y + v * s : x + v * s)).join(' ');
  return (
    <g>
      <polygon points={p([-11, 4, -6, -7, 3, -9, 11, 2, 6, 8, -7, 8])} fill={ICE_SIDE} />
      <polygon points={p([-6, -7, 3, -9, 11, 2, 0, 3, -11, 4])} fill={ICE_TOP} />
    </g>
  );
}

function Arrow({ d }: { d: string }) {
  return (
    <g fill="none" stroke={WHITE} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </g>
  );
}

const STEPS: { title: string; text: ReactNode; fig: ReactNode }[] = [
  {
    title: 'It slides on its own',
    text: 'Gravity does the driving. The iceberg slides downhill by itself; you only steer.',
    fig: (
      <Diagram>
        <polygon points="0,26 160,72 160,96 0,96" fill={GRASS} />
        <polygon points="0,26 160,72 160,80 0,34" fill={GRASS_DARK} />
        <Berg x={44} y={30} s={1.2} />
        <Arrow d="M74 40 L124 55 M114 47 L124 55 L113 61" />
      </Diagram>
    ),
  },
  {
    title: 'Steer left and right',
    text: (
      <>
        Put the mouse left or right of the screen centre (the further out, the sharper the turn; keep
        it centred to go straight), or hold <Kbd>A</Kbd> / <Kbd>D</Kbd> or{' '}
        <Kbd srLabel="Left arrow">←</Kbd> / <Kbd srLabel="Right arrow">→</Kbd>.
      </>
    ),
    fig: (
      <Diagram>
        <rect x="14" y="8" width="132" height="80" fill="none" stroke={WHITE} strokeOpacity={0.5} />
        <line x1="80" y1="8" x2="80" y2="88" stroke={CYAN} strokeDasharray="4 4" />
        <Berg x={80} y={66} />
        <path d="M108 30 l0 14 l4 -4 l4 7 l3 -2 l-4 -6 l5 0 z" fill={WHITE} />
        <Arrow d="M86 52 Q100 44 106 30" />
        <text x="84" y="20" className="howto__svgtext">centre</text>
      </Diagram>
    ),
  },
  {
    title: 'The river forms behind you',
    text: 'Wherever you slide, a river follows: it fills your path and pours down every drop.',
    fig: (
      <Diagram>
        <rect width="160" height="96" fill={GRASS} />
        <path d="M30 96 C40 70 110 74 100 48 S70 22 92 14" stroke={RIVER} strokeWidth={14} fill="none" />
        <path d="M30 96 C40 70 110 74 100 48 S70 22 92 14" stroke={CYAN} strokeWidth={2} fill="none" />
        <Berg x={93} y={13} />
      </Diagram>
    ),
  },
  {
    title: 'The river is your meltwater',
    text: (
      <>
        Every metre of river melts your iceberg a little, and winding routes use more. Run dry and it
        melts away — keep an eye on the <strong>Ice</strong> gauge.
      </>
    ),
    fig: (
      <Diagram>
        <rect width="160" height="96" fill={GRASS} />
        <path d="M12 70 C40 70 44 40 74 40 S110 22 128 20" stroke={RIVER} strokeWidth={12} fill="none" />
        <Berg x={132} y={19} s={0.7} />
        <rect x="12" y="82" width="64" height="7" fill="none" stroke={WHITE} strokeOpacity={0.7} />
        <rect x="12" y="82" width="18" height="7" fill={AMBER} />
        <text x="82" y="89" className="howto__svgtext">ice</text>
      </Diagram>
    ),
  },
  {
    title: 'Gentle curves keep speed',
    text: 'Sharp turns and zig-zags bleed momentum. Plan wide, smooth lines.',
    fig: (
      <Diagram>
        <path
          d="M14 84 L30 30 L46 70 L62 26"
          stroke={WHITE}
          strokeWidth={2.5}
          fill="none"
          strokeOpacity={0.55}
        />
        <text x="22" y="18" className="howto__svgtext">✕ slow</text>
        <path d="M96 84 C100 50 140 56 146 22" stroke={CYAN} strokeWidth={3} fill="none" />
        <text x="104" y="18" className="howto__svgtext">✓ fast</text>
      </Diagram>
    ),
  },
  {
    title: 'Don’t get stuck',
    text: (
      <>
        Too slow for too long and the iceberg stalls; the run fails. Watch for the{' '}
        <strong>Losing momentum!</strong> warning.
      </>
    ),
    fig: (
      <Diagram>
        <rect x="16" y="56" width="128" height="10" fill="none" stroke={WHITE} strokeOpacity={0.6} />
        <rect x="16" y="56" width="22" height="10" fill={AMBER} />
        <polygon
          points="80,14 100,46 60,46"
          fill="none"
          stroke={AMBER}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <line x1="80" y1="25" x2="80" y2="36" stroke={AMBER} strokeWidth={3} strokeLinecap="round" />
        <circle cx="80" cy="41" r="1.8" fill={AMBER} />
        <text x="16" y="82" className="howto__svgtext">momentum</text>
      </Diagram>
    ),
  },
  {
    title: 'Mind what you hit',
    text: 'Heavy boulders slow you down. Hit smaller things fast and they topple, roll or break.',
    fig: (
      <Diagram>
        <rect y="80" width="160" height="16" fill={GRASS} />
        <polygon points="18,80 26,56 46,48 62,60 64,80" fill={ROCK} />
        <Berg x={14} y={70} />
        <g transform="rotate(38 118 80)">
          <rect x="115" y="50" width="6" height="30" fill={BROWN} />
          <polygon points="104,56 118,20 132,56" fill={GRASS_DARK} />
        </g>
        <Arrow d="M84 70 L100 70 M94 64 L100 70 L94 76" />
      </Diagram>
    ),
  },
  {
    title: 'Crashes chip your ice',
    text:
      'Hit something hard and chunks of ice break off — smashing through costs ice too. ' +
      'The same crash hurts a heavy iceberg far less: bigger icebergs lose less.',
    fig: (
      <Diagram>
        <rect y="80" width="160" height="16" fill={GRASS} />
        <polygon points="104,80 112,52 130,44 148,58 152,80" fill={ROCK} />
        <Berg x={84} y={68} s={1.3} />
        <path
          d="M100 52 l6 -6 M101 64 l8 0 M100 76 l6 5"
          stroke={WHITE}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <polygon points="64,38 71,34 73,42" fill={ICE_TOP} />
        <polygon points="52,52 58,46 62,54 55,57" fill={ICE_SIDE} />
        <polygon points="72,22 77,19 79,26" fill={ICE_TOP} />
        <polygon points="44,36 48,33 50,39" fill={ICE_SIDE} />
      </Diagram>
    ),
  },
  {
    title: 'Absorb glacier ice to grow',
    text: (
      <>
        Slide into loose glacier ice to absorb it — your iceberg grows past 100% on the{' '}
        <strong>Ice</strong> gauge. The extra weight slows you down at first, but you hit harder:
        a big iceberg smashes buildings at low speed.
      </>
    ),
    fig: (
      <Diagram>
        <rect width="160" height="96" fill={GRASS} />
        <polygon points="50,26 60,22 64,31 54,34" fill={GLACIER} />
        <polygon points="58,64 66,60 71,68 62,72" fill={GLACIER} />
        <polygon points="66,40 73,37 76,45 68,47" fill={GLACIER} />
        <Berg x={34} y={50} s={0.9} />
        <Arrow d="M84 50 L102 50 M96 44 L102 50 L96 56" />
        <Berg x={128} y={50} s={1.9} />
        <text x="112" y="88" className="howto__svgtext">heavier</text>
      </Diagram>
    ),
  },
  {
    title: 'Go over waterfalls',
    text: 'Cliffs are thrilling shortcuts: fly off the edge and the river pours down behind you.',
    fig: (
      <Diagram>
        <polygon points="0,30 70,30 70,96 0,96" fill={ROCK} />
        <rect y="26" width="70" height="6" fill={GRASS} />
        <rect x="70" y="80" width="90" height="16" fill={GRASS} />
        <path d="M0 29 H66 Q78 34 80 82" stroke={RIVER} strokeWidth={10} fill="none" />
        <path d="M66 29 Q78 34 80 82" stroke={CYAN} strokeWidth={2} fill="none" />
        <ellipse cx="86" cy="82" rx="14" ry="4" fill={WHITE} fillOpacity={0.85} />
        <Berg x={108} y={44} />
      </Diagram>
    ),
  },
  {
    title: 'Reach the ocean',
    text: 'Follow the valley to the coast, then sail out past the finish buoys to complete the level.',
    fig: (
      <Diagram>
        <rect width="160" height="96" fill={OCEAN} />
        <path d="M0 70 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke={CYAN} fill="none" />
        <line x1="100" y1="22" x2="100" y2="84" stroke={WHITE} strokeDasharray="5 4" />
        <circle cx="100" cy="22" r="6" fill={AMBER} />
        <circle cx="100" cy="84" r="6" fill={AMBER} />
        <Berg x={72} y={52} s={1.2} />
        <Arrow d="M88 52 L124 52 M116 45 L124 52 L116 59" />
      </Diagram>
    ),
  },
];

export function HowToPlay() {
  const goTo = useAppStore((s) => s.goTo);
  const progress = useAppStore((s) => s.progress);
  useEscapeToMenu();
  const playId = pickPlayLevel(LEVELS, progress);

  // No arrow-key focus group here: on this long page the arrow keys should scroll.
  return (
    <main className="screen screen--sub" aria-labelledby="howto-title">
      <div className="sub">
        <ScreenHeader
          eyebrow="Field guide"
          title="How to Play"
          titleId="howto-title"
          focusTitle
          standfirst="Guide a melting iceberg from the mountains to the sea. Keep it moving, keep it smooth."
        />
        <ol className="howto">
          {STEPS.map((s, i) => (
            <li key={s.title} className="howto__item">
              {s.fig}
              <h2 className="howto__title">
                <span className="howto__n num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {s.title}
              </h2>
              <p className="howto__text">{s.text}</p>
            </li>
          ))}
        </ol>

        <section className="keys" aria-labelledby="keys-title">
          <h2 className="keys__title" id="keys-title">
            Controls
          </h2>
          <dl className="keys__list">
            <div>
              <dt>Steer</dt>
              <dd>
                Mouse left / right of centre · <Kbd>A</Kbd> <Kbd>D</Kbd> ·{' '}
                <Kbd srLabel="Left arrow">←</Kbd> <Kbd srLabel="Right arrow">→</Kbd>
              </dd>
            </div>
            <div>
              <dt>Pause</dt>
              <dd>
                <Kbd>Esc</Kbd> or <Kbd>P</Kbd>
              </dd>
            </div>
            <div>
              <dt>Restart</dt>
              <dd>
                <Kbd>R</Kbd>
              </dd>
            </div>
            <div>
              <dt>Skip intro</dt>
              <dd>
                <Kbd>Space</Kbd>
              </dd>
            </div>
            <div>
              <dt>Sound</dt>
              <dd>
                <Kbd>M</Kbd> mutes and unmutes all sound (anywhere but a text field, sliders included; volumes are in Settings)
              </dd>
            </div>
            <div>
              <dt>View river</dt>
              <dd>
                <Kbd>V</Kbd> after completing a level — drag to orbit, scroll to zoom, double-click a
                spot to fly there, <Kbd>Home</Kbd> to reset
              </dd>
            </div>
          </dl>
        </section>

        <div className="sub__actions">
          <Button variant="ghost" icon={<ArrowLeftIcon />} onClick={() => goTo('mainMenu')}>
            Back
          </Button>
          <Button icon={<PlayIcon />} onClick={() => playId && startLevel(playId)} disabled={!playId}>
            Play now
          </Button>
        </div>
      </div>
    </main>
  );
}
