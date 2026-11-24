// GET /api/email/status → is the info@ bridge connected, and when did it last push new email.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridge, bridgeReady } from '@/lib/gmailBridge';
import { alertRecipients } from '@/lib/emailTriage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ connected: false, reason: 'not_configured' });
  try {
    const d = await bridge('ping', {}, { timeoutMs: 20000 });
    return NextResponse.json({ connected: true, account: d.account, lastPush: d.lastOk || null, lastError: d.lastErr || null, alertsTo: alertRecipients() });
  } catch (e) {
    return NextResponse.json({ connected: false, reason: String(e?.message || e) });
  }
}
