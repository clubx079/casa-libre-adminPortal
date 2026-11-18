import { describe, it, expect } from 'vitest';
import { compareSnapshots, judgeStatus, dataReport, cleanReport, posGain, pct, reportPrompt } from '../lib/seo/report.js';

const snap = (over = {}) => ({
  window: { start: '2026-11-09', end: '2026-11-15', prevStart: '2026-11-02', prevEnd: '2026-11-08' },
  site: { cur: { clicks: 120, impressions: 4000, ctr: 0.03, position: 9.2 }, prev: { clicks: 100, impressions: 3800, ctr: 0.026, position: 10.1 } },
  pipeline: { cur: { clicks: 12, impressions: 300, position: 14 }, prev: { clicks: 4, impressions: 120, position: 18 } },
  keywords: [
    { query: 'alquiler departamento asuncion', clicks: 20, impressions: 500, position: 6.2, prevPosition: 8.4, prevClicks: 12 },
    { query: 'casas en venta luque', clicks: 3, impressions: 200, position: 14.5, prevPosition: 11.0, prevClicks: 5 },
    { query: 'terreno en paraguay precio', clicks: 1, impressions: 90, position: 22, prevPosition: null, prevClicks: null },
  ],
  pages: { variants: 3, retired: 0, guides: 2, titles: 1, linked: 2 },
  pageResults: [
    { path: '/alquiler/departamentos/asuncion/1-dormitorio', kind: 'added page', clicks: 6, impressions: 150, position: 12, prevClicks: 1, prevImpressions: 40, visits: 9, contacts: 2 },
    { path: '/guias/cuanto-cuesta-un-terreno-en-paraguay', kind: 'guide', clicks: 0, impressions: 0, position: null, prevClicks: 0, prevImpressions: 0, visits: 0, contacts: 0 },
  ],
  opportunities: { open: 4, byType: { create_variant: 2, write_guide: 2 } },
  ...over,
});
const changes = [
  { action: 'enable_variant', path: '/alquiler/departamentos/asuncion/1-dormitorio', reason: 'create_variant: "alquiler departamento 1 dormitorio asunción" (score 205)' },
  { action: 'publish_guide', path: '/guias/cuanto-cuesta-un-terreno-en-paraguay', reason: 'approved "¿Cuánto cuesta un terreno en Paraguay?"' },
  { action: 'set_title', path: '/venta/casas/luque', reason: 'low CTR' },
];

describe('AI SEO report — comparison', () => {
  it('position gain: lower position is better', () => {
    expect(posGain(6.2, 8.4)).toBe(2.2);
    expect(posGain(14.5, 11)).toBe(-3.5);
    expect(posGain(5, null)).toBeNull();
  });
  it('percent change, null when there was nothing before', () => {
    expect(pct(120, 100)).toBe(20);
    expect(pct(5, 0)).toBeNull();
  });
  it('week on week works on the first run; vs previous run is null until there is one', () => {
    const c = compareSnapshots(snap(), null);
    expect(c.weekOnWeek.site.clicksPct).toBe(20);
    expect(c.weekOnWeek.site.positionGain).toBe(0.9);
    expect(c.weekOnWeek.pipeline.clicks).toBe(8);
    expect(c.vsPreviousRun).toBeNull();
    expect(c.keywordMoves.map((k) => k.query)).toEqual(['casas en venta luque', 'alquiler departamento asuncion']);
  });
  it('vs the previous run: deltas, page counts and new keywords', () => {
    const prev = snap({ site: { cur: { clicks: 90, impressions: 3500, position: 10 } }, pages: { variants: 1, guides: 0, titles: 0, linked: 0, retired: 0 }, keywords: [{ query: 'alquiler departamento asuncion' }] });
    const c = compareSnapshots(snap(), prev);
    expect(c.vsPreviousRun.site.clicks).toBe(30);
    expect(c.vsPreviousRun.pages).toEqual({ variants: 2, retired: 0, guides: 2, titles: 1, linked: 2 });
    expect(c.vsPreviousRun.newKeywords).toEqual(['casas en venta luque', 'terreno en paraguay precio']);
  });
});

describe('AI SEO report — status + written report', () => {
  it('status: improving / declining / steady / starting', () => {
    const s = snap();
    expect(judgeStatus(s, compareSnapshots(s))).toBe('improving');
    const down = snap({ site: { cur: { clicks: 80, impressions: 3000, position: 12 }, prev: { clicks: 100, impressions: 3800, position: 10 } } });
    expect(judgeStatus(down, compareSnapshots(down))).toBe('declining');
    const flat = snap({ site: { cur: { clicks: 101, impressions: 3800, position: 10 }, prev: { clicks: 100, impressions: 3800, position: 10.1 } } });
    expect(judgeStatus(flat, compareSnapshots(flat))).toBe('steady');
    expect(judgeStatus({ site: { cur: {}, prev: {} } }, {})).toBe('starting');
  });
  it('the numbers-only report lists what changed and why, keywords, wins, problems, next', () => {
    const s = snap();
    const r = dataReport(s, compareSnapshots(s), changes);
    expect(r.status).toBe('improving');
    expect(r.headline).toMatch(/added 1 pages and 1 guides and edited 1/);
    expect(r.whatChanged[0]).toMatch(/^Added page \/alquiler\/departamentos\/asuncion\/1-dormitorio — create_variant/);
    expect(r.keywords.some((k) => k.includes('casas en venta luque') && k.includes('down 3.5'))).toBe(true);
    expect(r.wins.some((w) => w.includes('1-dormitorio') && w.includes('6 Google clicks'))).toBe(true);
    expect(r.problems.some((p) => p.includes('casas en venta luque'))).toBe(true);
    expect(r.next[0]).toMatch(/4 opportunities still open/);
  });
  it('an AI answer is kept to the expected fields; anything missing falls back to the numbers', () => {
    const s = snap();
    const draft = dataReport(s, compareSnapshots(s), changes);
    const r = cleanReport({ status: 'great', headline: '  Clicks are up.  ', wins: ['a', 2], extra: 'x' }, draft);
    expect(r.status).toBe(draft.status);
    expect(r.headline).toBe('Clicks are up.');
    expect(r.wins).toEqual(['a', '2']);
    expect(r.problems).toEqual(draft.problems);
    expect(r).not.toHaveProperty('extra');
    expect(cleanReport(null, draft)).toEqual(draft);
  });
  it('the AI prompt carries the facts as JSON', () => {
    const s = snap();
    const p = JSON.parse(reportPrompt(s, compareSnapshots(s), changes, dataReport(s, compareSnapshots(s), changes)));
    expect(p.changesThisRun[0]).toMatchObject({ action: 'Added page', path: '/alquiler/departamentos/asuncion/1-dormitorio' });
    expect(p.keywords).toHaveLength(3);
  });
});

describe('AI SEO report — changes shown on the real page', () => {
  it('a variant change logged on its city page shows the page that was added / hidden', async () => {
    const { displayChanges } = await import('../lib/seo/report.js');
    const out = displayChanges([
      { action: 'enable_variant', path: '/alquiler/departamentos/asuncion', before: { enabled_variants: ['baratos'] }, after: { enabled_variants: ['baratos', '1-dormitorio'] }, reason: 'r' },
      { action: 'retire_variant', path: '/venta/casas/luque', before: { retired_variants: [] }, after: { retired_variants: ['baratos'] } },
      { action: 'set_title', path: '/venta/casas/luque', before: {}, after: {} },
    ]);
    expect(out.map((c) => c.path)).toEqual(['/alquiler/departamentos/asuncion/1-dormitorio', '/venta/casas/luque/baratos', '/venta/casas/luque']);
  });
});
