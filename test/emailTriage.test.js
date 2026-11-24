import { describe, it, expect } from 'vitest';
import { parseTriage, categoryFromLabels, shouldAlert, viewQuery, parseAddress, ALERTED_LABEL } from '../lib/emailTriageCore.js';

describe('info@ email sorting', () => {
  it('reads the model answer', () => {
    expect(parseTriage('{"category":"business","summary":"A cleaning firm offers a service","urgent":false}')).toEqual({ category: 'business', summary: 'A cleaning firm offers a service', urgent: false });
    expect(parseTriage('sure: {"category":"Enquiry","summary":"x","urgent":"true"}')).toMatchObject({ category: 'enquiry', urgent: true });
    expect(parseTriage('{"category":"other"}')).toBeNull();
    expect(parseTriage('no json')).toBeNull();
  });
  it('category from Gmail labels', () => {
    expect(categoryFromLabels(['AI-Spam'])).toBe('spam');
    expect(categoryFromLabels(['Work'])).toBeNull();
  });
  it('alerts only fresh, incoming, important, not-yet-alerted emails', () => {
    const now = Date.parse('2026-11-24T20:00:00Z');
    const msg = { date: '2026-11-24T19:30:00Z', sentByUs: false };
    const enq = { category: 'enquiry' };
    expect(shouldAlert({ msg, triage: enq, now })).toBe(true);
    expect(shouldAlert({ msg, triage: { category: 'marketing' }, now })).toBe(false);
    expect(shouldAlert({ msg, triage: enq, labels: [ALERTED_LABEL], now })).toBe(false);
    expect(shouldAlert({ msg: { ...msg, sentByUs: true }, triage: enq, now })).toBe(false);
    expect(shouldAlert({ msg: { ...msg, date: '2026-11-20T10:00:00Z' }, triage: enq, now })).toBe(false);
  });
  it('view queries', () => {
    expect(viewQuery('inbox', { hideJunk: true })).toBe('in:inbox -label:ai-marketing -label:ai-spam');
    expect(viewQuery('sent', { hideJunk: true, search: 'from:x' })).toBe('in:sent from:x');
    expect(viewQuery('important')).toBe('(label:ai-enquiry OR label:ai-business)');
  });
  it('addresses', () => {
    expect(parseAddress('Tomas <tomas@casa-limpia.com.py>')).toEqual({ name: 'Tomas', email: 'tomas@casa-limpia.com.py' });
    expect(parseAddress('a@b.com')).toEqual({ name: 'a@b.com', email: 'a@b.com' });
  });
});
