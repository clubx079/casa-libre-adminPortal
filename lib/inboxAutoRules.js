// The one rule for the Inbox assistant answering by itself (lib/inboxAuto.js): every real
// question gets an answer, once. Robots, emojis and "gracias" never reach here (the AI sorts
// them out first, lib/waClassify.js), so there is no daily limit and no robot-loop check: 100 real
// messages get 100 answers. Pure — test/inboxAutoRules.test.js.
//   already_answered  this message was already answered — by an earlier AI reply that covered it,
//                     or by a team member who wrote after it
//   newer_message     a newer message from them is waiting: the reply to THAT one covers this one
//                     too (two questions in a row → one reply that answers both)
// pending = the messages from them since our last reply (AI or team): the ones this reply covers.
const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0) || 0;
// our instant replies to the campaign buttons (website lib/waKeywords.js): not a team member
export const isKeywordReplyText = (text) => /\/r\/(si-|cartera|proyecto)|No vas a recibir más mensajes de Casa[- ]Libre|preparar la migración de tu cartera/.test(String(text || ''));
// a team member wrote it in the Inbox (Relay: sent_by = the agent; 'api' = our code)
export const isTeamReply = (m) => m?.direction === 'outbound' && !!m?.sent_by && m.sent_by !== 'api' && !isKeywordReplyText(m?.text);
// A real answer to them: a TYPED message from us — the team in WhatsApp, the team in our admin
// Inbox (Relay marks those sent_by 'api') or the AI. Never an automatic template (views, draft
// reminder, sign-in code, campaign) and never the website's instant button reply.
export const isTemplateMessage = (m) => !!(m?.template?.name || m?.template_name || String(m?.type || '').toLowerCase() === 'template');
export const isRealReply = (m) => m?.direction === 'outbound' && !isTemplateMessage(m) && !isKeywordReplyText(m?.text) && !!String(m?.text || '').trim();

// inbound: the message the event is about; messages: the conversation (any order);
// coveredIds: inbound ids an earlier AI reply already answered; aiMessageIds: Relay ids of the AI's replies
export function autoGuards({ inbound, messages = [], coveredIds = new Set(), aiMessageIds = new Set(), now = Date.now() }) {
  const tIn = t(inbound) || now;
  const sorted = [...messages].sort((a, b) => t(a) - t(b));
  const before = sorted.filter((m) => m?.direction === 'outbound' && t(m) < tIn).pop();
  const secondsAfterOurs = before ? Math.round((tIn - t(before)) / 1000) : null;
  if (coveredIds.has(String(inbound?.id))) return { ok: false, reason: 'already_answered', secondsAfterOurs, pending: [] };
  if (sorted.some((m) => t(m) > tIn && isRealReply(m))) return { ok: false, reason: 'already_answered', secondsAfterOurs, pending: [] };
  if (sorted.some((m) => m?.direction === 'inbound' && t(m) > tIn && m.id !== inbound?.id)) return { ok: false, reason: 'newer_message', secondsAfterOurs, pending: [] };
  // the messages since our last real reply (an AI reply or a team member's)
  const lastReply = sorted.filter((m) => t(m) <= tIn && (aiMessageIds.has(m.id) || isRealReply(m))).pop();
  const pending = sorted.filter((m) => m?.direction === 'inbound' && t(m) <= tIn && (!lastReply || t(m) > t(lastReply)) && !coveredIds.has(String(m.id))).map((m) => String(m.id));
  if (!pending.includes(String(inbound?.id))) pending.push(String(inbound?.id));
  return { ok: true, reason: null, secondsAfterOurs, pending };
}

// The team tagged the chat "do not contact" → the assistant stays out (a person decided).
// Opted out (they replied BAJA / STOP) is NOT a block: it means no more campaigns or automatic
// messages, but when they write to us with a question they still get an answer (optedOut below
// tells the assistant to answer only that — no offers).
export function conversationBlocked(conv) {
  if ((conv?.tags || []).includes('do-not-contact')) return 'do_not_contact';
  return null;
}
export const optedOut = (conv, user = null) => String(conv?.opt_in_status || '').toLowerCase() === 'opted_out' || !!user?.whatsapp_opted_out_at;
