import { NextResponse } from 'next/server';
import { setResetToken } from '@/lib/control';
import { sendAdminResetEmail } from '@/lib/email';
import { appBaseUrl } from '@/lib/appUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/forgot-password  { email }
// ALWAYS returns a generic ok — never reveals whether the email exists.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = String(body.email || '').trim().toLowerCase();

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    try {
      const res = await setResetToken(email); // null if no active admin
      if (res) {
        const link = `${appBaseUrl()}/restablecer-clave?token=${res.token}`;
        await sendAdminResetEmail(res.email, { link });
      }
    } catch { /* swallow — do not leak existence or errors */ }
  }

  return NextResponse.json({ ok: true });
}
