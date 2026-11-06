import { describe, it, expect } from 'vitest';
import { brokenTranslation } from '../lib/translate.js';

describe('translation answers that are not translations (MyMemory backup)', () => {
  it('rejects "%0 … %1" leftovers, empty answers and the source handed back', () => {
    expect(brokenTranslation('Tu código de verificación es ••••••.', 'Your %0 verification code is: %1')).toBe(true);
    expect(brokenTranslation('Gracias muy amable', '')).toBe(true);
    expect(brokenTranslation('Dale reviso', 'Dale reviso')).toBe(true);
  });
  it('accepts a real translation, and a %-number the source already had', () => {
    expect(brokenTranslation('No se cambio nada 🤦', 'Nothing changed 🤦')).toBe(false);
    expect(brokenTranslation('Descuento del 10%1 vez', 'Discount of 10%1 time')).toBe(false);
    expect(brokenTranslation('👍', '👍')).toBe(false);   // nothing to translate
  });
});
