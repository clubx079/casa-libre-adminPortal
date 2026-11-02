import { describe, it, expect } from 'vitest';
import { templateLook, waSegments, TEMPLATE_LOOK } from '../lib/waTemplateLook.js';

const relay = (over = {}) => ({ name: 'cl_publica_imagen_v2', header: 'image', body: 'Hola {{1}}, así se ve Casa-Libre por dentro.', variables: { header: 0, body: 1, url_buttons: [0] }, ...over });

describe('templateLook', () => {
  it('draws a campaign template with its media, footer and button, the name filled in', () => {
    const l = templateLook('cl_publica_imagen_v2', relay(), { body: ['contact.first_name'] });
    expect(l).toMatchObject({ format: 'Image', footer: 'Casa-Libre', buttons: ['Ver Casa-Libre'], body: 'Hola María, así se ve Casa-Libre por dentro.' });
    expect(l.header).toEqual({ type: 'image', src: '/wa-templates/publica-imagen.png', poster: null });
  });
  it('every v2 campaign template has its format and a button', () => {
    for (const n of ['texto', 'gif', 'imagen', 'video']) {
      const l = templateLook(`cl_publica_${n}_v2`, null);
      expect(l.buttons).toHaveLength(1);
      expect(l.format).toBe({ texto: 'Text', gif: 'GIF', imagen: 'Image', video: 'Video' }[n]);
      expect(!!l.header).toBe(n !== 'texto');
    }
    expect(TEMPLATE_LOOK.cl_publica_video_v2.header.poster).toMatch(/poster/);
  });
  it('an unknown template: header type from Relay with no media, a generic button per URL button', () => {
    const l = templateLook('cl_otro', relay({ name: 'cl_otro', header: 'VIDEO', variables: { body: 2, url_buttons: [0, 1] }, body: 'Hola {{1}}, {{2}}' }), { body: ['contact.first_name', { source: 'static', text: 'hoy' }] });
    expect(l).toMatchObject({ format: 'Video', header: { type: 'video', src: null }, buttons: ['Abrir enlace', 'Abrir enlace'], body: 'Hola María, hoy', footer: null });
  });
  it('English: the known translation with the same name filled in; the button opens the sell page', () => {
    const l = templateLook('cl_publica_video_v2', relay({ name: 'cl_publica_video_v2', header: 'video' }), { body: ['contact.first_name'] }, 'en');
    expect(l.body).toMatch(/^Hi María, in 30 seconds we show you Casa-Libre/);
    expect(l).toMatchObject({ buttons: ['Get started'], translated: true, url: 'https://casa-libre.com.py/?sell=1', footer: 'Casa-Libre' });
    expect(templateLook('cl_otro', relay({ name: 'cl_otro' }), null, 'en')).toMatchObject({ body: null, translated: false, buttons: ['Open link'], url: null });
  });
  it('text only, no Relay data: empty body, no header', () => {
    expect(templateLook('cl_x', null)).toMatchObject({ format: 'Text', header: null, body: '', buttons: [] });
  });
});

describe('waSegments', () => {
  it('splits WhatsApp formatting', () => {
    expect(waSegments('Hola *María*, _ya_ ~no~')).toEqual([{ text: 'Hola ' }, { text: 'María', bold: true }, { text: ', ' }, { text: 'ya', italic: true }, { text: ' ' }, { text: 'no', strike: true }]);
  });
});

describe('the "por fin llegó" set', () => {
  it('each of the four has its format, media, footer, button and English', () => {
    const relay = (name, header) => ({ name, header, body: 'Hola {{1}}, ¡por fin llegó!', variables: { body: 1, url_buttons: [0] } });
    const want = { cl_porfin_texto: ['Text', null], cl_porfin_gif_mascota: ['GIF', '/wa-templates/porfin-mascota.mp4'], cl_porfin_gif_estadisticas: ['GIF', '/wa-templates/porfin-estadisticas.mp4'], cl_porfin_video: ['Video', '/wa-templates/publica-video.mp4'] };
    for (const [name, [format, src]] of Object.entries(want)) {
      const es = templateLook(name, relay(name, src ? 'gif' : null));
      expect(es).toMatchObject({ format, footer: 'Casa-Libre', buttons: ['Reclamar publicación'], body: 'Hola María, ¡por fin llegó!', url: 'https://casa-libre.com.py/?sell=1' });
      expect(es.header?.src ?? null).toBe(src);
      const en = templateLook(name, relay(name), null, 'en');
      expect(en.body).toMatch(/^Hi María, it's finally here!/);
      expect(en.buttons).toEqual(['Claim your listing']);
    }
  });
});
