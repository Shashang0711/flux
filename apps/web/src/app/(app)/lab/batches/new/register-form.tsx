'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { BatchDto, RegistrationDraftDto } from '@flux/shared';
import { CustomFieldInputs, customFieldPayload } from '@/components/custom-field-inputs';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

interface Links {
  vesselId: string;
  clientId: string;
}

/**
 * Register batch (design pack §8): batch fields once, then per kit its vessel, client and
 * sample fields. Everything is saved in one step; the server checks it all again.
 */
export function RegisterBatchForm({ draft }: { draft: RegistrationDraftDto }) {
  const router = useRouter();
  const [serviceTypeId, setServiceTypeId] = useState(draft.serviceTypes[0]?.id ?? '');
  const [links, setLinks] = useState<Links[]>(
    draft.kits.map((k) => ({ vesselId: k.vessel?.id ?? '', clientId: k.client?.id ?? '' })),
  );
  const { pending, error, fields, run } = useMutation();
  const st = draft.serviceTypes.find((s) => s.id === serviceTypeId);
  const batchFields = st?.fields.filter((f) => f.scope === 'BATCH') ?? [];
  const sampleFields = st?.fields.filter((f) => f.scope === 'SAMPLE') ?? [];

  function setVessel(i: number, vesselId: string) {
    const v = draft.vessels.find((x) => x.id === vesselId);
    setLinks((ls) =>
      ls.map((l, j) =>
        j !== i
          ? l
          : {
              vesselId,
              clientId:
                v && !v.clientIds.includes(l.clientId) ? (v.primaryClientId ?? '') : l.clientId,
            },
      ),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch<BatchDto>('/samples/batches', {
          method: 'POST',
          body: JSON.stringify({
            serviceTypeId,
            values: customFieldPayload(data, batchFields, 'batch'),
            notes: String(data.get('notes') ?? ''),
            samples: draft.kits.map((k, i) => ({
              kitId: k.id,
              vesselId: links[i]!.vesselId || null,
              clientId: links[i]!.clientId || null,
              values: customFieldPayload(data, sampleFields, `samples.${i}`),
            })),
          }),
        }),
      { onSuccess: (res) => router.push(`/lab/batches/${res.data.id}`), refresh: false },
    );
  }

  if (draft.serviceTypes.length === 0) {
    return (
      <p className="alert alert-error">
        These kits cannot be registered together: they have no service type in common. Go back and
        choose kits of one service type.
      </p>
    );
  }
  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <section className="card">
        <div className="form">
          <Field label="Service type" htmlFor="batch-service-type" error={fields.serviceTypeId}>
            <select
              className="select"
              id="batch-service-type"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
              disabled={draft.serviceTypes.length === 1}
            >
              {draft.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <CustomFieldInputs
            key={`batch-${serviceTypeId}`}
            definitions={batchFields}
            fields={fields}
            scope="batch"
            legend="Batch details"
          />
          <Field label="Notes" htmlFor="batch-notes" error={fields.notes}>
            <textarea className="textarea" id="batch-notes" name="notes" rows={2} />
          </Field>
        </div>
      </section>

      {draft.kits.map((k, i) => {
        const vessel = draft.vessels.find((v) => v.id === links[i]!.vesselId);
        const clients = vessel
          ? draft.clients.filter((c) => vessel.clientIds.includes(c.id))
          : draft.clients;
        const path = (f: string) => `samples.${i}.${f}`;
        return (
          <section className="card" key={k.id} aria-labelledby={`kit-${i}`}>
            <h2 className="card-title" id={`kit-${i}`} style={{ marginBottom: 4 }}>
              Sample {i + 1}: <code>{k.code}</code>
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {k.product.name}
              {k.variant ? ` · ${k.variant.name}` : ''}
              {k.serialNumber ? ` · Serial ${k.serialNumber}` : ''}
              {k.condition !== 'OK' ? ` · Condition: ${k.condition.toLowerCase()}` : ''}
            </p>
            {fields[path('kitId')] && (
              <p className="alert alert-error" role="alert">
                {fields[path('kitId')]}
              </p>
            )}
            <div className="form">
              <div className="grid-2">
                <Field
                  label={st?.vesselRequired ? 'Vessel *' : 'Vessel'}
                  htmlFor={`s${i}-vessel`}
                  error={fields[path('vesselId')]}
                >
                  <select
                    className="select"
                    id={`s${i}-vessel`}
                    value={links[i]!.vesselId}
                    onChange={(e) => setVessel(i, e.target.value)}
                  >
                    <option value="">
                      {st?.vesselRequired ? 'Choose the vessel' : 'No vessel'}
                    </option>
                    {draft.vessels.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.imoNumber ? ` · IMO ${v.imoNumber}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Client *" htmlFor={`s${i}-client`} error={fields[path('clientId')]}>
                  <select
                    className="select"
                    id={`s${i}-client`}
                    value={links[i]!.clientId}
                    onChange={(e) =>
                      setLinks((ls) =>
                        ls.map((l, j) => (j === i ? { ...l, clientId: e.target.value } : l)),
                      )
                    }
                  >
                    <option value="">Choose the client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <CustomFieldInputs
                key={`sample-${i}-${serviceTypeId}`}
                definitions={sampleFields}
                fields={fields}
                scope={`samples.${i}`}
                legend={null}
              />
            </div>
          </section>
        );
      })}

      <FormStatus error={error} fields={fields} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending
            ? 'Registering…'
            : `Register ${draft.kits.length} sample${draft.kits.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}
