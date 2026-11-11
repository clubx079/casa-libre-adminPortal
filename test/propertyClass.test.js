import { describe, it, expect } from 'vitest';
import { defaultClass, classOf, classParam } from '../lib/propertyClass.js';

describe('Properties type filter default', () => {
  it('Originals (user submissions) opens on All; Scraped stays on Buildings', () => {
    expect(defaultClass('originals')).toBe('all');
    expect(defaultClass('scraped')).toBe('buildings');
    expect(classOf(undefined, 'originals')).toBe('all');
    expect(classOf(undefined, 'scraped')).toBe('buildings');
    expect(classOf('nonsense', 'originals')).toBe('all');
  });
  it('an explicit ?class= always wins', () => {
    expect(classOf('buildings', 'originals')).toBe('buildings');
    expect(classOf('land', 'originals')).toBe('land');
    expect(classOf('all', 'scraped')).toBe('all');
  });
  it('the URL carries ?class= only when it is not that page\'s default', () => {
    expect(classParam('all', 'originals')).toBe('');
    expect(classParam('buildings', 'originals')).toBe('buildings');   // or Buildings could never be picked there
    expect(classParam('land', 'originals')).toBe('land');
    expect(classParam('buildings', 'scraped')).toBe('');
    expect(classParam('all', 'scraped')).toBe('all');
  });
});
