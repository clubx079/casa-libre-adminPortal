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

describe('validateSettings — free-highlight tiers (migration 009)', () => {
  const cur = { free_days: 30, later_free_days: 7, remind_days_before: 1, first_tier_count: 25 };
  it('accepts first 25 → 30 days, then 7, reminder 1 day before', () => {
    const v = validateSettings({ first_tier_count: 25, free_days: 30, later_free_days: 7, remind_days_before: 1 }, cur);
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ first_tier_count: 25, later_free_days: 7, remind_days_before: 1 });
  });
  it('0 sellers is allowed (everyone gets the later days)', () => {
    expect(validateSettings({ first_tier_count: 0 }, cur).ok).toBe(true);
  });
  it('rejects bad numbers with a clear message', () => {
    expect(validateSettings({ first_tier_count: -1 }, cur).errors.first_tier_count).toMatch(/sellers/);
    expect(validateSettings({ later_free_days: 0 }, cur).errors.later_free_days).toMatch(/days/);
  });
  it('the reminder must fit inside the shortest gift', () => {
    expect(validateSettings({ remind_days_before: 7 }, cur).errors.remind_days_before).toMatch(/less than 7/);
    expect(validateSettings({ remind_days_before: 6 }, cur).ok).toBe(true);
  });
});

describe('validateSettings — tier list (migration 010)', () => {
  const cur = { free_days: 30, later_free_days: 7, remind_days_before: 1, first_tier_count: 25, free_tiers: [{ sellers: 25, days: 30 }] };
  it('accepts 30→30, 20→20, 10→10 and mirrors the first tier', () => {
    const v = validateSettings({ free_tiers: [{ sellers: 30, days: 30 }, { sellers: 20, days: 20 }, { sellers: 10, days: '10' }] }, cur);
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers).toEqual([{ sellers: 30, days: 30 }, { sellers: 20, days: 20 }, { sellers: 10, days: 10 }]);
    expect(v.value).toMatchObject({ first_tier_count: 30, free_days: 30 });
  });
  it('flags the exact bad row', () => {
    const v = validateSettings({ free_tiers: [{ sellers: 30, days: 30 }, { sellers: 0, days: 400 }] }, cur);
    expect(v.errors.tier_1_sellers).toMatch(/sellers/);
    expect(v.errors.tier_1_days).toMatch(/days/);
    expect(v.value.free_tiers).toBeUndefined();
  });
  it('needs 1–10 tiers', () => {
    expect(validateSettings({ free_tiers: [] }, cur).errors.free_tiers).toMatch(/at least one/);
    expect(validateSettings({ free_tiers: Array.from({ length: 11 }, () => ({ sellers: 1, days: 5 })) }, cur).errors.free_tiers).toMatch(/10/);
  });
  it('the reminder must fit inside the shortest tier too', () => {
    const v = validateSettings({ free_tiers: [{ sellers: 5, days: 30 }, { sellers: 5, days: 2 }], remind_days_before: 2 }, cur);
    expect(v.errors.remind_days_before).toMatch(/less than 2/);
  });
});

import { validateDraftSettings, stepsFromHours, stepFromHours, stepLabel, draftStepCounts, DRAFTS_AUTOMATION_ID } from '../lib/automationAdmin.js';
import { renderTemplate, templateVars } from '../lib/emailTemplateRender.js';
import { validateTemplate as vt } from '../lib/automationAdmin.js';
import fs from 'node:fs';

describe('unfinished draft reminders settings', () => {
  it('shows hours as days when they are whole days', () => {
    expect(stepsFromHours([168, 24, 72])).toEqual([{ value: 1, unit: 'days' }, { value: 3, unit: 'days' }, { value: 7, unit: 'days' }]);
    expect(stepFromHours(6)).toEqual({ value: 6, unit: 'hours' });
    expect(stepFromHours(36)).toEqual({ value: 36, unit: 'hours' });
    expect(stepLabel(24)).toBe('1 day');
    expect(stepLabel(1)).toBe('1 hour');
    expect(stepLabel(168)).toBe('7 days');
  });
  it('turns hours / days rows into sorted hours', () => {
    const r = validateDraftSettings({ steps: [{ value: 3, unit: 'days' }, { value: 2, unit: 'hours' }, { value: 1, unit: 'days' }] });
    expect(r.ok).toBe(true);
    expect(r.value.milestones).toEqual([2, 24, 72]);
  });
  it('1–5 reminders, each a whole number from 1 hour to 60 days, no two at the same time', () => {
    expect(validateDraftSettings({ steps: [] }).errors.steps).toBeTruthy();
    expect(validateDraftSettings({ steps: Array.from({ length: 6 }, (_, i) => ({ value: i + 1, unit: 'days' })) }).errors.steps).toMatch(/5/);
    expect(validateDraftSettings({ steps: [{ value: 0, unit: 'hours' }] }).errors.step_0).toBeTruthy();
    expect(validateDraftSettings({ steps: [{ value: 1.5, unit: 'days' }] }).errors.step_0).toBeTruthy();
    expect(validateDraftSettings({ steps: [{ value: 61, unit: 'days' }] }).errors.step_0).toMatch(/60 days/);
    expect(validateDraftSettings({ steps: [{ value: 1441, unit: 'hours' }] }).errors.step_0).toMatch(/60 days/);
    expect(validateDraftSettings({ steps: [{ value: 3, unit: 'weeks' }] }).errors.step_0).toBeTruthy();
    expect(validateDraftSettings({ steps: [{ value: 24, unit: 'hours' }, { value: 1, unit: 'days' }] }).errors.steps).toBeTruthy();
    expect(validateDraftSettings({ steps: [{ value: 1, unit: 'hours' }, { value: 60, unit: 'days' }] }).value.milestones).toEqual([1, 1440]);
  });
  it('switching on needs steps and a template, and stamps enabled_at once', () => {
    const now = '2026-10-09T00:00:00.000Z';
    expect(validateDraftSettings({ enabled: true }, { enabled: false, milestones: [24], template_id: null }, now).errors.enabled).toBeTruthy();
    expect(validateDraftSettings({ enabled: true }, { enabled: false, milestones: [], template_id: 't' }, now).errors.enabled).toBeTruthy();
    const on = validateDraftSettings({ enabled: true }, { enabled: false, milestones: [24, 72], template_id: 't' }, now);
    expect(on.ok).toBe(true);
    expect(on.value).toEqual({ enabled: true, enabled_at: now });
    expect(validateDraftSettings({ enabled: true }, { enabled: true, enabled_at: 'x', milestones: [24], template_id: 't' }, now).value.enabled_at).toBeUndefined();
    expect(validateDraftSettings({ enabled: false }, { enabled: true, milestones: [24], template_id: 't' }, now).value).toEqual({ enabled: false });
  });
  it('counts sent emails per reminder', () => {
    expect(draftStepCounts([{ dedupe_key: 'draft:a:1' }, { dedupe_key: 'draft:b:1' }, { dedupe_key: 'draft:a:2' }, { dedupe_key: 'views:x:50' }, {}])).toEqual({ 1: 2, 2: 1 });
  });
  it('names the automation that uses a template', () => {
    expect(templateUsage('t9', [{ id: DRAFTS_AUTOMATION_ID, template_id: 't9' }])).toEqual(['Unfinished draft reminders → email']);
  });
});

describe('draft reminder template (migrations/013 in the buyer portal)', () => {
  const tpl = {
    name: 'Borrador sin terminar — recordatorio', subject: 'Te falta poco para publicar tu propiedad', heading: 'Tu propiedad está casi lista',
    body: 'Hola {{name}},\n\nEmpezaste a publicar **{{property_title}}** en Casa Libre y quedó guardada como borrador. Lo que cargaste sigue ahí.\n\n![{{property_title}}]({{photo_url}})\n\nTe falta poco: tocá el botón y seguí justo donde lo dejaste. Publicar es gratis.',
    button_label: 'Continuar mi publicación', button_url: '{{draft_url}}',
  };
  it('passes the editor validation (all variables known)', () => {
    expect(vt(tpl).ok).toBe(true);
    expect(templateVars.map((v) => v.key)).toEqual(expect.arrayContaining(['draft_url', 'photo_url', 'draft_location']));
  });
  it('the preview shows the sample photo and a button to the draft', () => {
    const { html } = renderTemplate(tpl, Object.fromEntries(templateVars.map((v) => [v.key, v.sample])), countryFrame('uy'));
    expect(html).toMatch(/<img src="https:\/\/images\.unsplash\.com\/[^"]+" alt="Casa 3 dorm · Villa Morra"/);
    expect(html).toMatch(/<a href="https:\/\/casa-libre\.com\.py\/cuenta\/publicaciones\?tab=borradores&amp;draft=ejemplo"[^>]*>Continuar mi publicación<\/a>/);
  });
  it('the renderer is the same file as the buyer portal’s (when both repos sit side by side)', () => {
    const here = fs.readFileSync(new URL('../lib/emailTemplateRender.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const buyerPath = process.env.BUYER_PORTAL_DIR ? `${process.env.BUYER_PORTAL_DIR}/lib/emailTemplateRender.js` : null;
    if (!buyerPath || !fs.existsSync(buyerPath)) return;   // only checked when BUYER_PORTAL_DIR is set
    expect(fs.readFileSync(buyerPath, 'utf8').replace(/\r\n/g, '\n')).toBe(here);
  });
});
