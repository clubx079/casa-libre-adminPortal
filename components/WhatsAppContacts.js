'use client';

// WhatsApp contacts from listings, for the UTM Links page. A buyer taps WhatsApp on a
// property page, WhatsApp opens to the seller with a ready message carrying a link
// back to the listing, and when the seller opens it the contact is marked "opened"
// (buyer portal /api/contact-track). Data: /api/contacts; rules: lib/contactsReport.
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, User, ExternalLink } from 'lucide-react';
import { openState, contactStats } from '@/lib/contactsReport';
import { countryName } from '@/lib/internalTraffic';

const T = {
  textPrimary: '#111111', textBody: '#3A3A37', textSecondary: '#6B6862', textMuted: '#9C978C',
  borderLight: '#E7E1D6', bgSurface: '#FAF7F1',
  success: '#0F6E56', successSurface: '#E4F1E9', warning: '#8A5A12', warningSurface: '#F5EAD5',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const fmtDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};
const fmtDay = (v) => { try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; } };
const shortId = (v) => (v ? String(v).slice(0, 8) : '—');

const Stat = ({ label, value, sub }) => (
  <div className="bg-white px-4 py-3" style={CARD}>
    <div className="text-[22px] font-bold tracking-head" style={{ color: T.textPrimary }}>{value}</div>
    <div className="text-[11px] font-mono uppercase tracking-wider mt-0.5" style={{ color: T.textMuted }}>{label}</div>
    {sub ? <div className="text-[11px] mt-1" style={{ color: T.textMuted }}>{sub}</div> : null}
  </div>
);

const BADGE = {
  opened: { text: 'Opened', style: { background: T.successSurface, color: T.success } },
  not_opened: { text: 'Not opened', style: { background: T.warningSurface, color: T.warning } },
  untracked: { text: 'Not trackable', style: { background: T.bgSurface, color: T.textMuted } },
};

// landed: people PostHog saw arrive through these links (selected period), optional.
export default function WhatsAppContacts({ landed = null, landedSub = '' }) {
  const [all, setAll] = useState([]);
  const [gap, setGap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(false);
      try {
        const res = await fetch('/api/contacts', { cache: 'no-store' });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) { setAll(json.rows || []); setGap(json.gap || null); } else setError(true);
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => contactStats(all, gap), [all, gap]);
  const rows = useMemo(() => all.filter((r) => (r.channel || 'whatsapp') === 'whatsapp').map((r) => ({ ...r, _state: openState(r, gap) })), [all, gap]);
  const shown = tab === 'all' ? rows : rows.filter((r) => r._state === tab);
  const notOpened = rows.filter((r) => r._state === 'not_opened').length;

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 ${landed != null ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-3`}>
        <Stat label="WhatsApp contacts" value={stats.whatsapp} sub={stats.calls || stats.copies ? `+ ${stats.calls} call${stats.calls === 1 ? '' : 's'}, ${stats.copies} copied number${stats.copies === 1 ? '' : 's'}` : ''} />
        <Stat label="Opened by seller" value={stats.opened} />
        <Stat label="Open rate" value={stats.trackable ? `${stats.rate}%` : '—'} sub={stats.untracked ? `of ${stats.trackable} trackable` : ''} />
        {landed != null ? <Stat label="People landed" value={landed} sub={landedSub} /> : null}
      </div>

      {stats.untracked > 0 && gap ? (
        <p className="text-[12px] leading-relaxed" style={{ color: T.textSecondary }}>
          <b style={{ color: T.textPrimary }}>{stats.untracked} contacts are not trackable.</b> From {fmtDay(gap.from)}{gap.until ? ` to ${fmtDay(gap.until)}` : ''}, the
          link in the message had no contact code, so a seller opening it couldn&apos;t be matched to the contact. Those visits still count in People landed.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {[['all', 'All', rows.length], ['opened', 'Opened', stats.opened], ['not_opened', 'Not opened', notOpened], ...(stats.untracked ? [['untracked', 'Not trackable', stats.untracked]] : [])].map(([k, label, n]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-3.5 py-1.5 rounded-full border transition-colors"
              style={on ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary } : { background: '#fff', color: T.textBody, borderColor: T.borderLight }}>
              {label}
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full" style={on ? { background: 'rgba(255,255,255,0.2)' } : { background: T.bgSurface, color: T.textMuted }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="w-full min-w-[900px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Buyer', 'Seller', 'Property', 'Sent', 'Opened by seller'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[0, 1, 2, 3, 4].map((j) => (<td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '80px', background: T.bgSurface }} /></td>))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load contacts. Check the DB connection.</td></tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <MessageCircle className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No contacts here</p>
                  </td>
                </tr>
              ) : shown.map((r) => {
                const badge = BADGE[r._state];
                return (
                  <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3 text-xs max-w-[200px]">
                      {r.buyer_name || r.buyer_email ? (
                        <>
                          <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={r.buyer_name || ''}>
                            {r.buyer_name || r.buyer_email}
                            {r.buyer_signed_up_later ? <span className="ml-1.5 text-[10px] font-normal px-1.5 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }} title="Wasn't signed in when they contacted; signed in later">signed in later</span> : null}
                          </p>
                          <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.buyer_email || '—'}</p>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }} title="The buyer wasn't signed in (and hasn't signed in since)"><User className="w-3 h-3" /> Not signed in</span>
                      )}
                      {r.buyer_ip || r.buyer_country ? (
                        <p className="text-[11px] truncate mt-0.5" style={{ color: T.textSecondary }} title={r.buyer_ip || ''}>
                          {[r.buyer_city, countryName(r.buyer_country)].filter(Boolean).join(', ') || '—'}
                          {r.buyer_ip ? <span className="font-mono" style={{ color: T.textMuted }}> · {r.buyer_ip}</span> : null}
                        </p>
                      ) : (
                        <p className="text-[11px] mt-0.5" style={{ color: T.textMuted }} title="Contacts from the mobile app, or from a browser that blocks analytics, have no location until the website saves it with each contact">location unknown</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[220px]">
                      <p className="truncate" style={{ color: T.textBody }} title={r.seller_name || ''}>
                        {r.seller_name || '—'}
                        {r.seller_kind === 'agency' ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }} title="Listing taken from another site: the seller has no Casa Libre account, so there is no email">agency listing</span> : null}
                      </p>
                      <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.seller_phone ? `+${r.seller_phone}` : '—'}</p>
                      {r.seller_email ? <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }} title={r.seller_email}>{r.seller_email}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[150px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono truncate" style={{ color: T.textBody }}>{r.listing_ref || shortId(r.property_id)}</span>
                        {r.property_id && (
                          <a href={`/preview/${r.property_id}`} target="_blank" rel="noreferrer" className="shrink-0" style={{ color: T.textMuted }} title="Open listing"><ExternalLink className="w-3 h-3" /></a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textMuted }}>{fmtDateTime(r.created_at)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={badge.style}>{badge.text}</span>
                        {r._state === 'opened' ? <span style={{ color: T.textMuted }}>{fmtDateTime(r.opened_at)}</span> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
