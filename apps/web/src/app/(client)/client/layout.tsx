import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { requireSession } from '@/lib/server-api';

/** The client portal: client users only (staff are sent to their dashboard). */
export default async function ClientPortalLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  if (!session.client) redirect('/');
  return (
    <AppShell session={session}>
      {session.access.permissions.includes('client-portal.view') ? (
        children
      ) : (
        <div className="card" role="alert">
          <h1 className="card-title">The client portal is not available</h1>
          <p className="muted">
            Your laboratory has not enabled the client portal. Please contact them for your results.
          </p>
        </div>
      )}
    </AppShell>
  );
}
