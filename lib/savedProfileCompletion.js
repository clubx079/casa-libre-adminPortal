// Admin-only (the website copy of lib/profileCompletion.js must stay identical).
const filled = (v) => String(v ?? '').trim() !== '';
// Admin Users page: ONLY what the user saved in Profile Personalization (not the name typed at
// sign-up, not WhatsApp — that's shown separately). 6 items: photo/logo (approved), first name,
// last name (saved), job title, company, website. Red < 2, yellow 2–4, green 5–6.
// "personalized" = photo + saved first and last name + title or company (same stop rule as the
// emails, but never counting the sign-up name).
export const SAVED_ITEMS = ['photo', 'first_name', 'last_name', 'job_title', 'company_name', 'company_website'];
export function savedProfileCompletion(u = {}) {
  const done = {
    photo: filled(u.profile_photo_url),
    first_name: filled(u.first_name),
    last_name: filled(u.last_name),
    job_title: filled(u.job_title),
    company_name: filled(u.company_name),
    company_website: filled(u.company_website),
  };
  const count = SAVED_ITEMS.filter((k) => done[k]).length;
  const pct = Math.round((count / SAVED_ITEMS.length) * 100);
  const tone = count >= 5 ? 'green' : count >= 2 ? 'yellow' : 'red';
  const personalized = !!(done.photo && done.first_name && done.last_name && (done.job_title || done.company_name));
  return { count, total: SAVED_ITEMS.length, pct, tone, done, missing: SAVED_ITEMS.filter((k) => !done[k]), personalized, whatsapp: !!u.phone_verified_at };
}
