// POST /api/inbox/conversations/:phone/read?mode= → clears unread; on live the person sees blue ticks.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const r = await relay(modeOf(new URL(req.url).searchParams.get('mode')), `/conversations/${phoneParam(params.phone)}/read`, { method: 'POST' });
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
