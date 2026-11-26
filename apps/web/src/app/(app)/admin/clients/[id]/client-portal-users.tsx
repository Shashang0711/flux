'use client';

import type { FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type ClientDto, type PortalUserDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

function formatDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
}

function EditPortalUser({ client, user }: { client: ClientDto; user: PortalUserDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = `portal-user-${user.id}`;
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch(`/clients/${client.id}/portal-users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.get('name'),
            email: data.get('email'),
            status: data.get('active') === 'on' ? 'ACTIVE' : 'DISABLED',
          }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <EditDialog title={`Edit ${user.name}`}>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Name" htmlFor={`${prefix}-name`} error={fields.name}>
          <input className="input" id={`${prefix}-name`} name="name" defaultValue={user.name} />
        </Field>
        <Field label="Email" htmlFor={`${prefix}-email`} error={fields.email}>
          <input
            className="input"
            id={`${prefix}-email`}
            name="email"
            type="email"
            defaultValue={user.email}
          />
        </Field>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={user.status === 'ACTIVE'} /> Can sign
          in
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

function ResetPortalPassword({ client, user }: { client: ClientDto; user: PortalUserDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const id = `portal-user-${user.id}-password`;
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    await run(
      () =>
        apiFetch(`/clients/${client.id}/portal-users/${user.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ password }),
        }),
      {
        success: 'Password set. They have been signed out everywhere.',
        onSuccess: () => form.reset(),
      },
    );
  }
  return (
    <EditDialog title={`New password for ${user.name}`} label="Password">
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field
          label="New password"
          htmlFor={id}
          error={fields.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Share it with them securely.`}
        >
          <input className="input" id={id} name="password" type="password" autoComplete="off" />
        </Field>
        <FormStatus error={error} fields={fields} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Set password'}
          </button>
        </div>
      </form>
    </EditDialog>
  );
}

function AddPortalUser({ client }: { client: ClientDto }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await run(
      () =>
        apiFetch(`/clients/${client.id}/portal-users`, {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            email: data.get('email'),
            password: data.get('password'),
          }),
        }),
      { success: 'Portal user added.', onSuccess: () => form.reset() },
    );
  }
  return (
    <EditDialog title="Add a portal user" label="Add portal user">
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Name" htmlFor="new-portal-name" error={fields.name}>
          <input className="input" id="new-portal-name" name="name" />
        </Field>
        <Field label="Email" htmlFor="new-portal-email" error={fields.email}>
          <input className="input" id="new-portal-email" name="email" type="email" />
        </Field>
        <Field
          label="Password"
          htmlFor="new-portal-password"
          error={fields.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Share it with them securely.`}
        >
          <input
            className="input"
            id="new-portal-password"
            name="password"
            type="password"
            autoComplete="new-password"
          />
        </Field>
        <FormStatus error={error} fields={fields} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add portal user'}
          </button>
        </div>
      </form>
    </EditDialog>
  );
}

/** Client portal logins of this client: they see this client's samples and published reports. */
export function ClientPortalUsers({
  client,
  users,
  canManage,
}: {
  client: ClientDto;
  users: PortalUserDto[];
  canManage: boolean;
}) {
  return (
    <div className="stack">
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0, flex: '1 1 280px' }}>
            Portal users sign in to the client portal and see only {client.name}&apos;s samples and
            published reports.
          </p>
          {canManage && client.status === 'ACTIVE' && <AddPortalUser client={client} />}
        </div>
        {client.status !== 'ACTIVE' && (
          <p className="alert" style={{ margin: '12px 0 0' }}>
            This client is inactive: its portal users cannot sign in.
          </p>
        )}
      </section>
      <DataTable
        label="Portal users"
        rows={users}
        rowKey={(u) => u.id}
        empty="No portal users yet."
        columns={[
          {
            header: 'User',
            primary: true,
            cell: (u) => (
              <>
                {u.name}
                <span className="cell-sub">{u.email}</span>
              </>
            ),
          },
          { header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
          {
            header: 'Last sign-in',
            cell: (u) => <span className="muted">{formatDate(u.lastLoginAt)}</span>,
          },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (u: PortalUserDto) => (
                    <div className="row">
                      <EditPortalUser client={client} user={u} />
                      <ResetPortalPassword client={client} user={u} />
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
