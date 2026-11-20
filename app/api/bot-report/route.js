// POST /api/bot-report — a Grok Bot sends its results here (public; no admin session).
// Auth: the one-time token the admin put in the job ("Authorization: Bearer <token>"), checked against the
// run's SHA-256 hash (lib/bots/store.js receiveReport). Body: { runId, summary, items }.
import { NextResponse } from 'next/server';
import { receiveReport } from '@/lib/bots/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return NextResponse.json({ error: 'missing token' }, { status: 401 });
  const text = await req.text();
  if (text.length > 2_000_000) return NextResponse.json({ error: 'report too large' }, { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'body must be JSON' }, { status: 400 }); }
  try { return NextResponse.json(await receiveReport(body, bearer)); }
  catch (e) { return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: e?.status || 500 }); }
}
