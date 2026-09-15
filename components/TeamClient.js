'use client';

import { useState } from 'react';

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
function MemberModal({ mode, countries, initial, onClose, onSaved }) {
  const editing = mode === 'edit';
  const [email, setEmail] = useState(initial?.email || '');
  const [name, setName] = useState(initial?.name || '');
  const [role, setRole] = useState(initial?.role || 'admin');
  const [picked, setPicked] = useState(new Set(Array.isArray(initial?.allowed_countries) ? initial.allowed_countries : []));
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
    try {
      const res = editing
        ? await fetch(`/api/team/${initial.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, allowed_countries }),
          })
        : await fetch('/api/team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, role, allowed_countries }),
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
      <div className="relative w-full max-w-[440px] bg-card border border-ink/12 rounded-card p-6 shadow-hard-soft max-h-[90vh] overflow-y-auto cl-scroll">
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
                Super Admins have access to <strong>all countries</strong> and can manage the team.
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
export default function TeamClient({ isSuper, me, initialAdmins, countries, canChangePassword }) {
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
    <div className="max-w-[900px]">
      <div className="mb-7">
        <h1 className="text-[24px] font-bold tracking-head">{isSuper ? 'Team' : 'Account'}</h1>
        <p className="text-[13px] text-ink/55 mt-1">
          {isSuper ? 'Manage who can access the admin portal and which countries they can see.' : 'Manage your account.'}
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
            <div className="hidden sm:grid grid-cols-[1.6fr_0.9fr_1.3fr_0.8fr_auto] gap-3 px-4 py-2.5 border-b border-ink/10 text-[10px] font-mono uppercase tracking-label text-ink/40">
              <span>Member</span><span>Role</span><span>Countries</span><span>Status</span><span></span>
            </div>
            {admins.length === 0 && <div className="px-4 py-6 text-[13px] text-ink/50">No members yet.</div>}
            {admins.map((a) => {
              const isMe = (me.id && a.id === me.id) || (!me.id && a.email === me.email);
              return (
                <div key={a.id} className="grid grid-cols-1 sm:grid-cols-[1.6fr_0.9fr_1.3fr_0.8fr_auto] gap-1.5 sm:gap-3 px-4 py-3 border-b border-ink/8 last:border-b-0 items-center">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold truncate">{a.name || '—'}{isMe && <span className="ml-1.5 text-[10px] font-mono text-ink/40">(you)</span>}</div>
                    <div className="text-[11.5px] text-ink/50 font-mono truncate">{a.email}</div>
                  </div>
                  <div><RoleBadge role={a.role} /></div>
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
