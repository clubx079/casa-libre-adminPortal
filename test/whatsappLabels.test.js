import { describe, it, expect } from 'vitest';
import { waLabel, waBodyText } from '../lib/whatsappLabels.js';

describe('WhatsApp rows in English', () => {
  it('names each template', () => {
    expect(waLabel('cl_borrador')).toBe('Unfinished draft reminder');
    expect(waLabel('cl_pendiente_pago')).toBe('Listing waiting for payment');
    expect(waLabel('cl_nuevo_aviso')).toBe('Nuevo aviso');   // not named yet → readable
  });
  it('shows the template text with the per-person values as …', () => {
    expect(waBodyText('Hola {{1}}, tu borrador *{{2}}* quedó guardado.')).toBe('Hola …, tu borrador … quedó guardado.');
  });
});
