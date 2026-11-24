// POST /api/email/sync { view, q?, deep? } → fetches the folder's newest conversations from Gmail
// while the page shows its saved copy, and saves them (lib/emailSync.js); the page then reloads
// the saved copy. deep = the first full import (up to 500 conversations, every email fetched).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridgeReady } from '@/lib/gmailBridge';
import { syncFolder } from '@/lib/emailSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  try {
    const r = await syncFolder(String(b.view || 'inbox'), { q: String(b.q || '').slice(0, 200), pages: b.deep ? 10 : 1 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
