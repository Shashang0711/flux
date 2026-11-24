'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import type { RoleDto, RoleUserDto, UserDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import type { AccessCatalogue } from '../catalogue';
import styles from './tabs.module.css';

function SaveButton({ pending, label = 'Save' }: { pending: boolean; label?: string }) {
  return (
    <div className="form-actions">
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}

export function GeneralForm({ role, disabled }: { role: RoleDto; disabled: boolean }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const description = String(data.get('description') ?? '').trim();
    await run(
      () =>
        apiFetch(`/roles/${role.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.get('name'),
            description: description || null,
            defaultPortal: data.get('defaultPortal'),
            isActive: data.get('isActive') === 'on',
          }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field label="Role name" htmlFor="name" error={fields.name}>
        <input
          className="input"
          id="name"
          name="name"
          defaultValue={role.name}
          disabled={disabled}
          required
        />
      </Field>
      <Field label="Description" htmlFor="description" error={fields.description}>
        <textarea
          className="textarea"
          id="description"
          name="description"
          rows={2}
          defaultValue={role.description ?? ''}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Default portal"
        htmlFor="defaultPortal"
        hint="Must be one of the role’s portals (Portal Access tab)"
        error={fields.defaultPortal}
      >
        <select
          className="select"
          id="defaultPortal"
          name="defaultPortal"
          defaultValue={role.defaultPortal}
          disabled={disabled}
        >
          {role.portals.map((key) => (
            <option key={key} value={key}>
              {key.charAt(0) + key.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" name="isActive" defaultChecked={role.isActive} disabled={disabled} />
        <span>
          Active
          <br />
          <span className="muted">An inactive role grants nothing to its users.</span>
        </span>
      </label>
      <FormStatus error={error} success={success} />
      {!disabled && <SaveButton pending={pending} />}
    </form>
  );
}

function useListSave(role: RoleDto, path: 'portals' | 'modules' | 'permissions', success: string) {
  const mutation = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget).getAll(path);
    await mutation.run(
      () =>
        apiFetch(`/roles/${role.id}/${path}`, {
          method: 'PUT',
          body: JSON.stringify({ [path]: values }),
        }),
      { success },
    );
  }
  return { ...mutation, onSubmit };
}

export function PortalsForm({
  role,
  catalogue,
  disabled,
}: {
  role: RoleDto;
  catalogue: AccessCatalogue;
  disabled: boolean;
}) {
  const { pending, error, success, onSubmit } = useListSave(
    role,
    'portals',
    'Portal access saved.',
  );
  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="muted" style={{ margin: 0 }}>
        Portals this role can enter.
      </p>
      {catalogue.portals.map((portal) => (
        <label key={portal.key} className="check">
          <input
            type="checkbox"
            name="portals"
            value={portal.key}
            defaultChecked={role.portals.includes(portal.key)}
            disabled={disabled}
          />
          <span>
            {portal.name}
            {portal.key === role.defaultPortal && <span className="muted"> (default)</span>}
          </span>
        </label>
      ))}
      <FormStatus error={error} success={success} />
      {!disabled && <SaveButton pending={pending} />}
    </form>
  );
}

export function ModulesForm({
  role,
  catalogue,
  disabled,
}: {
  role: RoleDto;
  catalogue: AccessCatalogue;
  disabled: boolean;
}) {
  const { pending, error, success, onSubmit } = useListSave(
    role,
    'modules',
    'Module access saved.',
  );
  return (
    <form className="form" onSubmit={onSubmit}>
      <p className="muted" style={{ margin: 0 }}>
        Modules this role can open. Removing a module also removes its permissions from the role.
      </p>
      {catalogue.modules.map((module) => (
        <label key={module.key} className="check">
          <input
            type="checkbox"
            name="modules"
            value={module.key}
            defaultChecked={role.modules.includes(module.key)}
            disabled={disabled}
          />
          <span>
            {module.name}
            <br />
            <span className="muted">{module.description}</span>
          </span>
        </label>
      ))}
      <FormStatus error={error} success={success} />
      {!disabled && <SaveButton pending={pending} />}
    </form>
  );
}

export function PermissionsForm({
  role,
  catalogue,
  disabled,
}: {
  role: RoleDto;
  catalogue: AccessCatalogue;
  disabled: boolean;
}) {
  const { pending, error, success, onSubmit } = useListSave(
    role,
    'permissions',
    'Permissions saved.',
  );
  const modules = catalogue.modules.filter((m) =>
    catalogue.permissions.some((p) => p.module === m.key),
  );
  return (
    <form onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: 0 }}>
        Actions this role can perform. A module must be enabled in Module Access first.
      </p>
      {modules.map((module) => {
        const enabled = role.modules.includes(module.key);
        return (
          <fieldset key={module.key} className={styles.permissionGroup}>
            <legend>
              {module.name}
              {!enabled && <span className="muted"> · module not enabled for this role</span>}
            </legend>
            <div className="stack" style={{ gap: 8 }}>
              {catalogue.permissions
                .filter((p) => p.module === module.key)
                .map((permission) => (
                  <label key={permission.key} className={`check ${enabled ? '' : 'check-muted'}`}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={permission.key}
                      defaultChecked={role.permissions.includes(permission.key as never)}
                      disabled={disabled || !enabled}
                    />
                    <span>
                      {permission.name}
                      <br />
                      <code className="muted">{permission.key}</code>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        );
      })}
      <div className="stack" style={{ gap: 12 }}>
        <FormStatus error={error} success={success} />
        {!disabled && <SaveButton pending={pending} />}
      </div>
    </form>
  );
}

export function AssignedUsers({
  role,
  assigned,
  allUsers,
  canAssign,
}: {
  role: RoleDto;
  assigned: RoleUserDto[];
  allUsers: UserDto[];
  canAssign: boolean;
}) {
  const { pending, error, run } = useMutation();
  const unassigned = allUsers.filter((u) => !assigned.some((a) => a.id === u.id));

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userIds = new FormData(event.currentTarget).getAll('userIds');
    if (userIds.length === 0) return;
    await run(() =>
      apiFetch(`/roles/${role.id}/users`, { method: 'POST', body: JSON.stringify({ userIds }) }),
    );
  }

  async function remove(user: RoleUserDto) {
    if (!window.confirm(`Remove ${user.name} from ${role.name}?`)) return;
    await run(() => apiFetch<void>(`/roles/${role.id}/users/${user.id}`, { method: 'DELETE' }));
  }

  return (
    <div className="stack">
      <FormStatus error={error} />
      <DataTable
        label="Assigned users"
        rows={assigned}
        rowKey={(u) => u.id}
        empty="No users have this role."
        columns={[
          { header: 'Name', primary: true, cell: (u) => u.name },
          { header: 'Email', cell: (u) => u.email },
          { header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
          ...(canAssign
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (u: RoleUserDto) => (
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={pending}
                      onClick={() => remove(u)}
                    >
                      Remove
                    </button>
                  ),
                },
              ]
            : []),
        ]}
      />
      {canAssign && unassigned.length > 0 && (
        <form className="stack" style={{ gap: 8 }} onSubmit={add}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Add users
          </h3>
          {unassigned.map((user) => (
            <label key={user.id} className="check">
              <input type="checkbox" name="userIds" value={user.id} />
              <span>
                {user.name} <span className="muted">· {user.email}</span>
              </span>
            </label>
          ))}
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Add selected'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Clone From → New Role Name with the copy options from the specification. */
export function CloneRoleButton({ role }: { role: RoleDto }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { pending, error, fields, run } = useMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch<RoleDto>(`/roles/${role.id}/clone`, {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            copyPortals: data.get('copyPortals') === 'on',
            copyModules: data.get('copyModules') === 'on',
            copyPermissions: data.get('copyPermissions') === 'on',
          }),
        }),
      {
        onSuccess: ({ data: clone }) => {
          dialog.current?.close();
          router.push(`/admin/roles/${clone.id}`);
        },
        refresh: false,
      },
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        Clone role
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="clone-title"
      >
        {open && (
          <form className="form" onSubmit={onSubmit} noValidate>
            <h2 id="clone-title" className="card-title" style={{ margin: 0 }}>
              Clone “{role.name}”
            </h2>
            <Field label="New role name" htmlFor="clone-name" error={fields.name}>
              <input
                className="input"
                id="clone-name"
                name="name"
                defaultValue={`${role.name} (copy)`}
                required
              />
            </Field>
            <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label" style={{ marginBottom: 8 }}>
                Copy
              </legend>
              <label className="check">
                <input type="checkbox" name="copyPortals" defaultChecked /> Portal access
              </label>
              <label className="check">
                <input type="checkbox" name="copyModules" defaultChecked /> Module access
              </label>
              <label className="check">
                <input type="checkbox" name="copyPermissions" defaultChecked /> Role permissions
              </label>
            </fieldset>
            <FormStatus error={error} fields={fields} />
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={pending}>
                {pending ? 'Cloning…' : 'Clone'}
              </button>
              <button className="btn" type="button" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
