'use client';

// UTM Links — three tabs:
//  · Our links: one link per channel (lib/campaigns.js) that WE post or send. Times
//    opened + people who landed. Data: /api/analytics/posthog?type=links.
//  · WhatsApp contacts: the link inside each buyer's WhatsApp message to a seller
//    (property page button), who contacted whom and whether the seller opened it.
//    Data: /api/contacts (components/WhatsAppContacts.js).
//  · Automation emails: per automation, emails sent → clicked → people who landed on the
//    site → what they did next (signed up, listed, paid). Data: /api/email-results.
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
const TABS = [['links', 'Our links'], ['emails', 'Automation emails'], ['contacts', 'WhatsApp contacts']];

const pctText = (v) => (v == null ? '—' : `${v}%`);

// Automation emails: what each one leads to. Clicks come from Resend; landings and what
// people did next from PostHog (the buyer site tags every email link with utm_campaign).
function EmailResults({ days }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    fetch(`/api/email-results?days=${days}`).then((r) => r.json())
      .then((j) => { if (cancelled) return; if (j.error) setError(j.error); else setData(j); })
      .catch(() => { if (!cancelled) setError('Couldn’t load the numbers right now. Try again in a minute.'); });
    return () => { cancelled = true; };
  }, [days]);
  const num = (v, strong) => <span style={{ color: v ? T.textPrimary : T.textMuted, fontWeight: strong ? 600 : 500 }}>{v}</span>;
  return (
    <>
      <p className="text-[13px] leading-relaxed max-w-[900px]" style={{ color: T.textSecondary }}>
        Every automation email links back to the site with its own tag, so we can see who came from it and what they did next.
        Opens are left out: Apple Mail opens every email by itself. Emails sent before Oct 26 have no tag, so they show clicks but no visits.
      </p>
      <div className="bg-white overflow-hidden" style={CARD}>
        {error ? <p className="p-10 text-center text-sm" style={{ color: T.textMuted }}>{error}</p>
          : !data ? <p className="p-10 text-center text-sm" style={{ color: T.textMuted }}>Loading…</p>
            : !data.rows.length ? <p className="p-10 text-center text-sm" style={{ color: T.textMuted }}>No automation emails in this period.</p> : (
              <div className="overflow-x-auto cl-scroll">
                <table className="w-full min-w-[820px] text-sm tabular-nums">
                  <thead style={{ background: T.bgSurface }}>
                    <tr style={{ color: T.textSecondary }}>
                      {['Automation', 'Emails sent', 'Clicked', 'Came to the site', 'Signed up', 'Listed', 'Paid', 'WhatsApp read'].map((h, i) => (
                        <th key={h} className={`px-5 py-3 text-[10px] font-semibold uppercase tracking-wider ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.automation} className="border-t" style={{ borderColor: T.borderLight }}>
                        <td className="px-5 py-3 font-semibold" style={{ color: T.textPrimary }}>{r.label}</td>
                        <td className="px-5 py-3 text-right">{num(r.sent, true)}{r.failed ? <span className="block text-[11px]" style={{ color: '#B42318' }}>{r.failed} failed</span> : null}</td>
                        <td className="px-5 py-3 text-right">{num(r.clicked, true)}<span className="block text-[11px]" style={{ color: T.textMuted }}>{pctText(r.clickRate)}</span></td>
                        <td className="px-5 py-3 text-right">{num(r.landed, true)}<span className="block text-[11px]" style={{ color: T.textMuted }}>{r.visits ? `${r.visits} visits` : '—'}</span></td>
                        <td className="px-5 py-3 text-right">{num(r.signedUp)}</td>
                        <td className="px-5 py-3 text-right">{num(r.listed)}</td>
                        <td className="px-5 py-3 text-right">{num(r.paid)}</td>
                        <td className="px-5 py-3 text-right">{r.whatsappSent ? <>{num(r.whatsappRead)}<span className="block text-[11px]" style={{ color: T.textMuted }}>of {r.whatsappSent} · {pctText(r.readRate)}</span></> : <span style={{ color: T.textMuted }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
      {data?.notes?.length ? <p className="text-[12px]" style={{ color: T.textMuted }}>{data.notes.join(' ')}</p> : null}
    </>
  );
}

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
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // /utm-links?tab=contacts (the old Contacts page) or ?tab=emails opens that tab.
  useEffect(() => {
    try { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'contacts' || t === 'emails') setTab(t); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (tab !== 'links') return undefined;
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
  }, [days, tab]);

  const rangeLabel = (RANGES.find(([d]) => d === days) || [0, ''])[1].replace('12 months', 'year');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>UTM Links</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Tracked links to the site: the ones we post, our automation emails, and the ones buyers send to sellers on WhatsApp.</p>
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
      ) : tab === 'emails' ? (
        <EmailResults days={days} />
      ) : (
        <>
          <p className="text-[13px] leading-relaxed max-w-[900px]" style={{ color: T.textSecondary }}>
            When a buyer taps <b style={{ color: T.textPrimary }}>WhatsApp</b> on a property page, WhatsApp opens to the seller with a ready message
            (&ldquo;Hola! ¿Está disponible la propiedad?&rdquo;) and a link to the listing. Every message gets its own link, so we can see who contacted
            which seller and whether the seller opened it. Buyers who weren&apos;t signed in show by name once they sign in.
          </p>
          <WhatsAppContacts days={days} />
        </>
      )}
    </div>
  );
}
