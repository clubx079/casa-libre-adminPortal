// AI SEO for the sites — the changes the pipeline (or a person) makes on ONE site, each logged in
// seo_changes (country 'site:<key>', with what it replaced) and revertible with one click. Rows live in
// the PY DB (lib/seo/store.js routes 'site:*' there). Every change queues a publish ping to the site
// (lib/seoSites/remote.js: one ping per run while a batch is open, else at once). Server-only.
//   createGuide(key, opp)             Claude writes the guide (site format) → seo_drafts (status draft)
//   approveGuide / rejectDraft / regenerateDraft / updateDraft   the Drafts tab (approve = published)
//   setTitle(key, path, title)        title / H1 override of a guide (max once per titleDays)
//   addLinks(key, path)               "strengthen": link the guide from up to 5 related guides (extraLinks)
//   applyOpportunity / dismissOpportunity / revertChange
import 'server-only';
import { seoDb, getOverride, getOverrides, putOverride, snapshot, logChange, loadSettings } from '../seo/store.js';
import { canChangeTitle, cleanTitle } from '../seo/guards.js';
import { scopeOf, siteFor, guidePath, parseGuidePath } from './scope.js';
import { relatedGuides } from './relevance.js';
import { cleanGuide } from './sanitize.js';
import { guideToRow } from './shape.js';
import { knownGuides } from './decide.js';
import { writeSiteGuide } from './claude.js';
import { fetchCatalog, queuePaths } from './remote.js';

const enc = encodeURIComponent;
const nowIso = () => new Date().toISOString();
const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
const ctxOf = (key) => { const site = siteFor(key); if (!site) fail('unknown site'); return { site, scope: scopeOf(site.key), q: enc(scopeOf(site.key)) }; };
const draftPath = (site, d) => guidePath(site, d?.related?.cc || site.rootCountry, d.slug);

/** Every guide of the site the admin knows (static catalog + pipeline drafts) — for links and coverage. */
export async function siteGuides(key, { approvedOnly = true } = {}) {
  const { site, q } = ctxOf(key);
  const [cat, drafts] = await Promise.all([
    fetchCatalog(site.key),
    seoDb('py').select('seo_drafts', `select=slug,title,h1,status,related&country=eq.${q}&limit=5000`),
  ]);
  const all = knownGuides(site, cat.guides, drafts);
  return { guides: approvedOnly ? all.filter((g) => g.status === 'approved') : all, catalog: cat };
}

// ── guides ──
async function writeFor(site, opp, slug, cc) {
  const { guides } = await siteGuides(site.key);
  const related = relatedGuides({ title: opp.term, slug, cc, path: guidePath(site, cc, slug) }, guides, 8).map((g) => ({ path: g.path, title: g.title }));
  return writeSiteGuide({ site, cc, term: opp.term, slug, kind: opp.type === 'trend_post' ? 'trend_post' : 'guide', news: opp.evidence?.news || [], related });
}

export async function createGuide(key, opp, { by } = {}) {
  const { site, scope, q } = ctxOf(key);
  const settings = await loadSettings(scope);
  if (!settings.drafts.claude) fail('Claude drafts are switched off in Settings (site guides are only written by Claude)');
  const slug = opp.parsed?.slug;
  const cc = site.countries.includes(opp.parsed?.cc) ? opp.parsed.cc : site.rootCountry;
  if (!slug) fail('the opportunity has no slug');
  const [exists] = await seoDb('py').select('seo_drafts', `select=id,status&country=eq.${q}&slug=eq.${enc(slug)}&limit=1`);
  if (exists) fail(`a guide with this address already exists (${exists.status})`);
  const { guide, model } = await writeFor(site, opp, slug, cc);
  const [row] = await seoDb('py').insert('seo_drafts', [{ ...guideToRow(scope, guide, { kind: opp.type === 'trend_post' ? 'trend_post' : 'guide', term: opp.term, source: 'claude', model }), status: 'draft', opportunity_id: opp.id || null, created_at: nowIso() }]);
  return row;
}

export async function regenerateDraft(key, id) {
  const { site, scope, q } = ctxOf(key);
  const [cur] = await seoDb('py').select('seo_drafts', `select=*&country=eq.${q}&id=eq.${enc(id)}&limit=1`);
  if (!cur) fail('draft not found');
  if (cur.status === 'approved') fail('unpublish it first (revert the publish change)');
  const cc = cur.related?.cc || site.rootCountry;
  const { guide, model } = await writeFor(site, { term: cur.term || cur.h1, type: cur.kind === 'trend_post' ? 'trend_post' : 'write_guide' }, cur.slug, cc);
  await seoDb('py').update('seo_drafts', `id=eq.${enc(id)}`, guideToRow(scope, guide, { kind: cur.kind, term: cur.term, source: 'claude', model }), { returning: 'minimal' });
  return { source: 'claude', note: null };
}

const EDITABLE = ['title', 'h1', 'description', 'answer', 'sections', 'faq'];
export async function updateDraft(key, id, patch = {}) {
  const { site, scope, q } = ctxOf(key);
  const [cur] = await seoDb('py').select('seo_drafts', `select=*&country=eq.${q}&id=eq.${enc(id)}&limit=1`);
  if (!cur) fail('draft not found');
  if (patch.sections && !Array.isArray(patch.sections)) fail('sections must be a list');
  if (patch.faq && !Array.isArray(patch.faq)) fail('faq must be a list');
  const rel = cur.related && !Array.isArray(cur.related) ? cur.related : {};
  const merged = { ...cur, ...Object.fromEntries(EDITABLE.filter((k) => k in patch).map((k) => [k, patch[k]])) };
  let g;
  try {
    g = cleanGuide({ ...merged, cc: rel.cc, navLabel: rel.navLabel, blurb: rel.blurb, summary: rel.summary }, site, { cc: rel.cc || site.rootCountry, slug: cur.slug });
  } catch (e) { fail(`Check failed: ${e.message}`); }
  // `related` (cc, navLabel, blurb, summary) is kept as it was
  await seoDb('py').update('seo_drafts', `id=eq.${enc(id)}`, { title: g.title, h1: g.h1, description: g.description, answer: g.answer, sections: g.sections, faq: g.faq, updated_at: nowIso() }, { returning: 'minimal' });
  return cur.status === 'approved' ? { ok: true, publish: await queuePaths(site.key, [draftPath(site, cur)]) } : { ok: true };
}

export async function approveGuide(key, id, { by } = {}) {
  const { site, scope, q } = ctxOf(key);
  const [d] = await seoDb('py').select('seo_drafts', `select=*&country=eq.${q}&id=eq.${enc(id)}&limit=1`);
  if (!d) fail('draft not found');
  if (d.status === 'approved') fail('already published');
  if (!d.title || !d.h1 || !(d.sections || []).length) fail('Check failed: title, H1 and at least one section are needed');
  await seoDb('py').update('seo_drafts', `id=eq.${enc(id)}`, { status: 'approved', approved_at: nowIso(), approved_by: by || null, updated_at: nowIso() }, { returning: 'minimal' });
  const path = draftPath(site, d);
  const change = await logChange(scope, { path, action: 'publish_guide', before: { draft_id: id, status: d.status }, after: { draft_id: id, status: 'approved' }, reason: `published "${d.h1}"`, by, opportunityId: d.opportunity_id });
  return { change, path, publish: await queuePaths(site.key, [path]) };
}

export async function rejectDraft(key, id) {
  const { q } = ctxOf(key);
  await seoDb('py').update('seo_drafts', `id=eq.${enc(id)}&country=eq.${q}&status=eq.draft`, { status: 'rejected', updated_at: nowIso() }, { returning: 'minimal' });
  return { ok: true };
}

// ── titles ──
export async function setTitle(key, path, title, { by, reason, opportunityId, h1 } = {}) {
  const { site, scope } = ctxOf(key);
  if (!parseGuidePath(site, path)) fail('not a guide address of this site');
  const t = cleanTitle(title);
  if (!t) fail('title must be 15–70 characters');
  const prev = await getOverride(scope, path);
  const settings = await loadSettings(scope);
  const rl = canChangeTitle(prev, new Date(), settings.thresholds.titleDays);
  if (!rl.ok) fail(`Check failed: this page's title was changed less than ${settings.thresholds.titleDays} days ago (next change from ${rl.nextAt.slice(0, 10)})`);
  const { next } = await putOverride(scope, path, { title: t, h1: h1 !== undefined ? h1 : t, title_changed_at: nowIso() });
  const change = await logChange(scope, { path, action: 'set_title', before: snapshot(prev), after: snapshot(next), reason, by, opportunityId });
  return { change, publish: await queuePaths(site.key, [path]) };
}

// ── strengthen: links to the guide from up to 5 related guides of the same country ──
export async function addLinks(key, path, { by, reason, opportunityId } = {}) {
  const { site, scope } = ctxOf(key);
  const { guides } = await siteGuides(site.key);
  const target = guides.find((g) => g.path === path);
  if (!target) fail('not a live guide of this site');
  const overrides = await getOverrides(scope);
  const hosts = relatedGuides(target, guides, 5);
  if (!hosts.length) fail('no related guide to link from');
  const label = String(overrides.get(path)?.h1 || target.h1 || target.title).slice(0, 120);
  const before = {}; const after = {};
  for (const h of hosts) {
    const prev = overrides.get(h.path) || null;
    const links = Array.isArray(prev?.extra_links) ? prev.extra_links : [];
    if (links.some((l) => l.href === path)) continue;
    const { next } = await putOverride(scope, h.path, { extra_links: [...links, { href: path, label }].slice(-8) });
    before[h.path] = snapshot(prev); after[h.path] = snapshot(next);
  }
  if (!Object.keys(after).length) fail('already linked from the related guides');
  const change = await logChange(scope, { path, action: 'add_links', before: { pages: before }, after: { pages: after }, reason: reason || `link ${path} from ${Object.keys(after).length} related guides`, by, opportunityId });
  return { change, publish: await queuePaths(site.key, [path, ...Object.keys(after)]) };
}

// ── opportunities ──
export async function applyOpportunity(key, id, { by } = {}) {
  const { q } = ctxOf(key);
  const [o] = await seoDb('py').select('seo_opportunities', `select=*&country=eq.${q}&id=eq.${enc(id)}&limit=1`);
  if (!o) fail('opportunity not found');
  if (o.status !== 'open') fail(`already ${o.status}`);
  const meta = { by, opportunityId: o.id, reason: `${o.type}: "${o.term}" (score ${o.score})` };
  let result;
  if (o.type === 'strengthen_page') result = await addLinks(key, o.url, meta);
  else if (o.type === 'new_title') result = await setTitle(key, o.url, o.evidence?.title || o.parsed?.title, meta);
  else if (o.type === 'write_guide' || o.type === 'trend_post') result = { draft: await createGuide(key, o, { by }) };
  else fail('unknown type for a site');
  await seoDb('py').update('seo_opportunities', `id=eq.${enc(id)}`, { status: 'applied', decided_at: nowIso(), decided_by: by || null, updated_at: nowIso() }, { returning: 'minimal' });
  return result;
}

export async function dismissOpportunity(key, id, { by } = {}) {
  const { q } = ctxOf(key);
  await seoDb('py').update('seo_opportunities', `id=eq.${enc(id)}&country=eq.${q}`, { status: 'dismissed', decided_at: nowIso(), decided_by: by || null, updated_at: nowIso() }, { returning: 'minimal' });
  return { ok: true };
}

// ── revert ──
const RESTORE_EMPTY = { title: null, h1: null, description: null, enabled_variants: [], retired_variants: [], extra_links: [], title_changed_at: null };
const changedFields = (a, b) => Object.keys(RESTORE_EMPTY).filter((k) => JSON.stringify((a || {})[k] ?? RESTORE_EMPTY[k]) !== JSON.stringify((b || {})[k] ?? RESTORE_EMPTY[k]));
export async function revertChange(key, id, { by } = {}) {
  const { site, scope, q } = ctxOf(key);
  const [c] = await seoDb('py').select('seo_changes', `select=*&country=eq.${q}&id=eq.${enc(id)}&limit=1`);
  if (!c) fail('change not found');
  if (c.reverted_at) fail('already reverted');
  const paths = [c.path];
  if (c.action === 'publish_guide') {
    await seoDb('py').update('seo_drafts', `id=eq.${enc(c.before?.draft_id)}&country=eq.${q}`, { status: c.before?.status || 'draft', updated_at: nowIso() }, { returning: 'minimal' });
  } else if (c.action === 'add_links') {
    for (const [host, snap] of Object.entries(c.before?.pages || {})) { await putOverride(scope, host, snap || RESTORE_EMPTY); paths.push(host); }
  } else {
    const touched = changedFields(c.before, c.after);
    const newer = await seoDb('py').select('seo_changes', `select=id,before,after,created_at&country=eq.${q}&path=eq.${enc(c.path)}&reverted_at=is.null&created_at=gt.${enc(c.created_at)}&limit=50`);
    if (newer.find((n) => changedFields(n.before, n.after).some((k) => touched.includes(k)))) fail('a newer change on the same field of this page must be reverted first');
    await putOverride(scope, c.path, Object.fromEntries(touched.map((k) => [k, c.before ? (c.before[k] ?? RESTORE_EMPTY[k]) : RESTORE_EMPTY[k]])));
  }
  await seoDb('py').update('seo_changes', `id=eq.${enc(id)}`, { reverted_at: nowIso(), reverted_by: by || null }, { returning: 'minimal' });
  return { ok: true, publish: await queuePaths(site.key, paths) };
}
