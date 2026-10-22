// Automations × WhatsApp (admin): which email templates each automation sends — its
// "slots" — so the admin can pick a WhatsApp template for each, and the checks before
// saving. Pure (no env / I/O), unit-tested. The website sends (buyer
// lib/automations/whatsappSend.js); migration 017 adds automations.channel + wa_templates.
import { WA_TEMPLATES, WA_COUNTRIES, CHANNELS, SUGGESTED_WA } from './whatsappTemplates.js';

export const AUTOMATION_LABELS = {
  first_listing_free_home: 'First listing → free home display',
  listing_views_milestone: 'Listing getting views',
  listing_saves_milestone: 'Listing getting saved',
  draft_reminders: 'Unfinished draft reminders',
  duplicate_listings: 'Same property listed twice',
  paid_listings: 'Paid listings',
  no_listing_nudge: 'Signed up, no listing',
  listing_held: 'Listing not published',
};
// "Listing not published" uses email templates by key (one per reason), not columns.
const KEY_SLOTS = {
  listing_held: [['listing-held-payment', 'Waiting for payment'], ['listing-held-photos', 'Photos rejected'], ['listing-held-paused', 'Paused by an admin'], ['listing-held-incomplete', 'Missing details']],
};
// Which column holds which email, per automation (same meaning as templateUsage).
const SLOTS = {
  first_listing_free_home: [['gift_template_id', 'Gift email'], ['reminder_template_id', 'Ending-soon email']],
  listing_views_milestone: [['template_id', 'Views email']],
  listing_saves_milestone: [['template_id', 'Saves email']],
  draft_reminders: [['template_id', 'Reminder email']],
  duplicate_listings: [['template_id', 'Duplicate email']],
  paid_listings: [['template_id', 'Ends-soon email'], ['reminder_template_id', 'Ended email'], ['gift_template_id', 'Plan for agents email']],
  no_listing_nudge: [['template_id', 'Welcome email'], ['reminder_template_id', 'Second email']],
};

// → [{ slot, label, templateId, templateName, templateKey, suggested }] (one per distinct email template)
export function automationSlots(a, emailTemplates = []) {
  const byId = new Map(emailTemplates.map((t) => [String(t.id), t]));
  const seen = new Set();
  const out = [];
  for (const [key, what] of KEY_SLOTS[a?.id] || []) {
    const t = emailTemplates.find((x) => x.key === key);
    if (t) out.push({ slot: key, label: `${AUTOMATION_LABELS[a.id]} → ${what}`, what, templateId: String(t.id), templateName: t.name, templateKey: key, suggested: SUGGESTED_WA[key] || null });
  }
  for (const [col, what] of SLOTS[a?.id] || []) {
    const id = a[col] ? String(a[col]) : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    out.push({ slot: col, label: `${AUTOMATION_LABELS[a.id] || a.id} → ${what}`, what, templateId: id, templateName: t?.name || null, templateKey: t?.key || null, suggested: (t?.key && SUGGESTED_WA[t.key]) || null });
  }
  return out;
}

// Check a save: { channel, wa_templates } against the slots and the Relay templates.
// → { ok, value } | { ok: false, error }
export function validateChannels(input = {}, { slots = [], relay = [], country = 'py' } = {}) {
  const channel = String(input.channel || 'email');
  if (!CHANNELS.includes(channel)) return { ok: false, error: 'bad_channel' };
  if (channel !== 'email' && !WA_COUNTRIES.includes(country)) return { ok: false, error: 'whatsapp_not_for_country' };
  const ids = new Set(slots.map((s) => s.templateId));
  const status = new Map(relay.map((t) => [t.name, t.status]));
  const wa = {};
  for (const [id, name] of Object.entries(input.wa_templates || {})) {
    if (id === '__no_fallback' || id === '__repeat_days') continue;
    if (!name) continue;
    if (!ids.has(String(id))) return { ok: false, error: 'unknown_email_template' };
    if (!WA_TEMPLATES[name]) return { ok: false, error: 'unsupported_whatsapp_template', name };
    wa[String(id)] = name;
  }
  if (channel !== 'email') {
    const missing = slots.filter((s) => !wa[s.templateId]);   // slots without a WhatsApp template stay email
    if (missing.length === slots.length) return { ok: false, error: 'pick_a_whatsapp_template' };
    const notApproved = Object.values(wa).filter((n) => status.get(n) !== 'APPROVED');
    if (notApproved.length) return { ok: false, error: 'whatsapp_template_not_approved', names: notApproved };
  }
  // "WhatsApp first, then email": optionally WhatsApp again after N days (e.g. 30 = monthly).
  if (channel === 'whatsapp_first' && input.wa_templates?.__repeat_days !== undefined && input.wa_templates.__repeat_days !== '' && input.wa_templates.__repeat_days !== null) {
    const n = Number(input.wa_templates.__repeat_days);
    if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, error: 'bad_repeat_days' };
    wa.__repeat_days = n;
  }
  // "WhatsApp only": people WhatsApp can't reach get no email either.
  if (channel === 'whatsapp' && input.wa_templates?.__no_fallback === true) wa.__no_fallback = true;
  return { ok: true, value: { channel, wa_templates: wa } };
}
