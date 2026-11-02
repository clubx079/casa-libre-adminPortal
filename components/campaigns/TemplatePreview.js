'use client';
// A campaign template in both languages, side by side: Spanish (what was sent) and English
// (for the team). English comes from lib/waTemplateLook.js, or — for a template it doesn't
// describe — from /api/translate-preview. Used in the Sent campaigns pop-up and on a batch's
// page. TemplatePreviewModal = the pop-up (rendered on <body>, so it covers the whole screen).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { T, CARD } from '@/components/automations/ui';
import WhatsAppPreview from '@/components/campaigns/WhatsAppPreview';
import { templateLook } from '@/lib/waTemplateLook';

const translated = new Map();   // Spanish body → English, for this page view

export function TemplateBoth({ template, tpl, vars }) {
  const es = templateLook(template, tpl, vars, 'es');
  const enLook = templateLook(template, tpl, vars, 'en');
  const [enBody, setEnBody] = useState(enLook.body);
  useEffect(() => {
    if (enLook.translated) { setEnBody(enLook.body); return undefined; }
    if (!es.body) return undefined;
    if (translated.has(es.body)) { setEnBody(translated.get(es.body)); return undefined; }
    let alive = true;
    fetch('/api/translate-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: es.body }) })
      .then((r) => r.json()).then((j) => { if (j.text) translated.set(es.body, j.text); if (alive) setEnBody(j.text || null); }).catch(() => {});
    return () => { alive = false; };
  }, [template, es.body, enLook.translated, enLook.body]);

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="template-both">
      {[['Spanish · sent', es], ['English · translation', { ...enLook, body: enBody || '' }]].map(([label, look]) => (
        <div key={label}>
          <div className="text-[11.5px] font-semibold mb-1.5" style={{ color: T.textSecondary }}>{label}</div>
          <WhatsAppPreview look={look} />
        </div>
      ))}
    </div>
  );
}

export function TemplatePreviewModal({ open, tpls, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  const look = templateLook(open.template, tpls?.get(open.template));
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center p-4" style={{ background: 'rgba(0,0,0,.6)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Template preview" data-testid="template-modal">
      <div className="bg-white w-full max-w-[720px] max-h-[92vh] overflow-y-auto" style={{ ...CARD, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: T.borderLight }}>
          <div>
            <div className="text-[13.5px] font-bold" style={{ color: T.textPrimary }}>{look.format} template</div>
            <div className="text-[11px] font-mono" style={{ color: T.textMuted }}>{open.template}{open.name ? ` · ${open.name}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} className="text-[12px] font-semibold px-3 py-1 rounded-full border" style={{ borderColor: T.borderLight, color: T.textBody }}>Close</button>
        </div>
        <div className="p-4"><TemplateBoth template={open.template} tpl={tpls?.get(open.template)} vars={open.vars} /></div>
        <p className="text-[11px] px-4 pb-4" style={{ color: T.textMuted }}>As it lands on WhatsApp. The underlined name is each person&apos;s own first name. The button opens the page it leads to, without the batch&apos;s tracking, so opening it here never counts as a click.</p>
      </div>
    </div>,
    document.body,
  );
}
