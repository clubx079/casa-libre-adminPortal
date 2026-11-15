import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import {
  hubWhere, normHubDays, summarySql, summaryFromRow, dailySql, dailyFromRows, pagesSql, pagesFromRows,
  articlesSql, articlesFromRows, blogCountrySql, blogCountryFromRows, langSql, langFromRows,
  sendsSql, sendsFromRows, clContentSql, clContentFromRows, sourcesSql, sourcesFromRows, geoSql, geoFromRows,
} from '@/lib/hubAnalytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const flat = (rows) => rows.map((r) => (Array.isArray(r) ? r : Object.values(r)));
// The hub serves every country, so its numbers are not scoped by the header's country switcher;
// days are counted in Paraguay time.
const TZ = 'America/Asuncion';

// GET /api/analytics/hub?days=7|28|30|90|180|365 — PostHog numbers for the casa-libre.com hub
// (events with hub_site set or host casa-libre.com / www.casa-libre.com). Same roles as the
// Analytics page (lib/adminPages.js API_PAGES.analytics). Queries are cached by
// lib/posthogHogql.js (5 min fresh, 6 h stale-while-revalidate).
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!posthogConfigured()) return NextResponse.json({ configured: false });
  const days = normHubDays(new URL(req.url).searchParams.get('days'));
  const where = hubWhere({ days });
  try {
    // PostHog queues (and times out) queries sent all at once: small waves.
    const [sum, daily, pages, articles] = await Promise.all([
      hogql(summarySql(where)), hogql(dailySql(where, TZ)), hogql(pagesSql(where)), hogql(articlesSql(where)),
    ]);
    const totals = summaryFromRow(flat(sum)[0]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const base = { configured: true, days, tz: TZ, totals, daily: dailyFromRows(flat(daily), days, today) };
    if (!totals.visitors && !totals.pageviews) {
      return NextResponse.json({ ...base, empty: true, pages: [], articles: [], blogCountries: [], langs: [], sends: [], clContent: [], sources: [], geo: [] });
    }
    const [blogCountries, langs, sends, clContent] = await Promise.all([
      hogql(blogCountrySql(where)), hogql(langSql(where)), hogql(sendsSql(where)), hogql(clContentSql(where)),
    ]);
    const [sources, geo] = await Promise.all([hogql(sourcesSql(where)), hogql(geoSql(where))]);
    return NextResponse.json({
      ...base,
      empty: false,
      pages: pagesFromRows(flat(pages)),
      articles: articlesFromRows(flat(articles)),
      blogCountries: blogCountryFromRows(flat(blogCountries)),
      langs: langFromRows(flat(langs)),
      sends: sendsFromRows(flat(sends)),
      clContent: clContentFromRows(flat(clContent)),
      sources: sourcesFromRows(flat(sources)),
      geo: geoFromRows(flat(geo)),
    });
  } catch (e) {
    return NextResponse.json({ configured: true, error: String(e.message || e).slice(0, 300) }, { status: 502 });
  }
}
