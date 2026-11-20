import { describe, it, expect } from 'vitest';
import { buildJob, parseReport, runView, taskFor, BOT_KEYS } from '../lib/bots/job.js';
import { BOTS } from '../lib/grokBots.js';

const runId = '11111111-2222-3333-4444-555555555555';

describe('buildJob', () => {
  it('a real job carries task, rules, settings and the report address', () => {
    const j = buildJob('lead-finder', { maxPerRun: 20, countries: ['py', 'bo'] }, { runId, reportTo: 'https://admin.x/api/bot-report', token: 'tok' });
    expect(j.runId).toBe(runId);
    expect(j.reportHeader).toBe('Authorization: Bearer tok');
    expect(j.task).toContain('Paraguay, Bolivia');
    expect(j.task).toContain('At most 20 contacts');
    expect(j.task).toContain('Only keep contacts that show a phone number');
    expect(j.rules.join(' ')).toMatch(/Never send/);
    expect(j.settings.maxPerRun).toBe(20);
  });
  it('a test job does no work', () => {
    const j = buildJob('visibility', null, { runId, reportTo: 'u', token: 't', test: true });
    expect(j.test).toBe(true);
    expect(j.task).toMatch(/Connection test only/);
  });
  it('every bot has a task and unknown bots fail', () => {
    for (const b of BOTS) expect(taskFor(b, b.defaults).length).toBeGreaterThan(40);
    expect(BOT_KEYS).toHaveLength(6);
    expect(() => buildJob('nope', null, {})).toThrow();
  });
});

describe('parseReport / runView', () => {
  it('validates the report', () => {
    expect(parseReport(null).error).toBeTruthy();
    expect(parseReport({ runId: 'x' }).error).toBeTruthy();
    const r = parseReport({ runId, summary: 'ok', items: [{ a: 1 }, 'bad', null] });
    expect(r).toEqual({ runId, summary: 'ok', items: [{ a: 1 }], failed: false });
    expect(parseReport({ runId, error: 'could not' }).failed).toBe(true);
  });
  it('marks unanswered runs as no answer after their time', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    expect(runView({ status: 'sent', trigger: 'test', started_at: '2026-11-20T11:00:00Z' }, now).status).toBe('no_answer');
    expect(runView({ status: 'sent', trigger: 'manual', started_at: '2026-11-20T11:00:00Z' }, now).status).toBe('sent');
    expect(runView({ status: 'done', trigger: 'test', started_at: '2026-11-19T11:00:00Z' }, now).status).toBe('done');
  });
});
