// /api/campaigns — WhatsApp campaigns (admin → WhatsApp campaigns), like Relay's page.
// Each campaign is a BATCH of an audience (first N, skipping who an earlier batch had) or a
// re-send to an earlier batch.
//   GET  ?mode=live|test            → the campaigns (batches) of the active country + totals
//   GET  ?templates=1               → approved Utility / Marketing templates (Relay)
//   GET  ?audience=1&source=&segment=&mode=&template=&phones=&size=&skip=1&batch_filter=
//                                   → who this batch would reach
//   POST { name, template, language, audience:{source,segment,phones,size,skip,batch_filter},
//          variables:{header,body,button}, when: 'now'|'schedule'|'draft', send_at,
//          mode: 'live'|'test' } → create (+ send)
// Sending = Relay's POST /v1/campaigns: everyone who hasn't opted out receives it (Relay no
// longer needs an opt-in, 2026-10-29). Test mode: leads and users run on the simulation
// numbers (nobody real is messaged). Live: never the simulation numbers; never leads while
// WA_LEADS_LIVE is not '1' (decision: no marketing to leads yet).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relayTemplates } from '@/lib/relayAdmin';
import { audienceCounts, relayVariables, variablesProblem, campaignSlug, neededFields, pickBatch, simulateRecipients, liveProblem, skipReason, audienceLabel } from '@/lib/waCampaigns';
import { createCampaign, addRecipients, relayOptIns, loadAudience, sendCampaign, campaignsWithResults, batchedKeys, getCampaign } from '@/lib/waCampaignStore';
import { modeOf, inboxModes } from '@/lib/relayInbox';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bad = (error, status = 400) => NextResponse.json({ error }, { status });
const leadsLive = () => process.env.WA_LEADS_LIVE === '1';

async function templatesList() {
  const { configured, templates } = await relayTemplates();
  return { configured, templates: templates.filter((t) => t.status === 'APPROVED' && (t.category === 'utility' || t.category === 'marketing')) };
}

// People who opened each campaign's link (PostHog $pageview with its utm_campaign), one query.
async function clicksBySlug(slugs) {
  const ok = slugs.filter((s) => /^wc-[a-z0-9-]+$/.test(String(s || '')));
  if (!ok.length || !posthogConfigured()) return new Map();
  try {
    const rows = await hogql(`SELECT properties.utm_campaign, count(DISTINCT person_id) FROM events WHERE event = '$pageview' AND properties.utm_campaign IN (${ok.map((s) => `'${s}'`).join(',')}) AND timestamp >= now() - INTERVAL 120 DAY GROUP BY properties.utm_campaign`);
    return new Map((rows || []).map(([s, n]) => [s, Number(n) || 0]));
  } catch { return new Map(); }
}

// The batch: the audience, minus who earlier batches had (when asked), cut to the first N;
// in test mode leads / users moved onto the simulation numbers.
async function buildBatch({ source, segment, phones, size, skip, batchFilter, mode }) {
  const aud = await loadAudience({ source, segment: segment || 'all', phones: phones || '', mode, batchFilter });
  const done = skip && source !== 'batch' && source !== 'phones' ? await batchedKeys(mode) : new Set();
  const b = pickBatch(aud.recipients, { size: source === 'phones' ? 0 : size, done });
  const recipients = mode === 'test' ? simulateRecipients(b.batch) : b.batch;
  return { ...aud, recipients, range: { from: b.from, to: b.to, of: b.total, already: b.already, left: b.left } };
}

export async function GET(req) {
  if (!getSession()) return bad('unauthorized', 401);
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get('templates')) return NextResponse.json({ ...(await templatesList()), modes: inboxModes() });
    if (sp.get('audience')) {
      const mode = modeOf(sp.get('mode'));
      const [batch, opt, tpls] = await Promise.all([
        buildBatch({ source: sp.get('source'), segment: sp.get('segment'), phones: sp.get('phones'), size: Number(sp.get('size')) || 0, skip: sp.get('skip') === '1', batchFilter: sp.get('batch_filter') || 'all', mode }),
        relayOptIns(mode),
        templatesList(),
      ]);
      const tpl = tpls.templates.find((t) => t.name === sp.get('template'));
      let vmap = {};
      try { vmap = JSON.parse(sp.get('vars') || '{}'); } catch {}
      const counts = audienceCounts(batch.recipients, opt.map, batch.optedOut, { marketing: tpl?.category === 'marketing', fields: neededFields(vmap) });
      return NextResponse.json({
        ...counts, invalid: batch.invalid, range: batch.range, simulated: batch.recipients.filter((r) => r.sim).length,
        blocked: mode === 'live' ? liveProblem(batch.recipients, { leadsLive: leadsLive() }) : null,
        tags: opt.tags, relayContacts: opt.contacts,
        sample: batch.recipients.slice(0, 8).map((r) => ({ phone: r.phone, name: r.name, sim: !!r.sim, status: opt.map.get(r.phone) || 'not a contact yet' })),
      });
    }
    const all = await campaignsWithResults(clicksBySlug);
    const mode = sp.get('mode');
    return NextResponse.json({ campaigns: (mode ? all.filter((c) => c.mode === modeOf(mode)) : all).map((c) => ({ ...c, audience_label: audienceLabel(c.audience_def) })), modes: inboxModes(), leadsLive: leadsLive() });
  } catch (e) {
    return bad(String(e?.message || e), 502);
  }
}

export async function POST(req) {
  if (!getSession()) return bad('unauthorized', 401);
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || '').trim().slice(0, 120);
  const mode = modeOf(b.mode);
  const when = ['now', 'schedule', 'draft'].includes(b.when) ? b.when : 'now';
  if (!name) return bad('Give the campaign a name.');
  const { templates } = await templatesList().catch(() => ({ templates: [] }));
  const tpl = templates.find((t) => t.name === b.template);
  if (!tpl) return bad('Choose an approved template.');
  const problem = variablesProblem(tpl, b.variables || {});
  if (problem) return bad(problem);
  let sendAt = null;
  if (when === 'schedule') {
    const t = Date.parse(b.send_at);
    if (!t || t < Date.now() + 60_000) return bad('Pick a date and time in the future for the schedule.');
    sendAt = new Date(t).toISOString();
  }

  // the batch, frozen now (who it was meant for, even if the lists change later)
  const a = b.audience || {};
  const def = { source: a.source, segment: a.segment || 'all', size: Number(a.size) || 0, skip: !!a.skip, batch_filter: a.batch_filter || 'all' };
  let aud, opt;
  try {
    [aud, opt] = await Promise.all([
      buildBatch({ source: def.source, segment: def.segment, phones: a.phones, size: def.size, skip: def.skip, batchFilter: def.batch_filter, mode }),
      relayOptIns(mode),
    ]);
  } catch (e) { return bad(`Could not load the audience: ${e?.message || e}`, 502); }
  if (!aud.recipients.length) return bad(def.skip ? 'Nobody left: everyone in this audience was already in an earlier batch.' : 'The audience is empty.');
  if (mode === 'live') {
    const stop = liveProblem(aud.recipients, { leadsLive: leadsLive() });
    if (stop) return bad(stop, 403);
  }
  if (def.source === 'batch') def.from_batch_name = (await getCampaign(def.segment))?.name || null;
  def.range = aud.range;
  const optMap = opt.map;   // Relay's contacts are shared by live and test: the real opt-in either way
  const marketing = tpl.category === 'marketing';
  const fields = neededFields(b.variables || {});
  const slug = campaignSlug(name);
  const settings = {
    mode, state: when === 'draft' ? 'draft' : 'sending', language: tpl.language, category: tpl.category, slug,
    audience_def: def,
    variables_map: b.variables || {}, variables: relayVariables(b.variables || {}, slug),
    counts: { ...audienceCounts(aud.recipients, optMap, aud.optedOut, { marketing, fields }), simulated: aud.recipients.filter((r) => r.sim).length },
    send_at: sendAt, created_by: (getSession()?.email || null),
  };
  const camp = await createCampaign({ name, template: tpl.name, settings });
  await addRecipients(camp, aud.recipients, optMap, aud.optedOut, marketing, b.variables || {});
  if (when === 'draft') return NextResponse.json({ ok: true, id: camp.id, state: 'draft' });

  const sendTo = aud.recipients.filter((r) => !skipReason(r, optMap, aud.optedOut, { marketing, fields }));
  if (!sendTo.length) return NextResponse.json({ ok: false, id: camp.id, error: 'Nobody in this batch can receive it (opted out / missing a value).' });
  return NextResponse.json(await sendCampaign(camp.id, { mode, recipients: sendTo, settings: { ...settings, name, template: tpl.name } }));
}
