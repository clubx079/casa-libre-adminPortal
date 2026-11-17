// AI Analyst — the numbers behind the charts on the AI Analyst tab, taken from a saved data pack.
// Pure (test/analystCharts.test.js); the SVG lives in components/manager/analystCharts.js.
import { AI_SOURCES } from '../posthogSql.js';
import { changePct, sum } from './math.js';

// main-site source keys → the groups on the chart
export const SOURCE_GROUPS = [
  ['google', 'Google', (k) => k === 'google' || k === 'google ads' || k === 'gbp' || k === 'google business profile'],
  ['ai', 'ChatGPT / AI', (k) => AI_SOURCES.includes(k)],
  ['whatsapp', 'WhatsApp', (k) => k.startsWith('whatsapp')],
  ['social', 'Facebook / social', (k) => k === 'social' || /^(facebook|fb|instagram|ig|tiktok|linkedin|twitter|x)$/.test(k) || /facebook|instagram|tiktok/.test(k)],
  ['email', 'Email', (k) => k === 'email' || /mail|newsletter|resend/.test(k)],
  ['funnels', 'Funnel sites', (k) => k.startsWith('funnel')],
  ['direct', 'Direct', (k) => k === 'direct' || k === '(none)'],
];
export const groupOfSource = (key) => {
  const k = String(key || '').toLowerCase();
  const g = SOURCE_GROUPS.find(([, , f]) => f(k));
  return g ? g[0] : 'other';
};

// → [{ key, label, cur, prev, changePct }] (visitor-days), "Other" = the rest of the total
export function sourceBars(pack) {
  const b = pack?.sections?.mainSite?.breakdowns?.sources;
  if (!b) return [];
  const rows = [...(b.top || []), ...(b.otherRisers || []), ...(b.otherFallers || [])];
  const seen = new Set();
  const acc = Object.fromEntries([...SOURCE_GROUPS.map(([k]) => k), 'other'].map((k) => [k, { cur: 0, prev: 0 }]));
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const g = groupOfSource(r.key);
    acc[g].cur += r.cur; acc[g].prev += r.prev;
  }
  acc.other.cur += Math.max(0, (b.totalCur || 0) - sum(Object.values(acc).map((x) => x.cur)));
  acc.other.prev += Math.max(0, (b.totalPrev || 0) - sum(Object.values(acc).map((x) => x.prev)));
  const label = Object.fromEntries([...SOURCE_GROUPS.map(([k, l]) => [k, l]), ['other', 'Other']]);
  return Object.entries(acc).filter(([, v]) => v.cur || v.prev)
    .map(([key, v]) => ({ key, label: label[key], cur: v.cur, prev: v.prev, changePct: changePct(v.cur, v.prev) }));
}

// visits → seller contacts → sign-ups → listings → funnel-site leads
export function funnelSteps(pack) {
  const s = pack?.sections || {};
  const t = s.mainSite?.totals;
  if (!t) return [];
  const step = (key, label, o, note) => (o && o.cur != null ? { key, label, cur: o.cur, prev: o.prev, changePct: o.changePct ?? changePct(o.cur, o.prev), note } : null);
  const visitors = t.uniqueVisitors?.cur || 0;
  const visitorsPrev = t.uniqueVisitors?.prev || 0;
  return [
    step('visitors', 'Unique visitors', t.uniqueVisitors),
    step('contacts', 'Seller contacts (WhatsApp / call)', t.sellerContacts, 'people per day who tapped a contact button'),
    step('signups', 'Sign-ups', t.signups),
    step('listings', 'Listings created', t.listingsCreated),
    s.funnelLeads?.cur != null ? step('leads', 'Funnel-site leads', { cur: s.funnelLeads.cur, prev: s.funnelLeads.prev }, 'lead forms on the funnel sites') : null,
  ].filter(Boolean).map((x) => ({
    ...x,
    per1000: x.key === 'visitors' || !visitors ? null : Math.round((x.cur / visitors) * 10000) / 10,
    per1000Prev: x.key === 'visitors' || !visitorsPrev ? null : Math.round((x.prev / visitorsPrev) * 10000) / 10,
  }));
}

// top visitor countries (and the risers) this vs previous period
export function countryBars(pack, { top = 8 } = {}) {
  const b = pack?.sections?.mainSite?.breakdowns?.countries;
  if (!b) return [];
  const rows = [...(b.top || []).slice(0, top), ...(b.otherRisers || []).filter((r) => r.diff >= 10).slice(0, 2)];
  return rows.map((r) => ({ key: r.key, label: r.key, cur: r.cur, prev: r.prev, changePct: r.changePct }));
}

// daily visitors (+ sign-ups / contacts) with the anomaly days and the outside events per day
export function visitorSeries(pack) {
  const d = pack?.sections?.mainSite?.daily;
  if (!d?.rows?.length) return null;
  const col = (n) => d.columns.indexOf(n);
  const anomalies = new Map((pack.sections.anomalies?.days || []).map((g) => [g.date, g.metrics]));
  const events = pack.outsideWorld?.events || [];
  const first = d.rows[0][0];
  const last = d.rows[d.rows.length - 1][0];
  return {
    periodStart: pack.period?.start, prevStart: pack.previousPeriod?.start,
    points: d.rows.map((r) => ({
      date: r[0], visitors: r[col('visitors')], signups: r[col('signups')], contacts: r[col('contacts')],
      anomaly: anomalies.get(r[0]) || null,
      events: events.filter((e) => e.date === r[0]),
    })),
    eventsOutside: events.filter((e) => e.date < first || e.date > last),
    partialLastDay: !!pack.period?.endIsToday,
  };
}

// exchange rates as an index: 100 = the first day shown, so currencies of very different size
// share one axis. Up = the local currency got weaker vs US$.
export function fxIndexed(pack) {
  const fx = pack?.outsideWorld?.fx;
  if (!fx?.dates?.length) return null;
  const lines = Object.entries(fx.series || {}).map(([cur, vals]) => {
    const base = vals.find((v) => v != null);
    return { key: cur, values: vals.map((v) => (v == null || !base ? null : Math.round((v / base) * 10000) / 100)), first: base, last: [...vals].reverse().find((v) => v != null), changePct: fx.changes?.[cur]?.changePct ?? null };
  }).filter((l) => l.first);
  return lines.length ? { dates: fx.dates, lines } : null;
}
