import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listCountries, listAdmins, getAdminByEmail, createInvitedAdmin, newToken } from '@/lib/control';
import { sendAdminInviteEmail } from '@/lib/email';
import { appBaseUrl } from '@/lib/appUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only a superadmin may see or manage the team.
function requireSuper() {
  const s = getSession();
  if (!s) return { error: 'unauthorized', status: 401 };
  if (s.role !== 'superadmin') return { error: 'forbidden', status: 403 };
  return { session: s };
}

// GET /api/team -> all members (superadmin only).
export async function GET() {
  const gate = requireSuper();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const admins = await listAdmins();
    return NextResponse.json({ admins });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// POST /api/team -> invite a new member (superadmin only).
// Body: { email, name, role: 'superadmin'|'admin', allowed_countries: [codes] }
export async function POST(req) {
  const gate = requireSuper();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const role = body.role === 'superadmin' ? 'superadmin' : 'admin';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  // Validate the requested countries against the live registry (admins only).
  let allowed_countries = null;
  if (role === 'admin') {
    const registry = await listCountries();
    const codes = registry.map((c) => c.code);
    const picked = Array.isArray(body.allowed_countries) ? body.allowed_countries.map((c) => String(c).toLowerCase()) : [];
    allowed_countries = picked.filter((c) => codes.includes(c));
    if (allowed_countries.length === 0) {
      return NextResponse.json({ error: 'no_countries' }, { status: 400 });
    }
  }

  // Reject duplicates of an already-active account.
  try {
    const existing = await getAdminByEmail(email);
    if (existing) return NextResponse.json({ error: 'email_exists' }, { status: 409 });
  } catch {}

  const invite_token = newToken();
  const invite_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  let created;
  try {
    created = await createInvitedAdmin({ email, name, role, allowed_countries, invite_token, invite_expires_at });
  } catch (e) {
    // A pending invite for the same email violates the unique index → treat as duplicate.
    if (e.code === '23505') return NextResponse.json({ error: 'email_exists' }, { status: 409 });
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }

  const link = `${appBaseUrl()}/aceptar-invitacion?token=${invite_token}`;
  const mail = await sendAdminInviteEmail(email, { name, link });

  return NextResponse.json({
    ok: true,
    admin: created,
    email_sent: mail.ok,
    email_error: mail.ok ? undefined : mail.error,
    // Handy while RESEND is unconfigured locally — lets you test the accept flow.
    invite_link: mail.ok ? undefined : link,
  });
}
