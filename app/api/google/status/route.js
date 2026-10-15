// GET /api/google/status[?test=1] — which Google settings are in place (names only), the
// redirect URL to give Hamza, and with ?test=1 a read-only check of each API: Ads
// (yesterday's spend), Search Console (top queries, last 7 days) and GA4 (sessions).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { googleSetup, redirectUri, adsSearch, gscQuery, ga4Report, GSC_SITE } from '@/lib/googleApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const setup = googleSetup();
  const out = { setup, redirectUri: redirectUri(req), country: activeCountry() };
  if (new URL(req.url).searchParams.get('test') !== '1') return NextResponse.json(out);
  if (!setup.refreshToken) return NextResponse.json({ ...out, test: { error: 'Not connected yet (no GOOGLE_ADS_REFRESH_TOKEN).' } });

  const run = async (fn) => { try { return { ok: true, ...(await fn()) }; } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; } };
  const [ads, gsc, ga4] = await Promise.all([
    run(async () => {
      const j = await adsSearch('SELECT metrics.clicks, metrics.impressions, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_7_DAYS');
      const m = (j.results || []).reduce((s, r) => ({ clicks: s.clicks + Number(r.metrics?.clicks || 0), impressions: s.impressions + Number(r.metrics?.impressions || 0), cost: s.cost + Number(r.metrics?.costMicros || 0) / 1e6 }), { clicks: 0, impressions: 0, cost: 0 });
      return { last7days: { ...m, cost: Math.round(m.cost * 100) / 100 } };
    }),
    run(async () => {
      const site = GSC_SITE[out.country] || `sc-domain:${out.country}`;   // never another country's property
      const j = await gscQuery(site, { startDate: day(9), endDate: day(2), dimensions: ['query'], rowLimit: 5 });
      return { site, topQueries: (j.rows || []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions })) };
    }),
    run(async () => {
      const j = await ga4Report({ dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }] });
      const v = j.rows?.[0]?.metricValues || [];
      return { last7days: { sessions: Number(v[0]?.value || 0), activeUsers: Number(v[1]?.value || 0) } };
    }),
  ]);
  return NextResponse.json({ ...out, test: { ads, gsc, ga4 } });
}
