// GET /api/app-updates → the saved "Mobile app updates" settings, and per country: whether
//                        the settings row is there / on, and what that country's website
//                        is serving the app right now (its public /api/mobile/app-version).
// PUT /api/app-updates → save the settings to EVERY country database at once (the app asks
//                        the site of whichever country the user picked). Nothing changes on
//                        any site until an admin saves here; with the switch off (or a field
//                        left empty) the sites keep using their env vars.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { listCountries, DEFAULT_COUNTRY } from '@/lib/control';
import { filterCountriesForSession } from '@/lib/adminCountry';
import { BUYER_ORIGIN } from '@/lib/buyerSite';
import { APP_VERSIONS_ID, PLATFORMS, settingsFromRow, validateAppUpdates, writableCountries } from '@/lib/appUpdatesAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function targets() {
  const countries = filterCountriesForSession(await listCountries().catch(() => []));
  const names = Object.fromEntries(countries.map((c) => [String(c.code).toLowerCase(), c.name || String(c.code).toUpperCase()]));
  return writableCountries(countries.length ? countries : [{ code: DEFAULT_COUNTRY }], process.env, DEFAULT_COUNTRY)
    .map((cc) => ({ cc, name: names[cc] || cc.toUpperCase() }));
}

async function readRow(cc) {
  const rows = await dbFor(cc).select('automations', `select=id,enabled,free_tiers,updated_at&id=eq.${APP_VERSIONS_ID}&limit=1`);
  return rows[0] || null;
}

// What the live site answers the app (public endpoint, no login) — the real outcome.
async function liveAnswer(cc) {
  const origin = BUYER_ORIGIN[cc];
  if (!origin) return null;
  const out = {};
  for (const p of PLATFORMS) {
    try {
      const r = await fetch(`${origin}/api/mobile/app-version?platform=${p}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const j = r.ok ? await r.json() : null;
      out[p] = j ? { min: j.minVersion, latest: j.latestVersion, source: j.source || 'env' } : { error: `HTTP ${r.status}` };
    } catch (e) { out[p] = { error: e?.name === 'TimeoutError' ? 'no answer' : 'not reachable' }; }
  }
  return out;
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const list = await targets();
  const countries = await Promise.all(list.map(async ({ cc, name }) => {
    const [row, live] = await Promise.all([readRow(cc).catch((e) => ({ error: String(e?.message || e) })), liveAnswer(cc)]);
    return { cc, name, row: row && !row.error ? row : null, dbError: row?.error || null, live };
  }));
  // The form shows the default country's saved values (they are the same everywhere
  // after a save); `differs` flags a country whose row was changed some other way.
  const base = countries.find((c) => c.cc === DEFAULT_COUNTRY && c.row) || countries.find((c) => c.row) || null;
  const key = (r) => JSON.stringify(r ? [!!r.enabled, r.free_tiers] : null);
  return NextResponse.json({
    settings: settingsFromRow(base?.row || null),
    countries: countries.map((c) => ({ cc: c.cc, name: c.name, saved: !!c.row, enabled: !!c.row?.enabled, updatedAt: c.row?.updated_at || null, differs: !!base && key(c.row) !== key(base.row), dbError: c.dbError, live: c.live })),
  });
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateAppUpdates(body);
  if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
  const now = new Date().toISOString();
  const results = await Promise.all((await targets()).map(async ({ cc, name }) => {
    try {
      const db = dbFor(cc);
      const existing = await readRow(cc);
      const patch = { ...v.value, updated_at: now, ...(v.value.enabled && !existing?.enabled ? { enabled_at: now } : {}) };
      if (existing) await db.update('automations', `id=eq.${APP_VERSIONS_ID}`, patch, { returning: 'minimal' });
      else await db.insert('automations', [{ id: APP_VERSIONS_ID, wait_days: 0, ...patch }], { returning: 'minimal' });
      return { cc, name, ok: true };
    } catch (e) { return { cc, name, ok: false, error: String(e?.message || e).slice(0, 200) }; }
  }));
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
