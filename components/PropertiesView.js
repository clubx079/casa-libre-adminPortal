'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { makeT, locale } from '@/lib/i18n';
import { dualPrice, fmtUsd, fmtPyg } from '@/lib/money';
import { typeLabel } from '@/lib/propertyType';

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

  const ViewBtn = ({ r, cls }) => (
    <a href={`/preview/${r.id}`} target="_blank" rel="noopener noreferrer" className={cls}>{t('prop.view')}</a>
  );
  const EditBtn = ({ r, cls }) => (
    <Link href={`/properties/${r.id}/edit`} className={cls}>{t('prop.edit')}</Link>
  );

  return (
    <div>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <form onSubmit={(e) => { e.preventDefault(); go({ q: search, page: 1 }); }} className="flex-1 min-w-[220px]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('prop.search')} className="w-full px-4 py-2.5 border-[1.5px] border-ink/30 rounded-pill bg-card text-[14px] outline-none focus:border-ink" />
        </form>
        <div className="flex gap-2">
          {['all', 'active', 'inactive'].map((s) => (
            <button key={s} onClick={() => go({ status: s, page: 1 })} className={`px-4 py-2 rounded-pill text-[13px] font-semibold border-[1.5px] border-ink ${status === s ? 'bg-ink text-paper' : 'bg-transparent text-ink'}`}>
              {t(s === 'all' ? 'prop.all' : s === 'active' ? 'prop.active' : 'prop.inactive')}
            </button>
          ))}
        </div>
        {/* class: buildings / land / all */}
        <div className="flex items-center border-[1.5px] border-ink rounded-pill p-[3px]">
          {['buildings', 'land', 'all'].map((c) => (
            <button key={c} onClick={() => go({ cls: c, page: 1 })} className={`px-3 py-1.5 rounded-pill text-[12px] font-semibold ${cls === c ? 'bg-ink text-paper' : 'text-ink/60'}`}>
              {t(c === 'buildings' ? 'prop.classBuildings' : c === 'land' ? 'prop.classLand' : 'prop.classAll')}
            </button>
          ))}
        </div>
        {/* source / template filter */}
        {sources.length > 0 && (
          <select
            value={source}
            onChange={(e) => go({ source: e.target.value, page: 1 })}
            className="px-4 py-2 rounded-pill text-[13px] font-semibold border-[1.5px] border-ink bg-card text-ink outline-none cursor-pointer max-w-[220px]"
          >
            <option value="">{t('prop.allSources')}</option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
          </select>
        )}
        {/* view toggle */}
        <div className="flex items-center border-[1.5px] border-ink rounded-pill p-[3px]">
          {['table', 'cards'].map((v) => (
            <button key={v} onClick={() => go({ view: v })} className={`px-3 py-1.5 rounded-pill text-[12px] font-semibold ${view === v ? 'bg-ink text-paper' : 'text-ink/60'}`}>
              {t(v === 'table' ? 'prop.viewTable' : 'prop.viewCards')}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-ink/50 w-full sm:w-auto sm:ml-auto">{count} {t('prop.count')}</span>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 text-ink/50">{t('prop.empty')}</div>
      ) : view === 'cards' ? (
        /* ---- CARD VIEW ---- */
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const inactive = r.admin_status !== 'active';
            return (
              <div key={r.id} className={`bg-card border border-ink/15 rounded-card overflow-hidden flex flex-col ${inactive ? 'opacity-70' : ''}`}>
                <div className="h-40 cl-hatch relative">
                  {r.feature_image_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={r.feature_image_url} alt="" className="w-full h-full object-cover" />)}
                  <span className={`absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-pill ${inactive ? 'bg-hatch1 text-ink/70' : 'bg-ink text-paper'}`}>
                    {inactive ? t('prop.statusInactive') : t('prop.statusActive')}
                  </span>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="text-[17px] font-bold tracking-head">{fmtUsd(money(r).usd, loc)}{rentSfx(r)}</div>
                  <div className="text-[12.5px] font-semibold text-ink/55">{fmtPyg(money(r).pyg, loc)}{rentSfx(r)}</div>
                  <div className="text-[13px] font-medium mt-0.5 line-clamp-1">{r.city || '—'}</div>
                  <div className="text-[12px] text-ink/55 line-clamp-2 mt-0.5 flex-1">{r.address}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {typeLabel(r.property_type, lang) && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-pill border border-ink/25 text-ink/70">{typeLabel(r.property_type, lang)}</span>
                    )}
                    {r.scrape_sources?.name && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-pill bg-hatch1 text-ink/70">{r.scrape_sources.name}</span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-ink/45 mt-2">{specs(r)}</div>
                  <div className="flex gap-2 mt-3">
                    <ViewBtn r={r} cls="px-3 py-2 border-[1.5px] border-ink text-[13px] font-semibold rounded-pill" />
                    <EditBtn r={r} cls="flex-1 text-center px-3 py-2 bg-ink text-paper text-[13px] font-semibold rounded-pill" />
                    <button onClick={() => del(r)} disabled={busyId === r.id} className="px-3 py-2 border-[1.5px] border-ink text-[13px] font-semibold rounded-pill disabled:opacity-50" title={t('prop.delete')}>✕</button>
                  </div>
                  <button onClick={() => toggleActive(r)} disabled={busyId === r.id} className="mt-2 px-3 py-1.5 text-[12px] font-semibold text-ink/60 hover:text-ink disabled:opacity-50">
                    {inactive ? t('prop.activate') : t('prop.deactivate')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ---- TABLE VIEW (default) ---- */
        <div className="bg-card border border-ink/15 rounded-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[1140px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-label text-ink/50 border-b border-ink/10">
                  <th className="px-3 py-3 w-16"></th>
                  <th className="px-3 py-3">{t('prop.thTitle')}</th>
                  <th className="px-3 py-3">{t('prop.thType')}</th>
                  <th className="px-3 py-3">{t('prop.thSource')}</th>
                  <th className="px-3 py-3">{t('prop.thCity')}</th>
                  <th className="px-3 py-3">{t('prop.thUsd')}</th>
                  <th className="px-3 py-3">{t('prop.thLocal')}</th>
                  <th className="px-3 py-3">{t('prop.thSpecs')}</th>
                  <th className="px-3 py-3">{t('prop.thStatus')}</th>
                  <th className="px-3 py-3 text-right">{t('prop.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const inactive = r.admin_status !== 'active';
                  return (
                    <tr key={r.id} className={`border-b border-ink/[.06] ${inactive ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="w-12 h-12 rounded-input cl-hatch overflow-hidden">
                          {r.feature_image_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={r.feature_image_url} alt="" className="w-full h-full object-cover" />)}
                        </div>
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <div className="font-medium line-clamp-1">{r.address}</div>
                      </td>
                      <td className="px-3 py-2 text-ink/75 whitespace-nowrap">{typeOf(r)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-hatch1 text-ink/75 whitespace-nowrap">{r.scrape_sources?.name || '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-ink/70">{r.city || '—'}</td>
                      <td className="px-3 py-2 font-bold tracking-head whitespace-nowrap">{fmtUsd(money(r).usd, loc)}{rentSfx(r)}</td>
                      <td className="px-3 py-2 font-semibold text-ink/70 whitespace-nowrap">{fmtPyg(money(r).pyg, loc)}{rentSfx(r)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ink/55 whitespace-nowrap">{specs(r) || '—'}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => toggleActive(r)} disabled={busyId === r.id} className={`text-[11px] font-semibold px-2.5 py-1 rounded-pill border-[1.5px] border-ink disabled:opacity-50 ${inactive ? 'bg-transparent text-ink' : 'bg-ink text-paper'}`}>
                          {inactive ? t('prop.statusInactive') : t('prop.statusActive')}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5 justify-end">
                          <ViewBtn r={r} cls="px-3 py-1.5 border-[1.5px] border-ink text-[12px] font-semibold rounded-pill" />
                          <EditBtn r={r} cls="px-3 py-1.5 bg-ink text-paper text-[12px] font-semibold rounded-pill" />
                          <button onClick={() => del(r)} disabled={busyId === r.id} className="px-3 py-1.5 border-[1.5px] border-ink text-[12px] font-semibold rounded-pill disabled:opacity-50">{t('prop.delete')}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button onClick={() => go({ page: page - 1 })} disabled={page <= 1} className="px-5 py-2.5 border-[1.5px] border-ink rounded-pill text-[13px] font-semibold disabled:opacity-40">← {t('prop.prev')}</button>
          <span className="font-mono text-[12px] text-ink/60">{t('prop.page')} {page} / {totalPages}</span>
          <button onClick={() => go({ page: page + 1 })} disabled={page >= totalPages} className="px-5 py-2.5 border-[1.5px] border-ink rounded-pill text-[13px] font-semibold disabled:opacity-40">{t('prop.next')} →</button>
        </div>
      )}
    </div>
  );
}
