// The phone a seller put on their newest listing (properties.contact_phone), for people
// whose PROFILE has no phone. The sell wizard requires a phone on every listing, but the
// buyer portal only started copying it to the profile on 2026-10-21 — older sellers'
// numbers live only on their listings. Read-only.
import { selectIn } from './selectAll.js';

// → Map userId → contact phone (newest listing first)
export async function listingPhones(select, userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const rows = await selectIn(select, 'properties', 'created_by,contact_phone,created_at', 'created_by', ids, '&origin=eq.user&contact_phone=not.is.null&order=created_at.desc');
  const out = new Map();
  for (const r of rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    const k = String(r.created_by);
    if (!out.has(k) && String(r.contact_phone || '').trim()) out.set(k, String(r.contact_phone).trim());
  }
  return out;
}
