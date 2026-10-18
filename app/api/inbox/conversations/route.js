// GET /api/inbox/conversations?mode=live|test&status=open|done|all&unread=true&q=&cursor=
// → Relay's conversation list (+ which modes have a key, + Open / Done counts). Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, inboxModes } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const countOf = (x) => (x.ok ? `${(x.data.data || []).length}${x.data.has_more ? '+' : ''}` : null);

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const mode = modeOf(sp.get('mode'));
  const status = ['open', 'done', 'all'].includes(sp.get('status')) ? sp.get('status') : 'open';
  const qs = new URLSearchParams({ status, limit: '50' });
  if (sp.get('unread') === 'true') qs.set('unread', 'true');
  if (sp.get('q')) qs.set('q', sp.get('q').slice(0, 80));
  if (sp.get('cursor')) qs.set('cursor', sp.get('cursor'));
  const [r, open, done] = await Promise.all([
    relay(mode, `/conversations?${qs}`),
    relay(mode, '/conversations?status=open&limit=100').catch(() => ({ ok: false })),
    relay(mode, '/conversations?status=done&limit=100').catch(() => ({ ok: false })),
  ]);
  return NextResponse.json({ ...r.data, modes: inboxModes(), counts: { open: countOf(open), done: countOf(done) } }, { status: r.ok ? 200 : r.status });
}
