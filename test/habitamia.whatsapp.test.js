import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetail, whatsAppNumber } from '../lib/adapters/habitamia.js';

// Real Habitamia page (listing 4669144, saved 2026-11-13): TELÉFONO +595974184010 (not on
// WhatsApp) and MÓVIL +595984184010 behind the WhatsApp button. Buyers write on WhatsApp.
const html = readFileSync(path.join(__dirname, 'fixtures', 'habitamia-4669144.html'), 'utf8');

describe('Habitamia contact = the WhatsApp number', () => {
  it('reads the wa.me number', () => {
    expect(whatsAppNumber(html)).toBe('595984184010');
    expect(whatsAppNumber('<a href="https://wa.me/+595981123456?text=x">')).toBe('595981123456');
    expect(whatsAppNumber('<a href="tel:+595974184010">')).toBe(null);
  });
  it('parseDetail stores the WhatsApp number, not the office phone', () => {
    const d = parseDetail(html);
    expect(JSON.stringify(d)).toContain('595984184010');
    expect(JSON.stringify(d)).not.toContain('"595974184010"');
  });
  it('falls back to the first phone when the page has no WhatsApp button', () => {
    const noWa = html.replace(/wa\.me\/\d+/g, '');
    expect(JSON.stringify(parseDetail(noWa))).toContain('595974184010');
  });
});
