import { describe, it, expect } from 'vitest';
import { aiRef, answerRef, aiLink, SITE_PAGES } from '../lib/aiLinks';
import { recipientRef } from '../lib/waCampaigns';

describe('tracked links in the assistant\'s replies', () => {
  it('the person\'s code is the campaigns\' code on their phone', () => {
    expect(aiRef('+595 981 123 456')).toBe(recipientRef('+595981123456'));
    expect(aiRef('')).toBe('');
  });
  it('one reply = the inbound message it answers', () => {
    expect(answerRef('msg_8eab69b9ba6149be88dceaee')).toBe('be88dceaee');
    expect(answerRef('')).toMatch(/^m[0-9a-z]+$/);
  });
  it('a same-site path through /r/ai, with the person and the reply', () => {
    expect(aiLink('https://casa-libre.com.py/', '/publicar', { ref: 'abc123', answer: 'be88dceaee' })).toBe('https://casa-libre.com.py/r/ai?u=/publicar&r=abc123&a=be88dceaee');
    expect(aiLink('https://casa-libre.com.bo', '/cuenta/publicaciones?pay_listing=1')).toBe('https://casa-libre.com.bo/r/ai?u=/cuenta/publicaciones%3Fpay_listing%3D1');
    // never another domain
    expect(aiLink('https://casa-libre.com.py', 'https://evil.com')).toBe('https://casa-libre.com.py/');
    expect(aiLink('https://casa-libre.com.py', '//evil.com')).toBe('https://casa-libre.com.py/');
  });
  it('the pages it can link to', () => {
    for (const k of ['publish_a_property', 'my_listings', 'my_drafts', 'buy', 'rent', 'faq', 'download_the_app']) expect(SITE_PAGES[k]).toMatch(/^\//);
  });
});
