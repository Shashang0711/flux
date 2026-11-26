import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { requireSession } from '@/lib/server-api';

/**
 * Every signed-in staff page: validates the session with the API, then renders the shell.
 * Client portal users have their own section (/client); the API refuses them staff routes.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (session.client) redirect('/client');
  return <AppShell session={session}>{children}</AppShell>;
}
