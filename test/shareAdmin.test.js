import { describe, it, expect } from 'vitest';
import {
  SHARE_NUDGE_ID, SHARE_REWARD_ID, SHARE_NUDGE_TEMPLATES, SHARE_REWARD_TEMPLATE, shareNudgeConfig, validateShareNudge,
  shareRewardConfig, validateShareReward, saveShareNudge, saveShareReward, shareStepLabel, shareStepFromHours, shareStepToHours,
  shareNudgeCounts, shareRewardText,
} from '../lib/shareAdmin.js';

// a lib/db-shaped fake (select / insert / update) over two tables
function fakeDb(seed = {}) {
  const t = { automations: [...(seed.automations || [])], email_templates: [...(seed.email_templates || [])] };
  let n = 0;
  return {
    t,
    async select(table, q) {
      const m = /id=eq\.([\w-]+)/.exec(q);
      return m ? t[table].filter((r) => r.id === m[1]) : t[table];
    },
    async insert(table, rows) { const made = rows.map((r) => ({ id: r.id || `tpl${++n}`, ...r })); t[table].push(...made); return made; },
    async update(table, filter, patch) { const id = /id=eq\.([\w-]+)/.exec(filter)[1]; t[table] = t[table].map((r) => (r.id === id ? { ...r, ...patch } : r)); },
  };
}

describe('Share nudges — settings', () => {
  it('defaults: 1 and 7 days after going live, low-views on (10 views, 72 h), off', () => {
    const c = shareNudgeConfig(null);
    expect(c).toMatchObject({ setUp: false, enabled: false, steps: [24, 168], lowViews: { enabled: true, threshold: 10, afterHours: 72 } });
    expect(shareStepLabel(24)).toBe('1 day after the listing went live');
    expect(shareStepFromHours(36)).toEqual({ value: 36, unit: 'hours' });
    expect(shareStepToHours({ value: 2, unit: 'days' })).toBe(48);
  });
  it('steps: 1–5, 1 h – 60 days, no two at once', () => {
    expect(validateShareNudge({ steps: [168, 24] }).value.milestones).toEqual([24, 168]);
    expect(validateShareNudge({ steps: [] }).errors.steps).toMatch(/at least one/);
    expect(validateShareNudge({ steps: [1, 2, 3, 4, 5, 6] }).errors.steps).toMatch(/At most 5/);
    expect(validateShareNudge({ steps: [0] }).errors.step_0).toBeTruthy();
    expect(validateShareNudge({ steps: [24 * 61] }).errors.step_0).toBeTruthy();
    expect(validateShareNudge({ steps: [24, 24] }).errors.steps).toMatch(/same time/);
  });
  it('low-views settings go to free_tiers[0].lowViews and keep other state', () => {
    const row = { id: SHARE_NUDGE_ID, free_tiers: [{ cursor: 'x' }], template_id: 'a', reminder_template_id: 'b' };
    const v = validateShareNudge({ lowViews: { enabled: false, threshold: 5, afterHours: 48 } }, row);
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers).toEqual([{ cursor: 'x', lowViews: { enabled: false, threshold: 5, afterHours: 48 } }]);
    expect(validateShareNudge({ lowViews: { threshold: 0 } }).errors.lowViewsThreshold).toBeTruthy();
    expect(validateShareNudge({ lowViews: { afterHours: '' } }).errors.lowViewsAfterHours).toBeTruthy();
  });
  it('switching on needs the templates and stamps enabled_at', () => {
    expect(validateShareNudge({ enabled: true }).errors.enabled).toBeTruthy();
    expect(validateShareNudge({ enabled: true, templateId: 't1' }).errors.enabled).toMatch(/low-views/);
    const v = validateShareNudge({ enabled: true, templateId: 't1', lowViews: { enabled: false } }, null, '2026-11-22T10:00:00Z');
    expect(v.ok).toBe(true);
    expect(v.value.enabled_at).toBe('2026-11-22T10:00:00Z');
    // already on: enabled_at not stamped again
    expect(validateShareNudge({ steps: [48] }, { enabled: true, template_id: 't', reminder_template_id: 'r' }).value.enabled_at).toBeUndefined();
  });
  it('first save creates the two emails and the row (off); a second save keeps them', async () => {
    const db = fakeDb({ email_templates: [{ id: 'old', key: 'share-nudge-lowviews' }] });
    const v = await saveShareNudge(db, {}, '2026-11-22T10:00:00Z');
    expect(v.ok && v.created).toBe(true);
    expect(db.t.email_templates.map((t) => t.key).sort()).toEqual(['share-nudge-lowviews', 'share-nudge-published']);
    const row = db.t.automations.find((r) => r.id === SHARE_NUDGE_ID);
    expect(row.enabled).toBe(false);
    expect(row.milestones).toEqual([24, 168]);
    expect(row.reminder_template_id).toBe('old');   // the country's existing email is reused
    expect(row.template_id).toBeTruthy();
    const v2 = await saveShareNudge(db, { enabled: true }, '2026-11-22T11:00:00Z');
    expect(v2.ok).toBe(true);
    expect(db.t.email_templates).toHaveLength(2);
    expect(db.t.automations.find((r) => r.id === SHARE_NUDGE_ID)).toMatchObject({ enabled: true, enabled_at: '2026-11-22T11:00:00Z' });
  });
  it('counts sent emails by template', () => {
    expect(shareNudgeCounts([{ template_key: 'share-nudge-published' }, { template_key: 'share-nudge-lowviews' }, { template_id: 'L' }], { lowViewsTemplateId: 'L' }))
      .toEqual({ published: 1, lowViews: 2, sent: 3 });
  });
});

describe('Share reward — settings', () => {
  it('defaults: 20 visits → 3 days Verified, once per listing, OFF', () => {
    const c = shareRewardConfig(null);
    expect(c).toMatchObject({ setUp: false, enabled: false, visits: 20, reward: 'verified', days: 3, perListingOnce: true });
    expect(shareRewardText(c)).toBe("20 visits through the owner's share links → 3 days of the Verified badge, once per listing");
  });
  it('validates visits, days and reward type; writes free_tiers[0] in the contract shape', () => {
    const v = validateShareReward({ visits: '50', reward: 'home', days: 7, templateId: 't' });
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers).toEqual([{ visits: 50, reward: 'home', days: 7, perListingOnce: true }]);
    expect(v.value.enabled).toBe(false);
    expect(validateShareReward({ visits: 0 }).errors.visits).toBeTruthy();
    expect(validateShareReward({ days: 400 }).errors.days).toBeTruthy();
    expect(validateShareReward({ reward: 'cash' }).errors.reward).toBeTruthy();
    expect(validateShareReward({ enabled: true }).errors.enabled).toBeTruthy();
  });
  it('first save creates the email and the row, still OFF', async () => {
    const db = fakeDb();
    const v = await saveShareReward(db, { visits: 30 });
    expect(v.ok).toBe(true);
    const row = db.t.automations.find((r) => r.id === SHARE_REWARD_ID);
    expect(row).toMatchObject({ enabled: false, free_tiers: [{ visits: 30, reward: 'verified', days: 3, perListingOnce: true }] });
    expect(db.t.email_templates.map((t) => t.key)).toEqual(['share-reward-earned']);
    expect(row.template_id).toBe(db.t.email_templates[0].id);
  });
});

describe('the default emails', () => {
  it('Spanish, "Casa-Libre" with the hyphen, app for iPhone and Android, no opt-out line', () => {
    for (const t of [...SHARE_NUDGE_TEMPLATES, SHARE_REWARD_TEMPLATE]) {
      expect(t.key).toMatch(/^share-/);
      expect(t.body).toMatch(/Casa-Libre/);
      expect(t.body).toMatch(/iPhone y Android/);
      expect(`${t.subject} ${t.body}`).not.toMatch(/BAJA|unsubscribe|darte de baja|no recibir/i);
      expect(t.button_url).toMatch(/^\{\{\w+\}\}$/);
    }
  });
});
