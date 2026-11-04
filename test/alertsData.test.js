// lib/alertsData.js wired to fakes: no Relay, no database, no AI.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const relayCalls = [];
const dbCalls = [];
let automationsRow = null;
const NOW = Date.now();
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const CHATS = [
  { phone: '+595981111111', name: 'Canell', tags: ['needs-a-person', 'cl-unread', 'site-py'], sites: ['py'], window: { open: true, expires_at: new Date(NOW + 20 * 3600000).toISOString() }, last_message: { id: 'hold' } },
  { phone: '+595984444444', name: 'Sol', tags: ['cartera', 'site-py'], sites: ['py'], window: { open: false }, last_message: { id: 'tap' } },
  { phone: '+595989999999', name: 'Other', tags: ['proyecto', 'site-bo'], sites: ['bo'], last_message: { id: 'x' } },
  { phone: '+595987777777', name: 'Plain', tags: ['site-py'], sites: ['py'], last_message: { id: 'y' } },
];
const MSGS = {
  '595981111111': [{ id: 'in1', direction: 'inbound', text: '¿Cuánto cuesta?', timestamps: { created: at(4) } }, { id: 'hold', direction: 'outbound', sent_by: 'api', timestamps: { created: at(3.99) } }],
  '595984444444': [{ id: 'tap', direction: 'inbound', type: 'button', button: { text: 'CARTERA' }, timestamps: { created: at(30) } }],
};

vi.mock('../lib/relayInbox', () => ({
  inboxMode: () => 'test',
  phoneParam: (p) => String(p).replace(/\D/g, ''),
  relay: async (mode, path, opts = {}) => {
    relayCalls.push({ mode, path, method: opts.method || 'GET', json: opts.json });
    const m = path.match(/^\/conversations\/(\d+)\/messages/);
    if (m) return { ok: true, status: 200, data: { data: MSGS[m[1]] || [] } };
    return { ok: true, status: 200, data: {} };
  },
}));
vi.mock('../lib/inboxData', () => ({ conversationsWithCountry: async () => CHATS, forgetConversations: () => {} }));
vi.mock('../lib/issueTranslate', () => ({ toEnglishMany: async (texts) => new Map(texts.filter(Boolean).map((t) => [t, t === '¿Cuánto cuesta?' ? 'How much is it?' : t])) }));
vi.mock('../lib/db', () => ({
  dbFor: () => ({
    select: async (table, q) => {
      dbCalls.push({ op: 'select', table, q });
      if (table === 'email_log') return [{ to_phone: '+595981111111', subject: 'price', created_at: at(3.99), error: JSON.stringify({ inbound_id: 'in1', question: '¿Cuánto cuesta?', note: 'Bulk price', holding: 'Alguien te va a responder.', draft: 'Hola', english: 'Hi' }) }];
      if (table === 'users') return [{ full_name: 'Daniel Pérez', email: 'd@x.com', phone: '0981 111 111' }];
      if (table === 'automations') return automationsRow ? [automationsRow] : [];
      return [];
    },
    update: async (table, q, p) => { dbCalls.push({ op: 'update', table, p }); automationsRow = { id: 'alerts_state', ...p }; },
    insert: async (table, rows) => { dbCalls.push({ op: 'insert', table, rows }); automationsRow = rows[0]; },
  }),
}));

const { openAlertCount, alertsForPage, markHandled, forgetAlerts } = await import('../lib/alertsData');

beforeEach(() => { relayCalls.length = 0; dbCalls.length = 0; forgetAlerts('py'); });

describe('alertsData (fakes)', () => {
  it('counts the open alerts of the country; messages only for the tagged chats of that country', async () => {
    expect(await openAlertCount('py')).toBe(2);
    const fetched = relayCalls.filter((c) => c.path.includes('/messages')).map((c) => c.path);
    expect(fetched.sort()).toEqual(['/conversations/595981111111/messages?limit=50', '/conversations/595984444444/messages?limit=50']);
    expect(relayCalls.every((c) => c.mode === 'test')).toBe(true);
  });

  it('the page gets names and English', async () => {
    const d = await alertsForPage('py');
    const p = d.alerts.find((a) => a.type === 'person');
    expect(p).toMatchObject({ name: 'Daniel Pérez', wroteEn: ['How much is it?'], reason: 'Bulk price', status: 'open' });
    expect(d.mode).toBe('test');
  });

  it('Mark handled removes the tag in Relay and saves who', async () => {
    const d = await alertsForPage('py');
    const c = d.alerts.find((a) => a.type === 'cartera');
    const r = await markHandled('py', c.id, 'Omar');
    expect(r.ok).toBe(true);
    expect(relayCalls.find((x) => x.method === 'PATCH')).toMatchObject({ path: '/conversations/595984444444', json: { remove_tags: ['cartera'] } });
    const saved = automationsRow.free_tiers[0].alerts[c.id];
    expect(saved).toMatchObject({ state: 'handled', by: 'Omar' });
    expect(saved.snapshot.name).toBe('Sol');
    expect(await openAlertCount('py')).toBe(1);
    expect((await markHandled('py', c.id, 'Omar')).ok).toBe(false);   // already closed
  });
});
