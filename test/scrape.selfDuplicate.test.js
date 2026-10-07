// Regression: on 2026-10-07 Habitamia inserted 56 listings and, the same day,
// held every one of them in quarantine as a "duplicate" whose duplicate_of was
// that listing's OWN new properties row. runJob decides "new vs known" from a
// per-page snapshot (`existing`); a listing that was inserted after that
// snapshot (by an overlapping job on the same source, or earlier on the same
// page) looked new, and isDuplicate's dedupe_key lookup then matched itself.
//
// Drives the real runJob / runScrape / isDuplicate against an in-memory
// PostgREST fake. The adapter, AI classifier and image services are stubbed
// (no listing images, so nothing is mirrored).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ db: null, page: [], onClassify: null, fetchPage: null }));

vi.mock('server-only', () => ({}));
vi.mock('../lib/db', () => ({ dbFor: () => h.db }));
vi.mock('../lib/adminCountry', () => ({ activeCountry: () => 'py' }));
vi.mock('../lib/fx', () => ({ getUsdRate: async () => 7300 }));
vi.mock('../lib/aiClassify', () => ({
  classifyPropertyType: async (row) => { if (h.onClassify) await h.onClassify(row); return null; },
}));
vi.mock('../lib/imageScreen', () => ({ screenPropertyImages: async () => ({ kept: [], branded: [], rejected: [] }) }));
vi.mock('../lib/watermarkRemover', () => ({ removeWatermark: async () => null }));
vi.mock('../lib/watermark', () => ({ stampWatermark: async (b) => b }));
vi.mock('../lib/b2', () => ({}));
vi.mock('../lib/costBreaker', () => ({ makeCostBreaker: () => ({ shouldAbort: async () => null, recordImages: () => {} }) }));
vi.mock('../lib/adapters/habitamia', () => ({
  default: {
    fetchPage: (...a) => h.fetchPage(...a),
    mapListing: (c, { source }) => ({ external_id: c.id, row: listingRow(source.id, c.id), images: [], hashInput: c.id }),
  },
}));

import { runJob, runScrape } from '../lib/scrape';
import { isDuplicate, dedupeKey, normalizeZone } from '../lib/ingest';

const SRC = 'src-habitamia';

// A complete, valid Paraguay listing (passes validateListing, has a dedupe key).
function listingRow(sourceId, ext) {
  return {
    source_id: sourceId, external_id: ext, origin: 'scraped', address: 'Villa Morra, Asunción',
    price: 150000, currency: 'USD', listing_type: 'sale', bedrooms: 3, bathrooms: 2,
    covered_area: 180, city: 'Asunción', neighborhood: 'Villa Morra', property_type: 'casa',
    contact_phone: '595981000000', admin_status: 'active', status: 'published',
  };
}
const keyOf = (row) => dedupeKey(row, normalizeZone(row).zone_canonical);

// ── Minimal in-memory PostgREST: eq / neq / is / in filters, or=(…), limit, upsert.
// neq/eq on NULL are false, like SQL.
function fakeDb(tables) {
  let seq = 0;
  const T = (t) => (tables[t] ||= []);
  const unq = (s) => s.replace(/^"(.*)"$/, '$1');
  const splitTop = (s) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of s) {
      if (ch === '"') q = !q;
      if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    return [...out, cur];
  };
  const test = (row, col, op, val) => {
    const v = row[col];
    if (op === 'eq') return v != null && String(v) === unq(val);
    if (op === 'neq') return v != null && String(v) !== unq(val);
    if (op === 'is') return val === 'null' ? v == null : String(v) === val;
    if (op === 'in') return v != null && splitTop(val.slice(1, -1)).map(unq).includes(String(v));
    throw new Error(`fake db: unsupported op ${op}`);
  };
  const cond = (s) => { const i = s.indexOf('.'); const j = s.indexOf('.', i + 1); return [s.slice(0, i), s.slice(i + 1, j), s.slice(j + 1)]; };
  const where = (query) => {
    const preds = []; let limit = Infinity;
    for (const [k, raw] of new URLSearchParams(query)) {
      if (k === 'select' || k === 'order') continue;
      if (k === 'limit') { limit = Number(raw); continue; }
      if (k === 'or') {
        const parts = splitTop(raw.slice(1, -1)).map(cond);
        preds.push((r) => parts.some(([c, o, v]) => test(r, c, o, v)));
        continue;
      }
      const i = raw.indexOf('.');
      preds.push((r) => test(r, k, raw.slice(0, i), raw.slice(i + 1)));
    }
    return { match: (r) => preds.every((f) => f(r)), limit };
  };
  return {
    async select(t, query = '') { const w = where(query); return T(t).filter(w.match).slice(0, w.limit).map((r) => ({ ...r })); },
    async insert(t, rows, opts = {}) {
      return rows.map((r) => {
        const keys = opts.upsert && opts.onConflict ? opts.onConflict.split(',') : null;
        const hit = keys && T(t).find((x) => keys.every((k) => x[k] === r[k]));
        if (hit) return Object.assign(hit, r);
        const row = { id: `${t}-${++seq}`, ...r };
        T(t).push(row);
        return { ...row };
      });
    },
    async update(t, filter, patch) { const w = where(filter); T(t).filter(w.match).forEach((r) => Object.assign(r, patch)); return []; },
    async remove(t, filter) { const w = where(filter); tables[t] = T(t).filter((r) => !w.match(r)); return null; },
  };
}

function seed() {
  const tables = {
    scrape_sources: [{ id: SRC, key: 'habitamia', adapter: 'habitamia_html', base_url: 'https://habitamia.com', config: {}, default_filters: {} }],
    scrape_runs: [],
    properties: [],
    ingest_quarantine: [],
  };
  h.db = fakeDb(tables);
  return tables;
}
const addRun = (tables, o = {}) => {
  const run = { id: `run-${tables.scrape_runs.length + 1}`, source_id: SRC, status: 'running', control: 'run', filters: {}, progress: { heartbeat: new Date().toISOString() }, started_at: new Date().toISOString(), ...o };
  tables.scrape_runs.push(run);
  return run.id;
};

beforeEach(() => {
  h.page = [];
  h.onClassify = null;
  h.fetchPage = vi.fn(async (cfg, f, skip, top) => ({ total: h.page.length, items: h.page.slice(skip, skip + top) }));
});

describe('a listing is never quarantined as a duplicate of its own row', () => {
  it('the same listing twice in one run: inserted once, then known (not "new")', async () => {
    const tables = seed();
    h.page = [{ id: '52500001' }, { id: '52500001' }];

    const out = await runJob({ runId: addRun(tables), country: 'py' });

    expect(tables.properties.filter((p) => p.external_id === '52500001')).toHaveLength(1);
    expect(tables.ingest_quarantine).toEqual([]);
    expect(out).toMatchObject({ inserted: 1, duplicates: 0, skipped: 1, quarantined: 0 });
  });

  it('a listing an overlapping job inserted after this page was read is updated, not held as its own duplicate', async () => {
    const tables = seed();
    h.page = [{ id: '52500002' }];
    // Another job on this source inserts the listing between this job's page
    // snapshot and its duplicate check (what happened on 2026-10-07).
    h.onClassify = async () => {
      h.onClassify = null;
      const row = listingRow(SRC, '52500002');
      tables.properties.push({ ...row, id: 'prop-other-job', dedupe_key: keyOf(row), is_delisted: false, source_hash: 'older' });
    };

    const out = await runJob({ runId: addRun(tables), country: 'py' });

    expect(tables.properties.filter((p) => p.external_id === '52500002')).toHaveLength(1);
    expect(tables.ingest_quarantine).toEqual([]);
    expect(out).toMatchObject({ inserted: 0, updated: 1, duplicates: 0 });
  });

  it('isDuplicate skips the listing itself but still finds other sources and owner listings', async () => {
    const tables = seed();
    const row = listingRow(SRC, '52500003');
    const dk = keyOf(row);
    const live = { admin_status: 'active', is_delisted: false, dedupe_key: dk };
    tables.properties.push({ id: 'own', source_id: SRC, external_id: '52500003', ...live });
    const self = { sourceId: SRC, externalId: '52500003' };

    expect(await isDuplicate(dk, h.db, self)).toBe(null);

    tables.properties.push({ id: 'owner-listing', source_id: null, external_id: null, ...live });
    expect(await isDuplicate(dk, h.db, self)).toBe('owner-listing');

    tables.properties.splice(1);
    tables.properties.push({ id: 'other-source', source_id: 'src-remax', external_id: '52500003', ...live });
    expect(await isDuplicate(dk, h.db, self)).toBe('other-source');
  });

  it('runScrape does not start a second job on a run that is already live', async () => {
    const tables = seed();
    const live = addRun(tables);

    const out = await runScrape({ sourceKey: 'habitamia', trigger: 'cron', country: 'py' });

    expect(out).toMatchObject({ runId: live, attached: true });
    expect(h.fetchPage).not.toHaveBeenCalled();
    expect(tables.scrape_runs).toHaveLength(1);
  });
});
