// AI SEO for the sites — a guide written by Claude in the SITE guide format (SEO_SITES_SPEC.md), through
// the admin's logged client (lib/aiTrack.js → ai_usage_log of the PY DB). Model: SEO_DRAFT_MODEL (default
// claude-opus-5-5). The answer is cleaned (lib/seoSites/sanitize.js): only <a href>/<strong>/<em>, links
// only to the site's own pages or Casa-Libre. A guide that names another portal is refused. No template
// fallback: a site guide is only published when Claude wrote it (a failure throws; Autopilot skips it).
// Server-only.
import 'server-only';
import { claudeClient } from '../aiTrack.js';
import { cleanGuide, namesCompetitor, linksCasaLibre } from './sanitize.js';
import { clLink, CTA_PATH, COUNTRY_NAME, VOICE } from './scope.js';

export const SITE_DRAFT_MODEL = process.env.SEO_DRAFT_MODEL || 'claude-opus-5-5';

const READER = {
  owners: 'property owners who want to sell their house, apartment or land (fast, at a good price, without mistakes)',
  agents: 'real-estate agents, brokers and agencies (getting listings, clients, commissions, marketing, starting an agency)',
  library: 'people who want to buy, rent or invest in property (prices, neighbourhoods, credit, paperwork)',
};

const SYSTEM = `You write practical Spanish guides for an independent real-estate guide website. Every guide links to Casa-Libre (a property marketplace: publish for free, contact by WhatsApp, app for iPhone and Android).
Rules:
- Spanish of the guide's country. Voice "voseo" = rioplatense/Paraguayan vos ("publicá", "tenés"); voice "tú" = tuteo ("publica", "tienes"). Never mix.
- Plain, useful, concrete. No hype, no superlatives. Answer the question in "answer" (2–4 sentences) first.
- NEVER invent numbers, prices, percentages, laws, fees, dates or institutions. For legal, notarial or tax points write that the reader should consult an escribano / notario / contador (e.g. "consultá con un escribano"), without figures.
- NEVER name any other website, portal, agency, franchise or competitor. The brand is written "Casa-Libre". Mention the Casa-Libre app for iPhone and Android once where natural.
- Link to Casa-Libre 1–3 times using EXACTLY the Casa-Libre URL given (as <a href="URL">…</a>). You may link to the site's own guides listed (href = their path). No other links.
- HTML allowed only inside "html" and "items": <a href>, <strong>, <em>. Everything else is plain text.
- 4–6 sections, each with 1–3 blocks; 3–5 FAQ; 3–5 summary bullets.
Return ONLY JSON: {"title": str (<=70 chars), "h1": str, "description": str (<=160 chars), "navLabel": str (<=40), "blurb": str (1 sentence), "answer": str, "summary": [str], "sections": [{"id": "kebab-case", "h2": str, "blocks": [{"t": "p", "html": str} | {"t": "ul", "items": [str]}]}], "faq": [{"q": str, "a": str}]}`;

/** ctx: { site, cc, term, slug, kind: 'guide'|'trend_post', news?, related?: [{ path, title }] } → the cleaned site guide. */
export async function writeSiteGuide(ctx) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const { site, cc, term, slug } = ctx;
  const client = await claudeClient({ feature: 'seo_site_guide', country: 'py' }, { timeout: 120000, maxRetries: 0 });
  const clUrl = clLink(site, cc, CTA_PATH[site.kind] || '/', slug);
  const user = [
    `Website: ${site.domain} — readers: ${READER[site.kind] || READER.library}.`,
    `Country of this guide: ${COUNTRY_NAME[cc]} (voice: ${VOICE[cc]}).`,
    ctx.kind === 'trend_post' ? `Topic trending in ${COUNTRY_NAME[cc]} now: "${term}". Explain what it means for the readers, without inventing facts beyond the headlines.` : `People search: "${term}". Write the guide that answers this search.`,
    ctx.news?.length ? `News headlines (facts you may rely on): ${ctx.news.map((n) => n.title).join(' | ')}` : '',
    `Casa-Libre URL to link: ${clUrl}`,
    ctx.related?.length ? `The site's own guides you may link to: ${ctx.related.slice(0, 8).map((r) => `${r.path} (${r.title})`).join('; ')}` : '',
  ].filter(Boolean).join('\n\n');
  const msg = await client.messages.create({ model: SITE_DRAFT_MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`Claude returned no JSON (stop: ${msg.stop_reason || '?'})`);
  const guide = cleanGuide(JSON.parse(m[0]), site, { cc, slug });
  if (namesCompetitor(guide)) throw new Error('Check failed: the guide names another portal or competitor');
  if (!linksCasaLibre(guide)) {
    const last = guide.sections[guide.sections.length - 1];
    const vos = VOICE[cc] === 'voseo';
    const line = site.kind === 'library'
      ? `${vos ? 'Mirá' : 'Mira'} las propiedades publicadas en <a href="${clUrl.replace(/&/g, '&amp;')}">Casa-Libre</a> y ${vos ? 'consultá' : 'consulta'} directo por WhatsApp, también desde la app para iPhone y Android.`
      : `<a href="${clUrl.replace(/&/g, '&amp;')}">${vos ? 'Publicá' : 'Publica'} gratis en Casa-Libre</a> y ${vos ? 'recibí' : 'recibe'} las consultas por WhatsApp, también desde la app para iPhone y Android.`;
    last.blocks.push({ t: 'p', html: line });
  }
  return { guide, model: msg.model || SITE_DRAFT_MODEL };
}
