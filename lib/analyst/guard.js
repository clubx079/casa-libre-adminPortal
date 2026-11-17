// AI Analyst — checks the model's report against the data pack, in code, before anyone sees it:
//  1. every number in a piece of evidence must exist in the data pack (rounding allowed) —
//     evidence that cites numbers we do not have is marked inData:false; a finding with no
//     evidence found in the data drops to confidence "guess";
//  2. "bot / automated / fake traffic" is only allowed when the code's bot signals flagged a
//     segment as automated_likely — otherwise the finding drops to "guess" with a warning;
//  3. outside-world verdicts must name an event that is in the pack's timeline.
// Pure — test/analystGuard.test.js.

const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b${MONTHS}\\s+\\d{1,2}(st|nd|rd|th)?\\b`, 'gi'),
  new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+${MONTHS}\\b`, 'gi'),
  /\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/gi,                  // clock times
  /\b\d{1,2}\s*(–|-|to)\s*\d{1,2}\s*(am|pm|h)\b/gi,      // hour ranges
  /\b(19|20)\d{2}\b/g,                                     // years
  /\b\d+\s*days?\b/gi, /\b\d+\s*weeks?\b/gi,              // period lengths
  /\b(top|last|first|next)\s+\d+\b/gi,
];

// every number in the pack (and its rounded forms), sorted for tolerance lookups
export function packNumbers(pack) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(Math.abs(v));
    else if (typeof v === 'string') { for (const m of v.matchAll(/-?\d[\d,]*\.?\d*/g)) { const n = Number(m[0].replace(/,/g, '')); if (Number.isFinite(n)) out.push(Math.abs(n)); } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(pack);
  return Float64Array.from(new Set(out)).sort();
}

// the numbers a piece of text claims (dates, times, years and tiny numbers left out)
export function claimedNumbers(text) {
  let t = String(text || '');
  for (const re of DATE_PATTERNS) t = t.replace(re, ' ');
  const out = [];
  for (const m of t.matchAll(/(\d[\d,]*\.?\d*)\s*(k\b)?/gi)) {
    let n = Number(m[1].replace(/,/g, '').replace(/\.$/, ''));
    if (!Number.isFinite(n)) continue;
    if (m[2]) n *= 1000;
    if (n < 10) continue;   // 3 → 5 sign-ups etc. too common to check
    out.push(n);
  }
  return out;
}

// is n in the pack, allowing rounding (±0.5 or ±1.5%), or as a share of 100 / a 1000 ("1.2k")
export function inPack(n, nums) {
  const tol = Math.max(0.51, Math.abs(n) * 0.015);
  let lo = 0, hi = nums.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (nums[mid] < n - tol) lo = mid + 1; else hi = mid; }
  return lo < nums.length && nums[lo] <= n + tol;
}

export function checkText(text, nums) {
  const claimed = claimedNumbers(text);
  if (!claimed.length) return { inData: null, missing: [] };
  const missing = claimed.filter((n) => !inPack(n, nums));
  return { inData: missing.length === 0, missing };
}

const BOT_WORDS = /\b(bots?|botnet|bot[- ]?(burst|swarm|traffic|attack)|automated (traffic|visits?)|crawlers?|scrapers?|fake (traffic|visits?|visitors?)|spam (traffic|visits?))\b/i;
export const mentionsBots = (text) => BOT_WORDS.test(String(text || ''));

const texts = (o) => {
  const out = [];
  const walk = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(o);
  return out.join(' \n ');
};

export function guardReport(result, pack) {
  const r = JSON.parse(JSON.stringify(result || {}));
  const nums = packNumbers(pack);
  const warnings = [];
  const botFlagged = (pack?.sections?.botSignals?.automatedLikely || []).length > 0;
  const botNote = pack?.sections?.botSignals?.error ? 'bot signals were not available' : 'the bot signals flagged no segment as automated';

  for (const c of r.changes || []) {
    let anyIn = false;
    for (const e of c.evidence || []) {
      const chk = checkText(`${e.value}`, nums);
      e.inData = chk.inData;
      if (chk.missing.length) e.notInData = chk.missing;
      if (chk.inData) anyIn = true;
    }
    const notes = [];
    if (!anyIn && c.confidence !== 'guess') { notes.push('none of its evidence numbers were found in the data'); c.confidence = 'guess'; }
    if (!botFlagged && mentionsBots(texts([c.title, c.dataShows, c.explanation, c.change]))) {
      notes.push(`it mentions bots but ${botNote}`);
      c.confidence = 'guess';
    }
    if (notes.length) c.guardNote = `Downgraded: ${notes.join('; ')}.`;
  }
  if (!botFlagged && mentionsBots(texts([r.headline, r.summary, r.nextSteps, r.channels, r.outsideWorld]))) {
    warnings.push(`The text mentions bot / automated traffic, but ${botNote}. Treat that wording as unsupported.`);
  }
  const ids = new Set((pack?.outsideWorld?.events || []).map((e) => e.id));
  const before = (r.outsideWorld || []).length;
  r.outsideWorld = (r.outsideWorld || []).filter((o) => ids.has(o.eventId));
  if (r.outsideWorld.length < before) warnings.push(`${before - r.outsideWorld.length} outside-world item(s) named an event that is not in the timeline and were removed.`);
  r.guardWarnings = warnings;
  return r;
}
