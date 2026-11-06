import { describe, it, expect } from 'vitest';
import { buildAlerts, alertCounts, alertTagsOf, keywordOf, alertSnapshot, chatLink } from '../lib/alerts';

const NOW = Date.parse('2026-11-04T15:00:00Z');
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const msg = (id, direction, hoursAgo, extra = {}) => ({ id, direction, type: 'text', text: 'x', timestamps: { created: at(hoursAgo) }, ...extra });
const windowFor = (hoursAgoInbound) => ({ open: true, expires_at: new Date(NOW - hoursAgoInbound * 3600000 + 24 * 3600000).toISOString() });

const handover = (phone, inboundId, hoursAgo, meta = {}) => ({
  to_phone: `+${phone}`, created_at: at(hoursAgo), subject: 'price question',
  meta: { inbound_id: inboundId, question: '¿Cuánto cuesta publicar 30 propiedades?', reason: 'bulk pricing not in facts', note: 'Wants a bulk price', holding: 'Gracias por tu mensaje. Alguien de nuestro equipo te va a responder en breve.', draft: 'Hola, te escribo…', english: 'Hi, writing to you…', ...meta },
});

describe('alertTagsOf / keywordOf', () => {
  it('reads the alert tags (lowercased) and ignores the rest', () => {
    expect(alertTagsOf({ tags: ['site-py', 'Needs-A-Person', 'cl-unread', 'cartera'] })).toEqual(['needs-a-person', 'cartera']);
    expect(alertTagsOf({ tags: ['ai-answered'] })).toEqual([]);
  });
  it('finds a CARTERA / PROYECTO tap in a button or typed alone', () => {
    expect(keywordOf({ direction: 'inbound', type: 'button', button: { text: 'CARTERA', payload: 'cartera' } })).toBe('cartera');
    expect(keywordOf({ direction: 'inbound', text: ' Proyecto ' })).toBe('proyecto');
    expect(keywordOf({ direction: 'inbound', text: 'tengo una cartera grande' })).toBeNull();
    expect(keywordOf({ direction: 'outbound', text: 'CARTERA' })).toBeNull();
  });
});

describe('buildAlerts', () => {
  it('an open needs-a-person alert: reason, what they wrote, holding message, draft, window hours', () => {
    const chats = [{
      phone: '+595981111111', name: 'Canell', tags: ['needs-a-person', 'cl-unread'], window: windowFor(2),
      messages: [
        msg('in1', 'inbound', 2, { text: '¿Cuánto cuesta publicar 30 propiedades?' }),
        msg('hold', 'outbound', 1.99, { sent_by: 'api', text: 'Gracias por tu mensaje…' }),
      ],
    }];
    const personByPhone = new Map([['81111111', { full_name: 'Daniel Pérez', email: 'd@x.com' }]]);
    const [a, ...rest] = buildAlerts({ chats, handovers: [handover('595981111111', 'in1', 1.99)], now: NOW, personByPhone });
    expect(rest).toHaveLength(0);
    expect(a).toMatchObject({ type: 'person', label: 'Needs a person', status: 'open', name: 'Daniel Pérez', whatsappName: 'Canell', phone: '+595981111111', reason: 'Wants a bulk price', topic: 'price question' });
    expect(a.id).toBe('person:595981111111:in1');
    expect(a.since).toBe(at(2));                  // the inbound message, not the log row
    expect(a.wrote).toEqual(['¿Cuánto cuesta publicar 30 propiedades?']);
    expect(a.holding).toMatch(/Alguien de nuestro equipo/);
    expect(a.draft).toEqual({ es: 'Hola, te escribo…', en: 'Hi, writing to you…' });
    expect(a.windowHours).toBeCloseTo(22, 5);     // 24 h after their message, 2 h gone
    expect(alertCounts([a]).open).toBe(1);
  });

  it('a needs-a-person alert closed by a team reply (the assistant\'s holding message does not count)', () => {
    const chats = [{
      phone: '+595982222222', name: 'Ana', tags: ['needs-a-person'], window: windowFor(5),
      messages: [
        msg('in2', 'inbound', 5, { text: 'Necesito ayuda' }),
        msg('hold', 'outbound', 4.99, { sent_by: 'api' }),
        msg('team', 'outbound', 3, { sent_by: 'Hamza Maqsood', text: 'Hola Ana, te ayudo' }),
      ],
    }];
    const [a] = buildAlerts({ chats, handovers: [handover('595982222222', 'in2', 4.99)], now: NOW });
    expect(a.status).toBe('answered');
    expect(a.closed).toMatchObject({ how: 'answered', by: 'Hamza Maqsood', at: at(3) });
    expect(alertCounts([a]).open).toBe(0);
  });

  it('a team message from BEFORE the hand-over does not close it; the newest hand-over wins', () => {
    const chats = [{
      phone: '+595983333333', tags: ['needs-a-person'], window: windowFor(1),
      messages: [msg('old', 'inbound', 30), msg('team', 'outbound', 29, { sent_by: 'Omar' }), msg('new', 'inbound', 1, { text: 'Hola otra vez?' })],
    }];
    const [a] = buildAlerts({ chats, handovers: [handover('595983333333', 'old', 30), handover('595983333333', 'new', 0.9, { question: 'Hola otra vez?' })], now: NOW });
    expect(a.status).toBe('open');
    expect(a.id).toBe('person:595983333333:new');
  });

  it('a CARTERA tap: open, with what they answered after the automatic reply', () => {
    const chats = [{
      phone: '+595984444444', name: 'Inmobiliaria Sol', tags: ['cartera', 'site-py'], window: windowFor(0.5),
      messages: [
        msg('camp', 'outbound', 3, { type: 'template', sent_by: 'api' }),
        msg('tap', 'inbound', 2, { type: 'button', text: undefined, button: { text: 'CARTERA', payload: 'cartera' } }),
        msg('auto', 'outbound', 1.99, { sent_by: 'api', text: '¿Cuántas propiedades tenés y dónde publicás?' }),
        msg('ans', 'inbound', 0.5, { text: 'Unas 80, en InfoCasas' }),
      ],
    }];
    const [a] = buildAlerts({ chats, now: NOW });
    expect(a).toMatchObject({ type: 'cartera', label: 'CARTERA — portfolio migration', status: 'open', name: 'Inmobiliaria Sol', id: 'cartera:595984444444:tap', since: at(2) });
    expect(a.wrote).toEqual(['CARTERA', 'Unas 80, en InfoCasas']);
    expect(a.reason).toMatch(/portfolio migrated/);
    expect(a.windowHours).toBeCloseTo(23.5, 5);
  });

  it('a PROYECTO tap marked handled: closed, with who and when', () => {
    const chats = [{ phone: '+595985555555', tags: ['proyecto'], window: { open: false }, messages: [msg('p1', 'inbound', 40, { text: 'PROYECTO' })] }];
    const state = { 'proyecto:595985555555:p1': { state: 'handled', by: 'Roland', at: at(1) } };
    const [a] = buildAlerts({ chats, state, now: NOW });
    expect(a.status).toBe('handled');
    expect(a.closed).toMatchObject({ how: 'handled', by: 'Roland', at: at(1) });
    expect(a.windowHours).toBeNull();             // the 24 h window closed: template only
  });

  it('marked handled and the tag removed: shown from the snapshot for 7 days, then gone', () => {
    const chats = [{ phone: '+595986666666', name: 'Luis', tags: ['cartera'], window: windowFor(1), messages: [msg('c1', 'inbound', 1, { text: 'CARTERA' })] }];
    const [live] = buildAlerts({ chats, now: NOW });
    const state = { [live.id]: { state: 'handled', by: 'Omar', at: at(0.5), snapshot: alertSnapshot(live) } };
    const after = buildAlerts({ chats: [], state, now: NOW });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: live.id, status: 'handled', name: 'Luis', closed: { by: 'Omar' } });
    expect(buildAlerts({ chats: [], state, now: NOW + 8 * 86400000 })).toHaveLength(0);
  });

  it('answered more than 7 days ago → no longer listed', () => {
    const chats = [{ phone: '+595987777777', tags: ['proyecto'], messages: [msg('p', 'inbound', 300, { text: 'proyecto' }), msg('t', 'outbound', 299, { sent_by: 'Hamza' })] }];
    expect(buildAlerts({ chats, now: NOW })).toHaveLength(0);
  });

  it('open on top, newest first; the count only counts open ones', () => {
    const chats = [
      { phone: '+595981000001', tags: ['cartera'], messages: [msg('a', 'inbound', 10, { text: 'CARTERA' })] },
      { phone: '+595981000002', tags: ['proyecto'], messages: [msg('b', 'inbound', 1, { text: 'PROYECTO' })] },
      { phone: '+595981000003', tags: ['cartera'], messages: [msg('c', 'inbound', 0.5, { text: 'CARTERA' }), msg('r', 'outbound', 0.2, { sent_by: 'Omar' })] },
      { phone: '+595981000004', tags: ['needs-a-person'], messages: [msg('d', 'inbound', 4, { text: 'loop' })] },   // tagged by a guard, no hand-over row
    ];
    const list = buildAlerts({ chats, now: NOW });
    expect(list.map((a) => a.digits)).toEqual(['595981000002', '595981000004', '595981000001', '595981000003']);
    expect(list[1].reason).toMatch(/stopped answering by itself/);
    expect(alertCounts(list)).toMatchObject({ open: 3, closed: 1, byType: { person: 1, cartera: 1, proyecto: 1 } });
  });

  it('Open chat link carries the test mode', () => {
    expect(chatLink('+595 981 111', 'live')).toBe('/inbox?phone=595981111');
    expect(chatLink('595981111', 'test')).toBe('/inbox?phone=595981111&mode=test');
  });
});

describe('agency portfolio alerts (Roland, Nov 5 2026)', () => {
  it('an agency that told the assistant its size: the card names the count, the snapshot keeps it', () => {
    const chats = [{ phone: '+595971340234', name: 'CENTURY 21 Access', tags: ['needs-a-person', 'cartera'], window: windowFor(1), messages: [
      msg('tap', 'inbound', 2, { type: 'button', text: 'CARTERA', button: { text: 'CARTERA' } }),
      msg('ask', 'outbound', 1.99, { sent_by: 'api', text: '¡Genial! Para preparar la migración de tu cartera a Casa-Libre, contanos: …' }),
      msg('n', 'inbound', 1, { text: 'Tenemos 63 propiedades en nuestra web' }),
      msg('offer', 'outbound', 0.99, { sent_by: 'api', text: 'Migramos hasta 100 propiedades gratis por 6 meses…' }),
    ] }];
    const ho = handover('595971340234', 'n', 0.99, { question: 'Tenemos 63 propiedades en nuestra web', note: 'Agency portfolio: 63 listings (11–200 listings: we migrate up to 100 free for 6 months).', portfolio_listings: 63 });
    const alerts = buildAlerts({ chats, handovers: [ho], now: NOW });
    const p = alerts.find((a) => a.type === 'person');
    expect(p).toMatchObject({ label: 'Agency portfolio — 63 listings', portfolio: 63, status: 'open' });
    expect(p.reason).toMatch(/63 listings/);
    expect(alertSnapshot(p).portfolio).toBe(63);
    // the CARTERA card is still there, with their answer
    const c = alerts.find((a) => a.type === 'cartera');
    expect(c.wrote).toContain('Tenemos 63 propiedades en nuestra web');
  });
  it('a plain hand-over keeps its usual label', () => {
    const chats = [{ phone: '+595981111111', tags: ['needs-a-person'], messages: [msg('in1', 'inbound', 2)] }];
    expect(buildAlerts({ chats, handovers: [handover('595981111111', 'in1', 1.9)], now: NOW })[0].label).toBe('Needs a person');
  });
});

describe('developer project alerts', () => {
  it('a developer that told the assistant its units: the card says so', () => {
    const chats = [{ phone: '+595981222333', tags: ['needs-a-person', 'proyecto'], messages: [msg('p', 'inbound', 2, { text: 'PROYECTO' }), msg('n', 'inbound', 1, { text: 'Son 120 departamentos' })] }];
    const ho = handover('595981222333', 'n', 0.9, { portfolio_listings: 120, portfolio_kind: 'developer', note: 'Developer project: 120 units' });
    const p = buildAlerts({ chats, handovers: [ho], now: NOW }).find((a) => a.type === 'person');
    expect(p.label).toBe('Developer project — 120 units');
  });
});
