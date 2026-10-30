import { describe, it, expect } from 'vitest';
import { toE164, cleanAudience, audienceCounts, neededFields, missingValue, relayVariables, variablesProblem, previewText, campaignSlug, matchCampaignMessage, campaignResults, skipReason, pickBatch, retargetRows, simulateRecipients, liveProblem, isSimPhone, SIM_PHONES, audienceLabel } from '../lib/waCampaigns.js';

describe('audience', () => {
  it('cleans phones, de-duplicates, keeps the first name', () => {
    const a = cleanAudience([{ phone: '0981 123 456', name: 'Ana Pérez' }, { phone: '+595981123456', name: 'dup' }, { phone: '12' }, { phone: '+15035551234' }], '595');
    expect(a.invalid).toBe(1);
    expect(a.recipients.map((r) => r.phone)).toEqual(['+595981123456', '+15035551234']);
    expect(a.recipients[0]).toMatchObject({ name: 'Ana Pérez', first_name: 'Ana' });
    expect(toE164('595981123456')).toBe('+595981123456');
  });
  it('everyone except opted-out receives it (Relay rule since 2026-10-29: no opt-in needed); +1 skipped for marketing', () => {
    const rec = ['+595981000001', '+595981000002', '+595981000003', '+595981000004', '+15035551234'].map((phone) => ({ phone }));
    const optIn = new Map([['+595981000001', 'opted_in'], ['+595981000002', 'opted_out'], ['+595981000004', 'opted_in'], ['+15035551234', 'opted_in']]);
    // 03 never opted in: still receives it (counted under noOptIn for the team)
    expect(audienceCounts(rec, optIn, new Set(['+595981000004']), { marketing: true })).toEqual({ total: 5, willReceive: 2, noOptIn: 1, optedOut: 2, usMarketing: 1, missingValue: 0 });
    expect(audienceCounts(rec, optIn, new Set(), { marketing: false }).willReceive).toBe(4);
    expect(skipReason({ phone: '+595981000003' }, optIn)).toBeNull();
    expect(skipReason({ phone: '+595999000001', real_phone: '+595981000009' }, optIn, new Set(['+595981000009']))).toBe('opted_out');
  });
  it('contacts missing a mapped value are skipped (Relay rule)', () => {
    const map = { body: [{ source: 'contact.first_name' }, { source: 'static', text: 'x' }], button: { source: 'contact.email' } };
    expect(neededFields(map).sort()).toEqual(['email', 'first_name']);
    expect(missingValue({ first_name: 'Ana', email: '' }, ['first_name', 'email'])).toBe(true);
    const rec = [{ phone: '+595981000001', first_name: 'Ana', email: 'a@x.com' }, { phone: '+595981000002', first_name: null, email: 'b@x.com' }];
    const opt = new Map(rec.map((r) => [r.phone, 'opted_in']));
    expect(audienceCounts(rec, opt, new Set(), { fields: neededFields(map) })).toMatchObject({ willReceive: 1, missingValue: 1 });
  });
});

describe('batches', () => {
  const leads = Array.from({ length: 250 }, (_, i) => ({ phone: `+595981${String(100000 + i)}`, name: `Lead ${i + 1}`, key: `lead:${i + 1}` }));
  it('first N, then the next N skipping who an earlier batch had', () => {
    const b1 = pickBatch(leads, { size: 100 });
    expect(b1).toMatchObject({ total: 250, already: 0, left: 150, from: 1, to: 100 });
    expect(b1.batch[0].name).toBe('Lead 1');
    const b2 = pickBatch(leads, { size: 100, done: new Set(b1.batch.map((r) => r.key)) });
    expect(b2).toMatchObject({ already: 100, left: 50, from: 101, to: 200 });
    expect(b2.batch[0].name).toBe('Lead 101');
    const b3 = pickBatch(leads, { size: 100, done: new Set([...b1.batch, ...b2.batch].map((r) => r.key)) });
    expect(b3).toMatchObject({ from: 201, to: 250, left: 0 });
    expect(pickBatch(leads, { size: 0 }).batch).toHaveLength(250);   // 0 = everyone
  });
  it('re-send to an earlier batch: everyone / didn\'t read / read, no reply / no click / replied', () => {
    const rows = [
      { phone: '+595999000001', status: 'read', meta: { key: 'lead:1', name: 'A', sim: true, real_phone: '+595981100000', replied_at: 'x' } },
      { phone: '+595981100001', status: 'read', meta: { key: 'lead:2', name: 'B', clicked_at: 'x' } },
      { phone: '+595981100002', status: 'delivered', meta: { key: 'lead:3', name: 'C' } },
      { phone: '+595981100003', status: 'failed', meta: { key: 'lead:4', skipped: 'opted_out' } },
    ];
    expect(retargetRows(rows, 'all').map((r) => r.key)).toEqual(['lead:1', 'lead:2', 'lead:3']);
    expect(retargetRows(rows, 'all')[0].phone).toBe('+595981100000');   // the real number back, not the simulation one
    expect(retargetRows(rows, 'not_read').map((r) => r.key)).toEqual(['lead:3']);
    expect(retargetRows(rows, 'read_no_reply').map((r) => r.key)).toEqual(['lead:2']);
    expect(retargetRows(rows, 'not_clicked').map((r) => r.key)).toEqual(['lead:1', 'lead:3']);
    expect(retargetRows(rows, 'replied').map((r) => r.key)).toEqual(['lead:1']);
  });
  it('test mode puts leads / users on the 10 simulation numbers; pasted numbers stay', () => {
    const sim = simulateRecipients([...leads.slice(0, 12), { phone: '+923362771289', key: null }]);
    expect(sim.slice(0, 12).every((r) => r.sim && isSimPhone(r.phone))).toBe(true);
    expect(sim[0].phone).toBe(SIM_PHONES[0]);
    expect(sim[10].phone).toBe(SIM_PHONES[0]);   // round robin
    expect(sim[0].real_phone).toBe('+595981100000');
    expect(sim[12]).toEqual({ phone: '+923362771289', key: null });
  });
  it('live never sends to the simulation numbers, nor to leads while that is off', () => {
    expect(liveProblem([{ phone: '+595999000003' }])).toMatch(/simulation/);
    expect(liveProblem([leads[0]])).toMatch(/leads are switched off/);
    expect(liveProblem([leads[0]], { leadsLive: true })).toBeNull();
    expect(liveProblem([{ phone: '+923362771289', key: '+923362771289' }])).toBeNull();
  });
  it('labels the batch', () => {
    expect(audienceLabel({ source: 'leads', segment: 'agent', range: { from: 101, to: 200, of: 1195 } })).toBe('Leads · Agents · #101–200 of 1,195');
    expect(audienceLabel({ source: 'batch', from_batch_name: 'Agentes — lote 1', batch_filter: 'not_read' })).toBe('Again: Agentes — lote 1 · Didn\'t read it');
    expect(audienceLabel({ source: 'phones' })).toBe('Pasted numbers');
  });
});

describe('variables', () => {
  const tpl = { variables: { body: 2, url_buttons: [0] } };
  it('tracked button: /r/wa?sell=1&b=<batch> — no contact field needed, never re-tagged', () => {
    const map = { body: [{ source: 'contact.first_name' }], button: { source: 'tracked' } };
    expect(relayVariables(map, 'wc-agentes-lote-2-ab12').buttons).toEqual([{ index: 0, source: 'static:wa?sell=1&b=wc-agentes-lote-2-ab12' }]);
    expect(neededFields(map)).toEqual(['first_name']);
    expect(variablesProblem({ variables: { body: 1, url_buttons: [0] } }, map)).toBeNull();
  });
  it('header variables (Relay: variables.header is an array, like body)', () => {
    expect(relayVariables({ header: [{ source: 'static', text: 'Octubre' }], body: [] }).header).toEqual(['static:Octubre']);
    expect(variablesProblem({ variables: { header: 1, body: 0 } }, { header: [] })).toMatch(/Header \{\{1\}\}/);
  });
  it('maps to Relay sources, static text, and a click-tracked button', () => {
    const v = relayVariables({ body: [{ source: 'contact.first_name' }, { source: 'static', text: '20 de octubre' }], button: { source: 'static', text: 'abc-123' } }, 'wc-promo-x1');
    expect(v).toEqual({ body: ['contact.first_name', 'static:20 de octubre'], buttons: [{ index: 0, source: 'static:abc-123?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=wc-promo-x1' }] });
    expect(relayVariables({ body: [], button: { source: 'static', text: 'p?x=1', track: true } }, 's').buttons[0].source).toBe('static:p?x=1&utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=s');
  });
  it('every variable must be filled', () => {
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }] })).toMatch(/Body \{\{2\}\}/);
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }, { source: 'static', text: ' ' }] })).toMatch(/text for Body \{\{2\}\}/);
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }, { source: 'contact.email' }] })).toMatch(/button/);
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }, { source: 'contact.email' }], button: { source: 'contact.phone' } })).toBeNull();
  });
  it('preview fills the sample contact', () => {
    expect(previewText('Hola {{1}}, tu {{2}} y {{3}}', { body: [{ source: 'contact.first_name' }, { source: 'static', text: 'casa' }] })).toBe('Hola María, tu casa y {{3}}');
  });
  it('slug for utm_campaign', () => {
    expect(campaignSlug('Promo Octubre 2026 — Asunción', 'ab12')).toBe('wc-promo-octubre-2026-asuncion-ab12');
  });
});

describe('results', () => {
  const sentAt = '2026-10-20T22:42:43.000Z';
  const msgs = [
    { direction: 'inbound', kind: 'inbound', timestamps: { created: '2026-10-20T22:50:00Z' } },
    { direction: 'outbound', kind: 'campaign', template: { name: 'cl_cuenta_lista' }, status: 'read', timestamps: { created: '2026-10-20T22:42:43.836Z' } },
    { direction: 'outbound', kind: 'campaign', template: { name: 'cl_cuenta_lista' }, status: 'read', timestamps: { created: '2026-10-01T10:00:00Z' } },  // an older campaign
    { direction: 'outbound', kind: 'template', template: { name: 'cl_cuenta_lista' }, status: 'sent', timestamps: { created: '2026-10-20T22:45:00Z' } },  // an automation, not the campaign
  ];
  it('finds this campaign\'s message and a reply after it', () => {
    const m = matchCampaignMessage(msgs, { template: 'cl_cuenta_lista', sentAt });
    expect(m.message.timestamps.created).toBe('2026-10-20T22:42:43.836Z');
    expect(m.replied_at).toBe('2026-10-20T22:50:00.000Z');
    expect(matchCampaignMessage(msgs, { template: 'cl_visitas', sentAt })).toBeNull();
  });
  it('totals: waiting / skipped / sent / delivered / read / failed / replied / clicked', () => {
    const r = campaignResults([
      { status: 'read', meta: { replied_at: 'x' } }, { status: 'delivered' }, { status: 'sent' }, { status: 'failed' },
      { status: 'sending' }, { status: 'failed', meta: { skipped: 'no_opt_in' } },
    ], 1);
    expect(r).toMatchObject({ recipients: 6, waiting: 1, skipped: 1, sent: 4, delivered: 2, read: 1, failed: 1, replied: 1, clicked: 1, readRate: 50, replyRate: 50 });
  });
  it('clicks: PostHog people or recipients marked clicked, whichever is larger', () => {
    const rows = [{ status: 'read', meta: { clicked_at: 'x' } }, { status: 'read', meta: { clicked_at: 'y' } }, { status: 'delivered' }];
    expect(campaignResults(rows, 1)).toMatchObject({ clicked: 2, clickRate: 66.7, readRate: 66.7 });
    expect(campaignResults(rows, 3).clicked).toBe(3);
  });
});
