import { test } from 'vitest';
import assert from 'node:assert/strict';
import { siteOf, groupAgencies, matchCasaLibre, countListingLinks, findListingsPage } from '../lib/agencySites.js';

test('siteOf tells own sites from networks, socials and directories', () => {
  assert.equal(siteOf('https://www.agentesasociados.com/contacto').kind, 'own');
  assert.equal(siteOf('https://www.agentesasociados.com/contacto').home, 'https://agentesasociados.com/');
  assert.equal(siteOf('https://www.remax.com.ve/nuestras-oficinas').kind, 'network');
  assert.equal(siteOf('https://c21.com.bo/directorio#x').label, 'Century 21');
  assert.equal(siteOf('https://www.facebook.com/AltaCasa/').kind, 'social');
  assert.equal(siteOf('https://exa.ai/search?q=x').kind, 'directory');
  assert.equal(siteOf('https://www.infocasas.com.py/inmobiliarias/x').kind, 'directory');
  assert.equal(siteOf('nope').kind, 'none');
});

test('agents join their agency by website, then by agency name; independents are counted apart', () => {
  const rows = [
    { id: 1, name: '212Realtors', category: 'agency', source: 'wasi', source_url: 'https://212realtors.inmo.co/main-contactenos.htm', whatsapp: '+58 412 1111111' },
    { id: 2, name: 'Mireya', legal_name: '212Realtors', category: 'agent', source: 'wasi', source_url: 'https://212realtors.inmo.co/asesores' },
    { id: 3, name: 'RE/MAX Habitat', category: 'agency', source: 'grok', source_url: 'https://www.remax.com.ve/oficina/habitat' },
    { id: 4, name: 'Ana', legal_name: 'RE/MAX Habitat', category: 'agent', source: 'wasi', source_url: 'https://remaxhabitat.com/asesores' },
    { id: 5, name: 'Solo Agent', category: 'agent', source: 'grok', source_url: 'https://exa.ai/search' },
  ];
  const { agencies, independent } = groupAgencies(rows);
  assert.equal(independent, 1);
  assert.equal(agencies.length, 2);
  const r = agencies.find((a) => a.host === '212realtors.inmo.co');
  assert.equal(r.name, '212Realtors'); assert.equal(r.agents, 1); assert.equal(r.leads, 2);
  const h = agencies.find((a) => a.host === 'remaxhabitat.com');
  assert.equal(h.name, 'RE/MAX Habitat'); assert.equal(h.network, 'RE/MAX'); assert.deepEqual(h.sources.sort(), ['grok', 'wasi']);
});

test('on Casa-Libre: phone, email, company email domain; free mail domains ignored', () => {
  const agencies = [
    { host: 'a.com', phones: ['+595 981 123456'], emails: [] },
    { host: 'b.com', phones: [], emails: ['info@b.com'] },
    { host: 'c.com', phones: [], emails: [] },
    { host: 'gmail.com', phones: [], emails: [] },
  ];
  matchCasaLibre(agencies, { users: [{ phone: '0981123456' }, { email: 'info@b.com' }, { email: 'ventas@c.com' }, { email: 'x@gmail.com' }], listings: [{ contact_phone: '+595981123456' }] });
  assert.deepEqual(agencies[0].onCasaLibre, { accounts: 1, listings: 1, via: 'phone' });
  assert.equal(agencies[1].onCasaLibre.via, 'email');
  assert.equal(agencies[2].onCasaLibre.via, 'domain');
  assert.equal(agencies[3].onCasaLibre.accounts, 0);
});

test('listing links are counted once, same site only', () => {
  const html = `<a href="/casa-venta-luque/123456">x</a><a href="/casa-venta-luque/123456/">dup</a>
    <a href="https://x.com/departamento-en-alquiler-centro-asuncion-dos-dormitorios">slug</a>
    <a href="https://other.com/casa/999999">other site</a><a href="/contacto">c</a><a href="/propiedades">all</a>`;
  assert.equal(countListingLinks(html, 'https://x.com/'), 2);
  assert.equal(findListingsPage(html, 'https://x.com/'), 'https://x.com/propiedades');
});
