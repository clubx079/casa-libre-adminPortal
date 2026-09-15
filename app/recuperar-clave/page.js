'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {}
    // Always show the same neutral confirmation — never reveal if the email exists.
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-7">
          <div className="text-[28px] font-bold tracking-head">
            Casa Libre <em className="font-serif italic font-normal">Admin</em>
          </div>
          <p className="mt-1 text-[12px] font-mono tracking-label uppercase text-ink/45">Password recovery</p>
        </div>

        <div className="bg-card border border-ink/12 rounded-card p-6 shadow-hard-soft">
          {sent ? (
            <>
              <h1 className="text-[19px] font-bold tracking-head mb-1">Check your email</h1>
              <p className="text-[13px] text-ink/60 leading-relaxed">
                If that email belongs to an admin account, we&apos;ve sent a link to reset your password. The link expires in 1 hour.
              </p>
              <Link
                href="/login"
                className="block text-center w-full mt-5 px-4 py-3 rounded-pill bg-ink text-paper text-[14px] font-semibold shadow-hard-soft"
              >
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={onSubmit}>
              <h1 className="text-[19px] font-bold tracking-head mb-1">Forgot your password?</h1>
              <p className="text-[13px] text-ink/55 mb-5">Enter your admin email and we&apos;ll send you a reset link.</p>

              <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                className="w-full mb-1 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors"
                placeholder="you@airosofts.com"
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-5 px-4 py-3 rounded-pill bg-ink text-paper text-[14px] font-semibold shadow-hard-soft disabled:opacity-50 transition-opacity"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <div className="mt-4 text-center">
                <Link href="/login" className="text-[12px] text-ink/55 hover:text-ink underline underline-offset-2">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>

        <p className="text-center mt-5 text-[11px] font-mono text-ink/35">Casa Libre · authorized access only</p>
      </div>
    </div>
  );
}
