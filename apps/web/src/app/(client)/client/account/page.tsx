import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/app/(app)/account/change-password-form';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Account · FLUX' };

export default async function ClientAccountPage() {
  const { user, tenant, client } = await requireSession();
  return (
    <>
      <PageHeader title="Account" description={`${user.name} · ${user.email}`} />
      <section className="card">
        <h2 className="card-title">Profile</h2>
        <dl className="grid-2" style={{ margin: 0 }}>
          <div>
            <dt className="muted">Company</dt>
            <dd style={{ margin: 0 }}>{client?.name}</dd>
          </div>
          <div>
            <dt className="muted">Laboratory</dt>
            <dd style={{ margin: 0 }}>{tenant?.name}</dd>
          </div>
        </dl>
      </section>
      <section className="card">
        <h2 className="card-title">Change password</h2>
        <ChangePasswordForm />
      </section>
    </>
  );
}
