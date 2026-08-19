import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select, update, remove } from '@/lib/db';
import * as b2 from '@/lib/b2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/properties/:id/images/:imageId  -> remove from DB + Backblaze
export async function DELETE(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const [img] = await select('property_images', `id=eq.${params.imageId}&property_id=eq.${params.id}&select=*&limit=1`);
    if (!img) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });

    if (img.storage_key) await b2.remove(img.storage_key);
    await remove('property_images', `id=eq.${params.imageId}`);

    // if it was the cover, promote the next image (or clear)
    if (img.is_feature) {
      const rest = await select('property_images', `property_id=eq.${params.id}&select=id,storage_url&order=position.asc&limit=1`);
      if (rest.length) {
        await update('property_images', `id=eq.${rest[0].id}`, { is_feature: true }, { returning: 'minimal' });
        await update('properties', `id=eq.${params.id}`, { feature_image_url: rest[0].storage_url }, { returning: 'minimal' });
      } else {
        await update('properties', `id=eq.${params.id}`, { feature_image_url: null }, { returning: 'minimal' });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// PATCH /api/properties/:id/images/:imageId  { feature: true }  -> set as cover
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!body.feature) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });
  try {
    const [img] = await select('property_images', `id=eq.${params.imageId}&property_id=eq.${params.id}&select=id,storage_url&limit=1`);
    if (!img) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    await update('property_images', `property_id=eq.${params.id}`, { is_feature: false }, { returning: 'minimal' });
    await update('property_images', `id=eq.${params.imageId}`, { is_feature: true }, { returning: 'minimal' });
    await update('properties', `id=eq.${params.id}`, { feature_image_url: img.storage_url }, { returning: 'minimal' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
