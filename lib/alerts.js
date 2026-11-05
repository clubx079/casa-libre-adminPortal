// Alerts (admin → Alerts): every WhatsApp chat that needs a person, until a team member actually
// answers. Pure — test/alerts.test.js; the data comes from lib/alertsData.js.
//   needs-a-person   the Inbox assistant handed the chat over (lib/inboxAuto.js: tag + an email_log
//                    row 'inbox_ai_person' with the question, reason, holding message and draft)
//   cartera          an agency tapped CARTERA (wants its whole portfolio migrated)
//   proyecto         a developer tapped PROYECTO (has a project to publish)
// An alert starts at the message that triggered it (the inbound the assistant handed over / the
// CARTERA-PROYECTO tap) and stays OPEN until a team member writes in that chat after it (Relay
// sent_by = an agent, not 'api'), or someone clicks "Mark handled" (state, by whom and when).
// Opening the chat does NOT close it. Closed alerts stay visible for HANDLED_DAYS.
import { isTeamMessage } from './openIssues.js';
import { windowHoursLeft, formatPhone, phoneKey } from './inboxRules.js';

export const ALERT_TAGS = { 'needs-a-person': 'person', cartera: 'cartera', proyecto: 'proyecto' };
export const TAG_OF = { person: 'needs-a-person', cartera: 'cartera', proyecto: 'proyecto' };
export const ALERT_LABEL = { person: 'Needs a person', cartera: 'CARTERA — portfolio migration', proyecto: 'PROYECTO — project' };
export const ALERT_ABOUT = {
  cartera: 'An agency wants its whole portfolio migrated. The website replied automatically and asked how many properties they have and where they list; when they answer, the assistant sends the offer for that size (11+ listings opens its own alert with the count).',
  proyecto: 'A developer has a project to publish. The website replied automatically; a person has to follow up.',
};
export const HANDLED_DAYS = 7;
const D = 86400000;

const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0) || 0;
const digitsOf = (p) => String(p || '').replace(/\D/g, '');
const textOf = (m) => String(m?.text ?? m?.button?.text ?? m?.interactive?.title ?? '').trim();
const KW = /^(cartera|proyecto)$/i;
// the CARTERA / PROYECTO tap: the button's text or payload, or the word typed alone
export function keywordOf(m) {
  if (m?.direction !== 'inbound') return null;
  for (const v of [m?.text, m?.button?.text, m?.button?.payload, m?.interactive?.title, m?.interactive?.id]) {
    const s = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    if (KW.test(s)) return s.toLowerCase();
  }
  return null;
}

// The alert kinds a conversation carries (Relay stores tags lowercase; lowercased again to be safe).
export const alertTagsOf = (c) => [...new Set((c?.tags || []).map((x) => String(x).toLowerCase()).filter((x) => ALERT_TAGS[x]))];
export const isAlertChat = (c) => alertTagsOf(c).length > 0;

// What started the alert: { id, at, message } — or null when nothing can be dated.
function triggerOf(type, c, msgs, handover) {
  if (type === 'person') {
    if (handover) {
      const inId = String(handover.meta?.inbound_id || '');
      const m = inId ? msgs.find((x) => String(x.id) === inId) : null;
      return { id: inId || `log:${handover.created_at}`, at: m ? t(m) : Date.parse(handover.created_at) || 0, message: m || null };
    }
    // tagged without a hand-over row (the assistant's loop / repeat guard stopped it): the newest message from them
    const m = [...msgs].filter((x) => x.direction === 'inbound').sort((a, b) => t(b) - t(a))[0];
    if (m) return { id: String(m.id), at: t(m), message: m };
  } else {
    const m = [...msgs].sort((a, b) => t(b) - t(a)).find((x) => keywordOf(x) === type);
    if (m) return { id: String(m.id), at: t(m), message: m };
  }
  const at = Date.parse(c?.last_inbound_at || 0) || 0;
  return at ? { id: `at:${new Date(at).toISOString()}`, at, message: null } : null;
}

// → the alerts (open first, newest first) for the given chats.
//   chats        conversations of this country with an alert tag, each with .messages (Relay)
//   handovers    email_log rows automation 'inbox_ai_person' ({ to_phone, created_at, meta })
//   state        { [alertId]: { state: 'handled', by, at, snapshot } } — "Mark handled"
//   personByPhone  Map(last 8 digits → { full_name, email }) — the account in this country's DB
export function buildAlerts({ chats = [], handovers = [], state = {}, now = Date.now(), personByPhone = new Map() } = {}) {
  const newestHandover = new Map();
  for (const r of handovers) {
    const k = digitsOf(r.to_phone);
    const prev = newestHandover.get(k);
    if (!prev || Date.parse(r.created_at) > Date.parse(prev.created_at)) newestHandover.set(k, r);
  }
  const out = [];
  for (const c of chats) {
    const digits = digitsOf(c.phone);
    if (!digits) continue;
    const msgs = c.messages || [];
    const account = personByPhone.get(phoneKey(digits)) || null;
    const name = account?.full_name || c.name || formatPhone(digits);
    for (const tag of alertTagsOf(c)) {
      const type = ALERT_TAGS[tag];
      const ho = type === 'person' ? newestHandover.get(digits) || null : null;
      const trig = triggerOf(type, c, msgs, ho);
      if (!trig) continue;
      const id = `${type}:${digits}:${trig.id}`;
      // what they wrote: the trigger, then up to 3 later messages from them
      const later = msgs.filter((m) => m.direction === 'inbound' && t(m) > trig.at && textOf(m)).sort((a, b) => t(a) - t(b)).slice(-3).map(textOf);
      const first = type === 'person' ? String(ho?.meta?.question || textOf(trig.message) || '').trim() : (textOf(trig.message) || tag.toUpperCase());
      const wrote = [...new Set([first, ...later].filter(Boolean))];
      const answer = msgs.filter((m) => isTeamMessage(m) && t(m) > trig.at).sort((a, b) => t(a) - t(b))[0] || null;
      const st = state[id]?.state === 'handled' ? state[id] : null;
      const closes = [
        ...(answer ? [{ how: 'answered', by: answer.sent_by, at: new Date(t(answer)).toISOString() }] : []),
        ...(st ? [{ how: 'handled', by: st.by || null, at: st.at || null }] : []),
      ].sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
      const closed = closes[0] || null;
      if (closed && now - Date.parse(closed.at || 0) > HANDLED_DAYS * D) continue;
      // an agency told the assistant its portfolio size (lib/agencyOffer.js): the count on the card
      const listings = type === 'person' ? Number(ho?.meta?.portfolio_listings) || 0 : 0;
      out.push({
        id, type, tag, label: listings ? `Agency portfolio — ${listings} listings` : ALERT_LABEL[type],
        ...(listings ? { portfolio: listings } : {}),
        phone: `+${digits}`, digits, name, account: account ? { name: account.full_name || null, email: account.email || null } : null, whatsappName: c.name || null,
        since: new Date(trig.at).toISOString(),
        windowHours: windowHoursLeft(c, now),
        wrote,
        reason: type === 'person' ? (ho ? String(ho.meta?.note || ho.meta?.reason || '').trim() || 'The assistant could not answer it from our facts.' : 'The assistant stopped answering by itself (repeated messages or a loop) — no hand-over note.') : ALERT_ABOUT[type],
        topic: type === 'person' ? String(ho?.subject || ho?.meta?.topic || '').trim() || null : null,
        holding: type === 'person' ? String(ho?.meta?.holding || '').trim() || null : null,
        draft: type === 'person' && ho?.meta?.draft ? { es: String(ho.meta.draft), en: String(ho.meta.english || '') } : null,
        status: closed ? closed.how : 'open',
        closed,
      });
    }
  }
  // handled, and the tag is gone from Relay (Mark handled removes it): the saved snapshot, for 7 days
  for (const [id, st] of Object.entries(state || {})) {
    if (st?.state !== 'handled' || !st.snapshot || out.some((a) => a.id === id)) continue;
    if (now - Date.parse(st.at || 0) > HANDLED_DAYS * D) continue;
    out.push({ ...st.snapshot, id, windowHours: null, status: 'handled', closed: { how: 'handled', by: st.by || null, at: st.at || null } });
  }
  return out.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || Date.parse(b.since) - Date.parse(a.since));
}

export const alertCounts = (alerts = []) => ({
  open: alerts.filter((a) => a.status === 'open').length,
  closed: alerts.filter((a) => a.status !== 'open').length,
  byType: Object.fromEntries(Object.keys(ALERT_LABEL).map((k) => [k, alerts.filter((a) => a.status === 'open' && a.type === k).length])),
});

// What "Mark handled" saves: enough to keep showing the card once the tag is gone.
export const alertSnapshot = (a) => ({ type: a.type, tag: a.tag, label: a.label, ...(a.portfolio ? { portfolio: a.portfolio } : {}), phone: a.phone, digits: a.digits, name: a.name, account: a.account, whatsappName: a.whatsappName, since: a.since, wrote: a.wrote, reason: a.reason, topic: a.topic, holding: a.holding, draft: a.draft });

// "Open chat": the Inbox on that conversation (Relay test chats with &mode=test).
export const chatLink = (digits, mode) => `/inbox?phone=${digitsOf(digits)}${mode === 'test' ? '&mode=test' : ''}`;
