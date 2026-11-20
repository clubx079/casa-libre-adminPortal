import { describe, it, expect } from 'vitest';
import { changedPages, dataRange, impactFor, normPath, pct } from '../lib/seo/impact.js';

describe('changedPages', () => {
  it('one entry per page, newly enabled variants only, reverted changes skipped', () => {
    const p = changedPages([
      { action: 'add_links', path: '/venta/casas/asuncion', created_at: '2026-11-18T01:00:00Z' },
      { action: 'set_title', path: '/venta/casas/asuncion', created_at: '2026-11-19T01:00:00Z' },
      { action: 'enable_variant', path: '/alquiler/departamentos/asuncion', before: { enabled_variants: ['baratos'] }, after: { enabled_variants: ['baratos', '2-dormitorios'] }, created_at: '2026-11-20T01:00:00Z' },
      { action: 'publish_guide', path: '/guias/x', created_at: '2026-11-18T01:00:00Z', reverted_at: '2026-11-18T02:00:00Z' },
      { action: 'retire_variant', path: '/y', created_at: '2026-11-18T01:00:00Z' },
    ]);
    expect(p.map((x) => x.path).sort()).toEqual(['/alquiler/departamentos/asuncion/2-dormitorios', '/venta/casas/asuncion']);
    const casas = p.find((x) => x.path === '/venta/casas/asuncion');
    expect(casas.kinds).toEqual(['extra links', 'new title']);
    expect(casas.firstChange).toBe('2026-11-18T01:00:00Z');
    expect(casas.isNew).toBe(false);
    expect(p.find((x) => x.path.endsWith('2-dormitorios')).isNew).toBe(true);
  });
});

describe('impactFor', () => {
  const pages = [
    { path: '/venta/casas/asuncion', kinds: ['extra links'], firstChange: '2026-11-08T05:00:00Z', isNew: false },
    { path: '/guias/nueva', kinds: ['new guide'], firstChange: '2026-11-15T05:00:00Z', isNew: true },
  ];
  // before (Oct 25–Nov 7): 14 days × 10 impressions, pos 30; after (Nov 9–Nov 18): 10 days × 20, pos 20
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push({ page: 'https://x.py/venta/casas/asuncion', date: new Date(Date.parse('2026-10-25T12:00:00Z') + i * 86400000).toISOString().slice(0, 10), impressions: 10, clicks: i === 0 ? 1 : 0, position: 30 });
  for (let i = 0; i < 10; i++) rows.push({ page: '/venta/casas/asuncion/', date: new Date(Date.parse('2026-11-09T12:00:00Z') + i * 86400000).toISOString().slice(0, 10), impressions: 20, clicks: 1, position: 20 });
  rows.push({ page: 'https://x.py/guias/nueva', date: '2026-11-17', impressions: 5, clicks: 0, position: 40 });
  const r = impactFor(pages, rows, { lastDay: '2026-11-18' });
  it('compares per-day averages before and after the change', () => {
    const e = r.pages.find((x) => x.path === '/venta/casas/asuncion');
    expect(e.status).toBe('measured');
    expect(e.afterDays).toBe(10);
    expect(e.before.perDay.impressions).toBe(10);
    expect(e.after.perDay.impressions).toBe(20);
    expect(e.change.impressionsPct).toBe(100);
    expect(e.change.positionGain).toBe(10);
    expect(r.edited.change.impressionsPct).toBe(100);
  });
  it('new pages have no before and are too early under 7 days', () => {
    const g = r.pages.find((x) => x.path === '/guias/nueva');
    expect(g.before).toBeNull();
    expect(g.status).toBe('too early');
    expect(g.after.impressions).toBe(5);
    expect(r.new).toEqual({ pages: 1, withImpressions: 1, after: { impressions: 5, clicks: 0 } });
  });
  it('range and helpers', () => {
    expect(dataRange(pages, '2026-11-18')).toEqual({ start: '2026-10-25', end: '2026-11-18' });
    expect(normPath('https://a.b/x/?q=1')).toBe('/x');
    expect(pct(15, 10)).toBe(50);
    expect(pct(5, 0)).toBeNull();
  });
});
