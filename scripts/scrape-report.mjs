// One-off reporting: per-country, per-source scrape stats for a cost report.
// Reads each country DB directly (no writes). Numbers: properties on marketplace,
// quarantined, images stored, images screened by Vision, and Vision API calls.
const DBS = {
  Uruguay: { url: 'https://04cf7554e5544980b115.db.airosofts.com', key: 'sb_secret_oDyrc_waX8rlTVGURNQqFYDyYobmZ535h7vwMiDrz7o' },
  Bolivia: { url: 'https://0439ac8070f3463d81b5.db.airosofts.com', key: 'sb_secret_rurWahAjHLPpt3UGWBiTIGpjT5tZexJ7Pa6Xn-NvbYc' },
};

async function sel(db, table, query) {
  const res = await fetch(`${db.url}/rest/v1/${table}?${query}`, {
    headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
  });
  if (!res.ok) return [];
  return res.json();
}
async function count(db, table, filter = '') {
  const res = await fetch(`${db.url}/rest/v1/${table}?select=id${filter ? '&' + filter : ''}`, {
    headers: { apikey: db.key, Authorization: `Bearer ${db.key}`, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = res.headers.get('content-range') || '*/0';
  return Number(cr.split('/')[1] || 0);
}

for (const [country, db] of Object.entries(DBS)) {
  console.log(`\n================  ${country.toUpperCase()}  ================`);
  const sources = await sel(db, 'scrape_sources', 'select=id,key,name');
  const byId = new Map(sources.map((s) => [s.id, s]));

  // scrape_runs — aggregate per source
  const runs = await sel(db, 'scrape_runs', 'select=source_id,status,inserted_count,updated_count,skipped_count,total_found,images_uploaded,progress&limit=1000');
  // api_usage_log — Vision calls per source
  let usage = await sel(db, 'api_usage_log', 'select=source,api,calls&limit=10000');

  const agg = {};
  const ensure = (k) => (agg[k] = agg[k] || { runs: 0, inserted: 0, updated: 0, skipped: 0, found: 0, imagesStored: 0, imagesScreened: 0, running: false });

  for (const r of runs) {
    const s = byId.get(r.source_id);
    const key = s ? s.key : (r.source_id || 'unknown');
    const a = ensure(key);
    a.runs += 1;
    a.inserted += r.inserted_count || 0;
    a.updated += r.updated_count || 0;
    a.skipped += r.skipped_count || 0;
    a.found += r.total_found || 0;
    a.imagesStored += r.images_uploaded || 0;
    a.imagesScreened += (r.progress && r.progress.images) || 0;
    if (r.status === 'running' || r.status === 'paused') a.running = true;
  }

  // Vision calls per source key (api_usage_log.source stores the source key)
  const visionBySource = {};
  let visionTotal = 0;
  for (const u of usage) {
    if ((u.api || '').toLowerCase().includes('vision') || true) {
      visionBySource[u.source] = (visionBySource[u.source] || 0) + (u.calls || 0);
      visionTotal += u.calls || 0;
    }
  }

  // live marketplace + quarantine counts per source
  for (const s of sources) {
    const a = ensure(s.key);
    a.marketplace = await count(db, 'properties', `source_id=eq.${s.id}`);
    a.quarantined = await count(db, 'ingest_quarantine', `source_id=eq.${s.id}`);
    a.visionCalls = visionBySource[s.key] || 0;
  }

  const totalProps = await count(db, 'properties');
  const totalImages = await count(db, 'property_images');
  const totalQuar = await count(db, 'ingest_quarantine');

  for (const s of sources) {
    const a = agg[s.key];
    console.log(`\n  • ${s.name} (${s.key})${a.running ? '  [RUN STILL IN PROGRESS]' : ''}`);
    console.log(`      on marketplace : ${a.marketplace}`);
    console.log(`      quarantined    : ${a.quarantined}`);
    console.log(`      images stored  : ${a.imagesStored}`);
    console.log(`      images screened (Vision): ${a.imagesScreened}`);
    console.log(`      Vision API calls (logged): ${a.visionCalls}`);
    console.log(`      runs: ${a.runs}  found(fetched): ${a.found}  updated: ${a.updated}  skipped(dupes): ${a.skipped}`);
  }
  console.log(`\n  --- ${country} TOTALS ---`);
  console.log(`      properties on marketplace : ${totalProps}`);
  console.log(`      property images stored     : ${totalImages}`);
  console.log(`      quarantined (all sources)  : ${totalQuar}`);
  console.log(`      Vision API calls (all logged): ${visionTotal}`);
}
console.log('\n(done)');
