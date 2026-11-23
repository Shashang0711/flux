import type { Metadata } from 'next';
import type { RoleSummaryDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { NewUserForm } from './new-user-form';

export const metadata: Metadata = { title: 'New user · FLUX' };

export default async function NewUserPage() {
  const { allowed } = await sessionWithPermission('user.manage');
  if (!allowed) return <Forbidden />;
  const { data: roles } = await loadOrNotFound<RoleSummaryDto[]>('/roles?pageSize=100');
  return (
    <>
      <PageHeader title="New user" back={{ href: '/admin/users', label: 'Users' }} />
      <div className="card">
        <NewUserForm roles={roles} />
      </div>
    </>
  );
}
