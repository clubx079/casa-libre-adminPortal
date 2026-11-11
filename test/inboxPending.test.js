import { describe, it, expect } from 'vitest';
import { pendingOf, automatedKinds } from '../lib/inboxPendingCore';
import { isRealUnread, isRealUnresponded, isAutomated, filterConversations, countryCounts } from '../lib/inboxRules';
import { inboundKind, isRobotText } from '../lib/waInboundKind';

let t = Date.parse('2026-11-12T12:00:00Z');
// newest first, like Relay
const thread = (...msgs) => msgs.map((m) => ({ ...m, timestamps: { created: new Date(t -= 60000).toISOString() } }));
const inb = (text, type = 'text') => ({ direction: 'inbound', type, text });
const ours = (text = 'Hola', type = 'template') => ({ direction: 'outbound', type, text });

describe('agency auto-greetings are robot replies', () => {
  it.each([
    '👋 ¡Hola! Soy Ignacio Fretes, asesor inmobiliario de RE/MAX Sueños, mucho gusto!. Te acompaño en la búsqueda de tu hogar',
    'Abriendo puertas, creando hogares. 🏡 Te saluda Francisco Mendoza agente Inmoboliario de RE/MAX',
    'Hola, soy María Riquelme, agente de #Sevilla Propiedades',
    'Hola te saluda Keila Arévalos Century 21 Elite',
    'Te contactaste con Estela Riveros de C21',
    'João Ribeiro agradece seu contato. Como podemos ajudar?',
  ])('%s', (text) => expect(isRobotText(text)).toBe(true));
  it('an agent who introduces themself AND wants something is a person', () => {
    expect(isRobotText('Hola, soy María, agente de Century 21, quiero publicar mis propiedades')).toBe(false);
    expect(isRobotText('Hola soy Luis asesor inmobiliario, ¿cómo funciona la página?')).toBe(false);
    expect(inboundKind(inb('Hola soy Luis asesor inmobiliario, ¿cómo funciona la página?')).kind).toBe('question');
  });
  it('ordinary messages are untouched', () => {
    for (const s of ['Hola, soy de Luque y tengo una casa', '¿Cuánto cuesta publicar?', 'Me interesa', 'Buenas tardes']) expect(isRobotText(s), s).toBe(false);
  });
});

describe('pendingOf', () => {
  it('a SÍ tap under our automatic answer: unread is a button, nothing unresponded', () => {
    const msgs = thread(ours('¡Genial! Publicá tu primera propiedad acá', 'text'), inb('SÍ', 'button'), ours());
    const p = pendingOf({ unread_count: 1, last_message: msgs[0] }, msgs);
    expect(p.unread).toEqual({ kinds: ['button'], real: false, unknown: false });
    expect(p.tail).toEqual({ kinds: [], real: false, unknown: false });
  });
  it('a reaction then a question: both unread, real', () => {
    const msgs = thread(inb('❤️', 'reaction'), inb('¿Cómo publico?'), ours());
    const p = pendingOf({ unread_count: 2, last_message: msgs[0] }, msgs);
    expect(p.unread.real).toBe(true);
    expect(p.unread.kinds.sort()).toEqual(['emoji', 'question']);
    expect(p.tail.real).toBe(true);
  });
  it('a robot reply seconds after our template', () => {
    const msgs = [
      { ...inb('Gracias por comunicarte con Inmobiliaria X, te responderemos a la brevedad'), timestamps: { created: '2026-11-12T10:00:05Z' } },
      { ...ours(), timestamps: { created: '2026-11-12T10:00:00Z' } },
    ];
    const p = pendingOf({ unread_count: 1, last_message: msgs[0] }, msgs);
    expect(p.unread).toEqual({ kinds: ['auto'], real: false, unknown: false });
    expect(automatedKinds(p)).toEqual(['auto']);
  });
  it('unread count but no inbound message in the page read: counted (unknown)', () => {
    const p = pendingOf({ unread_count: 3, last_message: { direction: 'outbound' } }, thread(ours()));
    expect(p.unread.real).toBe(true);
    expect(p.unread.unknown).toBe(true);
  });
});

describe('real unread / unresponded / automated', () => {
  const conv = (o) => ({ phone: '+595981000001', status: 'open', sites: ['py'], tags: [], unread_count: 0, last_message: { direction: 'outbound' }, ...o });
  const buttonTap = { unread: { kinds: ['button'], real: false }, tail: { kinds: [], real: false } };
  const question = { unread: { kinds: ['question'], real: true }, tail: { kinds: ['question'], real: true } };
  const robot = { unread: { kinds: ['auto'], real: false }, tail: { kinds: ['auto'], real: false } };

  it('not looked at yet → counted (never hide a real message)', () => {
    expect(isRealUnread(conv({ unread_count: 1 }))).toBe(true);
    expect(isRealUnresponded(conv({ last_message: { direction: 'inbound' } }))).toBe(true);
  });
  it('a dot over a SÍ tap the website answered is automated', () => {
    const c = conv({ unread_count: 1, tags: ['cl-unread'], pending: buttonTap });
    expect(isRealUnread(c)).toBe(false);
    expect(isAutomated(c)).toBe(true);
  });
  it('a hand-put dot with nothing new behind it still counts', () => {
    expect(isRealUnread(conv({ unread_count: 0, tags: ['cl-unread'] }))).toBe(true);
  });
  it('the AI assistant handing it to a person always counts', () => {
    const c = conv({ unread_count: 1, tags: ['needs-a-person', 'cl-unread'], pending: buttonTap });
    expect(isRealUnread(c)).toBe(true);
    expect(isAutomated(c)).toBe(false);
  });
  it('a robot reply is neither unread nor unresponded', () => {
    const c = conv({ unread_count: 1, last_message: { direction: 'inbound' }, pending: robot });
    expect(isRealUnread(c)).toBe(false);
    expect(isRealUnresponded(c)).toBe(false);
    expect(isAutomated(c)).toBe(true);
  });
  it('filter counts and the Automated view', () => {
    const list = [
      conv({ phone: '1', unread_count: 1, last_message: { direction: 'inbound' }, pending: question }),
      conv({ phone: '2', unread_count: 1, last_message: { direction: 'inbound' }, pending: robot }),
      conv({ phone: '3', unread_count: 1, tags: ['cl-unread'], pending: buttonTap }),
      conv({ phone: '4' }),
    ];
    const { counts } = filterConversations(list, { status: 'all', view: 'all', country: 'py' });
    expect(counts).toMatchObject({ unread: 1, unresponded: 1, automated: 2 });
    expect(filterConversations(list, { status: 'all', view: 'automated', country: 'py' }).data.map((c) => c.phone)).toEqual(['2', '3']);
    expect(filterConversations(list, { status: 'all', view: 'unread', country: 'py' }).data.map((c) => c.phone)).toEqual(['1']);
    expect(countryCounts(list).py).toMatchObject({ unread: 1, unresponded: 1, automated: 2 });
  });
});
