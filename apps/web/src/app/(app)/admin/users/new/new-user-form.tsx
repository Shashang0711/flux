'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type RoleSummaryDto, type UserDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { RoleCheckboxes } from '../../role-checkboxes';

export function NewUserForm({ roles }: { roles: RoleSummaryDto[] }) {
  const router = useRouter();
  const { pending, error, fields, run } = useMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch<UserDto>('/users', {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            email: data.get('email'),
            password: data.get('password'),
            roleIds: data.getAll('roleIds'),
          }),
        }),
      { onSuccess: ({ data: user }) => router.push(`/admin/users/${user.id}`), refresh: false },
    );
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field label="Name" htmlFor="name" error={fields.name}>
        <input className="input" id="name" name="name" required />
      </Field>
      <Field label="Email" htmlFor="email" error={fields.email}>
        <input className="input" id="email" name="email" type="email" required />
      </Field>
      <Field
        label="Temporary password"
        htmlFor="password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. They can change it after signing in.`}
        error={fields.password}
      >
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <RoleCheckboxes roles={roles} selected={[]} />
      <FormStatus error={error} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}
