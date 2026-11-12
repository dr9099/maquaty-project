'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logoutAdmin } from '@/lib/api';

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await logoutAdmin();
    setLoading(false);
    router.replace('/login');
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="rounded-full border border-brand-900/20 px-3 py-1.5 text-xs font-bold text-brand-800 transition hover:bg-brand-50 disabled:opacity-50"
    >
      {loading ? 'جارٍ الخروج...' : 'خروج'}
    </button>
  );
}

