// Which scraped listings, held back ONLY because they have no photo, can go live with the
// website's "Todavía no tengo foto" placeholder (Roland, Nov 17 2026). Pure — used by
// scripts/release-no-photo.mjs and test/noPhotoRelease.test.js.
//
// A listing qualifies when ALL of these hold:
//   - its pending Quarantine record's only reason is "no_images"
//   - the listing exists, is switched off (admin_status != active), not delisted, has no cover
//   - it has a contact phone and a location (city / neighbourhood / pin)
//   - it belongs to the country (lib/inCountry.js)
//   - no LIVE listing is the same property (dedupe_key), and no other listing released in
//     the same pass is either (the first one wins) — duplicates are the thing to avoid.
import { belongsToCountry } from './inCountry.js';

export function pickReleasable({ records = [], properties = [], liveByKey = new Map(), cc }) {
  const onlyNoImages = new Set(records
    .filter((r) => Array.isArray(r.reasons) && r.reasons.length === 1 && r.reasons[0] === 'no_images')
    .map((r) => `${r.source_id}|${r.external_id}`));
  const recordOf = new Map(records.map((r) => [`${r.source_id}|${r.external_id}`, r]));
  const taken = new Set();
  const release = [];
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const p of properties) {
    const k = `${p.source_id}|${p.external_id}`;
    if (!onlyNoImages.has(k)) continue;
    if (p.admin_status === 'active' || p.is_delisted || p.feature_image_url) { skip('not_held'); continue; }
    if (String(p.contact_phone || '').replace(/\D/g, '').length < 6) { skip('no_contact'); continue; }
    if (!p.city && !p.neighborhood && (p.latitude == null || p.longitude == null)) { skip('no_location'); continue; }
    if (!belongsToCountry(p, cc).ok) { skip('out_of_country'); continue; }
    const twin = p.dedupe_key ? liveByKey.get(p.dedupe_key) : null;
    if (twin && twin !== p.id) { skip('duplicate_of_live'); continue; }
    if (p.dedupe_key && taken.has(p.dedupe_key)) { skip('duplicate_in_batch'); continue; }
    if (p.dedupe_key) taken.add(p.dedupe_key);
    release.push({ property_id: p.id, record_id: recordOf.get(k)?.id || null });
  }
  return { release, skipped };
}
