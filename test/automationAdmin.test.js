import { describe, it, expect } from 'vitest';
import { validateTemplate, validateSettings, automationStats, countryFrame, templateUsage } from '../lib/automationAdmin.js';

describe('validateTemplate', () => {
  it('accepts a complete template and trims it', () => {
    const r = validateTemplate({ name: ' Gift ', subject: ' Hola {{name}} ', heading: 'H', body: 'B', button_label: 'Ver', button_url: '{{property_url}}' });
    expect(r.ok).toBe(true);
    expect(r.value.name).toBe('Gift');
    expect(r.value.subject).toBe('Hola {{name}}');
  });
  it('requires name, subject and body', () => {
    const r = validateTemplate({ name: '', subject: '', body: '' });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['body', 'name', 'subject']);
  });
  it('button needs both a label and a link (variable or http)', () => {
    expect(validateTemplate({ name: 'a', subject: 's', body: 'b', button_label: 'Ir', button_url: '' }).errors.button_url).toBeTruthy();
    expect(validateTemplate({ name: 'a', subject: 's', body: 'b', button_label: 'Ir', button_url: 'ftp://x' }).errors.button_url).toBeTruthy();
    expect(validateTemplate({ name: 'a', subject: 's', body: 'b', button_label: 'Ir', button_url: 'https://x.com' }).ok).toBe(true);
    expect(validateTemplate({ name: 'a', subject: 's', body: 'b', button_label: '', button_url: '' }).value.button_label).toBe(null);
  });
  it('flags unknown variables', () => {
    const r = validateTemplate({ name: 'a', subject: 'Hi {{nmae}}', body: 'b' });
    expect(r.ok).toBe(false);
    expect(r.errors.subject).toMatch(/nmae/);
  });
});

describe('validateSettings', () => {
  it('clamps to the DB ranges and needs reminder < free days', () => {
    expect(validateSettings({ wait_days: 2, free_days: 30, remind_days_before: 3 }).ok).toBe(true);
    expect(validateSettings({ wait_days: -1, free_days: 30, remind_days_before: 3 }).ok).toBe(false);
    expect(validateSettings({ wait_days: 2, free_days: 5, remind_days_before: 5 }).ok).toBe(false);
    expect(validateSettings({ wait_days: 2, free_days: 400, remind_days_before: 3 }).ok).toBe(false);
  });
  it('enabling stamps enabled_at only when it turns on', () => {
    const now = '2026-10-01T00:00:00.000Z';
    expect(validateSettings({ enabled: true }, { enabled: false }, now).value.enabled_at).toBe(now);
    expect(validateSettings({ enabled: true }, { enabled: true, enabled_at: 'x' }, now).value.enabled_at).toBeUndefined();
    expect(validateSettings({ enabled: false }, { enabled: true }, now).value.enabled).toBe(false);
  });
});

describe('automationStats', () => {
  it('counts statuses, reminders and revenue from converted runs', () => {
    const runs = [
      { status: 'gifted', property_id: 'a', gifted_at: '2026-10-01' },
      { status: 'reminded', property_id: 'b', gifted_at: '2026-10-01', reminded_at: '2026-10-28' },
      { status: 'converted', property_id: 'c', gifted_at: '2026-10-01', reminded_at: '2026-10-28' },
      { status: 'done', property_id: 'd', gifted_at: '2026-09-01' },
      { status: 'skipped', skip_reason: 'no_photo' },
    ];
    const pays = [{ property_id: 'c', amount_usd: 20, created_at: '2026-10-29', status: 'succeeded' }, { property_id: 'x', amount_usd: 5, created_at: '2026-10-29', status: 'succeeded' }];
    const s = automationStats(runs, pays);
    expect(s).toMatchObject({ inFlow: 2, gifted: 4, reminded: 2, converted: 1, skipped: 1, revenueUsd: 20 });
  });
});

describe('countryFrame / templateUsage', () => {
  it('builds the per-country frame', () => {
    expect(countryFrame('bo', { appleSrc: 'a' })).toMatchObject({ tld: '.bo', countryName: 'Bolivia', appleSrc: 'a' });
    expect(countryFrame('zz').tld).toBe('.py');
  });
  it('names the automation steps that use a template', () => {
    const u = templateUsage('t1', [{ id: 'first_listing_free_home', gift_template_id: 't1', reminder_template_id: 't2' }]);
    expect(u).toEqual(['First listing → gift email']);
  });
});

import { validateViewsSettings, parseMilestones, VIEWS_AUTOMATION_ID } from '../lib/automationAdmin.js';

describe('views automation settings', () => {
  it('parses "25, 50, 100" into sorted unique numbers', () => {
    expect(parseMilestones('100, 25,50 ,25')).toEqual([25, 50, 100]);
    expect(parseMilestones([50, '10'])).toEqual([10, 50]);
  });
  it('rejects empty, zero, text, too many or too large numbers', () => {
    expect(validateViewsSettings({ milestones: '' }).ok).toBe(false);
    expect(validateViewsSettings({ milestones: '0, 50' }).ok).toBe(false);
    expect(validateViewsSettings({ milestones: 'abc' }).ok).toBe(false);
    expect(validateViewsSettings({ milestones: Array.from({ length: 11 }, (_, i) => i + 1) }).ok).toBe(false);
    expect(validateViewsSettings({ milestones: '2000000' }).ok).toBe(false);
    expect(validateViewsSettings({ milestones: '50' }).value.milestones).toEqual([50]);
  });
  it('switching on needs numbers and a template, and stamps enabled_at', () => {
    const now = '2026-10-01T00:00:00.000Z';
    expect(validateViewsSettings({ enabled: true }, { enabled: false, milestones: [50], template_id: null }, now).ok).toBe(false);
    const ok = validateViewsSettings({ enabled: true }, { enabled: false, milestones: [50], template_id: 't' }, now);
    expect(ok.ok).toBe(true);
    expect(ok.value.enabled_at).toBe(now);
  });
  it('templates list shows the views automation usage', () => {
    expect(templateUsage('tv', [{ id: VIEWS_AUTOMATION_ID, template_id: 'tv' }])).toEqual(['Listing getting views → email']);
  });
});
