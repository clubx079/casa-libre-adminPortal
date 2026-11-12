import { describe, it, expect } from 'vitest';
import {
  windowOf, dueConversations, decideSale, decideFollowUp, salesBlocked, asksToStop, goalFor, goalDoneSince,
  saleRef, windowRef, windowKey, saleKey, teamWrote,
} from '../lib/inboxWindowCore.js';
import { aiLink } from '../lib/aiLinks.js';

const now = Date.parse('2026-11-13T15:00:00Z');
const H = 3600000;
const at = (hoursAgo) => new Date(now - hoursAgo * H).toISOString();
const inn = (id, hoursAgo, text = 'hola', extra = {}) => ({ id, direction: 'inbound', type: 'text', text, timestamps: { created: at(hoursAgo) }, ...extra });
const out = (id, hoursAgo, text = 'Respuesta', extra = {}) => ({ id, direction: 'outbound', type: 'text', text, sent_by: 'api', timestamps: { created: at(hoursAgo) }, ...extra });
const conv = (extra = {}) => ({ phone: '+595999000123', tags: [], opt_in_status: 'unknown', ...extra });
const kinds = (o) => new Map(Object.entries(o));

describe('the window', () => {
  it('closes 24 h after their LAST message and opened with the first one of the run', () => {
    const w = windowOf([inn('a', 60), inn('b', 30), out('o', 29), inn('c', 21)], null, now);
    expect(w.lastInbound.id).toBe('c');
    expect(w.closesAt).toBe(now + 3 * H);
    expect(w.openedAt).toBe(now - 30 * H);   // 'a' was more than 24 h before 'b' → a new window
    expect(w.inbound.map((m) => m.id)).toEqual(['b', 'c']);
    expect(w.open).toBe(true);
  });
  it('uses Relay\'s expires_at when it gives one', () => {
    const w = windowOf([inn('c', 21)], { window: { open: true, expires_at: new Date(now + 2 * H).toISOString() } }, now);
    expect(w.closesAt).toBe(now + 2 * H);
  });
  it('lists the conversations closing within 3 h (not in the last 15 minutes)', () => {
    const list = [
      { phone: '1', last_inbound_at: at(21.5) }, { phone: '2', last_inbound_at: at(20) }, { phone: '3', last_inbound_at: at(23.9) },
      { phone: '4', last_inbound_at: at(25) }, { phone: '', last_inbound_at: at(22) }, { phone: '5', last_inbound_at: null },
    ];
    expect(dueConversations(list, { now }).map((c) => c.phone)).toEqual(['1']);
  });
});

describe('rule 1 — thanks / reaction → ONE sales reply', () => {
  const msgs = [out('o1', 0.2, 'Publicá gratis…'), inn('t1', 0.1, 'gracias')];
  it('thanks → a sales reply', () => {
    expect(decideSale({ kind: 'ack', conv: conv(), messages: msgs, kinds: kinds({ t1: 'ack' }), now }).ok).toBe(true);
  });
  it('a reaction (heart) → a sales reply too', () => {
    const m = [out('o1', 0.2), inn('r1', 0.1, '', { type: 'reaction' })];
    expect(decideSale({ kind: 'emoji', conv: conv(), messages: m, kinds: kinds({ r1: 'emoji' }), now }).ok).toBe(true);
  });
  it('second thanks within 24 h → nothing (no gracias loop)', () => {
    expect(decideSale({ kind: 'ack', conv: conv(), messages: msgs, lastSaleAt: at(2), now })).toMatchObject({ ok: false, reason: 'sale_already_sent' });
    expect(decideSale({ kind: 'ack', conv: conv(), messages: msgs, lastSaleAt: at(25), now }).ok).toBe(true);
  });
  it('a question is not a sales reply (answered as before)', () => {
    expect(decideSale({ kind: 'question', conv: conv(), messages: msgs, now }).reason).toBe('not_a_thanks');
  });
  it('a SÍ / CARTERA tap in this window: the website answered — no second answer', () => {
    const m = [inn('b1', 1, 'SÍ', { type: 'button' }), out('w1', 0.9, 'https://casa-libre.com.py/r/si-ag?r=x'), inn('t1', 0.5, 'gracias')];
    expect(decideSale({ kind: 'ack', conv: conv(), messages: m, kinds: kinds({ b1: 'button', t1: 'ack' }), now }).reason).toBe('website_answered');
  });
  it('never: BAJA / opted out / DNC / asked to stop / team handling', () => {
    const base = { kind: 'ack', messages: msgs, now };
    expect(decideSale({ ...base, conv: conv({ tags: ['do-not-contact'] }) }).reason).toBe('do_not_contact');
    expect(decideSale({ ...base, conv: conv({ opt_in_status: 'opted_out' }) }).reason).toBe('opted_out');
    expect(decideSale({ ...base, conv: conv(), user: { whatsapp_opted_out_at: at(100) } }).reason).toBe('opted_out');
    expect(decideSale({ ...base, conv: conv(), messages: [inn('x', 50, 'no me escriban más'), ...msgs] }).reason).toBe('asked_to_stop');
    expect(decideSale({ ...base, conv: conv({ tags: ['needs-a-person'] }) }).reason).toBe('team_handling');
    expect(decideSale({ ...base, conv: conv(), messages: [inn('q', 3, '¿precio?'), out('tm', 2, 'Hola, soy Ana', { sent_by: 'ana@casa-libre' }), ...msgs] }).reason).toBe('team_handling');
  });
});

describe('who wrote: team vs assistant vs automatic', () => {
  it('a typed message from the admin Inbox (sent_by api) that is not the assistant\'s is the team', () => {
    expect(teamWrote(out('m1', 1, 'Hola, te escribe Omar'), new Set(['m9']))).toBe(true);
    expect(teamWrote(out('m9', 1, 'Respuesta del asistente'), new Set(['m9']))).toBe(false);
    expect(teamWrote(out('m2', 1, '', { template: { name: 'cl_pendiente_pago' } }), new Set())).toBe(false);
    expect(teamWrote(out('m3', 1, 'https://casa-libre.com.py/r/si-ag?r=1'), new Set())).toBe(false);   // the website's SÍ reply
    expect(teamWrote(out('m1', 1, 'Hola'), null)).toBe(false);   // ids unknown → only WhatsApp-side team replies
  });
  it('stop words, but not "planta baja"', () => {
    for (const t of ['BAJA', 'Stop', 'no me escribas', 'No me interesa, gracias', 'dejen de mandar mensajes', 'not interested']) expect(asksToStop(t), t).toBe(true);
    for (const t of ['casa en planta baja', 'gracias', '¿cuánto cuesta?', 'me interesa publicar']) expect(asksToStop(t), t).toBe(false);
  });
});

describe('rule 2 — the window-closing follow-up', () => {
  const thread = [inn('q1', 22, '¿cómo publico?'), out('a1', 21.9, 'Así se publica…'), inn('t1', 21, 'gracias')];
  const k = kinds({ q1: 'question', t1: 'ack' });
  const c = conv();
  it('21 h after their last message, no action → ONE follow-up', () => {
    const d = decideFollowUp({ conv: c, messages: thread, kinds: k, now });
    expect(d).toMatchObject({ ok: true, key: windowKey(c.phone, 't1') });
  });
  it('they already did it → nothing', () => {
    expect(decideFollowUp({ conv: c, messages: thread, kinds: k, goalDone: true, now }).reason).toBe('goal_done');
  });
  it('already sent for this window (restart) → nothing', () => {
    expect(decideFollowUp({ conv: c, messages: thread, kinds: k, sent: new Set([windowKey(c.phone, 't1')]), now }).reason).toBe('already_sent');
  });
  it('not yet / too late / closed', () => {
    expect(decideFollowUp({ conv: c, messages: [inn('t1', 10, 'gracias')], kinds: k, now }).reason).toBe('not_due');
    expect(decideFollowUp({ conv: c, messages: [inn('t1', 23.9, 'gracias')], kinds: k, now }).reason).toBe('too_late');
    expect(decideFollowUp({ conv: c, messages: [inn('t1', 30, 'gracias')], kinds: k, now }).reason).toBe('window_closed');
  });
  it('a window opened only by a robot (agency auto-greeting) → nothing', () => {
    const m = [out('camp', 21.2, '', { template: { name: 'cl_agentes_mascota' } }), inn('r1', 21.1, 'Gracias por comunicarte con X Inmobiliaria, en breve te responderemos')];
    expect(decideFollowUp({ conv: c, messages: m, kinds: kinds({ r1: 'auto' }), now }).reason).toBe('robot_only');
  });
  it('only button taps (the website answered) / only off-topic → nothing', () => {
    expect(decideFollowUp({ conv: c, messages: [inn('b1', 21, 'SÍ', { type: 'button' })], kinds: kinds({ b1: 'button' }), now }).reason).toBe('website_answered');
    expect(decideFollowUp({ conv: c, messages: [inn('o1', 21, '¿por qué un número de EEUU?')], kinds: kinds({ o1: 'offtopic' }), now }).reason).toBe('offtopic');
  });
  it('BAJA / DNC / team handling → nothing', () => {
    expect(decideFollowUp({ conv: c, messages: [...thread, inn('s', 21.05, 'BAJA')], kinds: k, now }).ok).toBe(false);
    expect(decideFollowUp({ conv: conv({ tags: ['do-not-contact'] }), messages: thread, kinds: k, now }).reason).toBe('do_not_contact');
    expect(decideFollowUp({ conv: c, messages: [...thread, out('tm', 21.5, 'Te llamo mañana')], kinds: k, aiIds: new Set(['a1']), now }).reason).toBe('team_handling');
  });
});

describe('goal and tracked links', () => {
  it('the goal follows their situation', () => {
    expect(goalFor('not a Casa Libre account — answer their question').goal).toBe('sign_up');
    expect(goalFor('has an account but has NOT listed any property yet').goal).toBe('publish');
    expect(goalFor('started a listing (draft) but never published it').goal).toBe('finish_draft');
    expect(goalFor('a listing had photos rejected').goal).toBe('fix_listing');
    expect(goalFor('has a listing waiting for payment').goal).toBe('pay');
    expect(goalFor('all set: their listings are live').push).toMatch(/Verified/);
  });
  it('did they act since the window opened?', () => {
    const since = now - 22 * H;
    expect(goalDoneSince({ goal: 'sign_up', since, user: { created_at: at(2) } })).toBe(true);
    expect(goalDoneSince({ goal: 'sign_up', since, user: { created_at: at(200) } })).toBe(false);
    expect(goalDoneSince({ goal: 'publish', since, listings: [{ created_at: at(3), status: 'active' }] })).toBe(true);
    expect(goalDoneSince({ goal: 'publish', since, listings: [{ created_at: at(3), status: 'payment_pending' }] })).toBe(false);
    expect(goalDoneSince({ goal: 'pay', since, payments: [{ status: 'succeeded', created_at: at(1) }] })).toBe(true);
    expect(goalDoneSince({ goal: 'fix_listing', since, listings: [{ created_at: at(300), updated_at: at(1), status: 'scanning' }] })).toBe(true);
  });
  it('links are tagged ack… / win… (the website\'s /r/ai turns it into utm_content)', () => {
    expect(saleRef('b99a6ac2b6')).toBe('ackb99a6ac2b6');
    expect(windowRef('b99a6ac2b6')).toBe('winb99a6ac2b6');
    expect(windowRef('x'.repeat(40))).toHaveLength(24);
    expect(aiLink('https://casa-libre.com.py', '/publicar', { ref: '1b1kxsn', answer: windowRef('b99a6ac2b6') })).toBe('https://casa-libre.com.py/r/ai?u=/publicar&r=1b1kxsn&a=winb99a6ac2b6');
    expect(saleKey('msg_1')).toBe('aisale:msg_1');
    expect(windowKey('+595 999 000123', 'msg_2')).toBe('aiwin:595999000123:msg_2');
  });
});

describe('salesBlocked', () => {
  it('nothing blocks an ordinary chat', () => {
    expect(salesBlocked({ conv: conv(), messages: [inn('a', 1, 'gracias')] })).toBeNull();
  });
});
