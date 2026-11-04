// One person's "Messages & activity" timeline (Analytics → a user), in ENGLISH, newest first:
// everything that happened with them in one list.
//   server (app/api/users/activity):  activityTimeline(…)
//     • their WhatsApp chat (Relay messages): what they wrote, what the team wrote, codes,
//       campaigns, templates
//     • the Inbox AI assistant (email_log 'inbox_ai' / 'inbox_ai_person'): its reply in English,
//       or the hand-over with the "someone will reply" message; read / delivered from the Relay
//       message it sent (relay_message_id); the clicks on its tracked links (PostHog link_click,
//       slug 'ai', answer = the reply's answer_ref)
//     • the Admin Manager (email_log 'manager' / 'manager_views' / 'open_issue')
//     • their feedback (stars + text)
//   browser (UserTimeline card):  mergeTimeline(activity, { emails, whatsapp, steps, relayOf })
//     • + the existing cards' rows: emails (/api/users/emails), WhatsApp automation messages
//       (/api/users/whatsapp), paid-listing steps and deleted listings (/api/users/paywall).
//       A row both sides know (same email_log id / Resend id / Relay message id) shows ONCE,
//       with the best status either side has.
// Pure (no fetch, no server-only imports) — test/userTimeline.test.js.
import { managerName } from './userEmails.js';
import { answerRef } from './aiLinks.js';

export const AI_IDS = ['inbox_ai', 'inbox_ai_person'];
export const MANAGER_IDS = ['manager', 'manager_views', 'open_issue'];
// their own taps and opt-outs on WhatsApp (website lib/waReplyLog.js)
export const REPLY_IDS = ['wa_reply'];

export const WHO_LABEL = { them: 'Them', team: 'Team member', ai: 'AI assistant', manager: 'Admin Manager', automation: 'Automation', feedback: 'Feedback' };

const str = (v) => (v == null ? '' : String(v));
const trim = (v) => str(v).trim();
export function parseMeta(row) {
  const e = row?.error;
  if (e && typeof e === 'object') return e;
  try { const j = JSON.parse(str(e)); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
// Resend dates look like "2026-11-05 00:52:11.123+00": browsers can't read a bare "+00" → "+00:00"
const iso = (v) => (v ? str(v).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00') : '');
const a = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

// English for display: { text: English, original: the text as written (only when it differs) }
function englishOf(english) {
  const get = (t) => (english instanceof Map ? english.get(t) : english?.[t]);
  return (raw) => {
    const t = trim(raw);
    if (!t) return { text: '', original: '' };
    const en = trim(get(t));
    return en && en !== t ? { text: en, original: t } : { text: t, original: '' };
  };
}

// Status: the further along wins (a click beats a read beats a delivery); a failure only shows
// when nothing better is known.
const RANK = { test: 0, 'not sent': 0, sending: 0, queued: 0, sent: 1, delivered: 2, read: 3, opened: 3, clicked: 4 };
const BAD = new Set(['failed', 'bounced', 'complained', 'suppressed']);
export function betterStatus(x, y) {
  const s1 = trim(x).toLowerCase(); const s2 = trim(y).toLowerCase();
  if (!s1) return s2 || null;
  if (!s2) return s1;
  if (BAD.has(s2) && (RANK[s1] ?? 0) <= 1) return s2;
  if (BAD.has(s1)) return (RANK[s2] ?? 0) >= 2 ? s2 : s1;
  return (RANK[s2] ?? 0) > (RANK[s1] ?? 0) ? s2 : s1;
}

const tplName = (m) => (typeof m?.template === 'string' ? m.template : m?.template?.name) || '';
const relayStatus = (m) => (m?.error?.message || m?.status === 'failed' ? 'failed' : trim(m?.status).toLowerCase() || null);

// Who wrote an outbound Relay message. sent_by: 'api' = our code; anything else = the agent who
// wrote it in Relay's inbox. Our admin Inbox sends through the API with metadata.agent.
export function relaySender(m) {
  const by = trim(m?.sent_by);
  const md = m?.metadata || {};
  if (by && by !== 'api') return { who: 'team', name: by };
  if (trim(md.agent)) return { who: 'team', name: trim(md.agent) };
  if (AI_IDS.includes(md.source)) return { who: 'ai', name: '' };
  if (md.source === 'open_issue') return { who: 'manager', name: '' };
  return { who: 'automation', name: '' };
}

function relayItem(m, en) {
  const at = iso(m?.timestamps?.created || m?.created_at);
  const id = str(m?.id);
  const media = m?.media?.type || (['image', 'video', 'audio', 'document', 'sticker', 'location'].includes(m?.type) ? m.type : '');
  const raw = trim(m?.text) || trim(m?.button?.text) || trim(m?.media?.caption);
  const tx = en(raw);
  const base = { key: `relay-${id}`, at, channel: 'whatsapp', relayId: id, matchIds: [id], ...tx };
  if (m?.direction === 'inbound') {
    const title = m?.button || m?.type === 'button' ? 'Tapped a button' : media && !raw ? `Sent ${a(media)}` : 'Wrote to us';
    return { ...base, who: 'them', whoLabel: WHO_LABEL.them, title, status: null, text: tx.text || (media ? `(${media})` : '') };
  }
  const s = relaySender(m);
  const tpl = tplName(m);
  const kind = trim(m?.kind).toLowerCase();
  const title = s.who === 'team' ? 'Team reply'
    : s.who === 'ai' ? 'AI assistant message'
      : kind === 'otp' ? 'Sign-in code'
        : kind === 'campaign' ? `Campaign${tpl ? ` · ${tpl}` : ''}`
          : tpl ? `Template · ${tpl}` : 'Message from our system';
  return {
    ...base,
    who: s.who,
    whoLabel: s.who === 'team' ? (s.name || WHO_LABEL.team) : WHO_LABEL[s.who],
    title,
    template: tpl || null,
    status: relayStatus(m),
    text: tx.text || (media ? `(${media})` : tpl ? `(template ${tpl})` : ''),
  };
}

// The reply's code in its tracked links: answer_ref, else derived from the message it answered.
export const answerKey = (meta = {}) => trim(meta.answer_ref) || (trim(meta.inbound_id) ? answerRef(meta.inbound_id) : '');

function aiItem(row, relayById, en) {
  const meta = parseMeta(row);
  const msg = row.relay_message_id ? relayById.get(str(row.relay_message_id)) : null;
  const handover = row.automation_id === 'inbox_ai_person';
  const q = en(meta.question);
  const status = betterStatus(row.status === 'test' ? 'not sent' : row.status, relayStatus(msg));
  const detail = [
    q.text ? `Their message: “${q.text}”` : '',
    meta.topic || row.subject ? `Topic: ${meta.topic || row.subject}` : '',
    meta.goal ? `Goal: ${meta.goal}` : '',
    handover && trim(meta.english) ? `The AI's draft for the team: “${trim(meta.english)}”` : '',
    handover && meta.note ? `Note: ${meta.note}` : '',
  ].filter(Boolean);
  const common = {
    key: `log-${row.id}`, at: iso(row.created_at), who: 'ai', whoLabel: WHO_LABEL.ai, channel: 'whatsapp',
    relayId: row.relay_message_id ? str(row.relay_message_id) : null,
    matchIds: [str(row.id), row.relay_message_id && str(row.relay_message_id)].filter(Boolean),
    answer: answerKey(meta) || null, clicks: [], status, detail,
  };
  if (handover) {
    const why = trim(meta.reason) || trim(meta.note) || trim(meta.topic) || 'needs a person';
    const h = en(meta.holding || msg?.text);
    return { ...common, title: `Handed to a person — ${why}`, ...h, handover: true };
  }
  const sent = trim(msg?.text);
  const english = trim(meta.english);
  return english
    ? { ...common, title: 'AI assistant replied', text: english, original: sent && sent !== english ? sent : '' }
    : { ...common, title: 'AI assistant replied', ...en(sent) };
}

function managerItem(row, relayById, en) {
  const meta = parseMeta(row);
  const base = {
    key: `log-${row.id}`, at: iso(row.created_at), who: 'manager', whoLabel: WHO_LABEL.manager,
    matchIds: [str(row.id), row.resend_id && str(row.resend_id), row.relay_message_id && str(row.relay_message_id)].filter(Boolean),
    testSend: row.status === 'test', reportId: row.run_id || null, detail: [],
  };
  const st = row.status === 'test' ? 'test' : trim(row.status) || null;
  if (row.automation_id === 'open_issue') {
    const action = trim(meta.action);
    const msg = row.relay_message_id ? relayById.get(str(row.relay_message_id)) : null;
    const by = trim(meta.by);
    const who = { whoLabel: `${WHO_LABEL.manager}${by ? ` · sent by ${by}` : ''}` };
    if (action === 'gift') {
      const n = Array.isArray(meta.properties) ? meta.properties.length : 0;
      return { ...base, ...who, channel: 'activity', title: 'Open issue · listings published free', text: `${n || 'Their'} listing${n === 1 ? '' : 's'} published as a gift${meta.gift_days ? ` for ${meta.gift_days} days` : ''}.`, original: '', status: st, relayId: null };
    }
    const tx = trim(meta.english) ? { text: trim(meta.english), original: trim(meta.text) !== trim(meta.english) ? trim(meta.text) : '' } : en(meta.text);
    return {
      ...base, ...who,
      channel: row.channel === 'whatsapp' || action === 'whatsapp' ? 'whatsapp' : 'email',
      title: `Open issue${row.subject ? ` · ${row.subject}` : ''}`,
      ...tx,
      detail: meta.subject ? [`Email subject: ${en(meta.subject).text}`] : [],
      status: betterStatus(st, relayStatus(msg)),
      relayId: row.relay_message_id ? str(row.relay_message_id) : null,
    };
  }
  if (row.automation_id === 'manager_views') {
    const placeholder = !row.subject || row.subject === 'views-no-contacts';
    const facts = meta.views != null ? `${meta.views} views, ${meta.contacts ?? 0} contacts on their listing` : '';
    const tx = placeholder ? { text: facts || 'Advice on their listing', original: '' } : en(row.subject);
    const wa = row.channel === 'whatsapp';
    return { ...base, channel: wa ? 'whatsapp' : 'email', title: 'Admin Manager: Listing views advice', ...(wa ? { text: facts || 'Advice on their listing (WhatsApp)', original: '' } : tx), detail: !placeholder && facts && !wa ? [facts] : [], status: st, relayId: wa ? row.relay_message_id || null : null };
  }
  return { ...base, channel: row.channel === 'whatsapp' ? 'whatsapp' : 'email', title: managerName(row.template_key) || 'Admin Manager: Personal email', ...en(row.subject), status: st, relayId: null };
}

// "Tapped SÍ" / "Opted out: replied BAJA" … — something THEY did
function replyItem(row) {
  const meta = parseMeta(row);
  const out = /optout/.test(str(row.template_key)) || row.template_key === 'baja';
  return {
    key: `log-${row.id}`, at: iso(row.created_at), who: 'them', whoLabel: WHO_LABEL.them, channel: 'activity',
    title: trim(row.subject) || `Replied ${str(row.template_key).toUpperCase()}`,
    text: out ? 'No more campaigns or automatic WhatsApps go to this number. If they write to us, the AI assistant still answers.' : (meta.how === 'typed' ? `They typed “${trim(meta.text)}”` : 'They tapped the button on our WhatsApp'),
    original: '', detail: [], status: null, matchIds: [str(row.id)], optOut: out,
  };
}

function feedbackItem(f, en) {
  const stars = Number(f?.rating) || null;
  return {
    key: `feedback-${f.id}`, at: iso(f.created_at), who: 'feedback', whoLabel: WHO_LABEL.feedback, channel: 'feedback',
    title: stars ? `Gave ${stars} star${stars === 1 ? '' : 's'}` : 'Gave feedback', stars,
    ...en(f.message), detail: f.source ? [`From: ${f.source}`] : [], status: null, matchIds: [],
  };
}

// The texts the server should put into English before activityTimeline (lib/issueTranslate.js).
export function textsToTranslate({ messages = [], logRows = [], feedback = [] } = {}) {
  const out = [];
  for (const m of messages) out.push(m?.text, m?.button?.text, m?.media?.caption);
  for (const r of logRows) {
    const meta = parseMeta(r);
    if (AI_IDS.includes(r.automation_id)) out.push(meta.question, meta.holding);
    else if (r.automation_id === 'open_issue') { if (!trim(meta.english)) out.push(meta.text); out.push(meta.subject); }
    else if (r.subject !== 'views-no-contacts') out.push(r.subject);
  }
  for (const f of feedback) out.push(f?.message);
  return [...new Set(out.map(trim).filter(Boolean))];
}

// messages: Relay messages of their chat · logRows: email_log rows (AI_IDS + MANAGER_IDS)
// feedback: feedback rows · clicks: [{ answer, path, at, n }] link_click on the AI's links
// english: Map original → English
export function activityTimeline({ messages = [], logRows = [], feedback = [], clicks = [], english = new Map() } = {}) {
  const en = englishOf(english);
  const relayById = new Map(messages.filter((m) => m?.id).map((m) => [str(m.id), m]));
  const items = [];
  for (const r of logRows) {
    if (AI_IDS.includes(r.automation_id)) items.push(aiItem(r, relayById, en));
    else if (MANAGER_IDS.includes(r.automation_id)) items.push(managerItem(r, relayById, en));
    else if (REPLY_IDS.includes(r.automation_id)) items.push(replyItem(r));
  }
  // a Relay message the AI / the Admin Manager sent is shown on their row (it gave its status)
  const shown = new Set(items.map((i) => i.relayId).filter(Boolean));
  for (const m of messages) if (m?.id && !shown.has(str(m.id))) items.push(relayItem(m, en));
  for (const f of feedback) items.push(feedbackItem(f, en));

  // clicks on the AI's tracked links → on the reply they came from
  const byAnswer = new Map(items.filter((i) => i.answer).map((i) => [i.answer, i]));
  for (const c of clicks) {
    const at = iso(c.at);
    const it = c.answer ? byAnswer.get(str(c.answer)) : null;
    if (it) {
      it.clicks.push({ at, path: c.path || '', n: Number(c.n) || 1 });
      it.status = betterStatus(it.status, 'clicked');
    } else {
      items.push({ key: `click-${c.answer || 'x'}-${c.path}-${at}`, at, who: 'them', whoLabel: WHO_LABEL.them, channel: 'whatsapp', title: 'Clicked a link from the AI assistant', text: c.path || '', original: '', status: 'clicked', matchIds: [], detail: [] });
    }
  }
  for (const i of items) if (i.clicks?.length) i.clicks.sort((x, y) => (x.at < y.at ? -1 : 1));
  return sortTimeline(items);
}

export const sortTimeline = (items) => items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : str(x.key).localeCompare(str(y.key))));

// The existing cards' rows as timeline items.
const STEP_AUTOMATIC = new Set(['gift', 'gift_lapsed']);
function emailItem(e) {
  return {
    key: `email-${e.id}`, at: iso(e.at), channel: 'email',
    who: e.manager ? 'manager' : 'automation', whoLabel: e.manager ? WHO_LABEL.manager : WHO_LABEL.automation,
    title: e.type_en || e.type || 'Email',
    text: e.subject_en || e.subject || '', original: e.subject_en && e.subject_en !== e.subject ? e.subject : '',
    status: trim(e.status).toLowerCase() || 'sent', untracked: e.untracked || null,
    testSend: !!e.testSend, reportId: e.reportId || null, matchIds: [str(e.id)], detail: [],
  };
}
function waItem(m) {
  return {
    key: `wa-${m.id}`, at: iso(m.at), channel: 'whatsapp', who: 'automation', whoLabel: WHO_LABEL.automation,
    title: m.type || m.template || 'WhatsApp message', template: m.template || null,
    text: m.text_en || m.text || '', original: m.text_en && m.text_en !== m.text ? m.text : '',
    status: m.clicked ? betterStatus(m.status, 'clicked') : trim(m.status).toLowerCase() || 'sent',
    matchIds: [str(m.id)], detail: [],
  };
}
function stepItem(s, i) {
  const team = s.kind === 'deleted' && /by the team/i.test(str(s.title));
  const who = team ? 'team' : STEP_AUTOMATIC.has(s.kind) ? 'automation' : 'them';
  return {
    key: `step-${s.kind}-${s.listingId}-${i}`, at: iso(s.at), channel: s.kind === 'deleted' ? 'listing' : 'activity',
    who, whoLabel: WHO_LABEL[who], title: s.title || s.kind, text: s.detail || '', original: '', status: null,
    step: s, matchIds: [], detail: [],
  };
}

// activity: activityTimeline's items · emails / whatsapp / steps: the other routes' rows
// relayOf: { email_log id → Relay message id } for their WhatsApp automation rows
export function mergeTimeline(activity = [], { emails = [], whatsapp = [], steps = [], relayOf = {} } = {}) {
  const items = activity.map((i) => ({ ...i, matchIds: [...(i.matchIds || [])], detail: [...(i.detail || [])] }));
  const owner = new Map();
  for (const it of items) for (const id of it.matchIds) if (!owner.has(id)) owner.set(id, it);
  const out = [...items];
  const dropped = new Set();
  for (const e of emails) {
    const it = owner.get(str(e.id));
    if (it) { it.status = betterStatus(it.status, e.status); if (e.untracked && !it.untracked) it.untracked = e.untracked; continue; }
    out.push(emailItem(e));
  }
  for (const m of whatsapp) {
    const it = owner.get(str(m.id));
    if (it) { it.status = betterStatus(it.status, m.clicked ? 'clicked' : m.status); continue; }
    const w = waItem(m);
    const rid = relayOf?.[m.id] ?? relayOf?.[str(m.id)];
    const twin = rid ? owner.get(str(rid)) : null;
    if (twin && twin.key === `relay-${rid}`) {
      // the same message seen in their chat: one row, the automation's name, the best status
      dropped.add(twin.key);
      w.status = betterStatus(w.status, twin.status);
      if (!w.text) { w.text = twin.text; w.original = twin.original; }
      w.matchIds.push(str(rid));
    }
    out.push(w);
  }
  steps.forEach((s, i) => out.push(stepItem(s, i)));
  return sortTimeline(out.filter((i) => !dropped.has(i.key)));
}

// Counts for the card's filter chips.
export function timelineCounts(items = []) {
  const c = { all: items.length };
  for (const i of items) { c[i.channel] = (c[i.channel] || 0) + 1; c[`who:${i.who}`] = (c[`who:${i.who}`] || 0) + 1; }
  return c;
}

// /inbox link for their chat (test mode when the assistant works on Relay's test number)
export const chatLink = (phone, mode = 'live') => {
  const d = str(phone).replace(/\D/g, '');
  return d ? `/inbox?phone=${d}${mode === 'test' ? '&mode=test' : ''}` : null;
};
