import { describe, it, expect } from 'vitest';
import { emailType, trackingFor, summarize } from '../lib/emailStats.js';

describe('emailType', () => {
  it('names the website emails', () => {
    expect(emailType('819511 es tu código de Casa Libre')).toBe('Sign-in code');
    expect(emailType('Bienvenido a Casa Libre')).toBe('Welcome');
    expect(emailType('Tu propiedad está publicada en Casa Libre')).toBe('Listing published');
    expect(emailType('Tu verificación en Casa Libre vence en 1 día')).toBe('Promotion ending');
  });
  it('names the free home display gift, sent by hand (ES + EN) or by the automation', () => {
    expect(emailType('Tu propiedad está destacada en la portada de Casa Libre')).toBe('Free home display gift');
    expect(emailType('Your property is featured on the Casa Libre homepage')).toBe('Free home display gift');
    expect(emailType('Claudia, tu propiedad está en la portada de Casa Libre')).toBe('Free home display gift');
  });
  it('names the views milestone and book-a-call emails', () => {
    expect(emailType('Casa · Mburucuyá ya tiene 110 visitas')).toBe('Listing views');
    expect(emailType('Book a call — Roland Lallier')).toBe('Book a call');
  });
  it('marks admin test sends as tests', () => {
    for (const s of ['[TEST] Ana, tu propiedad está en la portada de Casa Libre', 'Sender test casa-libre.com.py', 'Casa Libre — prueba de entrega (registro)', 'New investor inquiry — ENV TEST']) {
      expect(emailType(s)).toBe('Test send');
    }
  });
});

describe('trackingFor', () => {
  it('every country records opens and clicks since its domain tracking went on; unknown ones do not', () => {
    expect(trackingFor('py')).toEqual({ on: true, since: '2026-09-24T23:38:00Z' });
    expect(trackingFor('bo')).toEqual({ on: true, since: '2026-10-06T23:35:00Z' });
    expect(trackingFor('uy')).toEqual({ on: true, since: '2026-10-06T23:45:00Z' });
    expect(trackingFor('ve')).toEqual({ on: true, since: '2026-10-06T23:45:00Z' });
    expect(trackingFor('xx')).toEqual({ on: false, since: null });
  });
});

describe('summarize', () => {
  const rows = [
    { subject: 'Bienvenido a Casa Libre', last_event: 'opened', created_at: '2026-10-01T10:00:00Z' },
    { subject: 'Tu propiedad está publicada en Casa Libre', last_event: 'clicked', created_at: '2026-10-02T10:00:00Z' },
    { subject: 'Bienvenido a Casa Libre', last_event: 'delivered', created_at: '2026-10-03T10:00:00Z' },
    { subject: '123456 es tu código de Casa Libre', last_event: 'opened', created_at: '2026-10-03T11:00:00Z' },      // code: out of the rates
    { subject: 'Bienvenido a Casa Libre', last_event: 'delivered', created_at: '2026-09-12T10:00:00Z' },             // before tracking
    { subject: 'Tu propiedad está publicada en Casa Libre', last_event: 'bounced', created_at: '2026-10-04T10:00:00Z' },
  ];
  const s = summarize(rows, { trackingSince: '2026-09-24T23:38:00Z' });

  it('counts every email sent / delivered / bounced', () => {
    expect(s.totals).toMatchObject({ sent: 6, delivered: 5, failed: 1 });
  });
  it('opened / clicked count every real open, sign-in codes included', () => {
    expect(s.totals).toMatchObject({ opened: 3, clicked: 1 });
  });
  it('the RATES only use emails sent while tracking was on, without sign-in codes', () => {
    // measured: the 4 non-code emails since Sep 24 → 2 of them opened (opened + clicked), 1 clicked
    expect(s.totals).toMatchObject({ measured: 4, openRate: 50, clickRate: 25 });
  });
  it('per type: a sign-in code shows its opens but has no open rate', () => {
    const by = Object.fromEntries(s.byType.map((t) => [t.type, t]));
    expect(by['Sign-in code']).toMatchObject({ sent: 1, opened: 1, openRate: null });
    expect(by.Welcome).toMatchObject({ sent: 3, measured: 2, opened: 1, openRate: 50 });
  });
  it('without a tracking date every non-code email counts in the rates', () => {
    expect(summarize(rows).totals).toMatchObject({ measured: 5, opened: 3, openRate: 40 });
  });
});

describe('investor inquiry subjects', () => {
  it('Spanish and English', () => {
    expect(emailType('Nueva consulta de inversor — Ana')).toBe('Investor inquiry');
    expect(emailType('New investor inquiry — Ana')).toBe('Investor inquiry');
  });
});
