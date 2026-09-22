import { NextResponse } from 'next/server';
import { runWhatsappVerify } from '@/lib/whatsappVerify';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Cron-callable WhatsApp confirmation pass. Add it as its own AiroBase Cron job,
// alongside /api/cron, with `Authorization: Bearer {{secrets.CRON_SECRET}}`.
//
//   POST /api/whatsapp-verify?country=py
//   POST /api/whatsapp-verify?country=py&sourceKey=coldwell   (scope to one source)
//   POST /api/whatsapp-verify?country=py&dry=1                (preview: no API, no writes)
//   POST /api/whatsapp-verify?country=py&limit=50             (cap unique numbers this run)
//
// Cost is controlled inside the runner: source-confirmed numbers and numbers checked
// within the TTL are skipped, and checks are deduped by number. With no paid provider
// configured (WHATSAPP_VERIFY_PROVIDER unset/none) it is a safe no-op that spends
// nothing — flip it on later by setting the provider env.
async function handle(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const url = new URL(req.url);
  let country = (url.searchParams.get('country') || '').toLowerCase() || null;
  let sourceKey = url.searchParams.get('sourceKey') || null;
  let dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dryRun') === '1';
  let limit = url.searchParams.get('limit');
  try {
    const body = await req.json();
    if (!country && body?.country) country = String(body.country).toLowerCase();
    if (!sourceKey && body?.sourceKey) sourceKey = body.sourceKey;
    if (body?.dryRun === true) dry = true;
    if (limit == null && body?.limit != null) limit = body.limit;
  } catch {
    /* no body is fine */
  }
  country = country || 'py';

  try {
    const summary = await runWhatsappVerify({ country, sourceKey, dryRun: dry, limit });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
