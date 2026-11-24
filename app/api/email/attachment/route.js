// GET /api/email/attachment?messageId=&index= → the attachment file (download).
import { getSession } from '@/lib/auth';
import { bridge, bridgeReady } from '@/lib/gmailBridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return new Response('unauthorized', { status: 401 });
  if (!bridgeReady()) return new Response('not connected', { status: 503 });
  const sp = new URL(req.url).searchParams;
  try {
    const d = await bridge('attachment', { messageId: sp.get('messageId'), index: Number(sp.get('index') || 0) }, { timeoutMs: 60000 });
    const name = String(d.name || 'attachment').replace(/["\r\n]/g, '');
    return new Response(Buffer.from(d.base64, 'base64'), {
      headers: {
        'Content-Type': d.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return new Response(String(e?.message || e), { status: 502 });
  }
}
