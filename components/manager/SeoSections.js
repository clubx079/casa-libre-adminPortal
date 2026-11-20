'use client';
// Admin Manager → AI SEO: one switch for the three places the AI SEO pipeline runs.
//   1. Casa-Libre (buyer portal)  the active country's portal — exactly the original tab (SeoTab, no site prop)
//   2. Funnel sites               a picker of the six SEO sites (lib/funnelSites.js), then SeoTab site=<key>
//   3. casa-libre.com hub         the umbrella site's cross-country guides, SeoTab site="hub"
// Each section reads only its own scope (buyer: the country DB; sites: PY DB rows country 'site:<key>').
// The chosen section and funnel site are remembered in localStorage (per browser; blocked storage = defaults).
// The manager page mounts this only on the client (after the tab is picked), so storage is read up front.
import { useState } from 'react';
import { T, CARD } from '@/components/automations/ui';
import SeoTab from '@/components/manager/SeoTab';
import { FUNNEL_SITE_LIST, FUNNEL_SITE_KEYS } from '@/lib/funnelSites';
import { HUB_SITE } from '@/lib/seoSites/scope';

const SECTION_KEY = 'manager.seoSection';
const SITE_KEY = 'manager.seoFunnelSite';

const SECTIONS = [
  {
    key: 'buyer', label: 'Casa-Libre (buyer portal)', short: 'Country portal · filter pages + /guias',
    title: 'Casa-Libre buyer portal',
    covers: 'The portal of the country picked in the top bar: its listing filter pages, page titles and /guias guides.',
    sources: 'Google Ads search terms · Search Console · site searches (PostHog) · Google Trends',
  },
  {
    key: 'funnels', label: 'Funnel sites', short: 'The six SEO sites · guides, titles, links',
    title: 'Funnel sites',
    covers: 'The six Casa-Libre SEO sites (owners, agents, guide libraries): each writes its own guides, titles and internal links, and sends readers to Casa-Libre.',
    sources: "The site's own Search Console · Google Ads terms (Paraguay sites) · Google Trends of its countries",
  },
  {
    key: 'hub', label: 'casa-libre.com hub', short: 'Umbrella site · cross-country guides',
    title: 'casa-libre.com hub',
    covers: 'The umbrella site casa-libre.com: guides at /guias for people comparing countries, moving to or investing in Paraguay, Bolivia, Uruguay, Venezuela and El Salvador — each links to the country sites.',
    sources: 'Search Console (casa-libre.com) · Google Ads terms · Google Trends of all five countries',
  },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);

function read(key, ok, fallback) {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    if (v && ok.includes(v)) return v;
  } catch { /* storage blocked: default */ }
  return fallback;
}
function save(key, v) {
  try { window.localStorage.setItem(key, v); } catch { /* ignore */ }
}

export default function SeoSections() {
  const [section, setSection] = useState(() => read(SECTION_KEY, SECTION_KEYS, 'buyer'));
  const [siteKey, setSiteKey] = useState(() => read(SITE_KEY, FUNNEL_SITE_KEYS, FUNNEL_SITE_LIST[0].key));
  const pickSection = (k) => { setSection(k); save(SECTION_KEY, k); };
  const pickSite = (k) => { setSiteKey(k); save(SITE_KEY, k); };
  const cur = SECTIONS.find((s) => s.key === section) || SECTIONS[0];
  const site = section === 'funnels' ? FUNNEL_SITE_LIST.find((s) => s.key === siteKey) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="tablist" aria-label="AI SEO section">
        {SECTIONS.map((s) => {
          const on = s.key === section;
          return (
            <button key={s.key} type="button" role="tab" aria-selected={on} onClick={() => pickSection(s.key)}
              className="text-left px-4 py-2.5 rounded-[12px] border transition-colors"
              style={on ? { background: T.textPrimary, borderColor: T.textPrimary, color: '#fff' } : { background: '#fff', borderColor: T.borderLight, color: T.textBody }}>
              <span className="block text-[13px] font-semibold leading-tight">{s.label}</span>
              <span className="block text-[11.5px] leading-tight mt-0.5" style={{ color: on ? 'rgba(255,255,255,0.75)' : T.textMuted }}>{s.short}</span>
            </button>
          );
        })}
      </div>

      <section className="px-5 py-4" style={CARD}>
        <h2 className="text-[15px] font-bold" style={{ color: T.textPrimary }}>
          {cur.title}{site ? <span style={{ color: T.textMuted, fontWeight: 600 }}> · {site.domain}</span> : null}
          {section === 'hub' ? <span style={{ color: T.textMuted, fontWeight: 600 }}> · /guias</span> : null}
        </h2>
        <p className="text-[12.5px] mt-1" style={{ color: T.textSecondary }}>{cur.covers}</p>
        <p className="text-[12px] mt-1" style={{ color: T.textMuted }}><b style={{ color: T.textSecondary }}>Data sources:</b> {cur.sources}</p>
      </section>

      {section === 'funnels' ? (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Funnel site">
          {FUNNEL_SITE_LIST.map((s) => {
            const on = s.key === siteKey;
            return (
              <button key={s.key} type="button" role="radio" aria-checked={on} onClick={() => pickSite(s.key)}
                className="text-left px-3 py-1.5 rounded-[12px] border transition-colors"
                style={on ? { background: T.primary, borderColor: T.primary, color: '#fff' } : { background: '#fff', borderColor: T.borderLight, color: T.textBody }}>
                <span className="block text-[12.5px] font-semibold leading-tight">{s.label}</span>
                <span className="block text-[11px] leading-tight" style={{ color: on ? 'rgba(255,255,255,0.8)' : T.textMuted }}>{s.domain}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {section === 'buyer' ? <SeoTab key="buyer" /> : null}
      {section === 'funnels' ? <SeoTab key={`site-${siteKey}`} site={siteKey} /> : null}
      {section === 'hub' ? <SeoTab key="hub" site={HUB_SITE.key} /> : null}
    </div>
  );
}
