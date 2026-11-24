'use client';

import { useRef, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type RoleSummaryDto, type UserDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { RoleCheckboxes } from '../../role-checkboxes';

export function UserDetailsForm({ user, disabled }: { user: UserDto; disabled: boolean }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch(`/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: data.get('name'), email: data.get('email') }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Details</h2>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Name" htmlFor="name" error={fields.name}>
          <input
            className="input"
            id="name"
            name="name"
            defaultValue={user.name}
            disabled={disabled}
            required
          />
        </Field>
        <Field label="Email" htmlFor="email" error={fields.email}>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            defaultValue={user.email}
            disabled={disabled}
            required
          />
        </Field>
        <FormStatus error={error} success={success} />
        {!disabled && (
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

export function UserRolesForm({
  user,
  roles,
  disabled,
}: {
  user: UserDto;
  roles: RoleSummaryDto[];
  disabled: boolean;
}) {
  const { pending, error, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roleIds = new FormData(event.currentTarget).getAll('roleIds');
    await run(
      () =>
        apiFetch(`/users/${user.id}/roles`, { method: 'PUT', body: JSON.stringify({ roleIds }) }),
      { success: 'Roles updated. Access changes apply immediately.' },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Roles</h2>
      {roles.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {user.roles.map((r) => r.name).join(', ') || 'No roles assigned.'}
        </p>
      ) : (
        <form className="form" onSubmit={onSubmit}>
          <RoleCheckboxes
            roles={roles}
            selected={user.roles.map((r) => r.id)}
            disabled={disabled}
          />
          <FormStatus error={error} success={success} />
          {!disabled && (
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save roles'}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

export function UserStatusCard({ user }: { user: UserDto }) {
  const { pending, error, run } = useMutation();
  const disabled = user.status === 'DISABLED';
  async function toggle() {
    if (
      !disabled &&
      !window.confirm(`Disable ${user.name}? They will be signed out immediately.`)
    ) {
      return;
    }
    await run(() =>
      apiFetch(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: disabled ? 'ACTIVE' : 'DISABLED' }),
      }),
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Access</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {disabled
          ? 'This user is disabled and cannot sign in.'
          : 'Disabling signs the user out everywhere and blocks sign-in.'}
      </p>
      <FormStatus error={error} />
      <button
        type="button"
        className={`btn ${disabled ? 'btn-primary' : 'btn-danger'}`}
        onClick={toggle}
        disabled={pending}
      >
        {disabled ? 'Enable user' : 'Disable user'}
      </button>
    </section>
  );
}

export function ResetPasswordForm({ user }: { user: UserDto }) {
  const form = useRef<HTMLFormElement>(null);
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    await run(
      () =>
        apiFetch<void>(`/users/${user.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ password }),
        }),
      {
        success: 'Password set. The user has been signed out everywhere.',
        onSuccess: () => form.current?.reset(),
        refresh: false,
      },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Reset password</h2>
      <form ref={form} className="form" onSubmit={onSubmit} noValidate>
        <Field
          label="New temporary password"
          htmlFor="reset-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          error={fields.password}
        >
          <input
            className="input"
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>
        <FormStatus error={error} fields={fields} success={success} />
        <div className="form-actions">
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Set password'}
          </button>
        </div>
      </form>
    </section>
  );
}
