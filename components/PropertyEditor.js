'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { makeT } from '@/lib/i18n';

const FIELDS = [
  ['address', 'edit.address', 'text', 'full'],
  ['city', 'edit.city', 'text'],
  ['neighborhood', 'edit.neighborhood', 'text'],
  ['price', 'edit.price', 'number'],
  ['currency', 'edit.currency', 'select-cur'],
  ['listing_type', 'edit.operation', 'select-op'],
  ['bedrooms', 'edit.beds', 'number'],
  ['bathrooms', 'edit.baths', 'number'],
  ['floor_area', 'edit.area', 'number'],
  ['property_type', 'edit.type', 'text'],
];

export default function PropertyEditor({ initial, lang }) {
  const t = makeT(lang);
  const router = useRouter();
  const id = initial.id;

  const [tab, setTab] = useState('details'); // details | images
  const [form, setForm] = useState(initial);
  const [images, setImages] = useState(initial.property_images || []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [deletingProp, setDeletingProp] = useState(false);
  const fileRef = useRef(null);

  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const input = 'px-3.5 py-2.5 border-[1.5px] border-ink/30 rounded-input bg-paper font-sans font-medium text-[14px] outline-none focus:border-ink w-full';

  async function reloadImages() {
    const res = await fetch(`/api/properties/${id}`, { cache: 'no-store' });
    const { property } = await res.json();
    if (property) setImages(property.property_images || []);
  }

  async function save() {
    setSaving(true); setErr(''); setMsg('');
    try {
      const payload = {};
      FIELDS.forEach(([k]) => { payload[k] = form[k] ?? ''; });
      payload.description = form.description ?? '';
      payload.status = form.status ?? 'published';
      payload.admin_status = form.admin_status ?? 'active';
      const res = await fetch(`/api/properties/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setMsg(t('edit.saved'));
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  async function deleteImage(imgId) {
    if (!confirm(t('edit.confirmDelete'))) return;
    setDeletingId(imgId);
    try { await fetch(`/api/properties/${id}/images/${imgId}`, { method: 'DELETE' }); await reloadImages(); }
    finally { setDeletingId(null); }
  }
  async function setCover(imgId) {
    await fetch(`/api/properties/${id}/images/${imgId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: true }) });
    await reloadImages();
  }
  async function addImages(files) {
    setUploading(true); setErr('');
    try {
      for (const file of files) {
        const fd = new FormData(); fd.append('file', file);
        const res = await fetch(`/api/properties/${id}/images`, { method: 'POST', body: fd });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload error'); }
      }
      await reloadImages();
    } catch (e) { setErr(e.message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function deleteProperty() {
    if (!confirm(t('prop.confirmDelete'))) return;
    setDeletingProp(true);
    try {
      await fetch(`/api/properties/${id}`, { method: 'DELETE' });
      router.push('/properties'); router.refresh();
    } catch (e) { setErr(e.message); setDeletingProp(false); }
  }

  return (
    <div>
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="min-w-0">
          <h1 className="text-[clamp(22px,3vw,30px)] tracking-head font-bold m-0 line-clamp-1">{form.address || t('edit.title')}</h1>
          <div className="font-mono text-[11px] text-ink/45 mt-1">{form.city} {form.scrape_sources?.name ? `· ${form.scrape_sources.name}` : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/preview/${id}`} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 border-[1.5px] border-ink rounded-pill text-[13px] font-semibold">{t('editor.viewOnSite')}</a>
          <button onClick={save} disabled={saving} className="px-6 py-2.5 bg-ink text-paper rounded-pill text-[13px] font-semibold shadow-hard-soft disabled:opacity-60 flex items-center gap-2">
            {saving && <span className="w-3.5 h-3.5 border-2 border-paper/40 border-t-paper rounded-full cl-spin" />}
            {saving ? t('edit.saving') : t('edit.save')}
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-2 border-b border-ink/10 mb-6">
        {[['details', t('editor.tabDetails')], ['images', `${t('editor.tabImages')} (${images.length})`]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-[14px] font-semibold border-b-2 -mb-px ${tab === key ? 'border-ink text-ink' : 'border-transparent text-ink/50 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {(msg || err) && (
        <div className={`mb-4 text-[13px] font-medium rounded-input px-3 py-2.5 ${err ? 'bg-hatch1 border border-ink/20' : 'bg-ink text-paper'}`}>{err || msg}</div>
      )}

      {tab === 'details' ? (
        <div className="bg-card border border-ink/15 rounded-card p-6 max-w-3xl">
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map(([k, labelKey, type, span]) => (
              <label key={k} className={`flex flex-col gap-1 text-[12px] font-semibold ${span === 'full' ? 'sm:col-span-2' : ''}`}>
                {t(labelKey)}
                {type === 'select-cur' ? (
                  <select className={input} value={form[k] ?? ''} onChange={(e) => setF(k, e.target.value)}>
                    <option value="">—</option><option value="USD">USD</option><option value="PYG">PYG</option>
                  </select>
                ) : type === 'select-op' ? (
                  <select className={input} value={form[k] ?? ''} onChange={(e) => setF(k, e.target.value)}>
                    <option value="sale">{t('edit.sale')}</option><option value="rent">{t('edit.rent')}</option>
                  </select>
                ) : (
                  <input type={type} className={input} value={form[k] ?? ''} onChange={(e) => setF(k, e.target.value)} />
                )}
              </label>
            ))}
            <label className="flex flex-col gap-1 text-[12px] font-semibold sm:col-span-2">
              {t('edit.description')}
              <textarea rows={5} className={input + ' resize-y'} value={form.description ?? ''} onChange={(e) => setF('description', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              {t('edit.visibility')}
              <select className={input} value={form.admin_status ?? 'active'} onChange={(e) => setF('admin_status', e.target.value)}>
                <option value="active">{t('prop.active')}</option><option value="inactive">{t('prop.inactive')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              status
              <select className={input} value={form.status ?? 'published'} onChange={(e) => setF('status', e.target.value)}>
                <option value="published">{t('edit.published')}</option><option value="draft">{t('edit.draft')}</option>
              </select>
            </label>
          </div>

          {/* danger zone */}
          <div className="mt-6 pt-5 border-t border-ink/10">
            <button onClick={deleteProperty} disabled={deletingProp} className="px-5 py-2.5 border-[1.5px] border-ink rounded-pill text-[13px] font-semibold disabled:opacity-60">
              {deletingProp ? t('prop.deleting') : t('editor.delete')}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-ink/15 rounded-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[10px] uppercase tracking-label text-ink/50">{t('edit.images')} ({images.length})</div>
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="px-4 py-2 bg-ink text-paper text-[12px] font-semibold rounded-pill disabled:opacity-60 flex items-center gap-2">
              {uploading && <span className="w-3 h-3 border-2 border-paper/40 border-t-paper rounded-full cl-spin" />}
              {uploading ? t('edit.uploading') : `+ ${t('edit.addImages')}`}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files?.length && addImages(Array.from(e.target.files))} />
          </div>

          {images.length === 0 ? (
            <div className="text-center py-12 text-ink/45 text-sm bg-paper border border-dashed border-ink/25 rounded-card">{t('edit.noImages')}</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {images.map((img) => (
                <div key={img.id} className={`relative rounded-input overflow-hidden border-2 ${img.is_feature ? 'border-ink' : 'border-transparent'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.storage_url} alt="" className="w-full h-28 object-cover cl-hatch" />
                  {img.is_feature && <span className="absolute top-1 left-1 text-[9px] font-semibold bg-ink text-paper px-1.5 py-0.5 rounded-pill">{t('edit.cover')}</span>}
                  <div className="absolute inset-x-0 bottom-0 flex">
                    {!img.is_feature && <button onClick={() => setCover(img.id)} className="flex-1 text-[9px] font-semibold bg-paper/90 text-ink py-1 hover:bg-paper">{t('edit.setCover')}</button>}
                    <button onClick={() => deleteImage(img.id)} disabled={deletingId === img.id} className="flex-1 text-[9px] font-semibold bg-ink/90 text-paper py-1 hover:bg-ink disabled:opacity-60">
                      {deletingId === img.id ? '…' : t('edit.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
