import { describe, it, expect } from 'vitest';
import { fixThreads, isFixed, planFollowups, emailCore, followupDraft, escalationAction, MAX_SENDS } from '../lib/manager/fixFollowups.js';

const U = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const sent = (at, extra = {}) => ({ status: 'sent', kind: 'listing_fix', user_id: U, property_id: P, sent_at: at, subject: 'Revisá el precio de tu casa', body: 'Hola Ana:\n\nFigura en alquiler por ₲900.000.000.\n\nLo cambiás desde Mis publicaciones.\n\nEl equipo de Casa Libre', reason: 'Rent at a sale price', ...extra });
const DAY = 86400e3;
const NOW = Date.parse('2026-10-30T12:00:00Z');

describe('fix follow-ups', () => {
  it('groups the fix emails per seller + listing, oldest first; ignores others', () => {
    const t = fixThreads([
      { id: 'r2', created_at: '2026-10-26', actions: [sent('2026-10-26T12:00:00Z'), { ...sent('2026-10-26'), kind: 'stuck_draft' }] },
      { id: 'r1', created_at: '2026-10-23', actions: [sent('2026-10-23T12:00:00Z'), { ...sent('2026-10-23'), status: 'dismissed' }] },
    ]);
    expect([...t.values()].length).toBe(1);
    expect(t.get(`${U}:${P}`).sends.map((s) => s.at)).toEqual(['2026-10-23T12:00:00Z', '2026-10-26T12:00:00Z']);
  });

  it('fixed = edited after our first email, or the listing is gone', () => {
    const t = { sends: [{ at: '2026-10-23T12:00:00Z' }] };
    expect(isFixed(t, null)).toBe(true);
    expect(isFixed(t, { raw_data: {} })).toBe(false);
    expect(isFixed(t, { raw_data: { edits: [{ at: '2026-10-20T00:00:00Z' }] } })).toBe(false);   // edited BEFORE we wrote
    expect(isFixed(t, { raw_data: { edits: [{ at: '2026-10-24T00:00:00Z' }] } })).toBe(true);
  });

  it('resends while under the limit and ≥ 40 h after the last one; escalates at the limit', () => {
    const listing = { raw_data: {} };
    const map = new Map([[P, listing]]);
    const one = fixThreads([{ id: 'r', created_at: 'x', actions: [sent(new Date(NOW - 3 * DAY).toISOString())] }]);
    expect(planFollowups(one, map, NOW).resend.length).toBe(1);
    const recent = fixThreads([{ id: 'r', created_at: 'x', actions: [sent(new Date(NOW - 20 * 3600e3).toISOString())] }]);
    expect(planFollowups(recent, map, NOW)).toEqual({ resend: [], escalate: [] });   // too soon
    const four = fixThreads([{ id: 'r', created_at: 'x', actions: Array.from({ length: MAX_SENDS }, (_, i) => sent(new Date(NOW - (10 - i) * DAY).toISOString())) }]);
    const plan = planFollowups(four, map, NOW);
    expect(plan.resend.length).toBe(0);
    expect(plan.escalate.length).toBe(1);
    const fixed = new Map([[P, { raw_data: { edits: [{ at: new Date(NOW - DAY).toISOString() }] } }]]);
    expect(planFollowups(four, fixed, NOW)).toEqual({ resend: [], escalate: [] });
  });

  it('the reminder quotes the first email without its greeting / signature, and links to Editar', () => {
    expect(emailCore('Hola Ana:\n\nFigura en alquiler.\n\nEl equipo de Casa Libre')).toBe('Figura en alquiler.');
    expect(emailCore('Hola Ana:\n\nGracias por publicar. Ya tiene 10 visitas.\n\nFigura en alquiler.\n\nLo cambiás desde Mis publicaciones. Si querés ayuda, escribinos.\n\nEl equipo de Casa Libre')).toBe('Figura en alquiler.');
    const t = fixThreads([{ id: 'r', created_at: 'x', actions: [sent('2026-10-23T12:00:00Z')] }]).get(`${U}:${P}`);
    const d = followupDraft(t, { listing: { property_type: 'Otro', neighborhood: 'Km 7 Monday' }, user: { full_name: 'Ana Pérez' }, site: 'https://casa-libre.com.py' });
    expect(d.subject).toBe('Recordatorio: Revisá el precio de tu casa');
    expect(d.body).toMatch(/^Hola Ana:/);
    expect(d.body).toMatch(/Te escribimos el 23 de octubre sobre tu publicación \(Otro en Km 7 Monday\)/);
    expect(d.body).toMatch(/Figura en alquiler por ₲900\.000\.000/);
    expect(d.body).toMatch(/\*\*Editar\*\*/);
    expect(d.button_url).toBe('https://casa-libre.com.py/cuenta/publicaciones');
    expect(d.followup).toBe(1);
    const t2 = { ...t, sends: [...t.sends, { ...t.sends[0], subject: 'Recordatorio: Revisá el precio de tu casa', at: '2026-10-26T12:00:00Z' }] };
    expect(followupDraft(t2, { listing: {}, user: {}, site: 'https://x.py' }).subject).toBe('Recordatorio: Revisá el precio de tu casa');   // never "Recordatorio: Recordatorio:"
  });

  it('the Omar action says who, what and when', () => {
    const four = fixThreads([{ id: 'r', created_at: 'x', actions: ['2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30'].map((d) => sent(`${d}T12:00:00Z`)) }]).get(`${U}:${P}`);
    const a = escalationAction(four, { listing: { property_type: 'Otro', neighborhood: 'Km 7 Monday', contact_phone: '+595981314522' }, user: { full_name: 'Inocencia Gómez' } });
    expect(a.owner).toBe('Omar');
    expect(a.title).toBe("Inocencia Gómez hasn't fixed their listing after 4 emails");
    expect(a.why).toBe('Rent at a sale price — Otro en Km 7 Monday. Emailed 10-23, 10-26, 10-28, 10-30; no edit since.');
    expect(a.how).toMatch(/\+595981314522/);
    expect(a.key).toBe('fix-unfixed-22222222');
  });
});
