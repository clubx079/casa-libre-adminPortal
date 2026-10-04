// GET /api/users/emails?email=…  → every email this person was sent, with its
// latest Resend status (sent / delivered / opened / clicked / bounced…), and their
// open + click rates (sign-in and reset codes left out). Read-only.
//   • Resend's list (needs RESEND_READ_API_KEY): every email, codes included.
//   • email_log (our DB): names automation emails by template, and keeps automation
//     emails Resend no longer lists. Without the Resend key only these show.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { normalizeEmail } from '@/lib/userInsights';
import { countryEmails } from '@/lib/resendEmails';
import { trackingFor } from '@/lib/emailStats';
import { mergeUserEmails, userEmailSummary, englishTemplateName, templateValues, fillTemplate } from '@/lib/userEmails';
import { translateToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HISTORY_DAYS = 365;

// Automation emails are written in Spanish: their subject is shown in English too.
// Display only. Only the TEMPLATE subject goes to the translation service, with its
// {{tags}} masked (lib/translate.js) — never the sent subject, which holds the
// person's name and property. The values are read back out of the sent subject and
// filled into the English template. Kept per template (globalThis: shared by every
// route bundle) and given 5s, so a slow translation service never holds the card back.
const templatesEn = (globalThis.__clTemplateSubjectEn ||= new Map());
async function englishTemplate(templateSubject) {
  if (!templateSubject) return null;
  if (templatesEn.has(templateSubject)) return templatesEn.get(templateSubject);
  const out = await Promise.race([
    translateToEnglish(templateSubject),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]).catch(() => null);
  const ok = out && out !== templateSubject ? out : null;
  if (ok) templatesEn.set(templateSubject, ok);
  return ok;
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = normalizeEmail(new URL(req.url).searchParams.get('email'));
  if (!email) return NextResponse.json({ error: 'bad_email' }, { status: 400 });
  const country = activeCountry();
  const { select } = dbFor(country);

  try {
    const [logRows, templates, resend] = await Promise.all([
      select('email_log', `select=id,to_email,template_key,subject,resend_id,status,created_at&to_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=200`).catch(() => []),
      select('email_templates', 'select=key,name,subject').catch(() => []),
      countryEmails(country, HISTORY_DAYS).catch((e) => ({ error: String(e?.message || e) })),
    ]);
    const templateNames = Object.fromEntries(templates.filter((t) => t.key).map((t) => [t.key, t.name]));
    const resendRows = resend && !resend.error ? resend.rows : [];
    const tracking = trackingFor(country); // opens/clicks only exist since this domain's tracking went on
    const emails = mergeUserEmails({ email, resendRows, logRows, templateNames, tracking });
    const subjectOf = Object.fromEntries(templates.filter((t) => t.key).map((t) => [t.key, t.subject]));
    await Promise.all(emails.filter((e) => e.automation).map(async (e) => {
      e.type_en = englishTemplateName(e.template_key);
      const tplSubject = subjectOf[e.template_key];
      const values = templateValues(tplSubject, e.subject); // null if the template changed since
      e.subject_en = values ? fillTemplate(await englishTemplate(tplSubject), values) : null;
    }));
    return NextResponse.json({
      tracking: resend === null ? 'no_key' : resend.error ? 'error' : 'resend',
      trackingError: resend?.error || null,
      trackingSince: tracking.since,
      truncated: !!resend?.truncated,
      days: HISTORY_DAYS,
      summary: userEmailSummary(emails),
      emails,
    });
  } catch (e) {
    console.error('[api/users/emails]', e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
