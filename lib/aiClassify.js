// AI property-type classification for the ingest pipeline (server-only wrapper
// around the pure logic in lib/aiClassifyCore.js, which is also used by the
// standalone backfill script in scripts/backfill-ai-types.mjs).
import 'server-only';
import { TYPES, normalizeToType, classifyPropertyTypeCore } from './aiClassifyCore';

export { TYPES, normalizeToType };

// Classify a scraped property record into one of the canonical internal types.
// Returns a canonical label string, or null if the AI can't be reached (the
// caller should keep the source's own type in that case). Never throws.
export async function classifyPropertyType(deal) {
  return classifyPropertyTypeCore(deal);
}
