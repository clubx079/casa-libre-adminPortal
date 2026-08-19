import 'server-only';
import bcrypt from 'bcryptjs';

// Seeded admin credential. Defaults are baked in so the portal works right
// after clone/deploy; override with ADMIN_EMAIL / ADMIN_PASSWORD_HASH in the
// environment to change the account. The password itself is never stored —
// only its bcrypt hash.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'omar@airosofts.com').toLowerCase();
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  '$2a$10$FKuvjTz4PunIVM5bMUilHuKUyHQPf.OFZaRQ.cg.6kEjtheGmDAc2'; // bcrypt('Omar57faiz@')

export async function verifyAdmin(email, password) {
  if (!email || !password) return null;
  if (String(email).trim().toLowerCase() !== ADMIN_EMAIL) return null;
  const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!ok) return null;
  return { email: ADMIN_EMAIL, name: 'Omar' };
}
