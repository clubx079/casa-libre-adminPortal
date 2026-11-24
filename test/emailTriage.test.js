import { describe, it, expect } from 'vitest';
import { parseTriage, categoryFromLabels, forwardTargets, viewQuery, parseAddress, ALERTED_LABEL, normalizeRules, invalidEmails, defaultRules, recipientsFor } from '../lib/emailTriageCore.js';

describe('info@ email sorting', () => {
  it('reads the model answer', () => {
    expect(parseTriage('{"category":"marketing","summary":"A cleaning firm offers a service","urgent":true}')).toEqual({ category: 'marketing', summary: 'A cleaning firm offers a service', urgent: false });
    expect(parseTriage('sure: {"category":"Important","summary":"x","urgent":"true"}')).toMatchObject({ category: 'important', urgent: true });
    expect(parseTriage('{"category":"enquiry"}')).toMatchObject({ category: 'important' });
    expect(parseTriage('{"category":"notification"}')).toMatchObject({ category: 'other' });
    expect(parseTriage('{"category":"business"}')).toBeNull();
    expect(parseTriage('no json')).toBeNull();
  });
  it('type from Gmail labels (old labels too)', () => {
    expect(categoryFromLabels(['AI-Spam'])).toBe('spam');
    expect(categoryFromLabels(['AI-Enquiry'])).toBe('important');
    expect(categoryFromLabels(['AI-Notification'])).toBe('other');
    expect(categoryFromLabels(['AI-Business'])).toBeNull();
    expect(categoryFromLabels(['AI-Business', 'AI-Marketing'])).toBe('marketing');
  });
  it('forwarding rules', () => {
    expect(normalizeRules([{ email: ' Omar@AiroSofts.com ', categories: ['important', 'x'] }, { email: 'omar@airosofts.com', categories: ['spam'] }, { email: 'bad', categories: ['important'] }]))
      .toEqual([{ email: 'omar@airosofts.com', categories: ['important', 'spam'] }]);
    expect(invalidEmails([{ email: 'a@b.com' }, { email: 'nope' }, { email: '' }])).toEqual(['nope']);
    expect(defaultRules('a@b.com, c@d.com')).toEqual([{ email: 'a@b.com', categories: ['important'] }, { email: 'c@d.com', categories: ['important'] }]);
    const rules = [{ email: 'a@b.com', categories: ['important'] }, { email: 'm@b.com', categories: ['marketing', 'important'] }];
    expect(recipientsFor('important', rules)).toEqual(['a@b.com', 'm@b.com']);
    expect(recipientsFor('spam', rules)).toEqual([]);
  });
  it('forwards only fresh, incoming, not-yet-forwarded emails, to the right people', () => {
    const now = Date.parse('2026-11-24T20:00:00Z');
    const msg = { date: '2026-11-24T19:30:00Z', sentByUs: false };
    const rules = [{ email: 'a@b.com', categories: ['important'] }, { email: 'm@b.com', categories: ['marketing'] }];
    expect(forwardTargets({ msg, triage: { category: 'important' }, rules, now })).toEqual(['a@b.com']);
    expect(forwardTargets({ msg, triage: { category: 'marketing' }, rules, now })).toEqual(['m@b.com']);
    expect(forwardTargets({ msg, triage: { category: 'other' }, rules, now })).toEqual([]);
    expect(forwardTargets({ msg, triage: { category: 'important' }, labels: [ALERTED_LABEL], rules, now })).toEqual([]);
    expect(forwardTargets({ msg: { ...msg, sentByUs: true }, triage: { category: 'important' }, rules, now })).toEqual([]);
    expect(forwardTargets({ msg: { ...msg, date: '2026-11-20T10:00:00Z' }, triage: { category: 'important' }, rules, now })).toEqual([]);
  });
  it('view queries', () => {
    expect(viewQuery('inbox', { hideJunk: true })).toBe('in:inbox -label:ai-marketing -label:ai-spam');
    expect(viewQuery('sent', { hideJunk: true, search: 'from:x' })).toBe('in:sent from:x');
    expect(viewQuery('important')).toBe('(label:ai-important OR label:ai-enquiry)');
    expect(viewQuery('marketing')).toBe('label:ai-marketing');
  });
  it('addresses', () => {
    expect(parseAddress('Tomas <tomas@casa-limpia.com.py>')).toEqual({ name: 'Tomas', email: 'tomas@casa-limpia.com.py' });
    expect(parseAddress('a@b.com')).toEqual({ name: 'a@b.com', email: 'a@b.com' });
  });
});

import { normalizeBadge, badgeFilter, DEFAULT_BADGE } from '../lib/emailTriageCore.js';
describe('info@ sidebar badge', () => {
  it('keeps known types in order, Important by default', () => {
    expect(normalizeBadge(undefined)).toEqual(DEFAULT_BADGE);
    expect(normalizeBadge(['marketing', 'x', 'important'])).toEqual(['important', 'marketing']);
    expect(normalizeBadge([])).toEqual([]);
  });
  it('counts unread conversations of the chosen types', () => {
    expect(badgeFilter(['important', 'marketing'])).toBe('unread=eq.true&in_trash=eq.false&category=in.(important,marketing)&in_spam=eq.false');
    expect(badgeFilter(['spam'])).toBe('unread=eq.true&in_trash=eq.false&category=in.(spam)');
    expect(badgeFilter([])).toBeNull();
  });
});
