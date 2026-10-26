import { describe, it, expect } from 'vitest';
import { emailResults } from '../lib/emailResults.js';

describe('automation email results', () => {
  it('sent → clicked (Resend) → landed / signed up / listed / paid (PostHog), WhatsApp apart', () => {
    const logs = [
      { automation_id: 'draft_reminders', channel: 'email', status: 'sent', resend_id: 'r1' },
      { automation_id: 'draft_reminders', channel: 'email', status: 'sent', resend_id: 'r2' },
      { automation_id: 'draft_reminders', channel: 'email', status: 'failed' },
      { automation_id: 'draft_reminders', channel: 'whatsapp', status: 'read' },
      { automation_id: 'draft_reminders', channel: 'whatsapp', status: 'delivered' },
      { automation_id: 'newsletter', channel: 'email', status: 'sent' },        // not an automation
      { automation_id: 'listing_views_milestone', channel: 'email', status: 'sending' },   // never went out
    ];
    const rows = emailResults({
      logs,
      resendEvent: new Map([['r1', 'clicked'], ['r2', 'opened']]),
      landings: [{ campaign: 'draft_reminders', people: 1, visits: 3, signedUp: 0, listed: 1, paid: 0 }, { campaign: '?', people: 9 }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ automation: 'draft_reminders', label: 'Unfinished draft reminders', sent: 2, failed: 1, clicked: 1, clickRate: 50, landed: 1, visits: 3, listed: 1, whatsappSent: 2, whatsappRead: 1, readRate: 50, landedRate: 50 });
    expect(rows[1]).toMatchObject({ automation: 'listing_views_milestone', sent: 0, clickRate: null });
  });
});
