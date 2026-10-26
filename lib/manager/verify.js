// Admin Manager — the NUMBER GUARD. Every number the AI writes must exist in what it was
// given (the data pack, the earlier reports it read, the admins' notes, the fixed prices in
// the system prompt). The code checks that after the AI answers:
//   - each action cites data fields ("facts": paths like listings.newThisWeek.total); the
//     page shows those values read by code, so the evidence never comes from the AI;
//   - every number in the AI's text is looked up among the known numbers (with rounding);
//     one that is not there marks the item "unverified" (bullet points are dropped).
// Pure — test/managerVerify.test.js.

// Fixed numbers the system prompt states (prices, limits, windows) — always allowed.
export const POLICY_NUMBERS = [29, 80, 5.8, 5, 20, 0.07, 3, 7, 14, 30, 90, 70, 24, 48, 6, 1, 2];

// Numbers inside a text. Skips dates (2026-10-21, Oct 21), clock times (07:00), years and
// numbers that are part of ids / words (abc123, v2, 1.4.0).
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
export function numbersIn(text) {
  let s = String(text || '');
  s = s.replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g, ' ')
    .replace(new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\b\d+(?:\.\d+){2,}\b/g, ' ')                 // versions 1.4.0
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ' ');      // uuids
  const out = [];
  const re = /(^|[^\w.])(-?\d[\d,]*(?:\.\d+)?)(?![\w])/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = m[2];
    const n = Number(raw.replace(/,(?=\d{3}\b)/g, ''));
    if (!Number.isFinite(n)) continue;
    if (n >= 2000 && n <= 2100 && Number.isInteger(n)) continue;   // a year
    out.push(Math.abs(n));
  }
  return out;
}

// The pairs a person compares, so "+5" / "−40%" / "1 of 11 = 9%" built from them is real:
// this period vs the previous one, and a part vs its whole.
const PAIRS = [
  ['thisWeek', 'previousWeek'], ['value', 'previous'], ['total', 'previous'],
  ['clicked', 'delivered'], ['clicked', 'sent'], ['opened', 'delivered'], ['read', 'delivered'], ['read', 'sent'],
  ['bounced', 'sent'], ['failed', 'sent'], ['listed', 'matched'], ['paid', 'matched'], ['active', 'matched'],
  ['realConversions', 'conversions'], ['conversions', 'clicks'], ['clicks', 'impressions'], ['succeeded', 'failed'],
  ['liveRent', 'liveSale'], ['liveOwnerListings', 'liveScrapedListings'], ['low', 'count'],
];

// Every number under a value (deep): leaves, plus differences and percentages of the
// comparison PAIRS above when both sit in the same object. Kept narrow on purpose: deriving
// from any two siblings makes so many numbers "known" that invented ones slip through.
export function knownNumbers(...sources) {
  const set = new Set();
  const add = (n) => { if (Number.isFinite(n)) set.add(Math.round(Math.abs(n) * 1000) / 1000); };
  const derive = (a, b) => {
    add(a - b);
    if (b) { add(((a - b) / b) * 100); add((a / b) * 100); }
  };
  const walk = (v, depth = 0) => {
    if (depth > 12 || v == null) return;
    if (typeof v === 'number') { add(v); return; }
    if (typeof v === 'string') { for (const n of numbersIn(v)) add(n); return; }
    if (typeof v !== 'object') return;
    if (!Array.isArray(v)) {
      for (const [x, y] of PAIRS) if (typeof v[x] === 'number' && typeof v[y] === 'number') derive(v[x], v[y]);
      // the same field across the two periods: { thisWeek: {…}, previousWeek: {…} }
      for (const [x, y] of [['thisWeek', 'previousWeek'], ['newThisWeek', 'newPreviousWeek'], ['signups', 'signupsPrevious'], ['sentThisWeek', 'sentPreviousWeek']]) {
        if (v[x] && v[y] && typeof v[x] === 'object' && typeof v[y] === 'object') {
          for (const k of Object.keys(v[x])) if (typeof v[x][k] === 'number' && typeof v[y][k] === 'number') derive(v[x][k], v[y][k]);
        }
      }
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  for (const s of sources) walk(s);
  for (const n of POLICY_NUMBERS) add(n);
  return set;
}

// Is n one of the known numbers (allowing the rounding a person would do)?
export function isKnown(n, known) {
  if (known.has(Math.round(n * 1000) / 1000)) return true;
  // rounding a person does: 9.09 → 9.1 or 9; 24.9 → 25
  const tol = Number.isInteger(n) ? 0.5 : 0.051;
  for (const k of known) {
    if (Math.abs(k - n) <= tol) return true;
    // "1,200" / "1.2k" written from 1187: a round number within 2% of a real one
    if (n >= 1000 && n % 100 === 0 && Math.abs(k - n) / n <= 0.02) return true;
  }
  return false;
}

export const unknownNumbers = (text, known) => numbersIn(text).filter((n) => !isKnown(n, known));

// A value at a path in the pack: "listings.newThisWeek.total", "traffic.funnel[0].thisWeek",
// "traffic.funnel.Visited.thisWeek" (an array entry by its step / label / automation / key).
export function getPath(obj, path) {
  const parts = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(p)) {
      cur = cur.find((x) => x && typeof x === 'object' && [x.step, x.label, x.automation, x.key, x.type, x.source, x.device, x.name].some((v) => String(v) === p));
    } else cur = cur[p];
  }
  return cur;
}

// A fact's value, short enough to show next to an action.
export function factValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  const j = JSON.stringify(v);
  return j.length > 160 ? `${j.slice(0, 157)}…` : j;
}

const TEXT_FIELDS = ['title', 'why', 'how', 'evidence'];

// brief: the AI's answer. sources: everything the AI was given that may hold numbers.
// → { brief (cleaned), guard: { checked, unverified: [{ where, numbers, text }], removedPoints } }
export function verifyBrief(brief, { pack, sources = [] }) {
  const known = knownNumbers(pack, ...sources);
  const guard = { checked: 0, unverified: [], removedPoints: [], badFacts: 0 };
  const check = (where, text) => {
    const nums = numbersIn(text);
    guard.checked += nums.length;
    const bad = nums.filter((n) => !isKnown(n, known));
    if (bad.length) guard.unverified.push({ where, numbers: bad, text: String(text).slice(0, 200) });
    return bad;
  };
  const resolve = (paths = []) => {
    const out = [];
    for (const p of paths) {
      const v = getPath(pack, p);
      if (v === undefined) { guard.badFacts += 1; continue; }
      out.push({ path: String(p).slice(0, 120), value: factValue(v) });
    }
    return out;   // every cited fact counts for the check (not just the first 6)
  };

  const b = { ...brief };
  const headBad = check('headline', b.headline);
  b.headline_verified = headBad.length === 0;
  b.points = (b.points || []).filter((p) => {
    if (check('point', p).length) { guard.removedPoints.push(p); return false; }
    return true;
  });
  // An action's numbers must come from the data IT cites (the fact and the object around it,
  // so "14 vs 9" from newThisWeek / newPreviousWeek works) — a number that only happens to
  // exist somewhere else in the pack does not count. "how" may name settings (24 h), so it
  // is checked against everything.
  const localKnown = (paths = []) => knownNumbers(...paths.flatMap((p) => {
    const parts = String(p).replace(/\[(\d+)\]/g, '.$1').split('.');
    return [getPath(pack, p), getPath(pack, parts.slice(0, -1).join('.')), getPath(pack, parts.slice(0, -2).join('.'))];
  }).filter((v) => v !== undefined));
  const checkLocal = (where, text, local) => {
    const nums = numbersIn(text);
    guard.checked += nums.length;
    const bad = nums.filter((n) => !isKnown(n, local));
    if (bad.length) guard.unverified.push({ where, numbers: bad, text: String(text).slice(0, 200) });
    return bad;
  };
  b.actions = (b.actions || []).map((a, i) => {
    const evidence = resolve(a.facts);
    const local = localKnown(evidence.map((e) => e.path));
    const bad = [
      ...checkLocal(`action ${i + 1} title`, a.title, local),
      ...checkLocal(`action ${i + 1} why`, a.why, local),
      ...check(`action ${i + 1} how`, a.how),
    ];
    return { ...a, evidence, unverified: [...new Set(bad)], verified: bad.length === 0 && evidence.length > 0 };
  });
  // each area's section: points whose numbers are not in its cited data are removed
  b.sections = (b.sections || []).map((sec) => {
    const facts = resolve(sec.facts);
    const local = localKnown(facts.map((e) => e.path));
    const points = (sec.points || []).filter((pt) => {
      if (checkLocal(`${sec.id} section`, pt, local).length) { guard.removedPoints.push(pt); return false; }
      return true;
    });
    const headBad = checkLocal(`${sec.id} headline`, sec.headline, local);
    return { ...sec, points, evidence: facts, headline_verified: headBad.length === 0 };
  });
  b.followup_checks = (b.followup_checks || []).map((c, i) => {
    const facts = resolve(c.facts);
    // evidence may quote the admins' notes / earlier reports (the sources) too
    const local = new Set([...localKnown(facts.map((e) => e.path)), ...knownNumbers(...sources)]);
    const bad = checkLocal(`follow-up ${i + 1}`, c.evidence, local);
    return { ...c, evidence_facts: facts, unverified: bad, verified: bad.length === 0 };
  });
  if (b.tahir) {
    b.tahir = {
      facts: (b.tahir.facts || []).filter((f) => { if (check('tahir fact', f).length) { guard.removedPoints.push(f); return false; } return true; }),
      actions: (b.tahir.actions || []).filter((f) => { if (check('tahir action', f).length) { guard.removedPoints.push(f); return false; } return true; }),
    };
  }
  return { brief: b, guard };
}
