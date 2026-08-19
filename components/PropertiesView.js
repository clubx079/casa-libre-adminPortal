'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { makeT, locale } from '@/lib/i18n';
import { dualPrice, fmtUsd, fmtPyg } from '@/lib/money';
import { typeLabel } from '@/lib/propertyType';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const LIST_MAX_HEIGHT = 640;

export default function PropertiesView({ rows, count, page, totalPages, q, status, view, lang, rate, sources = [], source = '', cls = 'buildings' }) {
  const t = makeT(lang);
  const loc = locale(lang);
  const router = useRouter();

  const [search, setSearch] = useState(q);
  const [busyId, setBusyId] = useState(null);

  const go = (params) => {
    const sp = new URLSearchParams();
    const nq = params.q ?? q;
    const ns = params.status ?? status;
    const nv = params.view ?? view;
    const nsrc = params.source ?? source;
    const ncls = params.cls ?? cls;
    const np = params.page ?? 1;
    if (nq) sp.set('q', nq);
    if (ns && ns !== 'all') sp.set('status', ns);
    if (nv && nv !== 'table') sp.set('view', nv);
    if (nsrc) sp.set('source', nsrc);
    if (ncls && ncls !== 'buildings') sp.set('class', ncls);
    if (np && np > 1) sp.set('page', String(np));
    router.push(`/properties${sp.toString() ? '?' + sp.toString() : ''}`);
  };

  const rentSfx = (r) => (r.listing_type === 'rent' ? t('preview.perMonth') : '');
  const money = (r) => dualPrice(r.price, r.currency, rate);
  const typeOf = (r) => typeLabel(r.property_type, lang) || '—';
  const specs = (r) =>
    [r.bedrooms != null && `${r.bedrooms} ${t('prop.beds')}`, r.bathrooms != null && `${r.bathrooms} ${t('prop.baths')}`, r.floor_area != null && `${r.floor_area} m²`].filter(Boolean).join(' · ');

  async function toggleActive(r) {
    setBusyId(r.id);
    const next = r.admin_status === 'active' ? 'inactive' : 'active';
    try {
      await fetch(`/api/properties/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_status: next }) });
      router.refresh();
    } finally { setBusyId(null); }
  }

  async function del(r) {
    if (!confirm(t('prop.confirmDelete'))) return;
    setBusyId(r.id);
    try {
      await fetch(`/api/properties/${r.id}`, { method: 'DELETE' });
      router.refresh();
    } finally { setBusyId(null); }
  }

  const pillBtn = (active) => ({
    borderRadius: '999px',
    border: `1px solid ${active ? T.textPrimary : T.borderLight}`,
    background: active ? T.textPrimary : T.bgWhite,
    color: active ? T.bgWhite : T.textBody,
  });

  const ViewBtn = ({ r, cls }) => (
    <a href={`/preview/${r.id}`} target="_blank" rel="noopener noreferrer" className={cls} style={{ borderRadius: '999px', border: `1px solid ${T.borderLight}`, color: T.textBody }}>{t('prop.view')}</a>
  );
  const EditBtn = ({ r, cls }) => (
    <Link href={`/properties/${r.id}/edit`} className={cls} style={{ borderRadius: '999px', background: T.textPrimary, color: T.bgWhite }}>{t('prop.edit')}</Link>
  );

  return (
    <div className="space-y-5">
      {/* controls */}
      <div className="bg-white p-4 flex flex-wrap items-center gap-3" style={CARD}>
        <form onSubmit={(e) => { e.preventDefault(); go({ q: search, page: 1 }); }} className="flex-1 min-w-[220px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('prop.search')}
            className="w-full outline-none"
            style={{
              padding: '8px 14px', fontSize: '13px',
              border: `1px solid ${T.borderLight}`, borderRadius: '999px',
              background: T.bgWhite, color: T.textBody,
            }}
          />
        </form>
        <div className="flex gap-2">
          {['all', 'active', 'inactive'].map((s) => (
            <button
              key={s}
              onClick={() => go({ status: s, page: 1 })}
              className="px-3.5 py-1.5 text-[12px] font-semibold"
              style={pillBtn(status === s)}
            >
              {t(s === 'all' ? 'prop.all' : s === 'active' ? 'prop.active' : 'prop.inactive')}
            </button>
          ))}
        </div>
        {/* class: buildings / land / all */}
        <div className="flex items-center p-[3px]" style={{ border: `1px solid ${T.borderLight}`, borderRadius: '999px' }}>
          {['buildings', 'land', 'all'].map((c) => (
            <button
              key={c}
              onClick={() => go({ cls: c, page: 1 })}
              className="px-3 py-1 text-[11px] font-semibold rounded-full"
              style={cls === c ? { background: T.textPrimary, color: T.bgWhite } : { color: T.textSecondary }}
            >
              {t(c === 'buildings' ? 'prop.classBuildings' : c === 'land' ? 'prop.classLand' : 'prop.classAll')}
            </button>
          ))}
        </div>
        {/* source / template filter */}
        {sources.length > 0 && (
          <select
            value={source}
            onChange={(e) => go({ source: e.target.value, page: 1 })}
            className="px-3.5 py-1.5 text-[12px] font-semibold outline-none cursor-pointer max-w-[200px]"
            style={{ border: `1px solid ${T.borderLight}`, borderRadius: '999px', background: T.bgWhite, color: T.textBody }}
          >
            <option value="">{t('prop.allSources')}</option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
          </select>
        )}
        {/* view toggle */}
        <div className="flex items-center p-[3px]" style={{ border: `1px solid ${T.borderLight}`, borderRadius: '999px' }}>
          {['table', 'cards'].map((v) => (
            <button
              key={v}
              onClick={() => go({ view: v })}
              className="px-3 py-1 text-[11px] font-semibold rounded-full"
              style={view === v ? { background: T.textPrimary, color: T.bgWhite } : { color: T.textSecondary }}
            >
              {t(v === 'table' ? 'prop.viewTable' : 'prop.viewCards')}
            </button>
          ))}
        </div>
        <span className="text-[11px] w-full sm:w-auto sm:ml-auto" style={{ color: T.textMuted }}>{count} {t('prop.count')}</span>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: T.textMuted }}>{t('prop.empty')}</div>
      ) : view === 'cards' ? (
        /* ---- CARD VIEW ---- */
        <div style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }} className="cl-scroll">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pr-1">
            {rows.map((r) => {
              const inactive = r.admin_status !== 'active';
              return (
                <div key={r.id} className={`bg-white overflow-hidden flex flex-col ${inactive ? 'opacity-70' : ''}`} style={CARD}>
                  <div className="h-40 relative" style={{ background: T.bgSurface }}>
                    {r.feature_image_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={r.feature_image_url} alt="" className="w-full h-full object-cover" />)}
                    <span
                      className="absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={inactive ? { background: T.bgWhite, color: T.textSecondary } : { background: T.textPrimary, color: T.bgWhite }}
                    >
                      {inactive ? t('prop.statusInactive') : t('prop.statusActive')}
                    </span>
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="text-[17px] font-bold tracking-head" style={{ color: T.textPrimary }}>{fmtUsd(money(r).usd, loc)}{rentSfx(r)}</div>
                    <div className="text-[12.5px] font-semibold" style={{ color: T.textSecondary }}>{fmtPyg(money(r).pyg, loc)}{rentSfx(r)}</div>
                    <div className="text-[13px] font-medium mt-0.5 line-clamp-1" style={{ color: T.textPrimary }}>{r.city || '—'}</div>
                    <div className="text-[12px] line-clamp-2 mt-0.5 flex-1" style={{ color: T.textSecondary }}>{r.address}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {typeLabel(r.property_type, lang) && (
                        <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ border: `1px solid ${T.borderLight}`, color: T.textSecondary }}>{typeLabel(r.property_type, lang)}</span>
                      )}
                      {r.scrape_sources?.name && (
                        <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>{r.scrape_sources.name}</span>
                      )}
                    </div>
                    <div className="text-[11px] mt-2" style={{ color: T.textMuted }}>{specs(r)}</div>
                    <div className="flex gap-2 mt-3">
                      <ViewBtn r={r} cls="px-3 py-2 text-[13px] font-semibold" />
                      <EditBtn r={r} cls="flex-1 text-center px-3 py-2 text-[13px] font-semibold" />
                      <button onClick={() => del(r)} disabled={busyId === r.id} className="px-3 py-2 text-[13px] font-semibold rounded-full disabled:opacity-50" style={{ border: `1px solid ${T.borderLight}`, color: T.textBody }} title={t('prop.delete')}>✕</button>
                    </div>
                    <button onClick={() => toggleActive(r)} disabled={busyId === r.id} className="mt-2 px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ color: T.textSecondary }}>
                      {inactive ? t('prop.activate') : t('prop.deactivate')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ---- TABLE VIEW (default) ---- */
        <div className="bg-white overflow-hidden" style={CARD}>
          <div style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }} className="cl-scroll">
            <div className="overflow-x-auto cl-scroll">
              <table className="w-full min-w-[1140px]">
                <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}`, position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th className="px-3 py-2.5 w-16"></th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thTitle')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thType')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thSource')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thCity')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thUsd')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thLocal')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thSpecs')}</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thStatus')}</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{t('prop.thActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const inactive = r.admin_status !== 'active';
                    return (
                      <tr key={r.id} className={`border-b transition-colors ${inactive ? 'opacity-60' : ''}`} style={{ borderColor: T.borderLight }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSurface)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = T.bgWhite)}>
                        <td className="px-3 py-2">
                          <div className="w-12 h-12 overflow-hidden" style={{ borderRadius: '8px', background: T.bgSurface }}>
                            {r.feature_image_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={r.feature_image_url} alt="" className="w-full h-full object-cover" />)}
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-[280px]">
                          <div className="text-[13px] font-medium line-clamp-1" style={{ color: T.textPrimary }}>{r.address}</div>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: T.textBody }}>{typeOf(r)}</td>
                        <td className="px-3 py-2">
                          <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: T.bgSurface, color: T.textSecondary }}>{r.scrape_sources?.name || '—'}</span>
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: T.textBody }}>{r.city || '—'}</td>
                        <td className="px-3 py-2 text-xs font-bold tracking-head whitespace-nowrap" style={{ color: T.textPrimary }}>{fmtUsd(money(r).usd, loc)}{rentSfx(r)}</td>
                        <td className="px-3 py-2 text-xs font-semibold whitespace-nowrap" style={{ color: T.textSecondary }}>{fmtPyg(money(r).pyg, loc)}{rentSfx(r)}</td>
                        <td className="px-3 py-2 text-[11px] whitespace-nowrap" style={{ color: T.textMuted }}>{specs(r) || '—'}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => toggleActive(r)} disabled={busyId === r.id} className="text-[11px] font-semibold px-2.5 py-1 rounded-full disabled:opacity-50" style={inactive ? { border: `1px solid ${T.borderLight}`, color: T.textBody, background: 'transparent' } : { background: T.textPrimary, color: T.bgWhite }}>
                            {inactive ? t('prop.statusInactive') : t('prop.statusActive')}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5 justify-end">
                            <ViewBtn r={r} cls="px-3 py-1.5 text-[12px] font-semibold" />
                            <EditBtn r={r} cls="px-3 py-1.5 text-[12px] font-semibold" />
                            <button onClick={() => del(r)} disabled={busyId === r.id} className="px-3 py-1.5 text-[12px] font-semibold rounded-full disabled:opacity-50" style={{ border: `1px solid ${T.borderLight}`, color: T.textBody }}>{t('prop.delete')}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => go({ page: page - 1 })} disabled={page <= 1} className="px-4 py-2 text-[13px] font-semibold rounded-full disabled:opacity-40" style={{ border: `1px solid ${T.borderLight}`, color: T.textBody }}>← {t('prop.prev')}</button>
          <span className="text-[12px]" style={{ color: T.textSecondary }}>{t('prop.page')} {page} / {totalPages}</span>
          <button onClick={() => go({ page: page + 1 })} disabled={page >= totalPages} className="px-4 py-2 text-[13px] font-semibold rounded-full disabled:opacity-40" style={{ border: `1px solid ${T.borderLight}`, color: T.textBody }}>{t('prop.next')} →</button>
        </div>
      )}
    </div>
  );
}
