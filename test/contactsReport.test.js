import { describe, it, expect } from 'vitest';
import { clickSql, applyClicks, openState, contactStats, fillSellers, clRef } from '../lib/contactsReport.js';

const rows = [
  { id: 1, token: 'AbC1234', channel: 'whatsapp', listing_ref: 'CL-BA79DC', buyer_email: null, buyer_name: null, status: 'sent', created_at: '2026-10-04T10:00:00Z' },
  { id: 2, token: 'Zz9yy88', channel: 'whatsapp', listing_ref: 'CL-670683', buyer_email: 'ana@gmail.com', buyer_name: 'Ana', status: 'opened', opened_at: '2026-10-04T12:00:00Z', created_at: '2026-10-04T11:00:00Z' },
  { id: 3, token: 'Old0001', channel: 'whatsapp', listing_ref: 'CL-054EDA', buyer_email: null, status: 'sent', created_at: '2026-09-01T10:00:00Z' },
  { id: 4, token: 'Qq11Ww2', channel: 'call', listing_ref: 'CL-670683', buyer_email: null, status: 'sent', created_at: '2026-10-02T10:00:00Z' },
];

describe('the PostHog click behind each contact: who and where', () => {
  it('asks PostHog for every contact click around the contacts (signed in or not)', () => {
    const sql = clickSql(rows);
    expect(sql).toContain("event IN ('contact_whatsapp_click', 'contact_call_click', 'contact_copy_click')");
    expect(sql).toContain('properties.$ip');
    expect(sql).toContain('properties.$geoip_country_name');
    expect(sql).not.toContain("person.properties.email, '') != ''");
    expect(sql).toContain("timestamp >= toDateTime('2026-09-01 09:00:00')");
    expect(sql).toContain("timestamp <= toDateTime('2026-10-04 12:00:00')");
    expect(clickSql([])).toBe(null);
  });

  // PostHog rows: [timestamp, event, contact_token, ref, email, first, last, ip, country, city]
  const events = [
    // exact: the click carries the contact's own code
    ['2026-10-04T10:00:03Z', 'contact_whatsapp_click', 'AbC1234', 'CL-BA79DC', 'luis@gmail.com', 'Luis', 'Pérez', '181.1.2.3', 'Paraguay', 'Asunción'],
    // the signed-in buyer's own click: only adds where they were
    ['2026-10-04T11:00:02Z', 'contact_whatsapp_click', '', 'CL-670683', 'ana@gmail.com', 'Ana', '', '181.9.9.9', 'Paraguay', 'Luque'],
    // older click with no code: same listing, same button, 20 s apart → that buyer
    ['2026-09-01T10:00:20Z', 'contact_whatsapp_click', '', 'CL-054EDA', '', '', '', '39.40.1.1', 'Pakistan', 'Lahore'],
    // same listing but a WhatsApp click, and the row is a call → no match
    ['2026-10-02T10:00:05Z', 'contact_whatsapp_click', '', 'CL-670683', 'zed@gmail.com', 'Zed', '', '1.1.1.1', 'Argentina', ''],
  ];
  const out = applyClicks(rows, events);

  it('matches on the contact code when the click has it: buyer + IP + location', () => {
    expect(out[0]).toMatchObject({ buyer_email: 'luis@gmail.com', buyer_name: 'Luis Pérez', buyer_signed_up_later: true, buyer_ip: '181.1.2.3', buyer_country: 'Paraguay', buyer_city: 'Asunción' });
  });
  it('known buyers keep their name and get where they were', () => {
    expect(out[1]).toMatchObject({ buyer_email: 'ana@gmail.com', buyer_ip: '181.9.9.9', buyer_city: 'Luque' });
    expect(out[1].buyer_signed_up_later).toBeUndefined();
  });
  it('otherwise same listing + same button within a minute; anonymous clicks still give the location', () => {
    expect(out[2]).toMatchObject({ buyer_email: null, buyer_ip: '39.40.1.1', buyer_country: 'Pakistan' });
    expect(out[3]).toMatchObject({ buyer_email: null, buyer_ip: null, buyer_country: null });
  });
  it('a location the website saved on the contact wins over PostHog', () => {
    const saved = applyClicks([{ ...rows[0], buyer_ip: '200.1.1.1', buyer_country: 'PY', buyer_city: null }], events);
    expect(saved[0]).toMatchObject({ buyer_ip: '200.1.1.1', buyer_country: 'PY', buyer_city: 'Asunción' });
  });
  it('more than a minute apart is not the same contact', () => {
    const far = applyClicks([rows[2]], [['2026-09-01T10:02:00Z', 'contact_whatsapp_click', '', 'CL-054EDA', 'eva@gmail.com', 'Eva', '', '1.2.3.4', 'Chile', '']]);
    expect(far[0]).toMatchObject({ buyer_email: null, buyer_ip: null });
  });
});

describe('opened by seller', () => {
  const broken = { from: '2026-09-14T00:00:00Z', until: null };
  it('opened, not opened, or not trackable (sent while the link had no code)', () => {
    expect(openState(rows[1], broken)).toBe('opened');
    expect(openState(rows[0], broken)).toBe('untracked');
    expect(openState(rows[2], broken)).toBe('not_opened');
    expect(openState(rows[0], { from: '2026-09-14T00:00:00Z', until: '2026-10-03T00:00:00Z' })).toBe('not_opened');
    expect(openState(rows[0], null)).toBe('not_opened');
  });
  it('stats: WhatsApp contacts, opens, rate over trackable ones only, other channels counted', () => {
    expect(contactStats(rows, broken)).toEqual({ whatsapp: 3, opened: 1, trackable: 2, rate: 50, untracked: 1, calls: 1, copies: 0 });
  });
});

describe('seller details filled in from the listing', () => {
  const props = [
    { id: 'b9ca78f0-1111-4222-8333-444455556666', contact_name: 'Coldwell Banker Blue', contact_phone: '+595 987 224993', created_by: null },
    { id: '7793dc53-1111-4222-8333-444455556666', contact_name: 'Ana Gómez', contact_phone: '0981 123456', created_by: 'u1' },
  ];
  const users = [{ id: 'u1', email: 'ana@gmail.com', full_name: 'Ana Gómez' }];
  const contacts = [
    // from the mobile app: only the listing id
    { id: 'a', property_id: 'b9ca78f0-1111-4222-8333-444455556666', seller_name: null, seller_phone: null, listing_ref: null },
    // published by a Casa Libre user: their account email too
    { id: 'b', property_id: '7793dc53-1111-4222-8333-444455556666', seller_name: null, seller_phone: '595981123456', listing_ref: 'CL-7793DC' },
    // listing gone
    { id: 'c', property_id: 'deadbeef-0000-4000-8000-000000000000', seller_name: 'X', seller_phone: null, listing_ref: null },
  ];
  const out = fillSellers(contacts, props, users);

  it('agency listing: name + phone from the listing, no email (no Casa Libre account)', () => {
    expect(out[0]).toMatchObject({ seller_name: 'Coldwell Banker Blue', seller_phone: '595987224993', seller_email: null, seller_kind: 'agency', listing_ref: 'CL-B9CA78' });
  });
  it('listing published by a user: their account email', () => {
    expect(out[1]).toMatchObject({ seller_name: 'Ana Gómez', seller_phone: '595981123456', seller_email: 'ana@gmail.com', seller_kind: 'user', listing_ref: 'CL-7793DC' });
  });
  it('keeps what the contact saved when the listing is gone', () => {
    expect(out[2]).toMatchObject({ seller_name: 'X', seller_email: null, seller_kind: null, listing_ref: 'CL-DEADBE' });
  });
  it('the listing ref is built like the website (CL- + first 6 of the id)', () => {
    expect(clRef('b9ca78f0-1111')).toBe('CL-B9CA78');
    expect(clRef(null)).toBe(null);
  });
});
