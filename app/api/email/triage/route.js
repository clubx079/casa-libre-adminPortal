// POST /api/email/triage { threadIds: [] } → { results: { threadId: category } }
// Sorts threads the AI hasn't seen yet (the first 30-day import, or anything listed before the
// push reached it) and saves the category on the Gmail thread. No alerts from here.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridgeReady } from '@/lib/gmailBridge';
import { triageThread } from '@/lib/emailTriage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(b.threadIds) ? b.threadIds : []).map(String))].slice(0, 8);
  const results = {};
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const t = await triageThread(id).catch(() => null);
      results[id] = t?.category || null;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return NextResponse.json({ results });
}
