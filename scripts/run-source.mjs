// Run the REAL scrape pipeline for one source against one country's DB, locally.
// Full pipeline: fetch → class filter → AI type → dedupe/validate → Vision screen
// → LaMa watermark clean → Casa Libre logo stamp → B2 mirror → insert.
//
//   node --loader ./scripts/_run-loader.mjs scripts/run-source.mjs \
//        --source remax_uy --country uy --limit 500 --class buildings
//
// Env comes from .env.local (control DB + per-country DB + Vision/LaMa/B2/Groq).
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const source = arg('source', 'remax_uy');
const country = arg('country', 'uy');
const limit = Number(arg('limit', '500'));
const klass = arg('class', 'buildings'); // buildings | land | all

// Raise the Vision runaway cap so a full 500-listing run isn't cut short.
if (!process.env.CASALIBRE_MAX_VISION_IMAGES_PER_RUN) {
  process.env.CASALIBRE_MAX_VISION_IMAGES_PER_RUN = String(Math.max(2500, limit * 14));
}

const { runScrape } = await import('../lib/scrape.js');

console.log(`[run-source] source=${source} country=${country} limit=${limit} class=${klass} visionCap=${process.env.CASALIBRE_MAX_VISION_IMAGES_PER_RUN}`);
const t0 = Date.now();
try {
  const summary = await runScrape({ sourceKey: source, filters: { limit, class: klass }, trigger: 'manual', country });
  console.log(`[run-source] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log('[run-source] SUMMARY', JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (e) {
  console.error('[run-source] ERROR', e && (e.stack || e.message || e));
  process.exit(1);
}
