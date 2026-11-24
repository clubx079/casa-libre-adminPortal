// GET /api/email/thread?id= → the whole thread (every message, bodies) + the AI's category and
// one-line summary of the last incoming email. Opening a thread does NOT mark it read: an
// email stays unread until someone handles it (Roland's rule).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridge, bridgeReady } from '@/lib/gmailBridge';
import { triageThread } from '@/lib/emailTriage';
import { categoryFromLabels } from '@/lib/emailTriageCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  try {
    const d = await bridge('thread', { threadId: id });
    const triage = await triageThread(id, { thread: d.thread, messages: d.messages }).catch(() => null);
    return NextResponse.json({
      thread: { ...d.thread, category: categoryFromLabels(d.thread.labels) || triage?.category || null },
      messages: d.messages,
      triage,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
