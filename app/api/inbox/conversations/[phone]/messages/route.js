// GET /api/inbox/conversations/:phone/messages?mode=&before= → the thread, newest first.
// Messages the AI assistant sent carry ai_label ("AI · answer", "AI · sales reply", "AI · window
// follow-up", "AI · hand-over") from the active country's email_log — best effort.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { AI_SEND_LABEL } from '@/lib/userTimeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const labelOf = (r) => AI_SEND_LABEL[r.template_key] || (r.automation_id === 'inbox_ai_person' ? 'AI · hand-over' : 'AI · answer');

export async function GET(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({ limit: '100' });
  for (const k of ['before', 'after']) if (/^msg_[A-Za-z0-9]+$/.test(sp.get(k) || '')) qs.set(k, sp.get(k));
  const r = await relay(modeOf(sp.get('mode')), `/conversations/${phoneParam(params.phone)}/messages?${qs}`);
  if (r.ok && Array.isArray(r.data?.data)) {
    const ids = r.data.data.filter((m) => m.direction === 'outbound' && /^msg_[A-Za-z0-9]+$/.test(String(m.id || ''))).map((m) => m.id);
    if (ids.length) {
      const rows = await dbFor(activeCountry()).select('email_log', `select=automation_id,template_key,relay_message_id&automation_id=in.(inbox_ai,inbox_ai_person)&relay_message_id=in.(${ids.join(',')})&limit=200`).catch(() => []);
      const by = new Map(rows.map((x) => [String(x.relay_message_id), labelOf(x)]));
      for (const m of r.data.data) if (by.has(String(m.id))) m.ai_label = by.get(String(m.id));
    }
  }
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
