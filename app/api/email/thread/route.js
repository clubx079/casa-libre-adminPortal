// GET /api/email/thread?id=&fresh=1 → the whole conversation. From the saved copy at once;
// fresh=1 fetches it from Gmail (and saves it); the page asks for that in the background.
// Opening a conversation does NOT mark it read (Roland's rule: read = handled).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridgeReady } from '@/lib/gmailBridge';
import { ready, threadFromStore } from '@/lib/emailStore';
import { syncThread } from '@/lib/emailSync';
import { categoryFromLabels } from '@/lib/emailTriageCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  try {
    if (ready() && sp.get('fresh') !== '1') {
      const saved = await threadFromStore(id).catch(() => null);
      if (saved) return NextResponse.json({ ...saved, saved: true });
    }
    const d = await syncThread(id);
    const row = ready() ? await threadFromStore(id).catch(() => null) : null;
    return NextResponse.json({
      thread: { ...d.thread, category: row?.thread.category || categoryFromLabels(d.thread.labels) },
      messages: d.messages,
      saved: false,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
