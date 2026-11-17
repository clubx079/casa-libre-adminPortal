// The SEO pipeline runners (cron /api/cron/seo, scripts/seo-run.mjs, the admin's "Run now" buttons).
//   runCollect(cc, only)  stage 1
//   runDecide(cc)         stages 2–3 → seo_opportunities
//   runImprove(cc)        stage 8 (weekly) → applies what Settings allow, the rest becomes opportunities
//   watch(cc)             stage 7: performance per page (Search Console + Ads + PostHog)
//   seoSummary(cc)        a short summary for the AI Analyst's weekly data pack
// Server-only.
import 'server-only';
import { seoDb, getOverrides, loadSettings } from './store.js';
import { collectAll } from './collect.js';
import { loadInventory, placesFrom } from './data.js';
import { decide } from './decide.js';
import { improveActions } from './improve.js';
import { matchTerm } from './matcher.js';
import { parsePath } from './matrix.js';
import { pageState } from './inventory.js';
import { citiesFor } from './places.js';
import { setTitle, retireVariant, addLinks, createDraft } from './actions.js';
import { gscQuery } from '../googleApi';
import { siteFor as gscSiteFor } from '../searchConsole';
import { hogql, posthogConfigured } from '../posthogHogql';
import { siteClause } from '../analyticsSite';
import { GEO_BASE, CONTACT_IN } from '../posthogSql';

const enc = encodeURIComponent;
const day = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => day(new Date(Date.now() - n * 86400000));
const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);

export async function runCollect(cc, only = null) {
  const settings = await loadSettings(cc);
  return collectAll(cc, settings, only);
}

async function latestSignals(cc) {
  const rows = [];
  for (let off = 0; off < 50000; off += 1000) {
    const page = await seoDb(cc).select('seo_signals', `select=source,term,page,date,metrics&country=eq.${cc}&date=gte.${daysAgo(7)}&order=id.asc&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

const DECIDE_TYPES = ['create_variant', 'strengthen_page', 'write_guide', 'trend_post', 'lower_bid_suggestion'];

export async function runDecide(cc) {
  const settings = await loadSettings(cc);
  if (!settings.decide) return { skipped: 'Decide is switched off in Settings' };
  const [signals, inventory, overridesByPath, trends, drafts] = await Promise.all([
    latestSignals(cc),
    loadInventory(cc, { fresh: true }),
    getOverrides(cc),
    seoDb(cc).select('seo_trends', `select=geo,title,traffic,traffic_label,news,topic,pub_date,seen_at&geo=eq.${cc.toUpperCase()}&seen_at=gte.${enc(new Date(Date.now() - settings.thresholds.trendHours * 3600000).toISOString())}&limit=2000`),
    seoDb(cc).select('seo_drafts', `select=slug&country=eq.${cc}&limit=5000`),
  ]);
  const opps = decide({ signals, inventory, overridesByPath, places: placesFrom(cc, inventory), trends, draftSlugs: drafts.map((d) => d.slug), settings });
  const at = nowIso();
  // upsert by key: score / evidence refresh; a dismissed or applied row keeps its status
  const rows = opps.map((o) => ({ country: cc, key: o.key, type: o.type, term: o.term, url: o.url, parsed: o.parsed, score: o.score, evidence: o.evidence, updated_at: at }));
  for (let i = 0; i < rows.length; i += 300) await seoDb(cc).insert('seo_opportunities', rows.slice(i, i + 300), { upsert: true, onConflict: 'country,key', returning: 'minimal' });
  // open opportunities this run no longer finds (demand gone, page now live, trend over) are removed
  const keep = new Set(opps.map((o) => o.key));
  const open = await seoDb(cc).select('seo_opportunities', `select=id,key,type,evidence&country=eq.${cc}&status=eq.open&limit=5000`);
  const stale = open.filter((o) => DECIDE_TYPES.includes(o.type) && !o.evidence?.reason && !keep.has(o.key));
  for (const o of stale) await seoDb(cc).remove('seo_opportunities', `id=eq.${o.id}`);
  const byType = opps.reduce((a, o) => ({ ...a, [o.type]: (a[o.type] || 0) + 1 }), {});
  return { signals: signals.length, opportunities: opps.length, byType, removedStale: stale.length };
}

// Search Console page-level numbers for a window (only our matrix + guide pages).
async function gscPages(cc, start, end, dims = ['page']) {
  const site = await gscSiteFor(cc);
  if (!site) return null;
  const j = await gscQuery(site.property, { startDate: start, endDate: end, type: 'web', dimensions: dims, rowLimit: 5000 });
  return (j.rows || []).map((r) => ({ keys: r.keys.map((k, i) => (dims[i] === 'page' ? (() => { try { return new URL(k).pathname.replace(/\/+$/, '') || '/'; } catch { return k; } })() : k)), clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 }));
}

export async function runImprove(cc, { by = 'weekly loop' } = {}) {
  const settings = await loadSettings(cc);
  if (!settings.improve.enabled) return { skipped: 'Improve is switched off in Settings' };
  const t = settings.thresholds;
  const end = daysAgo(2);
  const cur = await gscPages(cc, daysAgo(8), end);
  if (!cur) return { skipped: 'no Search Console access' };
  const prev = await gscPages(cc, daysAgo(15), daysAgo(9));
  const pq = await gscPages(cc, daysAgo(29), end, ['page', 'query']);
  const relevant = (p) => !!parsePath(p) || p.startsWith('/guias/');
  const topQuery = new Map();
  for (const r of pq) { const [p, q] = r.keys; if (!topQuery.has(p) || topQuery.get(p).impressions < r.impressions) topQuery.set(p, { q, impressions: r.impressions }); }
  const prevBy = new Map(prev.map((r) => [r.keys[0], r]));
  // CTR is judged on 4 weeks (one week is too few impressions for most pages)
  const month = await gscPages(cc, daysAgo(29), end);
  const pages = month.filter((r) => relevant(r.keys[0])).map((r) => {
    const w = cur.find((x) => x.keys[0] === r.keys[0]);
    const pv = prevBy.get(r.keys[0]);
    return { page: r.keys[0], cur: { impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: w?.position || r.position }, prev: pv ? { position: pv.position } : null, topQuery: topQuery.get(r.keys[0])?.q || null };
  });
  const overridesByPath = await getOverrides(cc);
  // enabled variants: when were they switched on, and their impressions over the zero-traffic window
  const windowRows = await gscPages(cc, daysAgo(t.zeroTrafficWeeks * 7 + 2), end);
  const impBy = new Map(windowRows.map((r) => [r.keys[0], r.impressions]));
  const enables = await seoDb(cc).select('seo_changes', `select=path,after,created_at&country=eq.${cc}&action=eq.enable_variant&reverted_at=is.null&order=created_at.desc&limit=2000`);
  const variants = [];
  for (const [base, o] of overridesByPath) for (const v of o.enabled_variants || []) {
    const path = `${base}/${v}`;
    const en = enables.find((c) => c.path === base && (c.after?.enabled_variants || []).includes(v));
    variants.push({ path, enabledAt: en?.created_at || null, impressions: impBy.get(path) || 0 });
  }
  const actions = improveActions({ pages, variants, overridesByPath, settings, cities: citiesFor(cc) });
  const done = [];
  const proposed = [];
  for (const a of actions) {
    try {
      if (a.type === 'new_title' && settings.improve.autoTitles && a.allowed) { await setTitle(cc, a.url, a.title, { by, reason: a.reason }); done.push(a); continue; }
      if (a.type === 'retire_variant' && settings.improve.autoRetire) { await retireVariant(cc, a.url, { by, reason: a.reason }); done.push(a); continue; }
      if (a.type === 'strengthen_page' && settings.improve.autoLinks) { await addLinks(cc, a.url, { by, reason: a.reason }); done.push(a); continue; }
    } catch (e) { a.error = errText(e); }
    proposed.push(a);
  }
  const at = nowIso();
  const rows = proposed.map((a) => ({ country: cc, key: `${a.type}|${a.url}`, type: a.type, term: a.term, url: a.url, parsed: a.title ? { title: a.title } : {},
    score: a.type === 'new_title' ? 50 : a.type === 'retire_variant' ? 20 : 30, evidence: { reason: a.reason, title: a.title || null, nextAt: a.nextAt || null, error: a.error || null }, updated_at: at }));
  if (rows.length) await seoDb(cc).insert('seo_opportunities', rows, { upsert: true, onConflict: 'country,key', returning: 'minimal' });
  // last week's proposals this run no longer makes are removed
  const keep = new Set(rows.map((r) => r.key));
  const old = await seoDb(cc).select('seo_opportunities', `select=id,key,evidence&country=eq.${cc}&status=eq.open&type=in.(new_title,strengthen_page,retire_variant)&limit=2000`);
  for (const o of old) if (o.evidence?.reason && !keep.has(o.key)) await seoDb(cc).remove('seo_opportunities', `id=eq.${o.id}`);
  // optional: draft the top guide/trend opportunities automatically (off by default — Claude costs money)
  return { pagesChecked: pages.length, applied: done.map((a) => `${a.type} ${a.url}`), proposed: proposed.length };
}

// Stage 7 — Watch: one row per page we built or touched: Google (28 days), Ads demand mapped to the
// page, PostHog visits + contacts of the sessions that landed on it (28 days).
export async function watch(cc) {
  const [signals, inv, overrides] = await Promise.all([latestSignals(cc), loadInventory(cc), getOverrides(cc)]);
  const places = placesFrom(cc, inv);
  const latest = {};
  for (const s of signals) if (!latest[s.source] || s.date > latest[s.source]) latest[s.source] = s.date;
  const pages = new Map();
  const get = (path) => { let r = pages.get(path); if (!r) { r = { path, gsc: { clicks: 0, impressions: 0, posSum: 0, topQuery: null, topImp: 0 }, ads: { clicks: 0, conversions: 0, cost: 0, terms: 0 }, site: { searches: 0 }, ph: null }; pages.set(path, r); } return r; };
  for (const s of signals) {
    if (s.date !== latest[s.source]) continue;
    const m = s.metrics || {};
    if (s.source === 'gsc') {
      const r = get(s.page);
      r.gsc.clicks += m.clicks || 0; r.gsc.impressions += m.impressions || 0; r.gsc.posSum += (m.position || 0) * (m.impressions || 0);
      if ((m.impressions || 0) > r.gsc.topImp) { r.gsc.topImp = m.impressions; r.gsc.topQuery = s.term; }
    } else {
      const url = matchTerm(s.term, places).url;
      if (!url) continue;
      const r = get(url);
      if (s.source === 'ads') { r.ads.clicks += m.clicks || 0; r.ads.conversions += m.conversions || 0; r.ads.cost += m.cost || 0; r.ads.terms += 1; }
      else r.site.searches += m.searches || 0;
    }
  }
  let phNote = null;
  if (posthogConfigured()) {
    try {
      const rows = await hogql(`SELECT session.$entry_pathname AS p, countIf(event = '$pageview') AS views, countIf(${CONTACT_IN}) AS contacts, uniq(properties.$session_id) AS sessions
        FROM events WHERE timestamp > now() - INTERVAL 28 DAY AND ${GEO_BASE}${siteClause(cc)}
          AND (session.$entry_pathname LIKE '/venta/%' OR session.$entry_pathname LIKE '/alquiler/%' OR session.$entry_pathname LIKE '/guias/%')
        GROUP BY p ORDER BY sessions DESC LIMIT 500`);
      for (const r of rows) { const [p, views, contacts, sessions] = Array.isArray(r) ? r : Object.values(r); const k = String(p || '').replace(/\/+$/, ''); if (!k) continue; get(k).ph = { views: Number(views) || 0, contacts: Number(contacts) || 0, sessions: Number(sessions) || 0 }; }
    } catch (e) { phNote = `PostHog: ${errText(e)}`; }
  }
  const out = [...pages.values()].filter((r) => parsePath(r.path) || r.path.startsWith('/guias/')).map((r) => {
    const st = parsePath(r.path) ? pageState(r.path, inv, overrides) : null;
    const ov = overrides.get(r.path);
    return { path: r.path, listings: st?.count ?? null, indexable: st?.indexable ?? null, exists: st?.exists ?? null, overridden: !!(ov?.title), gsc: { clicks: r.gsc.clicks, impressions: r.gsc.impressions, ctr: r.gsc.impressions ? r.gsc.clicks / r.gsc.impressions : 0, position: r.gsc.impressions ? Math.round((r.gsc.posSum / r.gsc.impressions) * 10) / 10 : null, topQuery: r.gsc.topQuery }, ads: { ...r.ads, cost: Math.round(r.ads.cost * 100) / 100 }, site: r.site, posthog: r.ph };
  }).sort((a, b) => (b.gsc.impressions + b.ads.clicks * 20) - (a.gsc.impressions + a.ads.clicks * 20));
  return { pages: out.slice(0, 200), note: phNote };
}

// For the AI Analyst's data pack: what the pipeline sees and did this week.
export async function seoSummary(cc) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [open, changes, drafts] = await Promise.all([
    seoDb(cc).select('seo_opportunities', `select=type,term,url,score&country=eq.${cc}&status=eq.open&order=score.desc&limit=200`),
    seoDb(cc).select('seo_changes', `select=action,path,reason,created_at,reverted_at&country=eq.${cc}&created_at=gte.${enc(since)}&order=created_at.desc&limit=50`),
    seoDb(cc).select('seo_drafts', `select=status,h1&country=eq.${cc}&limit=500`),
  ]);
  return {
    openOpportunities: open.length,
    byType: open.reduce((a, o) => ({ ...a, [o.type]: (a[o.type] || 0) + 1 }), {}),
    top: open.slice(0, 5).map((o) => ({ type: o.type, term: o.term, url: o.url, score: Number(o.score) })),
    changesLast7Days: changes.map((c) => ({ action: c.action, path: c.path, reason: c.reason, at: c.created_at, reverted: !!c.reverted_at })),
    drafts: { waitingApproval: drafts.filter((d) => d.status === 'draft').length, published: drafts.filter((d) => d.status === 'approved').length },
  };
}

// Draft the top N guide / trend opportunities (used when drafts.auto is wanted; not on by default).
export async function autoDraft(cc, n = 2) {
  const opps = await seoDb(cc).select('seo_opportunities', `select=*&country=eq.${cc}&status=eq.open&type=in.(write_guide,trend_post)&order=score.desc&limit=${n}`);
  const out = [];
  for (const o of opps) { try { out.push(await createDraft(cc, o, { by: 'pipeline' })); } catch (e) { out.push({ error: errText(e) }); } }
  return out;
}

