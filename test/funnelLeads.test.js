import { describe, it, expect } from 'vitest';
import {
  isMissingTable, filterFunnelLeads, funnelCounts, leadPatch, leadsQuery, normLeadDays, normSites, normStatus, utmOf, waLink,
} from '../lib/funnelLeads.js';
import { funnelWhere, summaryFromRow, dailyFromRows, normFunnelDays } from '../lib/funnelAnalytics.js';

const rows = [
  { id: 1, site: 'owners', country: 'py', status: 'new', name: 'Ana Gómez', whatsapp: '+595 981 123 456', email: 'ana@x.com' },
  { id: 2, site: 'agents', country: 'py', status: 'contacted', name: 'Luis', whatsapp: '0991-555', email: null },
  { id: 3, site: 'agents', country: 'bo', status: 'converted', name: 'Marta', whatsapp: '+591 7000', email: 'm@y.bo' },
  { id: 4, site: 'owners', country: 'py', status: null, name: 'Pedro', whatsapp: '123', email: null },
  { id: 5, site: 'owners2', country: 'py', status: 'new', name: 'Rosa', whatsapp: '0981 1', email: null },
  { id: 6, site: 'owners', form_location: 'owners2', country: 'py', status: 'new', name: 'Juan', whatsapp: '0981 2', email: null },
];

describe('funnel leads', () => {
  it('recognises a missing table (never crashes the page)', () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205', message: 'x' })).toBe(true);
    expect(isMissingTable(new Error('relation "public.funnel_leads" does not exist'))).toBe(true);
    expect(isMissingTable(new Error("Could not find the table 'public.funnel_leads' in the schema cache"))).toBe(true);
    expect(isMissingTable(new Error('PostgREST 500'))).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });

  it('filters by site, status and search (name / email / phone digits)', () => {
    expect(filterFunnelLeads(rows, { sites: ['org'] }).map((r) => r.id)).toEqual([1, 4]);
    expect(filterFunnelLeads(rows, { sites: ['online'] }).map((r) => r.id)).toEqual([5, 6]);   // owners2, or its fallback
    expect(filterFunnelLeads(rows, { sites: ['org', 'agbo'] }).map((r) => r.id)).toEqual([1, 3, 4]);
    expect(filterFunnelLeads(rows, { status: 'new' }).map((r) => r.id)).toEqual([1, 4, 5, 6]);   // null status = new
    expect(filterFunnelLeads(rows, { q: 'gómez' }).map((r) => r.id)).toEqual([1]);
    expect(filterFunnelLeads(rows, { q: '981123' }).map((r) => r.id)).toEqual([1]);
    expect(filterFunnelLeads(rows, { q: 'y.bo' }).map((r) => r.id)).toEqual([3]);
  });

  it('counts by status and site', () => {
    const c = funnelCounts(rows);
    expect(c.total).toBe(6);
    expect(c.status).toEqual({ new: 4, contacted: 1, converted: 1, discarded: 0 });
    expect(c.site).toMatchObject({ org: 2, online: 2, agpy: 1, agbo: 1, libpy: 0, libbo: 0 });
  });

  it('builds the status / notes patch with handled_by + handled_at', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    expect(leadPatch({ status: 'contacted' }, 'Omar', now).patch).toEqual({ status: 'contacted', handled_by: 'Omar', handled_at: now.toISOString() });
    expect(leadPatch({ status: 'interested' }, 'x').error).toBe('Invalid status');
    expect(leadPatch({}, 'x').error).toBe('Nothing to update');
    expect(leadPatch({ notes: '' }, 'x').patch.notes).toBe(null);
    expect(leadPatch(null).error).toBe('Bad request');
  });

  it('normalises inputs and builds the query', () => {
    expect(normSites('org,agbo')).toEqual(['org', 'agbo']);
    expect(normSites("x' or 1,org")).toEqual(['org']);
    expect(normSites('')).toEqual([]);
    expect(normStatus('converted')).toBe('converted');
    expect(normLeadDays('0')).toBe(0);
    expect(normLeadDays(null)).toBe(30);
    expect(normLeadDays('13')).toBe(30);
    expect(leadsQuery({ days: 0 })).not.toContain('created_at=gte');
    expect(leadsQuery({ days: 7, now: Date.parse('2026-11-13T00:00:00Z') })).toContain('created_at=gte.2026-11-06T00:00:00.000Z');
  });

  it('wa.me link and utm parsing', () => {
    expect(waLink('+595 981-123')).toBe('https://wa.me/595981123');
    expect(waLink('')).toBe(null);
    expect(utmOf({ utm: { utm_source: 'fb', utm_campaign: 'c1' } })).toMatchObject({ source: 'fb', campaign: 'c1' });
    expect(utmOf({ utm: '{"source":"google"}' }).source).toBe('google');
    expect(utmOf({})).toEqual({});
  });
});

describe('funnel analytics', () => {
  it('scopes to funnel events, site and countries — safely', () => {
    const w = funnelWhere({ days: 28, sites: ['org', 'libpy'], countries: ['py'] });
    expect(w).toContain('INTERVAL 28 DAY');
    expect(w).toContain("funnel_site), '') != ''");
    expect(w).toContain("IN ('org', 'libpy')");
    expect(w).toContain("'comovendermicasarapido.org', 'org'");
    expect(w).toContain("IN ('py')");
    const all = funnelWhere({ days: 999, sites: ["x'"], countries: ["py' OR 1=1"] });
    expect(all).toContain('INTERVAL 7 DAY');
    expect(all).not.toContain('funnel_country');
    expect(all).not.toContain("x'");
    expect(normFunnelDays(90)).toBe(90);
  });

  it('summary row → numbers + conversion', () => {
    const s = summaryFromRow([200, 500, 30, 25, 40, 12, 10, 50, 44]);
    expect(s).toMatchObject({ visitors: 200, pageviews: 500, formStarts: 30, leads: 12, leadPeople: 10, clClicks: 50, conversion: 5 });
    expect(summaryFromRow([]).conversion).toBe(0);
  });

  it('daily series fills missing days', () => {
    const d = dailyFromRows([['2026-11-12', 3, 5, 1, 1, 0]], 7, '2026-11-13');
    expect(d).toHaveLength(7);
    expect(d[6].date).toBe('2026-11-13');
    expect(d[5]).toMatchObject({ date: '2026-11-12', visitors: 3, leads: 1 });
    expect(d[0].visitors).toBe(0);
  });
});

import { FUNNEL_SOURCE_BRANCHES, UTM_SOURCE_TO_SITE, sitesForCountry, leadSiteKey } from '../lib/funnelSites.js';
import { SOURCE_EXPR } from '../lib/posthogSql.js';

describe('the six SEO sites', () => {
  it('names every site in the visitor source, before the generic utm branch', () => {
    expect(UTM_SOURCE_TO_SITE.inmobiliariaboliviaorg).toBe('libbo');
    expect(FUNNEL_SOURCE_BRANCHES).toContain("'agenteinmobiliariobolivia.com'".replace("'", "'funnel · "));
    const i = SOURCE_EXPR.indexOf('funnel · comovendermicasarapido.org');
    const j = SOURCE_EXPR.indexOf("lower(properties.utm_source),");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });
  it('offers only the sites of the country', () => {
    expect(sitesForCountry('bo').map((s) => s.key)).toEqual(['org', 'agbo', 'libbo']);
    expect(sitesForCountry('py').map((s) => s.key)).toEqual(['org', 'online', 'agpy', 'libpy']);
    expect(sitesForCountry('uy').map((s) => s.key)).toEqual(['org']);
  });
  it('maps a lead row to its site', () => {
    expect(leadSiteKey({ site: 'owners2' })).toBe('online');
    expect(leadSiteKey({ site: 'owners', form_location: 'owners2' })).toBe('online');
    expect(leadSiteKey({ site: 'owners', form_location: 'side' })).toBe('org');
    expect(leadSiteKey({ site: 'agents', country: 'uy' })).toBe('agents-old');
  });
});
