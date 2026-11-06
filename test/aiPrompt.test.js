import { describe, it, expect } from 'vitest';
import { systemPrompt, buildAsk, SCHEMA } from '../lib/aiPrompt';

describe('Inbox AI prompt — company context', () => {
  const p = systemPrompt('Paraguay');
  it('explains what Casa-Libre is in Roland\'s wording, per country', () => {
    expect(p).toContain('Casa-Libre');
    expect(p).toContain('a real-estate marketplace for Latin America');
    expect(p).toContain('el nuevo marketplace inmobiliario de Paraguay, con tecnología de Estados Unidos');
    expect(systemPrompt('Bolivia')).toContain('el nuevo marketplace inmobiliario de Bolivia');
    expect(p).toContain('NEVER say Casa-Libre is only in Paraguay');
    expect(p).not.toMatch(/properties only from/);
  });
  it('never justifies where we are based or why the number is from the US (Roland, Nov 4)', () => {
    expect(p).toMatch(/We never justify ourselves/);
    expect(p).toMatch(/answer ONLY the real question/);
    expect(p).not.toMatch(/the founder and the company are in the United States/);
    expect(p).toMatch(/2–4 short sentences \(about 50–70 words\)/);
  });
  it('carries the offer, the proof and the banned claims', () => {
    expect(p).toContain('gratis durante el lanzamiento');
    expect(p).toContain('0% de comisión');
    expect(p).toContain('16.000 visitas');
    expect(p).toContain('gratis para siempre');
    expect(p).toContain('de mayor crecimiento');
  });
  it('forbids emojis and contains none itself', () => {
    expect(p).toContain('NO emojis');
    expect(p).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('knows the campaign keywords', () => {
    for (const k of ['SÍ', 'CARTERA', 'PROYECTO', 'BAJA']) expect(p).toContain(k);
  });
  it('buildAsk still includes the conversation and fact sheet', () => {
    const a = buildAsk({ thread: 'Hola', facts: { situation: 'x' }, whatsappName: 'Ana', windowOpen: true });
    expect(a).toContain('Hola');
    expect(a).toContain('"whatsapp_name":"Ana"');
  });
});

describe('Inbox AI prompt — automatic mode', () => {
  const p = systemPrompt('Paraguay');
  it('the schema carries the decision fields', () => {
    expect(SCHEMA.required).toEqual(expect.arrayContaining(['action', 'topic', 'reason']));
    expect(SCHEMA.properties.action.enum).toEqual(['send', 'send_and_person', 'person']);
  });
  it('explains when to send and when a person is needed', () => {
    expect(p).toContain('# Automatic mode');
    expect(p).toMatch(/"send" — .*what it costs, how to publish/);
    expect(p).not.toMatch(/why the US number/);
    expect(p).toMatch(/"send_and_person" — .*refund/);
    expect(p).toMatch(/FIRST HELP/);
    expect(p).toMatch(/ALWAYS include the one link that solves it/);
    expect(p).toContain('never promise gifts, discounts or refunds');
  });
  it('numbers are real and rounded down, never inflated', () => {
    expect(p).toContain('rounded DOWN');
    expect(p).toContain('Never invent or inflate a number');
    expect(p).not.toContain('Exaggerate');
    expect(p).not.toContain('round up');
  });
  it('buildAsk marks auto mode and drops the "no instruction" line', () => {
    const a = buildAsk({ thread: 'CONTACT: hola', facts: {}, auto: true });
    expect(a.startsWith('AUTO MODE')).toBe(true);
    expect(a).not.toContain('No instruction');
    expect(buildAsk({ thread: 'x', facts: {} })).toContain('No instruction');
  });
});

describe('Inbox AI prompt — every language, unclear = ask', () => {
  const p = systemPrompt('Paraguay');
  it('replies in the language of the contact, any language, and never hands over for language', () => {
    expect(p).toMatch(/ALWAYS reply in the language of their last message/);
    expect(p).not.toMatch(/language you can't answer/);
  });
  it('unclear: "info" / "hola" are answered; an unclear problem → ask them to explain, someone will get back', () => {
    expect(p).toMatch(/An unclear "info" or "hola" is NOT "person"/);
    expect(p).toMatch(/asking them to explain their issue and saying someone from our team will get back to them/);
  });
});

describe('Inbox AI prompt — agency offer by portfolio size (Roland, Nov 5 2026)', () => {
  const p = systemPrompt('Paraguay');
  it('the schema returns the portfolio count', () => {
    expect(SCHEMA.required).toContain('portfolio');
    expect(SCHEMA.properties.portfolio.type).toBe('integer');
  });
  it('has the three tiers and who takes over', () => {
    expect(p).toContain('# Agencies and developers: the offer by portfolio size');
    expect(p).toMatch(/1 to 10: they publish themselves/);
    expect(p).toMatch(/11 to 200: "migramos hasta 100 propiedades gratis por 6 meses/);
    expect(p).toMatch(/More than 200: .*propuesta a medida/);
    expect(p).toMatch(/WITHOUT a number yet .*ask how many properties they have and where they publish them/);
  });
  it('never promises the whole portfolio free and never mentions scraping', () => {
    expect(p).toContain('Never promise a whole portfolio free');
    expect(p).toContain('never mention scraping, robots or tools');
    expect(p).toContain('our automatic reply asked how many properties they have');
    expect(p).not.toMatch(/CARTERA \(an agency with many listings → we migrate their portfolio for them, a person will contact them\)/);
  });
});

describe('Inbox AI prompt — developers (PROYECTO) get the same offer in units', () => {
  const p = systemPrompt('Paraguay');
  it('knows the PROYECTO ask and the unit wording', () => {
    expect(p).toContain("our automatic reply asked the project's name, where it is and how many units it has");
    expect(p).toContain('cargamos hasta 100 unidades gratis por 6 meses');
    expect(p).toContain('Para un proyecto de ese tamaño preparamos una propuesta a medida');
    expect(SCHEMA.properties.portfolio.description).toMatch(/units their project has/);
  });
});
