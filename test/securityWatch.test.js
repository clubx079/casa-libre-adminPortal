import { describe, it, expect } from 'vitest';
import { blockedCountries, africanPhone, flaggedIps, toSuspend, SUSPENDED_EMAIL } from '../lib/securityWatch';

describe('security watch', () => {
  const blocked = blockedCountries(undefined);
  it('the region list (kept identical to the website\'s lib/geoBlock.js: 58 codes)', () => {
    expect(blocked.size).toBe(58);
    for (const c of ['NG', 'UG', 'AO', 'CF', 'ZA', 'EG']) expect(blocked.has(c)).toBe(true);
    expect(blocked.has('BR') || blocked.has('PY')).toBe(false);
    expect(blockedCountries('off').size).toBe(0);
  });
  it('African phone numbers', () => {
    for (const p of ['+234 803 123 4567', '+256712345678', '+27821234567', '+20 100 123 4567', '+244923123456']) expect(africanPhone(p), p).toBe(true);
    for (const p of ['+595981123456', '+5491123456789', '+12025550123', '+923362771289', '+2975551234']) expect(africanPhone(p), p).toBe(false);
  });
  it('flags IPs from a blocked country, or with scraper-like volume from abroad', () => {
    const m = flaggedIps([
      { ip: '1.1.1.1', country: 'NG', countryName: 'Nigeria', events: 25 },
      { ip: '2.2.2.2', country: 'BR', countryName: 'Brazil', events: 900 },
      { ip: '3.3.3.3', country: 'PY', countryName: 'Paraguay', events: 2000 },   // home country: a busy real user
      { ip: '4.4.4.4', country: 'AR', countryName: 'Argentina', events: 120 },
      { ip: '?', country: 'NG', events: 9999 },
    ], { blocked, homeCountry: 'PY' });
    expect([...m.keys()]).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(m.get('1.1.1.1').reason).toMatch(/Nigeria \(blocked region\)/);
    expect(m.get('2.2.2.2').reason).toMatch(/900 events in 24 h from Brazil/);
  });
  it('suspends new accounts on a flagged IP or with an African number — never the team, the already suspended or a lifted one', () => {
    const ips = new Map([['1.1.1.1', { reason: 'Visited from Nigeria (blocked region)', ipCountry: 'Nigeria' }]]);
    const users = [
      { id: 'a', registration_ip: '1.1.1.1', email: 'x@y.com' },
      { id: 'b', phone: '+2348031234567', email: 'b@y.com' },
      { id: 'c', phone: '+595981123456', email: 'c@y.com' },
      { id: 'd', registration_ip: '1.1.1.1', email: 'omar@airosofts.com' },
      { id: 'e', registration_ip: '1.1.1.1', suspended: true },
      { id: 'f', registration_ip: '1.1.1.1' },
    ];
    const r = toSuspend(users, { ips, blocked, already: [{ user_id: 'f', lifted: true }], isInternal: (e) => /airosofts\.com$/.test(String(e || '')) });
    expect(r.map((x) => x.user.id)).toEqual(['a', 'b']);
    expect(r[1].reason).toMatch(/\+234 is from a blocked region/);
    // the region block off → phone numbers are not judged
    expect(toSuspend(users, { ips: new Map(), blocked: blockedCountries('off') })).toEqual([]);
  });
  it('the notice: Spanish, Casa-Libre, a way to appeal, no emojis', () => {
    const t = SUSPENDED_EMAIL.text('Ada Obi');
    expect(t).toMatch(/^Hola Ada,/);
    expect(t).toMatch(/respondé este correo/);
    expect(`${SUSPENDED_EMAIL.subject} ${t}`).not.toMatch(/Casa Libre|\p{Extended_Pictographic}/u);
  });
});
