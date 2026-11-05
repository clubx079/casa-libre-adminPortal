import { describe, it, expect } from 'vitest';
import { autoGuards, conversationBlocked, optedOut, isKeywordReplyText, isTeamReply } from '../lib/inboxAutoRules';

const T0 = Date.parse('2026-11-04T12:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const m = (id, direction, min, extra = {}) => ({ id, direction, type: 'text', text: 'x', timestamps: { created: at(min) }, ...extra });

describe('autoGuards — every real question gets an answer, once', () => {
  it('a new question nobody answered → answer it', () => {
    const q = m('q1', 'inbound', 0, { text: '¿Por qué un número de EEUU?' });
    expect(autoGuards({ inbound: q, messages: [m('c', 'outbound', -30, { kind: 'campaign', sent_by: 'api' }), q], now: T0 + 5000 })).toMatchObject({ ok: true, pending: ['q1'] });
  });
  it('question 1 answered (by the AI or a person), question 2 not → answer question 2', () => {
    const q1 = m('q1', 'inbound', 0), a1 = m('a1', 'outbound', 1, { sent_by: 'api' }), q2 = m('q2', 'inbound', 10);
    const r = autoGuards({ inbound: q2, messages: [q1, a1, q2], coveredIds: new Set(['q1']), aiMessageIds: new Set(['a1']), now: T0 + 11 * 60000 });
    expect(r).toMatchObject({ ok: true, pending: ['q2'] });
    // the team answered q1 by hand — q2 still gets the AI
    const t1 = m('t1', 'outbound', 1, { sent_by: 'omar@airosofts.com' });
    expect(autoGuards({ inbound: q2, messages: [q1, t1, q2], now: T0 + 11 * 60000 })).toMatchObject({ ok: true, pending: ['q2'] });
  });
  it('already answered: covered by an AI reply, or a team member wrote after it', () => {
    const q1 = m('q1', 'inbound', 0);
    expect(autoGuards({ inbound: q1, messages: [q1], coveredIds: new Set(['q1']) }).reason).toBe('already_answered');
    expect(autoGuards({ inbound: q1, messages: [q1, m('t1', 'outbound', 2, { sent_by: 'omar@airosofts.com' })] }).reason).toBe('already_answered');
  });
  it('two questions in a row → the newest one answers both', () => {
    const q1 = m('q1', 'inbound', 0), q2 = m('q2', 'inbound', 0.2);
    expect(autoGuards({ inbound: q1, messages: [q1, q2] }).reason).toBe('newer_message');
    expect(autoGuards({ inbound: q2, messages: [q1, q2], now: T0 + 60000 })).toMatchObject({ ok: true, pending: ['q1', 'q2'] });
  });
  it('no daily limit and no team-silence rule: 100 real questions → 100 answers', () => {
    const msgs = [];
    const ids = new Set();
    const covered = new Set();
    for (let k = 0; k < 100; k++) { msgs.push(m(`q${k}`, 'inbound', k * 2)); msgs.push(m(`a${k}`, 'outbound', k * 2 + 1, { sent_by: 'api' })); ids.add(`a${k}`); covered.add(`q${k}`); }
    // a team member also wrote just before — the AI still answers the new question
    msgs.push(m('team', 'outbound', 199.5, { sent_by: 'omar@airosofts.com' }));
    const q = m('q100', 'inbound', 200);
    expect(autoGuards({ inbound: q, messages: [...msgs, q], coveredIds: covered, aiMessageIds: ids, now: T0 + 201 * 60000 })).toMatchObject({ ok: true, pending: ['q100'] });
  });
  it('team reply = written by a person in the Inbox; our code (api) and keyword replies are not', () => {
    expect(isTeamReply({ direction: 'outbound', sent_by: 'omar@airosofts.com', text: 'hola' })).toBe(true);
    expect(isTeamReply({ direction: 'outbound', sent_by: 'api', text: 'hola' })).toBe(false);
    expect(isKeywordReplyText('¡Genial! …\nhttps://casa-libre.com.py/r/si-in?r=1')).toBe(true);
    // the CARTERA reply now only asks the size (no link): still our automatic reply, not a person's
    const ask = '¡Genial! Para preparar la migración de tu cartera a Casa-Libre, contanos: ¿cuántas propiedades tenés hoy y dónde las publicás (tu web, otro portal o un Excel)?';
    expect(isKeywordReplyText(ask)).toBe(true);
    expect(isTeamReply({ direction: 'outbound', sent_by: 'omar@airosofts.com', text: ask })).toBe(false);
  });
});

describe('conversationBlocked', () => {
  it('do-not-contact tag or opted out → blocked', () => {
    expect(conversationBlocked({ tags: ['do-not-contact'] })).toBe('do_not_contact');
    expect(conversationBlocked({ opt_in_status: 'opted_out' })).toBeNull();   // BAJA: still answered
    expect(optedOut({ opt_in_status: 'opted_out' })).toBe(true);
    expect(optedOut({ opt_in_status: 'opted_in' }, { whatsapp_opted_out_at: '2026-11-01' })).toBe(true);
    expect(optedOut({ opt_in_status: 'opted_in' })).toBe(false);
    expect(conversationBlocked({ tags: ['site-py'], opt_in_status: 'opted_in' })).toBeNull();
  });
});
