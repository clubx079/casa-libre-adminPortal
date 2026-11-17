// GET /api/profile-pro → the active country's Profile Personalization pricing settings
//                       (lib/profileProAdmin.js) + numbers (periods, revenue) + how many
//                       verified users have a personalized profile.
// PUT /api/profile-pro → save the settings / flip the paid switch. The first save creates
//                       the 'profile_pro' automations row. Nothing is written until then.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError } from '@/lib/automationDb';
import { countryInfo } from '@/lib/automationAdmin';
import { PROFILE_PRO_ID, PROFILE_KINDS, profileProConfig, validateProfileProSettings, profileProStats, usd } from '@/lib/profileProAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function payload(db) {
  const [rows, payments] = await Promise.all([
    db.select('automations', `select=*&id=eq.${PROFILE_PRO_ID}&limit=1`),
    db.select('payments', `select=user_id,kind,amount_usd,status,highlight_until,created_at&kind=in.(${PROFILE_KINDS.join(',')})&status=eq.succeeded&order=created_at.desc&limit=10000`).catch(() => []),
  ]);
  const row = rows[0] || null;
  const cfg = profileProConfig(row);
  return {
    setUp: !!row,
    settings: { ...cfg, price: (cfg.priceCents / 100).toFixed(2), renewPrice: (cfg.renewCents / 100).toFixed(2), priceLabel: usd(cfg.priceCents), renewLabel: usd(cfg.renewCents) },
    stats: profileProStats(payments),
  };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try { return NextResponse.json({ ...(await payload(dbFor(cc))), country: cc, site: countryInfo(cc).site }); }
  catch (e) { return dbError(e); }
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const db = dbFor(cc);
  const body = await req.json().catch(() => ({}));
  try {
    const [cur] = await db.select('automations', `select=*&id=eq.${PROFILE_PRO_ID}&limit=1`);
    const v = validateProfileProSettings(body, cur || null);
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    const now = new Date().toISOString();
    if (cur) await db.update('automations', `id=eq.${PROFILE_PRO_ID}`, { ...v.value, updated_at: now }, { returning: 'minimal' });
    else await db.insert('automations', [{ id: PROFILE_PRO_ID, wait_days: 0, ...v.value, updated_at: now }], { returning: 'minimal' });
    return NextResponse.json({ ...(await payload(db)), country: cc, site: countryInfo(cc).site, saved: true });
  } catch (e) { return dbError(e); }
}
