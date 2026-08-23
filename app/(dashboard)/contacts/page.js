'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, User, ExternalLink } from 'lucide-react';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  warning: '#8A5A12',
  warningSurface: '#F5EAD5',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const fmtDateTime = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};
const shortId = (v) => (v ? String(v).slice(0, 8) : '—');

export default function ContactsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('all');

  async function fetchRows() {
    setLoading(true); setError(false);
    try {
      const res = await fetch('/api/contacts', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setRows(json.rows || []);
      else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { fetchRows(); }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const opened = rows.filter((r) => r.opened_at || r.status === 'opened').length;
    return { total, opened, rate: total ? Math.round((opened / total) * 100) : 0 };
  }, [rows]);

  const shown = tab === 'all' ? rows : tab === 'opened' ? rows.filter((r) => r.opened_at || r.status === 'opened') : rows.filter((r) => !(r.opened_at || r.status === 'opened'));

  const Stat = ({ label, value }) => (
    <div className="bg-white px-4 py-3" style={CARD}>
      <div className="text-[22px] font-bold tracking-head" style={{ color: T.textPrimary }}>{value}</div>
      <div className="text-[11px] font-mono uppercase tracking-wider mt-0.5" style={{ color: T.textMuted }}>{label}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Contacts</h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>WhatsApp contacts from listings — who contacted which seller about which property, and whether the seller opened the link.</p>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-[520px]">
        <Stat label="Contacts" value={stats.total} />
        <Stat label="Opened by seller" value={stats.opened} />
        <Stat label="Open rate" value={`${stats.rate}%`} />
      </div>

      <div className="flex items-center gap-1.5">
        {[['all', 'All', stats.total], ['opened', 'Opened', stats.opened], ['pending', 'Not opened', stats.total - stats.opened]].map(([k, label, n]) => {
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
          <table className="w-full min-w-[1080px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Buyer', 'Seller', 'Property', 'Channel', 'Sent', 'Opened by seller'].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(6)].map((__, j) => (<td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '80px', background: T.bgSurface }} /></td>))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load contacts. Check the DB connection.</td></tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <MessageCircle className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No contacts yet</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>WhatsApp contacts from buyers will show up here.</p>
                  </td>
                </tr>
              ) : shown.map((r) => {
                const opened = !!(r.opened_at || r.status === 'opened');
                return (
                  <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3 text-xs max-w-[180px]">
                      {r.buyer_name || r.buyer_email ? (
                        <>
                          <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={r.buyer_name || ''}>{r.buyer_name || '—'}</p>
                          <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.buyer_email || '—'}</p>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}><User className="w-3 h-3" /> Anonymous</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[170px]">
                      <p className="truncate" style={{ color: T.textBody }} title={r.seller_name || ''}>{r.seller_name || '—'}</p>
                      <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.seller_phone || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[150px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono truncate" style={{ color: T.textBody }}>{r.listing_ref || shortId(r.property_id)}</span>
                        {r.property_id && (
                          <a href={`https://casa-libre-buyerportal.apps.airosofts.com/propiedad/${r.property_id}`} target="_blank" rel="noreferrer" className="shrink-0" style={{ color: T.textMuted }} title="Open listing"><ExternalLink className="w-3 h-3" /></a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs capitalize" style={{ color: T.textBody }}>{r.channel || 'whatsapp'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textMuted }}>{fmtDateTime(r.created_at)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {opened ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: T.successSurface, color: T.success }}>Opened</span>
                          <span style={{ color: T.textMuted }}>{fmtDateTime(r.opened_at)}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: T.warningSurface, color: T.warning }}>Not opened</span>
                      )}
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
