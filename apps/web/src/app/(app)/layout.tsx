import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { requireSession } from '@/lib/server-api';

/** Every signed-in page: validates the session with the API, then renders the shell. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return <AppShell session={session}>{children}</AppShell>;
}
