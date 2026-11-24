import { describe, it, expect } from 'vitest';
import {
  isoWeek, editionSlot, editionDue, usedBefore, validateStories, validateIssues, validateEdition, textProblems, parseJson,
  storiesPrompt, issuesPrompt, editionSummary, STORY_COUNT, MAX_ATTEMPTS,
} from '../lib/newsletterEditionCore.js';
import { newsletterSettings, validateNewsletter } from '../lib/newsletterAdmin.js';
import { STATIC_STORIES } from '../lib/newsletterEditionSeed.js';

const L = (es, en = es) => ({ es, en });
const story = (slug, name, role, roleEn, city, extra = {}) => ({
  slug,
  metric: L('Vendida en 20 días', 'Sold in 20 days'),
  when: L(`en ${city}`, `in ${city}`),
  who: L(`${name} · ${role}`, `${name} · ${roleEn}`),
  title: L(`${name} cerró su operación en ${city} (${slug})`, `${name} closed the deal in ${city} (${slug})`),
  challenge: L('Llevaba meses sin consultas serias.', 'Months without serious enquiries.'),
  did: L('Publicó con fotos de día, el precio a la vista y respondió cada WhatsApp en menos de una hora.', 'Listed with daylight photos, the price in plain sight, and answered every WhatsApp within the hour.'),
  result: L('15 consultas, 4 visitas y una oferta aceptada el día 20.', '15 enquiries, 4 viewings and an accepted offer on day 20.'),
  quote: L('Me escribían personas que ya sabían el precio.', 'People who wrote already knew the price.'),
  ...extra,
});
const GOOD_STORIES = [
  story('nadia-casa-lambare', 'Nadia', 'dueña de una casa', 'house owner', 'Lambaré'),
  story('bruno-depto-asuncion', 'Bruno', 'dueño de un departamento', 'apartment owner', 'Asunción'),
  story('irene-terreno-limpio', 'Irene', 'dueña de un terreno', 'land owner', 'Limpio'),
  story('fabian-agente-luque', 'Fabián', 'agente', 'agent', 'Luque'),
  story('gisela-agente-enc', 'Gisela', 'agente independiente', 'independent agent', 'Encarnación'),
  story('hector-agente-cde', 'Héctor', 'agente', 'agent', 'Ciudad del Este'),
  story('olga-inmobiliaria-itaugua', 'Olga', 'inmobiliaria de 4 personas', '4-person agency', 'Itauguá'),
  story('ulises-inmobiliaria-nemby', 'Ulises', 'inmobiliaria familiar', 'family agency', 'Ñemby'),
  story('yanina-inquilina-villa-elisa', 'Yanina', 'inquilina', 'tenant', 'Villa Elisa'),
  story('agustin-inversor-mra', 'Agustín', 'inversor', 'investor', 'Mariano Roque Alonso'),
  story('belen-local-capiata', 'Belén', 'dueña de un local', 'shop owner', 'Capiatá'),
  story('dario-deposito-villeta', 'Darío', 'dueño de un depósito', 'warehouse owner', 'Villeta'),
];
const VARS = { nl_top_cities: 'Asunción, Luque y Lambaré', nl_sale_median: 'US$84.000', nl_people_30d: '2.500', active_listings: '4.100' };
const issue = (slug, extra = {}) => ({
  slug, cat: 'data', audience: 'everyone', name: 'Newsletter — Lo que se mira esta semana',
  subject: 'Qué miran los compradores en {{country_name}} esta semana', heading: 'Lo que se mira ahora',
  body: [
    '>> Precios y ciudades con más visitas en Casa-Libre.',
    'Hola {{name}}, esto miraron los compradores en Casa-Libre.',
    '!! Hasta {{nl_sale_median}} | La mitad de las visitas a propiedades en venta fue a precios de hasta ese valor.',
    '!! {{nl_top_cities}} | son las ciudades con más visitas.',
    '## Qué podés hacer',
    'Publicá con 3 fotos de día y el precio a la vista. Los interesados te escriben directo a tu WhatsApp.',
    '[[Publicar mi propiedad]]({{publish_url}})',
    `[[Leer el newsletter completo]]({{newsletter_url}}#${slug})`,
  ],
  button_label: 'Publicar mi propiedad', button_url: '{{publish_url}}',
  en: { subject: 'What buyers in {{country_name}} look at this week', heading: 'What people look at now', body: ['!! Up to {{nl_sale_median}} | Half of the views went to prices up to this amount.', '!! {{nl_top_cities}} | are the cities with the most views.'] },
  ...extra,
});

describe('weekly edition — when', () => {
  const SETTINGS = newsletterSettings({ id: 'weekly_newsletter', enabled: true, free_tiers: [{ day: 2, hour: 10, rotation: [], autogen: true }] });
  // Tuesday 2026-12-01 in Asunción (UTC-3)
  const at = (iso) => new Date(iso);
  it('ISO week and the local date', () => {
    expect(isoWeek('2026-11-25')).toBe('2026-W48');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(editionSlot(at('2026-12-01T02:30:00Z'), 'py')).toMatchObject({ date: '2026-11-30', week: '2026-W49' });
  });
  it('off unless auto-generate is on', () => {
    const off = newsletterSettings({ id: 'weekly_newsletter', free_tiers: [{ day: 2, hour: 10 }] });
    expect(editionDue({ settings: off, now: at('2026-12-01T12:00:00Z') }).reason).toBe('off');
    expect(editionDue({ settings: newsletterSettings(null), now: at('2026-12-01T12:00:00Z') }).reason).toBe('off');
  });
  it('due from 3 hours before the email until the week ends', () => {
    expect(editionDue({ settings: SETTINGS, now: at('2026-12-01T09:00:00Z') }).reason).toBe('not_yet');    // 06:00 local
    expect(editionDue({ settings: SETTINGS, now: at('2026-12-01T10:00:00Z') })).toMatchObject({ due: true, week: '2026-W49', date: '2026-12-01' });   // 07:00
    expect(editionDue({ settings: SETTINGS, now: at('2026-12-04T15:00:00Z') }).due).toBe(true);    // Friday, catch-up
    expect(editionDue({ settings: SETTINGS, now: at('2026-11-30T15:00:00Z') }).reason).toBe('not_yet');   // Monday
    const sunday = newsletterSettings({ id: 'weekly_newsletter', free_tiers: [{ day: 0, hour: 9, autogen: true }] });
    expect(editionDue({ settings: sunday, now: at('2026-12-05T15:00:00Z') }).reason).toBe('not_yet');   // Saturday < Sunday (end of ISO week)
    expect(editionDue({ settings: sunday, now: at('2026-12-06T09:30:00Z') }).due).toBe(true);           // Sunday 06:30
  });
  it('idempotent: one edition per ISO week per country', () => {
    const now = at('2026-12-01T12:00:00Z');
    expect(editionDue({ settings: SETTINGS, now, rows: [{ week: '2026-W49', status: 'published', created_at: '2026-12-01T10:00:00Z' }] }).reason).toBe('exists');
    expect(editionDue({ settings: SETTINGS, now, force: true, rows: [{ week: '2026-W49', status: 'published' }] }).reason).toBe('exists');
    expect(editionDue({ settings: SETTINGS, now, rows: [{ week: '2026-W49', status: 'generating', created_at: '2026-12-01T11:55:00Z' }] }).reason).toBe('generating');
    // a crashed run (claim older than 20 min) doesn't block
    expect(editionDue({ settings: SETTINGS, now, rows: [{ week: '2026-W49', status: 'generating', created_at: '2026-12-01T10:00:00Z' }] }).due).toBe(true);
    // last week's edition doesn't count
    expect(editionDue({ settings: SETTINGS, now, rows: [{ week: '2026-W48', status: 'published' }] }).due).toBe(true);
    const failed = Array.from({ length: MAX_ATTEMPTS }, () => ({ week: '2026-W49', status: 'failed', created_at: '2026-12-01T10:00:00Z' }));
    expect(editionDue({ settings: SETTINGS, now, rows: failed }).reason).toBe('gave_up');
    expect(editionDue({ settings: SETTINGS, now, rows: failed, force: true }).due).toBe(true);
  });
  it('admin setting autogen is saved and read', () => {
    const row = { id: 'weekly_newsletter', enabled: false, free_tiers: [{ day: 2, hour: 10, rotation: [{ template_id: 'a' }], issue: { week: 'x' } }] };
    expect(newsletterSettings(row).autogen).toBe(false);
    const v = validateNewsletter({ autogen: true }, row, ['a']);
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers[0]).toMatchObject({ autogen: true, issue: { week: 'x' }, day: 2 });
    expect(validateNewsletter({ day: 3 }, { ...row, free_tiers: [{ ...row.free_tiers[0], autogen: true }] }, ['a']).value.free_tiers[0].autogen).toBe(true);
  });
});

describe('weekly edition — stories', () => {
  const used = usedBefore([]);
  it('the 60 hand-made stories are all marked used', () => {
    expect(STATIC_STORIES).toHaveLength(60);
    expect(used.slugs.has('martin-comision')).toBe(true);
    expect(used.names.has('lorena')).toBe(true);
    expect(used.names.has('oscar')).toBe(true);   // Óscar, accents folded
  });
  it('12 valid, varied stories pass, in exactly the website shape', () => {
    const v = validateStories(GOOD_STORIES, { country: 'py', used });
    expect(v.errors).toEqual([]);
    expect(v.stories).toHaveLength(STORY_COUNT);
    expect(Object.keys(v.stories[0]).sort()).toEqual(['challenge', 'did', 'metric', 'quote', 'result', 'slug', 'title', 'when', 'who']);
  });
  it('dedupe: names / slugs / titles never reused (hand-made, earlier editions, this edition)', () => {
    const lorena = GOOD_STORIES.map((s, i) => (i === 0 ? story('lorena-casa-lambare', 'Lorena', 'dueña de una casa', 'house owner', 'Lambaré') : s));
    expect(validateStories(lorena, { used }).errors.join()).toMatch(/first name "Lorena" already used/);
    const twice = GOOD_STORIES.map((s, i) => (i === 1 ? { ...GOOD_STORIES[0] } : s));
    expect(validateStories(twice, { used }).errors.join()).toMatch(/slug already used/);
    const old = usedBefore([{ stories: [GOOD_STORIES[3]] }]);
    expect(validateStories(GOOD_STORIES, { used: old }).errors.join()).toMatch(/Fabián" already used/);
    const martin = GOOD_STORIES.map((s, i) => (i === 2 ? { ...s, slug: 'martin-comision' } : s));
    expect(validateStories(martin, { used }).ok).toBe(false);
  });
  it('exactly 12, all fields in both languages', () => {
    expect(validateStories(GOOD_STORIES.slice(0, 11), { used }).errors.join()).toMatch(/exactly 12/);
    const noEn = GOOD_STORIES.map((s, i) => (i === 0 ? { ...s, result: { es: 'x' } } : s));
    expect(validateStories(noEn, { used }).errors.join()).toMatch(/result\.en missing/);
  });
  it('variety: owners, agents, agencies, several cities', () => {
    const allOwners = GOOD_STORIES.map((s) => ({ ...s, who: L(`${s.who.es.split(' · ')[0]} · dueño de una casa`, `${s.who.en.split(' · ')[0]} · owner`) }));
    expect(validateStories(allOwners, { used }).errors.join()).toMatch(/agents/);
    const oneCity = GOOD_STORIES.map((s) => ({ ...s, when: L('en Asunción', 'in Asunción'), title: L(`${s.title.es.split(' ')[0]} vendió su casa`, 'x'), challenge: L('Sin consultas.', 'No enquiries.') }));
    expect(validateStories(oneCity, { used }).errors.join()).toMatch(/different cities/);
  });
});

describe('weekly edition — content rules', () => {
  const bad = (t) => textProblems(t, { where: 'x', country: 'py' }).join(' ');
  it('no other business, the brand with the hyphen, no emoji, no opt-out, app = iPhone + Android', () => {
    expect(bad('Lo publicó en InfoCasas y en Casa-Libre.')).toMatch(/another business/);
    expect(bad('Antes estaba en RE/MAX.')).toMatch(/another business/);
    expect(bad('Lo vio en Facebook.')).toMatch(/another business/);
    expect(bad('El Banco Atlas le dio el crédito.')).toMatch(/bank/);
    expect(bad('Fue al banco y le dieron el crédito.')).toBe('');
    expect(bad('Visitá www.ejemplo.com')).toMatch(/web address/);
    expect(bad('Publicó en Casa Libre.')).toMatch(/Casa-Libre/);
    expect(bad('Vendida en 9 días 🎉')).toMatch(/emoji/);
    expect(bad('Respondé BAJA para no recibir más.')).toMatch(/opt-out/);
    expect(bad('Si no querés recibir más, darte de baja acá.')).toMatch(/opt-out/);
    expect(bad('Publicó desde la app.')).toMatch(/iPhone/);
    expect(bad('Publicó desde la app de Casa-Libre para iPhone y Android.')).toBe('');
    expect(bad('Es la mejor forma de vender.')).toMatch(/banned claim/);
    expect(bad('Un marketplace inmobiliario con atención personal.')).toBe('');
  });
});

describe('weekly edition — issues', () => {
  const slugs = GOOD_STORIES.map((s) => s.slug);
  it('valid issues pass', () => {
    const v = validateIssues([issue('lo-que-se-mira'), issue('historia-nadia', { cat: 'story', story: 'nadia-casa-lambare' })], { vars: VARS, storySlugs: slugs });
    expect(v.errors).toEqual([]);
    expect(v.issues[1].story).toBe('nadia-casa-lambare');
  });
  it('only numbers measured this week, never a literal one', () => {
    const v = validateIssues([issue('a', { body: issue('a').body.map((p) => p.replace('{{nl_sale_median}}', '{{nl_rent_band}}')) }), issue('b')], { vars: VARS });
    expect(v.errors.join()).toMatch(/nl_rent_band}} was not measured/);
    const lit = validateIssues([issue('a', { body: issue('a').body.map((p, i) => (i === 5 ? 'El 57 % de las visitas fue a casas de US$84.000.' : p)) }), issue('b')], { vars: VARS });
    expect(lit.errors.join()).toMatch(/no literal prices/);
  });
  it('the structure: preheader, greeting, stat, allowed buttons, link back last, 2 to 3 issues', () => {
    expect(validateIssues([issue('a')], { vars: VARS }).errors.join()).toMatch(/2 to 3/);
    const noLink = issue('a', { body: issue('a').body.slice(0, -1) });
    expect(validateIssues([noLink, issue('b')], { vars: VARS }).errors.join()).toMatch(/last body paragraph/);
    const btn = issue('a', { button_label: 'Ver en el mapa', button_url: '{{search_url}}' });
    expect(validateIssues([btn, issue('b')], { vars: VARS }).errors.join()).toMatch(/button_label/);
    const story = issue('a', { story: 'nope', cat: 'story' });
    expect(validateIssues([story, issue('b')], { vars: VARS, storySlugs: slugs }).errors.join()).toMatch(/story must be/);
    const dup = validateIssues([issue('a'), issue('a')], { vars: VARS });
    expect(dup.errors.join()).toMatch(/slug repeated/);
  });
  it('a whole edition validates and keeps week + date', () => {
    const v = validateEdition({ issues: [issue('a'), issue('b')], stories: GOOD_STORIES }, { vars: VARS, week: '2026-W49', date: '2026-12-01' });
    expect(v.ok).toBe(true);
    expect(v.edition).toMatchObject({ week: '2026-W49', date: '2026-12-01' });
    expect(editionSummary({ ...v.edition, status: 'published' })).toMatchObject({ week: '2026-W49', issues: [expect.any(String), expect.any(String)], stories: expect.any(Array) });
  });
});

describe('weekly edition — prompts and parsing', () => {
  it('the prompt lists the names already used and the measured numbers only', () => {
    const p = storiesPrompt({ country: 'py', vars: VARS, used: usedBefore([]), date: '2026-12-01' });
    expect(p).toMatch(/lorena/);
    expect(p).toMatch(/Asunción, Luque/);
    const q = issuesPrompt({ country: 'py', vars: VARS, stories: GOOD_STORIES, date: '2026-12-01' });
    expect(q).toMatch(/\{\{nl_sale_median\}\} = US\$84\.000/);
    expect(q).not.toMatch(/\{\{nl_rent_band\}\} =/);
  });
  it('parses fenced or plain JSON, throws on none', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(() => parseJson('nothing')).toThrow();
  });
});
