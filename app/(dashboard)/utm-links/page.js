'use client';

// UTM Links — two tabs:
//  · Our links: one link per channel (lib/campaigns.js) that WE post or send. Times
//    opened + people who landed. Data: /api/analytics/posthog?type=links.
//  · WhatsApp contacts: the link inside each buyer's WhatsApp message to a seller
//    (property page button), who contacted whom and whether the seller opened it.
//    Data: /api/contacts (components/WhatsAppContacts.js).
// Links shared with a listing's Share button carry no tags, so they aren't here.
import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import WhatsAppContacts from '@/components/WhatsAppContacts';

const T = {
  textPrimary: '#111111', textBody: '#3A3A37', textSecondary: '#6B6862', textMuted: '#9C978C',
  borderLight: '#E7E1D6', bgSurface: '#FAF7F1', success: '#0F6E56',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']];
const TABS = [['links', 'Our links'], ['contacts', 'WhatsApp contacts']];

const fmtWhen = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return '—'; }
};

function CopyLink({ link }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(link).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {});
  return (
    <button type="button" onClick={copy} title="Copy link"
      className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-mono text-[12px]"
      style={{ border: `1px solid ${T.borderLight}`, background: '#fff', color: T.textPrimary }}>
      {link.replace(/^https?:\/\//, '')}
      {done ? <Check className="w-3.5 h-3.5" style={{ color: T.success }} /> : <Copy className="w-3.5 h-3.5" style={{ color: T.textMuted }} />}
    </button>
  );
}

export default function UtmLinksPage() {
  const [tab, setTab] = useState('links');
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // /utm-links?tab=contacts opens the contacts tab (the old Contacts page sends people here).
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('tab') === 'contacts') setTab('contacts'); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    (async () => {
      // PostHog sometimes answers "too busy": retry a few times before giving up.
      for (let attempt = 1; attempt <= 6 && !cancelled; attempt++) {
        try {
          const res = await fetch(`/api/analytics/posthog?type=links&days=${days}`);
          const j = await res.json().catch(() => null);
          if (res.ok && j && Array.isArray(j.links)) { if (!cancelled) setData(j); return; }
          if (j && j.configured === false) { if (!cancelled) setError('PostHog is not connected for the admin yet.'); return; }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, Math.min(1500 * attempt, 8000)));
      }
      if (!cancelled) setError('Couldn’t load the numbers right now. Try again in a minute.');
    })();
    return () => { cancelled = true; };
  }, [days]);

  const rangeLabel = (RANGES.find(([d]) => d === days) || [0, ''])[1].replace('12 months', 'year');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>UTM Links</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Tracked links to the site: the ones we post, and the ones buyers send to sellers on WhatsApp.</p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map(([d, label]) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              className="text-xs font-medium px-3 py-1.5 rounded-full border"
              style={d === days ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary } : { borderColor: T.borderLight, color: T.textBody, background: '#fff' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: T.borderLight }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className="px-4 py-2 text-sm font-semibold -mb-px border-b-2"
            style={{ borderColor: tab === k ? T.textPrimary : 'transparent', color: tab === k ? T.textPrimary : T.textSecondary }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'links' ? (
        <>
          <div className="bg-white overflow-hidden" style={CARD}>
            {error ? (
              <p className="p-10 text-center text-sm" style={{ color: T.textMuted }}>{error}</p>
            ) : !data ? (
              <p className="p-10 text-center text-sm" style={{ color: T.textMuted }}>Loading…</p>
            ) : (
              <div className="overflow-x-auto cl-scroll">
                <table className="w-full min-w-[640px] text-sm">
                  <thead style={{ background: T.bgSurface }}>
                    <tr style={{ color: T.textSecondary }}>
                      {['Channel', 'Link', 'Opened', 'People landed', 'Last opened'].map((h, i) => (
                        <th key={h} className={`px-5 py-3 text-[10px] font-semibold uppercase tracking-wider ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.links.map((l) => (
                      <tr key={l.slug} className="border-t" style={{ borderColor: T.borderLight }}>
                        <td className="px-5 py-3 font-semibold" style={{ color: T.textPrimary }}>{l.label}</td>
                        <td className="px-5 py-3"><CopyLink link={l.link} /></td>
                        <td className="px-5 py-3 text-right font-semibold" style={{ color: l.opened ? T.textPrimary : T.textMuted }}>{l.opened}</td>
                        <td className="px-5 py-3 text-right font-semibold" style={{ color: l.landed ? T.textPrimary : T.textMuted }}>{l.landed}</td>
                        <td className="px-5 py-3 text-right whitespace-nowrap text-xs" style={{ color: T.textMuted }}>{fmtWhen(l.lastOpened)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed max-w-[900px]" style={{ color: T.textSecondary }}>
            When a buyer taps <b style={{ color: T.textPrimary }}>WhatsApp</b> on a property page, WhatsApp opens to the seller with a ready message
            (&ldquo;Hola! ¿Está disponible la propiedad?&rdquo;) and a link to the listing. Every message gets its own link, so we can see who contacted
            which seller and whether the seller opened it. Buyers who weren&apos;t signed in show by name once they sign in.
          </p>
          <WhatsAppContacts landed={data ? data.contactLanded : null} landedSub={`from these links, last ${rangeLabel}`} />
        </>
      )}
    </div>
  );
}
