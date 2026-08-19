'use client';

import React, { useState, useEffect } from 'react';
import {
  Eye, TrendingUp, Users, BarChart3,
  ChevronLeft, ChevronRight, MapPin,
  Activity, ExternalLink, Radio, Filter, Heart, Phone, Check, Search, Home,
} from 'lucide-react';

// Casa Libre palette (neo-brutalist: ink accent on warm paper).
const T = {
  primary: '#111111',
  primarySurface: '#F1ECE2',
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  warning: '#8A5A12',
  warningSurface: '#F5EAD5',
};

const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const selectStyle = {
  border: `1px solid ${T.borderLight}`,
  borderRadius: '999px',
  color: T.textBody,
  background: T.bgWhite,
  fontSize: '12px',
  padding: '6px 12px',
  outline: 'none',
};

const FUNNEL_ICONS = [Eye, Search, MapPin, Heart, Phone, Home];

const EVENT_LABELS = {
  '$pageview': 'Viewed a page',
  '$pageleave': 'Left a page',
  '$autocapture': 'Clicked something',
  '$identify': 'Identified',
  '$set': 'Profile updated',
  user_logged_in: 'Logged in',
  user_signed_up: 'Signed up',
  oauth_login_clicked: 'Clicked Google login',
  search_applied: 'Searched',
  filter_applied: 'Applied a filter',
  sort_changed: 'Changed sort order',
  map_pin_clicked: 'Clicked a map pin',
  property_viewed: 'Viewed a property',
  photo_gallery_opened: 'Opened photos',
  property_share_opened: 'Opened share',
  contact_seller_clicked: 'Contacted a seller',
  whatsapp_contact_clicked: 'Opened WhatsApp',
  contact_whatsapp_click: 'Tapped WhatsApp',
  contact_call_click: 'Tapped call',
  contact_copy_click: 'Copied number',
  report_unresponsive: 'Reported unresponsive listing',
  phone_revealed: 'Revealed phone',
  property_saved: 'Saved a property',
  property_unsaved: 'Unsaved a property',
  saved_viewed: 'Viewed saved',
  publish_started: 'Started a listing',
  listing_created: 'Listed a property',
  language_switched: 'Switched language',
};
// Events that represent real user intent (vs PostHog's automatic system events).
const PRODUCT_EVENTS = new Set([
  'property_viewed', 'property_saved', 'property_unsaved', 'search_applied', 'filter_applied',
  'contact_seller_clicked', 'whatsapp_contact_clicked', 'phone_revealed', 'listing_created',
  'contact_whatsapp_click', 'contact_call_click', 'contact_copy_click', 'report_unresponsive',
  'publish_started', 'user_logged_in', 'user_signed_up', 'sort_changed', 'map_pin_clicked',
  'photo_gallery_opened', 'property_share_opened', 'saved_viewed', 'oauth_login_clicked',
]);
// The user journey, in order — used to show where an individual user dropped off.
const STAGES = [
  { key: '$pageview', label: 'Viewed a page' },
  { key: 'search_applied', label: 'Searched' },
  { key: 'property_viewed', label: 'Viewed a property' },
  { key: 'property_saved', label: 'Saved a property' },
  { key: 'contact_seller_clicked', label: 'Contacted a seller' },
  { key: 'listing_created', label: 'Listed a property' },
];
const prettyEvent = (name) =>
  EVENT_LABELS[name] || String(name || '').replace(/^\$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const shortUrl = (url) => {
  if (!url) return '';
  try { const u = new URL(url); return (u.pathname || '/') + (u.search || ''); }
  catch { return String(url).replace(/^https?:\/\/[^/]+/, '') || String(url); }
};
const ROUTE_NAMES = {
  '/': 'Home',
  '/propiedades': 'Listings',
  '/comprar': 'Buy',
  '/alquilar': 'Rent',
  '/publicar': 'List a property',
  '/cuenta': 'Dashboard',
  '/cuenta/guardadas': 'Saved',
  '/cuenta/publicaciones': 'My listings',
  '/cuenta/ajustes': 'Settings',
  '/contacto': 'Contact',
};
const friendlyPath = (url) => {
  const p = shortUrl(url).split('?')[0];
  if (ROUTE_NAMES[p]) return ROUTE_NAMES[p];
  const seg = p.split('/').filter(Boolean);
  if (seg[0] === 'cuenta' && seg[1]) return seg[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (seg[0] === 'propiedad' && seg[1]) return 'Property';
  return p || '/';
};
const fmtWhen = (iso) => {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return '—'; }
};
const fmtDateOnly = (v) => {
  try { return new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};
const fmtTime = (v) => {
  try { return new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
};
const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

// PostHog's query engine can return transient 503/504 under load. Retry with
// capped backoff and keep the UI in a friendly loading state until data arrives.
const isTransientAnalyticsError = (status, body) =>
  [429, 502, 503, 504].includes(status) ||
  /too busy|max execution|server_error|timeout|try again later|posthog\s*5\d\d/i.test(String(body || ''));

async function loadAnalytics(url, { onBusy, isCancelled } = {}) {
  let attempt = 0;
  while (!(isCancelled && isCancelled())) {
    attempt++;
    try {
      const res = await fetch(url);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.ok && json && !json.error) return json;
      const detail = (json && json.error) || text || `HTTP ${res.status}`;
      if (!isTransientAnalyticsError(res.status, detail)) {
        const err = new Error(detail); err.fatal = true; throw err;
      }
    } catch (e) {
      if (e && e.fatal) throw e;
    }
    if (onBusy) onBusy(attempt);
    const delay = Math.min(1500 * Math.pow(1.4, attempt - 1), 10000);
    await new Promise((r) => setTimeout(r, delay));
  }
  const err = new Error('cancelled'); err.cancelled = true; throw err;
}

const BUSY_MESSAGE = 'High traffic right now — this can take a moment. Still loading your analytics…';

// Drill-down: a single user's PostHog event timeline.
const UserActivityDetail = ({ user, onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dayFilter, setDayFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('any');
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setBusy(false);
    (async () => {
      try {
        const json = await loadAnalytics(
          `/api/analytics/posthog?type=activity&personId=${encodeURIComponent(user.person_id)}`,
          { onBusy: () => { if (!cancelled) setBusy(true); }, isCancelled: () => cancelled },
        );
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled && !e.cancelled) setError('unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user.person_id]);

  const label = user.name || user.email || 'Anonymous user';

  const acts = data?.activity || [];
  const reached = STAGES.map((s) => acts.some((a) => a.event === s.key));
  const lastReachedIdx = reached.lastIndexOf(true);
  const completedAll = reached[STAGES.length - 1];
  const dropIdx = completedAll ? -1 : lastReachedIdx >= 0 ? Math.min(lastReachedIdx + 1, STAGES.length - 1) : 0;
  const journeySummary = completedAll
    ? 'Completed the full journey — listed a property.'
    : lastReachedIdx < 0
      ? 'No tracked activity yet.'
      : `Got as far as "${STAGES[lastReachedIdx].label}", then dropped off before "${STAGES[dropIdx].label}".`;

  const bySession = {};
  for (const a of acts) {
    const sid = a.session_id || `t-${a.timestamp}`;
    (bySession[sid] ||= []).push(a);
  }
  const sessions = Object.entries(bySession).map(([sid, events]) => {
    const times = events.map((e) => new Date(e.timestamp).getTime());
    const start = Math.min(...times);
    const end = Math.max(...times);
    const sReached = STAGES.map((s) => events.some((e) => e.event === s.key));
    const sLast = sReached.lastIndexOf(true);
    const sCompleted = sReached[STAGES.length - 1];
    const sDrop = sCompleted ? -1 : sLast >= 0 ? Math.min(sLast + 1, STAGES.length - 1) : 0;
    return { sid, events, start, end, count: events.length, completed: sCompleted, dropIdx: sDrop };
  }).sort((a, b) => b.start - a.start);

  const now = Date.now();
  const inDay = (start) => {
    if (dayFilter === 'today') return new Date(start).toDateString() === new Date(now).toDateString();
    if (dayFilter === '7d') return start >= now - 7 * 86400000;
    if (dayFilter === '30d') return start >= now - 30 * 86400000;
    return true;
  };
  const inTime = (start) => {
    const h = new Date(start).getHours();
    if (timeFilter === 'morning') return h >= 5 && h < 12;
    if (timeFilter === 'afternoon') return h >= 12 && h < 17;
    if (timeFilter === 'evening') return h >= 17 && h < 21;
    if (timeFilter === 'night') return h >= 21 || h < 5;
    return true;
  };
  const filteredSessions = sessions.filter((s) => inDay(s.start) && inTime(s.start));
  const safeIdx = Math.min(idx, Math.max(0, filteredSessions.length - 1));
  const current = filteredSessions[safeIdx];

  useEffect(() => { setIdx(0); }, [dayFilter, timeFilter]);
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIdx((i) => Math.min(filteredSessions.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredSessions.length]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: T.textSecondary }}>
        <ChevronLeft className="w-4 h-4" /> Back to users
      </button>

      <div className="bg-white p-5" style={CARD}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center" style={{ background: T.primary, borderRadius: '999px' }}>
            <Users className="w-5 h-5" style={{ color: T.bgWhite }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: T.textPrimary }}>{label}</p>
            <p className="text-xs truncate font-mono" style={{ color: T.textMuted }}>{user.email || user.person_id}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[['Events', user.events], ['Views', user.views], ['Saves', user.saves], ['Contacts', user.contacts]].map(([l, v]) => (
            <div key={l}>
              <p className="text-lg font-bold" style={{ color: T.textPrimary }}>{v ?? 0}</p>
              <p className="text-[10px]" style={{ color: T.textMuted }}>{l}</p>
            </div>
          ))}
        </div>
      </div>

      {!loading && !error && data && (
        <div className="bg-white p-5" style={CARD}>
          <div className="flex items-center gap-2 mb-1">
            <Filter className="w-4 h-4" style={{ color: T.primary }} />
            <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Journey</h2>
          </div>
          <p className="text-xs mb-4" style={{ color: completedAll ? T.success : T.textSecondary }}>{journeySummary}</p>
          <div className="space-y-2">
            {STAGES.map((s, i) => {
              const done = reached[i];
              const isDrop = i === dropIdx;
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: done ? T.primary : T.bgWhite, border: done ? 'none' : `1px solid ${T.borderLight}` }}>
                    {done ? <Check className="w-3 h-3" style={{ color: '#fff' }} /> : <span className="text-[10px]" style={{ color: T.textMuted }}>{i + 1}</span>}
                  </span>
                  <span className="text-xs" style={{ color: done ? T.textPrimary : T.textMuted, fontWeight: done ? 600 : 400 }}>{s.label}</span>
                  {isDrop && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: T.primarySurface, color: T.primary }}>dropped off here</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Sessions</h2>
        <span className="text-[10px]" style={{ color: T.textMuted }}>{data?.profile?.sessions ?? sessions.length} total · last 90 days</span>
        <div className="flex items-center gap-2 ml-auto">
          <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} style={selectStyle}>
            <option value="all">All days</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} style={selectStyle}>
            <option value="any">Any time</option>
            <option value="morning">Morning · 5a–12p</option>
            <option value="afternoon">Afternoon · 12p–5p</option>
            <option value="evening">Evening · 5p–9p</option>
            <option value="night">Night · 9p–5a</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 p-5 bg-white" style={CARD}>
          <span className="inline-block w-4 h-4 border-2 rounded-full animate-spin flex-shrink-0" style={{ borderColor: T.borderLight, borderTopColor: T.primary }} />
          <p className="text-xs" style={{ color: T.textMuted }}>{busy ? BUSY_MESSAGE : 'Loading sessions…'}</p>
        </div>
      ) : error ? (
        <p className="text-xs p-5 bg-white" style={{ color: T.textMuted, ...CARD }}>Couldn&apos;t load this user&apos;s activity right now — analytics is under heavy load. Please try again in a moment.</p>
      ) : filteredSessions.length === 0 ? (
        <p className="text-xs p-5 bg-white" style={{ color: T.textMuted, ...CARD }}>No sessions match these filters.</p>
      ) : (
        <div className="bg-white" style={CARD}>
          <div className="px-5 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: T.borderLight }}>
            <div className="min-w-0">
              <p className="text-xs font-bold" style={{ color: T.textPrimary }}>{fmtDateOnly(current.start)}</p>
              <p className="text-[10px]" style={{ color: T.textMuted }}>{fmtTime(current.start)}–{fmtTime(current.end)} · {fmtDur(current.end - current.start)} · {current.count} event{current.count === 1 ? '' : 's'}</p>
            </div>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={current.completed ? { background: T.successSurface, color: T.success } : { background: T.primarySurface, color: T.primary }}>
              {current.completed ? 'Listed a property' : `Dropped at: ${STAGES[current.dropIdx].label}`}
            </span>
          </div>
          <div className="cl-scroll" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {current.events.map((a, i) => {
              const isProduct = PRODUCT_EVENTS.has(a.event);
              return (
                <div key={i} className="flex items-center gap-3 px-5 py-2" style={{ borderTop: i ? `1px solid ${T.borderLight}` : 'none' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isProduct ? T.primary : T.borderLight }} />
                  <span className="text-xs flex-shrink-0" style={{ color: isProduct ? T.textPrimary : T.textSecondary, fontWeight: isProduct ? 600 : 400, minWidth: '140px' }}>{prettyEvent(a.event)}</span>
                  <span className="text-[11px] truncate flex-1" style={{ color: T.textMuted }}>{a.property_name || friendlyPath(a.url)}</span>
                  <span className="text-[11px] flex-shrink-0" style={{ color: T.textMuted }}>{fmtTime(a.timestamp)}</span>
                </div>
              );
            })}
          </div>
          <div className="px-4 py-2.5 border-t flex items-center justify-between gap-2" style={{ borderColor: T.borderLight, background: T.bgSurface }}>
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={safeIdx === 0}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium border disabled:opacity-30" style={{ borderColor: T.borderLight, color: T.textBody, borderRadius: '999px', background: T.bgWhite }}>
              <ChevronLeft className="w-3.5 h-3.5" /> Newer
            </button>
            <span className="text-[11px]" style={{ color: T.textSecondary }}>Session {safeIdx + 1} of {filteredSessions.length} · <span style={{ color: T.textMuted }}>← → to move</span></span>
            <button onClick={() => setIdx((i) => Math.min(filteredSessions.length - 1, i + 1))} disabled={safeIdx >= filteredSessions.length - 1}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium border disabled:opacity-30" style={{ borderColor: T.borderLight, color: T.textBody, borderRadius: '999px', background: T.bgWhite }}>
              Older <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Users Analytics — user behaviour + funnel, read from PostHog.
const UsersAnalytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [resolveNote, setResolveNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setBusy(false);
    (async () => {
      try {
        const json = await loadAnalytics('/api/analytics/posthog', {
          onBusy: () => { if (!cancelled) setBusy(true); },
          isCancelled: () => cancelled,
        });
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled && !e.cancelled) setError('unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);
    (async () => {
      try {
        const json = await loadAnalytics('/api/analytics/posthog?type=users', { isCancelled: () => cancelled });
        if (!cancelled && Array.isArray(json.users)) setUsers(json.users);
      } catch { /* leave empty */ } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Deep-link from the users page: ?user=<id>&email=<email> → open that
  // user's drilldown directly.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get('user');
    const email = params.get('email');
    if (!uid && !email) return;
    (async () => {
      try {
        const qs = uid ? `distinctId=${encodeURIComponent(uid)}` : `email=${encodeURIComponent(email)}`;
        const res = await fetch(`/api/analytics/posthog?type=resolve&${qs}`);
        const json = await res.json();
        if (json.found && json.user) setSelected(json.user);
        else setResolveNote('This user has no tracked PostHog activity yet.');
      } catch { /* ignore */ }
    })();
  }, []);

  const shell = (children) => (
    <div className="bg-white p-12 text-center" style={CARD}>{children}</div>
  );

  if (selected) return <UserActivityDetail user={selected} onBack={() => setSelected(null)} />;

  if (loading) {
    return shell(<>
      <div className="inline-block w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: T.borderLight, borderTopColor: T.primary }} />
      <p className="text-sm mt-3" style={{ color: T.textSecondary }}>{busy ? BUSY_MESSAGE : 'Loading user analytics…'}</p>
    </>);
  }
  if (error) {
    return shell(<>
      <BarChart3 className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
      <p className="text-sm font-medium" style={{ color: T.textSecondary }}>Analytics is temporarily unavailable</p>
      <p className="text-xs mt-1" style={{ color: T.textMuted }}>We&apos;re experiencing heavy traffic right now. Please try again in a moment.</p>
    </>);
  }
  if (data && data.configured === false) {
    return shell(<>
      <Activity className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
      <p className="text-sm font-medium" style={{ color: T.textSecondary }}>PostHog not connected</p>
      <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: T.textMuted }}>{data.message || 'Set the PostHog server env to enable user analytics.'}</p>
    </>);
  }

  const totals = data?.totals || { pageviews: 0, uniqueUsers: 0 };
  const today = data?.today || { pageviews: 0, uniqueUsers: 0 };
  const funnel = data?.funnel || [];
  const funnelTop = funnel[0]?.persons || 0;

  const cards = [
    { label: 'Active now', value: (data?.activeNow ?? 0).toLocaleString(), Icon: Radio, sub: 'last 5 min' },
    { label: 'Unique users', value: (totals.uniqueUsers || 0).toLocaleString(), Icon: Users, sub: 'last 30 days' },
    { label: 'Page views', value: (totals.pageviews || 0).toLocaleString(), Icon: Eye, sub: 'last 30 days' },
    { label: 'Page views today', value: (today.pageviews || 0).toLocaleString(), Icon: TrendingUp, sub: 'so far' },
  ];

  return (
    <div className="space-y-4">
      {resolveNote && (
        <div className="text-xs px-4 py-2.5 rounded-full" style={{ background: T.primarySurface, color: T.primary }}>{resolveNote}</div>
      )}
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(({ label, value, Icon, sub }) => (
          <div key={label} className="bg-white p-5" style={CARD}>
            <div className="flex items-start justify-between mb-4">
              <p className="text-xs font-medium" style={{ color: T.textSecondary }}>{label}</p>
              <div className="w-9 h-9 flex items-center justify-center" style={{ background: T.bgSurface, borderRadius: '10px' }}>
                <Icon className="w-4 h-4" style={{ color: T.primary }} />
              </div>
            </div>
            <p className="text-3xl font-bold tracking-head" style={{ color: T.textPrimary }}>{value}</p>
            <p className="text-[10px] mt-1" style={{ color: T.textMuted }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* User funnel */}
      <div className="bg-white p-5" style={CARD}>
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4" style={{ color: T.primary }} />
          <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>User funnel</h2>
          <span className="text-[10px]" style={{ color: T.textMuted }}>· distinct users, last 30 days</span>
        </div>
        <div className="space-y-2">
          {funnel.map((s, i) => {
            const Icon = FUNNEL_ICONS[i] || Activity;
            const pct = funnelTop > 0 ? Math.round((s.persons / funnelTop) * 100) : 0;
            return (
              <div key={s.step} className="flex items-center gap-3">
                <div className="flex items-center gap-2 w-44 flex-shrink-0">
                  <Icon className="w-3.5 h-3.5" style={{ color: T.textSecondary }} />
                  <span className="text-xs" style={{ color: T.textBody }}>{s.step}</span>
                </div>
                <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: T.bgSurface }}>
                  <div className="h-full flex items-center px-2" style={{ width: `${pct}%`, background: T.primary, borderRadius: '999px', minWidth: s.persons > 0 ? '28px' : 0 }}>
                    <span className="text-[10px] font-semibold" style={{ color: '#fff' }}>{s.persons}</span>
                  </div>
                </div>
                <span className="text-xs font-medium w-10 text-right" style={{ color: T.textSecondary }}>{pct}%</span>
              </div>
            );
          })}
        </div>
        {funnelTop === 0 && (
          <p className="text-xs mt-3" style={{ color: T.textMuted }}>No events yet — data appears once users use the site.</p>
        )}
      </div>

      {/* Users — click to drill into activity */}
      <div className="bg-white" style={CARD}>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: T.borderLight }}>
          <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Users</h2>
          <span className="text-[10px]" style={{ color: T.textMuted }}>click a user to see their activity</span>
        </div>
        <div className="overflow-x-auto cl-scroll">
          <table className="w-full min-w-[720px]">
            <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['User', 'Events', 'Views', 'Saves', 'Contacts', 'Last active'].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: T.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usersLoading ? (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-xs" style={{ color: T.textMuted }}>Loading users…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-xs" style={{ color: T.textMuted }}>No user activity yet.</td></tr>
              ) : users.map((u) => (
                <tr key={u.person_id} className="border-b cursor-pointer transition-colors" style={{ borderColor: T.borderLight }}
                  onClick={() => setSelected(u)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSurface)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = T.bgWhite)}>
                  <td className="px-4 py-2.5">
                    <p className="text-xs font-medium" style={{ color: T.textPrimary }}>{u.name || u.email || 'Anonymous user'}</p>
                    {u.email && u.name && <p className="text-[10px] font-mono" style={{ color: T.textMuted }}>{u.email}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-semibold" style={{ color: T.textPrimary }}>{u.events}</td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: T.textBody }}>{u.views}</td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: T.textBody }}>{u.saves}</td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: T.textBody }}>{u.contacts}</td>
                  <td className="px-4 py-2.5 text-right text-[11px]" style={{ color: T.textMuted }}>{fmtWhen(u.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data?.project_url && (
        <div className="flex justify-end">
          <a href={data.project_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-medium" style={{ color: T.textSecondary }}>
            <ExternalLink className="w-3.5 h-3.5" /> Open in PostHog
          </a>
        </div>
      )}
    </div>
  );
};

export default function AnalyticsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Analytics</h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>User behaviour &amp; funnel, from PostHog</p>
      </div>
      <UsersAnalytics />
    </div>
  );
}
