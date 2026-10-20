// One person's WhatsApp messages for the user view (Analytics → a user), next to their
// Emails card. Pure — test/userWhatsApp.test.js.
//   rows   — email_log rows with channel 'whatsapp' for this person (to_email = their
//            email, or to_phone = their number); status from Relay's webhook
//   clicks — { [template]: n } their visits from a message's button (PostHog,
//            utm_source=whatsapp — WhatsApp itself doesn't report clicks)
//   names  — { [template_key]: 'Draft reminder' } for a readable type
const SENT = new Set(['sent', 'delivered', 'read', 'failed']);
export const templateOf = (row) => String(row?.subject || '').replace(/^WhatsApp\s*·\s*/i, '').trim() || 'other';

export function userWhatsApp(rows = [], clicks = {}, names = {}) {
  const msgs = rows
    .filter((r) => SENT.has(String(r?.status || '').toLowerCase()))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((r) => ({
      id: r.id,
      at: r.created_at,
      template: templateOf(r),
      type: names[r.template_key] || r.template_key || templateOf(r),
      status: String(r.status).toLowerCase(),
      to: r.to_phone || null,
      clicked: (Number(clicks[templateOf(r)]) || 0) > 0,
    }));
  const n = (st) => msgs.filter((m) => st.includes(m.status)).length;
  const delivered = n(['delivered', 'read']);
  const read = n(['read']);
  const clickedTotal = Object.values(clicks || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    summary: { sent: msgs.length, delivered, read, failed: n(['failed']), clicked: clickedTotal, readRate: pct(read, delivered), clickRate: pct(Math.min(clickedTotal, msgs.length), delivered) },
    messages: msgs,
  };
}
