// Who signed in to Casa Libre after a WhatsApp campaign batch reached them — the "Signed in"
// column of Sent campaigns and the "Signed in from this campaign" list on a batch's page.
// A user counts for a batch when, after it was sent:
//   link   — they created their account from the batch's link (users.attribution.campaign =
//            the batch slug, stamped by the website at sign-up);
//   phone  — the account with the WhatsApp number the batch went to was created, signed in,
//            or confirmed its number (WhatsApp code) after the send;
//   visit  — they came from the batch's link (PostHog, utm_campaign = slug, or utm_term = their
//            person code on a formula SÍ link) and were signed in on the site (PostHog knows their email);
//   code   — their account was created from a link carrying their person code (users.attribution.term).
// One person once per batch (the earliest evidence wins the time). Pure — the loader is
// lib/waSigninsStore.js; test/waSignins.test.js.

export const phoneKey8 = (p) => String(p || '').replace(/\D/g, '').slice(-8);
const ts = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const attr = (u) => {
  if (!u?.attribution) return {};
  if (typeof u.attribution === 'object') return u.attribution;
  try { return JSON.parse(u.attribution) || {}; } catch { return {}; }
};

// campaigns [{ id, slug, sent_at|created_at }] · recipients [{ run_id, phone }] · users (rows)
// · landed [{ slug, email, at }] → Map campaign id → [{ user_id, name, email, phone, new_account, how, at }]
export function matchSignins({ campaigns = [], recipients = [], users = [], landed = [] } = {}) {
  const phonesOf = new Map();
  const refsOf = new Map();   // campaign → the person codes of its recipients
  for (const r of recipients) {
    const id = String(r.run_id);
    if (r.ref) { if (!refsOf.has(id)) refsOf.set(id, new Set()); refsOf.get(id).add(r.ref); }
    const k = phoneKey8(r.phone);
    if (k.length < 8) continue;
    if (!phonesOf.has(id)) phonesOf.set(id, new Set());
    phonesOf.get(id).add(k);
  }
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const out = new Map();
  for (const c of campaigns) {
    const sent = ts(c.sent_at || c.created_at);
    const phones = phonesOf.get(String(c.id)) || new Set();
    const refs = refsOf.get(String(c.id)) || new Set();
    const hits = new Map();
    const add = (u, how, at) => {
      const cur = hits.get(u.id);
      if (cur) { if (!cur.how.includes(how)) cur.how.push(how); if (at < cur.t) { cur.t = at; } return; }
      hits.set(u.id, { u, how: [how], t: at });
    };
    for (const u of users) {
      if (c.slug && attr(u).campaign === c.slug) add(u, 'link', ts(u.created_at));
      if (attr(u).term && refs.has(attr(u).term)) add(u, 'link', ts(u.created_at));
      if (phones.has(phoneKey8(u.phone))) {
        const after = [u.created_at, u.last_login_at, u.phone_verified_at].map(ts).filter((t) => t >= sent);
        if (after.length) add(u, 'phone', Math.min(...after));
      }
    }
    for (const l of landed) {
      if (!(l.slug === c.slug || (l.ref && refs.has(l.ref))) || ts(l.at) < sent) continue;
      const u = byEmail.get(String(l.email || '').toLowerCase());
      if (u) add(u, 'visit', ts(l.at));
    }
    out.set(String(c.id), [...hits.values()]
      .map(({ u, how, t }) => ({
        user_id: u.id, name: u.full_name || null, email: u.email || null, phone: u.phone || null,
        new_account: ts(u.created_at) >= sent, how, at: new Date(t).toISOString(),
      }))
      .sort((a, b) => ts(a.at) - ts(b.at)));
  }
  return out;
}

export const HOW_LABEL = { link: 'Signed up from the link', phone: 'Same WhatsApp number', visit: 'Came from the link signed in' };
