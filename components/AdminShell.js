'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import LangSwitcher from '@/components/LangSwitcher';
import CountrySwitcher from '@/components/CountrySwitcher';
import { useUnreadCounts } from '@/components/unread';
import { pageKeyForPath } from '@/lib/adminPages';

// Sidebar sections. Each one folds open/closed; the one holding the current page opens by itself.
const GROUPS = [
  { key: 'inbox', label: 'Inbox & support', icon: 'chat', items: [
    ['/inbox', 'Inbox', 'chat'],
    ['/alerts', 'Alerts', 'bell'],
    ['/reports', 'Reports', 'runs'],
    ['/feedbacks', 'Feedback', 'shield'],
  ] },
  { key: 'listings', label: 'Listings & people', icon: 'home', items: [
    ['/users', 'Users', 'users'],
    ['/properties', 'Properties', 'home'],
    ['/quarantine', 'Quarantine', 'shield'],
    ['/partners', 'Partners', 'users'],
    ['/leads', 'Leads', 'users'],
  ] },
  { key: 'marketing', label: 'Marketing & outreach', icon: 'mail', items: [
    ['/marketing', 'Marketing', 'chart'],
    ['/email-campaigns', 'Email & WhatsApp campaigns', 'mail'],
    ['/campaigns', 'WhatsApp Marketing', 'chat'],
    ['/automations', 'Automations', 'bolt'],
    ['/email-templates', 'Templates', 'mail'],
    ['/referrals', 'Referrals', 'gift'],
    ['/utm-links', 'UTM Links', 'link'],
    ['/funnels', 'Funnels', 'chart'],
  ] },
  { key: 'insights', label: 'Analytics & AI', icon: 'chart', items: [
    ['/analytics', 'Analytics', 'chart'],
    ['/search-console', 'Search Console', 'chart'],
    ['/manager', 'Admin Manager', 'bolt'],
    ['/bots', 'Bots', 'bolt'],
    ['/ai-usage', 'AI usage', 'chart'],
  ] },
  { key: 'money', label: 'Money', icon: 'card', items: [
    ['/earnings', 'Earnings', 'card'],
    ['/paid-features', 'Paid features', 'card'],
  ] },
  { key: 'app', label: 'Mobile app', icon: 'phone', items: [
    ['/app-installs', 'App installs', 'phone'],
    ['/app-updates', 'App updates', 'phone'],
  ] },
  { key: 'data', label: 'Scrapers & jobs', icon: 'scrape', items: [
    ['/scrape', 'Scrapers', 'scrape'],
    ['/scraper-status', 'Scraper Status', 'scrape'],
    ['/runs', 'Runs', 'runs'],
  ] },
];
const OPEN_KEY = 'cl_admin_nav_open_v1';

function Icon({ name }) {
  const p = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  if (name === 'dash')
    return (
      <svg {...p}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  if (name === 'link')
    return (
      <svg {...p}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  if (name === 'users')
    return (
      <svg {...p}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  if (name === 'scrape')
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18" />
      </svg>
    );
  if (name === 'home')
    return (
      <svg {...p}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    );
  if (name === 'runs')
    return (
      <svg {...p}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 3v4h4" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  if (name === 'shield')
    return (
      <svg {...p}>
        <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    );
  if (name === 'chat')
    return (
      <svg {...p}>
        <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" />
      </svg>
    );
  if (name === 'bell')
    return (
      <svg {...p}>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    );
  if (name === 'mail')
    return (
      <svg {...p}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  if (name === 'bolt')
    return (
      <svg {...p}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
      </svg>
    );
  if (name === 'phone')
    return (
      <svg {...p}>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
    );
  if (name === 'gift')
    return (
      <svg {...p}>
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M5 12v8h14v-8" />
        <path d="M12 8v12" />
        <path d="M12 8c-1.5-3-5-3.5-5-1.2C7 8 9.5 8 12 8z" />
        <path d="M12 8c1.5-3 5-3.5 5-1.2C17 8 14.5 8 12 8z" />
      </svg>
    );
  if (name === 'card')
    return (
      <svg {...p}>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 10h19" /><path d="M6.5 15h4" />
      </svg>
    );
  if (name === 'user')
    return (
      <svg {...p}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
      </svg>
    );
  // chart
  return (
    <svg {...p}>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" rx="0.5" />
      <rect x="12" y="8" width="3" height="10" rx="0.5" />
      <rect x="17" y="5" width="3" height="13" rx="0.5" />
    </svg>
  );
}

// pages: the page keys this member's role includes (Team → Page access), or null for every page.
export default function AdminShell({ admin, pages = null, lang = 'es', countries = [], activeCountry, children }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Which Properties sub-tab is active (Scraped default). Drives the sub-nav highlight.
  const kindParam = searchParams.get('kind') || 'scraped';
  const initials = (admin?.name || admin?.email || '?').trim().charAt(0).toUpperCase();
  const activeObj = countries.find((c) => c.code === activeCountry) || (activeCountry ? { code: activeCountry, label: activeCountry.toUpperCase(), is_live: false } : null);
  const isSuper = admin?.role === 'superadmin';

  // Super admins get a full "Team" screen; everyone else gets "Account" (same
  // route, but the page only renders member management to superadmins).
  // A ready-made role or custom page list shows only its pages (the middleware also blocks the rest).
  const allowed = (href) => !pages || pages.includes(pageKeyForPath(href));
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(([href]) => allowed(href)) })).filter((g) => g.items.length);
  const team = isSuper ? ['/team', 'Team', 'users'] : ['/team', 'Account', 'user'];

  // Per-admin unread badges (each team member has their own — lib/unread.js).
  const unread = useUnreadCounts(path);
  // '/alerts' = OPEN alerts (lib/alerts.js): clears only when a team member answers or marks it handled.
  const BADGE = { '/reports': unread.reports, '/feedbacks': unread.feedbacks, '/inbox': unread.inbox, '/alerts': unread.alerts };

  const isActive = (href) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
  const activeGroup = groups.find((g) => g.items.some(([href]) => isActive(href)))?.key || null;

  // Which sections the admin opened (remembered in this browser). The current page's section is always open.
  const [opened, setOpened] = useState({});
  useEffect(() => {
    try { const v = JSON.parse(window.localStorage.getItem(OPEN_KEY) || '{}'); if (v && typeof v === 'object') setOpened(v); } catch { /* private window */ }
  }, []);
  const isOpen = (key) => (key in opened ? !!opened[key] : key === activeGroup);
  const toggle = (key) => setOpened((o) => {
    const n = { ...o, [key]: !isOpen(key) };
    try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  // Opening a page from a closed section (e.g. a link) opens that section.
  useEffect(() => {
    if (activeGroup && opened[activeGroup] === false) setOpened((o) => ({ ...o, [activeGroup]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  const badge = (n, on) => (n > 0 ? (
    <span className={`ml-auto min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums flex items-center justify-center ${on ? 'bg-paper text-ink' : 'bg-[#B23A3A] text-white'}`}>
      {n > 99 ? '99+' : n}
    </span>
  ) : null);

  const item = ([href, label, ic], nested) => {
    const on = isActive(href);
    // Properties splits into two sub-tabs: Scraped (competitor scrapers) and Originals (buyer-portal submissions).
    if (href === '/properties') {
      const subs = [['/properties?kind=scraped', 'Scraped', 'scraped'], ['/properties?kind=originals', 'Originals', 'originals']];
      return (
        <div key={href} className="flex flex-col gap-0.5">
          <div className={`flex items-center gap-3 ${nested ? 'px-3 py-2 text-[13.5px]' : 'px-3.5 py-2.5 text-[14px]'} rounded-input font-medium ${on ? 'text-ink' : 'text-ink/70'}`}>
            <span className="text-ink/55"><Icon name={ic} /></span>
            {label}
          </div>
          <div className="ml-[24px] flex flex-col gap-0.5 border-l border-ink/12 pl-2.5">
            {subs.map(([shref, slabel, skind]) => (
              <Link key={shref} href={shref} onClick={() => setOpen(false)}
                className={`px-3 py-1.5 rounded-input text-[13px] font-medium transition-colors ${on && kindParam === skind ? 'bg-ink text-paper' : 'text-ink/60 hover:bg-ink/5'}`}>
                {slabel}
              </Link>
            ))}
          </div>
        </div>
      );
    }
    return (
      <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={on ? 'page' : undefined}
        className={`flex items-center gap-3 ${nested ? 'px-3 py-2 text-[13.5px]' : 'px-3.5 py-2.5 text-[14px]'} rounded-input font-medium transition-colors ${on ? 'bg-ink text-paper' : 'text-ink/70 hover:bg-ink/5'}`}>
        <span className={on ? 'text-paper' : 'text-ink/55'}><Icon name={ic} /></span>
        {label}
        {badge(BADGE[href], on)}
      </Link>
    );
  };

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-paper lg:flex">
      {open && (
        <div
          className="fixed inset-0 bg-ink/30 backdrop-blur-sm z-[90] lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-[100] w-[248px] h-screen bg-card border-r border-ink/12 flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 h-[68px] border-b border-ink/10 shrink-0">
          <Link href="/" className="text-[20px] font-bold tracking-head">
            Casa Libre <em className="font-serif italic font-normal">Admin</em>
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="lg:hidden w-8 h-8 rounded-pill flex items-center justify-center text-ink/60 hover:bg-ink/5"
          >
            ×
          </button>
        </div>

        <div className="px-5 pt-4 pb-1">
          <span className="text-[10px] font-mono tracking-label uppercase text-ink/35">Admin</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 pt-1 flex flex-col gap-1 cl-scroll">
          {allowed('/') ? item(['/', 'Overview', 'dash'], false) : null}
          {groups.map((g) => {
            const expanded = isOpen(g.key);
            const hasActive = g.key === activeGroup;
            const waiting = g.items.reduce((s, [href]) => s + (BADGE[href] || 0), 0);
            return (
              <div key={g.key} className="flex flex-col">
                <button type="button" onClick={() => toggle(g.key)} aria-expanded={expanded} aria-controls={`nav-${g.key}`}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-input text-[14px] font-semibold text-left transition-colors hover:bg-ink/5 ${hasActive ? 'text-ink' : 'text-ink/75'}`}>
                  <span className="text-ink/55"><Icon name={g.icon} /></span>
                  <span className="flex-1 min-w-0 truncate">{g.label}</span>
                  {!expanded && waiting > 0 ? badge(waiting, false) : null}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={`shrink-0 text-ink/40 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} aria-hidden>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
                {expanded ? (
                  <div id={`nav-${g.key}`} className="ml-[24px] mt-0.5 mb-1.5 pl-2 border-l border-ink/12 flex flex-col gap-0.5">
                    {g.items.map((it) => item(it, true))}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="mt-1 pt-2 border-t border-ink/10">{item(team, false)}</div>
        </nav>

        <div className="p-3 border-t border-ink/10 shrink-0">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <span className="w-9 h-9 shrink-0 rounded-pill bg-ink text-paper flex items-center justify-center text-[14px] font-bold">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{admin?.name || 'Admin'}</div>
              <div className="text-[11px] text-ink/50 font-mono truncate">{admin?.email}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full mt-1 px-3.5 py-2.5 rounded-input text-[14px] font-medium text-ink/60 hover:bg-ink/5 text-left"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* CONTENT */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 px-5 md:px-8 h-[68px] border-b border-ink/12">
          <button
            onClick={() => setOpen(true)}
            aria-label="Menu"
            className="lg:hidden w-9 h-9 rounded-pill border border-ink/20 flex items-center justify-center"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="lg:hidden text-[18px] font-bold tracking-head">
            Casa Libre <em className="font-serif italic font-normal">Admin</em>
          </span>
          <div className="hidden lg:block flex-1" />
          {countries.length > 0 && <CountrySwitcher countries={countries} active={activeCountry} />}
          <LangSwitcher lang={lang} />
          <span className="hidden sm:inline text-[11px] font-mono tracking-label uppercase text-ink/40">Admin Portal</span>
        </div>

        {/* Active-country banner — makes it impossible to act on the wrong country's data. */}
        {activeObj && (
          <div
            className="flex flex-wrap items-center gap-2 px-5 md:px-8 py-2 border-b text-[12px]"
            style={{
              background: '#EEF3FB',
              borderColor: '#CFDCF0',
              color: '#111',
            }}
          >
            <span className="font-mono text-[10px] uppercase tracking-label px-1.5 py-0.5 rounded bg-ink text-paper">{activeObj.code}</span>
            <span className="font-semibold">Viewing {activeObj.label}</span>
            <span className="text-ink/50">— every screen &amp; action applies to this country&apos;s database.</span>
          </div>
        )}

        <main className="w-full px-5 md:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
