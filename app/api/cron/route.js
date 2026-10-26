import { NextResponse } from 'next/server';
import { dbFor } from '@/lib/db';
import { runScrape } from '@/lib/scrape';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Called by AiroBase Cron with `Authorization: Bearer {{secrets.CRON_SECRET}}`.
// Country is chosen by ?country=<code> (or body.country); the scheduler fans out
// one call per registry country. Defaults to 'py'. Body (optional):
// { "sourceKey": "remax_py" } to run one source; otherwise every cron_enabled source.
// Answers at once (202) and scrapes in the background: a big source (RE/MAX) takes longer
// than AiroBase Cron's 5-minute timeout, which showed "Failed" while the scrape went on and
// finished fine. Each source's result is in scrape_runs. ?wait=1 = old behaviour (wait for it).
async function handle(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const url = new URL(req.url);
  let only = null;
  let country = (url.searchParams.get('country') || '').toLowerCase() || null;
  try {
    const body = await req.json();
    only = body?.sourceKey || null;
    if (!country && body?.country) country = String(body.country).toLowerCase();
  } catch {
    /* no body is fine */
  }
  country = country || 'py';
  const { select } = dbFor(country);

  const q = only
    ? `key=eq.${encodeURIComponent(only)}`
    : `cron_enabled=eq.true&is_active=eq.true`;
  const sources = await select('scrape_sources', `select=key&${q}`);

  const runAll = async () => {
    const results = [];
    for (const s of sources) {
      try {
        const summary = await runScrape({ sourceKey: s.key, filters: {}, trigger: 'cron', country });
        results.push({ source: s.key, ...summary });
      } catch (e) {
        results.push({ source: s.key, error: String(e.message || e) });
      }
    }
    return results;
  };
  if (url.searchParams.get('wait') === '1') {
    const results = await runAll();
    return NextResponse.json({ ok: true, country, ran: results.length, results });
  }
  runAll().catch((e) => console.error('[cron scrape]', country, e));
  return NextResponse.json({ ok: true, country, started: sources.map((s) => s.key) }, { status: 202 });
}

export const POST = handle;
export const GET = handle;
