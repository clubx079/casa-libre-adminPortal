// Stage 3 — Decide: collected demand + live listings + what is already live → ranked opportunities
// (pure — test/seoDecide.test.js). Runner: lib/seo/run.js runDecide().
//   create_variant        a proven search for a real filter page (…/baratos, …/2-dormitorios) that is
//                         not switched on yet and has ≥5 listings
//   strengthen_page       a page Google shows on positions 5–20 for a search with impressions
//   write_guide           a question-style search with demand and no guide yet
//   trend_post            a property / economy topic trending in the country now
//   lower_bid_suggestion  we pay for a search we already rank top-3 for organically (suggest only)
import { matchTerm, termKey } from './matcher.js';
import { pageState } from './inventory.js';
import { scoreOpportunity } from './score.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { topicOf } from './trends.js';

const pathOnly = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return String(u || '').replace(/\/+$/, '') || '/'; } };

// Latest snapshot per source → one demand record per search (by termKey).
export function aggregateSignals(signals = []) {
  const latest = {};
  for (const s of signals) if (!latest[s.source] || s.date > latest[s.source]) latest[s.source] = s.date;
  const byTerm = new Map();
  const get = (term) => {
    const k = termKey(term);
    let r = byTerm.get(k);
    if (!r) { r = { key: k, term, ads: { clicks: 0, impressions: 0, conversions: 0, cost: 0 }, gsc: { clicks: 0, impressions: 0, posSum: 0, pages: [] }, site: { searches: 0, people: 0 }, kp: { volume: 0, competition: null } }; byTerm.set(k, r); }
    return r;
  };
  for (const s of signals) {
    if (s.date !== latest[s.source] || !s.term) continue;
    const m = s.metrics || {};
    const r = get(s.term);
    if (s.source === 'ads') {
      r.ads.clicks += Number(m.clicks) || 0; r.ads.impressions += Number(m.impressions) || 0;
      r.ads.conversions += Number(m.conversions) || 0; r.ads.cost += Number(m.cost) || 0;
    } else if (s.source === 'gsc') {
      const imp = Number(m.impressions) || 0;
      r.gsc.clicks += Number(m.clicks) || 0; r.gsc.impressions += imp; r.gsc.posSum += (Number(m.position) || 0) * imp;
      r.gsc.pages.push({ page: pathOnly(s.page), clicks: Number(m.clicks) || 0, impressions: imp, position: Number(m.position) || 0 });
    } else if (s.source === 'site_search') {
      r.site.searches += Number(m.searches) || 0; r.site.people += Number(m.people) || 0;
    } else if (s.source === 'keyword_planner') {
      // monthly Google searches: the same search written two ways keeps the bigger number
      const v = Number(m.avg_monthly_searches) || 0;
      if (v > r.kp.volume) { r.kp.volume = v; r.kp.competition = m.competition || null; }
    }
  }
  for (const r of byTerm.values()) {
    r.gsc.position = r.gsc.impressions ? Math.round((r.gsc.posSum / r.gsc.impressions) * 10) / 10 : null;
    delete r.gsc.posSum;
    r.ads.cost = Math.round(r.ads.cost * 100) / 100;
  }
  return [...byTerm.values()];
}

export const isProven = (d, t) => d.ads.clicks >= t.provenAdsClicks || d.ads.conversions >= t.provenAdsConversions
  || d.site.searches >= t.provenSiteSearches || d.gsc.impressions >= t.provenGscImpressions
  || (d.kp?.volume || 0) >= (t.provenKpVolume ?? 50);

const slugish = (s) => termKey(s).replace(/ /g, '-').slice(0, 70);

export function decide({ signals = [], inventory = new Map(), overridesByPath = new Map(), places = {}, trends = [], draftSlugs = [], settings = DEFAULT_SETTINGS, now = new Date() } = {}) {
  const t = settings.thresholds;
  const demand = aggregateSignals(signals);
  const opps = new Map();
  const put = (o) => { const prev = opps.get(o.key); if (!prev || prev.score < o.score) opps.set(o.key, o); };
  const metricsOf = (d) => ({ ads: d.ads, gsc: { clicks: d.gsc.clicks, impressions: d.gsc.impressions }, site: d.site, kp: d.kp });
  const ev = (d) => ({ ads: d.ads, gsc: { clicks: d.gsc.clicks, impressions: d.gsc.impressions, position: d.gsc.position }, site: d.site, kp: d.kp });

  const variantDemand = new Map();
  for (const d of demand) {
    const m = matchTerm(d.term, places);
    // ── create_variant ── (every search that points at the same variant adds up)
    if (m.kind === 'variant' && m.url) {
      const st = pageState(m.url, inventory, overridesByPath);
      if (!st.enabled && st.count >= t.minListings) {
        const v = variantDemand.get(m.url) || { url: m.url, base: m.base, variant: m.variant, parsed: m.parsed, count: st.count, terms: [], sum: { ads: { clicks: 0, impressions: 0, conversions: 0, cost: 0 }, gsc: { clicks: 0, impressions: 0 }, site: { searches: 0, people: 0 }, kp: { volume: 0 } }, pos: null };
        v.terms.push({ term: d.term, weight: scoreOpportunity({ metrics: metricsOf(d) }) });
        for (const k of ['clicks', 'impressions', 'conversions', 'cost']) v.sum.ads[k] += d.ads[k];
        v.sum.gsc.clicks += d.gsc.clicks; v.sum.gsc.impressions += d.gsc.impressions;
        v.sum.site.searches += d.site.searches; v.sum.site.people += d.site.people;
        v.sum.kp.volume += d.kp.volume;
        if (d.gsc.position && (!v.pos || d.gsc.position < v.pos)) v.pos = d.gsc.position;
        variantDemand.set(m.url, v);
      }
    }
    // ── strengthen_page ── (Google shows one of our pages on positions 5–20 for this search)
    for (const p of d.gsc.pages) {
      if (p.position >= t.strengthenMinPos && p.position <= t.strengthenMaxPos && p.impressions >= t.strengthenMinImpressions) {
        const inv = inventory.get(p.page);
        put({ key: `strengthen_page|${p.page}`, type: 'strengthen_page', term: d.term, url: p.page, parsed: m.parsed,
          score: scoreOpportunity({ metrics: { gsc: { clicks: p.clicks, impressions: p.impressions }, ads: d.ads, site: d.site, kp: d.kp }, listings: inv ? inv.count : null, position: p.position, min: t.minListings }),
          evidence: { page: p, ads: d.ads, site: d.site, listings: inv ? inv.count : null } });
      }
    }
    // ── write_guide ── (a question with demand, no guide/draft for it yet)
    if (m.parsed.question && !m.parsed.brand) {
      const sc = scoreOpportunity({ metrics: metricsOf(d), listings: null, position: d.gsc.position });
      const slug = slugish(d.term);
      if (sc >= t.guideMinDemand && !draftSlugs.includes(slug)) {
        put({ key: `write_guide|${termKey(d.term)}`, type: 'write_guide', term: d.term, url: `/guias/${slug}`, parsed: { ...m.parsed, slug, answerUrl: m.url || null }, score: sc, evidence: ev(d) });
      }
    }
    // ── lower_bid_suggestion ── (paid clicks on a search we already rank top-3 for)
    if (d.ads.cost > 0 && d.ads.clicks > 0 && d.gsc.position && d.gsc.position <= 3 && d.gsc.impressions >= 10) {
      put({ key: `lower_bid_suggestion|${termKey(d.term)}`, type: 'lower_bid_suggestion', term: d.term, url: d.gsc.pages.sort((a, b) => b.clicks - a.clicks)[0]?.page || null, parsed: m.parsed,
        score: Math.round(d.ads.cost * 10) / 10, evidence: ev(d) });
    }
  }

  for (const v of variantDemand.values()) {
    const proven = isProven({ ads: v.sum.ads, gsc: v.sum.gsc, site: v.sum.site, kp: v.sum.kp }, t);
    if (!proven) continue;
    const terms = v.terms.sort((a, b) => b.weight - a.weight);
    v.sum.ads.cost = Math.round(v.sum.ads.cost * 100) / 100;
    v.sum.ads.conversions = Math.round(v.sum.ads.conversions * 100) / 100;
    put({ key: `create_variant|${v.url}`, type: 'create_variant', term: terms[0].term, url: v.url, parsed: { ...v.parsed, base: v.base, variant: v.variant },
      score: scoreOpportunity({ metrics: v.sum, listings: v.count, position: v.pos, min: t.minListings }),
      evidence: { ads: v.sum.ads, gsc: { ...v.sum.gsc, position: v.pos }, site: v.sum.site, kp: v.sum.kp, listings: v.count, median: inventory.get(v.url)?.cityMedian ?? null, terms: terms.slice(0, 8).map((x) => x.term) } });
  }

  // ── trend_post ── (property / economy topics trending now)
  const since = now.getTime() - t.trendHours * 3600_000;
  const seen = new Map();
  for (const raw of trends) {
    // re-tag with today's rules (a stored reading keeps the topic it got when collected)
    const tr = { ...raw, topic: topicOf(raw.title, (raw.news || []).map((n) => n.title)) };
    if (!['property', 'economy'].includes(tr.topic)) continue;
    if (Date.parse(tr.seen_at || tr.pub_date || 0) < since) continue;
    const k = termKey(tr.title);
    const prev = seen.get(k);
    if (!prev || (tr.traffic || 0) > (prev.traffic || 0)) seen.set(k, tr);
  }
  for (const tr of seen.values()) {
    const slug = slugish(tr.title);
    if (draftSlugs.includes(slug)) continue;
    put({ key: `trend_post|${termKey(tr.title)}`, type: 'trend_post', term: tr.title, url: `/guias/${slug}`, parsed: { slug, topic: tr.topic },
      score: Math.round(Math.log10((tr.traffic || 0) + 10) * (tr.topic === 'property' ? 12 : 8) * 10) / 10,
      evidence: { traffic: tr.traffic, trafficLabel: tr.traffic_label, topic: tr.topic, geo: tr.geo, news: (tr.news || []).slice(0, 3) } });
  }

  return [...opps.values()].sort((a, b) => b.score - a.score);
}
