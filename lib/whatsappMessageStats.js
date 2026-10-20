// WhatsApp MESSAGES analytics (what our automations sent), like lib/emailStats.js for
// email. Not the "WhatsApp contacts" card (buyers tapping a listing's WhatsApp button —
// lib/whatsappStats.js). Pure — test/whatsappMessageStats.test.js.
//
// rows: email_log rows with channel 'whatsapp' (lib/automations/whatsappSend.js on the
// sites). Relay's webhook (/api/relay/webhook) keeps their status current:
//   sending → sent → delivered → read, or failed.
// Clicks: WhatsApp does not report button clicks, so the sites put
// utm_source=whatsapp&utm_campaign=<template> on every button link (lib/whatsappTemplates.js
// waUtm) and PostHog counts those visits: clicks = { [template]: n }.
const SENT = new Set(['sent', 'delivered', 'read', 'failed']);
const DELIVERED = new Set(['delivered', 'read']);

export const templateOf = (row) => String(row?.subject || '').replace(/^WhatsApp\s*·\s*/i, '').trim() || 'other';

export function summarizeWhatsApp(rows = [], clicks = {}) {
  const blank = () => ({ sent: 0, delivered: 0, read: 0, failed: 0, clicked: 0 });
  const totals = blank();
  const byTemplate = {};
  const byDay = {};
  for (const r of rows) {
    const st = String(r?.status || '').toLowerCase();
    if (!SENT.has(st)) continue;                       // 'sending' = still on its way
    const t = templateOf(r);
    const d = String(r?.created_at || '').slice(0, 10);
    for (const b of [totals, (byTemplate[t] ||= blank()), (byDay[d] ||= blank())]) {
      b.sent += 1;
      if (DELIVERED.has(st)) b.delivered += 1;
      if (st === 'read') b.read += 1;
      if (st === 'failed') b.failed += 1;
    }
  }
  for (const [t, n] of Object.entries(clicks || {})) {
    const c = Number(n) || 0;
    if (!c) continue;
    (byTemplate[t] ||= blank()).clicked += c;
    totals.clicked += c;
  }
  const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);
  const rates = (b) => ({ ...b, readRate: pct(b.read, b.delivered), clickRate: pct(b.clicked, b.delivered) });
  return {
    totals: rates(totals),
    byTemplate: Object.entries(byTemplate).map(([template, b]) => ({ template, ...rates(b) })).sort((a, b) => b.sent - a.sent || b.clicked - a.clicked),
    byDay: Object.entries(byDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, b]) => ({ day, ...b })),
  };
}

// New verifications in a period: who verified a WhatsApp number vs who signed up by
// email / Google / Apple. users: [{ created_at, phone_verified_at, auth_provider, verified }]
export function verificationsInPeriod(users = [], sinceIso) {
  const since = Date.parse(sinceIso);
  const s = { whatsapp: 0, email: 0, google: 0, apple: 0 };
  for (const u of users) {
    if (!u || u.verified !== true) continue;
    if (u.phone_verified_at && Date.parse(u.phone_verified_at) >= since) s.whatsapp++;
    if (!(Date.parse(u.created_at) >= since)) continue;
    const p = String(u.auth_provider || '');
    if (p === 'google') s.google++;
    else if (p === 'apple') s.apple++;
    else if (p === 'email' || p === 'password') s.email++;
  }
  return s;
}
