import type { Metadata } from 'next';
import type { RoleSummaryDto, UserDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ResetPasswordForm, UserDetailsForm, UserRolesForm, UserStatusCard } from './user-forms';

export const metadata: Metadata = { title: 'User · FLUX' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, allowed } = await sessionWithPermission('user.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const canManage = session.access.permissions.includes('user.manage');
  const isSelf = session.user.id === id;

  const { data: user } = await loadOrNotFound<UserDto>(`/users/${id}`);
  const roles = session.access.permissions.includes('role.view')
    ? (await loadOrNotFound<RoleSummaryDto[]>('/roles?pageSize=100')).data
    : [];

  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <>
            {user.email} · <StatusBadge status={user.status} />
          </>
        }
        back={{ href: '/admin/users', label: 'Users' }}
      />
      {!canManage && (
        <p className="alert" style={{ marginBottom: 16 }}>
          You can view this user but not change them.
        </p>
      )}
      <UserDetailsForm user={user} disabled={!canManage} />
      <UserRolesForm user={user} roles={roles} disabled={!canManage} />
      {canManage && !isSelf && <UserStatusCard user={user} />}
      {canManage && !isSelf && <ResetPasswordForm user={user} />}
    </>
  );
}
