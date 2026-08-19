import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select, update, remove } from '@/lib/db';
import * as b2 from '@/lib/b2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fields the admin may edit from the portal.
const EDITABLE = [
  'address', 'city', 'neighborhood', 'province', 'country', 'zipcode',
  'price', 'currency', 'price_usd', 'listing_type', 'price_period',
  'bedrooms', 'bathrooms', 'floor_area', 'covered_area', 'land_area',
  'parking_spaces', 'garages', 'year_built', 'property_type',
  'description', 'status', 'admin_status', 'is_highlighted', 'is_homepage_featured',
  'contact_name', 'contact_phone', 'feature_image_url',
];

// GET /api/properties/:id  -> property + its images
export async function GET(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const rows = await select(
      'properties',
      `id=eq.${params.id}&select=*,property_images(id,source_url,storage_url,storage_key,is_feature,position),scrape_sources(name,key)&limit=1`
    );
    if (!rows.length) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    const p = rows[0];
    if (Array.isArray(p.property_images)) p.property_images.sort((a, b) => (a.position || 0) - (b.position || 0));
    return NextResponse.json({ property: p });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// PATCH /api/properties/:id  -> update editable fields (incl. admin_status toggle)
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const patch = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k];
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });

  try {
    const [row] = await update('properties', `id=eq.${params.id}`, patch);
    return NextResponse.json({ ok: true, property: row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// DELETE /api/properties/:id  -> delete property (cascades image rows) + purge B2 objects
export async function DELETE(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const imgs = await select('property_images', `property_id=eq.${params.id}&select=storage_key`);
    // remove the row first (FK cascade drops property_images rows)
    await remove('properties', `id=eq.${params.id}`);
    // then purge the stored objects from Backblaze
    await Promise.all(imgs.filter((i) => i.storage_key).map((i) => b2.remove(i.storage_key)));
    return NextResponse.json({ ok: true, imagesPurged: imgs.length });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
