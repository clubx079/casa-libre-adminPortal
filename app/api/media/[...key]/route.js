import { getObject } from '@/lib/b2';

export const runtime = 'nodejs';

// Public image proxy for a PRIVATE Backblaze bucket.
// GET /api/media/<key...>  -> streams the object's bytes.
// The bucket stays private; only objects whose key is known are served, and the
// B2 credentials never leave the server. Cached hard so repeat views are cheap.
export async function GET(_req, { params }) {
  const key = (params.key || []).map(decodeURIComponent).join('/');
  if (!key) return new Response('Not found', { status: 404 });

  try {
    const obj = await getObject(key);
    const web = obj.body?.transformToWebStream ? obj.body.transformToWebStream() : obj.body;
    const headers = {
      'Content-Type': obj.contentType,
      'Cache-Control': 'public, max-age=604800, immutable',
    };
    if (obj.contentLength != null) headers['Content-Length'] = String(obj.contentLength);
    if (obj.etag) headers['ETag'] = obj.etag;
    return new Response(web, { headers });
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey' ? 404 : 502;
    return new Response('Image unavailable', { status });
  }
}

export async function HEAD(req, ctx) {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
