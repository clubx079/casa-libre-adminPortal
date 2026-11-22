import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hopTarget, hopTag } from '../lib/waCountryHop.js';
import { waVariables, WA_COUNTRIES } from '../lib/whatsappTemplates.js';

test('a WhatsApp click of another country is sent on to that country, same path and query', () => {
  const u = new URL('https://casa-libre.com.py/propiedad/abc-123?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=cl_visitas&cl_c=uy');
  assert.equal(hopTarget(u), 'https://uy.casa-libre.com/propiedad/abc-123?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=cl_visitas');
  assert.equal(hopTarget(new URL('https://casa-libre.com.py/publicar?draft=d1&cl_c=bo')), 'https://casa-libre.com.bo/publicar?draft=d1');
  assert.equal(hopTarget(new URL('https://casa-libre.com.py/propiedad/x')), null);
  assert.equal(hopTarget(new URL('https://casa-libre.com.py/propiedad/x?cl_c=py')), null);
  assert.equal(hopTarget(new URL('https://casa-libre.com.py/propiedad/x?cl_c=zz')), null);
});

test('button variables carry the country outside Paraguay only', () => {
  const vars = { name: 'Ana', property_title: 'Casa', views: '10', property_url: 'https://uy.casa-libre.com/propiedad/abc' };
  assert.equal(waVariables('cl_visitas', vars, { country: 'uy' }).buttons[0].text, 'abc?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=cl_visitas&cl_c=uy');
  assert.equal(waVariables('cl_visitas', vars, { country: 'py' }).buttons[0].text, 'abc?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=cl_visitas');
  assert.equal(waVariables('cl_visitas', vars).buttons[0].text, 'abc?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=cl_visitas');
  assert.equal(hopTag('sv'), '&cl_c=sv');
  assert.deepEqual(WA_COUNTRIES, ['py', 'bo', 'uy', 've', 'sv']);
});
