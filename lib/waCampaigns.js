// WhatsApp campaigns (admin → WhatsApp campaigns), the same flow as Relay's own
// Campaigns page: 1 · Message (name + approved template), 2 · Audience, 3 · Variables,
// 4 · Send (now / schedule / draft, live or test). Sending goes through Relay's
// POST /v1/campaigns, so Relay's rules apply exactly as on its own page: everyone who has
// not opted out receives it (since 2026-10-29 Relay no longer needs an opt-in — Hamza),
// +1 numbers are skipped for marketing templates, and it throttles to the number's limit.
// Each campaign is a BATCH: the first N people of an audience, leaving out who an earlier
// batch already had, or a re-send to an earlier batch (everyone / didn't read / …).
// Test mode never uses a real person's number: leads and users ride on 10 reserved
// simulation numbers (SIM_PHONES); live sends refuse those, and leads when WA_LEADS_LIVE is '0'.
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
    seen.set(phone, { phone, name, first_name: name ? name.split(/\s+/)[0] : null, email: r?.email ? String(r.email).trim().toLowerCase() : null, source: r?.source || null, key: r?.key || null, ...(r?.real_phone ? { real_phone: r.real_phone } : {}) });
  }
  return { recipients: [...seen.values()], invalid };
}

// Contact fields a variables map needs (Relay skips contacts missing one of them).
export function neededFields(map = {}) {
  const f = new Set();
  for (const v of [...(map.header || []), ...(map.body || []), map.button].filter(Boolean)) if (String(v.source || '').startsWith('contact.')) f.add(v.source.replace('contact.', ''));
  return [...f];
}

// The button's "Tracked link": for templates whose button is https://casa-libre.com.py/r/{{1}}.
// Each PERSON gets wa?sell=1&b=<batch slug>&r=<their code> — the website's /r/wa records the
// click under that batch and person (link_click.batch / .recipient) and lands on the home page
// with the sell wizard open, utm_campaign = the batch, utm_content = the person. WhatsApp never
// reports button taps, so this is the click count. Relay fills the button from a contact
// attribute (attr.<key>, one key per batch so two batches never overwrite each other's link).
export const TRACKED = 'tracked';
export const trackedSuffix = (slug, ref = '') => `wa?sell=1&b=${slug}${ref ? `&r=${ref}` : ''}`;
// FNV-1a → base36: short, stable codes (same input, same code — no store needed).
const fnv = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
export const recipientRef = (key) => fnv(`r:${key}`).padStart(7, '0').slice(0, 8);
export const linkAttr = (slug) => `clb_${fnv(slug)}`;
// Who clicked, on the batch's recipient rows: byRef = Map person code → first click time
// (lib/waCampaignClicks.js recipientClicks; '' = taps on a link without a person code — batches
// sent before per-person links: when the batch reached ONE person, those taps are theirs).
export function markClicks(recipients = [], byRef = new Map()) {
  const reached = recipients.filter((r) => !r.meta?.skipped);
  const loose = byRef.get('') || null;
  return recipients.map((r) => {
    if (r.meta?.skipped || r.meta?.sim) return r;
    const at = byRef.get(recipientRef(r.meta?.key || r.phone)) || (loose && reached.length === 1 ? loose : null);
    return at && !r.meta?.clicked_at ? { ...r, meta: { ...r.meta, clicked_at: at } } : r;
  });
}
// phone → { [linkAttr]: the person's link } for the batch's contacts. Test-mode simulation numbers
// carry many people at once: they get the batch link with r=sim.
export function trackedAttributes(slug, recipients = []) {
  const key = linkAttr(slug);
  const out = new Map();
  for (const r of recipients) if (!out.has(r.phone)) out.set(r.phone, { [key]: trackedSuffix(slug, r.sim ? 'sim' : recipientRef(r.key || r.phone)) });
  return out;
}
export const missingValue = (r, fields = []) => fields.some((k) => !String(r?.[k] || '').trim());

// Why one recipient won't get it (null = they will). Relay's rule since 2026-10-29: everyone
// who hasn't opted out — an opt-in is no longer needed.
// optIn: Map phone → 'opted_in' | 'opted_out' | 'unknown' (Relay contacts)
// optedOut: Set of phones that opted out on our side (users.whatsapp_opted_out_at)
export function skipReason(r, optIn = new Map(), optedOut = new Set(), { marketing = false, fields = [] } = {}) {
  if (optIn.get(r.phone) === 'opted_out' || optedOut.has(r.phone) || (r.real_phone && optedOut.has(r.real_phone))) return 'opted_out';
  if (marketing && r.phone.startsWith('+1')) return 'us_marketing';
  if (missingValue(r, fields)) return 'missing_value';
  return null;
}

// Who will receive it, before sending. noOptIn = of those, how many never opted in (they
// still receive it — shown so the team knows).
export function audienceCounts(recipients = [], optIn = new Map(), optedOut = new Set(), { marketing = false, fields = [] } = {}) {
  const c = { total: recipients.length, willReceive: 0, noOptIn: 0, optedOut: 0, usMarketing: 0, missingValue: 0 };
  const key = { opted_out: 'optedOut', us_marketing: 'usMarketing', missing_value: 'missingValue' };
  for (const r of recipients) {
    const why = skipReason(r, optIn, optedOut, { marketing, fields });
    if (why) { c[key[why]]++; continue; }
    c.willReceive++;
    if (optIn.get(r.phone) !== 'opted_in') c.noOptIn++;
  }
  return c;
}

// ── batches ──────────────────────────────────────────────────────────────────
// A person's identity across batches: lead:<id> / user:<id>, else the phone.
export const recipientKey = (r) => r?.key || r?.phone;
// The first `size` people of the audience (0 = all of them), leaving out the keys an
// earlier batch already had (`done`). → { batch, total, already, left, from, to }
export function pickBatch(recipients = [], { size = 0, done = new Set() } = {}) {
  const fresh = recipients.filter((r) => !done.has(recipientKey(r)));
  const n = Number(size) > 0 ? Math.min(Math.floor(Number(size)), fresh.length) : fresh.length;
  const already = recipients.length - fresh.length;
  return { batch: fresh.slice(0, n), total: recipients.length, already, left: fresh.length - n, from: n ? already + 1 : 0, to: already + n };
}

// Re-send to an earlier batch: who of it. rows = that batch's recipient rows ({ status, meta }).
export const BATCH_FILTERS = [
  ['all', 'Everyone in that batch'],
  ['not_read', 'Didn\'t read it'],
  ['read_no_reply', 'Read it, didn\'t reply'],
  ['not_clicked', 'Didn\'t open the link'],
  ['replied', 'Replied'],
];
export function retargetRows(rows = [], filter = 'all') {
  const got = rows.filter((r) => !['opted_out', 'us_marketing'].includes(r.meta?.skipped));
  const pick = {
    all: () => true,
    not_read: (r) => r.status !== 'read',
    read_no_reply: (r) => r.status === 'read' && !r.meta?.replied_at,
    not_clicked: (r) => !r.meta?.clicked_at,
    replied: (r) => !!r.meta?.replied_at,
  }[filter] || (() => true);
  return got.filter(pick).map((r) => ({ phone: r.meta?.real_phone || r.phone, name: r.meta?.name || null, email: r.email || null, key: r.meta?.key || null, source: r.meta?.source || 'batch' }));
}

// ── test mode / live guard ───────────────────────────────────────────────────
// 10 reserved numbers, Relay contacts tagged SIM_TAG: test batches of leads and users run on
// them (round robin), so a real person's number never goes to Relay from a test.
export const SIM_TAG = 'cl-sim';
export const SIM_PHONES = Array.from({ length: 10 }, (_, i) => `+595999000${String(i + 1).padStart(3, '0')}`);
export const isSimPhone = (p) => /^\+595999000\d{3}$/.test(String(p || ''));
export function simulateRecipients(recipients = []) {
  let i = 0;
  return recipients.map((r) => (/^(lead|user):/.test(String(r.key || '')) ? { ...r, real_phone: r.phone, phone: SIM_PHONES[i++ % SIM_PHONES.length], sim: true } : r));
}
// What stops a LIVE send (null = nothing): the simulation numbers, or leads while live
// marketing to leads is switched off (decision: no marketing to leads yet).
export function liveProblem(recipients = [], { leadsLive = false } = {}) {
  if (recipients.some((r) => isSimPhone(r.phone))) return 'The audience has simulation numbers (+595 999 000 …) — those are for Test mode only.';
  if (!leadsLive && recipients.some((r) => String(r.key || '').startsWith('lead:'))) return 'Live campaigns to leads are switched off (WA_LEADS_LIVE=0). Run it in Test mode — it simulates the batch on test numbers.';
  return null;
}

// "Leads · Agents · #101–200 of 1,195" / "Again: Batch 1 · Didn't read it"
const SOURCE_LABEL = { users: 'Users', leads: 'Leads', relay: 'Relay contacts', phones: 'Pasted numbers', batch: 'Earlier batch' };
const SEGMENT_LABEL = { all: '', verified: 'Verified WhatsApp', sellers: 'Sellers', no_listing: 'No listing yet', opted_in: 'Opted in', agent: 'Agents', agency: 'Agencies', developer: 'Developers' };
export function audienceLabel(def = {}) {
  if (def.source === 'batch') return `Again: ${def.from_batch_name || 'an earlier batch'} · ${(BATCH_FILTERS.find(([k]) => k === def.batch_filter) || BATCH_FILTERS[0])[1]}`;
  const seg = String(def.segment || 'all').startsWith('tag:') ? `Tag ${def.segment.slice(4)}` : SEGMENT_LABEL[def.segment] ?? def.segment;
  const range = def.range?.to ? `#${def.range.from}–${def.range.to} of ${Number(def.range.of).toLocaleString('en-US')}` : '';
  return [SOURCE_LABEL[def.source] || def.source, seg, range].filter(Boolean).join(' · ');
}

// The variables Relay wants: { body: ['contact.first_name', 'static:…'], buttons: [{ index, source }] }
// map: { body: [{ source, text }], button: { source, text, track } }, slug = the campaign's
// click-tracking key (utm_campaign) — appended to a fixed button text so PostHog counts clicks.
export function relayVariables(map = {}, slug = '') {
  const one = (v) => (v?.source === 'static' ? `static:${String(v.text || '')}` : String(v?.source || ''));
  const out = { body: (map.body || []).map(one) };
  if (map.header?.length) out.header = map.header.map(one);
  if (map.button && map.button.source === TRACKED) {
    out.buttons = [{ index: 0, source: `attr.${linkAttr(slug)}` }];   // each person's own link (trackedAttributes)
  } else if (map.button && map.button.source) {
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
  const nh = Number(template?.variables?.header) || 0;
  for (let i = 0; i < nh; i++) {
    const v = map.header?.[i];
    if (!v?.source) return `Choose a value for Header {{${i + 1}}}.`;
    if (v.source === 'static' && !String(v.text || '').trim()) return `Write the text for Header {{${i + 1}}}.`;
  }
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

// Totals for a campaign from its recipient rows (+ clicks from PostHog: people who opened the
// link; a recipient row can also carry meta.clicked_at — the larger of the two counts).
// row.status: sending (waiting) | sent | delivered | read | failed; row.meta.skipped / replied_at
export function campaignResults(rows = [], clicks = 0) {
  const s = { recipients: rows.length, waiting: 0, skipped: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0, clicked: Math.max(Number(clicks) || 0, rows.filter((r) => r.meta?.clicked_at).length) };
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
  return { ...s, deliveredRate: pct(s.delivered, s.sent), readRate: pct(s.read, s.delivered), replyRate: pct(s.replied, s.delivered), clickRate: pct(Math.min(s.clicked, s.delivered), s.delivered), failRate: pct(s.failed, s.sent) };
}
