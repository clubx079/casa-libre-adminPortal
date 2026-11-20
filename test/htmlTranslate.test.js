import { describe, it, expect } from 'vitest';
import { translateHtml, splitHtml, decode } from '../lib/htmlTranslate.js';

const fake = async (texts) => texts.map((t) => `EN(${t})`);

describe('translateHtml', () => {
  it('translates only the visible text and keeps tags, links and styles', async () => {
    const html = '<html><head><style>p{color:red}</style><title>Hola</title></head><body><p style="x">Hola &aacute;ngel</p><a href="https://x.com/a?b=1">Ver propiedad</a> <span>  </span><b>US$ 120</b><!-- nota --></body></html>';
    const { html: out, translated } = await translateHtml(html, fake);
    expect(translated).toBe(2);
    expect(out).toContain('<p style="x">EN(Hola ángel)</p>');
    expect(out).toContain('<a href="https://x.com/a?b=1">EN(Ver propiedad)</a>');
    expect(out).toContain('<style>p{color:red}</style><title>Hola</title>');
    expect(out).toContain('<b>US$ 120</b>');
    expect(out).toContain('<!-- nota -->');
  });
  it('never translates the brand', async () => {
    const seen = [];
    const { html } = await translateHtml('<p>casa libre</p><p>Bienvenido a Casa-Libre.com.py hoy</p>', async (texts) => { seen.push(...texts); return texts.map((t) => (t ? `Welcome to ${t.match(/\{\{cl0\}\}/)?.[0]} today` : '')); });
    expect(seen[0]).toBe('');
    expect(html).toBe('<p>casa libre</p><p>Welcome to Casa-Libre.com.py today</p>');
  });
  it('keeps a piece in Spanish when its translation failed', async () => {
    const { html } = await translateHtml('<p>Uno</p><p>Dos</p>', async () => ['One', null]);
    expect(html).toBe('<p>One</p><p>Dos</p>');
  });
  it('escapes translated text and decodes entities', async () => {
    const { html } = await translateHtml('<p>Casa &amp; jardín</p>', async () => ['A & <B>']);
    expect(html).toBe('<p>A &amp; &lt;B&gt;</p>');
    expect(decode('&#241;&nbsp;&iquest;')).toBe('ñ ¿');
    expect(splitHtml('<p>https://x.com</p>').jobs).toHaveLength(0);
  });
});
