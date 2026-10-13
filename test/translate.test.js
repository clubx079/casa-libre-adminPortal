import { describe, it, expect, vi } from 'vitest';
import { mask, unmask, translateToEnglish } from '../lib/translate.js';

describe('translate mask/unmask', () => {
  it('protects variables and links and restores them', () => {
    const src = 'Hola {{name}}, mirá [{{property_title}}]({{property_url}}) o https://casa-libre.com.py/publicar.';
    const { masked, keep } = mask(src);
    expect(masked).not.toMatch(/\{\{|https?:/);
    expect(unmask(masked, keep)).toBe(src);
  });
  it('restores tokens even if the translator adds spaces or changes case', () => {
    const { keep } = mask('{{views}} visitas');
    expect(unmask('__ v0 __ views', keep)).toBe('{{views}} views');
  });
});

describe('translateToEnglish cache', () => {
  it('asks the translation service once per text', async () => {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url) => { calls.push(url); return { json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Duplicate listing' } }) }; });
    try {
      expect(await translateToEnglish('Plantilla única de prueba')).toBe('Duplicate listing');
      expect(await translateToEnglish('Plantilla única de prueba')).toBe('Duplicate listing');
      expect(calls.length).toBe(1);
    } finally { globalThis.fetch = orig; }
  });
});
