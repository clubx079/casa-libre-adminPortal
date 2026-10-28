// Admin Manager — follow-ups on "please fix your listing" emails (kind listing_fix).
// The AI asks a seller to fix something once; from then on CODE keeps track:
//   • fixed = the seller edited that listing after our first email (raw_data.edits, written
//     by /api/account/listings/edit) or the listing is gone → nothing more;
//   • not fixed → a reminder with each report (Mon / Wed / Fri, at least MIN_GAP_H apart),
//     up to MAX_SENDS emails in all, with a button to My listings → Editar;
//   • still not fixed after MAX_SENDS → an action for Omar in every report until it is:
//     who, which listing, what is wrong, when we wrote.
// The AI never drafts a second fix email for a listing that has a thread here.
// Pure (the run passes the data in) — test/managerFixFollowups.test.js.

export const FIX_KINDS = ['listing_fix'];
export const MAX_SENDS = 4;
export const MIN_GAP_H = 40;
export const LOOKBACK_DAYS = 60;
const H = 3600e3;

const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', timeZone: 'America/Asuncion' });
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';

// Every fix email sent, grouped per seller + listing, oldest first.
// reports: [{ id, created_at, actions: [...] }] → Map key → { user_id, property_id, sends: [...] }
export function fixThreads(reports = []) {
  const threads = new Map();
  for (const r of reports) {
    for (const a of r.actions || []) {
      if (a.status !== 'sent' || !FIX_KINDS.includes(a.kind) || !a.user_id || !a.property_id) continue;
      const key = `${a.user_id}:${a.property_id}`;
      const t = threads.get(key) || { key, user_id: a.user_id, property_id: a.property_id, sends: [] };
      t.sends.push({ at: a.sent_at || r.created_at, report_id: r.id, subject: a.subject, body: a.body, reason: a.reason || '', followup: a.followup || 0 });
      threads.set(key, t);
    }
  }
  for (const t of threads.values()) t.sends.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  return threads;
}

// Has the seller fixed it since our first email? (an edit after it, or the listing is gone)
export function isFixed(thread, listing) {
  if (!listing) return true;
  const first = Date.parse(thread.sends[0]?.at);
  return (listing.raw_data?.edits || []).some((e) => Date.parse(e.at) > first);
}

// → { resend: [thread], escalate: [thread] }
export function planFollowups(threads, listingsById, now = Date.now()) {
  const resend = [], escalate = [];
  for (const t of threads.values()) {
    if (!t.sends.length || isFixed(t, listingsById.get(String(t.property_id)))) continue;
    const last = Date.parse(t.sends[t.sends.length - 1].at);
    if (t.sends.length >= MAX_SENDS) escalate.push(t);
    else if (now - last >= MIN_GAP_H * H) resend.push(t);
  }
  return { resend, escalate };
}

// What the listing is, in a few words: "Casa en Km 7 Monday"
export function listingLabel(l) {
  const where = l?.neighborhood || l?.city || '';
  const type = l?.property_type || 'propiedad';
  return where ? `${type} en ${where}` : type;
}

// The problem as our first email described it: its greeting, thanks (with numbers that are
// stale now), "change it in My listings" / "write to us" lines and signature are left out —
// the reminder says those again in its own words.
const NOT_CORE = /^hola\b|^gracias\b|^el equipo de casa libre|mis publicaciones|escrib[ií]nos|respond[eé] este correo|si quer[eé]s ayuda|si necesit[aá]s ayuda|cualquier duda/i;
export function emailCore(body) {
  return String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !NOT_CORE.test(p)).join('\n\n');
}

// The reminder email (Spanish, voseo — same voice as the Manager's emails).
export function followupDraft(thread, { listing, user, site }) {
  const n = thread.sends.length + 1;
  const first = thread.sends[0];
  const name = firstName(user?.full_name || listing?.contact_name);
  const core = emailCore(first.body);
  const original = String(first.subject || '').replace(/^(Recordatorio( \d+)?: )+/i, '');
  return {
    kind: 'listing_fix',
    user_id: thread.user_id,
    property_id: thread.property_id,
    followup: n - 1,
    reason: `Reminder ${n - 1} of ${MAX_SENDS - 1}: not fixed since ${first.at.slice(0, 10)} — ${first.reason}`.slice(0, 300),
    evidence: `Emails sent: ${thread.sends.map((s) => s.at.slice(0, 10)).join(', ')}; no edit since.`,
    subject: `Recordatorio: ${original}`.slice(0, 200),
    heading: '',
    body: [
      `Hola${name ? ` ${name}` : ''}:`,
      `Te escribimos el ${fmtDate(first.at)} sobre tu publicación (${listingLabel(listing)}) y todavía la vemos igual. Te lo recordamos porque así a los interesados les cuesta más encontrarte o escribirte.`,
      core,
      'Ahora lo podés corregir vos mismo en un minuto: entrá a **Mis publicaciones** y tocá **Editar** en esa propiedad.',
      'Si necesitás ayuda, respondé este correo y lo vemos juntos.',
      'El equipo de Casa Libre',
    ].filter(Boolean).join('\n\n'),
    button_label: 'Editar mi publicación',
    button_url: `${String(site).replace(/\/$/, '')}/cuenta/publicaciones`,
  };
}

// The action for Omar once the reminders are used up.
export function escalationAction(thread, { listing, user }) {
  const name = user?.full_name || listing?.contact_name || 'The seller';
  const dates = thread.sends.map((s) => s.at.slice(5, 10)).join(', ');
  return {
    key: `fix-unfixed-${String(thread.property_id).slice(0, 8)}`,
    title: `${name} hasn't fixed their listing after ${thread.sends.length} emails`,
    why: `${thread.sends[0].reason || 'Listing needs a fix'} — ${listingLabel(listing)}. Emailed ${dates}; no edit since.`,
    how: `Call or WhatsApp ${firstName(name) || 'them'}${listing?.contact_phone ? ` (${listing.contact_phone})` : ''}; with their OK, fix it in the admin.`,
    owner: 'Omar', area: 'listings', effort: 'small', impact: 'medium',
    facts: [], evidence: [], verified: true, unverified: [], made_by: 'code',
  };
}
