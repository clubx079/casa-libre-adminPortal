// Marketing reports — pure maths for the Marketing page (no fetching here; the API
// route app/api/marketing/report does the Google + database calls and passes the raw
// rows in). Google Ads money comes in micros (1,000,000 = 1 unit of the account
// currency, US$ for Casa Libre).

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const div = (a, b) => (b > 0 ? a / b : null);

// The report period: the last `days` days up to today (dates as YYYY-MM-DD, UTC).
export function rangeFor(days = 30, now = new Date()) {
  const d = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (d - 1) * 86400000);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { days: d, start: iso(start), end: iso(end), startIso: `${iso(start)}T00:00:00Z`, endIso: `${iso(end)}T23:59:59Z` };
}

// Every date of the range, so a chart has a bar for days with nothing too.
export function daysOf({ start, end }) {
  const out = [];
  for (let t = Date.parse(`${start}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const adsMetrics = (m = {}) => {
  const cost = n(m.costMicros) / 1e6, clicks = n(m.clicks), impressions = n(m.impressions), conversions = n(m.conversions);
  return {
    cost: r2(cost), clicks, impressions, conversions: r2(conversions),
    ctr: div(clicks, impressions) == null ? null : r2(div(clicks, impressions) * 100),
    cpc: div(cost, clicks) == null ? null : r2(div(cost, clicks)),
    costPerConversion: div(cost, conversions) == null ? null : r2(div(cost, conversions)),
  };
};

// Google Ads search() results → the page's Ads section.
export function adsReport({ campaigns = [], daily = [], keywords = [], terms = [], actions = [] }, range) {
  const camp = campaigns.map((x) => ({ id: x.campaign?.id, name: x.campaign?.name || '—', status: x.campaign?.status || '', ...adsMetrics(x.metrics) }))
    .filter((c) => c.impressions > 0 || c.status === 'ENABLED')
    .sort((a, b) => b.cost - a.cost);
  const total = adsMetrics(campaigns.reduce((acc, x) => {
    for (const k of ['costMicros', 'clicks', 'impressions', 'conversions']) acc[k] = n(acc[k]) + n(x.metrics?.[k]);
    return acc;
  }, {}));
  const byDay = new Map(daily.map((x) => [x.segments?.date, x.metrics || {}]));
  const series = daysOf(range).map((d) => ({ key: d, cost: r2(n(byDay.get(d)?.costMicros) / 1e6), clicks: n(byDay.get(d)?.clicks), conversions: r2(n(byDay.get(d)?.conversions)) }));
  const kw = keywords.map((x) => ({ text: x.adGroupCriterion?.keyword?.text || '—', match: String(x.adGroupCriterion?.keyword?.matchType || '').toLowerCase(), ...adsMetrics(x.metrics) }));
  const st = terms.map((x) => ({ text: x.searchTermView?.searchTerm || '—', ...adsMetrics(x.metrics) }));
  const conv = new Map();
  for (const x of actions) {
    const k = x.segments?.conversionActionName || 'Other';
    conv.set(k, r2(n(conv.get(k)) + n(x.metrics?.conversions)));
  }
  // "Page view" style goals inflate Google's conversion count — keep the real actions
  // (WhatsApp, call, copy number, sign-up, publish…) apart.
  const convList = [...conv.entries()].map(([name, count]) => ({ name, count, soft: /page ?view|session|engaged|scroll/i.test(name) })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  const real = r2(convList.filter((x) => !x.soft).reduce((s, x) => s + x.count, 0));
  total.realConversions = real;
  total.costPerRealConversion = real > 0 ? r2(total.cost / real) : null;
  return {
    total, campaigns: camp, series, keywords: kw, searchTerms: st,
    conversionActions: convList,
  };
}

// GA4 runReport() responses → the visitors section.
const rowsOf = (rep) => (rep?.rows || []).map((r) => ({ d: (r.dimensionValues || []).map((v) => v.value), m: (r.metricValues || []).map((v) => n(v.value)) }));
export function ga4Section({ totals, channels, daily, pages, events }, range) {
  const t = rowsOf(totals)[0]?.m || [0, 0, 0];
  const byDay = new Map(rowsOf(daily).map((r) => [`${r.d[0].slice(0, 4)}-${r.d[0].slice(4, 6)}-${r.d[0].slice(6, 8)}`, r.m]));
  return {
    total: { users: t[0], newUsers: t[1], sessions: t[2] },
    channels: rowsOf(channels).map((r) => ({ name: r.d[0] || '(other)', sessions: r.m[0], users: r.m[1] })).sort((a, b) => b.sessions - a.sessions),
    series: daysOf(range).map((d) => ({ key: d, users: byDay.get(d)?.[0] || 0, sessions: byDay.get(d)?.[1] || 0 })),
    pages: rowsOf(pages).map((r) => ({ path: r.d[0], views: r.m[0], users: r.m[1] })),
    events: rowsOf(events).map((r) => ({ name: r.d[0], count: r.m[0] })),
  };
}

// Search Console query() responses → the Google search section.
export function gscSection({ totals, queries, pages }) {
  const t = totals?.rows?.[0] || {};
  const row = (x) => ({ key: x.keys?.[0], clicks: n(x.clicks), impressions: n(x.impressions), ctr: r2(n(x.ctr) * 100), position: r2(n(x.position)) });
  return {
    total: { clicks: n(t.clicks), impressions: n(t.impressions), ctr: r2(n(t.ctr) * 100), position: r2(n(t.position)) },
    queries: (queries?.rows || []).map(row),
    pages: (pages?.rows || []).map(row),
  };
}

// What the money bought on our side: sign-ups, owner listings, buyer contacts.
// CAC (customer acquisition cost) = ad spend ÷ VERIFIED sign-ups in the same period.
// Blended: the spend is the whole ad account, sign-ups come from every channel.
export function outcomes({ signups = 0, verifiedSignups = 0, listings = 0, contacts = 0 }, adsTotal) {
  const cost = adsTotal?.cost || 0;
  const per = (x) => (x > 0 && cost > 0 ? r2(cost / x) : null);
  return {
    spend: r2(cost), signups, verifiedSignups, listings, contacts,
    cac: per(verifiedSignups), costPerSignup: per(signups), costPerListing: per(listings), costPerContact: per(contacts),
    verifiedRate: signups > 0 ? Math.round((verifiedSignups / signups) * 100) : null,
  };
}
