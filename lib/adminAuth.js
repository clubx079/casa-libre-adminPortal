import 'server-only';
import bcrypt from 'bcryptjs';
import { getAdminByEmail, touchAdminLogin } from './control';

// Admin team logins now live in the CONTROL DB (`admin_users`). The single env
// account below is kept as an EMERGENCY FALLBACK (works if the control DB is
// unreachable or before it's seeded). The password itself is never stored —
// only its bcrypt hash.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'omar@airosofts.com').toLowerCase();
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  '$2a$10$FKuvjTz4PunIVM5bMUilHuKUyHQPf.OFZaRQ.cg.6kEjtheGmDAc2'; // bcrypt('Omar57faiz@')

export async function verifyAdmin(email, password) {
  if (!email || !password) return null;
  const e = String(email).trim().toLowerCase();

  // 1) Control DB admin_users (team logins) — the primary source.
  try {
    const row = await getAdminByEmail(e);
    if (row && row.password_hash) {
      const ok = await bcrypt.compare(password, row.password_hash);
      if (ok) {
        touchAdminLogin(row.id); // fire-and-forget
        return {
          id: row.id,
          email: row.email,
          name: row.name || 'Admin',
          role: row.role || 'admin',
          allowed_countries: row.allowed_countries || null,
        };
      }
    }
  } catch { /* control DB unreachable → fall through to env fallback */ }

  // 2) Env-account emergency fallback.
  if (e === ADMIN_EMAIL) {
    const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (ok) return { email: ADMIN_EMAIL, name: 'Omar', role: 'superadmin', allowed_countries: null };
  }
  return null;
}
