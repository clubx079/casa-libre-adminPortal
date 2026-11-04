// GET  /api/alerts?fresh=1 → the active country's Alerts (lib/alertsData.js): every WhatsApp chat
//      tagged needs-a-person / cartera / proyecto, open until a team member writes after it or it is
//      marked handled; handled / answered ones for 7 days. { alerts, counts, mode, generatedAt }
// POST /api/alerts { id, action: 'handled' } → removes the tag in Relay and saves who / when.
// Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { alertsForPage, markHandled } from '@/lib/alertsData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  try {
    return NextResponse.json(await alertsForPage(activeCountry(), { fresh }));
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: e?.status || 500 });
  }
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.id || b.action !== 'handled') return NextResponse.json({ ok: false, error: 'id and action "handled" are required' }, { status: 400 });
  try {
    const r = await markHandled(activeCountry(), String(b.id), session.name || session.email || null);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
