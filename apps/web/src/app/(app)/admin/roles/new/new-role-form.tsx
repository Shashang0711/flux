'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { RoleDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import type { AccessCatalogue } from '../catalogue';

export function NewRoleForm({ portals }: { portals: AccessCatalogue['portals'] }) {
  const router = useRouter();
  const { pending, error, fields, run } = useMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const description = String(data.get('description') ?? '').trim();
    await run(
      () =>
        apiFetch<RoleDto>('/roles', {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            description: description || null,
            defaultPortal: data.get('defaultPortal'),
          }),
        }),
      {
        onSuccess: ({ data: role }) => router.push(`/admin/roles/${role.id}?tab=modules`),
        refresh: false,
      },
    );
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field label="Role name" htmlFor="name" error={fields.name}>
        <input className="input" id="name" name="name" required />
      </Field>
      <Field label="Description" htmlFor="description" error={fields.description}>
        <textarea className="textarea" id="description" name="description" rows={2} />
      </Field>
      <Field
        label="Default portal"
        htmlFor="defaultPortal"
        hint="Where users with this role land after signing in"
        error={fields.defaultPortal}
      >
        <select className="select" id="defaultPortal" name="defaultPortal" defaultValue="ADMIN">
          {portals.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <FormStatus error={error} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create role'}
        </button>
      </div>
    </form>
  );
}
