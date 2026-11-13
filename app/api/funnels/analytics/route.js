import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry, allowedCountryCodes } from '@/lib/adminCountry';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { COUNTRY_TZ } from '@/lib/whatsappStats';
import { FUNNEL_COUNTRIES } from '@/lib/funnelLeads';
import {
  funnelWhere, normFunnelDays, summarySql, summaryFromRow, bySiteSql, bySiteFromRows, byCountrySql, byCountryFromRows,
  pagesSql, pagesFromRows, sourcesSql, sourcesFromRows, clicksSql, clicksFromRows, dailySql, dailyFromRows,
} from '@/lib/funnelAnalytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const flat = (rows) => rows.map((r) => (Array.isArray(r) ? r : Object.values(r)));

// GET /api/funnels/analytics?days=7|28|90&site=all|owners|agents&country=active|all[&summary=1]
// PostHog numbers for the funnel sites (events with properties.funnel_site set). country=active
// (default) scopes to the header's country through properties.funnel_country; 'all' = every
// country this admin may see. summary=1 → just the totals + per-site (the Analytics page card).
// Queries are cached by lib/posthogHogql.js (5 min fresh, 6 h stale-while-revalidate).
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!posthogConfigured()) return NextResponse.json({ configured: false });
  const sp = new URL(req.url).searchParams;
  const days = normFunnelDays(sp.get('days'));
  const site = ['owners', 'agents'].includes(sp.get('site')) ? sp.get('site') : 'all';
  const allCountries = sp.get('country') === 'all';
  const active = activeCountry();
  const allowed = allowedCountryCodes();
  // 'all' = every funnel country, narrowed to the admin's countries when they are restricted
  const countries = allCountries ? (allowed ? FUNNEL_COUNTRIES.filter((c) => allowed.includes(c)) : []) : [active];
  if (allCountries && allowed && !countries.length) countries.push(active);
  const where = funnelWhere({ days, site, countries });
  const tz = COUNTRY_TZ[allCountries ? 'py' : active] || 'America/Asuncion';
  try {
    if (sp.get('summary') === '1') {
      const [sum, bySite] = await Promise.all([hogql(summarySql(where)), hogql(bySiteSql(where))]);
      return NextResponse.json({ configured: true, days, site, country: allCountries ? 'all' : active, totals: summaryFromRow(flat(sum)[0]), bySite: bySiteFromRows(flat(bySite)) });
    }
    // PostHog queues (and times out) queries sent all at once: two small waves.
    const [sum, bySite, byCountry, daily] = await Promise.all([
      hogql(summarySql(where)), hogql(bySiteSql(where)), hogql(byCountrySql(where)), hogql(dailySql(where, tz)),
    ]);
    const [pages, sources, clicks] = await Promise.all([hogql(pagesSql(where)), hogql(sourcesSql(where)), hogql(clicksSql(where))]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return NextResponse.json({
      configured: true, days, site, country: allCountries ? 'all' : active, tz,
      totals: summaryFromRow(flat(sum)[0]),
      bySite: bySiteFromRows(flat(bySite)),
      byCountry: byCountryFromRows(flat(byCountry)),
      pages: pagesFromRows(flat(pages)),
      sources: sourcesFromRows(flat(sources)),
      clicks: clicksFromRows(flat(clicks)),
      daily: dailyFromRows(flat(daily), days, today),
    });
  } catch (e) {
    return NextResponse.json({ configured: true, error: String(e.message || e).slice(0, 300) }, { status: 502 });
  }
}
