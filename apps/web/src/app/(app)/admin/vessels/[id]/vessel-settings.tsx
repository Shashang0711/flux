'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  NOTIFICATION_EVENTS,
  notificationEventName,
  type BillingPartyDto,
  type VesselContactDto,
  type VesselLinkSettingsDto,
  type VesselNotificationDto,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import {
  RecipientSummary,
  RecipientsFields,
  canDeliver,
  readRecipients,
  type RecipientOption,
} from '@/components/recipients';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

const SourceBadge = ({ source }: { source: 'client' | 'vessel' | null }) =>
  source === 'vessel' ? <Badge tone="brand">Vessel override</Badge> : <Badge>Client default</Badge>;

function partyAddress(p: BillingPartyDto): string {
  return [p.line1, p.line2, [p.postalCode, p.city].filter(Boolean).join(' '), p.region, p.country]
    .filter(Boolean)
    .join(', ');
}

function PartyDetails({ party }: { party: BillingPartyDto }) {
  return (
    <dl className="details">
      <div>
        <dt>Name</dt>
        <dd>{party.name}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>{party.email ?? '—'}</dd>
      </div>
      <div>
        <dt>Tax / VAT number</dt>
        <dd>{party.taxNumber ?? '—'}</dd>
      </div>
      <div>
        <dt>Address</dt>
        <dd>{partyAddress(party) || '—'}</dd>
      </div>
    </dl>
  );
}

// ─── Billing ────────────────────────────────────────────────────────────────

export function VesselBilling({
  settings,
  canManage,
}: {
  settings: VesselLinkSettingsDto;
  canManage: boolean;
}) {
  const { billing, billingParties, relationship } = settings;
  const client = relationship.client;
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get('billingPartyId') ?? '');
    await run(
      () =>
        apiFetch(`/relationships/${relationship.id}/billing`, {
          method: 'PUT',
          body: JSON.stringify({ billingPartyId: id || null }),
        }),
      { success: 'Saved.' },
    );
  }
  const editable = canManage && settings.editable;
  return (
    <div className="stack">
      {billing.overrideInactive && billing.override && (
        <p className="alert alert-warn" role="status">
          The billing party chosen for this vessel ({billing.override.name}) has been deactivated,
          so the client’s default is used. Choose another party or switch back to the default.
        </p>
      )}
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            Invoiced to
          </h2>
          {billing.effective && <SourceBadge source={billing.source} />}
        </div>
        {billing.effective ? (
          <PartyDetails party={billing.effective} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {client.name} has no default billing party.{' '}
            <Link href={`/admin/clients/${client.id}?tab=billing`}>Add one on the client</Link>.
          </p>
        )}
      </section>
      {editable && (
        <section className="card">
          <h2 className="card-title">Billing for this vessel</h2>
          <form className="form" onSubmit={onSubmit} noValidate>
            <Field
              label="Invoice this vessel’s work to"
              htmlFor="billingPartyId"
              hint={`Parties are managed on ${client.name}’s Billing Parties tab.`}
              error={fields.billingPartyId}
            >
              <select
                className="select"
                id="billingPartyId"
                name="billingPartyId"
                defaultValue={billing.override?.isActive ? billing.override.id : ''}
              >
                <option value="">
                  Client default{billing.clientDefault ? ` (${billing.clientDefault.name})` : ''}
                </option>
                {billingParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? ' — client default' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <FormStatus error={error} fields={fields} success={success} />
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

// ─── Contacts ───────────────────────────────────────────────────────────────

function VesselContactForm({
  relationshipId,
  contact,
}: {
  relationshipId: string;
  contact?: VesselContactDto;
}) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = contact ? `vc-${contact.id}` : 'vc-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(
      ['name', 'jobTitle', 'email', 'phone'].map((k) => [k, String(data.get(k) ?? '').trim()]),
    );
    await run(
      () =>
        apiFetch(
          contact ? `/vessel-contacts/${contact.id}` : `/relationships/${relationshipId}/contacts`,
          { method: contact ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
        ),
      { success: contact ? 'Saved.' : undefined, onSuccess: () => !contact && form.reset() },
    );
  }
  const input = (name: keyof VesselContactDto, label: string, type = 'text') => (
    <Field label={label} htmlFor={`${prefix}-${name}`} error={fields[name]}>
      <input
        className="input"
        id={`${prefix}-${name}`}
        name={name}
        type={type}
        defaultValue={contact?.[name] ?? ''}
        required={name === 'name'}
      />
    </Field>
  );
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="grid-2">
        {input('name', 'Name')}
        {input('jobTitle', 'Role on board', 'text')}
      </div>
      <div className="grid-2">
        {input('email', 'Email', 'email')}
        {input('phone', 'Phone', 'tel')}
      </div>
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : contact ? 'Save' : 'Add contact'}
        </button>
      </div>
    </form>
  );
}

export function VesselContacts({
  settings,
  canManage,
}: {
  settings: VesselLinkSettingsDto;
  canManage: boolean;
}) {
  const { relationship, contacts } = settings;
  const editable = canManage && settings.editable;
  const toggle = useMutation();
  const remove = useMutation();
  return (
    <div className="stack">
      <section className="stack">
        <div>
          <h2 className="card-title" style={{ marginBottom: 4 }}>
            Vessel contacts
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            People for this vessel only, such as the master or chief engineer.
          </p>
        </div>
        <DataTable
          label="Vessel contacts"
          rows={contacts.vessel}
          rowKey={(c) => c.id}
          empty="No vessel contacts yet."
          columns={[
            { header: 'Name', primary: true, cell: (c) => c.name },
            { header: 'Role', cell: (c) => c.jobTitle ?? '—' },
            { header: 'Email', cell: (c) => c.email ?? '—' },
            { header: 'Phone', cell: (c) => c.phone ?? '—' },
            ...(editable
              ? [
                  {
                    header: 'Actions',
                    actions: true,
                    cell: (c: VesselContactDto) => (
                      <>
                        <EditDialog title={`Edit ${c.name}`}>
                          <VesselContactForm relationshipId={relationship.id} contact={c} />
                        </EditDialog>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={remove.pending}
                          onClick={() =>
                            window.confirm(`Remove ${c.name}?`) &&
                            remove.run(() =>
                              apiFetch(`/vessel-contacts/${c.id}`, { method: 'DELETE' }),
                            )
                          }
                        >
                          Remove
                        </button>
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
        <FormStatus error={remove.error} />
        {editable && (
          <section className="card">
            <h2 className="card-title">Add a vessel contact</h2>
            <VesselContactForm relationshipId={relationship.id} />
          </section>
        )}
      </section>

      <section className="stack">
        <div>
          <h2 className="card-title" style={{ marginBottom: 4 }}>
            From {relationship.client.name}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            The client’s contacts also apply to this vessel. Hide any that do not; hidden contacts
            are also left out of the notifications this vessel inherits.
          </p>
        </div>
        <DataTable
          label="Client contacts"
          rows={contacts.client}
          rowKey={(c) => c.id}
          empty="The client has no contacts."
          columns={[
            {
              header: 'Name',
              primary: true,
              cell: (c) => (
                <>
                  {c.name} {c.isPrimary && <Badge tone="brand">Primary</Badge>}
                </>
              ),
            },
            { header: 'Job title', cell: (c) => c.jobTitle ?? '—' },
            { header: 'Email', cell: (c) => c.email ?? '—' },
            {
              header: 'For this vessel',
              cell: (c) => (c.hidden ? <Badge>Hidden</Badge> : <Badge tone="ok">Shown</Badge>),
            },
            ...(editable
              ? [
                  {
                    header: 'Actions',
                    actions: true,
                    cell: (c: (typeof contacts.client)[number]) => (
                      <button
                        type="button"
                        className="btn"
                        disabled={toggle.pending}
                        onClick={() =>
                          toggle.run(() =>
                            apiFetch(`/relationships/${relationship.id}/client-contacts/${c.id}`, {
                              method: 'PUT',
                              body: JSON.stringify({ hidden: !c.hidden }),
                            }),
                          )
                        }
                      >
                        {c.hidden ? 'Show' : 'Hide'}
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
        <FormStatus error={toggle.error} />
      </section>
    </div>
  );
}

// ─── Notifications ──────────────────────────────────────────────────────────

type EnabledChoice = 'client' | 'on' | 'off';

function OverrideForm({
  settings,
  n,
  options,
}: {
  settings: VesselLinkSettingsDto;
  n: VesselNotificationDto;
  options: RecipientOption[];
}) {
  const { pending, error, fields, success, run } = useMutation();
  const initialEnabled: EnabledChoice =
    n.override?.enabled === true ? 'on' : n.override?.enabled === false ? 'off' : 'client';
  const [custom, setCustom] = useState(Boolean(n.override?.recipients));
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const choice = data.get('enabled') as EnabledChoice;
    await run(
      () =>
        apiFetch(`/relationships/${settings.relationship.id}/notifications/${n.event}`, {
          method: 'PUT',
          body: JSON.stringify({
            enabled: choice === 'client' ? null : choice === 'on',
            recipients: custom ? readRecipients(data) : null,
          }),
        }),
      { success: 'Saved.' },
    );
  }
  const clientState = n.client.enabled ? 'on' : 'off';
  const own = n.override?.recipients;
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <fieldset className="check-group">
        <legend>Send this notification</legend>
        <label className="check">
          <input
            type="radio"
            name="enabled"
            value="client"
            defaultChecked={initialEnabled === 'client'}
          />
          As the client ({clientState})
        </label>
        <label className="check">
          <input type="radio" name="enabled" value="on" defaultChecked={initialEnabled === 'on'} />
          On for this vessel
        </label>
        <label className="check">
          <input
            type="radio"
            name="enabled"
            value="off"
            defaultChecked={initialEnabled === 'off'}
          />
          Off for this vessel
        </label>
      </fieldset>
      <fieldset className="check-group">
        <legend>Recipients</legend>
        <label className="check">
          <input
            type="radio"
            name="recipientMode"
            checked={!custom}
            onChange={() => setCustom(false)}
          />
          The client’s recipients
        </label>
        <label className="check">
          <input
            type="radio"
            name="recipientMode"
            checked={custom}
            onChange={() => setCustom(true)}
          />
          Choose recipients for this vessel
        </label>
      </fieldset>
      {custom ? (
        <RecipientsFields
          idPrefix={`override-${n.event}`}
          options={options}
          selected={(own ?? n.effective).contacts.map((c) => c.id)}
          emails={(own ?? n.effective).emails}
          fields={Object.fromEntries(
            Object.entries(fields).map(([k, v]) => [k.replace(/^recipients\./, ''), v]),
          )}
        />
      ) : (
        <div className="muted">
          <RecipientSummary
            recipients={{
              contacts: n.client.contacts.filter((c) => options.some((o) => o.id === c.id)),
              emails: n.client.emails,
            }}
          />
        </div>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export function VesselNotifications({
  settings,
  canManage,
}: {
  settings: VesselLinkSettingsDto;
  canManage: boolean;
}) {
  const editable = canManage && settings.editable;
  const reset = useMutation();
  const { client } = settings.relationship;
  const options: RecipientOption[] = [
    ...settings.contacts.vessel.map((c) => ({ ...c, note: 'Vessel contact' })),
    ...settings.contacts.client.filter((c) => !c.hidden),
  ];
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        By default this vessel follows{' '}
        <Link href={`/admin/clients/${client.id}?tab=notifications`}>
          {client.name}’s notification rules
        </Link>
        . Overrides here store only what is different for this vessel.
      </p>
      <DataTable
        label="Notifications"
        empty="No notification events."
        rows={settings.notifications}
        rowKey={(n) => n.event}
        columns={[
          {
            header: 'Event',
            primary: true,
            cell: (n) => (
              <>
                {notificationEventName(n.event)}
                <span className="cell-sub">
                  {NOTIFICATION_EVENTS.find((e) => e.key === n.event)?.description}
                </span>
              </>
            ),
          },
          {
            header: 'For this vessel',
            cell: (n) => (
              <span className="row">
                {n.effective.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
                {n.override ? <Badge tone="brand">Override</Badge> : <Badge>As client</Badge>}
                {n.effective.enabled && !canDeliver(n.effective) && (
                  <Badge tone="warn">No one to email</Badge>
                )}
              </span>
            ),
          },
          {
            header: 'Recipients',
            cell: (n) => (
              <>
                <RecipientSummary recipients={n.effective} />
                {n.source.recipients === 'vessel' && (
                  <span className="cell-sub">Chosen for this vessel</span>
                )}
              </>
            ),
          },
          ...(editable
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (n: VesselNotificationDto) => (
                    <>
                      <EditDialog
                        title={`${notificationEventName(n.event)} for this vessel`}
                        label={n.override ? 'Edit' : 'Override'}
                      >
                        <OverrideForm settings={settings} n={n} options={options} />
                      </EditDialog>
                      {n.override && (
                        <button
                          type="button"
                          className="btn"
                          disabled={reset.pending}
                          onClick={() =>
                            reset.run(() =>
                              apiFetch(
                                `/relationships/${settings.relationship.id}/notifications/${n.event}`,
                                {
                                  method: 'PUT',
                                  body: JSON.stringify({ enabled: null, recipients: null }),
                                },
                              ),
                            )
                          }
                        >
                          Reset
                        </button>
                      )}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <FormStatus error={reset.error} />
    </div>
  );
}
