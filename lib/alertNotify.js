// Alerts → email (pure — test/alertNotify.test.js). Every NEW alert on the admin Alerts page
// (lib/alerts.js: needs-a-person, CARTERA, PROYECTO, agency / developer portfolio size) is emailed
// once to the team. lib/alertNotifyRun.js reads/writes the state and sends.
//   state = { seeded_at, sent: { [alertId]: iso | 'seed' } } — automations row 'alerts_notify'
//   (free_tiers[0], like alerts_state; no new table). The first run only SEEDS: every alert already
//   on the page is marked, so nothing that existed before this shipped is emailed.
//   Recipients: ALERT_EMAIL_TO (comma-separated) → else the row's `to` list → omar@airosofts.com.
export const ALERT_NOTIFY_ID = 'alerts_notify';
export const DEFAULT_ALERT_TO = ['omar@airosofts.com'];
export const KEEP_DAYS = 30;
const D = 86400000;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function alertRecipients(envValue, saved) {
  const parse = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL.test(x));
  const fromEnv = parse(envValue);
  if (fromEnv.length) return [...new Set(fromEnv)];
  const fromRow = parse(saved);
  return fromRow.length ? [...new Set(fromRow)] : [...DEFAULT_ALERT_TO];
}

export function readNotifyState(row) {
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return { seeded_at: s.seeded_at || null, sent: s.sent && typeof s.sent === 'object' ? { ...s.sent } : {}, to: s.to || null };
}

// → { seed: bool, toSend: [alert], state: next state (without the sends' marks) }
export function alertsToNotify({ alerts = [], state = { sent: {} }, now = Date.now() } = {}) {
  const sent = { ...(state.sent || {}) };
  for (const [k, v] of Object.entries(sent)) {   // forget marks older than KEEP_DAYS (alerts live 7 days)
    const t = v === 'seed' ? Date.parse(state.seeded_at || 0) : Date.parse(v);
    if (!Number.isFinite(t) || now - t > KEEP_DAYS * D) delete sent[k];
  }
  if (!state.seeded_at) {
    for (const a of alerts) sent[a.id] = 'seed';
    return { seed: true, toSend: [], state: { ...state, seeded_at: new Date(now).toISOString(), sent } };
  }
  const toSend = alerts.filter((a) => a && a.status === 'open' && !sent[a.id]);
  return { seed: false, toSend, state: { ...state, sent } };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digitsOf = (p) => String(p || '').replace(/\D/g, '');

// The email for one alert (English — it goes to the team). adminUrl = the admin's base URL.
export function alertEmail(a, { adminUrl = '', countryName = '', wroteEn = [] } = {}) {
  const base = String(adminUrl || '').replace(/\/+$/, '');
  const chat = `${base}/inbox?phone=${digitsOf(a.digits || a.phone)}`;
  const page = `${base}/alerts`;
  const who = [a.name, a.phone, a.account?.email].filter(Boolean).join(' · ');
  const wrote = (a.wrote || []).slice(0, 4);
  const subject = `[Alert] ${a.label}: ${a.name || a.phone}${countryName ? ` (${countryName})` : ''}`;
  const rows = [
    ['What', a.label],
    ['Who', who],
    ['When', a.since ? new Date(a.since).toUTCString().replace(' GMT', ' UTC') : ''],
    ['Why', a.reason || ''],
    a.windowHours != null ? ['WhatsApp window', a.windowHours > 0 ? `${Math.floor(a.windowHours)} h left to answer freely` : 'closed — only a template can be sent'] : null,
  ].filter((r) => r && r[1]);
  const snippet = wrote.map((w, i) => `<div style="margin:0 0 6px;padding:8px 12px;background:#f9f4ee;border-radius:10px;font-size:14px;line-height:1.5">${esc(w)}${wroteEn[i] && wroteEn[i] !== w ? `<div style="font-size:12px;color:rgba(17,17,17,.55);margin-top:3px">EN: ${esc(wroteEn[i])}</div>` : ''}</div>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f9f4ee;font-family:Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f4ee;padding:28px 0"><tr><td align="center">
  <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1.5px solid rgba(17,17,17,.12);border-radius:18px">
    <tr><td style="padding:24px 28px 4px"><div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b23a3a">New alert${countryName ? ` · ${esc(countryName)}` : ''}</div>
      <div style="font-size:20px;font-weight:700;margin-top:6px">${esc(a.label)}</div></td></tr>
    <tr><td style="padding:10px 28px 0"><table cellpadding="0" cellspacing="0" style="font-size:13.5px;line-height:1.5">${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:rgba(17,17,17,.5);vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join('')}</table></td></tr>
    ${snippet ? `<tr><td style="padding:14px 28px 0"><div style="font-size:12px;color:rgba(17,17,17,.5);margin-bottom:6px">What they wrote</div>${snippet}</td></tr>` : ''}
    ${a.draft?.es ? `<tr><td style="padding:10px 28px 0"><div style="font-size:12px;color:rgba(17,17,17,.5);margin-bottom:6px">Draft answer</div><div style="font-size:13.5px;line-height:1.5">${esc(a.draft.en || a.draft.es)}</div></td></tr>` : ''}
    <tr><td style="padding:20px 28px 8px"><a href="${esc(chat)}" style="display:block;background:#111;color:#f9f4ee;text-decoration:none;font-size:15px;font-weight:700;text-align:center;padding:13px 20px;border-radius:999px">Open the chat in the admin</a></td></tr>
    <tr><td style="padding:0 28px 22px;font-size:12px;color:rgba(17,17,17,.5)">or see every alert: <a href="${esc(page)}" style="color:#111">${esc(page)}</a></td></tr>
  </table></td></tr></table></body></html>`;
  const text = [
    `New alert${countryName ? ` (${countryName})` : ''}: ${a.label}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    wrote.length ? `What they wrote:\n${wrote.map((w, i) => `- ${w}${wroteEn[i] && wroteEn[i] !== w ? ` (EN: ${wroteEn[i]})` : ''}`).join('\n')}` : '',
    `Open the chat: ${chat}`,
    `All alerts: ${page}`,
  ].filter(Boolean).join('\n');
  return { subject, html, text };
}
