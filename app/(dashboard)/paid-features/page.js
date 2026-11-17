'use client';
// Paid features — one page, two tabs: Paid listings and Paid profile personalization.
// Each tab is the existing settings page (app/(dashboard)/paid-listings, …/profile-pro), so
// their settings, numbers and switches work exactly as before. ?tab=profile opens the second tab.
// Access follows the "Paid listings" page permission (lib/adminPages.js PAGE_ALIASES).
import { useEffect, useState } from 'react';
import { T } from '@/components/automations/ui';
import PaidListingsPage from '../paid-listings/page';
import ProfileProPage from '../profile-pro/page';

const TABS = [
  { key: 'listings', label: 'Paid listings' },
  { key: 'profile', label: 'Paid profile personalization' },
];

export default function PaidFeaturesPage() {
  const [tab, setTab] = useState('listings');
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('tab') === 'profile') setTab('profile'); } catch {}
  }, []);
  const pick = (k) => {
    setTab(k);
    try {
      const u = new URL(window.location.href);
      if (k === 'profile') u.searchParams.set('tab', 'profile'); else u.searchParams.delete('tab');
      window.history.replaceState(null, '', u.toString());
    } catch {}
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-head mb-1" style={{ color: T.textPrimary }}>Paid features</h1>
      <p className="text-[13px] mb-4" style={{ color: T.textSecondary }}>What sellers can pay for, per country: extra listings and the profile personalization.</p>
      <div role="tablist" aria-label="Paid features" className="flex gap-1 mb-6 border-b" style={{ borderColor: T.borderLight }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => pick(t.key)}
              className="px-4 py-2.5 text-[14px] font-semibold -mb-px border-b-2"
              style={{ color: on ? T.textPrimary : T.textSecondary, borderColor: on ? T.textPrimary : 'transparent' }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'listings' ? <PaidListingsPage /> : <ProfileProPage />}
    </div>
  );
}
