// Google indexing in the SEO run snapshot, and what the AI Analyst / Admin Manager read from it.
import { describe, it, expect } from 'vitest';
import { countIndexed, reasons, summarizeIndexing, recentPipelinePages, indexingHistory, rankingFrom } from '../lib/seo/indexing.js';

const row = (url, verdict, coverage = '') => ({ url, verdict, coverage, lastCrawl: null });

describe('countIndexed / reasons', () => {
  it('counts PASS as indexed and leaves ERROR rows out', () => {
    const c = countIndexed([row('a', 'PASS'), row('b', 'NEUTRAL', 'Discovered - currently not indexed'), row('c', 'ERROR', 'quota')]);
    expect(c).toEqual({ checked: 2, indexed: 1, notIndexed: 1, errors: 1, indexedPct: 50 });
    expect(countIndexed([]).indexedPct).toBeNull();
  });
  it('groups not-indexed pages by Google reason, most common first', () => {
    const r = reasons([row('a', 'NEUTRAL', 'X'), row('b', 'NEUTRAL', 'Y'), row('c', 'FAIL', 'Y'), row('d', 'PASS', 'Submitted and indexed')]);
    expect(Object.entries(r)).toEqual([['Y', 2], ['X', 1]]);
  });
});

describe('summarizeIndexing', () => {
  it('estimates the site figure and lists new pages Google has not indexed', () => {
    const at = '2026-11-20T09:00:00Z';
    const s = summarizeIndexing({
      at, inSitemap: 1000,
      sampleRows: [row('https://x.py/', 'PASS'), row('https://x.py/a', 'PASS'), row('https://x.py/b', 'NEUTRAL', 'Crawled - currently not indexed'), row('https://x.py/c', 'PASS')],
      newRows: [row('https://x.py/venta/casa/asuncion/baratos', 'NEUTRAL', 'URL is unknown to Google'), row('https://x.py/guias/g1', 'PASS')],
      newPages: [{ path: '/venta/casa/asuncion/baratos', kind: 'filter page', at: '2026-11-17T09:00:00Z' }],
    });
    expect(s.sitewide.estimatedIndexed).toBe(750);
    expect(s.sitewide.indexedPct).toBe(75);
    expect(s.newPages.checked).toBe(2);
    expect(s.newPages.notIndexedList).toEqual([{ path: '/venta/casa/asuncion/baratos', kind: 'filter page', addedDaysAgo: 3, reason: 'URL is unknown to Google', lastCrawl: null }]);
    expect(s.notIndexedExamples[0]).toEqual({ path: '/b', reason: 'Crawled - currently not indexed' });
  });
});

describe('recentPipelinePages', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');
  it('takes only newly enabled variants and guides from the last 14 days, not reverted', () => {
    const pages = recentPipelinePages([
      { action: 'enable_variant', path: '/venta/casa/asuncion', before: { enabled_variants: ['baratos'] }, after: { enabled_variants: ['baratos', '2-dormitorios'] }, created_at: '2026-11-18T09:00:00Z' },
      { action: 'publish_guide', path: '/guias/comprar-casa', created_at: '2026-11-19T09:00:00Z' },
      { action: 'publish_guide', path: '/guias/old', created_at: '2026-10-01T09:00:00Z' },
      { action: 'publish_guide', path: '/guias/undone', created_at: '2026-11-19T09:00:00Z', reverted_at: '2026-11-19T10:00:00Z' },
      { action: 'set_title', path: '/x', created_at: '2026-11-19T09:00:00Z' },
    ], { now });
    expect(pages.map((p) => p.path)).toEqual(['/guias/comprar-casa', '/venta/casa/asuncion/2-dormitorios']);
  });
});

describe('indexingHistory / rankingFrom', () => {
  it('builds an oldest-first series and the change over it', () => {
    const snap = (pct, est, inS) => ({ indexing: { at: 'x', inSitemap: inS, sitewide: { indexedPct: pct, estimatedIndexed: est }, newPages: { checked: 4, indexed: 1 } } });
    const h = indexingHistory([
      { started_at: '2026-11-20T09:00:00Z', snapshot: snap(80, 800, 1000) },
      { started_at: '2026-11-19T09:00:00Z', snapshot: {} },
      { started_at: '2026-11-18T09:00:00Z', snapshot: snap(70, 680, 970) },
    ]);
    expect(h.series.map((s) => s.date)).toEqual(['2026-11-18', '2026-11-20']);
    expect(h.change).toEqual({ from: '2026-11-18', to: '2026-11-20', estimatedIndexed: 120, sampleIndexedPctPoints: 10, inSitemap: 30 });
    expect(indexingHistory([]).change).toBeNull();
  });
  it('reads ranking and keyword moves from the snapshot', () => {
    const r = rankingFrom({
      site: { cur: { clicks: 50, impressions: 4000, position: 12.34 }, prev: { clicks: 40, impressions: 3500, position: 14 } },
      keywords: [{ query: 'casas en venta', clicks: 5, impressions: 900, position: 8, prevPosition: 11 }, { query: 'alquiler', clicks: 1, impressions: 300, position: 20, prevPosition: 15 }],
    });
    expect(r.thisWeek).toEqual({ clicks: 50, impressions: 4000, position: 12.3 });
    expect(r.improved.map((k) => k.query)).toEqual(['casas en venta']);
    expect(r.dropped.map((k) => k.query)).toEqual(['alquiler']);
  });
});
