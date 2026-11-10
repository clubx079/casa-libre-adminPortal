// GET  /api/referrals            → the active country's referral program: settings, its emails,
//                                  every referrer (link, clicks, sign-ups, qualified, rewards),
//                                  who referred whom, every reward, past invite batches.
// GET  /api/referrals?view=audience → the verified users the invite goes to (+ the rendered
//                                  invite for the first one, as a preview).
// PUT  /api/referrals            → save the settings / switch on-off. The first save creates the
//                                  settings row and the five Spanish emails.
// POST /api/referrals            → { action: 'send', ids, channel } invite (recorded only unless
//                                  REFERRAL_SEND_MODE=live) · { action: 'grant', email, plan, days,
//                                  propertyId? } · { action: 'revoke', id } · { action: 'approve' |
//                                  'reject', personId }
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError } from '@/lib/automationDb';
import { internalEmails } from '@/lib/internalAudience';
import { referralConfig } from '@/lib/referrals/core';
import { validateReferralSettings } from '@/lib/referralsAdmin';
import { loadPage, loadRow, saveSettings, audience, renderInvite, sendInvites, grantManual, revokeReward, personAction, sendMode } from '@/lib/referralsData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const deny = () => NextResponse.json({ error: 'No autorizado' }, { status: 401 });

export async function GET(req) {
  if (!getSession()) return deny();
  const cc = activeCountry();
  const db = dbFor(cc);
  try {
    if (new URL(req.url).searchParams.get('view') === 'audience') {
      const cfg = referralConfig(await loadRow(db));
      const people = await audience(db, cc, cfg, { internal: await internalEmails(cc) });
      const sample = people[0] || { id: 'sample', name: 'Ana Pérez', link: null };
      const preview = await renderInvite(db, cc, cfg, sample).catch(() => null);
      return NextResponse.json({ country: cc, sendMode: sendMode(), channel: cfg.inviteChannel, waTemplate: cfg.inviteWaTemplate, people, preview: preview ? { subject: preview.subject, html: preview.html, to: sample.email || null } : null });
    }
    return NextResponse.json({ country: cc, ...(await loadPage(db, cc)) });
  } catch (e) { return dbError(e); }
}

export async function PUT(req) {
  if (!getSession()) return deny();
  const cc = activeCountry();
  const db = dbFor(cc);
  const body = await req.json().catch(() => ({}));
  try {
    const row = await loadRow(db);
    const v = validateReferralSettings(body, row);
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    const res = await saveSettings(db, v.value);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) { return dbError(e); }
}

export async function POST(req) {
  const session = getSession();
  if (!session) return deny();
  const cc = activeCountry();
  const db = dbFor(cc);
  const body = await req.json().catch(() => ({}));
  const admin = session.email || null;
  try {
    const cfg = referralConfig(await loadRow(db));
    switch (body.action) {
      case 'send': {
        if (!cfg.exists) return NextResponse.json({ error: 'not_set_up' }, { status: 400 });
        if (!Array.isArray(body.ids) || !body.ids.length) return NextResponse.json({ error: 'no_people' }, { status: 400 });
        const channel = ['email', 'whatsapp', 'both'].includes(body.channel) ? body.channel : cfg.inviteChannel;
        if (channel !== 'email' && !cfg.inviteWaTemplate) return NextResponse.json({ error: 'no_whatsapp_template' }, { status: 400 });
        const out = await sendInvites(db, cc, cfg, { ids: body.ids, channel, skipInvited: body.skipInvited !== false, internal: await internalEmails(cc) });
        return NextResponse.json({ ok: true, ...out });
      }
      case 'grant': {
        const plan = body.plan === 'home' ? 'home' : 'verified';
        const days = Number(body.days);
        if (!Number.isInteger(days) || days < 1 || days > 365) return NextResponse.json({ error: 'bad_days' }, { status: 400 });
        const out = await grantManual(db, { email: body.email, plan, days, propertyId: body.propertyId || null, note: body.note || null, admin });
        return NextResponse.json(out, { status: out.error ? 400 : 200 });
      }
      case 'revoke': {
        const out = await revokeReward(db, body.id, { admin });
        return NextResponse.json(out, { status: out.error ? 400 : 200 });
      }
      case 'approve':
      case 'reject': {
        const out = await personAction(db, body.personId, body.action, { admin });
        return NextResponse.json(out, { status: out.error ? 400 : 200 });
      }
      default:
        return NextResponse.json({ error: 'bad_action' }, { status: 400 });
    }
  } catch (e) { return dbError(e); }
}
