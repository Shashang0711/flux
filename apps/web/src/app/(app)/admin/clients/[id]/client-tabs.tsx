'use client';

import type { FormEvent, ReactNode } from 'react';
import {
  ADDRESS_TYPES,
  type BillingPartyDto,
  type ClientAddressDto,
  type ClientContactDto,
  type ClientDto,
  type CustomFieldDefinitionDto,
} from '@flux/shared';
import { Badge, StatusBadge } from '@/components/badges';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { ClientFields, clientPayload } from '../client-fields';
import styles from './client-tabs.module.css';

type Values = Record<string, string | null | boolean | undefined>;

function value(data: FormData, key: string): string {
  return String(data.get(key) ?? '').trim();
}

function SubmitRow({ pending, label = 'Save' }: { pending: boolean; label?: string }) {
  return (
    <div className="form-actions">
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}

/** A labelled text input whose id is unique per record. */
function TextField({
  name,
  label,
  prefix,
  values,
  error,
  required,
  type = 'text',
}: {
  name: string;
  label: string;
  prefix: string;
  values?: Values;
  error?: string;
  required?: boolean;
  type?: string;
}) {
  const id = `${prefix}-${name}`;
  return (
    <Field label={label} htmlFor={id} error={error}>
      <input
        className="input"
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={(values?.[name] as string | null | undefined) ?? ''}
      />
    </Field>
  );
}

function AddressInputs({
  prefix,
  values,
  fields,
  requiredCore,
}: {
  prefix: string;
  values?: Values;
  fields: Record<string, string>;
  requiredCore: boolean;
}) {
  const f = (name: string, label: string, required = false) => (
    <TextField
      name={name}
      label={label}
      prefix={prefix}
      values={values}
      error={fields[name]}
      required={required}
    />
  );
  return (
    <>
      {f('line1', 'Address line 1', requiredCore)}
      {f('line2', 'Address line 2')}
      <div className="grid-2">
        {f('city', 'City', requiredCore)}
        {f('region', 'Region / state')}
      </div>
      <div className="grid-2">
        {f('postalCode', 'Postal code')}
        {f('country', 'Country', requiredCore)}
      </div>
    </>
  );
}

function addressPayload(data: FormData) {
  return {
    line1: value(data, 'line1'),
    line2: value(data, 'line2'),
    city: value(data, 'city'),
    region: value(data, 'region'),
    postalCode: value(data, 'postalCode'),
    country: value(data, 'country'),
  };
}

/** Expandable inline editor used in lists. */
function Editor({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className={styles.editor}>
      <summary className="btn">{label}</summary>
      <div className={styles.editorBody}>{children}</div>
    </details>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

export function Overview({
  client,
  canManage,
  customFields,
}: {
  client: ClientDto;
  canManage: boolean;
  customFields: CustomFieldDefinitionDto[];
}) {
  const details = useMutation();
  const status = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = clientPayload(new FormData(event.currentTarget), customFields);
    await details.run(
      () => apiFetch(`/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      { success: 'Saved.' },
    );
  }
  const active = client.status === 'ACTIVE';
  return (
    <>
      <section className="card">
        <h2 className="card-title">Company details</h2>
        <form className="form" onSubmit={onSubmit} noValidate>
          <ClientFields
            client={client}
            fields={details.fields}
            disabled={!canManage}
            customFields={customFields}
          />
          <FormStatus error={details.error} fields={details.fields} success={details.success} />
          {canManage && <SubmitRow pending={details.pending} />}
        </form>
      </section>
      {canManage && (
        <section className="card">
          <h2 className="card-title">Status</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {active
              ? 'Deactivate clients you no longer work with. Their history is kept.'
              : 'This client is inactive.'}
          </p>
          <FormStatus error={status.error} />
          <button
            type="button"
            className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}
            disabled={status.pending}
            onClick={() =>
              status.run(() =>
                apiFetch(`/clients/${client.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: active ? 'INACTIVE' : 'ACTIVE' }),
                }),
              )
            }
          >
            {active ? 'Deactivate client' : 'Activate client'}
          </button>
        </section>
      )}
    </>
  );
}

// ─── Addresses ──────────────────────────────────────────────────────────────

function AddressTypeSelect({ prefix, selected }: { prefix: string; selected?: string }) {
  return (
    <Field label="Type" htmlFor={`${prefix}-type`}>
      <select
        className="select"
        id={`${prefix}-type`}
        name="type"
        defaultValue={selected ?? 'REGISTERED'}
      >
        {ADDRESS_TYPES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function AddressForm({ clientId, address }: { clientId: string; address?: ClientAddressDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = address ? `address-${address.id}` : 'address-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      type: value(data, 'type'),
      label: value(data, 'label'),
      ...addressPayload(data),
    };
    await run(
      () =>
        apiFetch(
          address
            ? `/clients/${clientId}/addresses/${address.id}`
            : `/clients/${clientId}/addresses`,
          {
            method: address ? 'PATCH' : 'POST',
            body: JSON.stringify(payload),
          },
        ),
      { success: address ? 'Saved.' : undefined, onSuccess: () => !address && form.reset() },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="grid-2">
        <AddressTypeSelect prefix={prefix} selected={address?.type} />
        <TextField
          name="label"
          label="Label (optional)"
          prefix={prefix}
          values={address as unknown as Values}
          error={fields.label}
        />
      </div>
      <AddressInputs
        prefix={prefix}
        values={address as unknown as Values}
        fields={fields}
        requiredCore
      />
      <FormStatus error={error} fields={fields} success={success} />
      <SubmitRow pending={pending} label={address ? 'Save' : 'Add address'} />
    </form>
  );
}

export function Addresses({ client, canManage }: { client: ClientDto; canManage: boolean }) {
  const remove = useMutation();
  return (
    <div className="stack">
      {client.addresses.length === 0 && <p className="card muted">No addresses yet.</p>}
      {client.addresses.map((address) => (
        <section key={address.id} className="card">
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <div>
              <Badge tone="brand">
                {ADDRESS_TYPES.find((t) => t.key === address.type)?.name ?? address.type}
              </Badge>
              {address.label && <strong> {address.label}</strong>}
              <address className={styles.address}>
                {address.line1}
                {address.line2 && <>, {address.line2}</>}
                <br />
                {[address.postalCode, address.city, address.region].filter(Boolean).join(' ')}
                <br />
                {address.country}
              </address>
            </div>
            {canManage && (
              <div className="row">
                <Editor label="Edit">
                  <AddressForm clientId={client.id} address={address} />
                </Editor>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={remove.pending}
                  onClick={() =>
                    window.confirm('Remove this address?') &&
                    remove.run(() =>
                      apiFetch(`/clients/${client.id}/addresses/${address.id}`, {
                        method: 'DELETE',
                      }),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </section>
      ))}
      <FormStatus error={remove.error} />
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add address</h2>
          <AddressForm clientId={client.id} />
        </section>
      )}
    </div>
  );
}

// ─── Contacts ───────────────────────────────────────────────────────────────

function ContactForm({ clientId, contact }: { clientId: string; contact?: ClientContactDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = contact ? `contact-${contact.id}` : 'contact-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: value(data, 'name'),
      jobTitle: value(data, 'jobTitle'),
      email: value(data, 'email'),
      phone: value(data, 'phone'),
      isPrimary: data.get('isPrimary') === 'on',
    };
    await run(
      () =>
        apiFetch(
          contact ? `/clients/${clientId}/contacts/${contact.id}` : `/clients/${clientId}/contacts`,
          {
            method: contact ? 'PATCH' : 'POST',
            body: JSON.stringify(payload),
          },
        ),
      { success: contact ? 'Saved.' : undefined, onSuccess: () => !contact && form.reset() },
    );
  }
  const values = contact as unknown as Values;
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="grid-2">
        <TextField
          name="name"
          label="Name"
          prefix={prefix}
          values={values}
          error={fields.name}
          required
        />
        <TextField
          name="jobTitle"
          label="Job title"
          prefix={prefix}
          values={values}
          error={fields.jobTitle}
        />
      </div>
      <div className="grid-2">
        <TextField
          name="email"
          label="Email"
          type="email"
          prefix={prefix}
          values={values}
          error={fields.email}
        />
        <TextField
          name="phone"
          label="Phone"
          type="tel"
          prefix={prefix}
          values={values}
          error={fields.phone}
        />
      </div>
      <label className="check">
        <input type="checkbox" name="isPrimary" defaultChecked={contact?.isPrimary} /> Primary
        contact
      </label>
      <FormStatus error={error} fields={fields} success={success} />
      <SubmitRow pending={pending} label={contact ? 'Save' : 'Add contact'} />
    </form>
  );
}

export function Contacts({ client, canManage }: { client: ClientDto; canManage: boolean }) {
  const remove = useMutation();
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Job title</th>
              <th>Email</th>
              <th>Phone</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {client.contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No contacts yet.
                </td>
              </tr>
            )}
            {client.contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  {contact.name} {contact.isPrimary && <Badge tone="brand">Primary</Badge>}
                </td>
                <td>{contact.jobTitle ?? '—'}</td>
                <td>{contact.email ?? '—'}</td>
                <td>{contact.phone ?? '—'}</td>
                {canManage && (
                  <td className={styles.actions}>
                    <Editor label="Edit">
                      <ContactForm clientId={client.id} contact={contact} />
                    </Editor>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={remove.pending}
                      onClick={() =>
                        window.confirm(`Remove ${contact.name}?`) &&
                        remove.run(() =>
                          apiFetch(`/clients/${client.id}/contacts/${contact.id}`, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormStatus error={remove.error} />
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add contact</h2>
          <ContactForm clientId={client.id} />
        </section>
      )}
    </div>
  );
}

// ─── Billing parties ────────────────────────────────────────────────────────

function BillingPartyForm({ clientId, party }: { clientId: string; party?: BillingPartyDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = party ? `billing-${party.id}` : 'billing-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: value(data, 'name'),
      email: value(data, 'email'),
      phone: value(data, 'phone'),
      taxNumber: value(data, 'taxNumber'),
      ...addressPayload(data),
      isDefault: data.get('isDefault') === 'on',
      ...(party ? { isActive: data.get('isActive') === 'on' } : {}),
    };
    await run(
      () =>
        apiFetch(
          party
            ? `/clients/${clientId}/billing-parties/${party.id}`
            : `/clients/${clientId}/billing-parties`,
          {
            method: party ? 'PATCH' : 'POST',
            body: JSON.stringify(payload),
          },
        ),
      { success: party ? 'Saved.' : undefined, onSuccess: () => !party && form.reset() },
    );
  }
  const values = party as unknown as Values;
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <TextField
        name="name"
        label="Billing name"
        prefix={prefix}
        values={values}
        error={fields.name}
        required
      />
      <div className="grid-2">
        <TextField
          name="email"
          label="Invoice email"
          type="email"
          prefix={prefix}
          values={values}
          error={fields.email}
        />
        <TextField
          name="phone"
          label="Phone"
          type="tel"
          prefix={prefix}
          values={values}
          error={fields.phone}
        />
      </div>
      <TextField
        name="taxNumber"
        label="Tax / VAT number"
        prefix={prefix}
        values={values}
        error={fields.taxNumber}
      />
      <AddressInputs prefix={prefix} values={values} fields={fields} requiredCore={false} />
      <label className="check">
        <input type="checkbox" name="isDefault" defaultChecked={party?.isDefault} /> Default billing
        party
      </label>
      {party && (
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={party.isActive} /> Active
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      <SubmitRow pending={pending} label={party ? 'Save' : 'Add billing party'} />
    </form>
  );
}

/** Billing Party Grid + Billing Party Add, as in the client specification. */
export function BillingParties({ client, canManage }: { client: ClientDto; canManage: boolean }) {
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Billing name</th>
              <th>Invoice email</th>
              <th>Tax / VAT</th>
              <th>Location</th>
              <th>Status</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {client.billingParties.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No billing parties yet.
                </td>
              </tr>
            )}
            {client.billingParties.map((party) => (
              <tr key={party.id}>
                <td>
                  {party.name} {party.isDefault && <Badge tone="brand">Default</Badge>}
                </td>
                <td>{party.email ?? '—'}</td>
                <td>{party.taxNumber ?? '—'}</td>
                <td>{[party.city, party.country].filter(Boolean).join(', ') || '—'}</td>
                <td>
                  <StatusBadge status={party.isActive ? 'ACTIVE' : 'INACTIVE'} />
                </td>
                {canManage && (
                  <td className={styles.actions}>
                    <Editor label="Edit">
                      <BillingPartyForm clientId={client.id} party={party} />
                    </Editor>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add billing party</h2>
          <BillingPartyForm clientId={client.id} />
        </section>
      )}
    </div>
  );
}
