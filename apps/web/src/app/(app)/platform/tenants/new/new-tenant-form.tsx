'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type TenantDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { ModuleCheckboxes } from '../module-checkboxes';

/** "Acme Labs Ltd" → "acme-labs-ltd" */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function NewTenantForm() {
  const router = useRouter();
  const { pending, error, fields, run } = useMutation();
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch<TenantDto>('/platform/tenants', {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            slug: data.get('slug'),
            modules: data.getAll('modules'),
            admin: {
              name: data.get('adminName'),
              email: data.get('adminEmail'),
              password: data.get('adminPassword'),
            },
          }),
        }),
      {
        onSuccess: ({ data: tenant }) => router.push(`/platform/tenants/${tenant.id}`),
        refresh: false,
      },
    );
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field label="Organisation name" htmlFor="name" error={fields.name}>
        <input
          className="input"
          id="name"
          name="name"
          required
          onChange={(e) => !slugEdited && setSlug(slugify(e.target.value))}
        />
      </Field>
      <Field
        label="Slug"
        htmlFor="slug"
        hint="Unique identifier: lower-case letters, digits and hyphens"
        error={fields.slug}
      >
        <input
          className="input"
          id="slug"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
        />
      </Field>
      <ModuleCheckboxes name="modules" selected={[]} />
      <h2 className="card-title" style={{ marginTop: 8 }}>
        First administrator
      </h2>
      <Field label="Name" htmlFor="adminName" error={fields['admin.name']}>
        <input className="input" id="adminName" name="adminName" required />
      </Field>
      <Field label="Email" htmlFor="adminEmail" error={fields['admin.email']}>
        <input className="input" id="adminEmail" name="adminEmail" type="email" required />
      </Field>
      <Field
        label="Temporary password"
        htmlFor="adminPassword"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. Share it securely; they can change it after signing in.`}
        error={fields['admin.password']}
      >
        <input
          className="input"
          id="adminPassword"
          name="adminPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <FormStatus error={error} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create tenant'}
        </button>
      </div>
    </form>
  );
}
