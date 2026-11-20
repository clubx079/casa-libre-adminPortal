'use client';
// Admin → Funnels → AI SEO: the AI SEO pipeline of one of the six Casa-Libre SEO sites (lib/funnelSites.js).
// Same views as Admin Manager → AI SEO (components/manager/SeoTab.js), scoped with its `site` prop; the APIs read
// ?site=<key> (seo_* rows with country = 'site:<key>'). The picked site is remembered in localStorage.
import { useState } from 'react';
import { T } from '@/components/automations/ui';
import SeoTab from '@/components/manager/SeoTab';
import { FUNNEL_SITE_LIST, FUNNEL_SITE_KEYS } from '@/lib/funnelSites';

const STORE_KEY = 'funnels.seoSite';

// The page mounts this tab only after a click (never on the server), so reading storage up front is safe and
// avoids loading the default site first.
function savedSite() {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORE_KEY) : null;
    if (saved && FUNNEL_SITE_KEYS.includes(saved)) return saved;
  } catch { /* storage blocked: use the default */ }
  return FUNNEL_SITE_LIST[0].key;
}

export default function SeoSitesTab() {
  const [siteKey, setSiteKey] = useState(savedSite);
  const pick = (k) => {
    setSiteKey(k);
    try { window.localStorage.setItem(STORE_KEY, k); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Site">
        {FUNNEL_SITE_LIST.map((s) => {
          const on = s.key === siteKey;
          return (
            <button key={s.key} type="button" role="radio" aria-checked={on} onClick={() => pick(s.key)}
              className="text-left px-3 py-1.5 rounded-[12px] border transition-colors"
              style={on ? { background: T.textPrimary, borderColor: T.textPrimary, color: '#fff' } : { background: '#fff', borderColor: T.borderLight, color: T.textBody }}>
              <span className="block text-[12.5px] font-semibold leading-tight">{s.label}</span>
              <span className="block text-[11px] leading-tight" style={{ color: on ? 'rgba(255,255,255,0.75)' : T.textMuted }}>{s.domain}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[12px]" style={{ color: T.textSecondary }}>
        Each site runs the same AI SEO pipeline every day: Search Console, Google Trends and Google Ads searches → new guides, better titles and internal links, with a report per run.
      </p>
      <SeoTab key={siteKey} site={siteKey} />
    </div>
  );
}
