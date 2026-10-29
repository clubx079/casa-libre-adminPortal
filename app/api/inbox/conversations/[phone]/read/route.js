// POST /api/inbox/conversations/:phone/read?mode= → clears unread (on live the person sees blue
// ticks) and takes away a "Mark as unread" dot.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';
import { forgetConversations } from '@/lib/inboxData';
import { UNREAD_TAG } from '@/lib/inboxRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const path = `/conversations/${phoneParam(params.phone)}`;
  const r = await relay(mode, `${path}/read`, { method: 'POST' });
  const cur = await relay(mode, path).catch(() => null);
  if (cur?.ok && (cur.data.tags || []).includes(UNREAD_TAG)) await relay(mode, path, { method: 'PATCH', json: { remove_tags: [UNREAD_TAG] } }).catch(() => null);
  forgetConversations(mode);
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
