// Scrape orchestrator as a CONTROLLABLE, PERSISTED job.
// The job runs in the background (server), writing progress to scrape_runs so a
// refreshing browser can reconnect. It polls its own `control` flag each item to
// support pause / resume / stop.
import 'server-only';
import crypto from 'crypto';
import { select, insert, update, remove } from './db';
import * as b2 from './b2';
import { isLandType } from './land';
import { classifyPropertyType } from './aiClassify';
import { getUsdToPyg } from './fx';
import { normalizeZone, dedupeKey, isDuplicate, validateListing, quarantine } from './ingest';
import { screenPropertyImages } from './imageScreen';
import { removeWatermark } from './watermarkRemover';
import remax from './adapters/remax';
import century21 from './adapters/century21';
import raices from './adapters/raices';
import inmob123 from './adapters/inmob123';
import onbienesraices from './adapters/onbienesraices';
import aurora from './adapters/aurora';
import wploteamiento from './adapters/wploteamiento';
import houzez from './adapters/houzez';
import tulugar from './adapters/tulugar';
import habitamia from './adapters/habitamia';

const ADAPTERS = {
  remax_gryphtech: remax,
  century21_symfony: century21,
  raices_html: raices,
  inmob123_html: inmob123,
  onbienesraices_api: onbienesraices,
  aurora_api: aurora,
  wp_loteamiento: wploteamiento,
  houzez_wp: houzez,
  tulugar_api: tulugar,
  habitamia_html: habitamia,
};
const PAGE = 50;
const RECENT_MAX = 40;
const FLUSH_MS = 700;
const STALE_MS = 30000; // a running/paused run with no heartbeat in this long = orphaned

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const basename = (u) => u.split('/').pop().split('?')[0];
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSourceById(id) {
  const rows = await select('scrape_sources', `id=eq.${id}&limit=1`);
  if (!rows.length) throw new Error('Source not found');
  return rows[0];
}
async function getSourceByKey(key) {
  const rows = await select('scrape_sources', `key=eq.${encodeURIComponent(key)}&limit=1`);
  if (!rows.length) throw new Error(`Unknown source '${key}'`);
  return rows[0];
}

async function readControl(runId) {
  const rows = await select('scrape_runs', `id=eq.${runId}&select=control`);
  return rows[0]?.control || 'run';
}

// A run is orphaned if it claims to be running/paused but hasn't heartbeat lately
// (its background job died — e.g. the container restarted).
function runIsStale(run) {
  const hb = run.progress && run.progress.heartbeat;
  const t = hb ? Date.parse(hb) : Date.parse(run.started_at);
  return !t || Date.now() - t > STALE_MS;
}

async function reap(id, status = 'failed') {
  await update('scrape_runs', `id=eq.${id}`, { status, finished_at: nowIso() }, { returning: 'minimal' });
}

// The genuinely-alive active run for a source (reaps stale ones). null if none.
export async function getActiveRun(sourceId) {
  const rows = await select(
    'scrape_runs',
    `source_id=eq.${sourceId}&status=in.(running,paused)&select=id,status,control,progress,started_at&order=started_at.desc`
  );
  let alive = null;
  for (const r of rows) {
    if (runIsStale(r)) await reap(r.id);
    else if (!alive) alive = r;
  }
  return alive;
}

// Set a control flag; if stopping an already-dead run, finalize it directly.
export async function requestControl(runId, control) {
  await update('scrape_runs', `id=eq.${runId}`, { control }, { returning: 'minimal' });
  if (control === 'stop') {
    const [r] = await select('scrape_runs', `id=eq.${runId}&select=id,status,progress,started_at&limit=1`);
    if (r && (r.status === 'running' || r.status === 'paused') && runIsStale(r)) {
      await reap(r.id, 'stopped');
    }
  }
}

// bounded-concurrency map (slow image hosts choke on 30+ parallel downloads)
async function poolMap(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
    })
  );
}

async function mirrorImages(source, externalId, propertyId, images) {
  let uploaded = 0;
  const rows = [];
  await poolMap(images, 4, async (img) => {
      // Pre-uploaded (e.g. watermark-cleaned) image — already in B2, just record it.
      if (img.storage_url && img.storage_key) {
        rows.push({
          property_id: propertyId,
          source_url: img.source_url,
          storage_key: img.storage_key,
          storage_url: img.storage_url,
          content_type: 'image/webp',
          bytes: null,
          is_feature: img.is_feature,
          position: img.position,
          uploaded_at: nowIso(),
        });
        uploaded++;
        return;
      }
      const key = `${source.key}/${externalId}/${basename(img.source_url)}`;
      let storage;
      if (await b2.exists(key)) {
        storage = { key, url: b2.storageUrl(key), contentType: null, bytes: null };
      } else {
        const up = await b2.mirror(img.source_url, key);
        if (!up) return;
        storage = up;
        uploaded++;
      }
      rows.push({
        property_id: propertyId,
        source_url: img.source_url,
        storage_key: storage.key,
        storage_url: storage.url,
        content_type: storage.contentType,
        bytes: storage.bytes,
        is_feature: img.is_feature,
        position: img.position,
        uploaded_at: nowIso(),
      });
  });
  if (rows.length) {
    await insert('property_images', rows, { upsert: true, onConflict: 'property_id,source_url', returning: 'minimal' });
  }
  const feature = rows.find((r) => r.is_feature) || rows.sort((a, b) => a.position - b.position)[0];
  return { uploaded, featureUrl: feature?.storage_url || null };
}

// Create the run row up front so the client gets a runId to poll immediately.
// Returns the runId. If a run is already active for the source, returns it.
export async function startRun({ sourceKey, filters = {}, trigger = 'manual' }) {
  const source = await getSourceByKey(sourceKey);
  const active = await getActiveRun(source.id); // reaps stale runs, returns a live one or null
  if (active) return { runId: active.id, source, attached: true };

  const [run] = await insert('scrape_runs', [
    {
      source_id: source.id,
      trigger,
      status: 'running',
      control: 'run',
      filters,
      progress: { found: 0, inserted: 0, updated: 0, skipped: 0, images: 0, target: 0, page: 0, recent: [], heartbeat: nowIso() },
    },
  ]);
  return { runId: run.id, source, attached: false };
}

// The background job. Loads the run + source, works, flushes progress, obeys control.
export async function runJob({ runId }) {
  const [run] = await select('scrape_runs', `id=eq.${runId}&limit=1`);
  if (!run) throw new Error('Run not found');
  const source = await getSourceById(run.source_id);
  const adapter = ADAPTERS[source.adapter];
  if (!adapter) throw new Error(`No adapter '${source.adapter}'`);

  const cfg = source.config || {};
  const merged = { ...(source.default_filters || {}), ...(run.filters || {}) };
  const limit = Math.max(1, Number(merged.limit) || 200);
  const pygPerUsd = Number(process.env.PYG_PER_USD) || 7300;
  // Live FX rate for the source-side validation floors (falls back to env).
  let fxRate = pygPerUsd;
  try { fxRate = (await getUsdToPyg()) || pygPerUsd; } catch { /* keep fallback */ }

  const s = { found: 0, inserted: 0, updated: 0, skipped: 0, images: 0, imagesRejected: 0, watermarksRemoved: 0, quarantined: 0, duplicates: 0, target: limit, page: 0 };
  const recent = [];
  const errors = [];
  const pushRecent = (e) => { recent.push(e); if (recent.length > RECENT_MAX) recent.shift(); };

  let lastFlush = 0;
  const flush = async (force = false, statusOverride) => {
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_MS) return;
    lastFlush = now;
    const patch = {
      progress: { ...s, recent, heartbeat: nowIso() },
      total_found: s.found,
      inserted_count: s.inserted,
      updated_count: s.updated,
      skipped_count: s.skipped,
      images_uploaded: s.images,
    };
    if (statusOverride) patch.status = statusOverride;
    await update('scrape_runs', `id=eq.${runId}`, patch, { returning: 'minimal' });
  };

  // Returns 'run' | 'stop' after handling any pause (blocks while paused).
  const gate = async () => {
    let c = await readControl(runId);
    if (c === 'pause') {
      await flush(true, 'paused');
      while ((c = await readControl(runId)) === 'pause') {
        await sleep(1500);
        await flush(true, 'paused'); // keep heartbeating so a paused run isn't reaped as stale
      }
      if (c !== 'stop') await flush(true, 'running');
    }
    return c === 'stop' ? 'stop' : 'run';
  };

  let stopped = false;
  try {
    let skip = 0;
    let total = Infinity;

    while (s.found < limit && skip < total) {
      if ((await gate()) === 'stop') { stopped = true; break; }

      const top = Math.min(PAGE, limit - s.found);
      const { total: t, items } = await adapter.fetchPage(cfg, merged, skip, top);
      total = t;
      s.target = Math.min(limit, total);
      s.page += 1;
      if (!items.length) break;
      skip += items.length;
      s.found += items.length;
      pushRecent({ kind: 'page', page: s.page, fetched: items.length });
      await flush(true);

      // class filter: 'buildings' (default) | 'land' | 'all'
      const wantClass = ['buildings', 'land', 'all'].includes(merged.class) ? merged.class : 'buildings';
      const mapped = items
        .map((c) => adapter.mapListing(c, { source, baseUrl: source.base_url, config: cfg, pygPerUsd }))
        .filter((m) => {
          if (!m.external_id) return false;
          if (wantClass === 'all') return true;
          const land = isLandType(m.row.property_type);
          return wantClass === 'land' ? land : !land;
        });
      const inList = mapped.map((m) => `"${String(m.external_id).replace(/"/g, '')}"`).join(',');
      const existing = inList
        ? await select('properties', `select=id,external_id,source_hash,price&source_id=eq.${source.id}&external_id=in.(${encodeURIComponent(inList)})`)
        : [];
      const byExt = new Map(existing.map((e) => [e.external_id, e]));

      for (const m of mapped) {
        if ((await gate()) === 'stop') { stopped = true; break; }
        try {
          const hash = sha(m.hashInput);
          const prev = byExt.get(m.external_id);
          const ts = nowIso();
          let propertyId;
          let action;

          // AI classifies the property into an internal type; on any failure
          // (Groq outage, rate-limit, timeout) it returns null and we keep the
          // source's own type — never let classification break a scrape run.
          try {
            const aiType = await classifyPropertyType(m.row);
            if (aiType) m.row.property_type = aiType;
          } catch { /* never break a scrape run over classification */ }

          // #13 Zone taxonomy — clean marketing text, resolve a canonical zone.
          const zone = normalizeZone(m.row);
          m.row.neighborhood = zone.neighborhood;
          m.row.city = zone.city;
          m.row.zone_canonical = zone.zone_canonical;

          // #4 De-dup signature (zone + type + area/price/beds buckets).
          const dk = dedupeKey(m.row, zone.zone_canonical);
          m.row.dedupe_key = dk;

          // #2 Source-side validation — hold suspect records for review instead
          // of polluting `properties` (mirrors the buyer completeness gate).
          const v = validateListing(m.row, fxRate);
          if (!v.ok) {
            await quarantine({ sourceId: source.id, externalId: m.external_id, row: m.row, reasons: v.reasons, dedupeKey: dk });
            s.quarantined++;
            pushRecent({ kind: 'item', action: 'quarantine', id: m.external_id, title: m.row.address, reasons: v.reasons });
            await flush();
            continue;
          }

          // #4 Cross-source duplicate — a NEW external that collides with an
          // already-active listing (any source) is held, not inserted.
          if (!prev && dk) {
            const dupOf = await isDuplicate(dk);
            if (dupOf) {
              await quarantine({ sourceId: source.id, externalId: m.external_id, row: m.row, reasons: ['duplicate'], dedupeKey: dk, duplicateOf: dupOf });
              s.duplicates++;
              pushRecent({ kind: 'item', action: 'duplicate', id: m.external_id, title: m.row.address, duplicate_of: dupOf });
              await flush();
              continue;
            }
          }

          if (!prev) {
            const [ins] = await insert('properties', [
              { ...m.row, source_hash: hash, first_scraped_at: ts, last_scraped_at: ts, last_seen_at: ts, is_delisted: false },
            ]);
            propertyId = ins.id; s.inserted++; action = 'insert';
          } else if (prev.source_hash !== hash) {
            const patch = { ...m.row, source_hash: hash, last_scraped_at: ts, last_seen_at: ts, is_delisted: false };
            if (prev.price != null && Number(prev.price) !== Number(m.row.price)) {
              patch.previous_price = prev.price; patch.price_changed_at = ts;
            }
            await update('properties', `id=eq.${prev.id}`, patch, { returning: 'minimal' });
            propertyId = prev.id; s.updated++; action = 'update';
          } else {
            await update('properties', `id=eq.${prev.id}`, { last_seen_at: ts, last_scraped_at: ts }, { returning: 'minimal' });
            s.skipped++;
            pushRecent({ kind: 'item', action: 'skip', id: m.external_id, title: m.row.address, price: m.row.price, currency: m.row.currency, images: 0 });
            await flush();
            continue;
          }

          // A listing that previously failed validation (e.g. no_contact) and now
          // passes has just been inserted/updated into `properties` — clear its
          // stale quarantine row so the review queue reflects the rescue.
          remove('ingest_quarantine', `source_id=eq.${source.id}&external_id=eq.${encodeURIComponent(m.external_id)}`).catch(() => {});

          // #28 AI image screening — Google Vision drops logos/maps/branded/
          // watermarked/people/other non-property images; only genuine property
          // photos are mirrored. Degrades gracefully without GOOGLE_VISION_API_KEY.
          let imgUploaded = 0;
          let featureUrl = null;
          let screened = [];
          if (m.images.length) {
            const { kept, branded, rejected } = await screenPropertyImages(m.images.map((i) => i.source_url));
            const keptSet = new Set(kept);
            const brandedSet = new Set(branded);
            // Clean watermarked property photos (keep the photo, drop the mark);
            // if cleaning fails, keep the original rather than lose a real photo.
            for (const img of m.images) {
              if (keptSet.has(img.source_url)) { screened.push(img); continue; }
              if (brandedSet.has(img.source_url)) {
                const cleanKey = `${source.key}/${m.external_id}/clean-${basename(img.source_url)}.webp`;
                const cleaned = await removeWatermark(img.source_url, cleanKey);
                if (cleaned) { s.watermarksRemoved = (s.watermarksRemoved || 0) + 1; screened.push({ ...img, storage_key: cleaned.key, storage_url: cleaned.url }); }
                else s.imagesRejected = (s.imagesRejected || 0) + 1; // can't clean → DROP (never show competitor branding on the site)
              }
              // rejected → dropped
            }
            if (rejected.length) {
              s.imagesRejected = (s.imagesRejected || 0) + rejected.length;
              pushRecent({ kind: 'item', action: 'img_screen', id: m.external_id, rejected: rejected.length, cleaned: branded.length, kept: keptSet.size, reasons: [...new Set(rejected.map((r) => r.reason))] });
            }
            if (screened.length) {
              const r = await mirrorImages(source, m.external_id, propertyId, screened);
              imgUploaded = r.uploaded; s.images += r.uploaded; featureUrl = r.featureUrl;
            }
          }
          // image_status: none (no source imgs) | rejected (AI dropped all) |
          //               broken (kept some but none mirrored) | ok
          let imgStat;
          if (!m.images.length) imgStat = 'none';
          else if (!screened.length) imgStat = 'rejected';
          else imgStat = featureUrl ? 'ok' : 'broken';
          const imgPatch = { image_status: imgStat };
          if (featureUrl) imgPatch.feature_image_url = featureUrl;
          await update('properties', `id=eq.${propertyId}`, imgPatch, { returning: 'minimal' });
          pushRecent({ kind: 'item', action, id: m.external_id, title: m.row.address, price: m.row.price, currency: m.row.currency, images: imgUploaded });
          await flush();
        } catch (e) {
          errors.push({ external_id: m.external_id, error: String(e.message || e) });
          pushRecent({ kind: 'item', action: 'error', id: m.external_id, title: m.row?.address, error: String(e.message || e) });
        }
      }
      if (stopped) break;
    }

    const finalStatus = stopped ? 'stopped' : errors.length ? 'partial' : 'success';
    pushRecent({ kind: 'done', status: finalStatus });
    await update('scrape_runs', `id=eq.${runId}`, {
      status: finalStatus,
      control: 'run',
      progress: { ...s, recent },
      total_found: s.found, inserted_count: s.inserted, updated_count: s.updated,
      skipped_count: s.skipped, images_uploaded: s.images,
      errors: errors.slice(0, 50), finished_at: nowIso(),
    }, { returning: 'minimal' });
    await update('scrape_sources', `id=eq.${source.id}`, { last_run_at: nowIso(), last_run_status: finalStatus }, { returning: 'minimal' });
    return { runId, status: finalStatus, ...s, errors };
  } catch (e) {
    errors.push({ fatal: String(e.message || e) });
    await update('scrape_runs', `id=eq.${runId}`, {
      status: 'failed', progress: { ...s, recent }, errors: errors.slice(0, 50), finished_at: nowIso(),
    }, { returning: 'minimal' });
    throw e;
  }
}

// Convenience for cron: start + run to completion in one call.
export async function runScrape({ sourceKey, filters = {}, trigger = 'cron' }) {
  const { runId } = await startRun({ sourceKey, filters, trigger });
  return runJob({ runId });
}
