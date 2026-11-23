import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/server-api';
import { ChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Account · FLUX' };

export default async function AccountPage() {
  const { user, tenant } = await requireSession();
  return (
    <>
      <PageHeader title="Account" description={`${user.name} · ${user.email}`} />
      <section className="card">
        <h2 className="card-title">Profile</h2>
        <dl className="grid-2" style={{ margin: 0 }}>
          <div>
            <dt className="muted">Organisation</dt>
            <dd style={{ margin: 0 }}>{tenant?.name ?? 'FLUX platform'}</dd>
          </div>
          <div>
            <dt className="muted">Roles</dt>
            <dd style={{ margin: 0 }}>
              {user.isPlatformAdmin
                ? 'Platform administrator'
                : user.roles.map((r) => r.name).join(', ') || 'None'}
            </dd>
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
