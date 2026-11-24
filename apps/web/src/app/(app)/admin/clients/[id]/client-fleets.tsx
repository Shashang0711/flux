'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import type { ClientDto, FleetDto, VesselRelationshipDto } from '@flux/shared';
import { Badge, StatusBadge } from '@/components/badges';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

/** Vessels linked to this client (read-only here; links are managed on the vessel). */
export function ClientVessels({ relationships }: { relationships: VesselRelationshipDto[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Vessel</th>
            <th>Relationship</th>
            <th>Fleet</th>
            <th>Since</th>
          </tr>
        </thead>
        <tbody>
          {relationships.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No vessels linked to this client. Link vessels from the vessel’s Clients tab.
              </td>
            </tr>
          )}
          {relationships.map((rel) => (
            <tr key={rel.id}>
              <td>
                <Link href={`/admin/vessels/${rel.vessel.id}?tab=clients`}>{rel.vessel.name}</Link>{' '}
                {rel.isPrimary && <Badge tone="brand">Primary</Badge>}
                <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                  {rel.vessel.code}
                </span>
              </td>
              <td>{rel.relationshipType.name}</td>
              <td>{rel.fleet?.name ?? '—'}</td>
              <td className="muted">{rel.startDate ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FleetRow({ fleet, canManage }: { fleet: FleetDto; canManage: boolean }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch(`/fleets/${fleet.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: data.get('name'),
            status: data.get('active') === 'on' ? 'ACTIVE' : 'INACTIVE',
          }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <tr>
      <td>
        <code>{fleet.code}</code>
      </td>
      <td>{fleet.name}</td>
      <td>
        {fleet.vessels.length === 0
          ? '—'
          : fleet.vessels.map((v, i) => (
              <span key={v.id}>
                {i > 0 && ', '}
                <Link href={`/admin/vessels/${v.id}`}>{v.name}</Link>
              </span>
            ))}
      </td>
      <td>
        <StatusBadge status={fleet.status} />
      </td>
      {canManage && (
        <td style={{ textAlign: 'right' }}>
          <details>
            <summary className="btn">Edit</summary>
            <form
              className="form"
              style={{ marginTop: 12, textAlign: 'left', minWidth: 260 }}
              onSubmit={onSubmit}
              noValidate
            >
              <Field label="Fleet name" htmlFor={`fleet-${fleet.id}-name`} error={fields.name}>
                <input
                  className="input"
                  id={`fleet-${fleet.id}-name`}
                  name="name"
                  defaultValue={fleet.name}
                />
              </Field>
              <label className="check">
                <input type="checkbox" name="active" defaultChecked={fleet.status === 'ACTIVE'} />{' '}
                Active
              </label>
              <FormStatus error={error} fields={fields} success={success} />
              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={pending}>
                  Save
                </button>
              </div>
            </form>
          </details>
        </td>
      )}
    </tr>
  );
}

/** The client's fleets (design pack §14) with their current vessels. */
export function ClientFleets({
  client,
  fleets,
  canManage,
}: {
  client: ClientDto;
  fleets: FleetDto[];
  canManage: boolean;
}) {
  const add = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get('name');
    await add.run(
      () =>
        apiFetch('/fleets', {
          method: 'POST',
          body: JSON.stringify({ clientId: client.id, name }),
        }),
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <div className="stack">
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add a fleet</h2>
          <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onSubmit} noValidate>
            <div style={{ flex: '1 1 260px' }}>
              <Field label="Fleet name" htmlFor="new-fleet-name" error={add.fields.name}>
                <input className="input" id="new-fleet-name" name="name" />
              </Field>
            </div>
            <button className="btn btn-primary" type="submit" disabled={add.pending}>
              {add.pending ? 'Adding…' : 'Add fleet'}
            </button>
          </form>
          <div style={{ marginTop: 12 }}>
            <FormStatus error={add.error} fields={add.fields} />
          </div>
        </section>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Fleet</th>
              <th>Vessels</th>
              <th>Status</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {fleets.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No fleets yet.
                </td>
              </tr>
            )}
            {fleets.map((f) => (
              <FleetRow key={f.id} fleet={f} canManage={canManage} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
