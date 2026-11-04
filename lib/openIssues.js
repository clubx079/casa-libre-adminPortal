// Admin Manager → Open issues (AI Operations Plan, step 4): the audit Roland ran by hand, every
// day — a short list of people who need something from us, with names, the evidence, a
// suggestion and a ready message. It SUGGESTS; the team approves (lib/openIssuesActions.js);
// nothing is sent or given away by itself. Pure — test/openIssues.test.js; the data comes from
// lib/openIssuesStore.js.
//   unanswered      a real person wrote (not a robot, emoji or "gracias") and nothing went out
//                   after it — with the hours left in the 24 h window; the assistant's hand-over
//                   reason and draft when it passed the chat to a person
//   keyword         tapped CARTERA / PROYECTO and no person has written to them yet
//   payment         listings waiting for payment for days, from someone who wrote to us or a
//                   realtor (2+ listings) → suggest publishing them free as a gift (Roland: Daniel)
//   views           many views, no contacts: the advice went out and still nothing → a personal
//                   follow-up; or the automation is off → send the advice
//   funnel          an unfinished draft / a checkout that didn't finish, by name
//   security        an account the security watch suspended by itself → keep or lift
//   followup        the assistant answered (e.g. how to publish) days ago and they still haven't
//                   done it (nothing published / paid / finished) → resend with a nudge
import { inboundKind } from './waInboundKind.js';
import { isRealReply } from './inboxAutoRules.js';

export const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 };
export const ISSUE_TYPES = {
  unanswered: 'Messages',
  keyword: 'Messages',
  payment: 'Payments',
  views: 'Listings',
  funnel: 'Funnels',
  security: 'Security',
  followup: 'Follow-ups',
};
export const DEFAULT_SETTINGS = Object.freeze({ followupDays: 3, followupMaxDays: 21, giftAfterDays: 5, unansweredMinutes: 30, viewsEscalateDays: 7, minViews: 20, keywordHours: 1, draftMinDays: 2, lookbackDays: 30 });
const H = 3600000;
const D = 24 * H;

const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0) || 0;
const first = (full) => String(full || '').trim().split(/\s+/)[0] || '';
export const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-8);
const ago = (ms) => (ms < H ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < D ? `${Math.round(ms / H)} h` : `${Math.round(ms / D)} days`);
const titleOf = (p) => [p?.property_type, p?.neighborhood || p?.city].filter(Boolean).join(' · ') || 'a listing';
const tituloOf = (p) => [p?.property_type, p?.neighborhood || p?.city].filter(Boolean).join(' en ') || 'tu propiedad';
const quote = (s, n = 160) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
// a team member wrote it in the Inbox (Relay: sent_by = the agent); 'api' = our code (AI, keywords, automations)
export const isTeamMessage = (m) => m?.direction === 'outbound' && !!m?.sent_by && m.sent_by !== 'api';

// ── drafts (Spanish, voseo, no emojis, Casa-Libre with the hyphen) + English for the team ──
export function giftDraft(name, n) {
  const what = n === 1 ? 'tu propiedad' : `tus ${n} propiedades`;
  const whatEn = n === 1 ? 'your property' : `your ${n} properties`;
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  return {
    es: `${hi}, gracias por usar Casa-Libre. Cambiamos nuestra política de publicaciones, pero ya habías cargado ${what}, así que ${n === 1 ? 'la publicamos' : 'las publicamos'} sin costo: es un regalo de nuestra parte. ¡Éxitos con la venta!`,
    en: `${first(name) ? `Hi ${first(name)}` : 'Hi'}, thanks for using Casa-Libre. We changed our listing policy, but you had already uploaded ${whatEn}, so we published ${n === 1 ? 'it' : 'them'} for free: a gift from us. Good luck with the sale!`,
  };
}
export function viewsDraft(name, listing, views, days, escalate) {
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  const place = listing?.neighborhood || listing?.city;
  return escalate ? {
    es: `${hi}, te escribo del equipo de Casa-Libre. Tu publicación ${tituloOf(listing)} sigue recibiendo visitas (${views} en los últimos ${days} días) pero todavía ningún comprador te escribió. Si querés, revisamos juntos el precio comparado con propiedades parecidas${place ? ` en ${place}` : ''} y las fotos, para que empiecen a llegar consultas. ¿Te parece?`,
    en: `Hi, writing from the Casa-Libre team. Your listing ${titleOf(listing)} keeps getting views (${views} in the last ${days} days) but no buyer has written yet. If you like, we can review the price against similar properties${place ? ` in ${place}` : ''} and the photos together, so inquiries start coming in. Sound good?`,
  } : {
    es: `${hi}, tu publicación ${tituloOf(listing)} tuvo ${views} visitas en Casa-Libre en los últimos ${days} días, pero todavía ningún comprador te escribió. Cuando una propiedad se ve mucho y no recibe mensajes, casi siempre es por el precio o por las fotos: revisá tu precio y sumá fotos claras del frente y de los ambientes.`,
    en: `Hi, your listing ${titleOf(listing)} got ${views} views on Casa-Libre in the last ${days} days, but no buyer has written yet. When a property is seen a lot but gets no messages, it's almost always the price or the photos: check your price and add clear photos of the front and the rooms.`,
  };
}
export function keywordDraft(name, keyword) {
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  return keyword === 'proyecto' ? {
    es: `${hi}, te escribo del equipo de Casa-Libre. Gracias por tu interés en publicar tu proyecto. ¿Cuándo te queda bien una llamada corta para ver juntos cómo presentarlo y ponerlo frente a más compradores?`,
    en: 'Hi, writing from the Casa-Libre team. Thanks for your interest in listing your project. When suits you for a short call to see together how to present it and put it in front of more buyers?',
  } : {
    es: `${hi}, te escribo del equipo de Casa-Libre. Gracias por tu interés en pasar tu cartera. ¿Cuándo te queda bien una llamada corta para coordinar la migración? Nos encargamos de cargar tus propiedades.`,
    en: 'Hi, writing from the Casa-Libre team. Thanks for your interest in moving your portfolio. When suits you for a short call to coordinate the migration? We take care of uploading your properties.',
  };
}
const MISSING_ES = { price: 'el precio', area: 'la superficie', 'WhatsApp number': 'tu número de WhatsApp', photos: 'las fotos' };
const joinEs = (l) => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`);
export function draftDraft(name, what, missing, link) {
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  const falta = (missing || []).map((m) => MISSING_ES[m] || m);
  return {
    es: `${hi}, vimos que empezaste a publicar ${what ? `${what} ` : ''}en Casa-Libre y quedó sin terminar.${falta.length ? ` Te falta cargar ${joinEs(falta)}.` : ''} ¿Te ayudamos a completarla? Podés seguir desde acá: ${link}`,
    en: `Hi, we saw you started listing ${what || 'a property'} on Casa-Libre and didn't finish.${missing?.length ? ` Missing: ${missing.join(', ')}.` : ''} Can we help you complete it? Continue here: ${link}`,
  };
}
export function checkoutDraft(name, listing) {
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  return {
    es: `${hi}, vimos que intentaste publicar ${tituloOf(listing)} en Casa-Libre y el pago no se completó. ¿Tuviste algún problema? Si querés, te ayudamos a terminarlo.`,
    en: `Hi, we saw you tried to publish ${titleOf(listing)} on Casa-Libre and the payment didn't go through. Did you run into a problem? We're happy to help you finish it.`,
  };
}

// A promotion they started buying (Verified / home page) and never paid, after every email.
export function promoCallDraft(name, listing, plan) {
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  const what = { verified: 'el sello Verificado', home: 'destacar tu publicación en la portada', extend: 'extender tu publicación' }[plan] || 'la promoción';
  const whatEn = { verified: 'the Verified badge', home: 'featuring your listing on the home page', extend: 'extending your listing' }[plan] || 'the promotion';
  return {
    es: `${hi}, te escribo del equipo de Casa-Libre. Vimos que quisiste ${what} para ${tituloOf(listing)} y el pago no se completó. ¿Tuviste algún problema con la tarjeta? Si querés, te ayudamos a terminarlo.`,
    en: `Hi, writing from the Casa-Libre team. We saw you wanted ${whatEn} for ${titleOf(listing)} and the payment didn't go through. Did you have a problem with the card? We're happy to help you finish it.`,
  };
}

// ── "answered, but they didn't do it" ──
// What an AI reply asked them to do (its goal) → done since `sinceMs`? person = { user, listings, drafts }.
export const GOAL_TEXT = {
  publish: ['publish a property', 'nothing published yet', '/publicar'],
  finish_draft: ['finish their draft', 'the draft is still unfinished', '/cuenta/publicaciones?tab=borradores'],
  pay: ['publish the listing waiting for payment', 'still waiting for payment', '/cuenta/publicaciones'],
  sign_up: ['create an account', 'no account yet', '/cuenta'],
  fix_listing: ['fix their listing', 'the listing is still held', '/cuenta/publicaciones?tab=rechazadas'],
};
export const GOAL_DONE_TEXT = { publish: 'published a property', finish_draft: 'finished the listing', pay: 'paid — the listing is live', sign_up: 'created an account', fix_listing: 'fixed the listing' };
export function goalDoneAt(goal, person, sinceMs, payments = []) {
  const u = person?.user;
  if (!u) return null;
  const ls = person?.listings || [];
  const times = (arr) => arr.map((x) => Date.parse(x || 0)).filter((x) => x >= sinceMs).sort((a, b) => a - b);
  switch (goal) {
    case 'publish': case 'finish_draft': return times(ls.map((l) => l.created_at))[0] ?? null;
    case 'pay': { const paid = times(payments.filter((p) => String(p.user_id) === String(u.id) && p.status === 'succeeded').map((p) => p.created_at))[0]; return paid ?? (ls.some((l) => l.status === 'payment_pending') ? null : sinceMs); }
    case 'sign_up': return Math.max(sinceMs, Date.parse(u.created_at || 0) || sinceMs);
    case 'fix_listing': return ls.some((l) => l.status === 'rejected' || l.is_complete === false) ? null : sinceMs;
    default: return null;
  }
}
export function goalDone(goal, person, sinceMs, payments = []) {
  const u = person?.user;
  const ls = person?.listings || [];
  const after = (iso) => Date.parse(iso || 0) >= sinceMs;
  switch (goal) {
    case 'publish': return !!u && ls.some((l) => after(l.created_at));
    case 'finish_draft': return !!u && ls.some((l) => after(l.created_at));
    case 'pay': return !!u && (!ls.some((l) => l.status === 'payment_pending') || payments.some((p) => String(p.user_id) === String(u.id) && p.status === 'succeeded' && after(p.created_at)));
    case 'sign_up': return !!u;
    case 'fix_listing': return !!u && !ls.some((l) => l.status === 'rejected' || l.is_complete === false);
    default: return true;
  }
}
export function nudgeDraft(goal, name, link) {
  const hi = first(name) ? `Hola ${first(name)}` : 'Hola';
  const hiEn = first(name) ? `Hi ${first(name)}` : 'Hi';
  const es = {
    publish: `${hi}, ¿pudiste publicar tu propiedad en Casa-Libre? Te dejo el enlace de nuevo, te lleva 2 minutos: ${link} Si tenés alguna duda, respondé este mensaje.`,
    finish_draft: `${hi}, tu publicación en Casa-Libre quedó a medio cargar. Podés terminarla desde acá: ${link} Si algo no te funcionó, respondé este mensaje y te ayudamos.`,
    pay: `${hi}, tu publicación en Casa-Libre sigue esperando para salir al sitio. Podés activarla desde acá: ${link} Si tuviste algún problema con el pago, respondé este mensaje.`,
    sign_up: `${hi}, crear tu cuenta en Casa-Libre te lleva un minuto y después publicás gratis: ${link} Si tenés alguna duda, respondé este mensaje.`,
    fix_listing: `${hi}, tu publicación en Casa-Libre todavía no está visible. Cambiá las fotos o completá los datos desde acá y la revisamos enseguida: ${link}`,
  }[goal];
  const en = {
    publish: `${hiEn}, did you manage to publish your property on Casa-Libre? Here's the link again, it takes 2 minutes: ${link} If you have any questions, just reply.`,
    finish_draft: `${hiEn}, your Casa-Libre listing is half-finished. You can finish it here: ${link} If something didn't work, reply and we'll help.`,
    pay: `${hiEn}, your Casa-Libre listing is still waiting to go live. You can activate it here: ${link} If you had a problem with the payment, just reply.`,
    sign_up: `${hiEn}, creating your Casa-Libre account takes a minute and then you list for free: ${link} If you have any questions, just reply.`,
    fix_listing: `${hiEn}, your Casa-Libre listing isn't visible yet. Change the photos or complete the details here and we'll check it right away: ${link}`,
  }[goal];
  return es ? { es, en } : null;
}

// ── the chat side ──
// The last REAL message from the contact in a thread (robots, emojis, "gracias" left out).
// kindOf(m) → { kind, real } = the AI's sort (lib/waClassify.js); the wording rules only as a fallback.
export function lastRealInbound(messages = [], kindOf = null) {
  const sorted = [...messages].sort((a, b) => t(a) - t(b));
  let lastOut = null, found = null;
  for (const m of sorted) {
    if (m?.direction === 'outbound') { lastOut = m; continue; }
    if (m?.direction !== 'inbound') continue;
    const k = (kindOf && kindOf(m)) || inboundKind(m, { secondsAfterOurs: lastOut ? (t(m) - t(lastOut)) / 1000 : null });
    if (k.real) found = { m, kind: k.kind };
  }
  return found;
}
const pendingByUserIds = (pending = []) => new Set(pending.filter((l) => l.status === 'payment_pending').map((l) => String(l.created_by)));
const outAfter = (messages, ts) => messages.filter((m) => m?.direction === 'outbound' && t(m) > ts).sort((a, b) => t(a) - t(b));
// typed replies only: an automatic template after their message is not an answer (lib/inboxAutoRules.js)
const repliesAfter = (messages, ts) => outAfter(messages, ts).filter(isRealReply);

function personLine(p) {
  if (!p?.user) return 'No Casa-Libre account for this number.';
  const l = p.listings || [];
  const live = l.filter((x) => x.status === 'published' || (!x.status && x.admin_status === 'active')).length;
  const waiting = l.filter((x) => x.status === 'payment_pending').length;
  return `Account: ${p.user.full_name || p.user.email || 'no name'} · ${l.length} listing${l.length === 1 ? '' : 's'} (${live} live${waiting ? `, ${waiting} waiting for payment` : ''})${(p.drafts || []).length ? ` · ${p.drafts.length} unfinished draft${p.drafts.length === 1 ? '' : 's'}` : ''}`;
}

// → the issues, newest state applied, sorted (open first by priority, then oldest first)
export function buildIssues(input = {}) {
  const { country = 'py', now = Date.now(), chats = [], personByPhone = new Map(), aiLog = [], pending = [], usersById = new Map(),
    listingCountByUser = new Map(), viewsStats = [], vncEnabled = false, drafts = [], usersWithLive = new Set(), checkouts = [],
    suspensions = [], state = {}, site = '', kindOf = null, followups = {}, clicksByAnswer = new Map(), linkFor = null, payments = [], payExhausted = [] } = input;
  const S = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
  const out = [];
  const add = (issue) => out.push({ country, ...issue });
  const personOf = (phone) => personByPhone.get(phoneKey(phone)) || null;
  const handover = new Map(aiLog.filter((r) => r.automation_id === 'inbox_ai_person').map((r) => [String(r.meta?.inbound_id || ''), r]));
  const handoverByPhone = new Map();   // the newest hand-over per number
  for (const r of aiLog.filter((x) => x.automation_id === 'inbox_ai_person')) { const k = String(r.to_phone || '').replace(/\D/g, ''); const prev = handoverByPhone.get(k); if (!prev || Date.parse(r.created_at) > Date.parse(prev.created_at)) handoverByPhone.set(k, r); }
  const wroteRecently = new Map();   // user id → { text, at, chat }
  const flagged = new Set();         // phones with an "unanswered" issue

  for (const c of chats) {
    const phone = String(c.phone || '').replace(/\D/g, '');
    const msgs = c.messages || [];
    const tags = (c.tags || []).map((x) => String(x).toLowerCase());
    if (tags.includes('do-not-contact')) continue;
    const p = personOf(phone);
    const last = lastRealInbound(msgs, kindOf);
    if (last && p?.user && now - t(last.m) < S.lookbackDays * D) wroteRecently.set(String(p.user.id), { text: last.m.text, at: t(last.m), chat: c, phone });
    const name = p?.user?.full_name || c.name || `+${phone}`;   // the account's name first (WhatsApp names are nicknames: Daniel = "Canell")

    // handed to a person by the assistant (who told them someone will answer) and no team member wrote since
    const hoChat = handoverByPhone.get(phone);
    if (hoChat && now - Date.parse(hoChat.created_at) < 7 * D && !outAfter(msgs, Date.parse(hoChat.created_at)).some(isTeamMessage)) {
      const age = now - Date.parse(hoChat.created_at);
      const lastAt = last ? t(last.m) : Date.parse(hoChat.created_at);
      const windowOpen = now - lastAt < D;
      flagged.add(phone);
      add({
        id: `person:${phone}:${hoChat.meta?.inbound_id || hoChat.created_at}`, type: 'unanswered', priority: windowOpen ? 'urgent' : 'high', since: hoChat.created_at,
        person: { name, phone: `+${phone}`, email: p?.user?.email || null, userId: p?.user?.id || null },
        title: `${name} needs a person (${hoChat.subject || hoChat.meta?.topic || 'see message'}) — waiting ${ago(age)}`,
        evidence: [
          `“${quote(hoChat.meta?.question || last?.m?.text || '')}”`,
          `Why a person: ${hoChat.meta?.note || hoChat.meta?.reason || 'the assistant could not answer it from our facts'}`,
          hoChat.meta?.holding ? `The assistant told them: “${quote(hoChat.meta.holding, 120)}”` : 'They were told someone from the team will answer',
          windowOpen ? `WhatsApp window open: ${Math.max(0, Math.floor((D - (now - lastAt)) / H))} h left to answer for free` : 'The 24-hour window closed: only a template can reach them now',
          personLine(p),
        ],
        suggestion: 'Reply personally — the assistant\'s draft is in Details.',
        draft: hoChat.meta?.draft ? { es: hoChat.meta.draft, en: hoChat.meta.english || '' } : null,
        actions: [...(windowOpen ? ['send_whatsapp'] : []), ...(p?.user?.email ? ['send_email'] : []), 'write_ai', 'open_chat', 'done', 'dismiss'],
        data: { windowOpen, inboundId: hoChat.meta?.inbound_id || null },
      });
    }

    // unanswered
    // a button tap / reply word (SÍ, CARTERA…) has its own card below; this is for what they wrote
    if (!flagged.has(phone) && last && !['button', 'keyword'].includes(last.kind) && !repliesAfter(msgs, t(last.m)).length) {
      const age = now - t(last.m);
      if (age >= S.unansweredMinutes * 60000 && age < S.lookbackDays * D) {
        const windowOpen = age < D;
        const ho = handover.get(String(last.m.id));
        const kwTag = tags.find((x) => x === 'cartera' || x === 'proyecto');
        flagged.add(phone);
        add({
          id: `unanswered:${phone}:${last.m.id}`, type: 'unanswered', priority: windowOpen ? 'urgent' : 'high', since: new Date(t(last.m)).toISOString(),
          person: { name, phone: `+${phone}`, email: p?.user?.email || null, userId: p?.user?.id || null },
          title: `${name} wrote ${ago(age)} ago and nobody answered${kwTag ? ` (tapped ${kwTag.toUpperCase()})` : ''}`,
          evidence: [
            `“${quote(last.m.text || `(${last.kind})`)}”`,
            windowOpen ? `WhatsApp window open: ${Math.max(0, Math.floor((D - age) / H))} h left to answer for free` : 'The 24-hour window closed: only a template can reach them now',
            personLine(p),
            ...(ho ? [`The assistant handed it to a person: ${ho.meta?.note || ho.meta?.reason || 'needs a person'}`] : []),
          ],
          suggestion: ho ? 'Reply personally — the assistant\'s draft is in Details.' : windowOpen ? 'Reply now, while the window is open.' : 'Window closed: send a template from the Inbox, or email.',
          draft: ho?.meta?.draft ? { es: ho.meta.draft, en: ho.meta.english || '' } : null,
          actions: [...(windowOpen ? ['send_whatsapp'] : []), ...(p?.user?.email ? ['send_email'] : []), 'write_ai', 'open_chat', 'done', 'dismiss'],
          data: { windowOpen, inboundId: last.m.id },
        });
      }
    }

    // CARTERA / PROYECTO tapped, no person wrote to them since
    if (!flagged.has(phone)) {
      const tap = [...msgs].sort((a, b) => t(b) - t(a)).find((m) => m?.direction === 'inbound' && /^(cartera|proyecto)$/i.test(String(m.text || '').trim()));
      if (tap && now - t(tap) >= S.keywordHours * H && now - t(tap) < 14 * D && !outAfter(msgs, t(tap)).some(isTeamMessage)) {
        const kw = String(tap.text).trim().toLowerCase();
        const windowOpen = now - Math.max(t(tap), t(last?.m || {})) < D;
        add({
          id: `keyword:${phone}:${tap.id}`, type: 'keyword', priority: 'high', since: new Date(t(tap)).toISOString(),
          person: { name, phone: `+${phone}`, email: p?.user?.email || null, userId: p?.user?.id || null },
          title: `${name} tapped ${kw.toUpperCase()} ${ago(now - t(tap))} ago — no one from the team has written`,
          evidence: [kw === 'cartera' ? 'An agency: wants help moving its whole portfolio' : 'A developer: has a project to publish', 'The automatic reply went out; a person has to follow up (Roland\'s rule)', personLine(p)],
          suggestion: 'Write personally and offer a short call (draft in Details).',
          draft: keywordDraft(name, kw),
          actions: [...(windowOpen ? ['send_whatsapp'] : []), ...(p?.user?.email ? ['send_email'] : []), 'open_chat', 'done', 'dismiss'],
          data: { windowOpen, keyword: kw },
        });
      }
    }
  }

  // the assistant answered, the person was asked to do something, days went by and they didn't
  const statusById = new Map();
  const chatByPhone = new Map();
  for (const c of chats) { chatByPhone.set(String(c.phone || '').replace(/\D/g, ''), c); for (const msg of c.messages || []) statusById.set(String(msg.id), msg.status); }
  const seenFollow = new Set();
  for (const r of [...aiLog].filter((x) => x.automation_id === 'inbox_ai' && GOAL_TEXT[x.meta?.goal]).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const phone = String(r.to_phone || '').replace(/\D/g, '');
    const at = Date.parse(r.created_at);
    const age = now - at;
    if (!phone || seenFollow.has(phone) || age > S.followupMaxDays * D) continue;
    seenFollow.add(phone);   // only their latest answered question
    const p = personOf(phone);
    const doneAt = goalDoneAt(r.meta.goal, p, at, payments);
    if (doneAt != null) {
      // the assistant's answer worked: shown as a result (not an open issue)
      const name = p?.user?.full_name || chatByPhone.get(phone)?.name || `+${phone}`;
      const after = doneAt > at ? ` ${ago(doneAt - at)} later` : '';
      add({
        id: `result:${phone}:${r.meta.inbound_id || r.created_at}`, type: 'followup', priority: 'low', since: r.created_at, achieved: true, status: 'achieved',
        person: { name, phone: `+${phone}`, email: p?.user?.email || null, userId: p?.user?.id || null },
        title: `${name} asked about ${r.subject || r.meta.topic || 'Casa-Libre'} — the assistant answered, they ${GOAL_DONE_TEXT[r.meta.goal]}${after}`,
        evidence: [...(r.meta.question ? [`They asked: “${quote(r.meta.question, 140)}”`] : []), `Goal reached: ${GOAL_DONE_TEXT[r.meta.goal]}`],
        suggestion: 'Nothing to do — goal reached.',
        draft: null, actions: [], data: { goal: r.meta.goal },
      });
      continue;
    }
    if (age < S.followupDays * D) continue;   // too soon to chase
    const chat = chatByPhone.get(phone);
    const msgs = chat?.messages || [];
    // they wrote again since → the conversation goes on (the "unanswered" check covers it)
    if (msgs.some((m) => m?.direction === 'inbound' && t(m) > at && ((kindOf && kindOf(m)) || inboundKind(m)).real)) continue;
    if (r.meta.goal === 'pay' && p?.user && pendingByUserIds(pending).has(String(p.user.id))) continue;   // the payment card covers it
    const [want, notYet, path] = GOAL_TEXT[r.meta.goal];
    const read = statusById.get(String(r.relay_message_id || '')) === 'read';
    const clicks = clicksByAnswer.get(String(r.meta.answer_ref || '')) || null;
    const name = p?.user?.full_name || chat?.name || `+${phone}`;
    const link = linkFor ? linkFor(path, phone, r.meta.answer_ref) : `${site}${path}`;
    const windowOpen = msgs.length ? now - Math.max(...msgs.filter((m) => m?.direction === 'inbound').map(t), 0) < D : false;
    add({
      id: `followup:${phone}:${r.meta.inbound_id || r.created_at}`, type: 'followup', priority: clicks ? 'high' : 'medium', since: r.created_at,
      person: { name, phone: `+${phone}`, email: p?.user?.email || null, userId: p?.user?.id || null },
      title: `${name} asked about ${r.subject || r.meta.topic || 'Casa-Libre'} — answered ${ago(age)} ago, ${notYet}`,
      evidence: [
        ...(r.meta.question ? [`They asked: “${quote(r.meta.question, 140)}”`] : []),
        ...(r.meta.english ? [`The assistant answered: “${quote(r.meta.english, 160)}”`] : []),
        `Read: ${read ? 'yes' : 'not confirmed'} · Link clicked: ${clicks ? `yes (${clicks.count}×)` : 'no'} · Asked to ${want}: not done`,
        personLine(p),
      ],
      suggestion: clicks ? 'They clicked but didn\'t finish — call or write personally (draft in Details).' : 'Resend the link with a short nudge (draft in Details).',
      draft: nudgeDraft(r.meta.goal, name, link),
      actions: [...(windowOpen ? ['send_whatsapp'] : []), ...(p?.user?.email ? ['send_email'] : []), 'open_chat', 'done', 'dismiss'],
      data: { windowOpen, goal: r.meta.goal },
    });
  }

  // every payment email went out (the first + 3 reminders) and still no payment
  // (lib/manager/payFollowups.js): an unpaid listing → suggest the gift; a promotion → a call
  const exhaustedPids = new Set();
  const PROMO = { verified: 'the Verified badge (US$5)', home: 'the home page display (US$20)', promo: 'a promotion', extend: 'more days for their listing' };
  for (const x of payExhausted) {
    const u = usersById.get(String(x.user_id));
    if (!u || u.suspended || u.blocked) continue;
    exhaustedPids.add(String(x.property_id));
    const phone = String(u.phone || x.listing?.contact_phone || '').replace(/\D/g, '');
    const dates = x.sends.map((z) => String(z.at).slice(5, 10)).join(', ');
    const unpaidListing = x.plan === 'listing';
    const wrote = wroteRecently.get(String(x.user_id));
    const windowOpen = !!wrote && now - wrote.at < D;
    add({
      id: `payment:exhausted:${x.user_id}:${x.property_id}`, type: 'payment', priority: 'high', since: x.sends[0]?.at || new Date(now).toISOString(),
      person: { name: u.full_name || u.email || 'Seller', phone: phone ? `+${phone}` : null, email: u.email || null, userId: String(x.user_id) },
      title: unpaidListing
        ? `${u.full_name || u.email}: ${titleOf(x.listing)} still not paid after ${x.sends.length} emails`
        : `${u.full_name || u.email}: started buying ${PROMO[x.plan] || 'a promotion'} — no payment after ${x.sends.length} emails`,
      evidence: [
        `${titleOf(x.listing)} — ${unpaidListing ? 'waiting for payment' : 'live'}`,
        `Admin Manager payment emails: ${x.sends.length} (${dates}) — the first + every reminder`,
        ...(wrote ? [`They wrote: “${quote(wrote.text)}”`] : []),
      ],
      suggestion: unpaidListing
        ? 'Every email went out and they still didn’t pay: publish it free as a gift, then send the thank-you (draft in Details).'
        : 'Every email went out: call or WhatsApp them personally — ask what went wrong with the card.',
      draft: unpaidListing ? giftDraft(u.full_name, 1) : promoCallDraft(u.full_name, x.listing, x.plan),
      actions: [...(unpaidListing ? ['publish_free'] : []), ...(windowOpen ? ['send_whatsapp'] : []), ...(u.email ? ['send_email'] : []), ...(phone ? ['open_chat'] : []), 'done', 'dismiss'],
      data: { propertyIds: [String(x.property_id)], plan: x.plan, windowOpen, exhausted: true },
    });
  }

  // waiting for payment → suggest a gift
  const pendingByUser = new Map();
  for (const l of pending) {
    if (l.status !== 'payment_pending') continue;
    if (exhaustedPids.has(String(l.id))) continue;   // the card above covers it
    const gift = l.raw_data?.paid_listing?.gift;
    if (gift?.claimed_at || (gift?.offered_at && Date.parse(gift.expires_at || 0) > now)) continue;
    if (now - Date.parse(l.created_at) < S.giftAfterDays * D) continue;
    pendingByUser.set(String(l.created_by), [...(pendingByUser.get(String(l.created_by)) || []), l]);
  }
  for (const [uid, ls] of pendingByUser) {
    const u = usersById.get(uid);
    if (!u || u.suspended || u.blocked) continue;
    const wrote = wroteRecently.get(uid);
    const total = listingCountByUser.get(uid) || ls.length;
    if (!wrote && total < 2) continue;   // the payment automation handles one-off sellers
    const oldest = Math.min(...ls.map((l) => Date.parse(l.created_at)));
    const ids = ls.map((l) => String(l.id)).sort();
    let answer = null;
    if (wrote) {
      const outs = outAfter(wrote.chat.messages || [], wrote.at);
      if (outs.length) answer = `${isTeamMessage(outs[0]) ? `${outs[0].sent_by} answered` : 'The assistant answered'} ${ago(now - t(outs[0]))} ago${outs[outs.length - 1].status === 'read' ? ' — they read it' : ''}; no payment since`;
    }
    const phone = wrote?.phone || String(u.phone || '').replace(/\D/g, '');
    const windowOpen = !!wrote && now - wrote.at < D;
    add({
      id: `payment:${uid}:${ids.join(',').slice(0, 120)}`, type: 'payment', priority: wrote ? 'high' : 'medium', since: new Date(oldest).toISOString(),
      person: { name: u.full_name || u.email || 'Seller', phone: phone ? `+${phone}` : null, email: u.email || null, userId: uid },
      title: `${u.full_name || u.email}: ${ls.length} listing${ls.length === 1 ? '' : 's'} waiting for payment for ${Math.round((now - oldest) / D)} days`,
      evidence: [
        ...ls.slice(0, 4).map((l) => `${titleOf(l)} — saved ${new Date(Date.parse(l.created_at)).toISOString().slice(0, 10)}, not paid`),
        ...(wrote ? [`They wrote: “${quote(wrote.text)}”`] : []),
        ...((() => { const n = ids.reduce((s2, id) => s2 + (followups.paymentReminders?.get(id) || 0), 0); return n ? [`Automatic payment reminders already sent: ${n}`] : []; })()),
        ...((() => { const m = (followups.managerByEmail?.get(String(u.email || '').toLowerCase()) || []).filter((x) => /^manager_(unpaid|payment)/.test(x.kind || '')); return m.length ? [`Admin Manager payment emails: ${m.length} (${m.map((x) => String(x.at).slice(5, 10)).join(', ')})`] : []; })()),
        ...(answer ? [answer] : wrote ? ['Nobody answered them'] : []),
        `${total} listing${total === 1 ? '' : 's'} on Casa-Libre in total${total >= 2 ? ' — a realtor or repeat seller' : ''}`,
      ],
      suggestion: `Publish ${ls.length === 1 ? 'it' : 'them'} free as a gift, then send the thank-you (draft in Details).`,
      draft: giftDraft(u.full_name, ls.length),
      actions: ['publish_free', ...(windowOpen ? ['send_whatsapp'] : []), ...(u.email ? ['send_email'] : []), ...(phone ? ['open_chat'] : []), 'done', 'dismiss'],
      data: { propertyIds: ids, windowOpen },
    });
  }

  // views, no contacts
  for (const v of viewsStats) {
    if (v.views < S.minViews || v.contacts > 0) continue;
    const u = usersById.get(String(v.listing.created_by));
    if (!u || u.suspended || u.blocked) continue;
    const sentAt = v.vncSentAt ? Date.parse(v.vncSentAt) : null;
    const escalate = !!sentAt && now - sentAt >= S.viewsEscalateDays * D && !(v.contactsSinceAdvice > 0);
    if (!escalate && (vncEnabled || sentAt)) continue;   // the Admin Manager emails the advice at its next run (or just did)
    add({
      id: `views:${v.listing.id}:${escalate ? `esc:${v.vncSentAt.slice(0, 10)}` : 'advice'}`, type: 'views', priority: escalate ? 'medium' : 'low', since: v.vncSentAt || new Date(now - (v.days || 14) * D).toISOString(),
      person: { name: u.full_name || u.email || 'Seller', phone: u.phone ? `+${String(u.phone).replace(/\D/g, '')}` : null, email: u.email || null, userId: String(u.id) },
      title: escalate ? `${titleOf(v.listing)}: advice sent ${ago(now - sentAt)} ago, still no buyer contact` : `${titleOf(v.listing)}: ${v.views} views in ${v.days || 14} days, no buyer contact`,
      evidence: [`${v.views} views in the last ${v.days || 14} days · 0 buyer contacts (WhatsApp / phone taps)`, ...(escalate ? ['The Admin Manager emailed the price / photos advice; nothing changed since'] : ['The Admin Manager\'s emails are on hold (MANAGER_AUTO_SEND=0): send the advice yourself']), `Seller: ${u.full_name || u.email}`],
      suggestion: escalate ? 'Call or write: offer to review the price and photos together.' : 'Send the price / photos advice.',
      draft: viewsDraft(u.full_name, v.listing, v.views, v.days || 14, escalate),
      actions: [...(u.email ? ['send_email'] : []), ...(u.phone ? ['open_chat'] : []), 'done', 'dismiss'],
      data: { listingId: String(v.listing.id), url: site ? `${site}/propiedad/${v.listing.slug || v.listing.id}` : null },
    });
  }

  // unfinished drafts (no live listing yet) and checkouts that didn't finish
  const draftByUser = new Map();
  for (const d of drafts) {
    const at = Date.parse(d.updated_at);
    if (now - at < S.draftMinDays * D || now - at > S.lookbackDays * D) continue;
    if (usersWithLive.has(String(d.user_id))) continue;
    // the website's "Unfinished draft reminders" are still working on it → not yet a person's job
    const sent = followups.draftReminders?.get(String(d.id)) || { count: 0, last: null };
    if (followups.draftSteps && sent.count < followups.draftSteps) continue;
    if (sent.last && now - Date.parse(sent.last) < S.draftMinDays * D) continue;
    const prev = draftByUser.get(String(d.user_id));
    if (!prev || Date.parse(prev.updated_at) < at) draftByUser.set(String(d.user_id), d);
  }
  for (const [uid, d] of draftByUser) {
    const u = usersById.get(uid);
    if (!u || u.suspended || u.blocked) continue;
    const what = [d.data?.ptype, d.data?.neighborhood || d.data?.city].filter(Boolean).join(' en ');
    const link = `${site}/cuenta/publicaciones?tab=borradores&draft=${d.id}`;
    const sent = followups.draftReminders?.get(String(d.id)) || { count: 0, last: null };
    const mgr = (followups.managerByEmail?.get(String(u.email || '').toLowerCase()) || []).filter((x) => Date.parse(x.at) >= Date.parse(d.updated_at));
    if (mgr.length) continue;   // the Admin Manager already wrote to them personally
    add({
      id: `funnel:draft:${d.id}`, type: 'funnel', priority: (listingCountByUser.get(uid) || 0) >= 1 ? 'medium' : 'low', since: d.updated_at,
      person: { name: u.full_name || u.email || 'User', phone: u.phone ? `+${String(u.phone).replace(/\D/g, '')}` : null, email: u.email || null, userId: uid },
      title: `${u.full_name || u.email} left a listing unfinished ${ago(now - Date.parse(d.updated_at))} ago`,
      evidence: [`Draft: ${what || 'a property'}`, ...(d.missing?.length ? [`Missing: ${d.missing.join(', ')}`] : []), sent.count ? `Automatic draft reminders: all ${sent.count} sent (last ${ago(now - Date.parse(sent.last))} ago) — no result` : 'The draft-reminder automation sent nothing for this draft', 'No personal email from the Admin Manager yet'],
      suggestion: 'A short personal message offering help to finish it.',
      draft: draftDraft(u.full_name, what, d.missing, link),
      actions: [...(u.email ? ['send_email'] : []), ...(u.phone ? ['open_chat'] : []), 'done', 'dismiss'],
      data: { draftId: String(d.id), link },
    });
  }
  const seenCheckout = new Set();
  for (const c of checkouts) {
    const uid = String(c.user_id || '');
    if (!uid || seenCheckout.has(uid) || now - Date.parse(c.created_at) < D || now - Date.parse(c.created_at) > S.lookbackDays * D) continue;
    const u = usersById.get(uid);
    if (!u || u.suspended || u.blocked) continue;
    // the Admin Manager writes "unpaid listing" emails for abandoned checkouts — already done → skip
    if ((followups.managerByEmail?.get(String(u.email || '').toLowerCase()) || []).some((x) => Date.parse(x.at) >= Date.parse(c.created_at))) continue;
    seenCheckout.add(uid);
    add({
      id: `funnel:checkout:${c.id}`, type: 'funnel', priority: 'medium', since: c.created_at,
      person: { name: u.full_name || u.email || 'User', phone: u.phone ? `+${String(u.phone).replace(/\D/g, '')}` : null, email: u.email || null, userId: uid },
      title: `${u.full_name || u.email} started a payment ${ago(now - Date.parse(c.created_at))} ago and didn't finish`,
      evidence: [`${c.kind === 'publish' || c.kind === 'listing' ? 'Paid listing' : c.kind || 'Payment'}${c.amount_usd ? ` · US$${c.amount_usd}` : ''}${c.listing ? ` · ${titleOf(c.listing)}` : ''}`, 'No successful payment followed', 'The Admin Manager has not emailed them about it yet (it writes up to 3 of these a week)'],
      suggestion: 'Ask what went wrong and offer help.',
      draft: checkoutDraft(u.full_name, c.listing),
      actions: [...(u.email ? ['send_email'] : []), ...(u.phone ? ['open_chat'] : []), 'done', 'dismiss'],
      data: { paymentId: String(c.id), propertyId: c.property_id ? String(c.property_id) : null },
    });
  }

  // accounts the security watch suspended by itself
  for (const s of suspensions) {
    if (s.reviewed) continue;
    add({
      id: `security:${s.user_id}`, type: 'security', priority: 'high', since: s.at,
      person: { name: s.name || s.email || 'Account', phone: s.phone || null, email: s.email || null, userId: String(s.user_id) },
      title: `Suspended automatically: ${s.name || s.email || s.user_id}`,
      evidence: [s.reason, ...(s.ip ? [`IP ${s.ip}${s.ipCountry ? ` (${s.ipCountry})` : ''}`] : []), ...(s.notified ? ['They were emailed that the account is suspended'] : [])],
      suggestion: 'Keep it suspended, or lift it if it is a real person.',
      draft: null,
      actions: ['keep_suspended', 'lift_suspension'],
      data: {},
    });
  }

  // published free from here: the card stays until the thank-you goes out (Roland: "say something nice")
  for (const [id, st] of Object.entries(state)) {
    if (st?.state !== 'gift' || !st.snapshot || out.some((i) => i.id === id)) continue;
    const sn = st.snapshot;
    const n = (st.published || []).length || 1;
    out.push({
      country, id, type: 'payment', priority: 'high', since: st.at, followup: true, status: 'open',
      person: sn.person, title: `${sn.person?.name || 'Seller'}: ${n === 1 ? 'listing' : `${n} listings`} published free — send the thank-you`,
      evidence: [`Published free by ${st.by || 'an admin'} ${st.at ? ago(now - Date.parse(st.at)) : ''} ago (live after the photo check)`, ...(sn.evidence || []).slice(0, 2)],
      suggestion: 'Send the thank-you (draft in Details); then it closes.',
      draft: sn.draft || giftDraft(sn.person?.name, n),
      actions: [...(sn.windowOpen && sn.person?.phone ? ['send_whatsapp'] : []), ...(sn.person?.email ? ['send_email'] : []), ...(sn.person?.phone ? ['open_chat'] : []), 'done'],
      data: { windowOpen: !!sn.windowOpen },
    });
  }

  for (const i of out) {
    if (i.followup || i.achieved) continue;
    const st = state[i.id];
    i.status = st?.state || 'open';
    if (st) i.handled = { state: st.state, by: st.by || null, at: st.at || null, note: st.note || null };
  }
  return out.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || PRIORITY[a.priority] - PRIORITY[b.priority] || Date.parse(a.since) - Date.parse(b.since));
}

export const issueCounts = (issues = []) => {
  const open = issues.filter((i) => i.status === 'open');
  const by = {};
  for (const i of open) by[ISSUE_TYPES[i.type] || i.type] = (by[ISSUE_TYPES[i.type] || i.type] || 0) + 1;
  return { open: open.length, urgent: open.filter((i) => i.priority === 'urgent').length, byGroup: by };
};
