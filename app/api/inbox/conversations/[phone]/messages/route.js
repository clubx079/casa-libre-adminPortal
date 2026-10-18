// GET /api/inbox/conversations/:phone/messages?mode=&before= → the thread, newest first.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({ limit: '100' });
  for (const k of ['before', 'after']) if (/^msg_[A-Za-z0-9]+$/.test(sp.get(k) || '')) qs.set(k, sp.get(k));
  const r = await relay(modeOf(sp.get('mode')), `/conversations/${phoneParam(params.phone)}/messages?${qs}`);
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
