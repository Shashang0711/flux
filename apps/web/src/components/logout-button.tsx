'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Icon } from './icons';

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button type="button" className={className} onClick={logout} disabled={pending}>
      <Icon name="logout" size={16} />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
