import { describe, it, expect } from 'vitest';
import { sureKind, isReal, KINDS } from '../lib/waClassifyCore.js';

describe('sureKind: sorted without an AI call', () => {
  it('thanks / ok alone is ack (never answered)', () => {
    for (const t of ['Gracias muy amable', 'gracias!!', 'Muchas gracias 🙏', 'ok gracias', 'Dale, perfecto', 'listo gracias', 'Thank you', 'Mil gracias, buen día']) expect(sureKind(t), t).toBe('ack');
  });
  it('questions only about where we are from / the US number / who we are are offtopic (never answered)', () => {
    for (const t of ['¿Por qué su número es de EEUU?', 'Por que el numero es americano?', 'De dónde son ustedes?', 'quienes son?', '¿Esto es una estafa?', 'número +1??', 'como consiguieron mi numero']) expect(sureKind(t), t).toBe('offtopic');
    expect(isReal('offtopic')).toBe(false);
    expect(KINDS).toContain('offtopic');
  });
  it('anything about using Casa-Libre goes to the AI', () => {
    for (const t of ['Gracias, pero me quieren cobrar', '¿Por qué el número es de EEUU y cuánto cuesta publicar?', 'Y la de encarnacion', 'Le podes poner barrio san pedro', 'si', 'hola', '¿Cómo publico mi casa?']) expect(sureKind(t), t).toBeNull();
  });
});
