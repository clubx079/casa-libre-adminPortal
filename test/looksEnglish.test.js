import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { looksEnglish } = await import('../lib/issueTranslate.js');

describe('which messages need an English translation', () => {
  it('short Spanish is translated', () => {
    for (const t of ['Y la de encarnacion', 'Y la de fernando de la.mora?', 'Si pero me quieren cobrar', 'Nadie me llama', 'Buenas', 'Hola me podes dar más información?']) expect(looksEnglish(t)).toBe(false);
  });
  it('English stays, and codes / emojis are left alone', () => {
    for (const t of ['Hi, how do I list my apartment?', 'Thanks, I will check it', '286155', '🙏', '👍👍']) expect(looksEnglish(t)).toBe(true);
  });
});
