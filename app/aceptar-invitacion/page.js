'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function AcceptInner() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    if (pw !== pw2) return setError('Passwords do not match.');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pw }),
      });
      if (res.ok) {
        // Account activated + logged in → straight to the dashboard.
        router.replace('/');
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error === 'invalid_or_expired' ? 'This invitation is invalid or has expired. Ask a Super Admin to re-invite you.' : 'Something went wrong. Try again.');
        setLoading(false);
      }
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  if (!token) {
    return <p className="text-[13px] text-ink/60">Missing invitation token. Please use the link from your invitation email.</p>;
  }

  return (
    <form onSubmit={onSubmit}>
      <h1 className="text-[19px] font-bold tracking-head mb-1">Set your password</h1>
      <p className="text-[13px] text-ink/55 mb-5">Welcome to Casa Libre Admin. Choose a password to activate your account.</p>

      <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Password</label>
      <input
        type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required
        className="w-full mb-4 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors"
        placeholder="At least 8 characters"
      />
      <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Confirm password</label>
      <input
        type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required
        className="w-full mb-1 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors"
        placeholder="Repeat password"
      />

      {error && <p className="mt-3 text-[12.5px] text-[#B0361F]">{error}</p>}

      <button type="submit" disabled={loading}
        className="w-full mt-5 px-4 py-3 rounded-pill bg-ink text-paper text-[14px] font-semibold shadow-hard-soft disabled:opacity-50 transition-opacity">
        {loading ? 'Activating…' : 'Activate account'}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-7">
          <div className="text-[28px] font-bold tracking-head">
            Casa Libre <em className="font-serif italic font-normal">Admin</em>
          </div>
          <p className="mt-1 text-[12px] font-mono tracking-label uppercase text-ink/45">Accept invitation</p>
        </div>
        <div className="bg-card border border-ink/12 rounded-card p-6 shadow-hard-soft">
          <Suspense fallback={<p className="text-[13px] text-ink/50">Loading…</p>}>
            <AcceptInner />
          </Suspense>
        </div>
        <p className="text-center mt-5 text-[11px] font-mono text-ink/35">
          Already activated? <Link href="/login" className="underline underline-offset-2">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
