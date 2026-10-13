'use client';

import { useState } from 'react';

export default function LogoutButton({ className = '', redirectTo = '/' }: { className?: string; redirectTo?: string }) {
  const [loading, setLoading] = useState(false);

  const logout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } catch {
      // The cookie is cleared server-side; even if the request failed we leave the page.
    } finally {
      // Full navigation so no protected page stays in the client router cache.
      window.location.replace(redirectTo);
    }
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loading}
      className={className || 'rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 disabled:opacity-50'}
    >
      {loading ? 'Signing out…' : 'Log out'}
    </button>
  );
}
