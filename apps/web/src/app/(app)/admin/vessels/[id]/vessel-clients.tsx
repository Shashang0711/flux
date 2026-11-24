'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { VesselDto, VesselRelationshipDto } from '@flux/shared';
import { Badge, StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import {
  ClientLinkFields,
  clientLinkPayload,
  useClientFleets,
  type ClientLinkOptions,
} from '@/components/client-link-fields';
import { FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

/** "2020-01-01 – now", "until 2024-12-31", or "Current" when no dates were recorded. */
function periodLabel(r: VesselRelationshipDto): string {
  if (r.startDate) return `${r.startDate} – ${r.endDate ?? 'now'}`;
  if (r.endDate) return `until ${r.endDate}`;
  return r.status === 'ACTIVE' ? 'Current' : 'Ended';
}

function FleetPicker({ rel }: { rel: VesselRelationshipDto }) {
  const fleets = useClientFleets(rel.client.id);
  const { pending, error, run } = useMutation();
  return (
    <>
      <select
        className="select"
        aria-label={`Fleet for ${rel.client.name}`}
        value={rel.fleet?.id ?? ''}
        disabled={pending}
        onChange={(e) =>
          run(() =>
            apiFetch(`/relationships/${rel.id}/fleet`, {
              method: 'PUT',
              body: JSON.stringify({ fleetId: e.target.value || null }),
            }),
          )
        }
      >
        <option value="">— (no fleet)</option>
        {rel.fleet && !fleets.some((f) => f.id === rel.fleet!.id) && (
          <option value={rel.fleet.id}>{rel.fleet.name}</option>
        )}
        {fleets.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <FormStatus error={error} />
    </>
  );
}

function RelationshipActions({
  rel,
  canManage,
}: {
  rel: VesselRelationshipDto;
  canManage: boolean;
}) {
  const primary = useMutation();
  const end = useMutation();
  const [ending, setEnding] = useState(false);
  if (!canManage || rel.status !== 'ACTIVE') return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!rel.isPrimary && (
          <button
            type="button"
            className="btn"
            disabled={primary.pending}
            onClick={() =>
              primary.run(() =>
                apiFetch(`/relationships/${rel.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ isPrimary: true }),
                }),
              )
            }
          >
            Make primary
          </button>
        )}
        <button type="button" className="btn btn-danger" onClick={() => setEnding((v) => !v)}>
          End
        </button>
      </div>
      {ending && (
        <form
          className="row"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const endDate = String(new FormData(e.currentTarget).get('endDate') ?? '');
            void end.run(() =>
              apiFetch(`/relationships/${rel.id}/end`, {
                method: 'POST',
                body: JSON.stringify({ endDate }),
              }),
            );
          }}
        >
          <label className="sr-only" htmlFor={`end-${rel.id}`}>
            End date
          </label>
          <input
            className="input"
            type="date"
            id={`end-${rel.id}`}
            name="endDate"
            defaultValue={new Date().toISOString().slice(0, 10)}
            style={{ width: 170 }}
          />
          <button className="btn btn-danger" type="submit" disabled={end.pending}>
            Confirm end
          </button>
        </form>
      )}
      <FormStatus error={primary.error ?? end.error} fields={end.fields} />
    </div>
  );
}

/** The vessel's client relationships (design pack §14) and the form to add one. */
export function VesselClients({
  vessel,
  relationships,
  options,
  canManage,
  canManageFleets,
  showEnded,
}: {
  vessel: VesselDto;
  relationships: VesselRelationshipDto[];
  options: ClientLinkOptions | null;
  canManage: boolean;
  canManageFleets: boolean;
  showEnded: boolean;
}) {
  const add = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = clientLinkPayload(new FormData(form));
    if (!payload) return;
    await add.run(
      () =>
        apiFetch(`/vessels/${vessel.id}/relationships`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <div className="stack">
      <DataTable
        label="Client relationships"
        rows={relationships}
        rowKey={(r) => r.id}
        empty={showEnded ? 'No relationships.' : 'Not linked to any client yet.'}
        columns={[
          {
            header: 'Client',
            primary: true,
            cell: (r) => (
              <>
                <Link href={`/admin/clients/${r.client.id}`}>{r.client.name}</Link>{' '}
                {r.isPrimary && <Badge tone="brand">Primary</Badge>}
                <span className="cell-sub">
                  <code>{r.client.code}</code>
                </span>
              </>
            ),
          },
          { header: 'Relationship', cell: (r) => r.relationshipType.name },
          {
            header: 'Fleet',
            cell: (r) =>
              canManageFleets && r.status === 'ACTIVE' ? (
                <FleetPicker rel={r} />
              ) : (
                (r.fleet?.name ?? '—')
              ),
          },
          {
            header: 'Period',
            cell: (r) => <span className="muted">{periodLabel(r)}</span>,
          },
          { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (r: VesselRelationshipDto) => (
                    <RelationshipActions rel={r} canManage={canManage} />
                  ),
                },
              ]
            : []),
        ]}
      />
      <Link href={`/admin/vessels/${vessel.id}?tab=clients${showEnded ? '' : '&ended=1'}`}>
        {showEnded ? 'Hide ended relationships' : 'Show ended relationships'}
      </Link>
      {canManage &&
        (options ? (
          <section className="card">
            <h2 className="card-title">Link to a client</h2>
            {/* Remount after each change so the client picker resets. */}
            <form key={relationships.length} className="form" onSubmit={onSubmit} noValidate>
              <ClientLinkFields options={options} fields={add.fields} />
              <FormStatus error={add.error} fields={add.fields} />
              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={add.pending}>
                  {add.pending ? 'Linking…' : 'Link client'}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <p className="muted">You need access to clients to link this vessel to one.</p>
        ))}
    </div>
  );
}
