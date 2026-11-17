// Stages 4–6 — the changes the pipeline makes, each through the Check guardrails, logged in
// seo_changes (with what it replaced) and revertible with one click. Server-only.
//   enableVariant / retireVariant   switch a page variant on (index) / off (noindex)
//   setTitle                        title + H1 override (max once per 14 days per page)
//   addLinks                        "strengthen": link the page from up to 5 related live pages
//   createDraft / regenerateDraft / updateDraft / approveDraft / rejectDraft   guide drafts → /guias
//   applyOpportunity / dismissOpportunity   the Opportunities tab buttons
//   revertChange                    undo any logged change
import 'server-only';
import { seoDb, getOverride, getOverrides, putOverride, snapshot, logChange, loadSettings } from './store.js';
import { loadInventory } from './data.js';
import { notifyWebsite } from './website.js';
import { canChangeTitle, canEnableVariant, cleanTitle } from './guards.js';
import { parsePath, pathOf, OPS, TIPOS, VARIANTS, MIN_LISTINGS } from './matrix.js';
import { pageState } from './inventory.js';
import { templateDraft, slugForTerm } from './draftTemplate.js';
import { draftWithClaude } from './claude.js';
import { citiesFor, PLACES } from './places.js';

const enc = encodeURIComponent;
const nowIso = () => new Date().toISOString();
const fail = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
const publishNote = async (cc, urls, settings) => notifyWebsite(cc, urls, { indexNow: (settings || await loadSettings(cc)).publish.indexNow });

// ── variants ──
export async function enableVariant(cc, path, { by, reason, opportunityId } = {}) {
  const p = parsePath(path);
  if (!p?.variant) fail('not a variant page');
  const inv = await loadInventory(cc, { fresh: true });
  const count = inv.get(path)?.count || 0;
  const ok = canEnableVariant(path, count, MIN_LISTINGS);
  if (!ok.ok) fail(`Check failed: ${ok.why}`);
  const base = pathOf({ op: p.op, tipo: p.tipo, ciudad: p.ciudad });
  if (!(inv.get(base)?.count > 0)) fail('the base page has no listings');
  const prev = await getOverride(cc, base);
  if ((prev?.enabled_variants || []).includes(p.variant)) fail('already switched on');
  const { next } = await putOverride(cc, base, {
    enabled_variants: [...new Set([...(prev?.enabled_variants || []), p.variant])],
    retired_variants: (prev?.retired_variants || []).filter((v) => v !== p.variant),
  });
  const change = await logChange(cc, { path: base, action: 'enable_variant', before: snapshot(prev), after: snapshot(next), reason: reason || `switch on ${path} (${count} listings)`, by, opportunityId });
  const pub = await publishNote(cc, [path, base]);
  return { change, count, publish: pub };
}

export async function retireVariant(cc, path, { by, reason, opportunityId } = {}) {
  const p = parsePath(path);
  if (!p?.variant) fail('not a variant page');
  const base = pathOf({ op: p.op, tipo: p.tipo, ciudad: p.ciudad });
  const prev = await getOverride(cc, base);
  if (!(prev?.enabled_variants || []).includes(p.variant)) fail('not switched on');
  const { next } = await putOverride(cc, base, {
    enabled_variants: prev.enabled_variants.filter((v) => v !== p.variant),
    retired_variants: [...new Set([...(prev.retired_variants || []), p.variant])],
  });
  const change = await logChange(cc, { path: base, action: 'retire_variant', before: snapshot(prev), after: snapshot(next), reason: reason || `hide ${path} (noindex)`, by, opportunityId });
  return { change, publish: await publishNote(cc, [path]) };
}

// ── titles ──
export async function setTitle(cc, path, title, { by, reason, opportunityId, h1 } = {}) {
  const t = cleanTitle(title);
  if (!t) fail('title must be 15–70 characters');
  const prev = await getOverride(cc, path);
  const settings = await loadSettings(cc);
  const rl = canChangeTitle(prev, new Date(), settings.thresholds.titleDays);
  if (!rl.ok) fail(`Check failed: this page's title was changed less than ${settings.thresholds.titleDays} days ago (next change from ${rl.nextAt.slice(0, 10)})`);
  const heading = h1 !== undefined ? h1 : t.replace(/\s+—\s+\{count\}.*$/, '');
  const { next } = await putOverride(cc, path, { title: t, h1: heading || null, title_changed_at: nowIso() });
  const change = await logChange(cc, { path, action: 'set_title', before: snapshot(prev), after: snapshot(next), reason, by, opportunityId });
  return { change, publish: await publishNote(cc, [path], settings) };
}

// ── strengthen: more internal links to the page ──
export async function addLinks(cc, path, { by, reason, opportunityId } = {}) {
  const target = parsePath(path);
  const inv = await loadInventory(cc);
  const overrides = await getOverrides(cc);
  const label = target ? labelFor(cc, target, inv.get(path)) : path;
  // related live pages: same city other types, same type other cities, the base page of a variant/barrio
  const live = [...inv.values()].filter((r) => r.path !== path && pageState(r.path, inv, overrides).indexable && r.level === 'city');
  const score = (r) => (target ? (r.ciudad === target.ciudad ? 2 : 0) + (r.tipo === target.tipo ? 1 : 0) + (r.op === target.op ? 1 : 0) : 0) + Math.min(1, r.count / 100);
  const hosts = live.sort((a, b) => score(b) - score(a)).slice(0, 5).map((r) => r.path);
  if (!hosts.length) fail('no related live page to link from');
  const before = {};
  const after = {};
  for (const host of hosts) {
    const prev = overrides.get(host) || null;
    const links = Array.isArray(prev?.extra_links) ? prev.extra_links : [];
    if (links.some((l) => l.href === path)) continue;
    const { next } = await putOverride(cc, host, { extra_links: [...links, { href: path, label }].slice(-8) });
    before[host] = snapshot(prev);
    after[host] = snapshot(next);
  }
  if (!Object.keys(after).length) fail('already linked from the related pages');
  const change = await logChange(cc, { path, action: 'add_links', before: { pages: before }, after: { pages: after }, reason: reason || `link ${path} from ${Object.keys(after).length} related pages`, by, opportunityId });
  return { change, publish: await publishNote(cc, [path, ...Object.keys(after)]) };
}

function labelFor(cc, p, inv) {
  const city = citiesFor(cc).find((c) => c.slug === p.ciudad)?.name || p.ciudad;
  const base = `${OPS[p.op].short} de ${TIPOS[p.tipo].plural} en ${p.barrio ? `${inv?.barrioName || p.barrio}, ` : ''}${city}`;
  return p.variant ? `${base} ${VARIANTS[p.variant].label}` : base;
}

// ── drafts ──
function draftContext(cc, opp, inv) {
  const cities = citiesFor(cc);
  const countryName = PLACES[cc]?.name || 'Paraguay';
  const capital = cities[0];
  const parsed = opp.parsed || {};
  const city = cities.find((c) => c.slug === parsed.ciudad) || null;
  return {
    term: opp.term, kind: opp.type === 'trend_post' ? 'trend_post' : 'guide', parsed: { ...parsed, slug: parsed.slug || slugForTerm(opp.term) },
    countryName, cityName: city?.name || capital?.name, capitalSlug: capital?.slug, capitalName: capital?.name, news: opp.evidence?.news || [], inv,
  };
}

async function writeDraft(cc, ctx, { useClaude }) {
  const tpl = templateDraft(ctx);
  const s = tpl.answerPath ? ctx.inv.get(tpl.answerPath) : null;
  const stats = s ? { count: s.count, median: s.median, min: s.min, max: s.max, newest: s.newest } : null;
  if (!useClaude) return { ...tpl, source: 'template', model: null, note: 'Template draft (Claude switched off).' };
  try {
    const d = await draftWithClaude({ ...ctx, stats }, tpl, { country: cc });
    return { ...d, source: 'claude', note: null };
  } catch (e) {
    return { ...tpl, source: 'template', model: null, note: `Claude unavailable (${String(e?.message || e).slice(0, 160)}) — template draft from the data. Use "Regenerate with Claude" later.` };
  }
}

const draftRow = (cc, d, extra = {}) => ({
  country: cc, slug: d.slug, kind: d.kind, term: d.term, title: d.title, h1: d.h1, description: d.description, answer: d.answer,
  sections: d.sections, faq: d.faq, related: d.related, source: d.source, model: d.model, note: d.note, updated_at: nowIso(), ...extra,
});

export async function createDraft(cc, opp, { by, useClaude } = {}) {
  const settings = await loadSettings(cc);
  const inv = await loadInventory(cc);
  const ctx = draftContext(cc, opp, inv);
  const [exists] = await seoDb(cc).select('seo_drafts', `select=id,status&country=eq.${cc}&slug=eq.${enc(ctx.parsed.slug)}&limit=1`);
  if (exists) fail(`a draft with this address already exists (${exists.status})`);
  const d = await writeDraft(cc, ctx, { useClaude: useClaude ?? settings.drafts.claude });
  const [row] = await seoDb(cc).insert('seo_drafts', [draftRow(cc, d, { status: 'draft', opportunity_id: opp.id || null, created_at: nowIso() })]);
  return row;
}

export async function regenerateDraft(cc, id, { by } = {}) {
  const [cur] = await seoDb(cc).select('seo_drafts', `select=*&country=eq.${cc}&id=eq.${enc(id)}&limit=1`);
  if (!cur) fail('draft not found');
  if (cur.status === 'approved') fail('unpublish it first (revert the publish change)');
  const inv = await loadInventory(cc);
  let opp = null;
  if (cur.opportunity_id) [opp] = await seoDb(cc).select('seo_opportunities', `select=*&id=eq.${enc(cur.opportunity_id)}&limit=1`);
  const ctx = draftContext(cc, opp || { term: cur.term || cur.h1, type: cur.kind === 'trend_post' ? 'trend_post' : 'write_guide', parsed: { slug: cur.slug } }, inv);
  ctx.parsed.slug = cur.slug;
  const d = await writeDraft(cc, ctx, { useClaude: true });
  await seoDb(cc).update('seo_drafts', `id=eq.${enc(id)}`, draftRow(cc, d), { returning: 'minimal' });
  return { source: d.source, note: d.note };
}

const EDITABLE = ['title', 'h1', 'description', 'answer', 'sections', 'faq'];
export async function updateDraft(cc, id, patch) {
  const clean = Object.fromEntries(EDITABLE.filter((k) => k in (patch || {})).map((k) => [k, patch[k]]));
  if (clean.sections && !Array.isArray(clean.sections)) fail('sections must be a list');
  if (clean.faq && !Array.isArray(clean.faq)) fail('faq must be a list');
  const [row] = await seoDb(cc).update('seo_drafts', `id=eq.${enc(id)}&country=eq.${cc}`, { ...clean, updated_at: nowIso() });
  // an edit to a published guide is live at once
  return row?.status === 'approved' ? { ok: true, publish: await publishNote(cc, [`/guias/${row.slug}`]) } : { ok: true };
}

export async function approveDraft(cc, id, { by } = {}) {
  const [d] = await seoDb(cc).select('seo_drafts', `select=*&country=eq.${cc}&id=eq.${enc(id)}&limit=1`);
  if (!d) fail('draft not found');
  if (d.status === 'approved') fail('already published');
  if (!d.title || !d.h1 || !(d.sections || []).length) fail('Check failed: title, H1 and at least one section are needed');
  await seoDb(cc).update('seo_drafts', `id=eq.${enc(id)}`, { status: 'approved', approved_at: nowIso(), approved_by: by || null, updated_at: nowIso() }, { returning: 'minimal' });
  const path = `/guias/${d.slug}`;
  const change = await logChange(cc, { path, action: 'publish_guide', before: { draft_id: id, status: d.status }, after: { draft_id: id, status: 'approved' }, reason: `approved "${d.h1}"`, by, opportunityId: d.opportunity_id });
  return { change, publish: await publishNote(cc, [path, '/guias']) };
}

export async function rejectDraft(cc, id, { by } = {}) {
  await seoDb(cc).update('seo_drafts', `id=eq.${enc(id)}&country=eq.${cc}&status=eq.draft`, { status: 'rejected', updated_at: nowIso() }, { returning: 'minimal' });
  return { ok: true };
}

// ── opportunities ──
export async function applyOpportunity(cc, id, { by } = {}) {
  const [o] = await seoDb(cc).select('seo_opportunities', `select=*&country=eq.${cc}&id=eq.${enc(id)}&limit=1`);
  if (!o) fail('opportunity not found');
  if (o.status !== 'open') fail(`already ${o.status}`);
  const meta = { by, opportunityId: o.id, reason: `${o.type}: "${o.term}" (score ${o.score})` };
  let result;
  if (o.type === 'create_variant') result = await enableVariant(cc, o.url, meta);
  else if (o.type === 'strengthen_page') result = await addLinks(cc, o.url, meta);
  else if (o.type === 'new_title') result = await setTitle(cc, o.url, o.evidence?.title || o.parsed?.title, meta);
  else if (o.type === 'retire_variant') result = await retireVariant(cc, o.url, meta);
  else if (o.type === 'write_guide' || o.type === 'trend_post') result = { draft: await createDraft(cc, o, { by }) };
  else if (o.type === 'lower_bid_suggestion') result = { note: 'Suggestion only: lower this search term\'s bid in Google Ads yourself — the pipeline never changes ads.' };
  else fail('unknown type');
  await seoDb(cc).update('seo_opportunities', `id=eq.${enc(id)}`, { status: 'applied', decided_at: nowIso(), decided_by: by || null, updated_at: nowIso() }, { returning: 'minimal' });
  return result;
}

export async function dismissOpportunity(cc, id, { by } = {}) {
  await seoDb(cc).update('seo_opportunities', `id=eq.${enc(id)}&country=eq.${cc}`, { status: 'dismissed', decided_at: nowIso(), decided_by: by || null, updated_at: nowIso() }, { returning: 'minimal' });
  return { ok: true };
}

// ── revert ──
const changedFields = (a, b) => Object.keys(RESTORE_EMPTY).filter((k) => JSON.stringify((a || {})[k] ?? RESTORE_EMPTY[k]) !== JSON.stringify((b || {})[k] ?? RESTORE_EMPTY[k]));
const RESTORE_EMPTY = { title: null, h1: null, description: null, enabled_variants: [], retired_variants: [], extra_links: [], title_changed_at: null };
export async function revertChange(cc, id, { by } = {}) {
  const [c] = await seoDb(cc).select('seo_changes', `select=*&country=eq.${cc}&id=eq.${enc(id)}&limit=1`);
  if (!c) fail('change not found');
  if (c.reverted_at) fail('already reverted');
  const urls = [c.path];
  if (c.action === 'publish_guide') {
    await seoDb(cc).update('seo_drafts', `id=eq.${enc(c.before?.draft_id)}`, { status: c.before?.status || 'draft', updated_at: nowIso() }, { returning: 'minimal' });
    urls.push('/guias');
  } else if (c.action === 'add_links') {
    for (const [host, snap] of Object.entries(c.before?.pages || {})) { await putOverride(cc, host, snap || RESTORE_EMPTY); urls.push(host); }
  } else {
    // restore only the fields this change touched; refuse if a newer, still-live change touched them too
    const touched = changedFields(c.before, c.after);
    const newer = await seoDb(cc).select('seo_changes', `select=id,before,after,created_at&country=eq.${cc}&path=eq.${enc(c.path)}&reverted_at=is.null&created_at=gt.${enc(c.created_at)}&limit=50`);
    const clash = newer.find((n) => changedFields(n.before, n.after).some((k) => touched.includes(k)));
    if (clash) fail('a newer change on the same field of this page must be reverted first');
    const restore = Object.fromEntries(touched.map((k) => [k, c.before ? (c.before[k] ?? RESTORE_EMPTY[k]) : RESTORE_EMPTY[k]]));
    await putOverride(cc, c.path, restore);
    for (const v of [...(c.after?.enabled_variants || []), ...(c.after?.retired_variants || [])]) urls.push(`${c.path}/${v}`);
  }
  await seoDb(cc).update('seo_changes', `id=eq.${enc(id)}`, { reverted_at: nowIso(), reverted_by: by || null }, { returning: 'minimal' });
  return { ok: true, publish: await publishNote(cc, urls) };
}
