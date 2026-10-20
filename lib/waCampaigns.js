// WhatsApp campaigns (admin → WhatsApp campaigns), the same flow as Relay's own
// Campaigns page: 1 · Message (name + approved template), 2 · Audience, 3 · Variables,
// 4 · Send (now / schedule / draft, live or test). Sending goes through Relay's
// POST /v1/campaigns, so Relay's rules apply exactly as on its own page: only opted-in
// contacts receive it (no-opt-in and opted-out are skipped), +1 numbers are skipped for
// marketing templates, and it throttles to the number's limit.
// Relay's API can't list campaigns or their results, so the admin keeps its own record
// (lib/waCampaignStore.js) and reads each recipient's conversation for the results.
// Pure — test/waCampaigns.test.js.

export const SOURCES = [
  { key: 'contact.first_name', label: 'First name' },
  { key: 'contact.name', label: 'Full name' },
  { key: 'contact.phone', label: 'Phone' },
  { key: 'contact.email', label: 'Email' },
  { key: 'static', label: 'Same text for everyone…' },
];

// "+595 981…", "0981…", "595981…" → "+595981…" (null when it can't be a number)
export function toE164(input, prefix = '595') {
  const raw = String(input ?? '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  const ok = (x) => (x.length >= 8 && x.length <= 15 && !x.startsWith('0') ? `+${x}` : null);
  if (raw.startsWith('+')) return ok(d);
  if (d.startsWith('00')) return ok(d.slice(2));
  const p = String(prefix || '').replace(/\D/g, '');
  if (p && d.startsWith(p) && d.length - p.length >= 6) return ok(d);
  return ok(p + d.replace(/^0+/, ''));
}

// Recipients from any source → unique by phone, cleaned.
// rows: [{ phone, name?, email?, source? }]
export function cleanAudience(rows = [], prefix = '595') {
  const seen = new Map();
  let invalid = 0;
  for (const r of rows) {
    const phone = toE164(r?.phone, prefix);
    if (!phone) { invalid++; continue; }
    if (seen.has(phone)) continue;
    const name = String(r?.name || '').trim().slice(0, 120) || null;
    seen.set(phone, { phone, name, first_name: name ? name.split(/\s+/)[0] : null, email: r?.email ? String(r.email).trim().toLowerCase() : null, source: r?.source || null });
  }
  return { recipients: [...seen.values()], invalid };
}

// Contact fields a variables map needs (Relay skips contacts missing one of them).
export function neededFields(map = {}) {
  const f = new Set();
  for (const v of [...(map.body || []), map.button].filter(Boolean)) if (v.source && v.source !== 'static') f.add(v.source.replace('contact.', ''));
  return [...f];
}
export const missingValue = (r, fields = []) => fields.some((k) => !String(r?.[k] || '').trim());

// Who will receive it, before sending — Relay's rule: opted-in only.
// optIn: Map phone → 'opted_in' | 'opted_out' | 'unknown' (Relay contacts)
// optedOut: Set of phones that opted out on our side (users.whatsapp_opted_out_at)
export function audienceCounts(recipients = [], optIn = new Map(), optedOut = new Set(), { marketing = false, fields = [] } = {}) {
  const c = { total: recipients.length, willReceive: 0, noOptIn: 0, optedOut: 0, usMarketing: 0, missingValue: 0 };
  for (const r of recipients) {
    const st = optIn.get(r.phone) || 'unknown';
    if (st === 'opted_out' || optedOut.has(r.phone)) { c.optedOut++; continue; }
    if (st !== 'opted_in') { c.noOptIn++; continue; }
    if (marketing && r.phone.startsWith('+1')) { c.usMarketing++; continue; }
    if (missingValue(r, fields)) { c.missingValue++; continue; }
    c.willReceive++;
  }
  return c;
}

// The variables Relay wants: { body: ['contact.first_name', 'static:…'], buttons: [{ index, source }] }
// map: { body: [{ source, text }], button: { source, text, track } }, slug = the campaign's
// click-tracking key (utm_campaign) — appended to a fixed button text so PostHog counts clicks.
export function relayVariables(map = {}, slug = '') {
  const one = (v) => (v?.source === 'static' ? `static:${String(v.text || '')}` : String(v?.source || ''));
  const out = { body: (map.body || []).map(one) };
  if (map.button && map.button.source) {
    let src = one(map.button);
    if (map.button.source === 'static' && map.button.track !== false && slug) {
      const t = String(map.button.text || '');
      src = `static:${t}${t.includes('?') ? '&' : '?'}utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=${slug}`;
    }
    out.buttons = [{ index: 0, source: src }];
  }
  return out;
}

// Every {{n}} must be mapped (and static texts filled) before sending.
export function variablesProblem(template, map = {}) {
  const nb = Number(template?.variables?.body) || 0;
  for (let i = 0; i < nb; i++) {
    const v = map.body?.[i];
    if (!v?.source) return `Choose a value for Body {{${i + 1}}}.`;
    if (v.source === 'static' && !String(v.text || '').trim()) return `Write the text for Body {{${i + 1}}}.`;
  }
  const nbtn = Array.isArray(template?.variables?.url_buttons) ? template.variables.url_buttons.length : 0;
  if (nbtn && !map.button?.source) return 'Choose a value for the button link.';
  if (nbtn && map.button.source === 'static' && !String(map.button.text || '').trim()) return 'Write the text for the button link.';
  return null;
}

// Template text with the variables filled for one sample contact (the preview).
export function previewText(body = '', map = {}, sample = { first_name: 'María', name: 'María González', phone: '+595981123456', email: 'maria@email.com' }) {
  const val = (v) => {
    if (!v?.source) return null;
    if (v.source === 'static') return v.text || '';
    return sample[v.source.replace('contact.', '')] || '';
  };
  return String(body).replace(/\{\{(\d+)\}\}/g, (m, n) => { const x = val(map.body?.[Number(n) - 1]); return x == null || x === '' ? m : x; });
}

// "Promo octubre 2026" → "wc-promo-octubre-2026-x7k2" (utm_campaign)
export function campaignSlug(name, rand = Math.random().toString(36).slice(2, 6)) {
  const base = String(name || 'campaign').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campaign';
  return `wc-${base}-${rand}`;
}

// One recipient's result from their Relay conversation (newest first): the campaign
// message = outbound, kind 'campaign', this template, created at/after the send (1 min
// slack); replied = any inbound message after it. → { message, replied_at } | null
export function matchCampaignMessage(messages = [], { template, sentAt }) {
  const from = Date.parse(sentAt || 0) - 60_000;
  const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0);
  const camp = messages
    .filter((m) => m?.direction === 'outbound' && m?.kind === 'campaign' && m?.template?.name === template && t(m) >= from)
    .sort((a, b) => t(a) - t(b))[0];
  if (!camp) return null;
  const reply = messages.filter((m) => m?.direction === 'inbound' && t(m) > t(camp)).sort((a, b) => t(a) - t(b))[0];
  return { message: camp, replied_at: reply ? new Date(t(reply)).toISOString() : null };
}

// Totals for a campaign from its recipient rows (+ clicks from PostHog).
// row.status: sending (waiting) | sent | delivered | read | failed; row.meta.skipped / replied_at
export function campaignResults(rows = [], clicks = 0) {
  const s = { recipients: rows.length, waiting: 0, skipped: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, clicked: Number(clicks) || 0 };
  for (const r of rows) {
    const st = String(r.status || '');
    if (r.meta?.skipped) { s.skipped++; continue; }
    if (st === 'sending') { s.waiting++; continue; }
    if (st === 'failed') { s.failed++; s.sent++; continue; }
    if (['sent', 'delivered', 'read'].includes(st)) s.sent++;
    if (['delivered', 'read'].includes(st)) s.delivered++;
    if (st === 'read') s.read++;
    if (r.meta?.replied_at) s.replied++;
  }
  const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);
  return { ...s, deliveredRate: pct(s.delivered, s.sent), readRate: pct(s.read, s.delivered), replyRate: pct(s.replied, s.delivered), clickRate: pct(Math.min(s.clicked, s.delivered), s.delivered) };
}
