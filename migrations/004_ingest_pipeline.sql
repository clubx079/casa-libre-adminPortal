-- Migration 004 — Deeper ingest pipeline (audit #2 / #4 / #13 / #28)
-- Apply by hand in the AiroBase SQL editor (PostgREST cannot run DDL).
--
-- Adds a source-side quarantine/review queue plus the columns the ingest
-- pipeline writes for dedupe, zone taxonomy and image screening. All statements
-- are idempotent (IF NOT EXISTS) so re-running is safe.

-- ── #2 — Ingest quarantine / review queue ────────────────────────────────────
-- Suspect scraped records are held here INSTEAD of polluting `properties`.
-- An admin reviews them and either releases (promotes to properties) or discards.
CREATE TABLE IF NOT EXISTS ingest_quarantine (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid REFERENCES scrape_sources(id) ON DELETE CASCADE,
  external_id  text,
  reasons      text[]      NOT NULL DEFAULT '{}',   -- machine reason codes (see lib/ingest.js)
  payload      jsonb       NOT NULL,                -- the mapped row we would have inserted
  dedupe_key   text,                                -- fuzzy signature (audit #4)
  duplicate_of uuid,                                -- the active property this duplicates, if any
  status       text        NOT NULL DEFAULT 'pending', -- pending | released | discarded
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  text,
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS ingest_quarantine_status_idx  ON ingest_quarantine (status);
CREATE INDEX IF NOT EXISTS ingest_quarantine_created_idx ON ingest_quarantine (created_at DESC);
CREATE INDEX IF NOT EXISTS ingest_quarantine_dedupe_idx  ON ingest_quarantine (dedupe_key);

-- ── #4 — Cross-source de-duplication ─────────────────────────────────────────
-- Fuzzy signature (zone + type + area bucket + price bucket + beds). Two active
-- listings with the same key are near-certain duplicates across sources.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE INDEX IF NOT EXISTS properties_dedupe_key_idx ON properties (dedupe_key);

-- ── #13 — Zone taxonomy ──────────────────────────────────────────────────────
-- Cleaned, controlled barrio/ciudad value (marketing text stripped, canonical
-- name resolved). The raw neighborhood/city columns are left intact.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS zone_canonical text;
CREATE INDEX IF NOT EXISTS properties_zone_canonical_idx ON properties (zone_canonical);

-- ── #28 — Image screening ────────────────────────────────────────────────────
-- ok    = at least one image mirrored successfully
-- none  = the source listing carried no images
-- broken= the source listed image URLs but every one failed to mirror
ALTER TABLE properties ADD COLUMN IF NOT EXISTS image_status text;
CREATE INDEX IF NOT EXISTS properties_image_status_idx ON properties (image_status);
