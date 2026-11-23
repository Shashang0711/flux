import type { Metadata } from 'next';
import Link from 'next/link';
import type { AuditLogDto, RoleDto, RoleUserDto, UserDto } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { ActiveBadge, Badge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import type { AccessCatalogue } from '../catalogue';
import {
  AssignedUsers,
  CloneRoleButton,
  GeneralForm,
  ModulesForm,
  PermissionsForm,
  PortalsForm,
} from './role-forms';
import styles from './tabs.module.css';

export const metadata: Metadata = { title: 'Role · FLUX' };

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'portals', label: 'Portal Access' },
  { key: 'modules', label: 'Module Access' },
  { key: 'permissions', label: 'Role Permissions' },
  { key: 'users', label: 'Assigned Users' },
  { key: 'audit', label: 'Audit', permission: 'audit.view' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('role.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const permissions = session.access.permissions;
  const tabs = TABS.filter((t) => !('permission' in t) || permissions.includes(t.permission));
  const requested = readParams(await searchParams, ['tab'] as const).tab;
  const tab: TabKey = tabs.some((t) => t.key === requested) ? (requested as TabKey) : 'general';

  const canManage = permissions.includes('role.manage');
  const canAssign = permissions.includes('user.manage');

  const { data: role } = await loadOrNotFound<RoleDto>(`/roles/${id}`);
  const { data: catalogue } = await loadOrNotFound<AccessCatalogue>('/access/catalogue');
  const editable = canManage && !role.isSystem;

  const history =
    tab === 'audit'
      ? (await loadOrNotFound<AuditLogDto[]>(`/audit-logs?entityId=${id}&pageSize=50`)).data
      : [];
  let assigned: RoleUserDto[] = [];
  let allUsers: UserDto[] = [];
  if (tab === 'users') {
    assigned = (await loadOrNotFound<RoleUserDto[]>(`/roles/${id}/users`)).data;
    if (canAssign)
      allUsers = (await loadOrNotFound<UserDto[]>('/users?pageSize=100&status=ACTIVE')).data;
  }

  return (
    <>
      <PageHeader
        title={role.name}
        description={
          <span className="row">
            {role.isSystem && <Badge tone="brand">Built-in</Badge>}
            <ActiveBadge active={role.isActive} />
            <span>
              {role.userCount} {role.userCount === 1 ? 'user' : 'users'}
            </span>
          </span>
        }
        back={{ href: '/admin/roles', label: 'Roles' }}
        actions={canManage && <CloneRoleButton role={role} />}
      />
      {role.isSystem && (
        <p className="alert" style={{ marginBottom: 16 }}>
          The Administrator role always has full access to every module your organisation is
          licensed for. It cannot be changed, but you can clone it to make an editable copy.
        </p>
      )}
      <nav className={styles.tabs} aria-label="Role sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/roles/${id}?tab=${t.key}`}
            className={`${styles.tab} ${t.key === tab ? styles.tabActive : ''}`}
            aria-current={t.key === tab ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <section className="card">
        {tab === 'general' && <GeneralForm role={role} disabled={!editable} />}
        {tab === 'portals' && (
          <PortalsForm role={role} catalogue={catalogue} disabled={!editable} />
        )}
        {tab === 'modules' && (
          <ModulesForm role={role} catalogue={catalogue} disabled={!editable} />
        )}
        {tab === 'permissions' && (
          <PermissionsForm role={role} catalogue={catalogue} disabled={!editable} />
        )}
        {tab === 'users' && (
          <AssignedUsers
            role={role}
            assigned={assigned}
            allUsers={allUsers}
            canAssign={canAssign}
          />
        )}
        {tab === 'audit' && <AuditTable entries={history} />}
      </section>
    </>
  );
}
