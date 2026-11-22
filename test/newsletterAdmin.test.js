import { describe, it, expect } from 'vitest';
import { newsletterSettings, validateNewsletter, saveNewsletter, newsletterWeekCounts, NEWSLETTER_ID } from '../lib/newsletterAdmin.js';
import { templateUsage } from '../lib/automationAdmin.js';
import { renderTemplate, templateVars } from '../lib/emailTemplateRender.js';
import { PROFILE_TEMPLATES } from '../lib/profileNudgeAdmin.js';

const ROW = { id: NEWSLETTER_ID, enabled: false, free_tiers: [{ day: 2, hour: 10, next: 1, rotation: [{ template_id: 'a', audience: 'everyone' }, { template_id: 'b', audience: 'never_listed' }], issue: { week: '2026-W48', template_id: 'a', audience: 'everyone', done: true } }] };

describe('newsletter settings', () => {
  it('reads the row with defaults', () => {
    expect(newsletterSettings(null)).toMatchObject({ setUp: false, enabled: false, day: 2, hour: 10, rotation: [], next: 0, issue: null });
    const s = newsletterSettings(ROW);
    expect(s.rotation).toHaveLength(2);
    expect(s.next).toBe(1);
    expect(s.issue.week).toBe('2026-W48');
  });
  it('validates day / hour / rotation and keeps the website-written state', () => {
    const v = validateNewsletter({ day: 4, hour: 15, rotation: [{ template_id: 'b', audience: 'sellers' }] }, ROW, ['a', 'b']);
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers[0]).toMatchObject({ day: 4, hour: 15, rotation: [{ template_id: 'b', audience: 'sellers' }], next: 0, issue: { week: '2026-W48' } });
    expect(validateNewsletter({ hour: 22 }, ROW, ['a', 'b']).errors.hour).toMatch(/daytime/);
    expect(validateNewsletter({ rotation: [{ template_id: 'zz' }] }, ROW, ['a', 'b']).errors.rotation).toMatch(/no longer exists/);
    expect(validateNewsletter({ enabled: true, rotation: [] }, ROW, ['a']).errors.enabled).toBeTruthy();
    const on = validateNewsletter({ enabled: true }, ROW, ['a', 'b'], '2026-11-22T00:00:00Z');
    expect(on.value).toMatchObject({ enabled: true, enabled_at: '2026-11-22T00:00:00Z' });
    expect(validateNewsletter({ rotation: [{ template_id: 'a', audience: 'martians' }] }, ROW, ['a']).value.free_tiers[0].rotation[0].audience).toBe('everyone');
  });
  it('first save creates the row OFF with every newsletter template', async () => {
    const calls = [];
    const db = {
      select: async (t) => (t === 'automations' ? [] : [{ id: 'n1', key: 'newsletter-x' }, { id: 'p', key: 'profile-personalize' }, { id: 'n2', key: 'newsletter-y' }]),
      insert: async (t, rows) => { calls.push([t, rows]); return rows; },
      update: async () => { throw new Error('no update'); },
    };
    const v = await saveNewsletter(db, {}, '2026-11-22T00:00:00Z');
    expect(v.ok).toBe(true);
    expect(calls[0][1][0]).toMatchObject({ id: NEWSLETTER_ID, enabled: false, free_tiers: [{ rotation: [{ template_id: 'n1' }, { template_id: 'n2' }] }] });
  });
  it('counts sent per week and shows rotation usage on the template', () => {
    expect(newsletterWeekCounts([{ dedupe_key: 'weekly-newsletter:2026-W48:u1' }, { dedupe_key: 'weekly-newsletter:2026-W48:u2' }, { dedupe_key: 'x' }])).toEqual({ '2026-W48': 2 });
    expect(templateUsage('b', [ROW])).toEqual(['Weekly newsletter → rotation']);
  });
});

describe('renderer (admin copy) — newsletter blocks + new profile email', () => {
  it('knows the newsletter variables and draws stats, titles, extra buttons, preheader', () => {
    const keys = new Set(templateVars.map((v) => v.key));
    for (const k of ['newsletter_url', 'stories_url', 'country_name', 'nl_views_30d', 'nl_direct_ratio']) expect(keys.has(k)).toBe(true);
    const m = renderTemplate({ subject: 'S', heading: 'H', body: '>> pre\n\n!! 2 veces | más\n\n## T\n\n[[Ver]](https://casa-libre.com.py/newsletter)', button_label: 'B', button_url: 'https://casa-libre.com.py/publicar' }, {}, {});
    expect(m.html).toMatch(/display:none[^>]*>pre/);
    expect(m.html).toContain('>2 veces</div>');
    expect(m.html).toMatch(/border:1.5px solid #111[^>]*>Ver<\/a>/);
  });
  it('the profile email is short, has the mock image and one button', () => {
    const m = renderTemplate(PROFILE_TEMPLATES[0], { name: 'Ana', country_name: 'Paraguay', settings_url: 'https://casa-libre.com.py/cuenta/ajustes' }, {});
    expect(m.subject).toBe('Ana, así se ve tu publicación con tu foto');
    expect(m.html).toContain('src="https://casa-libre.com.py/api/media/email-assets/profile-mock-v1.jpg"');
    expect(m.html).toContain('Casa-Libre trae esa experiencia a Paraguay');
    expect((m.html.match(/<a href=/g) || []).length).toBe(1);
  });
});
