// AI Analyst — the DATA PACK: every source read together for one period (and the one before it),
// day by day, with breakdowns and the anomaly days already found and drilled into by code
// (lib/analyst/math.js). Read-only everywhere: PostHog (HogQL), the country DBs (select only),
// Search Console and Google Ads (read queries). Each section fails on its own ({ error }).
// country = 'py' | 'bo' | 'uy' | 've' | 'sv' | 'all'. Server-only.
import { dbFor } from '../db.js';
import { selectAll } from '../selectAll.js';
import { hogql, posthogConfigured } from '../posthogHogql.js';
import { UKEY, SOURCE_EXPR, GEO_BASE, CONTACT_IN } from '../posthogSql.js';
import { siteClause, SITE_EXPR, IS_FUNNEL } from '../analyticsSite.js';
import { FUNNEL_EVENTS } from '../funnelAnalytics.js';
import { googleSetup, adsSearch, gscQuery, GSC_SITE } from '../googleApi.js';
import { countryInfo } from '../automationAdmin.js';
import {
  TZ, ANALYST_COUNTRIES, analystPeriod, dayList, addDays, fillDays, dimensionTable, compareDimension,
  seriesFor, findAnomalies, drillDown, hourProfile, groupAnomalies, periodSum, changePct, num, r1, sum,
  utcOfLocalMidnight, normPath, normLang,
} from './math.js';

const ADS_COUNTRIES = ['py'];   // the one Google Ads account advertises Paraguay only
// the casa-libre.com umbrella hub (no site_country → it would otherwise count as Paraguay)
export const IS_HUB = `(coalesce(toString(properties.hub_site), '') != '' OR lower(coalesce(properties.$host, '')) IN ('casa-libre.com', 'www.casa-libre.com'))`;
const lit = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const flat = (rows) => (rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));
const errText = (e) => String(e?.message || e).slice(0, 240);

export async function buildAnalystPack(country, { days = 28, start = null, end = null, now = new Date() } = {}) {
  const cc = ANALYST_COUNTRIES.includes(country) ? country : 'all';
  const tz = TZ[cc];
  const P = analystPeriod({ days, start, end }, { tz, now });
  if (P.error) throw new Error(P.error);
  const winDays = dayList(P.windowStart, P.end);
  const curDays = dayList(P.start, P.end);
  const from = utcOfLocalMidnight(P.windowStart, tz);
  const to = utcOfLocalMidnight(addDays(P.end, 1), tz);
  const prevFrom = utcOfLocalMidnight(P.prevStart, tz);
  const curFrom = utcOfLocalMidnight(P.start, tz);
  const RANGE = `timestamp >= toDateTime('${from}') AND timestamp < toDateTime('${to}')`;
  const D = `toString(toDate(toTimeZone(timestamp, '${tz}')))`;
  const countries = cc === 'all' ? ANALYST_COUNTRIES : [cc];

  const pack = {
    country: cc,
    site: cc === 'all' ? 'all country sites' : countryInfo(cc).site,
    timezone: tz,
    period: { start: P.start, end: P.end, days: P.days, endIsToday: P.partialToday },
    previousPeriod: { start: P.prevStart, end: P.prevEnd },
    howToRead: [
      'cur = this period, prev = the previous period of the same length. Visitors = unique people (signed-in by account, others by IP); team traffic (Pakistan) excluded.',
      'Breakdowns (sources, countries, landing pages, languages, devices) count each visitor once per day by their FIRST event that day ("visitor-days"), so their totals are a bit above the unique-visitor count.',
      'Sources: chatgpt/perplexity/gemini/claude/copilot = AI assistants (utm_source=chatgpt.com or their referrer). google = every visit with a Google referrer: organic search AND Google Ads clicks (ads are not utm-tagged) — split them with searchConsole.clicks (organic) and googleAds clicks. whatsapp campaign / email / referral link = our own sends; social = Instagram/Facebook/TikTok/LinkedIn/X.',
      P.partialToday ? `The last day (${P.end}) is today and still incomplete.` : null,
      'Search Console data is final about 2–3 days after the day: its last days can be missing.',
    ].filter(Boolean),
    sections: {},
  };
  const section = async (name, fn) => {
    try { pack.sections[name] = await fn(); } catch (e) { pack.sections[name] = { error: errText(e) }; }
  };

  // ── 1. PostHog: the main country site(s) ──
  let visitorsDaily = null;
  let tables = {};
  let hours = [];
  await section('mainSite', async () => {
    if (!posthogConfigured()) return { error: 'PostHog not configured' };
    const where = `${RANGE} AND ${GEO_BASE}${siteClause(cc === 'all' ? null : cc)} AND NOT ${IS_HUB}`;
    const firsts = (expr, extra = '') => hogql(`WITH f AS (SELECT ${D} AS d, ${UKEY} AS k, ${expr} AS v FROM events WHERE ${where} ${extra} GROUP BY d, k)
      SELECT d, v, count() FROM f GROUP BY d, v ORDER BY d LIMIT 20000`);
    const [daily, uniq, src, geo, landing, lang, device, site, hourRows, referrers, aiUtm] = await Promise.all([
      hogql(`SELECT ${D} AS d, uniqExact(${UKEY}), countIf(event = '$pageview'), uniqExactIf(${UKEY}, event = 'user_signed_up'),
          countIf(event = 'listing_created'), uniqExactIf(${UKEY}, ${CONTACT_IN}), countIf(event = 'property_viewed')
        FROM events WHERE ${where} GROUP BY d ORDER BY d LIMIT 500`),
      hogql(`SELECT uniqExactIf(${UKEY}, timestamp >= toDateTime('${curFrom}')), uniqExactIf(${UKEY}, timestamp >= toDateTime('${prevFrom}') AND timestamp < toDateTime('${curFrom}'))
        FROM events WHERE ${where}`),
      firsts(`argMin(${SOURCE_EXPR}, timestamp)`),
      firsts(`argMin(coalesce(nullIf(properties.$geoip_country_name, ''), 'Unknown'), timestamp)`),
      firsts(`argMin(coalesce(nullIf(properties.$pathname, ''), '/'), timestamp)`, `AND event = '$pageview'`),
      firsts(`argMin(coalesce(toString(properties.$browser_language), ''), timestamp)`),
      firsts(`argMin(coalesce(nullIf(properties.$device_type, ''), 'Unknown'), timestamp)`),
      cc === 'all' ? firsts(`argMin(${SITE_EXPR}, timestamp)`) : Promise.resolve([]),
      hogql(`SELECT ${D} AS d, toHour(toTimeZone(timestamp, '${tz}')) AS h, uniqExact(${UKEY}) FROM events WHERE ${where} GROUP BY d, h ORDER BY d LIMIT 10000`),
      hogql(`SELECT coalesce(nullIf(properties.$referring_domain, ''), '$direct') AS r,
          uniqExactIf(${UKEY}, timestamp >= toDateTime('${curFrom}')), uniqExactIf(${UKEY}, timestamp >= toDateTime('${prevFrom}') AND timestamp < toDateTime('${curFrom}'))
        FROM events WHERE ${where} GROUP BY r ORDER BY 2 DESC LIMIT 20`),
      hogql(`SELECT lower(coalesce(toString(properties.utm_source), '')) AS u, lower(coalesce(toString(properties.utm_medium), '')) AS m,
          uniqExactIf(${UKEY}, timestamp >= toDateTime('${curFrom}')), uniqExactIf(${UKEY}, timestamp >= toDateTime('${prevFrom}') AND timestamp < toDateTime('${curFrom}'))
        FROM events WHERE ${where} AND coalesce(toString(properties.utm_source), '') != '' GROUP BY u, m ORDER BY 3 DESC LIMIT 20`),
    ]);
    const filled = fillDays(flat(daily), P.windowStart, P.end, 6);
    visitorsDaily = new Map([...filled.entries()].map(([d, v]) => [d, v[0]]));
    const norm = (rows, f) => flat(rows).map((r) => [r[0], f(r[1]), r[2]]);
    tables = {
      sources: dimensionTable(norm(src, (x) => x || 'direct'), P),
      countries: dimensionTable(flat(geo), P),
      landingPages: dimensionTable(norm(landing, normPath), P),
      languages: dimensionTable(norm(lang, normLang), P),
      devices: dimensionTable(flat(device), P),
      ...(cc === 'all' ? { sites: dimensionTable(flat(site), P) } : {}),
    };
    hours = flat(hourRows);
    const [u] = flat(uniq);
    const metric = (i) => periodSum(filled, P, i);
    const cmp = Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, compareDimension(t, { top: k === 'landingPages' ? 12 : 10 })]));
    // day-by-day of the top sources and top countries (+ any foreign country that grew a lot)
    const topKeys = (k, n, extra = []) => [...new Set([...cmp[k].top.slice(0, n).map((r) => r.key), ...extra])];
    const risingCountries = cmp.countries.otherRisers.filter((r) => r.diff >= 20).map((r) => r.key);
    const risingSources = cmp.sources.otherRisers.filter((r) => r.diff >= 20).map((r) => r.key);
    return {
      totals: {
        uniqueVisitors: { cur: num(u?.[0]), prev: num(u?.[1]), changePct: changePct(num(u?.[0]), num(u?.[1])) },
        visitorDaysSum: metric(0), pageviews: metric(1), signups: metric(2), listingsCreated: metric(3), sellerContacts: metric(4), propertyViews: metric(5),
      },
      daily: {
        columns: ['date', 'visitors', 'pageviews', 'signups', 'listings', 'contacts', 'propertyViews'],
        rows: winDays.filter((d) => d >= P.prevStart).map((d) => [d, ...filled.get(d)]),
      },
      breakdowns: cmp,
      dailyBySource: { dates: curDays, series: seriesFor(tables.sources, topKeys('sources', 6, risingSources), curDays) },
      dailyByCountry: { dates: curDays, series: seriesFor(tables.countries, topKeys('countries', 6, risingCountries), curDays) },
      ...(cc === 'all' ? { dailyBySite: { dates: curDays, series: seriesFor(tables.sites, topKeys('sites', 6), curDays) } } : {}),
      referringDomains: flat(referrers).map((r) => ({ domain: r[0], cur: num(r[1]), prev: num(r[2]) })),
      utmSourcesRaw: flat(aiUtm).map((r) => ({ utm_source: r[0], utm_medium: r[1] || null, cur: num(r[2]), prev: num(r[3]) })),
      _filled: filled,
    };
  });

  // ── 2. anomaly days (visitors, sign-ups, contacts) + what changed each day ──
  await section('anomalies', async () => {
    const main = pack.sections.mainSite;
    if (!main || main.error) return { error: 'no main-site data' };
    const filled = main._filled;
    const col = (i) => new Map([...filled.entries()].map(([d, v]) => [d, v[i]]));
    const scale = Math.max(1, sum([...visitorsDaily.values()]) / Math.max(1, visitorsDaily.size));
    // today is still running: never an anomaly (it always looks like a drop)
    const last = P.partialToday ? addDays(P.end, -1) : P.end;
    const found = [
      ...findAnomalies(col(0), { from: P.start, to: last, minAbs: Math.max(15, Math.round(scale * 0.4)), metric: 'visitors' }),
      ...findAnomalies(col(2), { from: P.start, to: last, minAbs: 4, metric: 'signups' }),
      ...findAnomalies(col(4), { from: P.start, to: last, minAbs: 5, metric: 'sellerContacts' }),
    ];
    // biggest first (by size of the visitors' jump), at most 6 days drilled into
    const days = groupAnomalies(found)
      .map((g) => ({ ...g, weight: Math.max(...g.metrics.map((m) => Math.abs(m.value - m.baselineAvg7) / Math.max(1, m.baselineAvg7))) }))
      .sort((a, b) => b.weight - a.weight).slice(0, 6)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const g of days) {
      delete g.weight;
      g.whatChanged = Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, drillDown(t, g.date, { top: k === 'landingPages' ? 6 : 5 })]));
      g.busiestHoursVsUsual = hourProfile(hours, g.date, { top: 4 });
    }
    return {
      rule: 'A day is an anomaly when its value is ≥2× (spike) or ≤½ (drop) the average of the 7 days before it, or 3+ standard deviations away, and the difference is big enough to matter. whatChanged = per breakdown, that day vs the average of the 7 days before (diff = the extra visitor-days).',
      days,
    };
  });
  if (pack.sections.mainSite) delete pack.sections.mainSite._filled;

  // ── 3. funnel sites and the casa-libre.com hub ──
  await section('funnelSites', async () => {
    if (!posthogConfigured()) return { error: 'PostHog not configured' };
    const cf = cc === 'all' ? '' : ` AND lower(toString(properties.funnel_country)) = ${lit(cc)}`;
    const where = `${RANGE} AND event IN (${FUNNEL_EVENTS.map((e) => `'${e}'`).join(', ')}) AND ${IS_FUNNEL} AND ${GEO_BASE}${cf}`;
    const [daily, sites, sources] = await Promise.all([
      hogql(`SELECT ${D} AS d, uniqExact(${UKEY}), countIf(event = 'generate_lead'), countIf(event = 'cl_click') FROM events WHERE ${where} GROUP BY d ORDER BY d LIMIT 500`),
      hogql(`SELECT toString(properties.funnel_site) AS s, uniqExactIf(${UKEY}, timestamp >= toDateTime('${curFrom}')), uniqExactIf(${UKEY}, timestamp < toDateTime('${curFrom}') AND timestamp >= toDateTime('${prevFrom}')),
          countIf(event = 'generate_lead' AND timestamp >= toDateTime('${curFrom}')), countIf(event = 'cl_click' AND timestamp >= toDateTime('${curFrom}'))
        FROM events WHERE ${where} GROUP BY s ORDER BY 2 DESC LIMIT 10`),
      hogql(`SELECT ${SOURCE_EXPR} AS src, uniqExact(${UKEY}) FROM events WHERE ${where} AND timestamp >= toDateTime('${curFrom}') GROUP BY src ORDER BY 2 DESC LIMIT 8`),
    ]);
    const f = fillDays(flat(daily), P.windowStart, P.end, 3);
    return {
      visitorDays: periodSum(f, P, 0), leadFormsSent: periodSum(f, P, 1), clicksToCasaLibre: periodSum(f, P, 2),
      dailyVisitors: curDays.map((d) => f.get(d)[0]),
      bySite: flat(sites).map((r) => ({ site: r[0] || '—', visitorsCur: num(r[1]), visitorsPrev: num(r[2]), leadsCur: num(r[3]), clicksToCasaLibreCur: num(r[4]) })),
      sourcesCur: flat(sources).map((r) => ({ source: r[0] || 'direct', visitors: num(r[1]) })),
    };
  });

  await section('hub', async () => {
    if (!posthogConfigured()) return { error: 'PostHog not configured' };
    const where = `${RANGE} AND ${GEO_BASE} AND ${IS_HUB}`;
    const [daily, geo, sources] = await Promise.all([
      hogql(`SELECT ${D} AS d, uniqExact(${UKEY}), countIf(event = '$pageview') FROM events WHERE ${where} GROUP BY d ORDER BY d LIMIT 500`),
      hogql(`SELECT coalesce(nullIf(properties.$geoip_country_name, ''), 'Unknown') AS c, uniqExact(${UKEY}) FROM events WHERE ${where} AND timestamp >= toDateTime('${curFrom}') GROUP BY c ORDER BY 2 DESC LIMIT 8`),
      hogql(`SELECT ${SOURCE_EXPR} AS src, uniqExact(${UKEY}) FROM events WHERE ${where} AND timestamp >= toDateTime('${curFrom}') GROUP BY src ORDER BY 2 DESC LIMIT 8`),
    ]);
    const f = fillDays(flat(daily), P.windowStart, P.end, 2);
    return {
      note: 'casa-libre.com, the umbrella page for all countries (not counted in the country sites above).',
      visitorDays: periodSum(f, P, 0), pageviews: periodSum(f, P, 1),
      dailyVisitors: curDays.map((d) => f.get(d)[0]),
      countriesCur: flat(geo).map((r) => ({ country: r[0], visitors: num(r[1]) })),
      sourcesCur: flat(sources).map((r) => ({ source: r[0] || 'direct', visitors: num(r[1]) })),
    };
  });

  // ── 4. our own sends: WhatsApp / email per day (counts only) + campaign link taps ──
  await section('ourSends', async () => {
    const since = `${P.prevStart}T00:00:00Z`;
    const perCountry = await Promise.all(countries.map(async (c) => {
      try {
        const rows = await selectAll(dbFor(c), 'email_log', `select=id,automation_id,channel,status,created_at&created_at=gte.${encodeURIComponent(since)}&status=neq.test&order=id.asc`);
        return { c, rows };
      } catch (e) { return { c, error: errText(e) }; }
    }));
    const kindOf = (r) => (r.automation_id === 'wa_campaign' ? 'whatsappCampaign'
      : String(r.automation_id || '').startsWith('inbox_ai') ? 'inboxAssistantReply'
        : r.channel === 'whatsapp' ? 'whatsappAutomation' : 'emailAutomation');
    const KINDS = ['whatsappCampaign', 'whatsappAutomation', 'emailAutomation', 'inboxAssistantReply'];
    const tab = new Map();
    for (const { rows = [] } of perCountry) {
      for (const r of rows) {
        if (r.channel === 'wa_campaign') continue;   // the campaign's header row, not a message
        const d = String(r.created_at || '').slice(0, 10);
        const k = kindOf(r);
        if (!tab.has(k)) tab.set(k, new Map());
        tab.get(k).set(d, (tab.get(k).get(d) || 0) + 1);
      }
    }
    const out = { note: 'Messages we sent (UTC days). whatsappCampaign = marketing batches to leads; automations = welcome/reminder/etc. Counts only.', errors: perCountry.filter((x) => x.error).map((x) => `${x.c}: ${x.error}`) };
    for (const k of KINDS) {
      const m = tab.get(k) || new Map();
      const cur = sum(curDays.map((d) => m.get(d)));
      const prev = sum(dayList(P.prevStart, P.prevEnd).map((d) => m.get(d)));
      out[k] = { cur, prev, changePct: changePct(cur, prev), busiestDays: [...m.entries()].filter(([d]) => d >= P.start && d <= P.end).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([date, n]) => ({ date, sent: n })) };
    }
    if (posthogConfigured()) {
      const taps = await hogql(`SELECT ${D} AS d, count(DISTINCT distinct_id) FROM events WHERE event = 'link_click' AND ${RANGE} GROUP BY d ORDER BY d LIMIT 500`).catch(() => null);
      if (taps) {
        const f = fillDays(flat(taps), P.windowStart, P.end, 1);
        out.trackedLinkTaps = { ...periodSum(f, P, 0), note: 'Taps on our tracked /r/ links (WhatsApp campaign buttons, formula templates), all countries.' };
      }
    }
    return out;
  });

  // ── 5. funnel leads (funnel_leads table, read-only) ──
  await section('funnelLeads', async () => {
    const per = await Promise.all(countries.map(async (c) => {
      try {
        const rows = await dbFor(c).select('funnel_leads', `select=site,status,created_at&created_at=gte.${encodeURIComponent(`${P.prevStart}T00:00:00Z`)}&order=created_at.desc&limit=5000`);
        return { c, rows };
      } catch (e) { return { c, error: errText(e) }; }
    }));
    const inCur = (r) => String(r.created_at).slice(0, 10) >= P.start;
    const all = per.flatMap((x) => (x.rows || []).map((r) => ({ ...r, country: x.c })));
    const by = (rows, k) => rows.reduce((m, r) => ({ ...m, [r[k] || 'new']: (m[r[k] || 'new'] || 0) + 1 }), {});
    const cur = all.filter(inCur);
    return {
      cur: cur.length, prev: all.length - cur.length,
      bySiteCur: by(cur, 'site'), byStatusCur: by(cur, 'status'),
      ...(cc === 'all' ? { byCountryCur: by(cur, 'country') } : {}),
      unavailable: per.filter((x) => x.error).map((x) => x.c),
    };
  });

  // ── 6. Search Console (organic Google) ──
  const gConnected = (() => { const s = googleSetup(); return s.refreshToken && s.clientId && s.clientSecret; })();
  await section('searchConsole', async () => {
    if (!gConnected) return { error: 'Google not connected' };
    const per = await Promise.all(countries.map(async (c) => {
      const site = GSC_SITE[c];
      const q = (body) => gscQuery(site, { type: 'web', ...body }).then((j) => j.rows || []);
      try {
        const [daily, queries, queriesPrev, pages, geo, geoPrev] = await Promise.all([
          q({ startDate: P.prevStart, endDate: P.end, dimensions: ['date'], rowLimit: 500 }),
          q({ startDate: P.start, endDate: P.end, dimensions: ['query'], rowLimit: 15 }),
          q({ startDate: P.prevStart, endDate: P.prevEnd, dimensions: ['query'], rowLimit: 15 }),
          q({ startDate: P.start, endDate: P.end, dimensions: ['page'], rowLimit: 10 }),
          q({ startDate: P.start, endDate: P.end, dimensions: ['country'], rowLimit: 8 }),
          q({ startDate: P.prevStart, endDate: P.prevEnd, dimensions: ['country'], rowLimit: 8 }),
        ]);
        return { c, daily, queries, queriesPrev, pages, geo, geoPrev };
      } catch (e) { return { c, error: errText(e) }; }
    }));
    const ok = per.filter((x) => !x.error);
    const byDay = new Map();
    for (const x of ok) for (const r of x.daily) {
      const d = r.keys[0];
      const v = byDay.get(d) || [0, 0];
      byDay.set(d, [v[0] + num(r.clicks), v[1] + num(r.impressions)]);
    }
    const f = fillDays([...byDay.entries()].map(([d, v]) => [d, ...v]), P.prevStart, P.end, 2);
    const lastWithData = [...byDay.keys()].sort().pop() || null;
    const row = (r) => ({ key: r.keys[0], clicks: num(r.clicks), impressions: num(r.impressions), position: r1(num(r.position)) });
    const merge = (k) => ok.flatMap((x) => x[k].map(row)).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    return {
      lastDayWithData: lastWithData,
      clicks: periodSum(f, P, 0), impressions: periodSum(f, P, 1),
      dailyClicks: curDays.map((d) => f.get(d)[0]), dailyImpressions: curDays.map((d) => f.get(d)[1]),
      topQueriesCur: merge('queries').slice(0, 15), topQueriesPrev: merge('queriesPrev').slice(0, 10),
      topPagesCur: merge('pages').slice(0, 10).map((p) => ({ ...p, key: p.key.replace(/^https?:\/\/[^/]+/, '') || '/' })),
      searcherCountriesCur: merge('geo').slice(0, 8), searcherCountriesPrev: merge('geoPrev').slice(0, 8),
      unavailable: per.filter((x) => x.error).map((x) => `${x.c}: ${x.error}`),
    };
  });

  // ── 7. Google Ads: daily per campaign + change history ──
  await section('googleAds', async () => {
    if (!countries.some((c) => ADS_COUNTRIES.includes(c))) return { skipped: 'No Google Ads for this country (the account advertises Paraguay only).' };
    const s = googleSetup();
    if (!(s.refreshToken && s.clientId && s.clientSecret && s.developerToken && s.customerId)) return { error: 'Google Ads not connected' };
    const rows = (await adsSearch(`SELECT segments.date, campaign.name, campaign.status, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
      FROM campaign WHERE segments.date BETWEEN '${P.prevStart}' AND '${P.end}'`)).results || [];
    const camps = new Map();
    const byDay = new Map();
    for (const r of rows) {
      const d = r.segments?.date; const name = r.campaign?.name || '—';
      const m = r.metrics || {};
      const v = { clicks: num(m.clicks), impressions: num(m.impressions), cost: num(m.costMicros) / 1e6, conversions: num(m.conversions) };
      if (!camps.has(name)) camps.set(name, { name, status: r.campaign?.status, cur: { clicks: 0, impressions: 0, cost: 0, conversions: 0 }, prev: { clicks: 0, impressions: 0, cost: 0, conversions: 0 }, daily: new Map() });
      const c = camps.get(name);
      const bucket = d >= P.start ? c.cur : c.prev;
      for (const k of Object.keys(v)) bucket[k] += v[k];
      if (d >= P.start) c.daily.set(d, (c.daily.get(d) || 0) + v.clicks);
      const t = byDay.get(d) || [0, 0, 0];
      byDay.set(d, [t[0] + v.clicks, t[1] + v.impressions, t[2] + v.cost]);
    }
    const f = fillDays([...byDay.entries()].map(([d, v]) => [d, ...v]), P.prevStart, P.end, 3);
    const round = (o) => ({ clicks: o.clicks, impressions: o.impressions, cost: Math.round(o.cost * 100) / 100, conversions: Math.round(o.conversions * 10) / 10 });
    const curClicks = curDays.map((d) => f.get(d)[0]);
    const best = curDays.map((d, i) => [d, curClicks[i]]).sort((a, b) => b[1] - a[1])[0] || null;
    // change history: Google keeps it 30 days
    const chFrom = [P.start, addDays(P.today, -29)].sort()[1];
    let changes = [];
    let changesNote = null;
    try {
      const ch = (await adsSearch(`SELECT change_event.change_date_time, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, change_event.client_type, campaign.name
        FROM change_event WHERE change_event.change_date_time >= '${chFrom} 00:00:00' AND change_event.change_date_time <= '${P.end} 23:59:59' ORDER BY change_event.change_date_time DESC LIMIT 200`)).results || [];
      // the same edit on many keywords / ads → one line per (day, campaign, type, operation, fields)
      const g = new Map();
      for (const r of ch) {
        const e = r.changeEvent || {};
        const key = JSON.stringify([String(e.changeDateTime || '').slice(0, 10), r.campaign?.name || '(account)', e.changeResourceType, e.resourceChangeOperation, String(e.changedFields || '').slice(0, 120)]);
        g.set(key, (g.get(key) || 0) + 1);
      }
      changes = [...g.entries()].map(([k, n]) => { const [date, campaign, resource, operation, fields] = JSON.parse(k); return { date, campaign, resource, operation, fields, count: n }; }).slice(0, 40);
      if (chFrom > P.start) changesNote = `Google keeps change history 30 days: changes before ${chFrom} are not available.`;
    } catch (e) { changesNote = `change history unavailable: ${errText(e)}`; }
    return {
      total: { cur: round({ clicks: periodSum(f, P, 0).cur, impressions: periodSum(f, P, 1).cur, cost: periodSum(f, P, 2).cur, conversions: sum([...camps.values()].map((c) => c.cur.conversions)) }),
        prev: round({ clicks: periodSum(f, P, 0).prev, impressions: periodSum(f, P, 1).prev, cost: periodSum(f, P, 2).prev, conversions: sum([...camps.values()].map((c) => c.prev.conversions)) }) },
      dailyClicks: curClicks,
      dailyCost: curDays.map((d) => Math.round(f.get(d)[2] * 100) / 100),
      bestDay: best ? { date: best[0], clicks: best[1] } : null,
      campaigns: [...camps.values()].sort((a, b) => b.cur.cost - a.cur.cost).slice(0, 10).map((c) => ({ name: c.name, status: c.status, cur: round(c.cur), prev: round(c.prev), dailyClicks: curDays.map((d) => c.daily.get(d) || 0) })),
      changeHistory: changes, changeHistoryNote: changesNote,
      note: 'Google Ads conversions include soft goals (page views); judge by our own sign-ups / contacts.',
    };
  });

  pack.dates = curDays;
  pack.keyNumbers = keyNumbers(pack);
  return pack;
}

// The tiles on the page and the "Data used" panel: a few headline numbers, cur vs prev.
export function keyNumbers(pack) {
  const s = pack.sections || {};
  const t = s.mainSite?.totals || {};
  const row = (label, o, unit = '') => (o && o.cur != null ? { label, cur: o.cur, prev: o.prev, changePct: o.changePct ?? changePct(o.cur, o.prev), unit } : null);
  const ai = (s.mainSite?.breakdowns?.sources?.top || []).concat(s.mainSite?.breakdowns?.sources?.otherRisers || [])
    .filter((r) => ['chatgpt', 'perplexity', 'gemini', 'claude', 'copilot', 'other ai'].includes(r.key));
  const aiTot = ai.length ? { cur: sum(ai.map((r) => r.cur)), prev: sum(ai.map((r) => r.prev)) } : null;
  return [
    row('Unique visitors', t.uniqueVisitors),
    row('Sign-ups', t.signups),
    row('Listings created', t.listingsCreated),
    row('Seller contacts', t.sellerContacts),
    row('AI-assistant visitor-days', aiTot),
    row('Google organic clicks (Search Console)', s.searchConsole?.clicks),
    row('Google Ads clicks', s.googleAds?.total ? { cur: s.googleAds.total.cur.clicks, prev: s.googleAds.total.prev.clicks } : null),
    row('Google Ads spend', s.googleAds?.total ? { cur: s.googleAds.total.cur.cost, prev: s.googleAds.total.prev.cost } : null, 'US$'),
    row('WhatsApp campaign messages', s.ourSends?.whatsappCampaign),
    row('Funnel-site visitor-days', s.funnelSites?.visitorDays),
    row('Funnel leads', s.funnelLeads?.cur != null ? { cur: s.funnelLeads.cur, prev: s.funnelLeads.prev } : null),
    row('Hub visitor-days', s.hub?.visitorDays),
  ].filter(Boolean);
}
