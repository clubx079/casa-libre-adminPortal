import { describe, it, expect } from 'vitest';
import { pickAdvice, adviceEmail, qualifies, contactsText, listingOfKey, ADVICE, ADVICE_WA, adviceWaApproved, adviceWhatsApp, adviceChannel } from '../lib/manager/viewsAdvice';
import { WA_TEMPLATES } from '../lib/whatsappTemplates';

const NOW = Date.parse('2026-11-04T15:00:00Z');
const old = '2026-10-01T00:00:00Z';
const L = (id, over = {}) => ({ id, created_by: 'u1', created_at: old, status: 'published', admin_status: 'active', property_type: 'Departamento', city: 'Asunción', ...over });
const users = new Map([['u1', { id: 'u1', email: 'tato@x.com', full_name: 'Tato Colman' }], ['u2', { id: 'u2', email: 'b@x.com', suspended: true }], ['u3', { id: 'u3', email: 'omar@airosofts.com' }]]);

describe('Admin Manager — views but no contacts', () => {
  it('picks live listings with 20+ views in 14 days and (almost) no contacts, not advised in 30 days', () => {
    const listings = [L('a'), L('b'), L('c'), L('d', { created_at: '2026-11-03T00:00:00Z' }), L('e', { status: 'payment_pending' }), L('f', { created_by: 'u2' }), L('g', { created_by: 'u3' }), L('h'), L('i')];
    const views = new Map([['a', 23], ['b', 30], ['c', 12], ['d', 50], ['e', 50], ['f', 50], ['g', 50], ['h', 100], ['i', 40]]);
    const contacts = new Map([['b', 2], ['h', 1]]);   // b 6.7 % → out; h 1 % → in
    const r = pickAdvice({ listings, views, contacts, users, recentlyAdvised: new Set(['i']), now: NOW, isInternal: (e) => /airosofts/.test(e) });
    expect(r.map((x) => x.listing.id)).toEqual(['h', 'a']);   // most views first
  });
  it('the rule and the wording', () => {
    expect(qualifies(20, 0)).toBe(true);
    expect(qualifies(19, 0)).toBe(false);
    expect(qualifies(40, 1)).toBe(false);
    expect(contactsText(0)).toBe('todavía ningún comprador te escribió');
    expect(listingOfKey('mviews:abc:2026-11-04')).toBe('abc');
    expect(ADVICE.repeatDays).toBe(30);
  });
  it('the email: Roland\'s advice, the numbers, a link to My listings, Casa-Libre, no emojis', () => {
    const m = adviceEmail({ user: users.get('u1'), listing: L('a'), views: 23, contacts: 0, site: 'https://casa-libre.com.py' });
    expect(m.subject).toBe('Tato, tu propiedad tuvo 23 visitas');
    expect(m.text).toMatch(/Departamento en Asunción tuvo 23 visitas en Casa-Libre en los últimos 14 días, pero todavía ningún comprador te escribió\./);
    expect(m.text).toMatch(/precio o por las fotos/);
    expect(m.html).toContain('<a href="https://casa-libre.com.py/cuenta/publicaciones">Editar publicación</a>');
    expect(`${m.subject} ${m.text}`).not.toMatch(/Casa Libre|\p{Extended_Pictographic}/u);
  });

  describe('WhatsApp first (cl_visitas_sin_contacto)', () => {
    const tato = { ...users.get('u1'), phone: '0981 123 456' };
    const pick = { user: tato, listing: L('a'), views: 23, contacts: 0 };
    it('the template is in the registry with the 5 body variables', () => {
      expect(WA_TEMPLATES[ADVICE_WA]).toEqual({ category: 'utility', body: ['name', 'property_title', 'views', 'days', 'contacts_text'] });
    });
    it('approved only when Relay says APPROVED (es_MX)', () => {
      expect(adviceWaApproved([{ name: ADVICE_WA, language: 'es_MX', status: 'APPROVED' }])).toBe(true);
      expect(adviceWaApproved([{ name: ADVICE_WA, language: 'es_MX', status: 'PENDING' }])).toBe(false);
      expect(adviceWaApproved([{ name: ADVICE_WA, language: 'en_US', status: 'APPROVED' }])).toBe(false);
      expect(adviceWaApproved([{ name: 'cl_visitas', status: 'APPROVED' }])).toBe(false);
      expect(adviceWaApproved()).toBe(false);
    });
    it('the variables are the email\'s words', () => {
      expect(adviceWhatsApp(pick)).toEqual({ body: ['Tato', 'Departamento en Asunción', '23', '14', 'todavía ningún comprador te escribió'] });
      expect(adviceWhatsApp({ ...pick, contacts: 1 }).body[4]).toBe('solo 1 comprador te escribió');
    });
    it('WhatsApp when approved + PY + a number; email otherwise', () => {
      expect(adviceChannel({ ...pick, country: 'py', approved: true })).toEqual({ channel: 'whatsapp', to: '+595981123456', variables: adviceWhatsApp(pick) });
      expect(adviceChannel({ ...pick, country: 'py', approved: false })).toEqual({ channel: 'email' });   // not approved yet
      expect(adviceChannel({ ...pick, country: 'bo', approved: true })).toEqual({ channel: 'email' });    // not a WhatsApp country
      expect(adviceChannel({ ...pick, user: { ...tato, phone: null }, country: 'py', approved: true })).toEqual({ channel: 'email' });
      expect(adviceChannel({ ...pick, user: { ...tato, whatsapp_opted_out_at: '2026-10-30T00:00:00Z' }, country: 'py', approved: true })).toEqual({ channel: 'email' });
      expect(adviceChannel({ ...pick, user: { ...tato, full_name: '' }, country: 'py', approved: true })).toEqual({ channel: 'email' });   // no name for {{1}}
    });
    it('a test number replaces the seller\'s', () => {
      expect(adviceChannel({ ...pick, country: 'py', approved: true, testTo: '+923362771289' }).to).toBe('+923362771289');
    });
  });
});
