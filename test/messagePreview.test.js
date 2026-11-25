import { describe, it, expect } from 'vitest';
import { safeEmailHtml, relayVariables, fillTemplate, relayPreview } from '../lib/messagePreview';

describe('message preview', () => {
  it('makes email HTML safe for the sandboxed frame', () => {
    const out = safeEmailHtml('<html><head></head><body onload="x()"><script>alert(1)</script><a href="javascript:evil()">a</a><img src="cid:badge-apple" alt="App Store"><p>Hola</p></body></html>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/cid:/i);
    expect(out).toMatch(/<base target="_blank">/);
    expect(out).toMatch(/<p>Hola<\/p>/);
  });
  it('reads template variables in any shape and fills the text', () => {
    expect(relayVariables({ template: { name: 't', variables: ['Daniel', '30'] } })).toEqual(['Daniel', '30']);
    expect(relayVariables({ template: { name: 't', variables: { 2: 'b', 1: 'a' } } })).toEqual(['a', 'b']);
    expect(relayVariables({ template: { name: 't', components: [{ type: 'BODY', parameters: [{ text: 'x' }] }] } })).toEqual(['x']);
    expect(fillTemplate('Hola {{1}}, tu casa tiene {{2}} visitas', ['Daniel', '30'])).toEqual({ text: 'Hola Daniel, tu casa tiene 30 visitas', complete: true, filled: 2 });
    expect(fillTemplate('Hola {{1}}', []).complete).toBe(false);
  });
  it('builds the WhatsApp bubble from a Relay message', () => {
    const p = relayPreview({ id: 'm1', direction: 'outbound', status: 'read', template: { name: 'cl_visitas', variables: ['Daniel'] }, timestamps: { created: '2026-11-02T20:05:00Z' } }, 'Hola {{1}}, tu propiedad tiene visitas');
    expect(p).toMatchObject({ direction: 'outbound', status: 'read', template: 'cl_visitas', text: 'Hola Daniel, tu propiedad tiene visitas', complete: true });
    expect(relayPreview({ direction: 'outbound', text: 'Texto libre' }).text).toBe('Texto libre');
  });
});
