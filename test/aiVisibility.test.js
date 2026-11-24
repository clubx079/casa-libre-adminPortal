import { describe, it, expect } from 'vitest';
import { analyzeAnswer, competitorsIn, keywordOf, questionStats, toSignals, findForbidden, countryOf, draftText, namesCompetitor } from '../lib/aiVisibility/core.js';
import { sourcesOf, whyText, keywordsAdded } from '../lib/seo/reasons.js';
import { decide } from '../lib/seo/decide.js';
import { DEFAULT_SETTINGS } from '../lib/seo/settings.js';

describe('AI visibility: reading answers', () => {
  it('finds us, our place and the competitors (any spelling)', () => {
    const a = analyzeAnswer('Opciones: InfoCasas, Clasipar y RE/MAX. También Casa-Libre permite publicar gratis. Y Facebook Marketplace.', ['https://www.infocasas.com.py/x', 'https://reddit.com/r/Paraguay']);
    expect(a).toMatchObject({ mentioned: true, position: 4, competitors: ['InfoCasas', 'Clasipar', 'RE/MAX', 'Facebook Marketplace'], sources: ['infocasas.com.py', 'reddit.com'] });
    expect(competitorsIn('remax, century21 y mercadolibre')).toEqual(['RE/MAX', 'Century 21', 'Mercado Libre']);
    expect(analyzeAnswer('Te recomiendo Clasipar').mentioned).toBe(false);
  });
  it('knows the country of a question', () => {
    expect(countryOf('dónde publicar mi apartamento en Montevideo')).toBe('uy');
    expect(countryOf('portal inmobiliario en El Salvador')).toBe('sv');
    expect(countryOf('dónde alquilar en Asunción')).toBe('py');
  });
});

describe('AI visibility: only keywords that help Casa-Libre', () => {
  it('never a keyword that names a competitor, and Spanish only', () => {
    expect(keywordOf('¿Dónde publicar mi casa gratis en Paraguay?')).toBe('donde publicar mi casa gratis en paraguay');
    expect(keywordOf('alternativas a InfoCasas para publicar mi propiedad')).toBeNull();
    expect(keywordOf('best website to find a house in Paraguay')).toBeNull();
  });
  it('a gap = competitors named often, us rarely → a pipeline signal', () => {
    const q = 'dónde alquilar un departamento en Asunción';
    const st = questionStats([
      { question: q, assistant: 'claude', mentioned: false, competitors: ['InfoCasas'] },
      { question: q, assistant: 'chatgpt', mentioned: false, competitors: ['Clasipar', 'InfoCasas'] },
      { question: q, assistant: 'gemini', error: 'x' },
    ]);
    expect(st[0]).toMatchObject({ answers: 2, ourRate: 0, compRate: 1, gap: true, keyword: 'donde alquilar un departamento en asuncion' });
    const [sig] = toSignals(st, 'py', '2026-11-24');
    expect(sig).toMatchObject({ source: 'ai_visibility', term: 'donde alquilar un departamento en asuncion' });
    expect(toSignals(st, 'uy', '2026-11-24')).toEqual([]);
    expect(questionStats([{ question: q, assistant: 'a', mentioned: true, competitors: ['InfoCasas'] }, { question: q, assistant: 'b', mentioned: true, competitors: [] }])[0].gap).toBe(false);
  });
});

describe('AI visibility: nothing we publish names a competitor or links out', () => {
  it('finds competitor names and outside links, allows our own', () => {
    expect(findForbidden('Visitá www.infocasas.com.py o https://casa-libre.com.py/guias, como RE/MAX')).toEqual(['names a competitor: InfoCasas', 'names a competitor: RE/MAX', 'links to another site: infocasas.com.py']);
    expect(findForbidden('Publicá gratis en https://casa-libre.com.py')).toEqual([]);
    expect(findForbidden(draftText({ title: 'Guía', sections: [{ h2: 'x', paras: ['Mejor que Clasipar'] }] }))).toEqual(['names a competitor: Clasipar']);
  });
  it('Decide never builds a page for a competitor keyword', () => {
    const d = (term, m) => ({ source: 'keyword_planner', term, date: '2026-11-20', metrics: { avg_monthly_searches: m } });
    const opps = decide({ signals: [d('infocasas paraguay', 5000), d('como vender mi casa rapido', 900)], settings: DEFAULT_SETTINGS });
    expect(opps.some((o) => /infocasas/.test(o.term))).toBe(false);
    expect(namesCompetitor('remax asuncion')).toBe(true);
  });
  it('an AI gap becomes an answer guide', () => {
    const opps = decide({ signals: [{ source: 'ai_visibility', term: 'donde publicar mi casa gratis en paraguay', date: '2026-11-24', metrics: { gap: true, question: 'dónde publicar mi casa gratis en Paraguay', our_rate: 0, competitor_rate: 1, answers: 4, competitors: ['InfoCasas'] } }], settings: DEFAULT_SETTINGS });
    const g = opps.find((o) => o.type === 'write_guide');
    expect(g).toBeTruthy();
    expect(g.evidence.aiv.gap).toBe(true);
    expect(sourcesOf(g.evidence, g.type)).toEqual(['ai_visibility']);
    expect(whyText(g)).toMatch(/AI assistants named competitors in 100% of answers .* Casa-Libre in 0%/);
  });
});

describe('AI SEO report: where each keyword came from and why', () => {
  it('lists sources and a plain reason', () => {
    const opp = { id: 'o1', type: 'create_variant', term: 'departamentos en alquiler asuncion', url: '/alquiler/departamentos/asuncion', evidence: { kp: { volume: 720, competition: 'LOW' }, gsc: { impressions: 230, position: 14 }, ads: { clicks: 0 }, site: { searches: 4 }, listings: 37 } };
    expect(sourcesOf(opp.evidence, opp.type)).toEqual(['keyword_planner', 'gsc', 'site_search']);
    expect(whyText(opp)).toBe('Added a filter page because: 720 Google searches a month (Keyword Planner, low ad competition); Google showed us 230 times at position 14 (Search Console); typed 4 times in our search box; 37 live listings to show.');
    const list = keywordsAdded([{ opportunity_id: 'o1', path: '/alquiler/departamentos/asuncion' }, { opportunity_id: 'o1' }], new Map([['o1', opp]]));
    expect(list).toHaveLength(1);
    expect(list[0].sourceNames).toEqual(['Keyword Planner', 'Search Console', 'Site search']);
  });
});
