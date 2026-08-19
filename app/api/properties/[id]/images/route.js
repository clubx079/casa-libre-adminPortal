import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select, insert } from '@/lib/db';
import * as b2 from '@/lib/b2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');

// POST /api/properties/:id/images   (multipart form-data, field "file")
// Uploads an image to Backblaze and records it in property_images.
export async function POST(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const [prop] = await select('properties', `id=eq.${params.id}&select=id,external_id,source_id,feature_image_url&limit=1`);
  if (!prop) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Esperaba multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Máx 25 MB' }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || 'image/jpeg';
  const folder = prop.external_id || prop.id;
  const stamp = Date.now().toString(36);
  const key = `manual/${folder}/${stamp}-${slug(file.name || 'upload.jpg')}`;

  try {
    const up = await b2.put(key, bytes, contentType);
    // append after existing images
    const existing = await select('property_images', `property_id=eq.${params.id}&select=position&order=position.desc&limit=1`);
    const position = existing.length ? Number(existing[0].position || 0) + 1 : 0;
    const isFeature = !prop.feature_image_url; // first image becomes the cover
    const [row] = await insert('property_images', [
      {
        property_id: params.id,
        source_url: up.url,       // uploaded images have no external source; use stored url
        storage_key: key,
        storage_url: up.url,
        content_type: contentType,
        bytes: up.bytes,
        is_feature: isFeature,
        position,
        uploaded_at: new Date().toISOString(),
      },
    ]);
    if (isFeature) {
      const { update } = await import('@/lib/db');
      await update('properties', `id=eq.${params.id}`, { feature_image_url: up.url }, { returning: 'minimal' });
    }
    return NextResponse.json({ ok: true, image: row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
