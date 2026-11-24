// The weekly newsletter EDITION — ONE cron for all 5 countries. Call weekly with
// `Authorization: Bearer {{secrets.CRON_SECRET}}` (AiroBase Cron "0 11 * * 1" = Monday 11:00 UTC,
// a day before the weekly email). For every country where Automations → Weekly newsletter →
// "Auto-generate" is ON and this ISO week has no edition yet, it starts writing the edition
// (lib/newsletterEditionRun.js startEditionIfDue with anyTime). The countries run in parallel in
// the background, so this answers right away; the result shows on each country's card.
// ?country=py,bo → only those. ?dry=1 → report what would start, start nothing.
import { NextResponse } from 'next/server';
import { startEditionIfDue, loadEditionState } from '@/lib/newsletterEditionRun';
import { editionDue } from '@/lib/newsletterEditionCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALL = ['py', 'bo', 'uy', 've', 'sv'];

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const asked = String(sp.get('country') || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const countries = asked.length ? ALL.filter((c) => asked.includes(c)) : ALL;
  const dry = sp.get('dry') === '1';
  const results = {};
  await Promise.all(countries.map(async (cc) => {
    try {
      if (dry) {
        const st = await loadEditionState(cc);
        const d = editionDue({ settings: st.settings, rows: st.rows, country: cc, anyTime: true });
        results[cc] = { wouldStart: d.due, reason: d.reason, week: d.week };
      } else {
        results[cc] = await startEditionIfDue(cc, { anyTime: true });
      }
    } catch (e) { results[cc] = { error: String(e?.message || e).slice(0, 200) }; }
  }));
  return NextResponse.json({ ok: true, dry, results });
}

export const GET = handle;
export const POST = handle;
