// GET /api/seo?tab=opportunities|drafts|changes|signals|watch|settings — Admin → SEO data for the
// active country (lib/seo/*). POST /api/seo/action does the changes.
// ?site=<key> (org|online|agpy|agbo|libpy|libbo|hub): the same tabs for one of the six SEO sites or the hub (lib/seoSites/*;
// PY DB, country 'site:<key>'). Drafts then carry `path` (the guide's address on the site). Without it: as before.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { seoDb, loadSettings, getOverrides, isMissingTable, ccOf } from '@/lib/seo/store';
import { watch } from '@/lib/seo/run';
import { loadInventory } from '@/lib/seo/data';
import { pageState } from '@/lib/seo/inventory';
import { websiteUrl } from '@/lib/seo/website';
import { TREND_GEOS } from '@/lib/seo/trends';
import { siteFor, scopeOf, siteUrl, guidePath } from '@/lib/seoSites/scope';
import { watch as siteWatch } from '@/lib/seoSites/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enc = encodeURIComponent;

async function tabData(cc, tab, sp) {
  const db = seoDb(cc);
  if (tab === 'opportunities') {
    const status = ['open', 'applied', 'dismissed'].includes(sp.get('status')) ? sp.get('status') : 'open';
    const rows = await db.select('seo_opportunities', `select=*&country=eq.${cc}&status=eq.${status}&order=score.desc&limit=300`);
    const inv = await loadInventory(cc).catch(() => new Map());
    const ov = await getOverrides(cc).catch(() => new Map());
    return { rows: rows.map((r) => ({ ...r, page: r.url && r.url.split('/').length >= 4 ? pageState(r.url, inv, ov) : null })) };
  }
  if (tab === 'drafts') {
    return { rows: await db.select('seo_drafts', `select=*&country=eq.${cc}&order=updated_at.desc&limit=200`) };
  }
  if (tab === 'changes') {
    return { rows: await db.select('seo_changes', `select=*&country=eq.${cc}&order=created_at.desc&limit=200`), overrides: [...(await getOverrides(cc)).values()] };
  }
  if (tab === 'signals') {
    const [latest] = await db.select('seo_signals', `select=date&country=eq.${cc}&order=date.desc&limit=1`);
    const date = latest?.date;
    const pick = (source, order) => (date ? db.select('seo_signals', `select=term,page,date,metrics&country=eq.${cc}&source=eq.${source}&date=eq.${date}&order=${order}&limit=60`) : []);
    // Keyword Planner is weekly: its own newest date (not the daily one)
    const [kpLatest] = await db.select('seo_signals', `select=date&country=eq.${cc}&source=eq.keyword_planner&order=date.desc&limit=1`).catch(() => []);
    const kpDate = kpLatest?.date || null;
    const [ads, gsc, site, trends, counts, kp, kpCount] = await Promise.all([
      pick('ads', 'id.asc'), pick('gsc', 'id.asc'), pick('site_search', 'id.asc'),
      db.select('seo_trends', `select=title,traffic,traffic_label,topic,news,seen_at,pub_date&geo=eq.${TREND_GEOS[cc]}&order=seen_at.desc&limit=80`),
      Promise.all(['ads', 'gsc', 'site_search'].map((s) => (date ? db.selectWithCount('seo_signals', `select=id&country=eq.${cc}&source=eq.${s}&date=eq.${date}&limit=1`).then((r) => [s, r.count]) : [s, 0]))),
      kpDate ? db.select('seo_signals', `select=term,date,metrics&country=eq.${cc}&source=eq.keyword_planner&date=eq.${kpDate}&order=metrics->avg_monthly_searches.desc&limit=60`).catch(() => []) : [],
      kpDate ? db.selectWithCount('seo_signals', `select=id&country=eq.${cc}&source=eq.keyword_planner&date=eq.${kpDate}&limit=1`).then((r) => r.count).catch(() => 0) : 0,
    ]);
    const by = (k) => (a, b) => (b.metrics?.[k] || 0) - (a.metrics?.[k] || 0);
    // latest reading per trend title
    const seen = new Set();
    const trendLatest = trends.filter((t) => (seen.has(t.title) ? false : seen.add(t.title)));
    // AI assistants (lib/aiVisibility): the last 7 days, and which assistants are switched on
    let visibility = null;
    try {
      const m = await import('@/lib/aiVisibility/run');
      const p = await import('@/lib/aiVisibility/providers');
      const v = await m.overview(7);
      visibility = { ...v, questions: v.questions.filter((q) => q.country === cc), providers: p.providerStatus() };
    } catch (e) { visibility = { error: /does not exist|PGRST205|42P01|schema cache/i.test(String(e?.message || e)) ? 'run migrations/control/004_ai_visibility.sql in the control DB' : String(e?.message || e).slice(0, 200) }; }
    return { visibility, date, counts: { ...Object.fromEntries(counts), keyword_planner: kpCount }, kpDate, kp: kp.sort(by('avg_monthly_searches')).slice(0, 50), ads: ads.sort(by('clicks')).slice(0, 40), gsc: gsc.sort(by('impressions')).slice(0, 40), site: site.sort(by('searches')).slice(0, 40), trends: trendLatest.slice(0, 40) };
  }
  if (tab === 'watch') return watch(cc);
  if (tab === 'settings') return { settings: await loadSettings(cc), website: websiteUrl(cc), devDb: !!process.env.SEO_DB_URL };
  return { error: 'unknown tab' };
}

// The same tabs for one SEO site: rows in the PY DB under country 'site:<key>'.
async function siteTabData(site, tab, sp) {
  const scope = scopeOf(site.key);
  const q = enc(scope);
  const db = seoDb(scope);
  if (tab === 'opportunities') {
    const status = ['open', 'applied', 'dismissed'].includes(sp.get('status')) ? sp.get('status') : 'open';
    return { rows: (await db.select('seo_opportunities', `select=*&country=eq.${q}&status=eq.${status}&order=score.desc&limit=300`)).map((r) => ({ ...r, page: null })) };
  }
  if (tab === 'drafts') {
    const rows = await db.select('seo_drafts', `select=*&country=eq.${q}&order=updated_at.desc&limit=200`);
    return { rows: rows.map((d) => ({ ...d, path: guidePath(site, d.related?.cc, d.slug) })) };
  }
  if (tab === 'changes') {
    return { rows: await db.select('seo_changes', `select=*&country=eq.${q}&order=created_at.desc&limit=200`), overrides: [...(await getOverrides(scope)).values()] };
  }
  if (tab === 'signals') {
    const [latest] = await db.select('seo_signals', `select=date&country=eq.${q}&order=date.desc&limit=1`);
    const date = latest?.date;
    const pick = (source) => (date ? db.select('seo_signals', `select=term,page,date,metrics&country=eq.${q}&source=eq.${source}&date=eq.${date}&order=id.asc&limit=60`) : []);
    const geos = site.countries.map((cc) => TREND_GEOS[cc]).join(',');
    const [ads, gsc, trends, counts] = await Promise.all([
      pick('ads'), pick('gsc'),
      db.select('seo_trends', `select=title,traffic,traffic_label,topic,news,seen_at,pub_date,geo&geo=in.(${geos})&order=seen_at.desc&limit=80`),
      Promise.all(['ads', 'gsc', 'site_search'].map((s) => (date ? db.selectWithCount('seo_signals', `select=id&country=eq.${q}&source=eq.${s}&date=eq.${date}&limit=1`).then((r) => [s, r.count]) : [s, 0]))),
    ]);
    const by = (k) => (a, b) => (b.metrics?.[k] || 0) - (a.metrics?.[k] || 0);
    const seen = new Set();
    const trendLatest = trends.filter((t) => (seen.has(t.title) ? false : seen.add(t.title)));
    return { date, counts: Object.fromEntries(counts), ads: ads.sort(by('clicks')).slice(0, 40), gsc: gsc.sort(by('impressions')).slice(0, 40), trends: trendLatest.slice(0, 40) };
  }
  if (tab === 'watch') return siteWatch(site.key);
  if (tab === 'settings') return { settings: await loadSettings(scope), website: siteUrl(site.key), devDb: !!process.env.SEO_DB_URL };
  return { error: 'unknown tab' };
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const siteParam = sp.get('site');
  if (siteParam) {
    const site = siteFor(siteParam);
    const tab = sp.get('tab') || 'opportunities';
    if (!site) return NextResponse.json({ error: 'unknown site' }, { status: 400 });
    try {
      return NextResponse.json({ country: 'py', site: site.key, tab, ...(await siteTabData(site, tab, sp)) });
    } catch (e) {
      if (isMissingTable(e)) return NextResponse.json({ country: 'py', site: site.key, tab, missing: true, error: 'Run migrations/011_seo_pipeline.sql on the PY DB first.' });
      return NextResponse.json({ country: 'py', site: site.key, tab, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
    }
  }
  const cc = ccOf(activeCountry());
  const tab = sp.get('tab') || 'opportunities';
  try {
    return NextResponse.json({ country: cc, tab, ...(await tabData(cc, tab, sp)) });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ country: cc, tab, missing: true, error: 'Run migrations/011_seo_pipeline.sql on this country DB first.' });
    return NextResponse.json({ country: cc, tab, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
