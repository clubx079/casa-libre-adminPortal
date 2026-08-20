'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import LangSwitcher from '@/components/LangSwitcher';

const NAV = [
  ['/', 'Overview', 'dash'],
  ['/users', 'Users', 'users'],
  ['/analytics', 'Analytics', 'chart'],
  ['/scrape', 'Scrapers', 'scrape'],
  ['/scraper-status', 'Scraper Status', 'scrape'],
  ['/quarantine', 'Quarantine', 'shield'],
  ['/reports', 'Reports', 'runs'],
  ['/properties', 'Properties', 'home'],
  ['/runs', 'Runs', 'runs'],
];

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

export default function AdminShell({ admin, lang = 'es', children }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const initials = (admin?.name || admin?.email || '?').trim().charAt(0).toUpperCase();

  const isActive = (href) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

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
            casa-libre<em className="font-serif not-italic italic font-normal">.py</em>
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
          {NAV.map(([href, label, ic]) => {
            const on = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-input text-[14px] font-medium transition-colors ${
                  on ? 'bg-ink text-paper' : 'text-ink/70 hover:bg-ink/5'
                }`}
              >
                <span className={on ? 'text-paper' : 'text-ink/55'}>
                  <Icon name={ic} />
                </span>
                {label}
              </Link>
            );
          })}
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
            casa-libre<em className="font-serif not-italic italic font-normal">.py</em>
          </span>
          <div className="hidden lg:block flex-1" />
          <LangSwitcher lang={lang} />
          <span className="hidden sm:inline text-[11px] font-mono tracking-label uppercase text-ink/40">Admin Portal</span>
        </div>
        <main className="max-w-[1100px] mx-auto px-5 md:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
