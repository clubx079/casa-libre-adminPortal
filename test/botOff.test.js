import { describe, it, expect } from 'vitest';
import { botOff, BOT_OFF_TAG, isInternalTag, visibleTags } from '../lib/inboxRules';
import { salesBlocked } from '../lib/inboxWindowCore.js';

describe('Inbox → Bot: On / Off', () => {
  it('the bot-off tag marks the chat and stays hidden from the free tags', () => {
    expect(BOT_OFF_TAG).toBe('bot-off');
    expect(botOff({ tags: ['bot-off', 'ai-answered'] })).toBe(true);
    expect(botOff({ tags: ['ai-answered'] })).toBe(false);
    expect(botOff(null)).toBe(false);
    expect(isInternalTag('bot-off')).toBe(true);
    expect(visibleTags(['bot-off', 'vip'])).toEqual(['vip']);
  });
  it('no automatic sales message in a bot-off chat', () => {
    expect(salesBlocked({ conv: { tags: ['bot-off'] }, messages: [] })).toBe('bot_off');
    expect(salesBlocked({ conv: { tags: [] }, messages: [] })).toBe(null);
  });
});
