import { describe, it, expect } from 'vitest';
import { matchSignins, phoneKey8 } from '../lib/waSignins.js';

const SENT = '2026-11-01T15:00:00Z';
const camp = { id: 'c1', slug: 'wc-agents-batch-3-image-40bg', sent_at: SENT };
const u = (o) => ({ id: 'u', full_name: 'X', email: null, phone: null, created_at: '2026-10-01T00:00:00Z', last_login_at: null, phone_verified_at: null, attribution: null, ...o });

describe('matchSignins', () => {
  it('a new account from the batch link counts, as new', () => {
    const m = matchSignins({ campaigns: [camp], users: [u({ id: 'a', created_at: '2026-11-01T16:27:14Z', attribution: { campaign: camp.slug } })] });
    expect(m.get('c1')).toMatchObject([{ user_id: 'a', new_account: true, how: ['link'] }]);
  });
  it('the WhatsApp number the batch went to: counts only if active after the send', () => {
    const recipients = [{ run_id: 'c1', phone: '+595 971 823 000' }, { run_id: 'c1', phone: '+595981000111' }];
    const users = [
      u({ id: 'b', phone: '0971823000', last_login_at: '2026-11-02T10:00:00Z' }),   // existing, signed in after
      u({ id: 'c', phone: '+595981000111', last_login_at: '2026-10-20T10:00:00Z' }), // only before → no
    ];
    const m = matchSignins({ campaigns: [camp], recipients, users });
    expect(m.get('c1').map((x) => [x.user_id, x.new_account, x.how])).toEqual([['b', false, ['phone']]]);
  });
  it('came from the link signed in (PostHog email), one row per person with every reason', () => {
    const users = [u({ id: 'd', email: 'Ana@x.com', phone: '+595971111222', created_at: '2026-11-01T15:30:00Z', attribution: JSON.stringify({ campaign: camp.slug }) })];
    const m = matchSignins({ campaigns: [camp], recipients: [{ run_id: 'c1', phone: '+595971111222' }], users, landed: [{ slug: camp.slug, email: 'ana@x.com', at: '2026-11-01T15:20:00Z' }] });
    const [row] = m.get('c1');
    expect(row.how.sort()).toEqual(['link', 'phone', 'visit']);
    expect(row.at).toBe('2026-11-01T15:20:00.000Z');
    expect(m.get('c1')).toHaveLength(1);
  });
  it('another batch\'s link or a visit before the send does not count', () => {
    const users = [u({ id: 'e', email: 'e@x.com', attribution: { campaign: 'wc-other' }, created_at: '2026-11-01T16:00:00Z' })];
    const m = matchSignins({ campaigns: [camp], users, landed: [{ slug: camp.slug, email: 'e@x.com', at: '2026-10-31T00:00:00Z' }] });
    expect(m.get('c1')).toEqual([]);
  });
  it('phoneKey8', () => { expect(phoneKey8('+595 (971) 823-000')).toBe('71823000'); });
});

describe('formula SÍ links: the person code (utm_term) ties visits and sign-ups to the batch', () => {
  const camp = { id: 'c9', slug: 'wc-agentes-1-ab12', sent_at: '2026-11-03T10:00:00Z' };
  const recipients = [{ run_id: 'c9', phone: '+595981111111', ref: '1f0y4oh' }];
  it('a sign-up whose attribution carries the code counts, as a new account from the link', () => {
    const users = [{ id: 'u1', email: 'a@x.com', created_at: '2026-11-03T11:00:00Z', attribution: { campaign: 'agentes_lanzamiento', term: '1f0y4oh' } }];
    expect(matchSignins({ campaigns: [camp], recipients, users }).get('c9')).toMatchObject([{ user_id: 'u1', new_account: true, how: ['link'] }]);
  });
  it('a visit with the code, signed in, counts too; another code does not', () => {
    const users = [{ id: 'u2', email: 'b@x.com', created_at: '2026-10-01T00:00:00Z' }];
    const landed = [{ slug: '', ref: '1f0y4oh', email: 'b@x.com', at: '2026-11-03T12:00:00Z' }, { slug: '', ref: 'zzzzzzz', email: 'b@x.com', at: '2026-11-03T12:00:00Z' }];
    expect(matchSignins({ campaigns: [camp], recipients, users, landed }).get('c9')).toMatchObject([{ user_id: 'u2', new_account: false, how: ['visit'] }]);
    expect(matchSignins({ campaigns: [camp], recipients, users, landed: [landed[1]] }).get('c9')).toEqual([]);
  });
});
