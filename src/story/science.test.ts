import { describe, expect, it } from 'vitest';
import {
  CLIMATE_FACTS,
  FACT_THEMES,
  factById,
  factsByTheme,
  METAPHOR_NOTES,
  type FactTheme,
} from './science';
import type { SourceOrg } from './types';

/**
 * The science data is a contract with the agents and the validator: a fact's statement is all an agent may
 * say about it, and its `numbers` are the only figures the validator lets through. These tests keep the
 * data honest in the ways a machine can check (ids, domains, dates, figures); whether each statement is
 * what its page says was checked by reading the pages (see science.ts).
 */

/** Domains each organisation publishes on. A fact's URL must be on one of its own org's domains. */
const ORG_DOMAINS: Record<SourceOrg, readonly string[]> = {
  NASA: ['nasa.gov'],
  NOAA: ['noaa.gov', 'climate.gov'],
  IPCC: ['ipcc.ch'],
  WMO: ['wmo.int'],
  EPA: ['epa.gov'],
  USGS: ['usgs.gov'],
};

/** Every digit run as printed ('1.1', '2023', '24' in "1.1°C … 2023/24"); see science.ts NUMBERS. */
const digitRuns = (text: string): string[] => text.match(/\d+(?:[.,]\d+)*/g) ?? [];

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

describe('climate facts: shape', () => {
  it('has 10 to 19 facts with unique kebab-case ids', () => {
    // Fourteen climate facts, and since the second playtest (2026-10-24) five on pollution.
    expect(CLIMATE_FACTS.length).toBeGreaterThanOrEqual(10);
    expect(CLIMATE_FACTS.length).toBeLessThanOrEqual(19);
    const ids = CLIMATE_FACTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(KEBAB);
  });

  it('cites an https page on the domain of the organisation it names', () => {
    for (const f of CLIMATE_FACTS) {
      const url = new URL(f.source.url);
      expect(url.protocol, f.id).toBe('https:');
      const domains = ORG_DOMAINS[f.source.org];
      expect(domains, `${f.id}: unknown org ${f.source.org}`).toBeDefined();
      const onDomain = domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
      expect(onDomain, `${f.id}: ${url.hostname} is not a ${f.source.org} domain`).toBe(true);
      expect(f.source.title.trim().length, f.id).toBeGreaterThan(0);
    }
  });

  it('draws on NASA, NOAA, the IPCC and, for pollution, the EPA', () => {
    const orgs = new Set(CLIMATE_FACTS.map((f) => f.source.org));
    for (const org of ['NASA', 'NOAA', 'IPCC', 'EPA'] as const) expect(orgs.has(org), org).toBe(true);
  });

  it('has the pollution facts the second playtest asked for: runoff, flood water, haze, litter and oil-field brine', () => {
    // "how human waste and activity is causing the uglification of the surrounding areas like the brown
    // water the gray skies": each statement is the source page's own words (checked 2026-10-24, see
    // science.ts), so no figure is invented and none is listed. The brine fact grounds chapter 7's
    // processing plant (its salty, oily waste water and the salted fields), which the review found uncited.
    const pollution = factsByTheme('pollution');
    expect(pollution.map((f) => f.id)).toEqual([
      'polluted-runoff',
      'flood-water-contamination',
      'haze-from-pollution',
      'litter-from-drains',
      'oil-field-brine',
    ]);
    for (const f of pollution) {
      expect(['EPA', 'NOAA']).toContain(f.source.org);
      expect(f.source.accessed, f.id).toBe('2026-10-24');
      expect(f.numbers, f.id).toEqual([]);
    }
    expect(pollution.map((f) => f.statement).join(' ')).toMatch(/runoff[\s\S]*rivers[\s\S]*flood water[\s\S]*Haze[\s\S]*trash[\s\S]*saltier than seawater/);
  });

  it('records the access date as a real ISO calendar date', () => {
    for (const f of CLIMATE_FACTS) {
      const m = ISO_DATE.exec(f.source.accessed);
      expect(m, `${f.id}: ${f.source.accessed}`).not.toBeNull();
      const [, y, mo, d] = m!;
      const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
      // Round-trips only if the day exists (2026-02-30 would roll over into March).
      expect(date.toISOString().slice(0, 10), f.id).toBe(f.source.accessed);
    }
  });

  it('writes statements as clean sentences (no doubled or missing spaces where strings were joined)', () => {
    for (const f of CLIMATE_FACTS) {
      expect(f.statement, f.id).toBe(f.statement.trim());
      expect(f.statement, f.id).toMatch(/[.!?”"]$/);
      expect(f.statement, f.id).not.toMatch(/\s{2,}/);
      expect(f.statement, f.id).not.toMatch(/[,;:][A-Za-z]/);
      expect(f.statement, f.id).not.toMatch(/\.[a-z]/);
    }
  });

  it("leaves out the IPCC's apparatus: confidence tags and braced section references", () => {
    for (const f of CLIMATE_FACTS) {
      expect(f.statement, f.id).not.toMatch(/\((?:very |)(?:high|medium|low) confidence\)/i);
      expect(f.statement, f.id).not.toMatch(/[{}]|SPM\.\d/);
    }
  });
});

describe('climate facts: numbers', () => {
  it('lists each figure once, and every listed figure appears in the statement as printed', () => {
    for (const f of CLIMATE_FACTS) {
      expect(new Set(f.numbers).size, f.id).toBe(f.numbers.length);
      const runs = digitRuns(f.statement);
      for (const n of f.numbers) expect(runs, `${f.id}: '${n}' is not in the statement`).toContain(n);
    }
  });

  it('has no figure in a statement that its numbers do not list', () => {
    for (const f of CLIMATE_FACTS) {
      for (const run of digitRuns(f.statement)) {
        expect(f.numbers, `${f.id}: '${run}' is in the statement but not in numbers`).toContain(run);
      }
    }
  });

  it('extracts figures the way the NUMBERS convention describes', () => {
    const printed = '1.1°C above 1850–1900 in 2011–2020';
    expect(digitRuns(printed)).toEqual(['1.1', '1850', '1900', '2011', '2020']);
    expect(digitRuns('2023/24 was the 37th year')).toEqual(['2023', '24', '37']);
    expect(digitRuns('twice as frequent, three decades')).toEqual([]);
  });
});

describe('climate facts: themes and lookup', () => {
  it('tags every fact with known themes, and every theme is used', () => {
    const known = new Set<string>(FACT_THEMES);
    for (const f of CLIMATE_FACTS) {
      expect(f.themes.length, f.id).toBeGreaterThan(0);
      for (const t of f.themes) expect(known.has(t), `${f.id}: theme ${t}`).toBe(true);
    }
    for (const t of FACT_THEMES) expect(factsByTheme(t).length, t).toBeGreaterThan(0);
  });

  it('covers what the brief asks the science to cover', () => {
    // Human influence; unequal responsibility; glacier retreat; land ice and sea level; coastal and river
    // floods; infrastructure; adaptation and mitigation; delay and irreversibility.
    const needed: FactTheme[] = [
      'human-influence',
      'responsibility',
      'glaciers',
      'ice-sheets',
      'sea-level',
      'coastal-flooding',
      'river-flooding',
      'infrastructure',
      'adaptation',
      'mitigation',
      'delay',
      'irreversibility',
      'pollution',
    ];
    for (const t of needed) expect(factsByTheme(t).length, t).toBeGreaterThan(0);
    // Land ice's contribution to sea level: one fact must tie the two together.
    const landIce = (f: (typeof CLIMATE_FACTS)[number]): boolean =>
      f.themes.includes('glaciers') || f.themes.includes('ice-sheets');
    const landIceAndSea = CLIMATE_FACTS.filter((f) => f.themes.includes('sea-level') && landIce(f));
    expect(landIceAndSea.length).toBeGreaterThan(0);
  });

  it('finds every fact by id and nothing for an unknown id', () => {
    for (const f of CLIMATE_FACTS) expect(factById(f.id)).toBe(f);
    expect(factById('no-such-fact')).toBeUndefined();
    expect(factById('')).toBeUndefined();
  });

  it('returns facts for a theme in arc order', () => {
    const delay = factsByTheme('delay');
    expect(delay.every((f) => f.themes.includes('delay'))).toBe(true);
    const order = delay.map((f) => CLIMATE_FACTS.indexOf(f));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('metaphor notes', () => {
  it('has 6 to 10 notes with unique kebab-case ids and real text', () => {
    expect(METAPHOR_NOTES.length).toBeGreaterThanOrEqual(6);
    expect(METAPHOR_NOTES.length).toBeLessThanOrEqual(10);
    const ids = METAPHOR_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of METAPHOR_NOTES) {
      expect(n.id, n.id).toMatch(KEBAB);
      expect(n.gameElement.trim().length, n.id).toBeGreaterThan(0);
      expect(n.explanation.length, n.id).toBeGreaterThan(80);
      expect(n.explanation, n.id).not.toMatch(/\s{2,}/);
    }
  });

  it('explains each game element the brief names as metaphor', () => {
    const ids = new Set(METAPHOR_NOTES.map((n) => n.id));
    for (const id of [
      'iceberg-on-land',
      'river-behind',
      'melt-by-distance',
      'growth-by-absorbing',
      'destruction-points',
      'floods-and-dams',
      'fictional-world',
      'time-compression',
      'worn-land',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('carries no figures, so quoting a note can never smuggle a number past the validator', () => {
    for (const n of METAPHOR_NOTES) {
      expect(digitRuns(`${n.gameElement} ${n.explanation}`), n.id).toEqual([]);
    }
  });
});
