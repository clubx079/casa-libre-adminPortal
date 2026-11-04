import { describe, it, expect } from 'vitest';
import { structuralKind, CLASSIFY_SYSTEM, CLASSIFY_SCHEMA, classifyAsk, parseClassified, mergeCache, isReal, CACHE_MAX } from '../lib/waClassifyCore';

describe('AI sorting of incoming WhatsApp messages', () => {
  it('only what WhatsApp itself says is decided without the AI', () => {
    expect(structuralKind({ type: 'button', text: 'SÍ' })).toBe('button');
    expect(structuralKind({ type: 'reaction', text: '👍' })).toBe('emoji');
    expect(structuralKind({ type: 'image', text: '', media: { type: 'image' } })).toBe('media');
    // any text — even an obvious robot greeting — goes to the AI
    expect(structuralKind({ type: 'text', text: 'Gracias por comunicarte con Aldo Zarza' })).toBeNull();
    expect(structuralKind({ type: 'text', text: 'gracias' })).toBeNull();
  });
  it('the prompt teaches robots vs people, with the timing signal and "when unsure, a person"', () => {
    expect(CLASSIFY_SYSTEM).toMatch(/auto-responders/);
    expect(CLASSIFY_SYSTEM).toMatch(/seconds_after_ours/);
    expect(CLASSIFY_SYSTEM).toMatch(/When unsure between auto and a person, choose the person/);
    expect(CLASSIFY_SYSTEM).toMatch(/Any language/);
    expect(CLASSIFY_SCHEMA.properties.items.items.properties.kind.enum).toEqual(['keyword', 'emoji', 'ack', 'auto', 'greeting', 'question', 'text', 'offtopic']);
  });
  it('the request carries the text, the seconds after our message and what we said', () => {
    const a = classifyAsk([{ id: 'm1', text: 'Hola, en breve te respondemos', secondsAfterOurs: 4, ourLast: 'Publicá gratis en Casa-Libre' }]);
    expect(JSON.parse(a.replace(/^Messages \(JSON\):\n/, ''))).toEqual([{ id: 'm1', text: 'Hola, en breve te respondemos', seconds_after_ours: 4, our_last_message: 'Publicá gratis en Casa-Libre' }]);
  });
  it('reads the answer: only known ids and kinds', () => {
    const m = parseClassified({ items: [{ id: 'm1', kind: 'auto', reason: 'company welcome' }, { id: 'zz', kind: 'text', reason: '' }, { id: 'm2', kind: 'weird', reason: '' }] }, ['m1', 'm2']);
    expect([...m]).toEqual([['m1', { kind: 'auto', reason: 'company welcome' }]]);
    expect(isReal('auto') || isReal('ack') || isReal('emoji')).toBe(false);
    expect(isReal('question') && isReal('text') && isReal('greeting')).toBe(true);
  });
  it('the cache keeps the newest messages', () => {
    const big = Object.fromEntries(Array.from({ length: CACHE_MAX }, (_, k) => [`o${k}`, ['text', k]]));
    const next = mergeCache(big, new Map([['new', { kind: 'auto' }]]), 10 ** 13);
    expect(Object.keys(next).length).toBe(CACHE_MAX);
    expect(next.new[0]).toBe('auto');
    expect(next.o0).toBeUndefined();
  });
});
