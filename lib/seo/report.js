// AI SEO report — the pure part (test/seoReport.test.js): compare a run's snapshot with the previous
// run's, judge the status, and write the report from the numbers alone (used when no AI is available,
// and given to the AI as the facts it must stick to). The server part is lib/seo/runLog.js.
//
// snapshot = {
//   window: { start, end, prevStart, prevEnd },                     Search Console dates (7 days)
//   site:     { cur: { clicks, impressions, ctr, position }, prev: {…} },   the whole site on Google
//   pipeline: { cur: {…}, prev: {…} },                             only the pages the pipeline added/changed
//   keywords: [{ query, clicks, impressions, position, prevPosition, prevClicks }],   top 25 on Google
//   adsTerms: [{ term, clicks, conversions, cost }],                top paid searches (Google Ads)
//   pages:    { variants, retired, guides, titles, linked },        what the pipeline has live in total
//   pageResults: [{ path, kind, clicks, impressions, position, prevClicks, prevImpressions, visits, contacts }],
//   opportunities: { open, byType },
//   trends: [title, …],
// }

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (v) => Math.round(n(v) * 10) / 10;
export const pct = (cur, prev) => (n(prev) > 0 ? Math.round(((n(cur) - n(prev)) / n(prev)) * 1000) / 10 : null);

// Position: lower is better. delta > 0 = moved UP (improved) by that many places.
export const posGain = (cur, prev) => (n(cur) > 0 && n(prev) > 0 ? round1(n(prev) - n(cur)) : null);

function deltaBlock(cur = {}, prev = {}) {
  return {
    clicks: n(cur.clicks) - n(prev.clicks), clicksPct: pct(cur.clicks, prev.clicks),
    impressions: n(cur.impressions) - n(prev.impressions), impressionsPct: pct(cur.impressions, prev.impressions),
    positionGain: posGain(cur.position, prev.position),
  };
}

// Run vs the previous run (and the Google week vs the week before, which works even on the first run).
export function compareSnapshots(snap = {}, prevSnap = null) {
  const out = {
    weekOnWeek: { site: deltaBlock(snap.site?.cur, snap.site?.prev), pipeline: deltaBlock(snap.pipeline?.cur, snap.pipeline?.prev) },
    vsPreviousRun: null,
    keywordMoves: [],
  };
  for (const k of snap.keywords || []) {
    const g = posGain(k.position, k.prevPosition);
    if (g != null && Math.abs(g) >= 1) out.keywordMoves.push({ query: k.query, position: round1(k.position), gain: g });
  }
  out.keywordMoves.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
  out.keywordMoves = out.keywordMoves.slice(0, 10);
  if (prevSnap && prevSnap.site) {
    const p = prevSnap.pages || {}; const c = snap.pages || {};
    out.vsPreviousRun = {
      site: deltaBlock(snap.site?.cur, prevSnap.site?.cur),
      pipeline: deltaBlock(snap.pipeline?.cur, prevSnap.pipeline?.cur),
      pages: Object.fromEntries(['variants', 'retired', 'guides', 'titles', 'linked'].map((k) => [k, n(c[k]) - n(p[k])])),
      newKeywords: (snap.keywords || []).map((k) => k.query).filter((q) => !(prevSnap.keywords || []).some((x) => x.query === q)).slice(0, 10),
    };
  }
  return out;
}

// improving / steady / declining / starting — from Google clicks + position, site and pipeline pages.
export function judgeStatus(snap = {}, cmp = {}) {
  const s = cmp.weekOnWeek?.site || {};
  const cur = snap.site?.cur || {};
  if (!n(cur.impressions) && !n(snap.site?.prev?.impressions)) return 'starting';
  const clicksUp = (s.clicksPct ?? 0) >= 5;
  const clicksDown = (s.clicksPct ?? 0) <= -5;
  const posUp = (s.positionGain ?? 0) >= 0.5;
  const posDown = (s.positionGain ?? 0) <= -0.5;
  if ((clicksUp && !posDown) || (posUp && !clicksDown)) return 'improving';
  if ((clicksDown && !posUp) || (posDown && !clicksUp)) return 'declining';
  return 'steady';
}

const fmtPct = (v) => (v == null ? 'new' : `${v > 0 ? '+' : ''}${v}%`);
const fmtPos = (g) => (g == null ? '' : g > 0 ? `up ${g} places` : g < 0 ? `down ${-g} places` : 'no change');
const ACTION_LABEL = {
  enable_variant: 'Added page', retire_variant: 'Hid page (no Google views)', set_title: 'New title', add_links: 'Added links to',
  publish_guide: 'Published guide', unpublish_guide: 'Unpublished guide',
};
export const actionLabel = (a) => ACTION_LABEL[a] || a;

// seo_changes rows → what the report shows. Page variants are logged on their city page (the row that
// holds enabled_variants), so the page actually added / hidden is worked out from before → after.
export function displayChanges(rows = []) {
  return rows.map((c) => {
    let path = c.path;
    if (c.action === 'enable_variant' || c.action === 'retire_variant') {
      const key = c.action === 'enable_variant' ? 'enabled_variants' : 'retired_variants';
      const before = new Set(c.before?.[key] || []);
      const v = (c.after?.[key] || []).find((x) => !before.has(x));
      if (v) path = `${c.path}/${v}`;
    }
    return { action: c.action, path, reason: c.reason || null, by: c.by || null, at: c.created_at || null };
  });
}

// The report from the numbers alone. Same shape as the AI's.
export function dataReport(snap = {}, cmp = {}, changes = []) {
  const status = judgeStatus(snap, cmp);
  const site = snap.site?.cur || {};
  const w = cmp.weekOnWeek?.site || {};
  const added = changes.filter((c) => c.action === 'enable_variant');
  const guides = changes.filter((c) => c.action === 'publish_guide');
  const edited = changes.filter((c) => ['set_title', 'add_links'].includes(c.action));
  const hidden = changes.filter((c) => c.action === 'retire_variant');
  const headline = status === 'starting'
    ? 'SEO tracking started: no Google data yet for this period.'
    : `Google clicks ${fmtPct(w.clicksPct)} week on week (${n(site.clicks)} clicks, average position ${round1(site.position) || '—'}); this run added ${added.length} pages and ${guides.length} guides and edited ${edited.length}.`;
  const whatChanged = changes.map((c) => `${actionLabel(c.action)} ${c.path}${c.reason ? ` — ${c.reason}` : ''}`);
  const keywords = (cmp.keywordMoves || []).slice(0, 6).map((k) => `"${k.query}": position ${k.position} (${fmtPos(k.gain)})`);
  const results = (snap.pageResults || []).filter((p) => n(p.impressions) || n(p.visits)).sort((a, b) => n(b.clicks) - n(a.clicks));
  const wins = results.filter((p) => n(p.clicks) > n(p.prevClicks)).slice(0, 5).map((p) => `${p.path}: ${n(p.clicks)} Google clicks (was ${n(p.prevClicks)}), ${n(p.visits)} visits, ${n(p.contacts)} contacts`);
  for (const k of (cmp.keywordMoves || []).filter((x) => x.gain > 0).slice(0, 3)) wins.push(`"${k.query}" moved ${fmtPos(k.gain)} to position ${k.position}`);
  const problems = (cmp.keywordMoves || []).filter((x) => x.gain < 0).slice(0, 3).map((k) => `"${k.query}" dropped ${-k.gain} places to position ${k.position}`);
  if (hidden.length) problems.push(`${hidden.length} page(s) hidden after 4 weeks with no Google views`);
  if ((w.clicksPct ?? 0) <= -5) problems.push(`Site Google clicks down ${-w.clicksPct}% week on week`);
  const next = [];
  if (n(snap.opportunities?.open)) next.push(`${n(snap.opportunities.open)} opportunities still open (${Object.entries(snap.opportunities.byType || {}).map(([k, v]) => `${v} ${k}`).join(', ')}); the next runs apply them within the daily limits.`);
  if (!n(snap.pages?.variants) && !n(snap.pages?.guides)) next.push('No pipeline pages live yet: they appear as soon as searches are proven and 5+ listings match.');
  next.push('New pages usually need 2–4 weeks before Google ranks them; judge them on the weekly comparison, not one run.');
  return {
    status, headline,
    summary: [
      `On Google (last 7 days): ${n(site.clicks)} clicks, ${n(site.impressions)} views, average position ${round1(site.position) || '—'} — clicks ${fmtPct(w.clicksPct)}, views ${fmtPct(w.impressionsPct)}, position ${fmtPos(w.positionGain) || '—'} vs the week before.`,
      `Live from the pipeline: ${n(snap.pages?.variants)} added pages, ${n(snap.pages?.guides)} guides, ${n(snap.pages?.titles)} pages with new titles, ${n(snap.pages?.linked)} pages with extra links; their Google clicks this week: ${n(snap.pipeline?.cur?.clicks)} (${fmtPct(cmp.weekOnWeek?.pipeline?.clicksPct)}).`,
    ],
    whatChanged, keywords, wins, problems, next,
  };
}

// The AI's instructions + the facts (it must not invent numbers).
export const REPORT_SYSTEM = `You are the SEO analyst for Casa Libre, a property marketplace. You get the facts of one run of our automatic SEO pipeline (what it changed, Google Search Console numbers, keywords and rankings, page results, comparison with the previous run) and a draft report written from those numbers.
Write the report in plain English for the founders: short, concrete, no hype, no SEO jargon without explanation.
Rules: use ONLY numbers present in the facts; never invent figures, causes or competitors. If data is thin (new pages, few impressions), say so plainly — new pages need 2–4 weeks.
Return ONLY JSON: {"status": "improving"|"steady"|"declining"|"starting", "headline": str (one sentence), "summary": [str] (2-4 short paragraphs), "whatChanged": [str], "keywords": [str], "wins": [str], "problems": [str], "next": [str]}`;

export function reportPrompt(snap, cmp, changes, draft) {
  return JSON.stringify({
    changesThisRun: changes.map((c) => ({ action: actionLabel(c.action), path: c.path, why: c.reason })),
    google: { window: snap.window, site: snap.site, pipelinePages: snap.pipeline },
    keywords: (snap.keywords || []).slice(0, 25),
    paidSearches: (snap.adsTerms || []).slice(0, 10),
    pages: snap.pages, pageResults: (snap.pageResults || []).slice(0, 40),
    opportunities: snap.opportunities, trending: (snap.trends || []).slice(0, 10),
    comparison: cmp, draftReport: draft,
  });
}

// Keep only the expected fields from an AI answer; anything missing falls back to the draft.
export function cleanReport(j, draft) {
  const list = (v, d) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 30) : d);
  const status = ['improving', 'steady', 'declining', 'starting'].includes(j?.status) ? j.status : draft.status;
  return {
    status,
    headline: typeof j?.headline === 'string' && j.headline.trim() ? j.headline.trim().slice(0, 300) : draft.headline,
    summary: list(j?.summary, draft.summary), whatChanged: list(j?.whatChanged, draft.whatChanged), keywords: list(j?.keywords, draft.keywords),
    wins: list(j?.wins, draft.wins), problems: list(j?.problems, draft.problems), next: list(j?.next, draft.next),
  };
}
