// POST /api/email-templates/:id/test → render the template (the unsaved fields in the
// request body, or the saved row) with sample data and send it to ADMIN_TEST_EMAIL
// only — never to a real user. Logged in email_log as status 'test'.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { validateTemplate, countryFrame } from '@/lib/automationAdmin';
import { renderTemplate, sampleVars } from '@/lib/emailTemplateRender';
import { BADGE_APPLE_CID, BADGE_PLAY_CID } from '@/lib/emailBadges';
import { sendTemplateTest } from '@/lib/email';
import { dbError, q } from '@/lib/automationDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const country = activeCountry();
  const db = dbFor(country);
  const body = await req.json().catch(() => ({}));
  let tpl;
  try {
    if (body && body.subject !== undefined) {
      const v = validateTemplate(body);
      if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
      tpl = v.value;
    } else {
      [tpl] = await db.select('email_templates', `select=*&id=eq.${q(params.id)}&limit=1`);
      if (!tpl) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  } catch (e) { return dbError(e); }

  const msg = renderTemplate(tpl, sampleVars, countryFrame(country, { appleSrc: `cid:${BADGE_APPLE_CID}`, playSrc: `cid:${BADGE_PLAY_CID}` }));
  const res = await sendTemplateTest({ country, ...msg });
  if (!res.ok) return NextResponse.json({ error: 'send_failed', message: res.error }, { status: 502 });
  try {
    await db.insert('email_log', [{ template_id: params.id === 'new' ? null : params.id, template_key: tpl.key || null, to_email: res.to, subject: `[TEST] ${msg.subject}`, resend_id: res.id, status: 'test' }], { returning: 'minimal' });
  } catch { /* the log is best-effort for tests */ }
  return NextResponse.json({ ok: true, to: res.to });
}
