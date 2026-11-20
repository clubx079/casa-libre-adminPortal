// AI SEO for the sites — stages 3 (Decide) and 8 (Improve) for ONE site (pure — test/seoSites.test.js).
// Same thresholds as the buyer pipeline (lib/seo/settings.js), on the site's own Search Console pages.
// Runner: lib/seoSites/run.js.
//   write_guide      a relevant question/topic search (relevance by the site's kind) with demand
//                    (guideMinDemand) that no guide of the site covers yet — static guides from the
//                    site's catalog, or a pipeline draft in any status (a rejected one is not re-proposed)
//   strengthen_page  one of the site's guides on Google positions 5–20 for a search → internal links
//   trend_post       a property topic trending in one of the site's countries (Autopilot: off by default)
//   new_title        (Improve) many impressions + low CTR → a title in the words of the top search
//   strengthen_page  (Improve) the guide slipped in position week on week
// create_variant / retire_variant / lower_bid_suggestion do not exist for the sites.
import { aggregateSignals } from '../seo/decide.js';
import { scoreOpportunity } from '../seo/score.js';
import { DEFAULT_SETTINGS } from '../seo/settings.js';
import { topicOf } from '../seo/trends.js';
import { canChangeTitle, cleanTitle } from '../seo/guards.js';
import { sameWords } from '../seo/improve.js';
import { prettyQuestion } from '../seo/draftTemplate.js';
import { termKey } from '../seo/matcher.js';
import { isRelevant, isQuestionOrTopic, coveredBy, topicKey } from './relevance.js';
import { guidePath, countryOfTerm, slugify, COUNTRY_NAME, SLUG_RE } from './scope.js';

const pathOnly = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return String(u || '').split('?')[0].replace(/\/+$/, '') || '/'; } };
const TREND_GEO_CC = { PY: 'py', BO: 'bo', UY: 'uy', VE: 've', SV: 'sv' };

/** A slug for a search: folded words, max 70 chars, cut on a word. */
export function slugForSearch(term) {
  let s = slugify(String(term || '').replace(/[¿?]/g, ''));
  if (s.length > 70) s = s.slice(0, 70).replace(/-[^-]*$/, '');
  return SLUG_RE.test(s) ? s : null;
}

/** The site's guides known to the admin: static (catalog) + pipeline drafts, as [{ cc, slug, path, title, h1, source, status }]. */
export function knownGuides(site, catalog = [], drafts = []) {
  const out = (catalog || []).map((g) => ({ cc: g.cc || site.rootCountry, slug: g.slug, path: pathOnly(g.path || guidePath(site, g.cc, g.slug)), title: g.title, h1: g.h1, source: 'static', status: 'approved' }));
  for (const d of drafts || []) {
    const cc = d.related?.cc || site.rootCountry;
    out.push({ cc, slug: d.slug, path: guidePath(site, cc, d.slug), title: d.title, h1: d.h1, source: 'pipeline', status: d.status });
  }
  return out;
}

// otherDrafts: guides already written by the OTHER sites of the same kind (and country) — a topic is
// written once across our sites, never twice.
export function decideSite({ site, signals = [], catalog = [], drafts = [], otherDrafts = [], trends = [], settings = DEFAULT_SETTINGS, now = new Date() } = {}) {
  const t = settings.thresholds;
  const guides = knownGuides(site, catalog, drafts);
  const live = guides.filter((g) => g.status === 'approved');
  const livePaths = new Set(live.map((g) => g.path));
  const slugs = new Set(guides.map((g) => `${g.cc}|${g.slug}`));
  // topics already answered: this site's guides (any status) + same-kind sites' guides
  const topics = new Set([...guides.map((g) => `${g.cc}|${topicKey(`${String(g.slug || '').replace(/-/g, ' ')}`)}`), ...guides.map((g) => `${g.cc}|${topicKey(g.title)}`),
    ...(otherDrafts || []).map((d) => `${d.related?.cc || site.rootCountry}|${topicKey(d.term || d.title)}`)]);
  const opps = new Map();
  const put = (o) => { const prev = opps.get(o.key); if (!prev || prev.score < o.score) opps.set(o.key, o); };
  const ev = (d) => ({ ads: d.ads, gsc: { clicks: d.gsc.clicks, impressions: d.gsc.impressions, position: d.gsc.position } });

  for (const d of aggregateSignals(signals)) {
    const relevant = isRelevant(d.term, site.kind, site.key);
    // ── strengthen_page ── (one of the site's live guides on positions 5–20)
    for (const p of d.gsc.pages) {
      if (!livePaths.has(p.page)) continue;
      if (p.position >= t.strengthenMinPos && p.position <= t.strengthenMaxPos && p.impressions >= t.strengthenMinImpressions) {
        put({ key: `strengthen_page|${p.page}`, type: 'strengthen_page', term: d.term, url: p.page, parsed: {},
          score: scoreOpportunity({ metrics: { gsc: { clicks: p.clicks, impressions: p.impressions }, ads: d.ads }, position: p.position }),
          evidence: { page: p, ads: d.ads } });
      }
    }
    // ── write_guide ── (relevant, demand, not covered yet)
    if (!relevant || !isQuestionOrTopic(d.term)) continue;
    const sc = scoreOpportunity({ metrics: { ads: d.ads, gsc: { clicks: d.gsc.clicks, impressions: d.gsc.impressions }, site: d.site }, position: d.gsc.position });
    if (sc < t.guideMinDemand) continue;
    const cc = countryOfTerm(site, d.term, d.gsc.pages.sort((a, b) => b.impressions - a.impressions)[0]?.page || '');
    const slug = slugForSearch(d.term);
    if (!slug || slugs.has(`${cc}|${slug}`)) continue;
    const cover = coveredBy(d.term, guides.filter((g) => g.cc === cc));
    if (cover) continue;
    const topic = topicKey(d.term);
    if (!topic || topics.has(`${cc}|${topic}`)) continue;
    // the strongest wording of a topic wins (key = the topic, not the exact words)
    put({ key: `write_guide|${cc}|${topic.replace(/ /g, '-')}`, type: 'write_guide', term: d.term, url: guidePath(site, cc, slug), parsed: { slug, cc }, score: sc, evidence: ev(d) });
  }

  // ── trend_post ── (property topics trending in one of the site's countries, relevant to the site)
  const since = now.getTime() - t.trendHours * 3600_000;
  const seen = new Map();
  for (const raw of trends) {
    const cc = TREND_GEO_CC[String(raw.geo || '').toUpperCase()];
    if (!cc || !site.countries.includes(cc)) continue;
    const topic = topicOf(raw.title, (raw.news || []).map((n) => n.title));
    if (topic !== 'property') continue;
    if (Date.parse(raw.seen_at || raw.pub_date || 0) < since) continue;
    const text = `${raw.title} ${(raw.news || []).map((n) => n.title).join(' ')}`;
    if (!isRelevant(text, site.kind, site.key)) continue;
    const k = `${cc}|${termKey(raw.title)}`;
    if (!seen.has(k) || (raw.traffic || 0) > (seen.get(k).traffic || 0)) seen.set(k, { ...raw, cc });
  }
  for (const tr of seen.values()) {
    const slug = slugForSearch(tr.title);
    if (!slug || slugs.has(`${tr.cc}|${slug}`)) continue;
    put({ key: `trend_post|${tr.cc}|${termKey(tr.title)}`, type: 'trend_post', term: tr.title, url: guidePath(site, tr.cc, slug), parsed: { slug, cc: tr.cc, topic: 'property' },
      score: Math.round(Math.log10((tr.traffic || 0) + 10) * 12 * 10) / 10,
      evidence: { traffic: tr.traffic, trafficLabel: tr.traffic_label, geo: tr.geo, news: (tr.news || []).slice(0, 3) } });
  }
  return [...opps.values()].sort((a, b) => b.score - a.score);
}

/** "como captar propiedades" → "¿Cómo captar propiedades? Guía práctica" (15–70 chars, else null). */
export function siteTitleFromQuery(query, cc = 'py') {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const names = Object.values(COUNTRY_NAME);
  if (isQuestionOrTopic(q) && /^(como|cuanto|cuantos|cuanta|cuantas|que|donde|cual|cuales|cuando|por que|quien)\b/.test(q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    return cleanTitle(`${prettyQuestion(q, names)} Guía práctica`) || cleanTitle(prettyQuestion(q, names));
  }
  const cap = q.charAt(0).toUpperCase() + q.slice(1);
  return cleanTitle(`${cap}: guía práctica en ${COUNTRY_NAME[cc] || 'Paraguay'}`) || cleanTitle(`${cap}: guía práctica`);
}

// pages: [{ page, cur: { impressions, clicks, ctr, position }, prev: { position } | null, topQuery }]
export function improveSite({ site, pages = [], guidePaths = new Set(), overridesByPath = new Map(), settings = DEFAULT_SETTINGS, now = new Date() } = {}) {
  const t = settings.thresholds;
  const out = [];
  for (const p of pages) {
    const path = p.page;
    if (!guidePaths.has(path)) continue;   // only the site's guides (not home, /guias, legal pages)
    const ov = overridesByPath.get(path) || {};
    if (p.cur.impressions >= t.lowCtrImpressions && (p.cur.ctr || 0) < t.lowCtr && p.topQuery) {
      const title = siteTitleFromQuery(p.topQuery, countryOfTerm(site, p.topQuery, path));
      if (title && !sameWords(title, ov.title)) {
        const rl = canChangeTitle(ov, now, t.titleDays);
        out.push({ type: 'new_title', url: path, term: p.topQuery, title, allowed: rl.ok, nextAt: rl.nextAt,
          reason: `${p.cur.impressions} impressions, CTR ${(100 * (p.cur.ctr || 0)).toFixed(1)}% (< ${(100 * t.lowCtr).toFixed(1)}%): title from the top search "${p.topQuery}"` });
      }
    }
    if (p.prev?.position && p.cur.position && p.cur.position - p.prev.position >= t.slipPositions && p.cur.impressions >= 10) {
      out.push({ type: 'strengthen_page', url: path, term: p.topQuery || path,
        reason: `position slipped ${p.prev.position.toFixed(1)} → ${p.cur.position.toFixed(1)} week on week: add internal links` });
    }
  }
  return out;
}
