// AI Analyst — BOT SIGNALS, computed in code so the model can only call traffic "bots" when the
// data shows it. Input: one row per visitor-day of this period (from PostHog):
//   [day, source, country, events, pageviews, secondsFirstToLast, deviceFingerprint, ip, browser]
// Per segment (source, visitor country, anomaly day) we measure what automated traffic looks
// like: 1 event only, under 5 s on the site, no page view, many visitors on ONE device
// fingerprint (browser|os|screen) or ONE network (/24 for IPv4, /48 for IPv6), bot-like browser
// names. Real people from one city share none of these strongly. IPs never leave this module.
// Pure — test/analystBotSignals.test.js.
import { r1 } from './math.js';

const BOT_UA = /(headless|phantom|selenium|puppeteer|playwright|bot\b|crawler|spider|python|curl|wget|httpclient|scrapy)/i;

export function networkOf(ip) {
  const s = String(ip || '').trim();
  if (!s || s === 'unknown') return '';
  if (s.includes(':')) return `${s.split(':').slice(0, 3).join(':')}::/48`;
  const p = s.split('.');
  return p.length === 4 ? `${p.slice(0, 3).join('.')}.0/24` : s;
}

// rows → stats of one segment
export function segmentStats(rows) {
  const n = rows.length;
  if (!n) return { visitorDays: 0 };
  const pct = (k) => r1((k / n) * 100);
  const topShare = (key) => {
    const m = new Map();
    for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) || 0) + 1); }
    const top = Math.max(0, ...m.values());
    return { pct: pct(top), distinct: m.size };
  };
  const fp = topShare((r) => r.fp);
  const net = topShare((r) => networkOf(r.ip));
  return {
    visitorDays: n,
    oneEventOnlyPct: pct(rows.filter((r) => r.events <= 1).length),
    under5sPct: pct(rows.filter((r) => r.seconds < 5).length),
    noPageviewPct: pct(rows.filter((r) => !r.pageviews).length),
    pageviewsPerVisit: r1(rows.reduce((s, r) => s + r.pageviews, 0) / n),
    medianSeconds: median(rows.map((r) => r.seconds)),
    topDeviceSharePct: fp.pct, distinctDevices: fp.distinct,
    topNetworkSharePct: net.pct, distinctNetworks: net.distinct,
    botBrowserPct: pct(rows.filter((r) => BOT_UA.test(r.browser || '')).length),
  };
}
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// The verdict per segment. automated_likely needs BOTH thin visits (most visits 1 event / < 5 s
// / no page view) AND concentration (one device or one network) — or bot browser names. Below
// 20 visitor-days nothing is concluded.
export function botVerdict(st, site = null) {
  if (!st || st.visitorDays < 20) return { verdict: 'too_small', reasons: [`only ${st?.visitorDays || 0} visitor-days`] };
  const reasons = [];
  const thin = Math.max(st.oneEventOnlyPct, st.under5sPct, st.noPageviewPct);
  if (st.oneEventOnlyPct >= 60) reasons.push(`${st.oneEventOnlyPct}% of visits had one event only`);
  if (st.under5sPct >= 60) reasons.push(`${st.under5sPct}% stayed under 5 s`);
  if (st.noPageviewPct >= 60) reasons.push(`${st.noPageviewPct}% had no page view`);
  const conc = Math.max(st.topDeviceSharePct, st.topNetworkSharePct);
  if (st.topDeviceSharePct >= 50) reasons.push(`${st.topDeviceSharePct}% on one device fingerprint`);
  if (st.topNetworkSharePct >= 30) reasons.push(`${st.topNetworkSharePct}% from one network`);
  if (st.botBrowserPct >= 20) reasons.push(`${st.botBrowserPct}% bot-like browser names`);
  if (st.botBrowserPct >= 20 || (thin >= 60 && (st.topDeviceSharePct >= 50 || st.topNetworkSharePct >= 30))) return { verdict: 'automated_likely', reasons };
  // compared with the whole site: much thinner visits OR heavy concentration → worth a look
  const thinner = site && site.visitorDays >= 20 && thin >= 40 && thin >= Math.max(site.oneEventOnlyPct, site.under5sPct, site.noPageviewPct) * 1.8;
  if (thin >= 60 || conc >= 40 || thinner) return { verdict: 'mixed', reasons: reasons.length ? reasons : [`visits thinner than the site average (${thin}% vs ${Math.max(site?.oneEventOnlyPct || 0, site?.under5sPct || 0)}%)`] };
  return { verdict: 'human_like', reasons: [`${st.pageviewsPerVisit} page views per visit, median ${st.medianSeconds} s, ${st.distinctDevices} devices, ${st.distinctNetworks} networks`] };
}

// raw PostHog rows → the pack section.
export function botSignals(raw, { anomalyDates = [], topN = 8 } = {}) {
  const rows = (raw || []).map((r) => ({
    day: String(r[0]).slice(0, 10), source: r[1] || 'direct', country: r[2] || 'Unknown',
    events: Number(r[3]) || 0, pageviews: Number(r[4]) || 0, seconds: Math.max(0, Number(r[5]) || 0),
    fp: r[6] || '', ip: r[7] || '', browser: r[8] || '',
  }));
  const site = segmentStats(rows);
  const seg = (key) => {
    const by = new Map();
    for (const r of rows) { const k = r[key]; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, topN)
      .map(([k, rs]) => { const st = segmentStats(rs); return { key: k, ...st, ...botVerdict(st, site) }; });
  };
  const days = anomalyDates.map((d) => {
    const rs = rows.filter((r) => r.day === d);
    const st = segmentStats(rs);
    return { date: d, ...st, ...botVerdict(st, site) };
  });
  const flagged = [...seg('source').map((s) => ({ ...s, dimension: 'source' })), ...seg('country').map((s) => ({ ...s, dimension: 'country' })), ...days.map((s) => ({ ...s, key: s.date, dimension: 'day' }))]
    .filter((s) => s.verdict === 'automated_likely').map((s) => `${s.dimension} ${s.key}: ${s.reasons.join('; ')}`);
  return {
    rule: 'Bot signals per segment of THIS period (visitor-days). automated_likely = most visits are 1 event / under 5 s / no page view AND concentrated on one device fingerprint or one network (or bot browser names). Only a segment marked automated_likely may be called bot / automated traffic.',
    site: { ...site, ...botVerdict(site) },
    bySource: seg('source'),
    byCountry: seg('country'),
    anomalyDays: days,
    automatedLikely: flagged,
    truncated: raw?.length >= 50000,
  };
}
