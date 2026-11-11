'use client';

import { useState } from 'react';
import { PAGES, PAGE_GROUPS, ROLE_PRESETS, PRESET_KEYS, normalizeAccess, allowedPages, accessLabel, pageLabel } from '@/lib/adminPages';

const ERR = {
  invalid_email: 'Enter a valid email address.',
  email_exists: 'An admin with that email already exists.',
  no_countries: 'Pick at least one country for an Admin.',
  last_superadmin: 'You cannot remove or demote the last Super Admin.',
  weak_password: 'Password must be at least 8 characters.',
  wrong_current: 'Your current password is incorrect.',
  env_account: 'This account is managed via environment config and cannot be changed here.',
  forbidden: 'You do not have permission to do that.',
  unauthorized: 'Your session expired. Please sign in again.',
  migration_needed: 'Page access needs one database update before a role can be saved: run migrations/control/001_admin_page_access.sql in the control DB (AiroBase SQL editor). Full access still works.',
};
const msg = (e) => ERR[e] || 'Something went wrong. Try again.';

function RoleBadge({ role }) {
  const isSuper = role === 'superadmin';
  return (
    <span
      className={`inline-block text-[10px] font-mono uppercase tracking-label px-2 py-0.5 rounded ${
        isSuper ? 'bg-ink text-paper' : 'bg-ink/8 text-ink/70'
      }`}
    >
      {isSuper ? 'Super Admin' : 'Admin'}
    </span>
  );
}

function AccessChip({ role, access }) {
  if (role === 'superadmin') return <span className="text-[12px] text-ink/55">Every page</span>;
  const a = normalizeAccess(access);
  const pages = allowedPages(a);
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className={`self-start text-[10px] font-mono uppercase tracking-label px-2 py-0.5 rounded ${a ? 'bg-[#EEF3FB] text-[#1F4E8C]' : 'bg-ink/8 text-ink/70'}`}>{accessLabel(a)}</span>
      {pages ? <span className="text-[11px] text-ink/45 truncate" title={pages.map(pageLabel).join(', ')}>{pages.length ? pages.map(pageLabel).join(', ') : 'Account page only'}</span> : null}
    </span>
  );
}

// ---- Page access: ready-made roles or pages picked one by one -----------------------------------
// Two tabs. A ready-made role keeps its pages in code (lib/adminPages.js), so editing a preset there
// updates everyone who has it; "Custom pages" stores the exact list.
function AccessPicker({ value, onChange }) {
  const a = normalizeAccess(value);
  const [tab, setTab] = useState(a?.preset === 'custom' ? 'custom' : 'roles');
  const presetKey = !a ? 'full' : a.preset;
  const picked = new Set(allowedPages(a) || PAGES.map((p) => p.key));

  function pickPreset(key) { onChange(key === 'full' ? null : { preset: key }); }
  function toggle(key) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange({ preset: 'custom', pages: [...next] });
  }
  function setAll(on) { onChange({ preset: 'custom', pages: on ? PAGES.map((p) => p.key) : [] }); }
  function openCustom() {
    setTab('custom');
    // start from what the chosen role already gives, so "Custom pages" is an edit of it
    onChange({ preset: 'custom', pages: [...picked] });
  }

  const tabBtn = (id, label, onClick) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={onClick} data-testid={`tab-${id}`}
      className={`flex-1 px-3 py-2 text-[12.5px] font-semibold rounded-[8px] transition-colors ${tab === id ? 'bg-card text-ink shadow-hard-soft' : 'text-ink/55 hover:text-ink'}`}>
      {label}
    </button>
  );

  return (
    <div className="mb-4" data-testid="access-picker">
      <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Page access</label>
      <div role="tablist" className="flex gap-1 p-1 rounded-input bg-ink/[0.06] mb-3">
        {tabBtn('roles', 'Ready-made roles', () => setTab('roles'))}
        {tabBtn('custom', 'Custom pages', openCustom)}
      </div>

      {tab === 'roles' ? (
        <div className="flex flex-col gap-2">
          {PRESET_KEYS.map((key) => {
            const p = ROLE_PRESETS[key];
            const on = presetKey === key;
            return (
              <button type="button" key={key} onClick={() => pickPreset(key)} data-testid={`preset-${key}`} aria-pressed={on}
                className={`text-left px-3.5 py-3 rounded-input border transition-colors ${on ? 'border-ink bg-ink/[0.04]' : 'border-ink/15 hover:bg-ink/[0.03]'}`}>
                <span className="flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'border-ink' : 'border-ink/30'}`}>
                    {on && <span className="w-2 h-2 rounded-full bg-ink" />}
                  </span>
                  <span className="text-[13.5px] font-semibold">{p.label}</span>
                </span>
                <span className="block text-[12px] text-ink/55 mt-1 ml-6">{p.description}</span>
                <span className="flex flex-wrap gap-1 mt-2 ml-6">
                  {p.pages
                    ? p.pages.map((k) => <span key={k} className="text-[10.5px] px-1.5 py-0.5 rounded bg-ink/8 text-ink/70">{pageLabel(k)}</span>)
                    : <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-ink/8 text-ink/70">Every page</span>}
                </span>
              </button>
            );
          })}
          {presetKey === 'custom' && (
            <p className="text-[12px] text-ink/55 bg-ink/5 border border-ink/10 rounded-input p-3">
              This member has a custom set of {picked.size} {picked.size === 1 ? 'page' : 'pages'}. Pick a role above to replace it, or open <strong>Custom pages</strong> to edit it.
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-ink/55">{picked.size} of {PAGES.length} pages</span>
            <span className="flex gap-3 text-[12px]">
              <button type="button" className="text-ink/60 hover:text-ink underline" onClick={() => setAll(true)}>Select all</button>
              <button type="button" className="text-ink/60 hover:text-ink underline" onClick={() => setAll(false)}>Clear</button>
            </span>
          </div>
          <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto cl-scroll pr-1">
            {PAGE_GROUPS.map((g) => (
              <div key={g}>
                <p className="text-[10px] font-mono uppercase tracking-label text-ink/40 mb-1">{g}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {PAGES.filter((p) => p.group === g).map((p) => (
                    <label key={p.key} className={`flex items-center gap-2 px-2.5 py-2 rounded-input border text-[12.5px] cursor-pointer ${picked.has(p.key) ? 'border-ink/60 bg-ink/[0.04]' : 'border-ink/15'}`}>
                      <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)} className="accent-[#111]" data-testid={`page-${p.key}`} />
                      <span className="truncate">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-ink/50 mt-2">Their own Account page (password) is always available.</p>
        </div>
      )}
    </div>
  );
}

function CountryChips({ allowed, countries }) {
  if (allowed == null) return <span className="text-[12px] text-ink/55">All countries</span>;
  if (!allowed.length) return <span className="text-[12px] text-ink/40">None assigned</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {allowed.map((code) => {
        const c = countries.find((x) => x.code === code);
        return (
          <span key={code} className="text-[10px] font-mono uppercase tracking-label px-1.5 py-0.5 rounded bg-ink/8 text-ink/70">
            {c ? c.code : code}
          </span>
        );
      })}
    </span>
  );
}

// ---- Add / edit member modal ----------------------------------------------
function MemberModal({ mode, countries, initial, onClose, onSaved, pageAccessReady = true }) {
  const editing = mode === 'edit';
  const [email, setEmail] = useState(initial?.email || '');
  const [name, setName] = useState(initial?.name || '');
  const [role, setRole] = useState(initial?.role || 'admin');
  const [picked, setPicked] = useState(new Set(Array.isArray(initial?.allowed_countries) ? initial.allowed_countries : []));
  const [access, setAccess] = useState(normalizeAccess(initial?.page_access ?? null));
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [saving, setSaving] = useState(false);

  function toggle(code) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setInviteLink('');
    setSaving(true);
    const allowed_countries = role === 'admin' ? [...picked] : null;
    const page_access = role === 'admin' ? normalizeAccess(access) : null;
    if (page_access?.preset === 'custom' && page_access.pages.length === 0 && !confirm('No pages selected: this member will only see their Account page. Continue?')) {
      setSaving(false);
      return;
    }
    try {
      const res = editing
        ? await fetch(`/api/team/${initial.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, allowed_countries, page_access }),
          })
        : await fetch('/api/team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, role, allowed_countries, page_access }),
          });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(msg(j.error));
        setSaving(false);
        return;
      }
      if (!editing && j.email_sent === false && j.invite_link) {
        // RESEND not configured (e.g. local) — surface the link so the invite is testable.
        setInviteLink(j.invite_link);
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError('Network error. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[560px] bg-card border border-ink/12 rounded-card p-6 shadow-hard-soft max-h-[90vh] overflow-y-auto cl-scroll">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-bold tracking-head">{editing ? 'Edit member' : 'Add member'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-pill flex items-center justify-center text-ink/60 hover:bg-ink/5">×</button>
        </div>

        {inviteLink ? (
          <div>
            <p className="text-[13px] text-ink/70 mb-3">
              Member created, but the invite email couldn&apos;t be sent (email not configured). Share this link with them to activate their account:
            </p>
            <div className="text-[12px] font-mono break-all bg-ink/5 border border-ink/12 rounded-input p-3">{inviteLink}</div>
            <button onClick={onSaved} className="w-full mt-5 px-4 py-3 rounded-pill bg-ink text-paper text-[14px] font-semibold">Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              readOnly={editing} disabled={editing}
              className={`w-full mb-4 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors ${editing ? 'opacity-60' : ''}`}
              placeholder="person@airosofts.com"
            />

            <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Name</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full mb-4 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors"
              placeholder="Full name"
            />

            <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Role</label>
            <div className="flex gap-2 mb-4">
              {['admin', 'superadmin'].map((r) => (
                <button
                  type="button" key={r} onClick={() => setRole(r)}
                  className={`flex-1 px-3 py-2.5 rounded-input text-[13px] font-medium border transition-colors ${
                    role === r ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-ink/70 hover:bg-ink/5'
                  }`}
                >
                  {r === 'superadmin' ? 'Super Admin' : 'Admin'}
                </button>
              ))}
            </div>

            {role === 'superadmin' ? (
              <p className="text-[12px] text-ink/55 mb-4 bg-ink/5 border border-ink/10 rounded-input p-3">
                Super Admins have access to <strong>all countries and every page</strong> and can manage the team.
              </p>
            ) : (
              <>
                <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Countries</label>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {countries.map((c) => {
                    const on = picked.has(c.code);
                    return (
                      <button
                        type="button" key={c.code} onClick={() => toggle(c.code)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-input text-[13px] border text-left transition-colors ${
                          on ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-ink/70 hover:bg-ink/5'
                        }`}
                      >
                        <span className={`text-[10px] font-mono uppercase tracking-label px-1.5 py-0.5 rounded ${on ? 'bg-paper text-ink' : 'bg-ink/8 text-ink/70'}`}>{c.code}</span>
                        <span className="flex-1 truncate">{c.label}</span>
                      </button>
                    );
                  })}
                  {countries.length === 0 && <p className="text-[12px] text-ink/50 col-span-2">No countries in the registry.</p>}
                </div>
                <AccessPicker value={access} onChange={setAccess} />
                {!pageAccessReady && (
                  <p className="text-[12px] text-[#8A5A12] bg-[#FFF6E5] border border-[#F0D9A8] rounded-input p-3 mb-4">
                    {ERR.migration_needed}
                  </p>
                )}
              </>
            )}

            {error && <p className="mb-3 text-[12.5px] text-[#B0361F]">{error}</p>}

            <button type="submit" disabled={saving}
              className="w-full mt-1 px-4 py-3 rounded-pill bg-ink text-paper text-[14px] font-semibold shadow-hard-soft disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Send invitation'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---- Main client ----------------------------------------------------------
export default function TeamClient({ isSuper, me, initialAdmins, countries, canChangePassword, pageAccessReady = true }) {
  const [admins, setAdmins] = useState(initialAdmins || []);
  const [modal, setModal] = useState(null); // { mode, initial }
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    try {
      const res = await fetch('/api/team');
      if (res.ok) { const j = await res.json(); setAdmins(j.admins || []); }
    } catch {}
  }

  function afterSave() {
    setModal(null);
    setNotice('');
    refresh();
  }

  async function remove(a) {
    if (!confirm(`Remove ${a.name || a.email} from the team? This cannot be undone.`)) return;
    setBusyId(a.id);
    setNotice('');
    try {
      const res = await fetch(`/api/team/${a.id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setNotice(msg(j.error));
      else refresh();
    } catch {
      setNotice('Network error. Try again.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="max-w-[1080px]">
      <div className="mb-7">
        <h1 className="text-[24px] font-bold tracking-head">{isSuper ? 'Team' : 'Account'}</h1>
        <p className="text-[13px] text-ink/55 mt-1">
          {isSuper ? 'Manage who can access the admin portal, which countries they can see and which pages they can open.' : 'Manage your account.'}
        </p>
      </div>

      {isSuper && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold tracking-head">Members</h2>
            <button
              onClick={() => { setNotice(''); setModal({ mode: 'add', initial: null }); }}
              className="px-3.5 py-2 rounded-pill bg-ink text-paper text-[13px] font-semibold shadow-hard-soft"
            >
              + Add member
            </button>
          </div>

          {notice && <p className="mb-3 text-[12.5px] text-[#B0361F]">{notice}</p>}

          <div className="border border-ink/12 rounded-card overflow-hidden bg-card">
            <div className="hidden sm:grid grid-cols-[1.5fr_0.8fr_1.6fr_1fr_0.8fr_auto] gap-3 px-4 py-2.5 border-b border-ink/10 text-[10px] font-mono uppercase tracking-label text-ink/40">
              <span>Member</span><span>Role</span><span>Page access</span><span>Countries</span><span>Status</span><span></span>
            </div>
            {admins.length === 0 && <div className="px-4 py-6 text-[13px] text-ink/50">No members yet.</div>}
            {admins.map((a) => {
              const isMe = (me.id && a.id === me.id) || (!me.id && a.email === me.email);
              return (
                <div key={a.id} className="grid grid-cols-1 sm:grid-cols-[1.5fr_0.8fr_1.6fr_1fr_0.8fr_auto] gap-1.5 sm:gap-3 px-4 py-3 border-b border-ink/8 last:border-b-0 items-center">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">{a.name || '—'}{isMe && <span className="ml-1.5 text-[10px] font-mono text-ink/40">(you)</span>}</div>
                    <div className="text-[11.5px] text-ink/50 font-mono truncate">{a.email}</div>
                  </div>
                  <div><RoleBadge role={a.role} /></div>
                  <div className="min-w-0"><AccessChip role={a.role} access={a.page_access} /></div>
                  <div><CountryChips allowed={a.allowed_countries} countries={countries} /></div>
                  <div>
                    <span className={`text-[11px] font-medium ${a.is_active ? 'text-[#0F6E56]' : 'text-[#8A5A12]'}`}>
                      {a.is_active ? 'Active' : 'Pending invite'}
                    </span>
                  </div>
                  <div className="flex gap-1.5 sm:justify-end mt-1 sm:mt-0">
                    <button
                      onClick={() => { setNotice(''); setModal({ mode: 'edit', initial: a }); }}
                      className="px-2.5 py-1.5 rounded-input text-[12px] font-medium text-ink/70 border border-ink/15 hover:bg-ink/5"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(a)} disabled={busyId === a.id}
                      className="px-2.5 py-1.5 rounded-input text-[12px] font-medium text-[#B0361F] border border-[#B0361F]/25 hover:bg-[#B0361F]/5 disabled:opacity-50"
                    >
                      {busyId === a.id ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Account / change password — available to every admin */}
      <section>
        <h2 className="text-[15px] font-semibold tracking-head mb-3">Change password</h2>
        <ChangePassword canChange={canChangePassword} />
      </section>

      {modal && (
        <MemberModal
          mode={modal.mode}
          countries={countries}
          initial={modal.initial}
          pageAccessReady={pageAccessReady}
          onClose={() => setModal(null)}
          onSaved={afterSave}
        />
      )}
    </div>
  );
}

// ---- Change-password panel -------------------------------------------------
function ChangePassword({ canChange }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!canChange) {
    return (
      <div className="border border-ink/12 rounded-card bg-card p-5 max-w-[460px]">
        <p className="text-[13px] text-ink/60">
          You are signed in with the built-in emergency account, whose password is managed via environment configuration. Password changes here are disabled for this account.
        </p>
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk(false);
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('New passwords do not match.');
    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(msg(j.error));
      else { setOk(true); setCurrent(''); setNext(''); setConfirm(''); }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-ink/12 rounded-card bg-card p-5 max-w-[460px]">
      <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Current password</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required
        className="w-full mb-4 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors" />

      <label className="block text-[12px] font-medium text-ink/70 mb-1.5">New password</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required
        className="w-full mb-4 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors" placeholder="At least 8 characters" />

      <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Confirm new password</label>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required
        className="w-full mb-1 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors" />

      {error && <p className="mt-3 text-[12.5px] text-[#B0361F]">{error}</p>}
      {ok && <p className="mt-3 text-[12.5px] text-[#0F6E56]">Password updated.</p>}

      <button type="submit" disabled={saving}
        className="mt-5 px-4 py-2.5 rounded-pill bg-ink text-paper text-[14px] font-semibold shadow-hard-soft disabled:opacity-50">
        {saving ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
