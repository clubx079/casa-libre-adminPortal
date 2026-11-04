import { describe, it, expect } from 'vitest';

describe('inbox list names', () => {
  it('search finds a chat by our DB name or by the WhatsApp name', async () => {
    const { filterConversations } = await import('../lib/inboxRules.js');
    const list = [{ phone: '+595992702850', name: 'Daniel Famoso', wa_name: 'Canell', status: 'open', sites: ['py'], country: 'py', last_message: {} }];
    expect(filterConversations(list, { q: 'canell', status: 'all' }).data.length).toBe(1);
    expect(filterConversations(list, { q: 'famoso', status: 'all' }).data.length).toBe(1);
  });
});
