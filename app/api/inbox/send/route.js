// POST /api/inbox/send?mode= { kind: 'text', to, text } | { kind: 'template', to, template, language, variables }
// → Relay /v1/messages/text or /template. Text only inside the 24h window (Relay answers
// 422 window_closed otherwise). Each send carries the admin's email as metadata.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const s = getSession();
  if (!s) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const b = await req.json().catch(() => ({}));
  const to = String(b.to || '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(to)) return NextResponse.json({ error: { code: 'invalid_phone' } }, { status: 400 });
  const metadata = { agent: String(s.email || s.name || 'admin').slice(0, 80) };
  const r = b.kind === 'template'
    ? await relay(mode, '/messages/template', { method: 'POST', json: { to, template: String(b.template || ''), language: b.language || undefined, variables: b.variables || undefined, metadata } })
    : await relay(mode, '/messages/text', { method: 'POST', json: { to, text: String(b.text || '').slice(0, 4096), metadata } });
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
