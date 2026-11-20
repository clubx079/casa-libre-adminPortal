// "Results of our changes" (Admin Manager → AI SEO): for every page the AI SEO added or edited, Google
// before vs after the change. Pure — test/seoImpact.test.js; the data is read in lib/seo/impactData.js.
//   before = up to 14 days of Search Console data BEFORE the day of the first change (per-day average)
//   after  = every day AFTER the change day up to Google's last complete day (data lags 2–3 days)
// Per day, so a 3-day "after" compares fairly with a 14-day "before". Position = weighted by impressions.
// New pages (added filter pages, guides) had no "before": they show what they bring now.

export const BEFORE_DAYS = 14;
export const MIN_AFTER_DAYS = 7;   // below this: "too early" (Google needs time to re-crawl and re-rank)

const KIND = { enable_variant: 'added page', publish_guide: 'new guide', set_title: 'new title', add_links: 'extra links' };
export const isNewKind = (k) => k === 'added page' || k === 'new guide';
const dayOf = (iso) => String(iso || '').slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
export const pct = (after, before) => (before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null);
export const normPath = (p) => { const s = String(p || '').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/+$/, ''); return s || '/'; };

// seo_changes rows → one entry per page: what was done, when first (that day splits before/after)
export function changedPages(changes = []) {
  const by = new Map();
  const add = (path, kind, at) => {
    const p = normPath(path);
    const e = by.get(p) || { path: p, kinds: [], firstChange: at, lastChange: at };
    if (!e.kinds.includes(kind)) e.kinds.push(kind);
    if (at < e.firstChange) e.firstChange = at;
    if (at > e.lastChange) e.lastChange = at;
    by.set(p, e);
  };
  for (const c of changes) {
    if (!c || c.reverted_at || !KIND[c.action] || !c.path) continue;
    if (c.action === 'enable_variant') {
      const before = new Set(c.before?.enabled_variants || []);
      const added = (c.after?.enabled_variants || []).filter((v) => !before.has(v));
      for (const v of added) add(`${c.path}/${v}`, KIND[c.action], c.created_at);
    } else add(c.path, KIND[c.action], c.created_at);
  }
  return [...by.values()].map((e) => ({ ...e, isNew: e.kinds.some(isNewKind) }));
}

// the window of Google data to fetch for these pages
export function dataRange(pages, lastDay) {
  if (!pages.length) return null;
  const first = pages.map((p) => dayOf(p.firstChange)).sort()[0];
  return { start: addDays(first, -BEFORE_DAYS), end: lastDay };
}

function sumWindow(days, from, to) {
  let impressions = 0; let clicks = 0; let posW = 0; let n = 0;
  for (const [d, v] of days) {
    if (d < from || d > to) continue;
    impressions += v.impressions; clicks += v.clicks; posW += v.position * v.impressions;
  }
  n = Math.max(0, daysBetween(from, to) + 1);
  return { days: n, impressions, clicks, perDay: { impressions: n ? r2(impressions / n) : null, clicks: n ? r2(clicks / n) : null }, position: impressions ? r1(posW / impressions) : null };
}

// rows: [{ page (path or URL), date, impressions, clicks, position }] from Search Console (page × date)
export function impactFor(pages = [], rows = [], { lastDay } = {}) {
  const byPage = new Map();
  for (const r of rows) {
    const p = normPath(r.page);
    const m = byPage.get(p) || new Map();
    const v = m.get(r.date) || { impressions: 0, clicks: 0, position: 0 };
    const imp = Number(r.impressions) || 0;
    v.position = v.impressions + imp ? (v.position * v.impressions + (Number(r.position) || 0) * imp) / (v.impressions + imp) : 0;
    v.impressions += imp; v.clicks += Number(r.clicks) || 0;
    m.set(r.date, v); byPage.set(p, m);
  }
  const list = pages.map((pg) => {
    const changeDay = dayOf(pg.firstChange);
    const days = byPage.get(pg.path) || new Map();
    const before = pg.isNew ? null : sumWindow(days, addDays(changeDay, -BEFORE_DAYS), addDays(changeDay, -1));
    const afterFrom = addDays(changeDay, 1);
    const afterDays = lastDay && lastDay >= afterFrom ? daysBetween(afterFrom, lastDay) + 1 : 0;
    const after = afterDays ? sumWindow(days, afterFrom, lastDay) : null;
    const status = !afterDays ? 'waiting' : afterDays < MIN_AFTER_DAYS ? 'too early' : 'measured';
    const change = before && after ? {
      impressionsPct: pct(after.perDay.impressions, before.perDay.impressions),
      clicksPct: pct(after.perDay.clicks, before.perDay.clicks),
      positionGain: before.position != null && after.position != null ? r1(before.position - after.position) : null,
    } : null;
    return { ...pg, changeDay, afterDays, status, before, after, change };
  });
  // totals: edited pages (before → after, per day) and what the new pages bring now
  const edited = list.filter((x) => !x.isNew && x.after);
  const sum = (arr, w, k) => r2(arr.reduce((s, x) => s + (x[w]?.perDay?.[k] || 0), 0));
  const editedTotals = edited.length ? {
    pages: edited.length,
    before: { impressions: sum(edited, 'before', 'impressions'), clicks: sum(edited, 'before', 'clicks') },
    after: { impressions: sum(edited, 'after', 'impressions'), clicks: sum(edited, 'after', 'clicks') },
  } : null;
  if (editedTotals) editedTotals.change = { impressionsPct: pct(editedTotals.after.impressions, editedTotals.before.impressions), clicksPct: pct(editedTotals.after.clicks, editedTotals.before.clicks) };
  const fresh = list.filter((x) => x.isNew);
  const newTotals = fresh.length ? {
    pages: fresh.length,
    withImpressions: fresh.filter((x) => (x.after?.impressions || 0) > 0).length,
    after: { impressions: fresh.reduce((s, x) => s + (x.after?.impressions || 0), 0), clicks: fresh.reduce((s, x) => s + (x.after?.clicks || 0), 0) },
  } : null;
  list.sort((a, b) => (b.changeDay.localeCompare(a.changeDay)) || ((b.after?.impressions || 0) - (a.after?.impressions || 0)));
  return { lastDay, pages: list, edited: editedTotals, new: newTotals };
}
