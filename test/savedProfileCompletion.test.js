import { describe, it, expect } from 'vitest';
import { savedProfileCompletion } from '../lib/savedProfileCompletion.js';

describe('savedProfileCompletion (admin Users column)', () => {
  it('a sign-up name and a confirmed WhatsApp are NOT profile progress', () => {
    const c = savedProfileCompletion({ full_name: 'Camila Barrios', phone_verified_at: '2026-11-17T00:00:00Z' });
    expect(c.count).toBe(0); expect(c.total).toBe(6); expect(c.tone).toBe('red');
    expect(c.personalized).toBe(false); expect(c.whatsapp).toBe(true);
  });
  it('counts saved items and the personalized rule', () => {
    const u = { first_name: 'Ana', last_name: 'López', job_title: 'Agente', profile_photo_url: 'https://x/p.webp' };
    const c = savedProfileCompletion(u);
    expect(c.count).toBe(4); expect(c.tone).toBe('yellow'); expect(c.personalized).toBe(true);
    expect(savedProfileCompletion({ ...u, company_name: 'X', company_website: 'x.com' }).tone).toBe('green');
    expect(savedProfileCompletion({ first_name: 'Ana', last_name: 'López', job_title: 'A' }).personalized).toBe(false);
  });
});
