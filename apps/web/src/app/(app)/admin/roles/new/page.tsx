import type { Metadata } from 'next';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import type { AccessCatalogue } from '../catalogue';
import { NewRoleForm } from './new-role-form';

export const metadata: Metadata = { title: 'New role · FLUX' };

export default async function NewRolePage() {
  const { allowed } = await sessionWithPermission('role.manage');
  if (!allowed) return <Forbidden />;
  const { data: catalogue } = await loadOrNotFound<AccessCatalogue>('/access/catalogue');
  return (
    <>
      <PageHeader
        title="New role"
        description="Create the role, then choose its portals, modules and permissions."
        back={{ href: '/admin/roles', label: 'Roles' }}
      />
      <div className="card">
        <NewRoleForm portals={catalogue.portals} />
      </div>
    </>
  );
}
