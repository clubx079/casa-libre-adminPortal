import { describe, it, expect } from 'vitest';
import { pinInCountry, belongsToCountry } from '../lib/inCountry';

describe('pinInCountry', () => {
  it('keeps real places, including cities on the border', () => {
    expect(pinInCountry(-25.2875931, -57.5695565, 'py')).toBe(true);    // Asunción
    expect(pinInCountry(-25.5097, -54.6111, 'py')).toBe(true);          // Ciudad del Este
    expect(pinInCountry(-27.3306, -55.8667, 'py')).toBe(true);          // Encarnación
    expect(pinInCountry(-17.7833, -63.1821, 'bo')).toBe(true);          // Santa Cruz
    expect(pinInCountry(-34.9011, -56.1645, 'uy')).toBe(true);          // Montevideo
    expect(pinInCountry(10.4806, -66.9036, 've')).toBe(true);           // Caracas
    expect(pinInCountry(13.6929, -89.2182, 'sv')).toBe(true);           // San Salvador
  });
  it('drops the bad pins found in Paraguay', () => {
    expect(pinInCountry(50.8477029, 4.3572001, 'py')).toBe(false);      // Brussels
    expect(pinInCountry(-14.235, -51.925, 'py')).toBe(false);           // Brazil
    expect(pinInCountry(-25.51, 0, 'py')).toBe(false);                  // longitude 0
    expect(pinInCountry(-25.191, -25.191, 'py')).toBe(false);           // longitude copied from latitude
  });
  it('a country only keeps its own places', () => {
    expect(pinInCountry(-34.6037, -58.3816, 'py')).toBe(false);         // Buenos Aires
    expect(pinInCountry(-25.2867, -57.647, 'bo')).toBe(false);          // Asunción is not Bolivia
    expect(pinInCountry(-17.7833, -63.1821, 'py')).toBe(false);         // Santa Cruz is not Paraguay
    expect(pinInCountry(-25.2867, -57.647, 'uy')).toBe(false);
    expect(pinInCountry(13.6929, -89.2182, 've')).toBe(false);
    expect(pinInCountry(10.4806, -66.9036, 'sv')).toBe(false);
  });
});

describe('belongsToCountry', () => {
  const ok = { latitude: -25.29, longitude: -57.57, country: 'Paraguay' };
  it('passes a listing in the right country', () => expect(belongsToCountry(ok, 'py')).toEqual({ ok: true }));
  it('drops a pin elsewhere', () => expect(belongsToCountry({ ...ok, latitude: 50.8, longitude: 4.3 }, 'py')).toEqual({ ok: false, reason: 'outside_country' }));
  it('drops a listing that names another country, even with no pin', () => {
    expect(belongsToCountry({ country: 'Argentina' }, 'py')).toEqual({ ok: false, reason: 'other_country' });
  });
  it('matches the country name without caring about accents or case', () => {
    expect(belongsToCountry({ country: 'EL SALVADOR' }, 'sv')).toEqual({ ok: true });
  });
  it('a listing with no pin and no conflicting country is kept', () => {
    expect(belongsToCountry({ country: 'Paraguay', latitude: null, longitude: null }, 'py')).toEqual({ ok: true });
    expect(belongsToCountry({}, 'py')).toEqual({ ok: true });
  });
  it('coordinates stored as text are still checked', () => {
    expect(belongsToCountry({ latitude: '50.8', longitude: '4.3' }, 'py').ok).toBe(false);
  });
});
