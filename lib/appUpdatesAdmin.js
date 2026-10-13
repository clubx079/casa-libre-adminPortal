// Mobile app updates — the versions the phone app is told about on every start
// (buyer portal /api/mobile/app-version → the app's update sheet):
//   installed < latest  → "Update available" (dismissible, asks again after 24 h)
//   installed < minimum → "Update required" (blocking, only button = store)
//
// Stored per country DB as the `automations` row 'app_versions' (enabled + the settings
// in free_tiers[0]; no table of its own, no database change). The buyer portal applies
// a field only when the row is enabled AND the field is filled — otherwise it keeps its
// env vars (MOBILE_MIN_VERSION… / MOBILE_LATEST_VERSION…), exactly as before this page.
// Same shape as the buyer portal's lib/appVersionPolicy.js settingsToEnv().

export const APP_VERSIONS_ID = 'app_versions';
export const PLATFORMS = ['android', 'ios'];

const VER = /^\d{1,3}(\.\d{1,3}){0,2}$/;
const clean = (v) => String(v ?? '').trim();

export function compareVersions(a, b) {
  const pa = clean(a).split('.').map(Number), pb = clean(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const emptyPlat = () => ({ min: '', latest: '', storeUrl: '' });

// automations row → the form (all strings; '' = not set → the site keeps its env value).
export function settingsFromRow(row) {
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  const plat = (p) => ({ min: clean(s[p]?.min), latest: clean(s[p]?.latest), storeUrl: clean(s[p]?.storeUrl) });
  const test = (p) => ({ min: clean(s.test?.[p]?.min), latest: clean(s.test?.[p]?.latest) });
  return {
    enabled: !!row?.enabled,
    android: row ? plat('android') : emptyPlat(),
    ios: row ? plat('ios') : emptyPlat(),
    testEmails: Array.isArray(s.testEmails) ? s.testEmails.join(', ') : '',
    test: { android: test('android'), ios: test('ios') },
    updatedAt: row?.updated_at || null,
  };
}

// The form → { ok, value: automations row fields, errors }.
export function validateAppUpdates(input = {}) {
  const errors = {};
  const out = { android: {}, ios: {}, test: { android: {}, ios: {} } };
  const checkVer = (key, v) => {
    const s = clean(v);
    if (s && !VER.test(s)) errors[key] = 'Use a version like 1.4.0';
    return s;
  };
  for (const p of PLATFORMS) {
    const src = input[p] || {};
    const min = checkVer(`${p}.min`, src.min);
    const latest = checkVer(`${p}.latest`, src.latest);
    const storeUrl = clean(src.storeUrl);
    if (storeUrl && !/^https:\/\/\S+$/.test(storeUrl)) errors[`${p}.storeUrl`] = 'Must start with https://';
    if (min && latest && !errors[`${p}.min`] && !errors[`${p}.latest`] && compareVersions(min, latest) > 0) {
      errors[`${p}.min`] = 'The minimum cannot be higher than the latest version.';
    }
    if (min) out[p].min = min;
    if (latest) out[p].latest = latest;
    if (storeUrl) out[p].storeUrl = storeUrl;
    const t = (input.test || {})[p] || {};
    const tMin = checkVer(`test.${p}.min`, t.min);
    const tLatest = checkVer(`test.${p}.latest`, t.latest);
    if (tMin) out.test[p].min = tMin;
    if (tLatest) out.test[p].latest = tLatest;
  }
  const emails = String(input.testEmails || '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const bad = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (bad.length) errors.testEmails = `Not an email: ${bad.join(', ')}`;
  if (emails.length > 20) errors.testEmails = 'Up to 20 testers.';
  out.testEmails = emails;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { enabled: !!input.enabled, free_tiers: [out] } };
}

// Which countries the save goes to: every country in the registry that has its own DB
// configured (AIROBASE_URL_XX) — or is the default country. Never a country whose DB
// would silently fall back to Paraguay's.
export function writableCountries(countries = [], env = process.env, defaultCountry = 'py') {
  return countries
    .map((c) => String(c.code || c).toLowerCase())
    .filter((cc) => cc === defaultCountry || !!env[`AIROBASE_URL_${cc.toUpperCase()}`]);
}
