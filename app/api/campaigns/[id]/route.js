// /api/campaigns/[id]
//   GET                         → the campaign, its recipients and results
//   POST { action: 'refresh' }  → read each recipient's Relay conversation (status, reply)
//   POST { action: 'send' }     → send a draft now
//   DELETE                      → remove a draft / the admin's record (not Relay's)
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { campaignResults, liveProblem, audienceLabel } from '@/lib/waCampaigns';
import { getCampaign, listRecipients, refreshResults, deleteCampaign, saveCampaign, sendCampaign } from '@/lib/waCampaignStore';
import { batchClicks } from '@/lib/waCampaignClicks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bad = (error, status = 400) => NextResponse.json({ error }, { status });

// People who opened this batch's link (lib/waCampaignClicks.js).
async function clicksFor(c) {
  const { clicks, note } = await batchClicks([c?.slug]);
  return { clickers: clicks.get(c?.slug) || 0, note };
}

export async function GET(_req, { params }) {
  if (!getSession()) return bad('unauthorized', 401);
  const c = await getCampaign(params.id);
  if (!c) return bad('not_found', 404);
  const [recipients, clicks] = await Promise.all([listRecipients(c.id), clicksFor(c)]);
  return NextResponse.json({ campaign: { ...c, audience_label: audienceLabel(c.audience_def) }, results: campaignResults(recipients, clicks.clickers), clicks, recipients });
}

export async function POST(req, { params }) {
  if (!getSession()) return bad('unauthorized', 401);
  const c = await getCampaign(params.id);
  if (!c) return bad('not_found', 404);
  const { action } = await req.json().catch(() => ({}));
  if (action === 'refresh') {
    if (c.state === 'draft') return bad('This campaign is a draft: nothing was sent yet.');
    if (c.demo) return bad('Demo batch: sample numbers, nothing was sent, so there is nothing to read from Relay.');
    return NextResponse.json({ ok: true, ...(await refreshResults(c)) });
  }
  if (action === 'send') {
    if (c.state !== 'draft') return bad('Only a draft can be sent from here.');
    const recipients = (await listRecipients(c.id)).filter((r) => !r.meta.skipped).map((r) => ({ phone: r.phone, name: r.meta.name, email: r.email, key: r.meta.key, sim: !!r.meta.sim }));
    if (!recipients.length) return bad('Nobody in this batch can receive it.');
    if (c.mode !== 'test') { const stop = liveProblem(recipients, { leadsLive: process.env.WA_LEADS_LIVE === '1' }); if (stop) return bad(stop, 403); }
    await saveCampaign(c.id, { state: 'sending' });
    return NextResponse.json(await sendCampaign(c.id, { mode: c.mode, recipients, settings: { ...c, send_at: null } }));
  }
  return bad('unknown action');
}

export async function DELETE(_req, { params }) {
  if (!getSession()) return bad('unauthorized', 401);
  const c = await getCampaign(params.id);
  if (!c) return bad('not_found', 404);
  if (c.state === 'sending') return bad('It is being sent right now.');
  await deleteCampaign(c.id);
  return NextResponse.json({ ok: true });
}
