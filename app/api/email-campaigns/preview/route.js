// GET /api/email-campaigns/preview?key=<campaign>&subject=<subject> → what that message looked like.
//   Email: the newest email actually sent with that subject (or the campaign's newest email when no
//   subject is given), read back from Resend with its HTML — exactly what the person received.
//   WhatsApp (subject "WhatsApp template: <name>"): the template drawn as on the phone
//   (lib/waTemplateLook.js, body from Relay), with a sample name.
// Both come in English too (htmlEn / subjectEn, lookEn): the popup opens in English with a
// button back to the original Spanish. lib/htmlTranslate.js keeps the email's design and links.
// Active country. Read-only. The recipient's address is masked.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { countryEmails } from '@/lib/resendEmails';
import { emailType } from '@/lib/emailStats';
import { keyForEmailType } from '@/lib/messageCampaigns';
import { relayTemplates } from '@/lib/relayAdmin';
import { templateLook } from '@/lib/waTemplateLook';
import { translateManyToEnglish } from '@/lib/translate';
import { translateHtml } from '@/lib/htmlTranslate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WA_PREFIX = /^WhatsApp template:\s*/i;
const mask = (to) => String(Array.isArray(to) ? to[0] : to || '').replace(/^(.).*?(.)?@/, (m, a, b) => `${a}•••${b || ''}@`);

async function resendEmail(id) {
  const key = process.env.RESEND_READ_API_KEY;
  if (!key) throw Object.assign(new Error('Resend is not readable here (RESEND_READ_API_KEY).'), { status: 200 });
  const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'Resend no longer has this email (it keeps about 30 days).' : `Resend answered ${r.status}`), { status: 200 });
  return r.json();
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const u = new URL(req.url);
  const key = String(u.searchParams.get('key') || '').slice(0, 80);
  const subject = String(u.searchParams.get('subject') || '').slice(0, 400);
  if (!key) return NextResponse.json({ error: 'key missing' }, { status: 400 });
  const cc = activeCountry();
  try {
    // ── WhatsApp ──
    if (WA_PREFIX.test(subject)) {
      const name = subject.replace(WA_PREFIX, '').trim();
      let tpl = null;
      try { tpl = (await relayTemplates()).templates.find((t) => t.name === name) || null; } catch { /* Relay down: the look still draws */ }
      const look = templateLook(name, tpl);
      let lookEn = templateLook(name, tpl, null, 'en');
      if (!lookEn.translated && look.body) {
        const [body, ...buttons] = await translateManyToEnglish([look.body, ...look.buttons]).catch(() => []);
        lookEn = body ? { ...lookEn, body, buttons: look.buttons.map((b, i) => buttons[i] || b), translated: true } : null;
      }
      return NextResponse.json({ kind: 'whatsapp', name, look, lookEn: lookEn?.body ? lookEn : null, status: tpl?.status || null, relay: !!tpl });
    }
    // ── Email ──
    let resendId = null; let sentAt = null;
    if (!key.startsWith('site:')) {
      const { select } = dbFor(cc);
      const q = `select=resend_id,created_at,subject&automation_id=eq.${encodeURIComponent(key)}&resend_id=not.is.null${subject ? `&subject=eq.${encodeURIComponent(subject)}` : ''}&order=created_at.desc&limit=1`;
      const [row] = await select('email_log', q).catch(() => []);
      if (row) { resendId = row.resend_id; sentAt = row.created_at; }
    }
    if (!resendId) {
      // site emails (and automations whose log has no Resend id): the newest Resend email of this kind
      const list = await countryEmails(cc, 30);
      const hit = (list?.rows || []).find((e) => (subject ? e.subject === subject : keyForEmailType(emailType(e.subject)) === key));
      if (hit) { resendId = hit.id; sentAt = hit.created_at; }
    }
    if (!resendId) return NextResponse.json({ error: 'No copy of this email was found. Resend keeps about 30 days.' });
    const e = await resendEmail(resendId);
    // English: the subject and every visible text of the email (cached translations, so a
    // second look is instant); a failure just leaves the English side empty
    const [subjectEn] = await translateManyToEnglish([e.subject || '']).catch(() => [null]);
    const en = e.html ? await translateHtml(e.html, (texts) => translateManyToEnglish(texts)).catch(() => null) : null;
    const textEn = !e.html && e.text ? (await translateManyToEnglish([e.text]).catch(() => [null]))[0] : null;
    return NextResponse.json({
      kind: 'email', subject: e.subject, from: e.from, to: mask(e.to), sentAt: e.created_at || sentAt, status: e.last_event || null,
      html: e.html || null, text: e.html ? null : (e.text || null),
      subjectEn: subjectEn || null, htmlEn: en?.translated ? en.html : null, textEn,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err).slice(0, 300) }, { status: err?.status || 500 });
  }
}
