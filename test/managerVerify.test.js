import { describe, it, expect } from 'vitest';
import { numbersIn, knownNumbers, isKnown, getPath, verifyBrief } from '../lib/manager/verify.js';
import { BRIEF_SCHEMA, BRIEF_PARTS, slimPack } from '../lib/manager/brief.js';

const pack = {
  listings: { newThisWeek: { total: 14 }, newPreviousWeek: { total: 9 } },
  traffic: { funnel: [{ step: 'Visited', thisWeek: 1187, previousWeek: 950, changePct: 24.9 }] },
  messageTiming: { rows: [{ automation: 'no_listing_nudge', sent: 4, clicked: 0, clickRate: 0 }] },
};

describe('numbersIn', () => {
  it('finds numbers, skips dates, times, years, versions and ids', () => {
    expect(numbersIn('14 vs 9 listings, +55.6%, US$1,200')).toEqual([14, 9, 55.6, 1200]);
    expect(numbersIn('since Oct 21, 2026-10-21 at 07:00, app 1.4.0, year 2026')).toEqual([]);
    expect(numbersIn('user v2 id abc123')).toEqual([]);
  });
});

describe('known numbers', () => {
  const known = knownNumbers(pack);
  it('accepts leaves, sibling differences and percentages, with rounding', () => {
    expect(isKnown(14, known)).toBe(true);
    expect(isKnown(237, known)).toBe(true); // 1187 - 950
    expect(isKnown(25, known)).toBe(true); // 24.9 rounded
    expect(isKnown(1200, known)).toBe(true); // 1187 written as ~1,200
    expect(isKnown(3, known)).toBe(true); // policy number (free listings)
  });
  it('rejects invented numbers', () => {
    expect(isKnown(4321, known)).toBe(false);
    expect(isKnown(63, known)).toBe(false);
  });
});

describe('getPath', () => {
  it('reads dotted paths and array entries by step / automation', () => {
    expect(getPath(pack, 'listings.newThisWeek.total')).toBe(14);
    expect(getPath(pack, 'traffic.funnel[0].thisWeek')).toBe(1187);
    expect(getPath(pack, 'traffic.funnel.Visited.thisWeek')).toBe(1187);
    expect(getPath(pack, 'messageTiming.rows.no_listing_nudge.clickRate')).toBe(0);
    expect(getPath(pack, 'nope.x')).toBeUndefined();
  });
});

describe('verifyBrief', () => {
  it('flags actions with numbers not in the data, drops such points, resolves facts by code', () => {
    const { brief, guard } = verifyBrief({
      headline: 'Listings up 14 vs 9',
      points: ['Visitors 1187, up 237', 'Sign-ups jumped to 4321'],
      actions: [
        { title: 'Fix no-listing email', why: '4 sent, 0 clicks', how: 'Bigger button', facts: ['messageTiming.rows.no_listing_nudge.sent', 'bad.path'] },
        { title: 'Boost rentals', why: '63% of views are rentals', how: 'Shift budget', facts: [] },
      ],
      followup_checks: [{ key: 'k', status: 'fixed', evidence: 'clicks 0 to 0', facts: [] }],
      tahir: { facts: ['Spend US$999'], actions: ['Add rentals ad group'] },
    }, { pack });
    expect(brief.headline_verified).toBe(true);
    expect(brief.points).toEqual(['Visitors 1187, up 237']);
    expect(brief.actions[0]).toMatchObject({ verified: true, evidence: [{ path: 'messageTiming.rows.no_listing_nudge.sent', value: 4 }] });
    expect(brief.actions[1]).toMatchObject({ verified: false, unverified: [63] });
    expect(brief.tahir).toEqual({ facts: [], actions: ['Add rentals ad group'] });
    expect(guard.badFacts).toBe(1);
    expect(guard.removedPoints).toEqual(['Sign-ups jumped to 4321', 'Spend US$999']);
  });
});

describe('action numbers come from the data the action cites', () => {
  it('a number that exists elsewhere in the pack but not in its facts is flagged', () => {
    const { brief } = verifyBrief({
      headline: '', points: [],
      actions: [
        { title: 'More listings', why: 'Listings 14 vs 9, up 5 (55.6%)', how: 'Remind at 24 h', facts: ['listings.newThisWeek.total'] },
        { title: 'More listings', why: 'Listings 14 vs 1187', how: '', facts: ['listings.newThisWeek.total'] },
      ],
    }, { pack });
    expect(brief.actions[0]).toMatchObject({ verified: true, unverified: [] });
    expect(brief.actions[1]).toMatchObject({ verified: false, unverified: [1187] });
  });
});

describe('area sections', () => {
  it('keep points backed by their facts, drop the rest', () => {
    const { brief } = verifyBrief({
      headline: '', points: [], actions: [],
      sections: [{ id: 'listings', headline: 'Listings 14 vs 9', trend: 'better', points: ['Up 5 this week', 'Sign-ups 4321'], facts: ['listings.newThisWeek.total'] }],
    }, { pack });
    expect(brief.sections[0]).toMatchObject({ points: ['Up 5 this week'], headline_verified: true, evidence: [{ path: 'listings.newThisWeek.total', value: 14 }] });
  });
});

describe('brief schema', () => {
  it('is strict JSON schema without nullable fields', () => {
    const walk = (n) => {
      if (n && typeof n === 'object') {
        expect(n.anyOf).toBeUndefined();
        if (n.type === 'object') { expect(n.additionalProperties).toBe(false); expect(n.required).toEqual(Object.keys(n.properties)); }
        Object.values(n).forEach(walk);
      }
    };
    walk(BRIEF_SCHEMA);
  });
  it('the two parts (the API limits grammar size) cover every field exactly once', () => {
    const keys = BRIEF_PARTS.flatMap((p) => p.keys);
    expect([...keys].sort()).toEqual(Object.keys(BRIEF_SCHEMA.properties).sort());
    for (const p of BRIEF_PARTS) expect(p.schema.required).toEqual(Object.keys(p.schema.properties));
  });
  it('slimPack drops what the AI does not need', () => {
    const p = slimPack({ generatedAt: 'x', previousReport: {}, automations: { settings: [{ id: 'manager_memory' }, { id: 'welcome', enabled: true, template_id: 't', updated_at: 'u' }] } });
    expect(p.generatedAt).toBeUndefined();
    expect(p.previousReport).toBeUndefined();
    expect(p.automations.settings.map((x) => x.id)).toEqual(['welcome']);
    expect(p.automations.settings[0].template_id).toBeUndefined();
  });
});
