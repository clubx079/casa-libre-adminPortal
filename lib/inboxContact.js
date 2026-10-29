// Who is this WhatsApp number on Casa Libre? The account (verified WhatsApp or profile phone)
// or the seller whose listing carries it, in the person's country DB — so the inbox can show
// their name / listings and open their activity page. Server only.
import 'server-only';
import { dbFor } from './db';

const enc = encodeURIComponent;

export async function contactFor(phone, country) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8 || !country || country === 'other') return null;
  const tail = d.slice(-8);   // matches "+595 981…", "0981…" and "595981…" alike
  const db = dbFor(country);
  const like = enc(`%${tail}%`);
  const [users, props] = await Promise.all([
    db.select('users', `select=id,email,full_name,phone,phone_verified_at,created_at&phone=ilike.${like}&limit=5`).catch(() => []),
    db.select('properties', `select=id,created_by,status,admin_status,created_at&origin=eq.user&contact_phone=ilike.${like}&order=created_at.desc&limit=50`).catch(() => []),
  ]);
  let user = users.find((u) => u.phone_verified_at) || users[0] || null;
  if (!user && props[0]?.created_by) {
    [user] = await db.select('users', `select=id,email,full_name,phone,phone_verified_at,created_at&id=eq.${enc(props[0].created_by)}&limit=1`).catch(() => []);
  }
  if (!user) return null;
  const own = await db.select('properties', `select=id,status,admin_status&created_by=eq.${enc(user.id)}&origin=eq.user&limit=500`).catch(() => []);
  return {
    country,
    user: { id: user.id, email: user.email || null, name: user.full_name || null, phone: user.phone || null, verified: !!user.phone_verified_at, joined: user.created_at },
    listings: own.length,
    live: own.filter((p) => p.admin_status === 'active' && !['payment_pending', 'expired', 'scanning', 'rejected', 'duplicate_review'].includes(p.status)).length,
    waitingPayment: own.filter((p) => p.status === 'payment_pending').length,
    profileUrl: `/analytics?user=${enc(user.id)}${user.email ? `&email=${enc(user.email)}` : ''}`,
  };
}
