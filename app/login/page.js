'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace('/');
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error === 'invalid_credentials' ? 'Incorrect email or password.' : 'Something went wrong. Try again.');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-7">
          <div className="text-[28px] font-bold tracking-head">
            casa-libre<em className="font-serif not-italic italic font-normal">.py</em>
          </div>
          <p className="mt-1 text-[12px] font-mono tracking-label uppercase text-ink/45">Admin Portal</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-card border border-ink/12 rounded-card p-6 shadow-hard-soft"
        >
          <h1 className="text-[19px] font-bold tracking-head mb-1">Sign in</h1>
          <p className="text-[13px] text-ink/55 mb-5">Enter your admin credentials to continue.</p>

          <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="w-full mb-4 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors"
            placeholder="you@airosofts.com"
          />

          <label className="block text-[12px] font-medium text-ink/70 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full mb-1 px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors"
            placeholder="••••••••"
          />

          {error && <p className="mt-3 text-[12.5px] text-[#B0361F]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-5 px-4 py-3 rounded-pill bg-ink text-paper text-[14px] font-semibold shadow-hard-soft disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center mt-5 text-[11px] font-mono text-ink/35">Casa Libre · authorized access only</p>
      </div>
    </div>
  );
}
