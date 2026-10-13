import { describe, it, expect } from 'vitest';
import { TEMPLATE_EN, TEMPLATE_FIELDS, englishName, fixedEnglish, templateOptionLabel } from '../lib/templateEnglish.js';
import { DEFAULT_TEMPLATES } from '../lib/paidListingsAdmin.js';

const dup = TEMPLATE_EN['duplicate-listing'];
const stored = (key) => {
  const d = TEMPLATE_EN[key];
  return { key, name: d.name.es, ...Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f, d[f].es])) };
};

describe('englishName', () => {
  it('gives the fixed English name of a built-in template', () => {
    expect(englishName({ key: 'duplicate-listing', name: 'Propiedad publicada más de una vez' })).toBe('Duplicate listing');
    expect(englishName({ key: 'draft-reminder', name: 'Borrador sin terminar — recordatorio' })).toBe('Unfinished draft — reminder');
  });
  it('has no fixed name for custom, unknown or renamed templates', () => {
    expect(englishName({ key: null, name: 'Mi plantilla' })).toBeNull();
    expect(englishName({ key: 'nope', name: 'Algo' })).toBeNull();
    expect(englishName({ key: 'duplicate-listing', name: 'Aviso de duplicado' })).toBeNull();
  });
});

describe('fixedEnglish', () => {
  it('translates every field of an unchanged built-in template', () => {
    for (const key of Object.keys(TEMPLATE_EN)) {
      const en = fixedEnglish(stored(key));
      for (const f of TEMPLATE_FIELDS) expect(en[f]).toBe(TEMPLATE_EN[key][f].en);
    }
  });
  it('ignores CRLF and surrounding spaces', () => {
    const t = { ...stored('duplicate-listing'), body: `  ${dup.body.es.replace(/\n/g, '\r\n')}\n` };
    expect(fixedEnglish(t).body).toBe(dup.body.en);
  });
  it('returns null for a field an admin reworded, keeping the rest', () => {
    const en = fixedEnglish({ ...stored('duplicate-listing'), subject: 'Otro asunto' });
    expect(en.subject).toBeNull();
    expect(en.heading).toBe(dup.heading.en);
  });
  it('returns all nulls for a custom template', () => {
    expect(fixedEnglish({ key: null, subject: 'Hola', heading: 'x', body: 'y', button_label: 'z' }))
      .toEqual({ subject: null, heading: null, body: null, button_label: null });
  });
  it('keeps every {{variable}} of the Spanish in the English', () => {
    const vars = (s) => (s.match(/\{\{\s*\w+\s*\}\}/g) || []).sort();
    for (const d of Object.values(TEMPLATE_EN)) for (const f of TEMPLATE_FIELDS) expect(vars(d[f].en)).toEqual(vars(d[f].es));
  });
  it('matches the Spanish of the paid-listing defaults', () => {
    for (const d of DEFAULT_TEMPLATES) {
      expect(TEMPLATE_EN[d.key].name.es).toBe(d.name);
      for (const f of TEMPLATE_FIELDS) expect(TEMPLATE_EN[d.key][f].es).toBe(d[f]);
    }
  });
});

describe('templateOptionLabel', () => {
  it('puts English first and Spanish in brackets', () => {
    expect(templateOptionLabel('Propiedad publicada más de una vez', 'Duplicate listing')).toBe('Duplicate listing (Propiedad publicada más de una vez)');
  });
  it('shows the name once when there is no English or it is the same', () => {
    expect(templateOptionLabel('Mi plantilla', null)).toBe('Mi plantilla');
    expect(templateOptionLabel('Mi plantilla', undefined)).toBe('Mi plantilla');
    expect(templateOptionLabel('Plan for agents', 'Plan for agents')).toBe('Plan for agents');
  });
});
