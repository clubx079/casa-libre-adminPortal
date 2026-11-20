// POST /api/bots/<key>/run { settings, test } → send a job (or a connection test) to the bot's Grok routine.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { startRun } from '@/lib/bots/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const s = getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const b = await req.json().catch(() => ({}));
    return NextResponse.json(await startRun(params.key, { settings: b.settings || null, test: !!b.test, by: s.email }));
  } catch (e) { return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: e?.status || 500 }); }
}
