import { describe, it, expect } from 'vitest';
import { matchesUser, searchTerms, digitVariants } from '../lib/userSearch.js';

const omar = { full_name: 'Omar Faiz', email: 'omar@airosofts.com', phone: '+923362771289' };
const maria = { full_name: 'María Benítez', email: 'maria.benitez.cl@gmail.com', phone: null };
const seller = { full_name: 'Ana', email: 'ana@example.com', phone: '+595981555010' };
const m = (u, q, o) => matchesUser(u, q, { prefix: '595', ...o });

describe('Users search', () => {
  it('names: any part, any case, accents and word order ignored', () => {
    expect(m(omar, 'Omar')).toBe(true);
    expect(m(omar, 'om')).toBe(true);
    expect(m(omar, 'OMAR FAIZ')).toBe(true);
    expect(m(omar, 'faiz omar')).toBe(true);
    expect(m(omar, 'fai')).toBe(true);
    expect(m(maria, 'maria')).toBe(true);           // María
    expect(m(maria, 'benitez')).toBe(true);         // Benítez
    expect(m(maria, 'Beni Mar')).toBe(true);
    expect(m(omar, 'maria')).toBe(false);
    expect(m(omar, 'omar maria')).toBe(false);       // every word must match
  });
  it('emails: any part', () => {
    expect(m(omar, 'airosofts')).toBe(true);
    expect(m(omar, 'omar@air')).toBe(true);
    expect(m(maria, 'gmail.com')).toBe(true);
    expect(m(maria, '.cl@')).toBe(true);
  });
  it('phones: any 3+ digits, however typed', () => {
    expect(m(omar, '9233')).toBe(true);
    expect(m(omar, '+92336')).toBe(true);
    expect(m(omar, '+92 336 277')).toBe(true);
    expect(m(omar, '1289')).toBe(true);
    expect(m(seller, '0981 555')).toBe(true);        // local format with the leading 0
    expect(m(seller, '+595 981 555 010')).toBe(true);
    expect(m(seller, '981-555-010')).toBe(true);
    expect(m(seller, '555')).toBe(true);
    expect(m(seller, '12')).toBe(false);             // too short to mean anything
    expect(m(seller, '0971')).toBe(false);
  });
  it('a phone only on their listing', () => {
    expect(m(maria, '0981 777', { phones: ['0981 777 123'] })).toBe(true);
    expect(m(maria, '0981 777')).toBe(false);
  });
  it('empty search matches everyone; helpers', () => {
    expect(m(omar, '   ')).toBe(true);
    expect(searchTerms('0981 555 010')).toEqual(['0981 555 010']);
    expect(searchTerms('María  Benítez')).toEqual(['maria', 'benitez']);
    expect(digitVariants('+595 981 555', '595')).toEqual(['595981555', '981555']);
    expect(digitVariants('0981 555', '595')).toEqual(['0981555', '981555']);
  });
});
