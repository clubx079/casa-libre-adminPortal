import { describe, it, expect } from 'vitest';
import { inboundKind, isRealReply, isRobotText } from '../lib/waInboundKind';

const msg = (text, extra = {}) => ({ direction: 'inbound', type: 'text', text, ...extra });

describe('inboundKind — sorting what people send us', () => {
  it('a quick-reply button tap is a button', () => {
    expect(inboundKind({ direction: 'inbound', type: 'button', text: 'SÍ' }).kind).toBe('button');
    expect(inboundKind({ direction: 'inbound', type: 'button', text: 'BAJA' }).kind).toBe('button');
  });
  it('a typed keyword is a keyword (SÍ, BAJA, CARTERA, PROYECTO, STOP)', () => {
    for (const t of ['si', 'Sí', 'SÍ.', 'baja', 'Cartera', 'PROYECTO', 'stop', 'No recibir más']) expect(inboundKind(msg(t)).kind, t).toBe('keyword');
  });
  it('reactions, stickers and emoji-only texts are emoji', () => {
    expect(inboundKind({ direction: 'inbound', type: 'reaction', text: '👍' }).kind).toBe('emoji');
    expect(inboundKind({ direction: 'inbound', type: 'sticker', text: '' }).kind).toBe('emoji');
    expect(inboundKind(msg('❤️')).kind).toBe('emoji');
    expect(inboundKind(msg('👍🏽 🙏')).kind).toBe('emoji');
  });
  it('thanks / ok are an ack (no answer needed)', () => {
    for (const t of ['Gracias', 'muchas gracias!!', 'ok', 'Dale', 'Listo', 'Perfecto, gracias', 'Ok gracias']) expect(inboundKind(msg(t)).kind, t).toBe('ack');
  });
  it('agents\' automatic greetings are auto (robots)', () => {
    const bots = [
      'Gracias por comunicarte con Aldo Zarza Inmobiliaria. En breve te responderemos.',
      '¡Hola! Soy Carla de RE/MAX. Gracias por tu mensaje, enseguida te respondo.',
      'Gracias por comunicarte con Tortas RG ¿Cómo podemos ayudarte?Envíame ...fecha, kg, rellenos,  decoración, en un ratito te estaré contestando,  gracias!',
      'Nuestro horario de atención es de lunes a viernes de 8 a 18 hs. Te responderemos a la brevedad.',
      'Este es un mensaje automático. Un asesor te contactará en breve.',
      'Bienvenido a Century 21 Prime. ¿En qué podemos ayudarte?',
    ];
    for (const t of bots) expect(inboundKind(msg(t)).kind, t).toBe('auto');
  });
  it('a long reply seconds after our campaign message is auto too', () => {
    const long = 'Hola, en este momento estoy con clientes. Decime qué propiedad te interesa y más tarde te paso toda la información completa de la propiedad.';
    expect(inboundKind(msg(long), { secondsAfterOurs: 4 }).kind).toBe('auto');
    // the same text a day later is a real message
    expect(inboundKind(msg(long), { secondsAfterOurs: 86400 }).kind).toBe('text');
  });
  it('a greeting alone is an opener the assistant can answer', () => {
    for (const t of ['Hola', 'Buenas tardes', 'hola buenas']) expect(inboundKind(msg(t)).kind, t).toBe('greeting');
  });
  it('questions and other real texts', () => {
    expect(inboundKind(msg('¿Porque veo un número de EEUU?')).kind).toBe('question');
    expect(inboundKind(msg('Sí, pero me quieren cobrar')).kind).toBe('text');
    expect(inboundKind(msg('Nadie me llama')).kind).toBe('text');
  });
  it('a photo or audio without text is media', () => {
    expect(inboundKind({ direction: 'inbound', type: 'image', text: '', media: { type: 'image' } }).kind).toBe('media');
  });
  it('real = a person wrote something worth counting as a reply', () => {
    expect(isRealReply(msg('¿Cuánto cuesta?'))).toBe(true);
    expect(isRealReply({ direction: 'inbound', type: 'button', text: 'SÍ' })).toBe(true);
    expect(isRealReply(msg('Gracias por comunicarte con Aldo Zarza. En breve te respondemos.'))).toBe(false);
    expect(isRealReply(msg('👍'))).toBe(false);
    expect(isRealReply(msg('gracias'))).toBe(false);
  });
  it('isRobotText alone', () => {
    expect(isRobotText('Gracias por tu mensaje, te responderemos a la brevedad')).toBe(true);
    expect(isRobotText('Tengo una casa en Luque para vender')).toBe(false);
  });
});
