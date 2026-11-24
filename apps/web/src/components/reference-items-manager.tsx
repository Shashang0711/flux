'use client';

import { EditDialog } from '@/components/edit-dialog';
import type { FormEvent } from 'react';
import type { ReferenceItemDto } from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import styles from './reference-items-manager.module.css';

/**
 * Manages one reference list.
 * - tenant mode: hide/show FLUX defaults, add and edit the organisation's own items;
 * - platform mode: add and edit FLUX defaults.
 */
export function ReferenceItemsManager({
  mode,
  apiPath,
  itemName,
  items,
  canManage,
}: {
  mode: 'tenant' | 'platform';
  /** e.g. "/reference-data/vessel-type" or "/platform/reference-data/vessel-type" */
  apiPath: string;
  itemName: string;
  items: ReferenceItemDto[];
  canManage: boolean;
}) {
  return (
    <div className="stack">
      {canManage && <AddItemForm apiPath={apiPath} itemName={itemName} mode={mode} />}
      <DataTable
        label={`${itemName} list`}
        rows={items}
        rowKey={(i) => i.id}
        empty="No items yet."
        rowClassName={(i) => (i.hidden || !i.isActive ? styles.dimmed : undefined)}
        columns={[
          {
            header: 'Name',
            primary: true,
            cell: (i) => (
              <>
                {i.name}
                {i.description && <span className="cell-sub">{i.description}</span>}
              </>
            ),
          },
          { header: 'Code', cell: (i) => <code>{i.code}</code> },
          ...(mode === 'tenant'
            ? [
                {
                  header: 'Source',
                  cell: (i: ReferenceItemDto) =>
                    i.source === 'PLATFORM' ? (
                      <Badge tone="brand">FLUX default</Badge>
                    ) : (
                      <Badge>Your item</Badge>
                    ),
                },
              ]
            : []),
          { header: 'Status', cell: (i) => <StatusBadges item={i} /> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (i: ReferenceItemDto) => (
                    <ItemActions item={i} mode={mode} apiPath={apiPath} />
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

function StatusBadges({ item }: { item: ReferenceItemDto }) {
  if (item.hidden) return <Badge>Hidden</Badge>;
  return item.isActive ? <span className="badge badge-ok">Active</span> : <Badge>Inactive</Badge>;
}

/** Edit for own items (or any item on the platform); Hide/Show for FLUX defaults. */
function ItemActions({
  item,
  mode,
  apiPath,
}: {
  item: ReferenceItemDto;
  mode: 'tenant' | 'platform';
  apiPath: string;
}) {
  const toggleVisibility = useMutation();
  if (mode === 'platform' || item.source === 'TENANT')
    return <EditItem item={item} apiPath={apiPath} />;
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={toggleVisibility.pending}
        onClick={() =>
          toggleVisibility.run(() =>
            apiFetch(`${apiPath}/${item.id}/visibility`, {
              method: 'PUT',
              body: JSON.stringify({ hidden: !item.hidden }),
            }),
          )
        }
      >
        {item.hidden ? 'Show' : 'Hide'}
      </button>
      <FormStatus error={toggleVisibility.error} />
    </>
  );
}

function EditItem({ item, apiPath }: { item: ReferenceItemDto; apiPath: string }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const description = String(data.get('description') ?? '').trim();
    await run(
      () =>
        apiFetch(`${apiPath}/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.get('name'),
            code: data.get('code'),
            description: description || null,
            sortOrder: Number(data.get('sortOrder') || 0),
            isActive: data.get('isActive') === 'on',
          }),
        }),
      { success: 'Saved.' },
    );
  }
  const id = (field: string) => `${field}-${item.id}`;
  return (
    <EditDialog title={`Edit ${item.name}`}>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Name" htmlFor={id('name')} error={fields.name}>
          <input className="input" id={id('name')} name="name" defaultValue={item.name} required />
        </Field>
        <Field label="Code" htmlFor={id('code')} error={fields.code}>
          <input className="input" id={id('code')} name="code" defaultValue={item.code} required />
        </Field>
        <Field label="Description" htmlFor={id('description')} error={fields.description}>
          <input
            className="input"
            id={id('description')}
            name="description"
            defaultValue={item.description ?? ''}
          />
        </Field>
        <Field label="Sort order" htmlFor={id('sortOrder')} hint="Lower numbers are listed first">
          <input
            className="input"
            id={id('sortOrder')}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={item.sortOrder}
          />
        </Field>
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={item.isActive} /> Active
        </label>
        <FormStatus error={error} fields={fields} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </EditDialog>
  );
}

function AddItemForm({
  apiPath,
  itemName,
  mode,
}: {
  apiPath: string;
  itemName: string;
  mode: 'tenant' | 'platform';
}) {
  const { pending, error, fields, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const description = String(data.get('description') ?? '').trim();
    await run(
      () =>
        apiFetch(apiPath, {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            code: data.get('code'),
            description: description || null,
            sortOrder: Number(data.get('sortOrder') || 0),
          }),
        }),
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">
        {mode === 'platform' ? `Add a FLUX default ${itemName}` : `Add your own ${itemName}`}
      </h2>
      <form className={styles.addForm} onSubmit={onSubmit} noValidate>
        <Field label="Name" htmlFor="new-name" error={fields.name}>
          <input className="input" id="new-name" name="name" required />
        </Field>
        <Field
          label="Code"
          htmlFor="new-code"
          hint="Short and unique, e.g. RESEARCH"
          error={fields.code}
        >
          <input className="input" id="new-code" name="code" required />
        </Field>
        <Field label="Description" htmlFor="new-description" error={fields.description}>
          <input className="input" id="new-description" name="description" />
        </Field>
        <Field label="Sort order" htmlFor="new-sortOrder">
          <input
            className="input"
            id="new-sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={0}
          />
        </Field>
        <div className={styles.addActions}>
          <FormStatus error={error} fields={fields} />
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </section>
  );
}
