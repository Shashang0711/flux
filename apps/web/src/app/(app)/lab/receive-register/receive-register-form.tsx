'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { KIT_CONDITIONS, type BatchDto, type ReceiveRegisterOptionsDto } from '@flux/shared';
import { CustomFieldInputs, customFieldPayload } from '@/components/custom-field-inputs';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

interface Row {
  key: number;
  productId: string;
  variantId: string;
  vesselId: string;
  clientId: string;
}

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

/**
 * Receive & Register (design pack §8): the package's airway bill, its service type and batch
 * details, then one card per kit with what is received and what is registered. Saved in one
 * step; if anything is wrong nothing is saved and every problem is shown in place.
 */
export function ReceiveRegisterForm({ options }: { options: ReceiveRegisterOptionsDto }) {
  const router = useRouter();
  const nextKey = useRef(1);
  const [awbMode, setAwbMode] = useState<'new' | 'existing'>('new');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [rows, setRows] = useState<Row[]>([
    { key: 0, productId: '', variantId: '', vesselId: '', clientId: '' },
  ]);
  const { pending, error, fields, run } = useMutation();

  const st = options.serviceTypes.find((s) => s.id === serviceTypeId);
  const kits = st ? options.kits.filter((k) => k.serviceTypes.some((s) => s.id === st.id)) : [];
  const batchFields = st?.fields.filter((f) => f.scope === 'BATCH') ?? [];
  const sampleFields = st?.fields.filter((f) => f.scope === 'SAMPLE') ?? [];

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function chooseServiceType(id: string) {
    setServiceTypeId(id);
    const usable = options.kits.filter((k) => k.serviceTypes.some((s) => s.id === id));
    // Kits that are not used for the new service type are cleared; a single kit is chosen.
    setRows((rs) =>
      rs.map((r) =>
        usable.some((k) => k.id === r.productId)
          ? r
          : { ...r, productId: usable.length === 1 ? usable[0]!.id : '', variantId: '' },
      ),
    );
  }
  function chooseVessel(row: Row, vesselId: string) {
    const v = options.vessels.find((x) => x.id === vesselId);
    update(row.key, {
      vesselId,
      clientId: v && !v.clientIds.includes(row.clientId) ? (v.primaryClientId ?? '') : row.clientId,
    });
  }
  function addKit() {
    const last = rows[rows.length - 1];
    const key = nextKey.current++;
    setRows((rs) => [
      ...rs,
      last ? { ...last, key } : { key, productId: '', variantId: '', vesselId: '', clientId: '' },
    ]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch<BatchDto>('/samples/receive-and-register', {
          method: 'POST',
          body: JSON.stringify({
            ...(awbMode === 'existing'
              ? { airwayBillId: text(data, 'airwayBillId') }
              : {
                  airwayBill: {
                    number: text(data, 'awbNumber'),
                    courier: text(data, 'awbCourier'),
                    origin: text(data, 'awbOrigin'),
                    receivedOn: text(data, 'awbReceivedOn'),
                  },
                }),
            serviceTypeId,
            values: customFieldPayload(data, batchFields, 'batch'),
            notes: text(data, 'notes'),
            samples: rows.map((r, i) => ({
              productId: r.productId,
              variantId: r.variantId || null,
              vesselId: r.vesselId || null,
              clientId: r.clientId || null,
              serialNumber: text(data, `serial-${r.key}`),
              condition: text(data, `condition-${r.key}`),
              conditionNotes: text(data, `notes-${r.key}`),
              values: customFieldPayload(data, sampleFields, `samples.${i}`),
            })),
          }),
        }),
      { onSuccess: (res) => router.push(`/lab/batches/${res.data.id}`), refresh: false },
    );
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <section className="card">
        <h2 className="card-title">Airway bill</h2>
        <div className="form">
          {options.openAirwayBills.length > 0 && (
            <fieldset className="check-group">
              <legend>The package arrived under</legend>
              <label className="check">
                <input
                  type="radio"
                  name="awbMode"
                  checked={awbMode === 'new'}
                  onChange={() => setAwbMode('new')}
                />{' '}
                A new airway bill
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="awbMode"
                  checked={awbMode === 'existing'}
                  onChange={() => setAwbMode('existing')}
                />{' '}
                An open airway bill
              </label>
            </fieldset>
          )}
          {awbMode === 'existing' ? (
            <Field label="Open airway bill" htmlFor="rr-awb" error={fields.airwayBillId}>
              <select className="select" id="rr-awb" name="airwayBillId" defaultValue="">
                <option value="">Choose the airway bill</option>
                {options.openAirwayBills.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.number} · received {a.receivedOn}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <div className="grid-2">
                <Field
                  label="AWB number"
                  htmlFor="rr-awb-number"
                  error={fields['airwayBill.number']}
                >
                  <input className="input" id="rr-awb-number" name="awbNumber" />
                </Field>
                <Field
                  label="Date received"
                  htmlFor="rr-awb-date"
                  error={fields['airwayBill.receivedOn']}
                >
                  <input
                    className="input"
                    id="rr-awb-date"
                    name="awbReceivedOn"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
              </div>
              <div className="grid-2">
                <Field label="Courier" htmlFor="rr-awb-courier">
                  <input className="input" id="rr-awb-courier" name="awbCourier" />
                </Field>
                <Field label="Origin" htmlFor="rr-awb-origin">
                  <input className="input" id="rr-awb-origin" name="awbOrigin" />
                </Field>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Batch</h2>
        <div className="form">
          <Field label="Service type" htmlFor="rr-service-type" error={fields.serviceTypeId}>
            <select
              className="select"
              id="rr-service-type"
              value={serviceTypeId}
              onChange={(e) => chooseServiceType(e.target.value)}
            >
              <option value="">Choose the service type</option>
              {options.serviceTypes.map((s) => (
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
          <Field label="Notes" htmlFor="rr-notes" error={fields.notes}>
            <textarea className="textarea" id="rr-notes" name="notes" rows={2} />
          </Field>
        </div>
      </section>

      {st &&
        rows.map((r, i) => {
          const kit = kits.find((k) => k.id === r.productId);
          const vessel = options.vessels.find((v) => v.id === r.vesselId);
          const clients = vessel
            ? options.clients.filter((c) => vessel.clientIds.includes(c.id))
            : options.clients;
          const err = (f: string) => fields[`samples.${i}.${f}`];
          const id = (f: string) => `rr-${r.key}-${f}`;
          return (
            <section className="card" key={r.key} aria-labelledby={id('title')}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <h2 className="card-title" id={id('title')} style={{ margin: 0 }}>
                  Kit {i + 1}
                </h2>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="form">
                <div className="grid-2">
                  <Field
                    label="Serial number"
                    htmlFor={id('serial')}
                    hint="Optional"
                    error={err('serialNumber')}
                  >
                    <input
                      className="input"
                      id={id('serial')}
                      name={`serial-${r.key}`}
                      autoComplete="off"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Field>
                  <Field label="Kit" htmlFor={id('kit')} error={err('productId')}>
                    <select
                      className="select"
                      id={id('kit')}
                      value={r.productId}
                      onChange={(e) => update(r.key, { productId: e.target.value, variantId: '' })}
                    >
                      <option value="">Choose the kit</option>
                      {kits.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {kit && kit.variants.length > 0 && (
                  <Field label="Variant" htmlFor={id('variant')} error={err('variantId')}>
                    <select
                      className="select"
                      id={id('variant')}
                      value={r.variantId}
                      onChange={(e) => update(r.key, { variantId: e.target.value })}
                    >
                      <option value="">Choose the variant</option>
                      {kit.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="grid-2">
                  <Field
                    label={st.vesselRequired ? 'Vessel *' : 'Vessel'}
                    htmlFor={id('vessel')}
                    error={err('vesselId')}
                  >
                    <select
                      className="select"
                      id={id('vessel')}
                      value={r.vesselId}
                      onChange={(e) => chooseVessel(r, e.target.value)}
                    >
                      <option value="">
                        {st.vesselRequired ? 'Choose the vessel' : 'No vessel'}
                      </option>
                      {options.vessels.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.imoNumber ? ` · IMO ${v.imoNumber}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Client *" htmlFor={id('client')} error={err('clientId')}>
                    <select
                      className="select"
                      id={id('client')}
                      value={r.clientId}
                      onChange={(e) => update(r.key, { clientId: e.target.value })}
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
                <div className="grid-2">
                  <Field
                    label="Condition on arrival"
                    htmlFor={id('condition')}
                    error={err('condition')}
                  >
                    <select
                      className="select"
                      id={id('condition')}
                      name={`condition-${r.key}`}
                      defaultValue="OK"
                    >
                      {KIT_CONDITIONS.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Condition notes"
                    htmlFor={id('notes')}
                    error={err('conditionNotes')}
                  >
                    <input className="input" id={id('notes')} name={`notes-${r.key}`} />
                  </Field>
                </div>
                <CustomFieldInputs
                  key={`sample-${r.key}-${serviceTypeId}`}
                  definitions={sampleFields}
                  fields={fields}
                  scope={`samples.${i}`}
                  legend={null}
                />
              </div>
            </section>
          );
        })}

      {st ? (
        <div className="row">
          <button type="button" className="btn" onClick={addKit}>
            Add another kit
          </button>
          <span className="muted">Copies the kit type, vessel and client of the last kit.</span>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Choose the service type to add the package&apos;s kits.
        </p>
      )}

      <FormStatus error={error} fields={fields} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending || !st}>
          {pending
            ? 'Saving…'
            : `Receive & register ${rows.length} kit${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}
