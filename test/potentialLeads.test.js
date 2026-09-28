import { describe, it, expect } from 'vitest';
import { toLeadRow, waDigits, hasContact, filterLeads, LEAD_STATUSES } from '../lib/potentialLeads.js';

describe('toLeadRow', () => {
  it('maps a scraped HolaCasa row, keeping the source link', () => {
    const r = toLeadRow({ name: '  AGB   Construcciones ', legal_name: '', phone: '+595 21 201 791', whatsapp: '', location: '', profile_url: 'https://holacasa.com.py/agency/agb-construcciones/' }, { source: 'holacasa' });
    expect(r).toEqual({
      name: 'AGB Construcciones', legal_name: null, category: 'developer', phone: '+595 21 201 791', whatsapp: null, email: null, location: null,
      source: 'holacasa', source_url: 'https://holacasa.com.py/agency/agb-construcciones/',
    });
  });
  it('rejects rows without a name or a real source url', () => {
    expect(toLeadRow({ name: '', profile_url: 'https://x.com' }, { source: 'holacasa' })).toBeNull();
    expect(toLeadRow({ name: 'A', profile_url: 'javascript:alert(1)' }, { source: 'holacasa' })).toBeNull();
    expect(toLeadRow({ name: 'A', profile_url: 'https://x.com' }, {})).toBeNull();
  });
  it('unknown categories become other', () => {
    expect(toLeadRow({ name: 'A', profile_url: 'https://x.com' }, { source: 's', category: 'x' }).category).toBe('other');
  });
});

describe('helpers', () => {
  it('waDigits normalises Paraguay numbers for wa.me', () => {
    expect(waDigits('+595 976 584237')).toBe('595976584237');
    expect(waDigits('0981 123 456')).toBe('595981123456');
    expect(waDigits('')).toBe('');
  });
  it('hasContact', () => {
    expect(hasContact({ phone: '1' })).toBe(true);
    expect(hasContact({ name: 'x' })).toBe(false);
  });
  it('statuses match the migration check constraint', () => {
    expect(LEAD_STATUSES).toEqual(['new', 'contacted', 'interested', 'client', 'discarded']);
  });
});

describe('filterLeads', () => {
  const rows = [
    { name: 'Álamo Desarrollos', status: 'new', phone: '0981', location: 'Asunción' },
    { name: 'Bosque Group', status: 'contacted', location: 'Luque' },
    { name: 'Cima', status: 'new', email: 'a@b.c' },
  ];
  it('search ignores accents and case, across name/location/contact', () => {
    expect(filterLeads(rows, { q: 'alamo' }).map((r) => r.name)).toEqual(['Álamo Desarrollos']);
    expect(filterLeads(rows, { q: 'LUQUE' }).map((r) => r.name)).toEqual(['Bosque Group']);
  });
  it('status and contact filters', () => {
    expect(filterLeads(rows, { status: 'new' }).length).toBe(2);
    expect(filterLeads(rows, { contact: 'with' }).map((r) => r.name)).toEqual(['Álamo Desarrollos', 'Cima']);
    expect(filterLeads(rows, { contact: 'without' }).map((r) => r.name)).toEqual(['Bosque Group']);
  });
});
