import { describe, it, expect } from 'vitest';
import { toLeadRow, waDigits, hasContact, filterLeads, LEAD_STATUSES, leadsCsv } from '../lib/potentialLeads.js';

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

describe('leads CSV (one column per way to reach them)', () => {
  const rows = [
    { name: 'Ana "La" Pérez', legal_name: 'C21, Asunción', category: 'agent', phone: '0981 123 456', whatsapp: '+595981123456', email: ' Ana@C21.com.py ', location: 'Asunción', source: 'ubicaprop', source_url: 'https://ubicaprop.com.py/a' },
    { name: 'Dev SA', category: 'developer', source: 'holacasa', source_url: 'https://holacasa.com.py/d' },
  ];
  it('has a header, phone / WhatsApp / email in their own columns, international numbers', () => {
    const lines = leadsCsv(rows).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('"Name","Agency / company","Type","Phone","WhatsApp","WhatsApp link","Email","Location","Source","Source page"');
    expect(lines[1]).toBe('"Ana ""La"" Pérez","C21, Asunción","Agent","+595981123456","+595981123456","https://wa.me/595981123456","ana@c21.com.py","Asunción","Ubicaprop","https://ubicaprop.com.py/a"');
    expect(lines[2]).toBe('"Dev SA","","Developer","","","","","","HolaCasa","https://holacasa.com.py/d"');
  });
  it('starts with a BOM so Excel reads accents', () => {
    expect(leadsCsv(rows).charCodeAt(0)).toBe(0xFEFF);
  });
  it('filters: has WhatsApp / has email', () => {
    expect(filterLeads(rows, { contact: 'whatsapp' }).map((r) => r.name)).toEqual(['Ana "La" Pérez']);
    expect(filterLeads(rows, { contact: 'email' }).map((r) => r.name)).toEqual(['Ana "La" Pérez']);
  });
});
