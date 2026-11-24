'use client';

import { useEffect, useState } from 'react';
import type { ClientSummaryDto, FleetDto, ReferenceItemDto } from '@flux/shared';
import { Field } from '@/components/field';
import { apiFetch } from '@/lib/api';

/** Active fleets of a client, loaded when the client changes. */
export function useClientFleets(clientId: string) {
  const [fleets, setFleets] = useState<FleetDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      setFleets([]);
      return;
    }
    apiFetch<FleetDto[]>(`/clients/${clientId}/fleets`)
      .then(({ data }) => !cancelled && setFleets(data.filter((f) => f.status === 'ACTIVE')))
      .catch(() => !cancelled && setFleets([]));
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  return fleets;
}

export interface ClientLinkOptions {
  clients: ClientSummaryDto[];
  relationshipTypes: ReferenceItemDto[];
}

/**
 * Client + relationship type + primary + start date + fleet inputs. Field names are prefixed
 * (e.g. "relationship.") so API errors land next to the right input.
 */
export function ClientLinkFields({
  options,
  fields,
  prefix = '',
  required = true,
}: {
  options: ClientLinkOptions;
  fields: Record<string, string>;
  prefix?: string;
  required?: boolean;
}) {
  const [clientId, setClientId] = useState('');
  const fleets = useClientFleets(clientId);
  const id = (name: string) => `${prefix.replace('.', '-')}${name}`;
  return (
    <>
      <div className="grid-2">
        <Field label="Client" htmlFor={id('clientId')} error={fields[`${prefix}clientId`]}>
          <select
            className="select"
            id={id('clientId')}
            name={`${prefix}clientId`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required={required}
          >
            <option value="">{required ? 'Choose a client' : '— (link later)'}</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Relationship"
          htmlFor={id('relationshipTypeId')}
          error={fields[`${prefix}relationshipTypeId`]}
        >
          <select
            className="select"
            id={id('relationshipTypeId')}
            name={`${prefix}relationshipTypeId`}
            disabled={!clientId}
          >
            <option value="">Choose a relationship</option>
            {options.relationshipTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field
          label="Fleet"
          htmlFor={id('fleetId')}
          hint={clientId && fleets.length === 0 ? 'This client has no fleets yet' : undefined}
          error={fields[`${prefix}fleetId`]}
        >
          <select
            className="select"
            id={id('fleetId')}
            name={`${prefix}fleetId`}
            disabled={!clientId || fleets.length === 0}
          >
            <option value="">— (no fleet)</option>
            {fleets.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Since" htmlFor={id('startDate')} error={fields[`${prefix}startDate`]}>
          <input
            className="input"
            type="date"
            id={id('startDate')}
            name={`${prefix}startDate`}
            disabled={!clientId}
          />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" name={`${prefix}isPrimary`} disabled={!clientId} /> Primary client
        for this vessel
      </label>
    </>
  );
}

/** Reads the inputs above; null when no client was chosen. */
export function clientLinkPayload(data: FormData, prefix = '') {
  const v = (k: string) => String(data.get(`${prefix}${k}`) ?? '').trim();
  if (!v('clientId')) return null;
  return {
    clientId: v('clientId'),
    relationshipTypeId: v('relationshipTypeId'),
    fleetId: v('fleetId'),
    startDate: v('startDate'),
    isPrimary: data.get(`${prefix}isPrimary`) === 'on',
  };
}
