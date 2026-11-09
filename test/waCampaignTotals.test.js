import { describe, it, expect } from 'vitest';
import { audienceTotals } from '../lib/waCampaignTotals';

const batch = (segment, r, extra = {}) => ({ mode: 'live', audience_def: { source: 'leads', segment }, results: r, landed: 0, signed_in: { total: 0 }, ...extra });

describe('audienceTotals', () => {
  const rows = [
    batch('agent', { recipients: 250, delivered: 240, read: 30, clicked: 6 }, { landed: 8, signed_in: { total: 2 } }),
    batch('agent', { recipients: 50, delivered: 40, read: 10, clicked: 2 }, { landed: 4, signed_in: { total: 1 } }),
    batch('agency', { recipients: 37, delivered: 20, read: 5, clicked: 0 }),
  ];
  it('adds up every batch of an audience', () => {
    const [agents] = audienceTotals(rows);
    expect(agents).toMatchObject({ label: 'Agents', batches: 2, reached: 300, delivered: 280, read: 40, clicked: 8, landed: 12, signedIn: 3 });
  });
  it('gives each share: delivered of reached, the rest of delivered', () => {
    const [a] = audienceTotals(rows);
    expect(a.deliveredRate).toBe(93.3);
    expect(a.readRate).toBe(14.3);
    expect(a.clickedRate).toBe(2.9);
    expect(a.landedRate).toBe(4.3);
    expect(a.signedInRate).toBe(1.1);
  });
  it('leaves out test, demo and send-again batches so nobody is counted twice', () => {
    const out = audienceTotals([
      batch('agent', { recipients: 10, delivered: 10 }),
      batch('agent', { recipients: 99, delivered: 99 }, { mode: 'test' }),
      batch('agent', { recipients: 99, delivered: 99 }, { demo: true }),
      { ...batch('agent', { recipients: 99, delivered: 99 }), audience_def: { source: 'batch' } },
    ]);
    expect(out[0].reached).toBe(10);
    expect(out[0].batches).toBe(1);
  });
  it('shows only audiences that have live batches', () => {
    expect(audienceTotals(rows).map((t) => t.segment)).toEqual(['agent', 'agency']);
    expect(audienceTotals([])).toEqual([]);
  });
  it('has no percentage when nothing was delivered yet', () => {
    expect(audienceTotals([batch('agent', { recipients: 5, delivered: 0 })])[0].readRate).toBeNull();
  });
});
