import { describe, it, expect } from 'vitest';
import { blockedCountries, africanPhone, flaggedIps, toSuspend, SUSPENDED_EMAIL, normSettings, DEFAULT_SETTINGS, ipsToBlock, activeBlocks, allowedIps, validIp } from '../lib/securityWatch';

describe('security watch: the IP detector (Nov 6 2026: no country blocked, only suspicious IPs)', () => {
  it('no country is blocked unless GEO_BLOCK says so; "africa" still expands to the 58 codes', () => {
    expect(blockedCountries(undefined).size).toBe(0);
    expect(blockedCountries('off').size).toBe(0);
    const af = blockedCountries('africa');
    expect(af.size).toBe(58);
    for (const c of ['NG', 'UG', 'AO', 'CF', 'ZA', 'EG']) expect(af.has(c)).toBe(true);
    expect(af.has('BR') || af.has('PY')).toBe(false);
  });
  it('African phone numbers (only judged while Africa is blocked)', () => {
    for (const p of ['+234 803 123 4567', '+256712345678', '+27821234567', '+20 100 123 4567', '+244923123456']) expect(africanPhone(p), p).toBe(true);
    for (const p of ['+595981123456', '+5491123456789', '+12025550123', '+923362771289', '+2975551234']) expect(africanPhone(p), p).toBe(false);
  });
  it('flags one machine over the limit: abroad 500, home 2,000; never a shared network, an allowed IP or a visitor from Africa by itself', () => {
    const m = flaggedIps([
      { ip: '1.1.1.1', country: 'NG', countryName: 'Nigeria', events: 25, visitors: 1 },        // Africa, a normal visitor → fine now
      { ip: '2.2.2.2', country: 'BR', countryName: 'Brazil', events: 900, visitors: 1 },        // scraper abroad
      { ip: '3.3.3.3', country: 'PY', countryName: 'Paraguay', events: 1500, visitors: 1 },     // home, under 2,000
      { ip: '5.5.5.5', country: 'PY', countryName: 'Paraguay', events: 2500, visitors: 2 },     // home, over, one machine
      { ip: '6.6.6.6', country: 'PY', countryName: 'Paraguay', events: 3000, visitors: 80 },    // a phone network: many people
      { ip: '7.7.7.7', country: 'NG', countryName: 'Nigeria', events: 700, visitors: 1 },       // Africa over the limit → by volume
      { ip: '8.8.8.8', country: 'US', countryName: 'United States', events: 5000, visitors: 1 }, // admin allowed it
      { ip: '?', country: 'NG', events: 9999 },
    ], { homeCountry: 'PY', minEvents: 500, homeMinEvents: 2000, allowed: new Set(['8.8.8.8']) });
    expect([...m.keys()]).toEqual(['2.2.2.2', '5.5.5.5', '7.7.7.7']);
    expect(m.get('2.2.2.2').reason).toMatch(/900 events in 24 h from Brazil — over the 500 limit/);
    expect(m.get('5.5.5.5').reason).toMatch(/2,500 events in 24 h from Paraguay \(2 visitors\) — over the 2,000 limit/);
  });
  it('the old region rule still works when GEO_BLOCK is set', () => {
    const m = flaggedIps([{ ip: '1.1.1.1', country: 'NG', countryName: 'Nigeria', events: 25 }], { blocked: blockedCountries('africa'), homeCountry: 'PY' });
    expect(m.get('1.1.1.1').reason).toMatch(/Nigeria \(blocked region\)/);
  });
  it('limits: sane numbers only, defaults otherwise', () => {
    expect(normSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normSettings({ abroadEvents: '800', homeEvents: 3000, blockDays: 7 })).toEqual({ abroadEvents: 800, homeEvents: 3000, blockDays: 7 });
    expect(normSettings({ abroadEvents: -1, homeEvents: 'x', blockDays: 9999 })).toEqual(DEFAULT_SETTINGS);
  });
  it('blocks a flagged IP once, for blockDays; an unblocked IP is never blocked again by itself', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const flagged = new Map([['2.2.2.2', { reason: 'r', ipCountry: 'Brazil', events: 900, visitors: 1 }], ['9.9.9.9', { reason: 'r2', events: 600 }], ['4.4.4.4', { reason: 'r3' }]]);
    const list = [
      { ip: '9.9.9.9', at: '2026-11-05T00:00:00Z', until: '2026-12-05T00:00:00Z' },                       // already blocked
      { ip: '4.4.4.4', at: '2026-11-01T00:00:00Z', until: '2026-12-01T00:00:00Z', unblocked: true },      // an admin unblocked it
      { ip: '3.3.3.3', at: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z' },                       // expired
    ];
    const add = ipsToBlock(flagged, list, { now, days: 30 });
    expect(add.map((b) => b.ip)).toEqual(['2.2.2.2']);
    expect(add[0]).toMatchObject({ country: 'Brazil', events: 900, until: '2026-12-06T12:00:00.000Z', by: 'security watch' });
    expect(activeBlocks(list, now).map((b) => b.ip)).toEqual(['9.9.9.9']);
    expect([...allowedIps(list)]).toEqual(['4.4.4.4']);
  });
  it('IP check for the block-by-hand box', () => {
    for (const ip of ['102.89.1.20', '2001:db8::1']) expect(validIp(ip), ip).toBe(true);
    for (const ip of ['', '300.1.1.1', 'abc', '1.2.3']) expect(validIp(ip), ip).toBe(false);
  });
  it('suspends new accounts on a flagged IP — never the team, the already suspended or a lifted one', () => {
    const ips = new Map([['1.1.1.1', { reason: 'One IP fired 900 events', ipCountry: 'Brazil' }]]);
    const users = [
      { id: 'a', registration_ip: '1.1.1.1', email: 'x@y.com' },
      { id: 'b', phone: '+2348031234567', email: 'b@y.com' },           // African number: fine now (no region block)
      { id: 'd', registration_ip: '1.1.1.1', email: 'omar@airosofts.com' },
      { id: 'e', registration_ip: '1.1.1.1', suspended: true },
      { id: 'f', registration_ip: '1.1.1.1' },
    ];
    const r = toSuspend(users, { ips, blocked: blockedCountries(undefined), already: [{ user_id: 'f', lifted: true }], isInternal: (e) => /airosofts\.com$/.test(String(e || '')) });
    expect(r.map((x) => x.user.id)).toEqual(['a']);
  });
  it('the notice: Spanish, Casa-Libre, a way to appeal, no emojis', () => {
    const t = SUSPENDED_EMAIL.text('Ada Obi');
    expect(t).toMatch(/^Hola Ada,/);
    expect(t).toMatch(/respondé este correo/);
    expect(`${SUSPENDED_EMAIL.subject} ${t}`).not.toMatch(/Casa Libre|\p{Extended_Pictographic}/u);
  });
});
