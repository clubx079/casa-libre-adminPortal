// COPY of the website lib/profileCompletion.js (keep the two identical) — the admin Users
// page counts the same 7 items and the same "personalized" rule as Settings and the emails.
// How complete a seller's Profile Personalization is (Settings' progress bar).
// Pure, so tests load it directly. Seven items, each worth the same:
//   photo or logo (approved), first name, last name, job title, company, company website,
//   confirmed WhatsApp.
// Colour: red under 3 items, yellow 3–5, green 6–7.

export const ITEMS = ['photo', 'first_name', 'last_name', 'job_title', 'company_name', 'company_website', 'whatsapp'];

const filled = (v) => String(v ?? '').trim() !== '';

// prof: the Settings form values; photoStatus: 'approved' | 'checking' | 'rejected' | 'none' | …
export function profileCompletion(prof = {}, { photoStatus = null, hasPhoto = false } = {}) {
  const done = {
    photo: hasPhoto || photoStatus === 'approved',
    first_name: filled(prof.first_name),
    last_name: filled(prof.last_name),
    job_title: filled(prof.job_title),
    company_name: filled(prof.company_name),
    company_website: filled(prof.company_website),
    whatsapp: !!prof.phone_verified,
  };
  const count = ITEMS.filter((k) => done[k]).length;
  const pct = Math.round((count / ITEMS.length) * 100);
  const tone = count >= 6 ? 'green' : count >= 3 ? 'yellow' : 'red';
  return { count, total: ITEMS.length, pct, tone, done, missing: ITEMS.filter((k) => !done[k]) };
}

// "Personalized" — the bar a profile has to reach for the "Personalize your profile" emails
// to stop (lib/automations/profileNudge.js) and for the admin's "% of verified users with a
// personalized profile". Deliberately lower than 7/7 (a website and a confirmed WhatsApp
// are not something every seller has): a photo or logo, first AND last name, and a job
// title OR a company — enough for a buyer to know who they're dealing with.
// A 7/7 profile is always personalized.
export function isPersonalized(c) {
  const d = c?.done || {};
  if (c?.count === ITEMS.length) return true;
  return !!(d.photo && d.first_name && d.last_name && (d.job_title || d.company_name));
}

// One part of a name, as the Settings form shows it when first/last were never saved
// (lib/sellerProfile.js splitFullName: 4+ words → two first names).
function splitName(full) {
  const parts = String(full ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  const n = parts.length >= 4 ? 2 : 1;
  return { first_name: parts.slice(0, n).join(' '), last_name: parts.slice(n).join(' ') };
}

// The same 7 items from a `users` row (server side: automations, admin). Counts what the
// Settings page would show: saved first/last name, else full_name split; the APPROVED photo
// (profile_photo_url); WhatsApp confirmed = phone_verified_at set.
export function userCompletion(u = {}) {
  const named = filled(u.first_name) || filled(u.last_name);
  const name = named ? { first_name: u.first_name, last_name: u.last_name } : splitName(u.full_name);
  return profileCompletion({
    ...name,
    job_title: u.job_title, company_name: u.company_name, company_website: u.company_website,
    phone_verified: !!u.phone_verified_at,
  }, { hasPhoto: filled(u.profile_photo_url) });
}
