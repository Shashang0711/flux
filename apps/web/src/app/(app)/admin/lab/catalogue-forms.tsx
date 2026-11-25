'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { LabCategoryDto, ServiceTypeDto, StarterImportResultDto } from '@flux/shared';
import { ActiveBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

/** Code + name inputs shared by every lab record form. */
export function CodeNameFields({
  prefix,
  values,
  fields,
  codeHint = 'Short and unique, e.g. WATER',
  disabled,
}: {
  prefix: string;
  values?: { code: string; name: string };
  fields: Record<string, string>;
  codeHint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid-2">
      <Field label="Name" htmlFor={`${prefix}-name`} error={fields.name}>
        <input
          className="input"
          id={`${prefix}-name`}
          name="name"
          defaultValue={values?.name}
          disabled={disabled}
          required
        />
      </Field>
      <Field label="Code" htmlFor={`${prefix}-code`} hint={codeHint} error={fields.code}>
        <input
          className="input"
          id={`${prefix}-code`}
          name="code"
          defaultValue={values?.code}
          disabled={disabled}
          autoCapitalize="characters"
          style={{ textTransform: 'uppercase' }}
          required
        />
      </Field>
    </div>
  );
}

function SubmitButton({ pending, label = 'Save' }: { pending: boolean; label?: string }) {
  return (
    <div className="form-actions">
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}

// ─── Starter catalogue ──────────────────────────────────────────────────────

export function StarterImport() {
  const { pending, error, success, run } = useMutation();
  return (
    <section className="card">
      <h2 className="card-title">Start from the FLUX catalogue</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Adds example categories (Water, Lubricating Oil, Fuel), service types with registration
        fields, bottle types and kits such as the Ballast Water Kit with UV, Electrolysis and Ozone
        variants. Everything becomes yours to edit or deactivate.
      </p>
      <FormStatus error={error} success={success} />
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            run(
              () => apiFetch<StarterImportResultDto>('/lab/starter-catalogue', { method: 'POST' }),
              {
                success: 'Starter catalogue imported.',
              },
            )
          }
        >
          {pending ? 'Importing…' : 'Import starter catalogue'}
        </button>
      </div>
    </section>
  );
}

// ─── Categories ─────────────────────────────────────────────────────────────

function CategoryForm({ category }: { category?: LabCategoryDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = category ? `cat-${category.id}` : 'cat-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      code: text(data, 'code'),
      name: text(data, 'name'),
      description: text(data, 'description'),
      sortOrder: Number(data.get('sortOrder') || 0),
      ...(category ? { isActive: data.get('isActive') === 'on' } : {}),
    };
    await run(
      () =>
        apiFetch(category ? `/lab/categories/${category.id}` : '/lab/categories', {
          method: category ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        }),
      { success: category ? 'Saved.' : undefined, onSuccess: () => !category && form.reset() },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <CodeNameFields prefix={prefix} values={category} fields={fields} />
      <div className="grid-2">
        <Field label="Description" htmlFor={`${prefix}-description`} error={fields.description}>
          <input
            className="input"
            id={`${prefix}-description`}
            name="description"
            defaultValue={category?.description ?? ''}
          />
        </Field>
        <Field label="Sort order" htmlFor={`${prefix}-sort`} hint="Lower numbers are shown first">
          <input
            className="input"
            id={`${prefix}-sort`}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={category?.sortOrder ?? 0}
          />
        </Field>
      </div>
      {category && (
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={category.isActive} /> Active
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      <SubmitButton pending={pending} label={category ? 'Save' : 'Add category'} />
    </form>
  );
}

export function Categories({
  categories,
  canManage,
}: {
  categories: LabCategoryDto[];
  canManage: boolean;
}) {
  return (
    <div className="stack">
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add a category</h2>
          <CategoryForm />
        </section>
      )}
      <DataTable
        label="Categories"
        rows={categories}
        rowKey={(c) => c.id}
        empty="No categories yet."
        columns={[
          {
            header: 'Category',
            primary: true,
            cell: (c) => (
              <>
                {c.name}
                <span className="cell-sub">
                  <code>{c.code}</code>
                  {c.description ? ` · ${c.description}` : ''}
                </span>
              </>
            ),
          },
          { header: 'Service types', cell: (c) => c.serviceTypeCount },
          { header: 'Status', cell: (c) => <ActiveBadge active={c.isActive} /> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (c: LabCategoryDto) => (
                    <EditDialog title={`Edit ${c.name}`}>
                      <CategoryForm category={c} />
                    </EditDialog>
                  ),
                },
              ]
            : []),
        ]}
      />
      <p className="muted" style={{ margin: 0 }}>
        Deactivated categories keep their service types, but those are no longer offered for new
        registrations.
      </p>
    </div>
  );
}

// ─── Service type (create and General tab) ──────────────────────────────────

export function ServiceTypeForm({
  serviceType,
  categories,
  disabled,
}: {
  serviceType?: ServiceTypeDto;
  categories: LabCategoryDto[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      categoryId: text(data, 'categoryId'),
      code: text(data, 'code'),
      name: text(data, 'name'),
      description: text(data, 'description'),
      sortOrder: Number(data.get('sortOrder') || 0),
      ...(serviceType ? { isActive: data.get('isActive') === 'on' } : {}),
    };
    await run(
      () =>
        apiFetch<ServiceTypeDto>(
          serviceType ? `/lab/service-types/${serviceType.id}` : '/lab/service-types',
          { method: serviceType ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
        ),
      {
        success: serviceType ? 'Saved.' : undefined,
        onSuccess: (created) =>
          !serviceType && router.push(`/admin/lab/service-types/${created.data.id}?tab=fields`),
      },
    );
  }
  const options = categories.filter((c) => c.isActive || c.id === serviceType?.category.id);
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field label="Category" htmlFor="st-category" error={fields.categoryId}>
        <select
          className="select"
          id="st-category"
          name="categoryId"
          defaultValue={serviceType?.category.id ?? ''}
          disabled={disabled}
        >
          <option value="">Choose a category</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </Field>
      <CodeNameFields
        prefix="st"
        values={serviceType}
        fields={fields}
        codeHint="Short and unique, e.g. BW"
        disabled={disabled}
      />
      <Field label="Description" htmlFor="st-description" error={fields.description}>
        <textarea
          className="textarea"
          id="st-description"
          name="description"
          rows={2}
          defaultValue={serviceType?.description ?? ''}
          disabled={disabled}
        />
      </Field>
      <Field label="Sort order" htmlFor="st-sort" hint="Order within the category">
        <input
          className="input"
          id="st-sort"
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={serviceType?.sortOrder ?? 0}
          disabled={disabled}
          style={{ maxWidth: 160 }}
        />
      </Field>
      {serviceType && (
        <label className="check">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={serviceType.isActive}
            disabled={disabled}
          />{' '}
          Active (offered when registering samples)
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      {!disabled && (
        <SubmitButton pending={pending} label={serviceType ? 'Save' : 'Create service type'} />
      )}
    </form>
  );
}
