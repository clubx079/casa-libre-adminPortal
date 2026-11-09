// WhatsApp marketing → Sent campaigns: one line per audience adding up all of its live batches.
// A batch skips everyone an earlier batch reached, so the batches add up to distinct people.
// "Send again" batches (source 'batch') re-message the same people, so they don't count here,
// nor do test and demo batches. Pure, test/waCampaignTotals.test.js.
const AUDIENCES = [['agent', 'Agents'], ['agency', 'Agencies'], ['developer', 'Developers']];

const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);

export function audienceTotals(campaigns = []) {
  return AUDIENCES.map(([segment, label]) => {
    const batches = campaigns.filter((c) => c.mode === 'live' && !c.demo && c.audience_def?.source === 'leads' && c.audience_def?.segment === segment);
    const sum = (read) => batches.reduce((a, c) => a + (Number(read(c)) || 0), 0);
    const reached = sum((c) => c.results?.recipients);
    const delivered = sum((c) => c.results?.delivered);
    const read = sum((c) => c.results?.read);
    const clicked = sum((c) => c.results?.clicked);
    const landed = sum((c) => c.landed);
    const signedIn = sum((c) => c.signed_in?.total);
    return {
      segment, label, batches: batches.length, reached, delivered, read, clicked, landed, signedIn,
      deliveredRate: pct(delivered, reached), readRate: pct(read, delivered), clickedRate: pct(clicked, delivered),
      landedRate: pct(landed, delivered), signedInRate: pct(signedIn, delivered),
    };
  }).filter((t) => t.batches > 0);
}
