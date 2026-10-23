import { describe, it, expect } from 'vitest';
import { buildQuery, checkHogql, cleanRow, maskEmail, maskPhone, runTool, READABLE_TABLES, capJson } from '../lib/manager/tools.js';
import { periods, change, countBy, followUpResults, feedbackSummary, paymentSummary, scraperHealth, listingSummary } from '../lib/manager/packMath.js';
import { buildActions, recentActionKeys, applyEdit, safeUrl, safeBody, MAX_DRAFTS } from '../lib/manager/actions.js';
import { REPORT_SCHEMA, systemPrompt } from '../lib/manager/prompt.js';
import { costUsd, addUsage, emptyUsage, parseReport } from '../lib/manager/agent.js';

const SITE = 'https://casa-libre.com.py';
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

describe('agent tools are read-only and private', () => {
  it('only allowlisted tables; secrets never readable', () => {
    for (const t of ['admins', 'admin_sessions', 'otp_codes', 'push_tokens', 'potential_leads', 'manager_reports']) {
      expect(READABLE_TABLES).not.toContain(t);
      expect(buildQuery({ table: t }).ok).toBe(false);
    }
  });
  it('builds a PostgREST query and caps the limit', () => {
    const q = buildQuery({ table: 'properties', select: 'id,city', filters: 'origin=eq.user&listing_type=eq.rent', order: 'created_at.desc', limit: 5000 });
    expect(q).toEqual({ ok: true, query: 'select=id,city&origin=eq.user&listing_type=eq.rent&order=created_at.desc&limit=200', limit: 200 });
    expect(buildQuery({ table: 'users', select: 'id', filters: 'select=password_hash' }).ok).toBe(false);
    expect(buildQuery({ table: 'users', select: 'id;drop' }).ok).toBe(false);
    expect(buildQuery({ table: 'users', select: 'id', filters: 'full_name=eq.Ana Paz' }).ok).toBe(false);
  });
  it('masks emails and phones, drops secrets, cuts long text', () => {
    expect(maskEmail('omar@gmail.com')).toBe('o***@gmail.com');
    expect(maskPhone('+595981123456')).toBe('+595 9•• ••• •56');
    const r = cleanRow({ id: 1, email: 'ana@x.com', contact_phone: '0981123456', password_hash: 'h', registration_ip: '1.2.3.4', raw_data: { a: 1 }, description: 'x'.repeat(900) });
    expect(r).toMatchObject({ id: 1, email: 'a***@x.com', contact_phone: '+098 1•• ••• •56' });
    expect(r).not.toHaveProperty('password_hash');
    expect(r).not.toHaveProperty('registration_ip');
    expect(r).not.toHaveProperty('raw_data');
    expect(r.description.length).toBeLessThan(760);
  });
  it('HogQL must be a single SELECT and gets a LIMIT', () => {
    expect(checkHogql('SELECT count() FROM events').sql).toMatch(/LIMIT 300$/);
    expect(checkHogql('select 1 limit 5;').sql).toBe('select 1 limit 5');
    expect(checkHogql('ALTER TABLE events').ok).toBe(false);
    expect(checkHogql('select 1; select 2').ok).toBe(false);
  });
  it('runTool returns errors as data and masks rows', async () => {
    const deps = { select: async () => [{ id: U1, email: 'ana@x.com', password_hash: 'h' }], count: async () => 7, hogql: async () => [[1]] };
    expect(JSON.parse(await runTool('query_database', { table: 'users', select: 'id,email', filters: '', order: '', limit: 5 }, deps)).rows[0]).toEqual({ id: U1, email: 'a***@x.com' });
    expect(JSON.parse(await runTool('count_rows', { table: 'users', filters: '' }, deps))).toEqual({ count: 7 });
    expect(JSON.parse(await runTool('query_database', { table: 'admins', select: 'id', filters: '', order: '', limit: 5 }, deps)).error).toMatch(/not readable/);
    expect(JSON.parse(await runTool('get_user', { id: 'nope' }, deps)).error).toMatch(/uuid/);
    const boom = { ...deps, select: async () => { throw new Error('db down'); } };
    expect(JSON.parse(await runTool('query_database', { table: 'users', select: 'id', filters: '', order: '', limit: 1 }, boom)).error).toBe('db down');
  });
  it('big results are cut with a hint', () => {
    expect(capJson({ a: 'x'.repeat(40000) })).toMatch(/cut: the result was/);
  });
});

describe('pack maths', () => {
  it('two back-to-back 7-day periods', () => {
    const p = periods(new Date('2026-10-26T10:00:00Z'));
    expect(p.cur).toEqual({ start: '2026-10-19T10:00:00.000Z', end: '2026-10-26T10:00:00.000Z' });
    expect(p.prev.end).toBe(p.cur.start);
  });
  it('change % and countBy', () => {
    expect(change(15, 10)).toBe(50);
    expect(change(0, 0)).toBe(0);
    expect(change(5, 0)).toBe(null);
    expect(countBy([{ t: 'a' }, { t: 'a' }, { t: 'b' }, { t: 'c' }], (r) => r.t, 2)).toEqual({ a: 2, b: 1, other: 1 });
  });
  it('follow-up scorecard: action within 7 days after the message, one person once', () => {
    const period = { start: '2026-10-12T00:00:00Z', end: '2026-10-19T00:00:00Z' };
    const messages = [
      { automation_id: 'draft_reminder', template_key: 'draft-1', channel: 'email', status: 'sent', to_email: 'A@x.com', created_at: '2026-10-13T10:00:00Z' },
      { automation_id: 'draft_reminder', template_key: 'draft-1', channel: 'email', status: 'sent', to_email: 'a@x.com', created_at: '2026-10-14T10:00:00Z' },
      { automation_id: 'draft_reminder', template_key: 'draft-1', channel: 'email', status: 'sent', to_email: 'b@x.com', created_at: '2026-10-13T10:00:00Z' },
      { automation_id: 'draft_reminder', template_key: 'draft-1', channel: 'email', status: 'failed', to_email: 'c@x.com', created_at: '2026-10-13T10:00:00Z' },
      { automation_id: 'draft_reminder', template_key: 'draft-1', channel: 'email', status: 'test', to_email: 'a@x.com', created_at: '2026-10-13T10:00:00Z' },
      { automation_id: 'views', template_key: 'cl_views', channel: 'whatsapp', status: 'read', to_email: 'b@x.com', created_at: '2026-10-15T10:00:00Z' },
      { automation_id: 'views', template_key: 'cl_views', channel: 'whatsapp', status: 'sent', to_email: 'a@x.com', created_at: '2026-10-25T10:00:00Z' }, // outside
    ];
    const users = [{ id: U1, email: 'a@x.com', last_login_at: '2026-10-16T00:00:00Z' }, { id: U2, email: 'b@x.com', last_login_at: '2026-10-01T00:00:00Z' }];
    const listings = [{ created_by: U1, created_at: '2026-10-15T00:00:00Z' }, { created_by: U2, created_at: '2026-10-30T00:00:00Z' }];
    const payments = [{ user_id: U1, status: 'succeeded', created_at: '2026-10-15T01:00:00Z' }];
    const rows = followUpResults({ messages, users, listings, payments, period, now: Date.parse('2026-10-26T00:00:00Z') });
    expect(rows[0]).toMatchObject({ automation: 'draft_reminder', channel: 'email', sent: 3, failed: 1, matched: 2, listed: 1, paid: 1, active: 1, listedRate: 50, stillOpen: 0 });
    expect(rows[1]).toMatchObject({ automation: 'views', channel: 'whatsapp', sent: 1, read: 1, readRate: 100, listed: 0 });
  });
  it('feedback, payments, listings and scraper summaries', () => {
    expect(feedbackSummary([{ rating: 1 }, { rating: 5 }, { rating: 2 }, { rating: null }])).toMatchObject({ count: 4, avgRating: 2.7, low: 2 });
    const p = { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' };
    const pay = paymentSummary([
      { status: 'succeeded', kind: 'listing_fee', amount_usd: 5.8, created_at: '2026-10-02T00:00:00Z' },
      { status: 'failed', kind: 'listing_fee', amount_usd: 5.8, created_at: '2026-10-03T00:00:00Z', failure_reason: 'card_declined' },
      { status: 'succeeded', kind: 'listing_free', amount_usd: 0, created_at: '2026-10-03T00:00:00Z' },
    ], p);
    expect(pay).toMatchObject({ succeeded: 1, failed: 1, revenueUsd: 5.8 });
    expect(pay.failures[0].reason).toBe('card_declined');
    expect(listingSummary([{ created_by: U1, created_at: '2026-10-02T00:00:00Z', listing_type: 'rent', is_complete: false }], p)).toMatchObject({ total: 1, sellers: 1, incomplete: 1, byOperation: { rent: 1 } });
    const h = scraperHealth([{ id: 's1', key: 'remax_py', is_active: true, last_run_at: '2026-08-28T00:00:00Z' }], [
      { source_id: 's1', status: 'completed', started_at: '2026-10-20T00:00:00Z', inserted_count: 4, updated_count: 10 },
      { source_id: 's1', status: 'failed', started_at: '2026-10-19T00:00:00Z' },
    ]);
    expect(h[0]).toMatchObject({ runs: 2, failed: 1, inserted: 4, updated: 10, lastRun: '2026-10-20T00:00:00Z' });
  });
});

describe('drafts → review queue', () => {
  const base = { kind: 'negative_feedback', user_id: U1, feedback_id: null, property_id: null, reason: 'r', evidence: 'e', subject: 'Hola', heading: 'h', body: 'Texto [aquí](https://evil.com) y [acá](https://casa-libre.com.py/contacto)', button_label: 'Ver', button_url: 'https://casa-libre.com.py/cuenta/publicaciones' };
  let n = 0;
  const newId = () => `a${++n}`;
  it('keeps links on the site only', () => {
    expect(safeUrl('https://casa-libre.com.py/publicar', SITE)).toBe('https://casa-libre.com.py/publicar');
    expect(safeUrl('http://casa-libre.com.py/publicar', SITE)).toBe(null);
    expect(safeUrl('https://casa-libre.com.py.evil.com/', SITE)).toBe(null);
    expect(safeBody(base.body, SITE)).toBe('Texto aquí y [acá](https://casa-libre.com.py/contacto)');
  });
  it('drops team accounts, duplicates, recent ones, and caps at 10', () => {
    const drafts = [
      base,
      { ...base },                                             // duplicate
      { ...base, user_id: U2 },                                // team account
      { ...base, user_id: null, feedback_id: '42', kind: 'complaint', button_url: 'https://evil.com' },
      { ...base, user_id: null, feedback_id: null },           // nobody to send to
      { ...base, user_id: '33333333-3333-3333-3333-333333333333', kind: 'listing_fix' },
    ];
    const { actions, dropped } = buildActions(drafts, { site: SITE, newId, skipUser: (id) => id === U2, recentKeys: new Set(['user:33333333-3333-3333-3333-333333333333:listing_fix']) });
    expect(actions.map((a) => [a.user_id, a.feedback_id, a.kind])).toEqual([[U1, null, 'negative_feedback'], [null, '42', 'complaint']]);
    expect(actions[1].button_url).toBe(null);
    expect(actions[1].button_label).toBe(null);
    expect(actions[0].status).toBe('draft');
    expect(dropped.map((d) => d.reason)).toEqual(['duplicate in this report', 'team / test / unknown account', 'no user or feedback to send to', 'already handled in the last 14 days']);
    const many = Array.from({ length: 14 }, (_, i) => ({ ...base, user_id: `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111` }));
    expect(buildActions(many, { site: SITE, newId }).actions).toHaveLength(MAX_DRAFTS);
  });
  it('remembers what was sent or dismissed in the last 14 days', () => {
    const keys = recentActionKeys([
      { created_at: '2026-10-20T00:00:00Z', actions: [{ user_id: U1, kind: 'complaint', status: 'sent' }, { user_id: U2, kind: 'other', status: 'draft' }] },
      { created_at: '2026-09-01T00:00:00Z', actions: [{ feedback_id: '9', kind: 'complaint', status: 'sent' }] },
    ], Date.parse('2026-10-10T00:00:00Z'));
    expect([...keys]).toEqual([`user:${U1}:complaint`]);
  });
  it('admin edits are checked the same way', () => {
    const a = buildActions([base], { site: SITE, newId }).actions[0];
    expect(applyEdit(a, { subject: '' }, SITE).ok).toBe(false);
    expect(applyEdit(a, { button_url: 'https://evil.com' }, SITE).errors.button_url).toBeTruthy();
    expect(applyEdit(a, { body: 'Nuevo', button_url: '' }, SITE).action).toMatchObject({ body: 'Nuevo', button_url: null, button_label: null });
  });
});

describe('prompt, schema and cost', () => {
  it('the system prompt is stable (cacheable) and scoped to the country', () => {
    const a = systemPrompt('py');
    expect(a).toBe(systemPrompt('py'));
    expect(a).toContain('https://casa-libre.com.py/cuenta/publicaciones');
    expect(a).toContain("'py'");
    expect(systemPrompt('bo')).toContain('Bolivia');
  });
  it('every object in the report schema is closed and fully required (structured outputs)', () => {
    const walk = (s) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(walk);
      }
      if (s.type === 'array') walk(s.items);
      (s.anyOf || []).forEach(walk);
    };
    walk(REPORT_SCHEMA);
  });
  it('cost from usage (Opus 5.5 prices)', () => {
    const u = addUsage(emptyUsage(), { input_tokens: 100000, output_tokens: 20000, cache_read_input_tokens: 500000, cache_creation_input_tokens: 40000 });
    expect(costUsd(u)).toBe(0.4 + 0.4 + 0.1 + 0.2);
    expect(parseReport({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"headline":"x"}' }] })).toEqual({ headline: 'x' });
    expect(() => parseReport({ content: [], stop_reason: 'end_turn' })).toThrow(/No report text/);
  });
});
