import { describe, it, expect } from 'vitest';
import { buildIssues, issueCounts, giftDraft, lastRealInbound, isTeamMessage, viewsDraft, keywordDraft, goalDone, nudgeDraft } from '../lib/openIssues';

const NOW = Date.parse('2026-11-04T15:00:00Z');
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const days = (d) => new Date(NOW - d * 86400000).toISOString();
const msg = (id, direction, hoursAgo, extra = {}) => ({ id, direction, type: 'text', text: 'x', timestamps: { created: at(hoursAgo) }, ...extra });
const noEmoji = (s) => !/\p{Extended_Pictographic}/u.test(s);

describe('lastRealInbound — robots, emojis and thanks are not "a real message"', () => {
  it('skips the robot greeting and the thanks', () => {
    const msgs = [
      msg('c', 'outbound', 10, { kind: 'campaign', type: 'template' }),
      msg('r', 'inbound', 9.999, { text: 'Gracias por comunicarte con Aldo Zarza. En breve te respondemos.' }),
      msg('q', 'inbound', 5, { text: '¿Por qué un número de EEUU?' }),
      msg('g', 'inbound', 4, { text: 'gracias' }),
    ];
    expect(lastRealInbound(msgs).m.id).toBe('q');
    expect(lastRealInbound(msgs.slice(0, 2))).toBeNull();
  });
  it('a team message = sent from the Inbox by an agent (not the API)', () => {
    expect(isTeamMessage({ direction: 'outbound', sent_by: 'omar@airosofts.com' })).toBe(true);
    expect(isTeamMessage({ direction: 'outbound', sent_by: 'api' })).toBe(false);
    expect(isTeamMessage({ direction: 'outbound', sent_by: null })).toBe(false);
  });
});

describe('buildIssues', () => {
  const kol = { phone: '595981111111', name: 'Kol Propiedades', tags: ['site-py'], messages: [msg('k1', 'inbound', 30, { text: 'Nadie me llama' })] };
  const beatriz = {
    phone: '595982222222', name: 'Beatriz Rivas', tags: ['needs-a-person'],
    messages: [msg('b0', 'outbound', 50, { kind: 'campaign', type: 'template' }), msg('b1', 'inbound', 3, { text: 'Quiero un reembolso' })],
  };
  const robot = { phone: '595983333333', name: 'Aldo', tags: [], messages: [msg('a0', 'outbound', 6, { kind: 'campaign' }), msg('a1', 'inbound', 5.999, { text: 'Gracias por comunicarte con Aldo. Te responderemos a la brevedad.' })] };
  const answered = { phone: '595984444444', name: 'Ana', tags: [], messages: [msg('n1', 'inbound', 5, { text: '¿Cuánto cuesta?' }), msg('n2', 'outbound', 4.9, { sent_by: 'api' })] };
  const fresh = { phone: '595985555555', name: 'Juan', tags: [], messages: [msg('f1', 'inbound', 0.1, { text: 'hola, ¿cómo publico?' })] };
  const dnc = { phone: '595986666666', name: 'X', tags: ['do-not-contact'], messages: [msg('d1', 'inbound', 5, { text: 'no me escriban más' })] };
  const cartera = {
    phone: '595987777777', name: 'Inmo Sur', tags: ['cartera'],
    messages: [msg('c0', 'outbound', 30, { type: 'template' }), msg('c1', 'inbound', 29, { type: 'button', text: 'CARTERA' }), msg('c2', 'outbound', 28.99, { sent_by: 'api', text: '¡Genial! … /r/cartera?r=1' })],
  };
  const aiLog = [{ automation_id: 'inbox_ai_person', meta: { inbound_id: 'b1', note: 'asks for a refund', draft: 'Hola Beatriz, …', english: 'Hi Beatriz, …' } }];

  it('unanswered real messages, with the window and the hand-over draft; robots / answered / too fresh / do-not-contact left out', () => {
    const issues = buildIssues({ now: NOW, chats: [kol, beatriz, robot, answered, fresh, dnc], aiLog });
    const ids = issues.map((i) => i.id);
    expect(ids).toEqual(['unanswered:595982222222:b1', 'unanswered:595981111111:k1']);
    const [b, k] = issues;
    expect(b.priority).toBe('urgent');
    expect(b.evidence.join(' ')).toMatch(/21 h left/);
    expect(b.draft).toEqual({ es: 'Hola Beatriz, …', en: 'Hi Beatriz, …' });
    expect(b.actions).toContain('send_whatsapp');
    expect(k.priority).toBe('high');               // 30 h: the window closed
    expect(k.actions).not.toContain('send_whatsapp');
    expect(k.evidence[0]).toBe('“Nadie me llama”');
  });

  it('CARTERA tapped, only the automatic reply went out → a person must write', () => {
    const [i] = buildIssues({ now: NOW, chats: [cartera] });
    expect(i.type).toBe('keyword');
    expect(i.title).toMatch(/tapped CARTERA/);
    expect(i.draft.es).toMatch(/pasar tu cartera/);
    // once a team member wrote, it is gone
    const done = { ...cartera, messages: [...cartera.messages, msg('c3', 'outbound', 20, { sent_by: 'omar@airosofts.com' })] };
    expect(buildIssues({ now: NOW, chats: [done] })).toEqual([]);
  });

  const daniel = { id: 'u1', full_name: 'Daniel Formoso', email: 'daniel@x.com', phone: '595988888888' };
  const pend = (id, d) => ({ id, created_by: 'u1', status: 'payment_pending', created_at: days(d), property_type: 'Casa', city: 'Capiatá', raw_data: {} });

  it('payment: wrote to us + listings waiting for days → suggest the gift, with Roland\'s thank-you', () => {
    const chat = { phone: '595988888888', name: 'Canell', tags: [], messages: [msg('d1', 'inbound', 24 * 19, { text: 'Sí, pero me quieren cobrar' }), msg('d2', 'outbound', 24 * 19 - 1, { sent_by: 'api', status: 'read' })] };
    const issues = buildIssues({
      now: NOW, chats: [chat], personByPhone: new Map([['88888888', { user: daniel, listings: [], drafts: [] }]]),
      pending: [pend('p1', 20), pend('p2', 20)], usersById: new Map([['u1', daniel]]), listingCountByUser: new Map([['u1', 5]]),
    });
    const i = issues.find((x) => x.type === 'payment');
    expect(i.title).toBe('Daniel Formoso: 2 listings waiting for payment for 20 days');
    expect(i.evidence.join(' | ')).toMatch(/They wrote: “Sí, pero me quieren cobrar”/);
    expect(i.evidence.join(' | ')).toMatch(/The assistant answered .* they read it; no payment since/);
    expect(i.actions[0]).toBe('publish_free');
    expect(i.data.propertyIds).toEqual(['p1', 'p2']);
    expect(i.draft.es).toBe('Hola Daniel, gracias por usar Casa-Libre. Cambiamos nuestra política de publicaciones, pero ya habías cargado tus 2 propiedades, así que las publicamos sin costo: es un regalo de nuestra parte. ¡Éxitos con la venta!');
  });

  it('payment: a one-off seller who never wrote is left to the automation; too recent or gift open → nothing', () => {
    const one = { ...daniel };
    const base = { now: NOW, usersById: new Map([['u1', one]]), listingCountByUser: new Map([['u1', 1]]) };
    expect(buildIssues({ ...base, pending: [pend('p1', 20)] })).toEqual([]);
    expect(buildIssues({ ...base, listingCountByUser: new Map([['u1', 3]]), pending: [pend('p1', 2)] })).toEqual([]);
    const gifted = { ...pend('p1', 20), raw_data: { paid_listing: { gift: { offered_at: days(1), expires_at: days(-10) } } } };
    expect(buildIssues({ ...base, listingCountByUser: new Map([['u1', 3]]), pending: [gifted] })).toEqual([]);
    expect(buildIssues({ ...base, listingCountByUser: new Map([['u1', 3]]), pending: [pend('p1', 20)] })[0].type).toBe('payment');   // a realtor
  });

  it('views, no contacts: escalate after the manager\'s advice; manager emails on hold → send the advice; on and not sent yet → nothing', () => {
    const u = { id: 'u2', full_name: 'Tato Colman', email: 't@x.com' };
    const listing = { id: 'L1', created_by: 'u2', property_type: 'Departamento', city: 'Asunción' };
    const base = { now: NOW, usersById: new Map([['u2', u]]) };
    const esc = buildIssues({ ...base, vncEnabled: true, viewsStats: [{ listing, views: 23, contacts: 0, days: 14, vncSentAt: days(9) }] });
    expect(esc[0].title).toMatch(/advice sent 9 days ago, still no buyer contact/);
    expect(esc[0].draft.es).toMatch(/revisamos juntos el precio/);
    expect(buildIssues({ ...base, vncEnabled: false, viewsStats: [{ listing, views: 23, contacts: 0, days: 14 }] })[0].title).toMatch(/23 views in 14 days/);
    expect(buildIssues({ ...base, vncEnabled: true, viewsStats: [{ listing, views: 23, contacts: 0, days: 14 }] })).toEqual([]);
    expect(buildIssues({ ...base, vncEnabled: true, viewsStats: [{ listing, views: 23, contacts: 0, days: 14, vncSentAt: days(2) }] })).toEqual([]);
    expect(buildIssues({ ...base, vncEnabled: false, viewsStats: [{ listing, views: 23, contacts: 1, days: 14 }] })).toEqual([]);
  });

  it('funnels: unfinished draft (no live listing) and an unfinished checkout', () => {
    const u = { id: 'u3', full_name: 'Lia', email: 'l@x.com' };
    const issues = buildIssues({
      now: NOW, site: 'https://casa-libre.com.py', usersById: new Map([['u3', u]]),
      drafts: [{ id: 'd9', user_id: 'u3', updated_at: days(4), data: { ptype: 'Casa', city: 'Luque' }, missing: ['photos'] }],
      checkouts: [{ id: 'pay1', user_id: 'u3', created_at: days(3), kind: 'listing', amount_usd: 5.8 }],
    });
    expect(issues.map((i) => i.id).sort()).toEqual(['funnel:checkout:pay1', 'funnel:draft:d9']);
    expect(issues.find((i) => i.id === 'funnel:draft:d9').draft.es).toMatch(/Te falta cargar las fotos\. .*tab=borradores&draft=d9/);
    // a user with a live listing is not chased for a draft
    expect(buildIssues({ now: NOW, usersById: new Map([['u3', u]]), usersWithLive: new Set(['u3']), drafts: [{ id: 'd9', user_id: 'u3', updated_at: days(4), data: {} }] })).toEqual([]);
  });

  it('security: auto-suspended accounts not reviewed yet', () => {
    const [i] = buildIssues({ now: NOW, suspensions: [{ user_id: 'u9', name: 'Bot', reason: 'Signed up from Nigeria (blocked region)', ip: '1.2.3.4', at: days(1) }, { user_id: 'u8', reviewed: true }] });
    expect(i.id).toBe('security:u9');
    expect(i.actions).toEqual(['keep_suspended', 'lift_suspension']);
  });

  it('the team\'s decisions are applied, open ones first, counts per group', () => {
    const issues = buildIssues({ now: NOW, chats: [kol, beatriz], aiLog, state: { 'unanswered:595982222222:b1': { state: 'done', by: 'omar', at: at(1) } } });
    expect(issues.map((i) => [i.id, i.status])).toEqual([['unanswered:595981111111:k1', 'open'], ['unanswered:595982222222:b1', 'done']]);
    expect(issueCounts(issues)).toEqual({ open: 1, urgent: 0, byGroup: { Messages: 1 } });
  });

  it('after "Publish free" the card stays to send the thank-you, then closes', () => {
    const snap = { person: { name: 'Daniel Formoso', email: 'd@x.com', phone: '+595988888888' }, draft: giftDraft('Daniel Formoso', 2), evidence: ['a', 'b'], windowOpen: false };
    const [i] = buildIssues({ now: NOW, state: { 'payment:u1:p1,p2': { state: 'gift', by: 'omar', at: at(1), published: ['p1', 'p2'], snapshot: snap } } });
    expect(i).toMatchObject({ id: 'payment:u1:p1,p2', status: 'open', followup: true });
    expect(i.title).toBe('Daniel Formoso: 2 listings published free — send the thank-you');
    expect(i.actions).toEqual(['send_email', 'open_chat', 'done']);
    expect(i.draft.es).toMatch(/las publicamos sin costo/);
    expect(buildIssues({ now: NOW, state: { 'payment:u1:p1,p2': { state: 'sent', snapshot: snap } } })).toEqual([]);
  });

  it('hand-over: the assistant told them someone will answer — the card stays until a TEAM member writes', () => {
    const chat = { phone: '595981234567', name: 'Ana', tags: ['needs-a-person'], messages: [
      msg('q1', 'inbound', 2, { text: 'Quiero que me devuelvan la plata' }),
      msg('h1', 'outbound', 1.99, { sent_by: 'api', text: 'Gracias por tu mensaje. Alguien de nuestro equipo te va a responder en breve.' }),
    ] };
    const aiLog = [{ automation_id: 'inbox_ai_person', to_phone: '+595981234567', subject: 'refund request', created_at: at(1.99), meta: { inbound_id: 'q1', question: 'Quiero que me devuelvan la plata', note: 'asks for a refund', holding: 'Gracias por tu mensaje. Alguien de nuestro equipo te va a responder en breve.', draft: 'Hola Ana, …' } }];
    const [i] = buildIssues({ now: NOW, chats: [chat], aiLog });
    expect(i.id).toBe('person:595981234567:q1');
    expect(i.title).toMatch(/Ana needs a person \(refund request\)/);
    expect(i.evidence.join(' | ')).toMatch(/The assistant told them: “Gracias por tu mensaje/);
    expect(i.draft.es).toBe('Hola Ana, …');
    const answered = { ...chat, messages: [...chat.messages, msg('t1', 'outbound', 1, { sent_by: 'omar@airosofts.com' })] };
    expect(buildIssues({ now: NOW, chats: [answered], aiLog })).toEqual([]);
  });

  it('the AI sort decides what is real (kindOf); the rules are only the fallback', () => {
    const chat = { phone: '595981111112', name: 'Inmo', tags: [], messages: [msg('x1', 'inbound', 5, { text: 'Bienvenido a Inmo Sur, elegí una opción: 1) Ventas 2) Alquileres' })] };
    expect(buildIssues({ now: NOW, chats: [chat], kindOf: () => ({ kind: 'auto', real: false }) })).toEqual([]);
    expect(buildIssues({ now: NOW, chats: [chat], kindOf: () => ({ kind: 'text', real: true }) })[0].type).toBe('unanswered');
  });

  it('funnels never repeat the automations or the Admin Manager', () => {
    const u = { id: 'u3', full_name: 'Lia', email: 'l@x.com' };
    const base = { now: NOW, site: 'https://casa-libre.com.py', usersById: new Map([['u3', u]]), drafts: [{ id: 'd9', user_id: 'u3', updated_at: days(9), data: {} }] };
    // the draft reminders (3 steps) have sent 1 → still the automation's job
    expect(buildIssues({ ...base, followups: { draftSteps: 3, draftReminders: new Map([['d9', { count: 1, last: days(5) }]]) } })).toEqual([]);
    // all 3 sent, 3 days ago, no result → a person
    const i = buildIssues({ ...base, followups: { draftSteps: 3, draftReminders: new Map([['d9', { count: 3, last: days(3) }]]) } })[0];
    expect(i.evidence.join(' | ')).toMatch(/Automatic draft reminders: all 3 sent \(last 3 days ago\) — no result/);
    // the Admin Manager already wrote to her → nothing
    expect(buildIssues({ ...base, followups: { draftSteps: 3, draftReminders: new Map([['d9', { count: 3, last: days(3) }]]), managerByEmail: new Map([['l@x.com', [{ kind: 'manager_stuck_draft', at: days(2) }]]]) } })).toEqual([]);
    // a checkout the Admin Manager already emailed about → nothing
    const co = { now: NOW, usersById: new Map([['u3', u]]), checkouts: [{ id: 'p1', user_id: 'u3', created_at: days(3) }] };
    expect(buildIssues(co).length).toBe(1);
    expect(buildIssues({ ...co, followups: { managerByEmail: new Map([['l@x.com', [{ kind: 'manager_unpaid_listing', at: days(1) }]]]) } })).toEqual([]);
  });

  it('follow-up: the assistant answered "how to publish" 4 days ago, read, link not clicked, nothing published', () => {
    const u = { id: 'u7', full_name: 'Rosa Paz', email: 'r@x.com', phone: '+595981777777' };
    const chat = { phone: '595981777777', name: 'Rosa', tags: [], messages: [msg('q', 'inbound', 24 * 4 + 1, { text: '¿Cómo publico?' }), msg('a', 'outbound', 24 * 4, { sent_by: 'api', status: 'read' })] };
    const aiLog = [{ automation_id: 'inbox_ai', to_phone: '+595981777777', subject: 'how to publish', relay_message_id: 'a', created_at: at(24 * 4), meta: { goal: 'publish', answer_ref: 'abc', inbound_id: 'q', question: '¿Cómo publico?', english: 'Go to the link and upload your photos…' } }];
    const base = { now: NOW, site: 'https://casa-libre.com.py', chats: [chat], aiLog, personByPhone: new Map([['81777777', { user: u, listings: [], drafts: [] }]]), linkFor: (path) => `https://casa-libre.com.py/r/ai?u=${path}` };
    const [i] = buildIssues(base);
    expect(i.type).toBe('followup');
    expect(i.title).toBe('Rosa Paz asked about how to publish — answered 4 days ago, nothing published yet');
    expect(i.evidence.join(' | ')).toMatch(/Read: yes · Link clicked: no · Asked to publish a property: not done/);
    expect(i.draft.es).toMatch(/¿pudiste publicar tu propiedad en Casa-Libre\? .*\/r\/ai\?u=\/publicar/);
    // clicked → higher priority, personal call suggested
    expect(buildIssues({ ...base, clicksByAnswer: new Map([['abc', { count: 2 }]]) })[0]).toMatchObject({ priority: 'high' });
    // published since → a RESULT (goal reached), not an open issue
    const done = buildIssues({ ...base, personByPhone: new Map([['81777777', { user: u, listings: [{ id: 'l', created_at: at(24) }], drafts: [] }]]) });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: 'achieved', actions: [] });
    expect(done[0].title).toBe('Rosa Paz asked about how to publish — the assistant answered, they published a property 3 days later');
    expect(issueCounts(done).open).toBe(0);
    // too soon (1 day) and not done yet → nothing to chase yet
    expect(buildIssues({ ...base, aiLog: [{ ...aiLog[0], created_at: at(24) }] }).filter((x) => x.type === 'followup')).toEqual([]);
  });

  it('goalDone per goal', () => {
    const since = Date.parse(days(5));
    const u = { id: 'u1' };
    expect(goalDone('publish', { user: u, listings: [{ created_at: days(1) }] }, since)).toBe(true);
    expect(goalDone('publish', { user: u, listings: [{ created_at: days(9) }] }, since)).toBe(false);
    expect(goalDone('pay', { user: u, listings: [{ status: 'payment_pending' }] }, since)).toBe(false);
    expect(goalDone('pay', { user: u, listings: [{ status: 'published' }] }, since)).toBe(true);
    expect(goalDone('sign_up', { user: null }, since)).toBe(false);
    expect(goalDone('fix_listing', { user: u, listings: [{ status: 'rejected' }] }, since)).toBe(false);
    expect(nudgeDraft('none', 'x', 'l')).toBeNull();
  });

  it('every draft: Spanish voseo, Casa-Libre with the hyphen, no emojis', () => {
    const all = [giftDraft('Ana', 1), giftDraft('', 3), viewsDraft('Ana', { property_type: 'Casa', city: 'Luque' }, 30, 14, true), viewsDraft('', {}, 30, 14, false), keywordDraft('Ana', 'cartera'), keywordDraft('Ana', 'proyecto')];
    for (const d of all) {
      expect(d.es).toContain('Casa-Libre');
      expect(d.es).not.toMatch(/Casa Libre/);
      expect(noEmoji(d.es) && noEmoji(d.en)).toBe(true);
    }
    expect(giftDraft('Ana', 1).es).toMatch(/tu propiedad, así que la publicamos/);
  });
});
