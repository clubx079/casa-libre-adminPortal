// POST /api/users/deleted-ask { propertyId } → send the "Listing deleted → ask why" email for one
// deleted listing now (a user's activity page → Messages sent → the deleted listing's button).
// Same email, log and dedupe key (deleted-ask:<listing>) as the website's automation
// (buyer lib/listingDeleted.js), so it can never go out twice. Not for the team's deletions.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { countryFrame, countryInfo } from '@/lib/automationAdmin';
import { renderTemplate } from '@/lib/emailTemplateRender';
import { BADGE_APPLE_CID, BADGE_PLAY_CID } from '@/lib/emailBadges';
import { sendAutomationEmail } from '@/lib/email';
import { DELETED_EVENT } from '@/lib/listingDeletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { propertyId } = await req.json().catch(() => ({}));
  if (!UUID.test(String(propertyId || ''))) return NextResponse.json({ error: 'bad_id' }, { status: 400 });
  const country = activeCountry();
  const db = dbFor(country);
  const [rec] = await db.select('email_log', `select=run_id,to_email,error&automation_id=eq.${DELETED_EVENT}&run_id=eq.${propertyId}&limit=1`).catch(() => []);
  if (!rec) return NextResponse.json({ error: 'No deletion recorded for this listing.' }, { status: 404 });
  let d = {};
  try { d = JSON.parse(rec.error || '{}') || {}; } catch { d = {}; }
  if (d.by === 'team') return NextResponse.json({ error: 'The team deleted this listing — no ask-why email.' }, { status: 400 });
  const to = String(rec.to_email || '').toLowerCase();
  if (!to || to === '-' || to.startsWith('deleted')) return NextResponse.json({ error: 'No email for this person.' }, { status: 400 });
  const [already] = await db.select('email_log', `select=id,created_at&automation_id=eq.listing_deleted&run_id=eq.${propertyId}&limit=1`).catch(() => []);
  if (already) return NextResponse.json({ error: 'Already sent', at: already.created_at }, { status: 409 });
  const [automation] = await db.select('automations', 'select=template_id&id=eq.listing_deleted&limit=1').catch(() => []);
  const templates = await db.select('email_templates', 'select=*').catch(() => []);
  const tpl = templates.find((t) => String(t.id) === String(automation?.template_id)) || templates.find((t) => t.key === 'listing-deleted-feedback');
  if (!tpl) return NextResponse.json({ error: 'The ask-why email template is missing in this country.' }, { status: 400 });
  const [u] = d.user_id ? await db.select('users', `select=full_name&id=eq.${d.user_id}&limit=1`).catch(() => []) : [];
  const site = countryInfo(country).site;
  const vars = {
    name: String(u?.full_name || '').trim().split(/\s+/)[0] || '',
    property_title: d.title || 'tu publicación',
    feedback_url: `${site}/feedback?src=listing_deleted&e=${encodeURIComponent(to)}`,
    publish_url: `${site}/?sell=1`,
  };
  const msg = renderTemplate(tpl, vars, countryFrame(country, { appleSrc: `cid:${BADGE_APPLE_CID}`, playSrc: `cid:${BADGE_PLAY_CID}` }));
  // claim the dedupe key first (the website's hourly job uses the same one), then send
  let log;
  try {
    [log] = await db.insert('email_log', [{ automation_id: 'listing_deleted', run_id: propertyId, template_id: tpl.id, template_key: tpl.key || null, to_email: to, subject: msg.subject, status: 'sending', dedupe_key: `deleted-ask:${propertyId}` }]);
  } catch (e) {
    if (/duplicate|23505/.test(String(e?.message || e))) return NextResponse.json({ error: 'Already sent' }, { status: 409 });
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
  const res = await sendAutomationEmail({ country, to, ...msg });
  if (!res.ok) {
    await db.remove('email_log', `id=eq.${log.id}`).catch(() => {});
    return NextResponse.json({ error: res.error || 'send_failed' }, { status: 502 });
  }
  await db.update('email_log', `id=eq.${log.id}`, { status: 'sent', resend_id: res.id }, { returning: 'minimal' }).catch(() => {});
  return NextResponse.json({ ok: true, to: res.to, redirected: res.redirected, by: session.email });
}
