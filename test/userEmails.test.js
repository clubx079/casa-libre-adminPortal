import { describe, it, expect } from 'vitest';
import { mergeUserEmails, userEmailSummary, CODE_TYPES, englishTemplateName, templateValues, fillTemplate } from '../lib/userEmails.js';

const ME = 'ana@gmail.com';
const resendRows = [
  { id: 'r1', to: ['Ana@Gmail.com'], subject: '123456 es tu código de Casa Libre', last_event: 'delivered', created_at: '2026-10-01T10:00:00Z' },
  { id: 'r2', to: ['ana@gmail.com'], subject: 'Bienvenido a Casa Libre', last_event: 'opened', created_at: '2026-10-01T10:01:00Z' },
  { id: 'r3', to: ['ana@gmail.com'], subject: 'Tu propiedad está publicada en Casa Libre', last_event: 'clicked', created_at: '2026-10-01T11:00:00Z' },
  { id: 'r4', to: ['ana@gmail.com'], subject: '¡Tu propiedad ya está en la portada!', last_event: 'delivered', created_at: '2026-10-04T18:05:03Z' },
  { id: 'r5', to: ['someone@else.com'], subject: 'Bienvenido a Casa Libre', last_event: 'opened', created_at: '2026-10-02T09:00:00Z' },
];
const logRows = [
  // r4 is an automation email: the log names its template
  { id: 'l1', to_email: 'ana@gmail.com', template_key: 'first-listing-gift', subject: '¡Tu propiedad ya está en la portada!', resend_id: 'r4', status: 'sent', created_at: '2026-10-04T18:05:03Z' },
  // older automation email Resend no longer lists → still shown, status from our log
  { id: 'l2', to_email: 'ANA@gmail.com', template_key: 'listing-views', subject: 'Tu propiedad tiene 50 visitas', resend_id: 'r-old', status: 'sent', created_at: '2026-09-01T12:00:00Z' },
  // an admin test send is never a real email to the user
  { id: 'l3', to_email: 'ana@gmail.com', template_key: 'first-listing-gift', subject: 'test', resend_id: 'r-test', status: 'test', created_at: '2026-09-30T12:00:00Z' },
];
const templateNames = { 'first-listing-gift': 'Primera publicación — regalo portada', 'listing-views': 'Tu propiedad tiene visitas' };

describe('mergeUserEmails', () => {
  const rows = mergeUserEmails({ email: ' Ana@gmail.com ', resendRows, logRows, templateNames });

  it('keeps only this person, newest first, with test sends left out', () => {
    expect(rows.map((r) => r.id)).toEqual(['r4', 'r3', 'r2', 'r1', 'r-old']);
  });
  it('names automation emails by their template and the rest by subject', () => {
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.r4).toMatchObject({ type: 'Primera publicación — regalo portada', template_key: 'first-listing-gift', automation: true, status: 'delivered', tracked: true });
    expect(by.r3).toMatchObject({ type: 'Listing published', automation: false, status: 'clicked' });
    expect(by.r1.type).toBe('Sign-in code');
    expect(by['r-old']).toMatchObject({ type: 'Tu propiedad tiene visitas', automation: true, status: 'sent', tracked: false });
  });
  it('works with only our log (no Resend read key)', () => {
    const only = mergeUserEmails({ email: ME, resendRows: [], logRows, templateNames });
    expect(only.map((r) => r.id)).toEqual(['r4', 'r-old']);
    expect(only.every((r) => r.tracked === false)).toBe(true);
  });
});

describe('emails sent before open tracking was switched on', () => {
  const tracking = { on: true, since: '2026-10-02T00:00:00Z' };
  const rows = mergeUserEmails({ email: ME, resendRows, logRows, templateNames, tracking });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  it('are not tracked, and say why', () => {
    expect(by.r4).toMatchObject({ tracked: true, untracked: null });
    expect(by.r3).toMatchObject({ tracked: false, untracked: 'before' });
    expect(by['r-old']).toMatchObject({ tracked: false, untracked: 'log' });
  });
  it('still count as delivered, but stay out of the open / click rates', () => {
    expect(userEmailSummary(rows)).toEqual({ total: 5, codes: 1, listed: 3, delivered: 3, measured: 1, opened: 0, clicked: 0, openRate: 0, clickRate: 0 });
  });
  it('a domain with tracking off: nothing is tracked, no rates', () => {
    const off = mergeUserEmails({ email: ME, resendRows, logRows, templateNames, tracking: { on: false, since: null } });
    expect(off.filter((r) => r.untracked === 'off').length).toBe(4);
    expect(userEmailSummary(off)).toMatchObject({ measured: 0, openRate: null, clickRate: null, delivered: 3 });
  });
});

describe('englishTemplateName', () => {
  it('names the automation templates in English', () => {
    expect(englishTemplateName('first-listing-gift')).toBe('First listing — free home display gift');
    expect(englishTemplateName('first-listing-ending')).toBe('First listing — free home display ending');
    expect(englishTemplateName('listing-views')).toBe('Listing views milestone');
    expect(englishTemplateName('draft-reminder')).toBe('Unfinished draft reminder');
  });
  it('returns null for a template it does not know (the UI then translates or skips)', () => {
    expect(englishTemplateName('custom-thing')).toBe(null);
    expect(englishTemplateName(undefined)).toBe(null);
  });
});

describe('userEmailSummary', () => {
  it('rates leave out sign-in / reset codes and emails Resend could not track', () => {
    const s = userEmailSummary(mergeUserEmails({ email: ME, resendRows, logRows, templateNames }));
    expect(s).toEqual({ total: 5, codes: 1, listed: 3, delivered: 3, measured: 3, opened: 2, clicked: 1, openRate: 66.7, clickRate: 33.3 });
  });
  it('no measurable emails → no rates', () => {
    expect(userEmailSummary([])).toEqual({ total: 0, codes: 0, listed: 0, delivered: 0, measured: 0, opened: 0, clicked: 0, openRate: null, clickRate: null });
  });
  it('treats sign-in and password-reset codes as codes', () => {
    expect([...CODE_TYPES].sort()).toEqual(['Password reset', 'Sign-in code']);
  });
});

describe('templateValues + fillTemplate (English subject without sending names to a translator)', () => {
  it('reads the filled-in values back out of a sent subject', () => {
    expect(templateValues('{{name}}, tu propiedad está en la portada de Casa Libre', 'Claudia, tu propiedad está en la portada de Casa Libre')).toEqual({ name: 'Claudia' });
    expect(templateValues('{{property_title}} ya tiene {{views}} visitas', 'Casa · Mburucuyá ya tiene 110 visitas')).toEqual({ property_title: 'Casa · Mburucuyá', views: '110' });
    expect(templateValues('Tu propiedad deja la portada el {{ free_until }}', 'Tu propiedad deja la portada el 28 de octubre')).toEqual({ free_until: '28 de octubre' });
  });
  it('null when the subject no longer matches the template (it was edited since)', () => {
    expect(templateValues('{{name}}, tu propiedad está en la portada de Casa Libre', '¡Tu propiedad ya está en la portada!')).toBe(null);
    expect(templateValues('', 'x')).toBe(null);
  });
  it('fills the English template; null if a value is missing', () => {
    expect(fillTemplate('{{name}}, your property is on the Casa Libre home page', { name: 'Claudia' })).toBe('Claudia, your property is on the Casa Libre home page');
    expect(fillTemplate('{{ property_title }} now has {{views}} views', { property_title: 'Casa · Mburucuyá', views: '110' })).toBe('Casa · Mburucuyá now has 110 views');
    expect(fillTemplate('{{name}} hi', {})).toBe(null);
  });
});

describe('templateValues with regex characters in the template', () => {
  it('treats ? ( ) . + literally', () => {
    expect(templateValues('¿{{name}} (prueba) vio 1.000+ visitas?', '¿Ana (prueba) vio 1.000+ visitas?')).toEqual({ name: 'Ana' });
    expect(templateValues('¿{{name}} (prueba)?', 'Ana prueba')).toBe(null);
  });
});
