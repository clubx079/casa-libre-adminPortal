// Run SEO pipeline stages from the command line (same code as /api/cron/seo):
//   node --loader ./scripts/_run-loader.mjs scripts/seo-run.mjs --job collect|trends|decide|improve|daily|summary --country py
// Env from .env.local. Writes ONLY the seo_* tables (country DB, or SEO_DB_URL in local dev);
// Google + PostHog are read-only.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const job = arg('job', 'daily');
const cc = arg('country', 'py');

const { runCollect, runDecide, runImprove, seoSummary } = await import('../lib/seo/run.js');
let out;
if (job === 'trends') out = await runCollect(cc, ['trends']);
else if (job === 'collect') out = await runCollect(cc, ['ads', 'gsc', 'site_search']);
else if (job === 'decide') out = await runDecide(cc);
else if (job === 'improve') out = await runImprove(cc);
else if (job === 'summary') out = await seoSummary(cc);
else out = { collect: await runCollect(cc), decide: await runDecide(cc) };
console.log(JSON.stringify(out, null, 2));
