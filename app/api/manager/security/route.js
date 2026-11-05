// Admin Manager → Security (components/manager/SecurityCard.js). The IP detector:
// GET  → the thresholds, the IPs blocked right now (and recently unblocked), and the busiest IPs
//        of the last 24 h with what the detector makes of each one (lib/securityWatch.js)
// POST { action: 'settings', abroadEvents, homeEvents, blockDays } → save the thresholds
//      { action: 'unblock', ip }  → unblock (the detector won't block it again by itself)
//      { action: 'block', ip, reason } → block an IP by hand
//      { action: 'run' }          → run the hourly check now (blocks what is over the limit)
// Admin only; the active country's DB.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { readWatch, saveWatch, normSettings, unblockIp, blockIpByHand, flaggedIps, activeBlocks, allowedIps, blockedCountries, validIp } from '@/lib/securityWatch';
import { busiestIps, runSecurityWatch, homeCountryOf } from '@/lib/securityWatchRun';
import { forgetIssues } from '@/lib/openIssuesStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function state(country) {
  const db = dbFor(country);
  const w = await readWatch(db);
  const now = Date.now();
  const { rows, error } = await busiestIps(country, { limit: 15 });
  const allowed = allowedIps(w.blocked_ips);
  const flagged = flaggedIps(rows.filter((x) => x.countryName !== 'Pakistan'), { blocked: blockedCountries(process.env.GEO_BLOCK), homeCountry: homeCountryOf(country), minEvents: w.settings.abroadEvents, homeMinEvents: w.settings.homeEvents, allowed });
  const active = activeBlocks(w.blocked_ips, now);
  const activeSet = new Set(active.map((b) => String(b.ip)));
  return {
    country,
    settings: w.settings,
    regionBlock: [...blockedCountries(process.env.GEO_BLOCK)],
    blocked: active.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    unblocked: w.blocked_ips.filter((b) => b.unblocked).sort((a, b) => Date.parse(b.unblocked_at || 0) - Date.parse(a.unblocked_at || 0)).slice(0, 10),
    busiest: rows.map((r) => ({ ...r, team: r.countryName === 'Pakistan', suspicious: flagged.has(r.ip), reason: flagged.get(r.ip)?.reason || null, blocked: activeSet.has(r.ip), allowed: allowed.has(r.ip) })),
    posthogError: error || null,
  };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json(await state(activeCountry())); }
  catch (e) { return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 }); }
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  const db = dbFor(country);
  const by = session.name || session.email || 'admin';
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'settings') await saveWatch(db, { settings: normSettings(b) });
    else if (b.action === 'unblock' && validIp(b.ip)) await unblockIp(db, String(b.ip).trim(), by);
    else if (b.action === 'block' && validIp(b.ip)) await blockIpByHand(db, String(b.ip).trim(), { reason: String(b.reason || '').slice(0, 200), by });
    else if (b.action === 'run') { const r = await runSecurityWatch(country); if (r.suspended.length) forgetIssues(country); }
    else return NextResponse.json({ error: 'unknown action or bad IP' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await state(country)) });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
