'use client';

import type { FormEvent } from 'react';
import type { TenantDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { ModuleCheckboxes } from '../module-checkboxes';

export function TenantDetailsForm({ tenant }: { tenant: TenantDto }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    await run(
      () =>
        apiFetch(`/platform/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Details</h2>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Organisation name" htmlFor="name" error={fields.name}>
          <input className="input" id="name" name="name" defaultValue={tenant.name} required />
        </Field>
        <FormStatus error={error} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function TenantModulesForm({ tenant }: { tenant: TenantDto }) {
  const { pending, error, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const modules = new FormData(event.currentTarget).getAll('modules');
    await run(
      () =>
        apiFetch(`/platform/tenants/${tenant.id}/modules`, {
          method: 'PUT',
          body: JSON.stringify({ modules }),
        }),
      { success: 'Modules updated. Changes apply to the tenant’s users immediately.' },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Modules</h2>
      <form className="form" onSubmit={onSubmit}>
        <ModuleCheckboxes name="modules" selected={tenant.modules} />
        <FormStatus error={error} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save modules'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function TenantStatusCard({ tenant }: { tenant: TenantDto }) {
  const { pending, error, run } = useMutation();
  const suspended = tenant.status === 'SUSPENDED';
  async function toggle() {
    if (
      !suspended &&
      !window.confirm(`Suspend ${tenant.name}? All of its users will be signed out immediately.`)
    ) {
      return;
    }
    await run(() =>
      apiFetch(`/platform/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: suspended ? 'ACTIVE' : 'SUSPENDED' }),
      }),
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Access</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {suspended
          ? 'This tenant is suspended. Its users cannot sign in.'
          : 'Suspending signs out every user of this tenant and blocks sign-in until reactivated.'}
      </p>
      <FormStatus error={error} />
      <button
        type="button"
        className={`btn ${suspended ? 'btn-primary' : 'btn-danger'}`}
        onClick={toggle}
        disabled={pending}
      >
        {suspended ? 'Reactivate tenant' : 'Suspend tenant'}
      </button>
    </section>
  );
}
