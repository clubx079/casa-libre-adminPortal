// End-to-end runs against the SANDBOX database (not part of `npm test`):
//   npx vitest run --config scripts/e2e/vitest.e2e.config.mjs
// Loads .env.local, refuses to run unless every country DB is the sandbox and Relay is in test mode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch { /* no .env.local */ }

export default defineConfig({
  resolve: { alias: [{ find: /^@\//, replacement: `${root}/` }, { find: 'server-only', replacement: path.join(root, 'scripts/e2e/server-only-stub.mjs') }] },
  test: {
    root,
    include: ['scripts/e2e/*.e2e.mjs'],
    env: { ...env, ...process.env, INBOX_RELAY_MODE: 'test', INBOX_POLL: '0' },
    testTimeout: 240000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
