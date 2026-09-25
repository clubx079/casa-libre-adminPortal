import { describe, it, expect } from 'vitest';
import { mask, unmask } from '../lib/translate.js';

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
