import type { Metadata } from 'next';
import type { CUSTOM_FIELD_ENTITIES, CustomFieldDefinitionDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { AddCustomField, CustomFieldList } from './custom-field-forms';

export const metadata: Metadata = { title: 'Custom fields · FLUX' };

type Entity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('custom-field.manage');
  if (!allowed) return <Forbidden />;

  const { data: entities } = await loadOrNotFound<Entity[]>('/custom-fields/entities');
  if (entities.length === 0) {
    return (
      <>
        <PageHeader title="Custom fields" />
        <p className="card muted">
          Your organisation has no record types that support custom fields yet.
        </p>
      </>
    );
  }
  const requested = readParams(await searchParams, ['entity'] as const).entity;
  const entity = entities.find((e) => e.key === requested) ?? entities[0]!;
  const { data: definitions } = await loadOrNotFound<CustomFieldDefinitionDto[]>(
    `/custom-fields?entity=${entity.key}&view=all`,
  );

  return (
    <>
      <PageHeader
        title="Custom fields"
        description="Add your own fields to records. They appear under “Additional information” on the record’s forms."
      />
      <ListTabs
        basePath="/admin/custom-fields"
        param="entity"
        active={entity.key}
        tabs={entities}
      />
      <div className="stack">
        <AddCustomField entity={entity.key} />
        <CustomFieldList definitions={definitions} />
        <p className="muted" style={{ margin: 0 }}>
          A field’s key and type can’t change after it is created, so existing values stay valid.
          Deactivate fields you no longer need; stored values are kept.
        </p>
      </div>
    </>
  );
}
