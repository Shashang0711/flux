'use client';

import { EditDialog } from '@/components/edit-dialog';
import Link from 'next/link';
import type { FormEvent } from 'react';
import type { ClientDto, FleetDto, VesselRelationshipDto } from '@flux/shared';
import { Badge, StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

/** Vessels linked to this client (read-only here; links are managed on the vessel). */
export function ClientVessels({ relationships }: { relationships: VesselRelationshipDto[] }) {
  return (
    <DataTable
      label="Linked vessels"
      rows={relationships}
      rowKey={(r) => r.id}
      empty="No vessels linked to this client. Link vessels from the vessel’s Clients tab."
      columns={[
        {
          header: 'Vessel',
          primary: true,
          cell: (r) => (
            <>
              <Link href={`/admin/vessels/${r.vessel.id}?tab=clients`}>{r.vessel.name}</Link>{' '}
              {r.isPrimary && <Badge tone="brand">Primary</Badge>}
              <span className="cell-sub">
                <code>{r.vessel.code}</code>
              </span>
            </>
          ),
        },
        { header: 'Relationship', cell: (r) => r.relationshipType.name },
        { header: 'Fleet', cell: (r) => r.fleet?.name ?? '—' },
        { header: 'Since', cell: (r) => <span className="muted">{r.startDate ?? '—'}</span> },
      ]}
    />
  );
}

function FleetEdit({ fleet }: { fleet: FleetDto }) {
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
    <EditDialog title={`Edit ${fleet.name}`}>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Fleet name" htmlFor={`fleet-${fleet.id}-name`} error={fields.name}>
          <input
            className="input"
            id={`fleet-${fleet.id}-name`}
            name="name"
            defaultValue={fleet.name}
          />
        </Field>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={fleet.status === 'ACTIVE'} /> Active
        </label>
        <FormStatus error={error} fields={fields} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </EditDialog>
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
          <form
            className="toolbar"
            style={{ alignItems: 'flex-end' }}
            onSubmit={onSubmit}
            noValidate
          >
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
      <DataTable
        label="Fleets"
        rows={fleets}
        rowKey={(f) => f.id}
        empty="No fleets yet."
        columns={[
          {
            header: 'Fleet',
            primary: true,
            cell: (f) => (
              <>
                {f.name}
                <span className="cell-sub">
                  <code>{f.code}</code>
                </span>
              </>
            ),
          },
          {
            header: 'Vessels',
            cell: (f) =>
              f.vessels.length === 0
                ? '—'
                : f.vessels.map((v, i) => (
                    <span key={v.id}>
                      {i > 0 && ', '}
                      <Link href={`/admin/vessels/${v.id}`}>{v.name}</Link>
                    </span>
                  )),
          },
          { header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
          ...(canManage
            ? [{ header: 'Actions', actions: true, cell: (f: FleetDto) => <FleetEdit fleet={f} /> }]
            : []),
        ]}
      />
    </div>
  );
}
