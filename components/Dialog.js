'use client';
// The admin's own confirm / prompt dialogs, in place of the browser's window.confirm() and
// window.prompt() — same look as the Users page "Delete user" dialog.
//   const { dialog, confirm, prompt } = useDialog();
//   if (!(await confirm({ title, message, confirmLabel, tone: 'danger' }))) return;
//   const note = await prompt({ title, message, placeholder, maxLength });   // null = cancelled
//   …and render {dialog} once in the page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { T, CARD } from '@/components/automations/ui';

export function useDialog() {
  const [state, setState] = useState(null);   // { kind, title, message, …, resolve }
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const okRef = useRef(null);

  const open = useCallback((kind, opts = {}) => new Promise((resolve) => {
    setValue(opts.defaultValue || '');
    setState({ kind, ...opts, resolve });
  }), []);
  const confirm = useCallback((opts) => open('confirm', opts), [open]);
  const prompt = useCallback((opts) => open('prompt', opts), [open]);

  const close = (result) => { state?.resolve(result); setState(null); };
  const cancel = () => close(state?.kind === 'prompt' ? null : false);
  const ok = () => {
    if (state?.kind === 'prompt') {
      const v = value.trim();
      if (state.required && !v) return;
      close(v);
    } else close(true);
  };

  useEffect(() => {
    if (!state) return undefined;
    const t = setTimeout(() => (state.kind === 'prompt' ? inputRef.current : okRef.current)?.focus(), 30);
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const tone = state?.tone === 'danger' ? T.danger : T.textPrimary;
  const dialog = state ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(17,17,17,0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
      onClick={cancel} role="dialog" aria-modal="true" aria-labelledby="cl-dialog-title" data-testid="cl-dialog">
      <div className="w-full max-w-md bg-white p-6" style={{ ...CARD, boxShadow: '0 24px 60px rgba(17,17,17,0.28)' }} onClick={(e) => e.stopPropagation()}>
        <h3 id="cl-dialog-title" className="text-[16px] font-bold tracking-head" style={{ color: T.textPrimary }}>{state.title}</h3>
        {state.message ? <div className="text-[13px] mt-1.5 leading-relaxed whitespace-pre-line" style={{ color: T.textSecondary }}>{state.message}</div> : null}
        {state.kind === 'prompt' && (
          <div className="mt-4">
            <input ref={inputRef} value={value} onChange={(e) => setValue(state.maxLength ? e.target.value.slice(0, state.maxLength) : e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} placeholder={state.placeholder || ''}
              className="w-full px-3 py-2.5 rounded-[10px] text-[14px] outline-none focus:border-ink/60"
              style={{ border: `1px solid ${T.borderLight}`, color: T.textPrimary }} data-testid="cl-dialog-input" />
            {state.maxLength ? <p className="text-[11px] mt-1 text-right tabular-nums" style={{ color: T.textMuted }}>{value.length}/{state.maxLength}</p> : null}
          </div>
        )}
        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={cancel} className="text-[13px] font-medium px-4 py-2 rounded-full border transition-colors"
            style={{ borderColor: T.borderLight, background: T.bgWhite, color: T.textBody }}>{state.cancelLabel || 'Cancel'}</button>
          <button ref={okRef} type="button" onClick={ok} disabled={state.kind === 'prompt' && state.required && !value.trim()}
            className="text-[13px] font-semibold px-4 py-2 rounded-full transition-colors disabled:opacity-50"
            style={{ background: tone, color: '#FFFFFF' }} data-testid="cl-dialog-ok">{state.confirmLabel || 'OK'}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { dialog, confirm, prompt };
}
