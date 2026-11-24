import { describe, it, expect } from 'vitest';
import {
  validateShareFeature, saveShareFeature, shareFeatureCounts, SHARE_FEATURE_ID, SHARE_FEATURE_TEMPLATE, SHARE_FEATURE_DEFAULTS, shareFeatureConfig,
} from '../lib/shareFeatureAdmin.js';
import { shareFeatureNext, shareFeatureProgress, shareFeatureKey, shareFeatureStopKey, shareFeatureScheduleText, shareFeatureListingsUrl } from '../lib/shareFeature.js';
import { templateUsage, validateTemplate } from '../lib/automationAdmin.js';
import { emailResults } from '../lib/emailResults.js';
import { emailType } from '../lib/emailStats.js';
import { keyForEmailType, CATALOG } from '../lib/messageCampaigns.js';
import { renderTemplate, sampleVars } from '../lib/emailTemplateRender.js';

const NOW = '2026-11-25T12:00:00.000Z';
const H = 3600e3;

function fakeDb(seed = {}) {
  const t = { automations: [], email_templates: [], ...JSON.parse(JSON.stringify(seed)) };
  let n = 0;
  const where = (q) => [...String(q).matchAll(/(\w+)=eq\.([^&]+)/g)].map((m) => [m[1], decodeURIComponent(m[2])]);
  return {
    t,
    select: async (table, q) => (t[table] || []).filter((r) => where(q).every(([k, v]) => String(r[k]) === v)),
    insert: async (table, rows) => { const made = rows.map((r) => ({ id: r.id || `id-${++n}`, ...r })); (t[table] ||= []).push(...made); return made; },
    update: async (table, q, patch) => { for (const r of t[table].filter((x) => where(q).every(([k, v]) => String(x[k]) === v))) Object.assign(r, patch); return []; },
  };
}

describe('share feature — schedule (lib/shareFeature.js, same file as the website)', () => {
  const enabledAt = Date.parse(NOW) - 10 * 24 * H;
  const cfg = { ...SHARE_FEATURE_DEFAULTS, enabledAt: new Date(enabledAt).toISOString() };
  it('next due: right away for existing accounts, after the wait for new ones, then every N hours', () => {
    expect(shareFeatureNext({ createdAtMs: enabledAt - 1000, sent: 0 }, cfg, enabledAt + 1).state).toBe('due');
    expect(shareFeatureNext({ createdAtMs: enabledAt + H, sent: 0 }, cfg, enabledAt + 24 * H).state).toBe('waiting');
    expect(shareFeatureNext({ createdAtMs: enabledAt + H, sent: 0 }, cfg, enabledAt + 25 * H).state).toBe('due');
    const last = Date.parse(NOW);
    expect(shareFeatureNext({ createdAtMs: 0, sent: 1, lastAtMs: last }, cfg, last + 48 * H - 1).state).toBe('waiting');
    expect(shareFeatureNext({ createdAtMs: 0, sent: 1, lastAtMs: last }, cfg, last + 48 * H)).toMatchObject({ state: 'due', n: 2 });
  });
  it('count limit, and 0 = no limit', () => {
    expect(shareFeatureNext({ createdAtMs: 0, sent: 3, lastAtMs: 0 }, { ...cfg, maxSends: 3 }, Date.parse(NOW)).state).toBe('done');
    expect(shareFeatureNext({ createdAtMs: 0, sent: 999, lastAtMs: 0 }, { ...cfg, maxSends: 0 }, Date.parse(NOW))).toMatchObject({ state: 'due', n: 1000 });
    expect(shareFeatureScheduleText(cfg)).toBe('first email at the next daytime run, then every 2 days · no limit');
  });
  it('progress counts distinct emails and picks up stop rows (ours + the referral promo\'s)', () => {
    const p = shareFeatureProgress([
      { run_id: 'a', dedupe_key: shareFeatureKey('a', 1), status: 'sent', created_at: NOW },
      { run_id: 'a', dedupe_key: shareFeatureKey('a', 1), status: 'sent', created_at: NOW },
      { run_id: 'b', dedupe_key: shareFeatureStopKey('b'), subject: 'complained' },
      { run_id: 'c', dedupe_key: 'refpromo-stop:c:ev', subject: 'bounced' },
    ]);
    expect(p.get('a').sent).toBe(1);
    expect(p.get('b').stop).toBe('complained');
    expect(p.get('c').stop).toBe('bounced');
  });
});

describe('validateShareFeature', () => {
  it('defaults: every 48 h, no limit, 24 h after sign-up, 100 per run, off', () => {
    const v = validateShareFeature({}, null, NOW);
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers).toEqual([SHARE_FEATURE_DEFAULTS]);
    expect(SHARE_FEATURE_DEFAULTS).toEqual({ firstAfterHours: 24, everyHours: 48, maxSends: 0, perRun: 100 });
    expect(v.value.enabled).toBe(false);
  });
  it('ranges: interval 1–2160 h, times 0–100 (0 = no limit), per run 1–1000', () => {
    expect(validateShareFeature({ everyHours: 6, maxSends: 0, perRun: 1 }, null, NOW).value.free_tiers[0]).toMatchObject({ everyHours: 6, maxSends: 0, perRun: 1 });
    const bad = validateShareFeature({ everyHours: 0, maxSends: 101, perRun: 0, firstAfterHours: -1 }, null, NOW);
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['everyHours', 'firstAfterHours', 'maxSends', 'perRun']);
    expect(validateShareFeature({ maxSends: '' }, null, NOW).errors.maxSends).toMatch(/0 = no limit/);
    expect(validateShareFeature({ everyHours: 1.5 }, null, NOW).ok).toBe(false);
  });
  it('switching on stamps enabled_at once and needs a template; unsent fields keep their saved value', () => {
    expect(validateShareFeature({ enabled: true }, null, NOW).errors.enabled).toMatch(/template/);
    const on = validateShareFeature({ enabled: true, templateId: 't1' }, null, NOW);
    expect(on.value.enabled_at).toBe(NOW);
    const row = { id: SHARE_FEATURE_ID, enabled: true, enabled_at: '2026-11-20T00:00:00Z', template_id: 't1', free_tiers: [{ firstAfterHours: 2, everyHours: 72, maxSends: 5, perRun: 20 }] };
    const again = validateShareFeature({ maxSends: 0 }, row, NOW);
    expect(again.value.enabled_at).toBeUndefined();
    expect(again.value.free_tiers[0]).toEqual({ firstAfterHours: 2, everyHours: 72, maxSends: 0, perRun: 20 });
  });
});

describe('saveShareFeature', () => {
  it('first save creates the default email + the row (off); later saves update it; never two emails', async () => {
    const db = fakeDb();
    const r = await saveShareFeature(db, { everyHours: 24 }, NOW);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.templateCreated).toBe(true);
    expect(db.t.email_templates).toHaveLength(1);
    expect(db.t.email_templates[0].key).toBe('share-feature-promo');
    const row = db.t.automations[0];
    expect(row).toMatchObject({ id: SHARE_FEATURE_ID, enabled: false, channel: 'email', template_id: db.t.email_templates[0].id });
    expect(shareFeatureConfig(row).everyHours).toBe(24);
    const r2 = await saveShareFeature(db, { enabled: true }, NOW);
    expect(r2.created).toBe(false);
    expect(db.t.automations[0]).toMatchObject({ enabled: true, enabled_at: NOW });
    expect(db.t.email_templates).toHaveLength(1);
  });
  it('uses an existing template with the same key (e.g. inserted by the SQL)', async () => {
    const db = fakeDb({ email_templates: [{ id: 'sql-tpl', key: 'share-feature-promo' }] });
    const r = await saveShareFeature(db, {}, NOW);
    expect(r.templateCreated).toBe(false);
    expect(db.t.automations[0].template_id).toBe('sql-tpl');
  });
});

describe('the default email + where it shows up in the admin', () => {
  it('valid template, known variables, demo button, no opt-out line, hyphenated brand', () => {
    expect(validateTemplate(SHARE_FEATURE_TEMPLATE).ok).toBe(true);
    const msg = renderTemplate(SHARE_FEATURE_TEMPLATE, { ...sampleVars, my_listings_url: shareFeatureListingsUrl('https://casa-libre.com.py') }, {});
    expect(msg.html).toContain('href="https://www.youtube.com/watch?v=FcI87hgYEMY"');
    expect(msg.html).toContain('utm_campaign=share_feature');
    const all = Object.values(SHARE_FEATURE_TEMPLATE).join(' ');
    expect(all).not.toMatch(/Casa Libre|BAJA|unsubscribe|Para no recibir/i);
  });
  it('counts, email type, campaigns catalog, template usage, results (incl. the utm_campaign alias)', () => {
    const now = Date.parse(NOW);
    const logs = [
      { dedupe_key: 'sharefeature:a:1', status: 'sent', created_at: new Date(now - 10 * 24 * H).toISOString() },
      { dedupe_key: 'sharefeature:a:2', status: 'sent', created_at: new Date(now - H).toISOString() },
      { dedupe_key: 'sharefeature:b:1', status: 'failed', created_at: NOW },
      { dedupe_key: 'sharefeature-stop:c:ev', status: 'sent', created_at: NOW },
    ];
    expect(shareFeatureCounts(logs, now)).toEqual({ sent: 2, people: 1, last7: 1, stopped: 1 });
    expect(emailType(SHARE_FEATURE_TEMPLATE.subject)).toBe('Share feature announcement');
    expect(keyForEmailType('Share feature announcement')).toBe('share_feature_promo');
    expect(CATALOG.share_feature_promo.group).toBe('sharing');
    expect(templateUsage('t9', [{ id: SHARE_FEATURE_ID, template_id: 't9' }])).toContain('Share feature announcement → email');
    const res = emailResults({
      logs: [{ automation_id: SHARE_FEATURE_ID, status: 'sent', resend_id: 'r1' }, { automation_id: SHARE_FEATURE_ID, channel: 'event', status: 'sent' }],
      resendEvent: new Map([['r1', 'clicked']]),
      landings: [{ campaign: 'share_feature', people: 3, visits: 4 }],
    });
    const row = res.find((r) => r.automation === SHARE_FEATURE_ID);
    expect(row).toMatchObject({ label: 'Share feature announcement', sent: 1, clicked: 1, landed: 3 });
    expect(res.some((r) => r.automation === 'share_feature')).toBe(false);
  });
});
