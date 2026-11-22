// Alerts → email: who gets it, seed-on-first-run, once per alert, the email itself, and the run
// against a fake DB + fake sender (no Resend, no Relay).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { alertRecipients, alertsToNotify, alertEmail, readNotifyState, DEFAULT_ALERT_TO } from '../lib/alertNotify.js';

vi.mock('server-only', () => ({}));
vi.mock('../lib/email', () => ({ sendTeamAlertEmail: vi.fn() }));
vi.mock('../lib/issueTranslate', () => ({ toEnglishMany: async (t) => new Map(t.map((x) => [x, `EN ${x}`])) }));
vi.mock('../lib/appUrl', () => ({ appBaseUrl: () => 'https://admin.example.com' }));
vi.mock('../lib/db', () => ({ dbFor: () => null }));

const NOW = Date.parse('2026-11-22T15:00:00Z');
const A = (id, extra = {}) => ({ id, type: 'cartera', tag: 'cartera', label: 'CARTERA — portfolio migration', phone: '+595981111111', digits: '595981111111', name: 'Sol', status: 'open', since: '2026-11-22T14:00:00Z', wrote: ['CARTERA', 'Tenemos 40 propiedades'], reason: 'An agency wants its portfolio migrated.', windowHours: 20, ...extra });

describe('alertRecipients', () => {
  it('env list wins, then the saved list, else omar@', () => {
    expect(alertRecipients('a@x.com, B@x.com;bad', ['c@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    expect(alertRecipients('', ['c@x.com'])).toEqual(['c@x.com']);
    expect(alertRecipients(undefined, null)).toEqual(DEFAULT_ALERT_TO);
    expect(DEFAULT_ALERT_TO).toEqual(['omar@airosofts.com']);
  });
});

describe('alertsToNotify', () => {
  it('first run seeds every current alert and sends nothing', () => {
    const r = alertsToNotify({ alerts: [A('a1'), A('a2', { status: 'answered' })], state: { sent: {} }, now: NOW });
    expect(r.seed).toBe(true);
    expect(r.toSend).toEqual([]);
    expect(r.state.sent).toEqual({ a1: 'seed', a2: 'seed' });
    expect(r.state.seeded_at).toBe(new Date(NOW).toISOString());
  });
  it('afterwards: only open alerts not emailed yet; old marks are forgotten after 30 days', () => {
    const state = { seeded_at: '2026-11-01T00:00:00Z', sent: { a1: 'seed', old: '2026-10-01T00:00:00Z', a3: '2026-11-21T00:00:00Z' } };
    const r = alertsToNotify({ alerts: [A('a1'), A('a2'), A('a3'), A('a4', { status: 'handled' })], state, now: NOW });
    expect(r.seed).toBe(false);
    expect(r.toSend.map((a) => a.id)).toEqual(['a2']);
    expect(r.state.sent.old).toBeUndefined();
    expect(r.state.sent.a1).toBe('seed');
  });
  it('readNotifyState tolerates a missing row', () => {
    expect(readNotifyState(null)).toEqual({ seeded_at: null, sent: {}, to: null });
  });
});

describe('alertEmail', () => {
  it('says what, who, the snippet (+ English) and links to the chat', () => {
    const m = alertEmail(A('a1', { name: 'Sol <b>' }), { adminUrl: 'https://admin.example.com/', countryName: 'Paraguay', wroteEn: ['CARTERA', 'We have 40 properties'] });
    expect(m.subject).toBe('[Alert] CARTERA — portfolio migration: Sol <b> (Paraguay)');
    expect(m.html).toContain('href="https://admin.example.com/inbox?phone=595981111111"');
    expect(m.html).toContain('Sol &lt;b&gt;');
    expect(m.html).toContain('Tenemos 40 propiedades');
    expect(m.html).toContain('EN: We have 40 properties');
    expect(m.text).toContain('Open the chat: https://admin.example.com/inbox?phone=595981111111');
    expect(m.text).toContain('Why: An agency wants its portfolio migrated.');
  });
});

// ── the run, on a fake DB ──
function fakeDb() {
  const tables = { automations: [], email_log: [] };
  let n = 0;
  return {
    tables,
    async select(t, q) { const id = /id=eq\.([^&]+)/.exec(q)?.[1]; return tables[t].filter((r) => !id || r.id === id); },
    async insert(t, rows) {
      for (const r of rows) {
        if (r.dedupe_key && tables[t].some((x) => x.dedupe_key === r.dedupe_key)) { const e = new Error('duplicate'); e.status = 409; throw e; }
        tables[t].push({ id: r.id || `row${++n}`, ...r });
      }
      return rows.map((r, i) => tables[t][tables[t].length - rows.length + i]);
    },
    async update(t, q, patch) { const id = /id=eq\.([^&]+)/.exec(q)?.[1]; for (const r of tables[t]) if (r.id === decodeURIComponent(id)) Object.assign(r, patch); return []; },
    async remove(t, q) { const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(q)?.[1]); tables[t] = tables[t].filter((r) => r.id !== id); },
  };
}

describe('notifyNewAlerts (run)', () => {
  let mod;
  beforeEach(async () => { mod = await import('../lib/alertNotifyRun.js'); delete process.env.ALERT_EMAIL_TO; });
  it('seeds, then emails a new alert once to omar@ only; a failed send is retried next time', async () => {
    const db = fakeDb();
    const sends = [];
    let fail = false;
    const send = async (m) => { if (fail) return { ok: false }; sends.push(m); return { ok: true, id: `re_${sends.length}` }; };
    const r0 = await mod.notifyNewAlerts('py', [A('old')], { db, send, now: NOW });
    expect(r0.seeded).toBe(1);
    expect(sends).toHaveLength(0);
    const dry = await mod.notifyNewAlerts('py', [A('old'), A('new1')], { db, send, now: NOW, dryRun: true });
    expect(dry.due).toEqual(['new1']);
    expect(sends).toHaveLength(0);
    fail = true;
    const r1 = await mod.notifyNewAlerts('py', [A('old'), A('new1')], { db, send, now: NOW });
    expect(r1.failed).toEqual(['new1']);
    expect(db.tables.email_log).toHaveLength(0);   // the claim is released
    fail = false;
    const r2 = await mod.notifyNewAlerts('py', [A('old'), A('new1')], { db, send, now: NOW });
    expect(r2.sent).toEqual(['new1']);
    expect(sends[0].to).toEqual(['omar@airosofts.com']);
    expect(sends[0].subject).toMatch(/^\[Alert\] CARTERA/);
    expect(db.tables.email_log[0]).toMatchObject({ automation_id: 'alert_notify', dedupe_key: 'alert-notify:new1', status: 'sent', to_email: 'omar@airosofts.com' });
    const r3 = await mod.notifyNewAlerts('py', [A('old'), A('new1')], { db, send, now: NOW });
    expect(r3.sent).toEqual([]);
    expect(sends).toHaveLength(1);
  });
});
