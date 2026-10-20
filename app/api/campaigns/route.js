// /api/campaigns — WhatsApp campaigns (admin → WhatsApp campaigns), like Relay's page.
//   GET  ?mode=live|test            → the campaigns of the active country
//   GET  ?templates=1               → approved Utility / Marketing templates (Relay)
//   GET  ?audience=1&source=&segment=&mode=&template=&phones= → who would receive it
//   POST { name, template, language, audience:{source,segment,phones}, variables:{body,button},
//          when: 'now'|'schedule'|'draft', send_at, mode: 'live'|'test' } → create (+ send)
// Sending = Relay's POST /v1/campaigns: only opted-in contacts receive it.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relayTemplates } from '@/lib/relayAdmin';
import { audienceCounts, relayVariables, variablesProblem, campaignSlug, neededFields } from '@/lib/waCampaigns';
import { listCampaigns, createCampaign, addRecipients, relayOptIns, loadAudience, sendCampaign } from '@/lib/waCampaignStore';
import { modeOf, inboxModes } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bad = (error, status = 400) => NextResponse.json({ error }, { status });

async function templatesList() {
  const { configured, templates } = await relayTemplates();
  return { configured, templates: templates.filter((t) => t.status === 'APPROVED' && (t.category === 'utility' || t.category === 'marketing')) };
}

export async function GET(req) {
  if (!getSession()) return bad('unauthorized', 401);
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get('templates')) return NextResponse.json({ ...(await templatesList()), modes: inboxModes() });
    if (sp.get('audience')) {
      const mode = modeOf(sp.get('mode'));
      const [{ recipients, invalid, optedOut }, opt, tpls] = await Promise.all([
        loadAudience({ source: sp.get('source'), segment: sp.get('segment') || 'all', phones: sp.get('phones') || '', mode }),
        relayOptIns(mode),
        templatesList(),
      ]);
      const tpl = tpls.templates.find((t) => t.name === sp.get('template'));
      let vmap = {};
      try { vmap = JSON.parse(sp.get('vars') || '{}'); } catch {}
      const counts = audienceCounts(recipients, opt.map, optedOut, { marketing: tpl?.category === 'marketing', fields: neededFields(vmap) });
      return NextResponse.json({ ...counts, invalid, tags: opt.tags, relayContacts: opt.contacts, sample: recipients.slice(0, 8).map((r) => ({ phone: r.phone, name: r.name, status: opt.map.get(r.phone) || 'not a contact yet' })) });
    }
    const all = await listCampaigns();
    const mode = sp.get('mode');
    return NextResponse.json({ campaigns: mode ? all.filter((c) => c.mode === modeOf(mode)) : all, modes: inboxModes() });
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
  // The grabbed leads never opted in: no campaign (live OR test) goes to their numbers for
  // now — the audience can be previewed, not sent or saved. Decision 2026-10-21.
  if (b.audience?.source === 'leads') return bad('Leads can\'t receive WhatsApp campaigns yet (no opt-in). Preview only.', 403);
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

  // the audience, frozen now (who it was meant for, even if the lists change later)
  let aud, opt;
  try {
    [aud, opt] = await Promise.all([
      loadAudience({ source: b.audience?.source, segment: b.audience?.segment || 'all', phones: b.audience?.phones || '', mode }),
      relayOptIns(mode),
    ]);
  } catch (e) { return bad(`Could not load the audience: ${e?.message || e}`, 502); }
  if (!aud.recipients.length) return bad('The audience is empty.');
  const optMap = opt.map;   // Relay's contacts are shared by live and test: the real opt-in either way
  const marketing = tpl.category === 'marketing';
  const slug = campaignSlug(name);
  const settings = {
    mode, state: when === 'draft' ? 'draft' : 'sending', language: tpl.language, category: tpl.category, slug,
    audience_def: { source: b.audience?.source, segment: b.audience?.segment || 'all' },
    variables_map: b.variables || {}, variables: relayVariables(b.variables || {}, slug),
    counts: audienceCounts(aud.recipients, optMap, aud.optedOut, { marketing, fields: neededFields(b.variables || {}) }),
    send_at: sendAt, created_by: (getSession()?.email || null),
  };
  const camp = await createCampaign({ name, template: tpl.name, settings });
  await addRecipients(camp, aud.recipients, optMap, aud.optedOut, marketing, b.variables || {});
  if (when === 'draft') return NextResponse.json({ ok: true, id: camp.id, state: 'draft' });

  return NextResponse.json(await sendCampaign(camp.id, { mode, recipients: aud.recipients, settings: { ...settings, name, template: tpl.name } }));
}
