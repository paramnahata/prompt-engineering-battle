'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const logout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
    } finally {
      router.replace('/');
      router.refresh();
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={logout} disabled={loading}
      className={className || 'rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50'}>
      {loading ? 'Signing out…' : 'Log out'}
    </button>
  );
}
