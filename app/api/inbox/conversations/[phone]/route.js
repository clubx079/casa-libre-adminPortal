// GET   /api/inbox/conversations/:phone?mode= → one conversation (name, tags, 24h window)
// PATCH /api/inbox/conversations/:phone?mode= { status: 'open'|'done', add_tags, remove_tags }
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const r = await relay(mode, `/conversations/${phoneParam(params.phone)}`);
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}

export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const b = await req.json().catch(() => ({}));
  const json = {};
  if (['open', 'done'].includes(b.status)) json.status = b.status;
  for (const k of ['add_tags', 'remove_tags']) if (Array.isArray(b[k])) json[k] = b[k].map((t) => String(t).slice(0, 40)).slice(0, 10);
  const r = await relay(mode, `/conversations/${phoneParam(params.phone)}`, { method: 'PATCH', json });
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
