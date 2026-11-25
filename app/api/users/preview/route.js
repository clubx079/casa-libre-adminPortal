// GET /api/users/preview — the exact message a person received, for the "Preview" pop-up on
// Analytics → a user → Messages & activity (components/users/UserTimeline.js).
//   ?email=<Resend id>                         → the email as sent (subject, from, to, HTML, text)
//   ?wa=<Relay message id>&phone=<their phone> → that WhatsApp message (template filled in)
//   ?template=<name>                           → a WhatsApp template's text, when the message
//                                                itself isn't in Relay's history
// Admin session only. Read-only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, phoneParam } from '@/lib/relayInbox';
import { safeEmailHtml, relayPreview, fillTemplate } from '@/lib/messagePreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let tplCache = null;
async function templateBodies() {
  if (tplCache && Date.now() - tplCache.at < 10 * 60 * 1000) return tplCache.map;
  const r = await relay('live', '/templates?status=all').catch(() => null);
  const map = new Map((r?.ok ? r.data.data || [] : []).map((t) => [t.name, t.body || '']));
  if (map.size) tplCache = { at: Date.now(), map };
  return map;
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const emailId = (sp.get('email') || '').trim();
  const waId = (sp.get('wa') || '').trim();
  const phone = (sp.get('phone') || '').replace(/[^\d]/g, '');
  const template = (sp.get('template') || '').trim();

  if (emailId) {
    if (!/^[0-9a-f-]{20,64}$/i.test(emailId)) return NextResponse.json({ error: 'bad_id' }, { status: 400 });
    const key = process.env.RESEND_READ_API_KEY;
    if (!key) return NextResponse.json({ error: 'no_read_key', message: 'RESEND_READ_API_KEY is not set, so the email itself can’t be loaded.' }, { status: 503 });
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) return NextResponse.json({ error: 'not_found', message: j?.message || 'The email service doesn’t have this email any more.' }, { status: r?.status === 404 ? 404 : 502 });
    return NextResponse.json({
      kind: 'email',
      subject: j.subject || '', from: j.from || '', to: Array.isArray(j.to) ? j.to.join(', ') : j.to || '',
      at: j.created_at || null, status: j.last_event || null,
      html: j.html ? safeEmailHtml(j.html) : null, text: j.text || '',
    });
  }

  if (waId || template) {
    const bodies = await templateBodies();
    if (waId && phone.length >= 8) {
      const r = await relay('live', `/conversations/${phoneParam(phone)}/messages?limit=100`).catch(() => null);
      const m = (r?.ok ? r.data?.data || [] : []).find((x) => String(x?.id) === waId);
      if (m) {
        const name = (typeof m.template === 'string' ? m.template : m.template?.name) || '';
        return NextResponse.json({ kind: 'whatsapp', ...relayPreview(m, bodies.get(name) || '') });
      }
    }
    if (template && bodies.has(template)) {
      const f = fillTemplate(bodies.get(template), []);
      return NextResponse.json({ kind: 'whatsapp', direction: 'outbound', template, text: f.text, complete: f.complete, media: null, buttons: [], at: null, status: null, templateOnly: true });
    }
    return NextResponse.json({ error: 'not_found', message: 'This WhatsApp message isn’t in the chat history any more.' }, { status: 404 });
  }
  return NextResponse.json({ error: 'missing_id' }, { status: 400 });
}
