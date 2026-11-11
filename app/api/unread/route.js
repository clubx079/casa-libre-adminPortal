// GET  /api/unread → { reports, feedbacks, inbox, alerts }: rows the SIGNED-IN admin hasn't seen yet in
//                    the active country (sidebar badges). Each team member has their own.
//                    inbox = WhatsApp conversations with unread messages (Relay, the real
//                    number) — shared by the team like WhatsApp itself: opening the chat reads it.
// POST /api/unread { page } → mark that page seen for this admin; returns { since }: rows
//                    created after it were new to them (the page tags those "New").
// lib/unread.js, table admin_seen (migration 008). Before 008: zeros, nothing breaks.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { isMissingTable } from '@/lib/automationDb';
import { adminKey, unreadCounts, markSeen, UNREAD_PAGES } from '@/lib/unread';
import { conversationsWithCountry } from '@/lib/inboxData';
import { isRealUnread, inSite } from '@/lib/inboxRules';
import { withPending } from '@/lib/inboxPending';
import { openAlertCount } from '@/lib/alertsData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Unread WhatsApp conversations of this site where a PERSON wrote (lib/inboxRules.js isRealUnread):
// button taps, typed SÍ/BAJA, reactions and robot replies don't count. 0 without a Relay key.
async function inboxUnread(cc) {
  try {
    const list = (await conversationsWithCountry('live')).filter((c) => inSite(c, cc));
    return (await withPending(list, 'live')).filter(isRealUnread).length;
  } catch { return 0; }
}

export async function GET() {
  const key = adminKey(getSession());
  if (!key) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const inbox = inboxUnread(activeCountry());
  // open Alerts (lib/alertsData.js, cached 15 s; inboxMode()) — 0 when Relay / the DB can't be read
  const alerts = openAlertCount(activeCountry());
  try {
    return NextResponse.json({ ...(await unreadCounts(dbFor(activeCountry()), key)), inbox: await inbox, alerts: await alerts });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ reports: 0, feedbacks: 0, inbox: await inbox, alerts: await alerts, pending: true });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req) {
  const key = adminKey(getSession());
  if (!key) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { page } = await req.json().catch(() => ({}));
  if (!UNREAD_PAGES[page]) return NextResponse.json({ error: 'unknown page' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, since: await markSeen(dbFor(activeCountry()), key, page) });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ ok: false, pending: true, since: null });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
