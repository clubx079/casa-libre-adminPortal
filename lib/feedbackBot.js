// Is this feedback (or account) from a bot / automated tester, not a person? Used by the
// Feedback page (a "Bot" tag + filter: bot rows still show, never deleted) and by the Admin
// Manager (lib/manager/checks.js: bots are flagged, never emailed). Pure — test/feedbackBot.test.js.
//
// What we have seen: Google Play's pre-launch robot ("Crawler robo") opens the Android app
// and leaves ratings as crawlerrobo@gmail.com with a random 6-letter name (xalyqe, ncpoig,
// ekkezo …) and empty or random text (naovjf).

// Known automated testers / crawlers by email.
const BOT_EMAIL = /(^|[._+-])(crawler|crawlerrobo|robo|robot|bot|spider|testlab|cloudtestlab|preLaunch|firebase-?test)([._+\d-]|@)|@(cloudtestlabaccounts\.com|example\.(com|org|net)|test\.com|mailinator\.com)$/i;
// A lone lowercase 5–8 letter "word" that no language would write: 3+ consonants in a row
// (y counts as one), a doubled k/w/x, a q without u, or at most one vowel.
const RANDOM_TOKEN = /^[a-z]{5,8}$/;
const looksRandom = (s) => RANDOM_TOKEN.test(s)
  && (/[^aeiou]{3,}/.test(s) || /(kk|ww|xx)/.test(s) || /q(?!u)/.test(s) || (s.match(/[aeiou]/g) || []).length <= 1);

// → a short reason (English) when it looks automated, else null. Random names only count
// without an account and with no real message (a person's lowercase name + words passes).
export function botReason(row = {}) {
  const email = String(row.email || '').trim();
  const name = String(row.name || row.full_name || '').trim();
  const msg = String(row.message || '').trim();
  if (email && BOT_EMAIL.test(email)) return `Automated tester email (${email.replace(/^(.{3}).*(@.*)$/, '$1…$2')}), like Google Play's pre-launch robot`;
  if (!row.user_id && name && looksRandom(name) && (!msg || looksRandom(msg))) return `Random generated name "${name}"${msg ? ` and text "${msg}"` : ' and no message'}`;
  return null;
}

export const isBot = (row) => botReason(row) !== null;
