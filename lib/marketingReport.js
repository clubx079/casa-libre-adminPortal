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

// "From Google Ads" — what Google Ads itself attributes to ad clicks (a person clicked an
// ad, then tapped WhatsApp / call / copy number on a listing, or signed up). Counted with
// metrics.all_conversions so secondary actions count too. Only these actions count:
// "Page view", the login click ("Contact (… oauth_login_clicked)") and form_submit do not.
// Google only started counting them on ADS_TRACKING_SINCE — before that it is zero.
export const ADS_TRACKING_SINCE = '2026-10-13';
export function adsActionKind(name = '') {
  const s = String(name).toLowerCase();
  if (/contact_whatsapp_click/.test(s)) return 'whatsapp';
  if (/contact_call_click/.test(s)) return 'call';
  if (/contact_copy_click/.test(s)) return 'copy';
  if (/user_signed_up/.test(s)) return 'signup';
  return null;
}

// campaigns: the campaign spend rows (same as adsReport); actions: rows of
// campaign.id, campaign.name, segments.conversion_action_name, metrics.all_conversions;
// daily (optional): the account spend per day, for the like-for-like "since tracking
// started" cost (only the spend from ADS_TRACKING_SINCE on, same contacts / sign-ups).
export function adsAcquisition({ campaigns = [], actions = [], daily = [] }, range) {
  const empty = () => ({ whatsapp: 0, call: 0, copy: 0, signup: 0 });
  const per = new Map();   // campaign id → { name, cost, counts }
  const row = (id, name) => {
    const k = String(id || name || '—');
    if (!per.has(k)) per.set(k, { id: id || null, name: name || '—', cost: 0, counts: empty() });
    return per.get(k);
  };
  for (const x of campaigns) {
    const c = row(x.campaign?.id, x.campaign?.name);
    c.cost += n(x.metrics?.costMicros) / 1e6;
    if (x.campaign?.status) c.status = x.campaign.status;
  }
  for (const x of actions) {
    const kind = adsActionKind(x.segments?.conversionActionName);
    if (!kind) continue;
    row(x.campaign?.id, x.campaign?.name).counts[kind] += n(x.metrics?.allConversions);
  }
  const shape = (cost, k) => {
    const contacts = r2(k.whatsapp + k.call + k.copy), signups = r2(k.signup);
    return {
      spend: r2(cost),
      contacts, whatsapp: r2(k.whatsapp), call: r2(k.call), copy: r2(k.copy), signups,
      costPerContact: contacts > 0 && cost > 0 ? r2(cost / contacts) : null,
      cac: signups > 0 && cost > 0 ? r2(cost / signups) : null,
    };
  };
  const list = [...per.values()];
  const tot = list.reduce((acc, c) => { acc.cost += c.cost; for (const k of Object.keys(acc.k)) acc.k[k] += c.counts[k]; return acc; }, { cost: 0, k: empty() });
  const camps = list.map((c) => ({ id: c.id, name: c.name, status: c.status || '', ...shape(c.cost, c.counts) }))
    .filter((c) => c.spend > 0 || c.contacts > 0 || c.signups > 0)
    .sort((a, b) => b.spend - a.spend || b.contacts - a.contacts);
  const total = shape(tot.cost, tot.k);
  const partial = !!range?.start && range.start < ADS_TRACKING_SINCE;
  let sinceTracking = null;
  if (partial && daily.length) {
    const spend = daily.filter((x) => String(x.segments?.date || '') >= ADS_TRACKING_SINCE).reduce((a, x) => a + n(x.metrics?.costMicros) / 1e6, 0);
    sinceTracking = {
      spend: r2(spend),
      costPerContact: total.contacts > 0 && spend > 0 ? r2(spend / total.contacts) : null,
      cac: total.signups > 0 && spend > 0 ? r2(spend / total.signups) : null,
    };
  }
  return {
    total,
    campaigns: camps,
    sinceTracking,
    trackingSince: ADS_TRACKING_SINCE,
    // The period starts before Google counted these → the older days are zero.
    partial,
  };
}
