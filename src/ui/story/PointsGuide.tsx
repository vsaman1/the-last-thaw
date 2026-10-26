/**
 * The Points guide: every structure that topples and the Topple points it earns, in friendly bands
 * ("The big ones" down to "Small change"). Shown from Story Mode's pause menu and its chapter list,
 * never on the chapter card, so the card stays short and the numbers are there when the player wants
 * them. The values are STORY_POINTS themselves (src/story/scoring.ts), so the guide cannot drift.
 */
import { useId } from 'react';
import { pointsGuide } from '../../story/scoring';
import { formatInt } from '../format';

/** One line under the guide's title: what the reader is looking at. */
export const POINTS_GUIDE_STANDFIRST =
  'Topple anything built and its points are yours. The bigger the target, the more it is worth.';

/** Under the bands: what earns nothing, and why. */
export const POINTS_GUIDE_NOTE =
  'Rocks, glacier ice, parked cars and stone walls are pushed aside, never toppled, so they earn no points. ' +
  'Glacier ice makes your iceberg bigger instead.';

export function PointsGuideList({ headingLevel = 3 }: { headingLevel?: 3 | 4 }) {
  const id = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className="points-guide">
      {pointsGuide().map(({ tier, entries }, i) => (
        <section key={tier.title} className="points-guide__tier" aria-labelledby={`${id}-${i}`}>
          <Heading className="points-guide__tier-title" id={`${id}-${i}`}>
            {tier.title}
          </Heading>
          <dl className="points-guide__list">
            {entries.map((e) => (
              <div key={e.kind}>
                <dt>{e.label}</dt>
                <dd className="num">
                  {formatInt(e.points)}
                  <span className="sr-only"> points</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="points-guide__note">{POINTS_GUIDE_NOTE}</p>
    </div>
  );
}
