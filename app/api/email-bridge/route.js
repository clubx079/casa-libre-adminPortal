// POST /api/email-bridge — the info@ Gmail script pushes new emails here every minute
// (header X-Bridge-Secret). No admin session: public in middleware, checked by the secret.
// Fresh incoming emails are sorted by the AI and, when important, alert the team.
// Answers 200 only when every fresh email was handled; otherwise 503, so the script keeps its
// checkpoint and sends the batch again next minute (already-sorted threads are skipped).
import { NextResponse } from 'next/server';
import { bridgeSecretOk } from '@/lib/gmailBridge';
import { handlePushedBatch } from '@/lib/emailTriage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  if (!bridgeSecretOk(req.headers.get('x-bridge-secret'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const messages = Array.isArray(b.messages) ? b.messages : [];
  const r = await handlePushedBatch(messages);
  return NextResponse.json({ received: messages.length, ...r }, { status: r.complete ? 200 : 503 });
}
