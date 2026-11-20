// Admin Manager → AI SEO → Run reports: "This run vs the previous run" — the pages the AI SEO touched and
// the whole site on Google (shown in Google, average position, clicks), side by side with the change, plus
// the touched pages that got clicks. Built from the two latest finished runs' snapshots (seo_runs.snapshot).
// Pure — test/seoRunCompare.test.js.

const r1 = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10) / 10);
const n = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
const fmtDay = (iso) => {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
export const windowLabel = (w) => (w?.start && w?.end ? `Google data ${fmtDay(w.start)}–${fmtDay(w.end)}` : 'Google data');

// change text + whether it is good: counts in %, position in places (lower position = better)
export function changeOf(kind, prev, cur) {
  if (prev == null || cur == null) return { text: '—', tone: 'neutral' };
  if (kind === 'position') {
    if (!prev || !cur) return { text: '—', tone: 'neutral' };
    const g = r1(prev - cur);
    if (!g) return { text: 'Same', tone: 'neutral' };
    const places = Math.abs(g) === 1 ? 'place' : 'places';
    return g > 0 ? { text: `${g} ${places} better`, tone: 'good' } : { text: `${-g} ${places} worse`, tone: 'bad' };
  }
  if (cur === prev) return { text: 'Same', tone: 'neutral' };
  if (!prev) return { text: `+${cur}`, tone: cur > 0 ? 'good' : 'neutral' };
  const p = Math.round(((cur - prev) / prev) * 1000) / 10;
  const small = Math.abs(cur - prev) < 5 && kind === 'clicks';
  return { text: small ? `${cur - prev > 0 ? '+' : ''}${cur - prev}` : `${p > 0 ? '+' : ''}${p}%`, tone: p > 0 ? 'good' : 'bad' };
}

export function compareRuns(prev, cur) {
  if (!prev?.snapshot || !cur?.snapshot) return null;
  const P = prev.snapshot; const C = cur.snapshot;
  const row = (group, label, kind, a, b) => ({ group, label, kind, prev: kind === 'position' ? r1(a) : n(a), cur: kind === 'position' ? r1(b) : n(b), change: changeOf(kind, kind === 'position' ? r1(a) : n(a), kind === 'position' ? r1(b) : n(b)) });
  const rows = [
    row('pages', 'Times shown in Google', 'impressions', P.pipeline?.cur?.impressions, C.pipeline?.cur?.impressions),
    row('pages', 'Average Google position', 'position', P.pipeline?.cur?.position, C.pipeline?.cur?.position),
    row('pages', 'Clicks', 'clicks', P.pipeline?.cur?.clicks, C.pipeline?.cur?.clicks),
    row('site', 'Times shown in Google', 'impressions', P.site?.cur?.impressions, C.site?.cur?.impressions),
    row('site', 'Average Google position', 'position', P.site?.cur?.position, C.site?.cur?.position),
    row('site', 'Clicks', 'clicks', P.site?.cur?.clicks, C.site?.cur?.clicks),
  ];
  const overlap = P.window?.end && C.window?.start && P.window.end >= C.window.start;
  const clicked = (C.pageResults || []).filter((p) => (p.clicks || 0) > 0)
    .sort((a, b) => (b.clicks - a.clicks) || ((a.position || 99) - (b.position || 99)))
    .slice(0, 10).map((p) => ({ path: p.path, kind: p.kind, clicks: p.clicks, impressions: p.impressions, position: r1(p.position) }));
  return {
    prev: { id: prev.id, at: prev.started_at, window: P.window || null, label: windowLabel(P.window) },
    cur: { id: cur.id, at: cur.started_at, window: C.window || null, label: windowLabel(C.window) },
    rows, clicked, overlap: !!overlap,
  };
}
