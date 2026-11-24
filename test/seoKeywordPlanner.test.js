import { describe, it, expect } from 'vitest';
import { buildSeedGroups, shapeIdeas, topRows, isDue, KP_GEOS, fold } from '../lib/seo/keywordPlanner.js';
import { aggregateSignals, isProven } from '../lib/seo/decide.js';
import { demandOf } from '../lib/seo/score.js';
import { DEFAULT_SETTINGS } from '../lib/seo/settings.js';

const idea = (text, n, extra = {}) => ({ text, keywordIdeaMetrics: { avgMonthlySearches: String(n), competition: 'MEDIUM', competitionIndex: '40', lowTopOfPageBidMicros: '150000', highTopOfPageBidMicros: '900000', monthlySearchVolumes: [{ year: '2026', month: 'OCTOBER', monthlySearches: String(n) }], ...extra } });

describe('SEO pipeline: Keyword Planner', () => {
  it('has a location for every country', () => {
    expect(KP_GEOS).toEqual({ py: 2600, uy: 2858, bo: 2068, sv: 2222, ve: 2862 });
  });

  it('builds at most 3 groups of 20 seeds: generic, cities, then our own searches (no repeats)', () => {
    const g = buildSeedGroups({ cities: [{ name: 'Asunción' }, { name: 'Luque' }], topTerms: ['Casas en venta', 'alquiler villa morra'] });
    expect(g.length).toBeLessThanOrEqual(3);
    g.forEach((x) => expect(x.length).toBeLessThanOrEqual(20));
    const all = g.flat();
    expect(all).toContain('casas en venta asuncion');
    expect(all).toContain('alquiler villa morra');
    expect(all.filter((s) => s === 'casas en venta')).toHaveLength(1);
  });

  it('keeps relevant ideas with volume, biggest reading per search, folded', () => {
    const seen = shapeIdeas([
      idea('Departamentos en alquiler', 720), idea('departamentos en alquiler', 500),
      idea('trabajo en asuncion', 9000), idea('casas en venta luque', 5), idea('alquiler villa morra', 90),
    ], { cc: 'py', date: '2026-11-24', cities: [{ name: 'Luque' }] });
    const rows = topRows(seen);
    expect(rows.map((r) => r.term)).toEqual(['departamentos en alquiler', 'alquiler villa morra']);
    expect(rows[0]).toMatchObject({ country: 'py', source: 'keyword_planner', page: '', date: '2026-11-24' });
    expect(rows[0].metrics).toMatchObject({ avg_monthly_searches: 720, competition: 'MEDIUM', competition_index: 40, low_bid: 0.15, high_bid: 0.9 });
    expect(rows[0].metrics.trend).toEqual([{ y: 2026, m: 'OCTOBER', n: 720 }]);
  });

  it('runs weekly', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    expect(isDue(null, now)).toBe(true);
    expect(isDue('2026-11-20', now)).toBe(false);
    expect(isDue('2026-11-17', now)).toBe(true);
  });

  it('feeds the volume into demand and "proven"', () => {
    const [d] = aggregateSignals([
      { source: 'keyword_planner', term: 'departamentos en alquiler', date: '2026-11-20', metrics: { avg_monthly_searches: 720, competition: 'LOW' } },
      { source: 'gsc', term: 'departamentos en alquiler', date: '2026-11-24', page: '/alquiler', metrics: { clicks: 1, impressions: 10, position: 30 } },
    ]);
    expect(d.kp).toEqual({ volume: 720, competition: 'LOW' });
    expect(isProven(d, DEFAULT_SETTINGS.thresholds)).toBe(true);
    expect(demandOf({ kp: { volume: 1000 } })).toBeCloseTo(30);
    expect(fold('Dúplex  EN Venta')).toBe('duplex en venta');
  });
});
