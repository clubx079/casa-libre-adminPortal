// GET /api/app-installs?days=7|30|90|180|365 → daily installs from Google Play and the App Store
// (lib/storeReports.js + lib/appInstalls.js). Read-only. Each store fails on its own
// (an error message instead of numbers), never the page. Cached 3 hours — the stores
// only publish new numbers once a day anyway.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { storeSetup, fetchPlayDaily, fetchAppleDaily } from '@/lib/storeReports';
import { mergeInstalls } from '@/lib/appInstalls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL = 3 * 3600 * 1000;
const cache = new Map();
const settle = async (fn) => { try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) }; } };

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const days = [7, 30, 90, 180, 365].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30;
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < TTL && !sp.get('fresh')) return NextResponse.json(hit.body);

  const setup = storeSetup();
  const months = Math.ceil(days / 30) + 1;   // Play: one CSV per month
  const [play, apple] = await Promise.all([
    setup.play ? settle(() => fetchPlayDaily({ months })) : { ok: false, error: 'Google Play is not connected yet.' },
    setup.apple ? settle(() => fetchAppleDaily({ days })) : { ok: false, error: 'App Store is not connected yet.' },
  ]);
  // Keep the last good answer of a store when it fails only temporarily.
  const prev = [...cache.values()].sort((x, y) => y.at - x.at)[0]?.raw || {};
  if (!apple.ok && prev.apple?.ok) Object.assign(apple, prev.apple, { stale: true });
  if (!play.ok && prev.play?.ok) Object.assign(play, prev.play, { stale: true });
  const merged = mergeInstalls({ play: play.ok ? play.data : {}, apple: apple.ok ? apple.data : {}, days });
  const body = {
    days, setup, generatedAt: new Date().toISOString(), ...merged,
    play: { ok: play.ok, error: play.error || null, daysWithData: play.ok ? Object.keys(play.data).length : 0 },
    apple: { ok: apple.ok, error: apple.error || null, daysWithData: apple.ok ? Object.keys(apple.data).length : 0 },
  };
  cache.set(days, { at: Date.now(), body, raw: { apple, play } });
  return NextResponse.json(body);
}
