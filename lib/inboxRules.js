// Inbox rules (admin → Inbox), on top of Relay's conversations. Pure — test/inboxRules.test.js.
//   unread       Relay's unread count, OR the team put the red dot back ("Mark as unread" —
//                the internal conversation tag 'cl-unread', cleared when someone opens it)
//   unresponded  the last message came from the contact: nobody has answered yet
//   do not contact  tags 'do-not-contact' + 'dnc: <the note>' (shared with Relay's inbox)
//   site(s)      which site(s) the number came from: every verification code a site sends
//                tags the conversation "site-<code>" (website lib/relay.js). Untagged (older)
//                chats: the country DB(s) where the number is a user / listing phone. Neither
//                → "none" (no site yet). A number used on two sites shows in both inboxes.
// Internal tags never show as tag chips.

export const UNREAD_TAG = 'cl-unread';
export const DNC_TAG = 'do-not-contact';
// Relay stores tags normalised (lowercase, spaces → "-", no commas): "dnc: Rude, stop" comes
// back as "dnc:-rude-stop", so the note is read back with dashes as spaces.
export const DNC_NOTE = 'dnc:';
export const SITE_TAG = 'site-';
export const isInternalTag = (t) => t === UNREAD_TAG || t === DNC_TAG || String(t).startsWith(DNC_NOTE) || String(t).startsWith(SITE_TAG);
export const visibleTags = (tags = []) => (tags || []).filter((t) => !isInternalTag(t));

export const isMarkedUnread = (c) => (c?.tags || []).includes(UNREAD_TAG);
export const isUnread = (c) => Number(c?.unread_count) > 0 || isMarkedUnread(c);
export const isUnresponded = (c) => c?.last_message?.direction === 'inbound';
export function dncOf(c) {
  const tags = c?.tags || [];
  if (!tags.includes(DNC_TAG)) return null;
  const note = tags.find((t) => String(t).startsWith(DNC_NOTE));
  return { note: note ? note.slice(DNC_NOTE.length).replace(/-/g, ' ').trim() : '' };
}
// The tag edits for "Do not contact" on / off (Relay tags are at most 40 characters).
export function dncTagPatch(c, on, note = '') {
  const old = (c?.tags || []).filter((t) => String(t).startsWith(DNC_NOTE));
  if (!on) return { remove_tags: [DNC_TAG, ...old] };
  const clean = String(note || '').replace(/[\s,]+/g, ' ').trim().toLowerCase().slice(0, 40 - DNC_NOTE.length - 1);
  return { add_tags: [DNC_TAG, ...(clean ? [`${DNC_NOTE} ${clean}`] : [])], ...(old.length ? { remove_tags: old } : {}) };
}

// Calling codes: 1 and 7 are one digit; these are two; everything else here is three.
const TWO = new Set([20, 27, 30, 31, 32, 33, 34, 36, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 81, 82, 84, 86, 90, 91, 92, 93, 94, 95, 98]);
export function splitPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 6) return { cc: '', national: d };
  const n = d[0] === '1' || d[0] === '7' ? 1 : TWO.has(Number(d.slice(0, 2))) ? 2 : 3;
  return { cc: d.slice(0, n), national: d.slice(n) };
}
// "+595981123456" → "+595 981 123 456" · "+59171234567" → "+591 7123 4567" · "+15551234567" → "+1 555 123 4567"
export function formatPhone(p) {
  const { cc, national } = splitPhone(p);
  if (!cc) return national ? `+${national}` : '';
  const g = national.length <= 8 ? [national.slice(0, national.length - 4), national.slice(-4)]
    : national.length === 9 ? [national.slice(0, 3), national.slice(3, 6), national.slice(6)]
      : [national.slice(0, 3), national.slice(3, 6), national.slice(6)];
  return `+${cc} ${g.filter(Boolean).join(' ')}`;
}

// The sites a conversation belongs to: its "site-xx" tags, else the country DBs that know the
// number (dbMatch: Map last-8-digits → [codes]), else ['none'].
export const phoneKey = (p) => String(p || '').replace(/D/g, '').slice(-8);
export function sitesOf(c, dbMatch = null) {
  const tagged = [...new Set((c?.tags || []).filter((t) => String(t).startsWith(SITE_TAG)).map((t) => String(t).slice(SITE_TAG.length)).filter(Boolean))];
  if (tagged.length) return tagged;
  const known = dbMatch?.get(phoneKey(c?.phone));
  return known?.length ? [...known] : ['none'];
}
// A chat we can't place (no site tag, number unknown to every country) shows in EVERY site's
// inbox — better seen twice than missed.
export const noSite = (c) => { const s = c?.sites || [c?.country]; return !s.length || (s.length === 1 && (s[0] === 'none' || !s[0])); };
export const inSite = (c, code) => (c.sites || [c.country]).includes(code) || (code !== 'none' && noSite(c));

// The list the page shows, plus the counts for its filters (within the country scope).
//   status 'open' | 'done' | 'all' · view 'all' | 'unread' | 'unresponded' · country code | 'all'
export function filterConversations(list = [], { status = 'open', view = 'all', country = 'all', q = '' } = {}) {
  const term = String(q || '').trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const scoped = list.filter((c) => (country === 'all' || inSite(c, country))
    && (!term || String(c.name || '').toLowerCase().includes(term) || (digits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(digits))));
  const inStatus = (c) => status === 'all' || (c.status || 'open') === status;
  const counts = {
    open: scoped.filter((c) => (c.status || 'open') === 'open').length,
    done: scoped.filter((c) => c.status === 'done').length,
    unread: scoped.filter((c) => inStatus(c) && isUnread(c)).length,
    unresponded: scoped.filter((c) => inStatus(c) && isUnresponded(c)).length,
  };
  const data = scoped.filter((c) => inStatus(c) && (view === 'unread' ? isUnread(c) : view === 'unresponded' ? isUnresponded(c) : true));
  return { data, counts };
}

// Per-site conversation counts (open + unread / unresponded), for the country picker.
export function countryCounts(list = []) {
  const out = {};
  for (const c of list) {
    for (const k of c.sites || [c.country || 'none']) {
      out[k] ||= { total: 0, unread: 0, unresponded: 0 };
      out[k].total++;
      if ((c.status || 'open') === 'open' && isUnread(c)) out[k].unread++;
      if ((c.status || 'open') === 'open' && isUnresponded(c)) out[k].unresponded++;
    }
  }
  return out;
}

// The message thread → plain text for the AI reply (oldest first, last `max`).
export function threadForAi(msgs = [], max = 30) {
  return msgs.slice(-max).map((m) => {
    const who = m.direction === 'inbound' ? 'CONTACT' : 'CASA LIBRE';
    const tpl = typeof m.template === 'string' ? m.template : m.template?.name;
    const body = m.text || (m.media ? `(${m.media.type || m.type})` : `(${m.type || 'message'})`);
    return `[${String(m.timestamps?.created || m.created_at || '').slice(0, 16)}] ${who}${tpl ? ` (automatic template ${tpl})` : ''}: ${body}`;
  }).join('\n');
}
