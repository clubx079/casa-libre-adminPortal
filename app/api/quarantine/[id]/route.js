import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { getUsdRate } from '@/lib/fx';
import { currencyFor } from '@/lib/currency';
import { looseFor, splitReasons, persistedPriceUsd } from '@/lib/unverified';
import { genShortCode } from '@/lib/shortcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = ['release', 'discard', 'approve'];

// PATCH /api/quarantine/:id  { action: 'release' | 'discard' | 'approve' }
// release -> promote the held payload into `properties` (active) + mark released.
// discard -> mark discarded (payload stays for the record, never published).
// approve -> a user's listing whose photos the AI check rejected ("images_rejected",
//            external_id listing:<id>): the admin looked and it's fine → publish that
//            listing as it is + mark released.
export async function PATCH(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const { select, insert, update } = dbFor(cc);

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (!ACTIONS.includes(body.action)) return NextResponse.json({ error: 'Accion invalida' }, { status: 400 });

  try {
    const [row] = await select('ingest_quarantine', `id=eq.${params.id}&limit=1`);
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const ts = new Date().toISOString();
    const reviewer = session.email || 'admin';

    if (body.action === 'approve') {
      const propertyId = row.payload?.property_id;
      if (!(row.reasons || []).includes('images_rejected') || !propertyId) return NextResponse.json({ error: 'Only listings with rejected photos can be approved' }, { status: 400 });
      const [prop] = await select('properties', `select=id,raw_data&id=eq.${encodeURIComponent(propertyId)}&limit=1`);
      if (!prop) return NextResponse.json({ error: 'Listing not found (deleted by its owner?)' }, { status: 404 });
      const moderation = { ...(prop.raw_data?.moderation || {}), state: 'approved', approved_by: reviewer, approved_at: ts };
      await update('properties', `id=eq.${encodeURIComponent(propertyId)}`,
        { status: 'published', admin_status: 'active', rejection_reason: null, raw_data: { ...(prop.raw_data || {}), moderation } }, { returning: 'minimal' });
      const [u] = await update('ingest_quarantine', `id=eq.${params.id}`,
        { status: 'released', reviewed_at: ts, reviewed_by: reviewer }, { returning: 'representation' });
      return NextResponse.json({ ok: true, row: u, approved: propertyId });
    }

    if (body.action === 'discard') {
      const [u] = await update('ingest_quarantine', `id=eq.${params.id}`,
        { status: 'discarded', reviewed_at: ts, reviewed_by: reviewer }, { returning: 'representation' });
      return NextResponse.json({ ok: true, row: u });
    }

    // release: promote the payload into properties (idempotent per source+external).
    // Searchable straight away when the buyer site would show it: it has a contact
    // and a location, and any other problem is a field the site shows as "Contact
    // seller for …" (Paraguay, lib/unverified.js). A price we couldn't verify gets no
    // price_usd. source_hash stays empty so the next scrape of the source sees the
    // listing as changed and adds its photos (quarantined records carry none).
    const payload = row.payload || {};
    const reasons = row.reasons || [];

    // Already in properties (a later scrape published it, or it was released before)?
    // That row is current — never overwrite it with this older payload; just close
    // the quarantine record.
    const [existing] = await select('properties', `select=id,admin_status&source_id=eq.${row.source_id}&external_id=eq.${encodeURIComponent(row.external_id)}&limit=1`);
    if (existing) {
      const [u] = await update('ingest_quarantine', `id=eq.${params.id}`,
        { status: 'released', reviewed_at: ts, reviewed_by: reviewer }, { returning: 'representation' });
      return NextResponse.json({ ok: true, row: u, alreadyListed: existing.admin_status });
    }

    const { unverified } = splitReasons(reasons);
    const shown = !reasons.includes('no_contact') && !reasons.includes('no_location')
      && (unverified.length === 0 || looseFor(cc));
    const rate = await getUsdRate(cc).catch(() => currencyFor(cc).fallbackRate);
    await insert('properties', [{
      ...payload,
      source_id: row.source_id,
      external_id: row.external_id,
      source_hash: null,
      is_complete: shown,
      price_usd: persistedPriceUsd(payload, rate, looseFor(cc) ? unverified : [], cc),
      admin_status: 'active',
      is_delisted: false,
      first_scraped_at: ts,
      last_scraped_at: ts,
      last_seen_at: ts,
      ...(cc === 'py' && !payload.short_code ? { short_code: genShortCode() } : {}),
    }], { upsert: true, onConflict: 'source_id,external_id', returning: 'minimal' });

    const [u] = await update('ingest_quarantine', `id=eq.${params.id}`,
      { status: 'released', reviewed_at: ts, reviewed_by: reviewer }, { returning: 'representation' });
    return NextResponse.json({ ok: true, row: u });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
