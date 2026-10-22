'use client';
// "Preview in English" under a user's message (Reports, Feedback). Users write in Spanish;
// this shows an English translation right below, without changing anything
// (/api/translate-preview — the same Groq translation as the website's listing
// "Translate" button). Tap again to hide it.
import { useState } from 'react';
import { Languages } from 'lucide-react';

export default function PreviewEnglish({ text }) {
  const [state, setState] = useState('idle'); // idle | loading | shown | hidden | error
  const [english, setEnglish] = useState('');
  if (!String(text || '').trim()) return null;

  const toggle = async () => {
    if (state === 'shown') { setState('hidden'); return; }
    if (english) { setState('shown'); return; }
    setState('loading');
    try {
      const r = await fetch('/api/translate-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const j = await r.json();
      if (!r.ok || !j.text) throw new Error(j.message || 'failed');
      setEnglish(j.text);
      setState('shown');
    } catch { setState('error'); }
  };

  return (
    <div className="mt-1.5">
      <button type="button" onClick={toggle} disabled={state === 'loading'} data-testid="preview-english"
        className="inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline disabled:opacity-60" style={{ color: '#2A5B8A' }}>
        <Languages className="w-3 h-3" />
        {state === 'loading' ? 'Translating…' : state === 'shown' ? 'Hide English' : 'Preview in English'}
      </button>
      {state === 'shown' && (
        <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap rounded-[8px] px-2.5 py-2" style={{ background: '#E1ECF5', color: '#3A3A37' }} data-testid="english-text">{english}</p>
      )}
      {state === 'error' && <p className="mt-1 text-[11px]" style={{ color: '#B23A3A' }}>Couldn’t translate right now. Try again in a moment.</p>}
    </div>
  );
}
