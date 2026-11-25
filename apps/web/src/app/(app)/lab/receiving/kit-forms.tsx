'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import {
  KIT_CONDITIONS,
  type AirwayBillDto,
  type KitCondition,
  type ReceivedKitDto,
  type ReceivingOptionsDto,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

// ─── Kit fields (receive and edit) ──────────────────────────────────────────

interface KitValues {
  productId: string;
  variantId: string;
  serviceTypeId: string;
  vesselId: string;
  clientId: string;
}

const EMPTY: KitValues = {
  productId: '',
  variantId: '',
  serviceTypeId: '',
  vesselId: '',
  clientId: '',
};

/**
 * Kit type and links. Choosing a kit narrows its variants and service types (a single service
 * type is chosen automatically); choosing a vessel narrows the clients to the vessel's and
 * selects its primary client.
 */
function KitFields({
  idPrefix,
  options,
  values,
  onChange,
  fields,
}: {
  idPrefix: string;
  options: ReceivingOptionsDto;
  values: KitValues;
  onChange: (v: KitValues) => void;
  fields: Record<string, string>;
}) {
  const kit = options.kits.find((k) => k.id === values.productId);
  const vessel = options.vessels.find((v) => v.id === values.vesselId);
  const clients = vessel
    ? options.clients.filter((c) => vessel.clientIds.includes(c.id))
    : options.clients;
  const id = (f: string) => `${idPrefix}-${f}`;

  function setKit(productId: string) {
    const k = options.kits.find((x) => x.id === productId);
    onChange({
      ...values,
      productId,
      variantId: '',
      serviceTypeId: k?.serviceTypes.length === 1 ? k.serviceTypes[0]!.id : '',
    });
  }
  function setVessel(vesselId: string) {
    const v = options.vessels.find((x) => x.id === vesselId);
    const keep = v ? v.clientIds.includes(values.clientId) : true;
    onChange({
      ...values,
      vesselId,
      clientId: keep && values.clientId ? values.clientId : (v?.primaryClientId ?? ''),
    });
  }

  return (
    <>
      <div className="grid-2">
        <Field label="Kit" htmlFor={id('product')} error={fields.productId}>
          <select
            className="select"
            id={id('product')}
            value={values.productId}
            onChange={(e) => setKit(e.target.value)}
          >
            <option value="">Choose the kit</option>
            {options.kits.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
        {kit && kit.variants.length > 0 && (
          <Field label="Variant" htmlFor={id('variant')} error={fields.variantId}>
            <select
              className="select"
              id={id('variant')}
              value={values.variantId}
              onChange={(e) => onChange({ ...values, variantId: e.target.value })}
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
        {kit && kit.serviceTypes.length > 1 && (
          <Field
            label="Service type"
            htmlFor={id('service')}
            hint="Can also be chosen at registration"
            error={fields.serviceTypeId}
          >
            <select
              className="select"
              id={id('service')}
              value={values.serviceTypeId}
              onChange={(e) => onChange({ ...values, serviceTypeId: e.target.value })}
            >
              <option value="">Not known yet</option>
              {kit.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {(options.vessels.length > 0 || options.clients.length > 0) && (
        <div className="grid-2">
          {options.vessels.length > 0 && (
            <Field
              label="Vessel"
              htmlFor={id('vessel')}
              hint="Optional; can be linked later"
              error={fields.vesselId}
            >
              <select
                className="select"
                id={id('vessel')}
                value={values.vesselId}
                onChange={(e) => setVessel(e.target.value)}
              >
                <option value="">Not linked</option>
                {options.vessels.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.imoNumber ? ` · IMO ${v.imoNumber}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {options.clients.length > 0 && (
            <Field label="Client" htmlFor={id('client')} error={fields.clientId}>
              <select
                className="select"
                id={id('client')}
                value={values.clientId}
                onChange={(e) => onChange({ ...values, clientId: e.target.value })}
              >
                <option value="">{vessel ? 'Choose the client' : 'Not known yet'}</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
    </>
  );
}

function ConditionFields({
  idPrefix,
  condition,
  notes,
  fields,
}: {
  idPrefix: string;
  condition?: KitCondition;
  notes?: string | null;
  fields: Record<string, string>;
}) {
  return (
    <div className="grid-2">
      <Field
        label="Condition on arrival"
        htmlFor={`${idPrefix}-condition`}
        error={fields.condition}
      >
        <select
          className="select"
          id={`${idPrefix}-condition`}
          name="condition"
          defaultValue={condition ?? 'OK'}
        >
          {KIT_CONDITIONS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Condition notes" htmlFor={`${idPrefix}-notes`} error={fields.conditionNotes}>
        <input
          className="input"
          id={`${idPrefix}-notes`}
          name="conditionNotes"
          defaultValue={notes ?? ''}
        />
      </Field>
    </div>
  );
}

const payload = (values: KitValues, data: FormData) => ({
  ...values,
  serialNumber: String(data.get('serialNumber') ?? ''),
  condition: data.get('condition'),
  conditionNotes: String(data.get('conditionNotes') ?? ''),
});

/**
 * Receives kits one by one. Kit type, vessel and client stay selected for the next kit, and the
 * serial field takes the focus again, so a barcode scanner (which ends with Enter) can receive a
 * box of identical kits quickly.
 */
export function ReceiveKitForm({
  awb,
  options,
}: {
  awb: AirwayBillDto;
  options: ReceivingOptionsDto;
}) {
  const [values, setValues] = useState<KitValues>(() =>
    options.kits.length === 1 ? { ...EMPTY, productId: options.kits[0]!.id } : EMPTY,
  );
  const [last, setLast] = useState<ReceivedKitDto | null>(null);
  const serial = useRef<HTMLInputElement>(null);
  const { pending, error, fields, run } = useMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await run(
      () =>
        apiFetch<ReceivedKitDto>(`/receiving/airway-bills/${awb.id}/kits`, {
          method: 'POST',
          body: JSON.stringify(payload(values, new FormData(form))),
        }),
      {
        onSuccess: (res) => {
          setLast(res.data);
          (form.elements.namedItem('serialNumber') as HTMLInputElement).value = '';
          (form.elements.namedItem('conditionNotes') as HTMLInputElement).value = '';
          (form.elements.namedItem('condition') as HTMLSelectElement).value = 'OK';
          serial.current?.focus();
        },
      },
    );
  }
  if (options.kits.length === 0) {
    return (
      <p className="alert" style={{ margin: 0 }}>
        No active kits are set up yet. Kits are defined under Lab setup → Kits.
      </p>
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Receive a kit</h2>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field
          label="Serial number"
          htmlFor="rk-serial"
          hint="As printed on the kit; scan it or type it. Optional."
          error={fields.serialNumber}
        >
          <input
            ref={serial}
            className="input"
            id="rk-serial"
            name="serialNumber"
            autoComplete="off"
            autoCapitalize="characters"
            style={{ textTransform: 'uppercase' }}
            autoFocus
          />
        </Field>
        <KitFields
          idPrefix="rk"
          options={options}
          values={values}
          onChange={setValues}
          fields={fields}
        />
        <ConditionFields idPrefix="rk" fields={fields} />
        <FormStatus error={error} fields={fields} />
        {last && !error && (
          <p className="alert alert-success" role="status" style={{ margin: 0 }}>
            Received {last.code}
            {last.serialNumber ? ` (${last.serialNumber})` : ''} — {last.product.name}
            {last.variant ? ` ${last.variant.name}` : ''}. Ready for the next kit.
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Receiving…' : 'Receive kit'}
          </button>
        </div>
      </form>
    </section>
  );
}

function EditKitForm({ kit, options }: { kit: ReceivedKitDto; options: ReceivingOptionsDto }) {
  // Keep the kit's current items selectable even if they have become inactive since.
  const withCurrent: ReceivingOptionsDto = {
    ...options,
    kits: options.kits.some((k) => k.id === kit.product.id)
      ? options.kits
      : [
          ...options.kits,
          {
            ...kit.product,
            variants: kit.variant ? [kit.variant] : [],
            serviceTypes: kit.serviceType ? [kit.serviceType] : [],
          },
        ],
  };
  const [values, setValues] = useState<KitValues>({
    productId: kit.product.id,
    variantId: kit.variant?.id ?? '',
    serviceTypeId: kit.serviceType?.id ?? '',
    vesselId: kit.vessel?.id ?? '',
    clientId: kit.client?.id ?? '',
  });
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(
      () =>
        apiFetch(`/receiving/kits/${kit.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload(values, new FormData(event.currentTarget))),
        }),
      { success: 'Saved.' },
    );
  }
  const prefix = `edit-${kit.id}`;
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field label="Serial number" htmlFor={`${prefix}-serial`} error={fields.serialNumber}>
        <input
          className="input"
          id={`${prefix}-serial`}
          name="serialNumber"
          defaultValue={kit.serialNumber ?? ''}
          style={{ textTransform: 'uppercase' }}
        />
      </Field>
      <KitFields
        idPrefix={prefix}
        options={withCurrent}
        values={values}
        onChange={setValues}
        fields={fields}
      />
      <ConditionFields
        idPrefix={prefix}
        condition={kit.condition}
        notes={kit.conditionNotes}
        fields={fields}
      />
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function CancelKitForm({ kit }: { kit: ReceivedKitDto }) {
  const { pending, error, fields, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    await run(() =>
      apiFetch(`/receiving/kits/${kit.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        The kit leaves the registration queue. Its record and the reason stay in the history, and
        its serial number can be received again.
      </p>
      <Field label="Reason" htmlFor={`cancel-${kit.id}`} error={fields.reason}>
        <input
          className="input"
          id={`cancel-${kit.id}`}
          name="reason"
          placeholder="e.g. Scanned twice"
        />
      </Field>
      <FormStatus error={error} fields={fields} />
      <div className="form-actions">
        <button className="btn btn-danger" type="submit" disabled={pending}>
          {pending ? 'Cancelling…' : 'Cancel kit'}
        </button>
      </div>
    </form>
  );
}

// ─── Kit table ──────────────────────────────────────────────────────────────

const MISSING = { serviceType: 'Service type', client: 'Client', vessel: 'Vessel' } as const;

export function ConditionBadge({ condition }: { condition: KitCondition }) {
  const name = KIT_CONDITIONS.find((c) => c.key === condition)?.name ?? condition;
  return condition === 'OK' ? <Badge tone="ok">OK</Badge> : <Badge tone="warn">{name}</Badge>;
}

function StatusCell({ kit }: { kit: ReceivedKitDto }) {
  if (kit.status === 'CANCELLED') {
    return (
      <>
        <Badge>Cancelled</Badge>
        <span className="cell-sub">{kit.cancelReason}</span>
      </>
    );
  }
  if (kit.status === 'REGISTERED') return <Badge tone="ok">Registered</Badge>;
  return (
    <>
      <Badge tone="brand">Awaiting registration</Badge>
      {kit.missing.length > 0 && (
        <span className="cell-sub">Missing: {kit.missing.map((m) => MISSING[m]).join(', ')}</span>
      )}
    </>
  );
}

export function KitTable({
  kits,
  options,
  canReceive,
  showAirwayBill = false,
  empty,
}: {
  kits: ReceivedKitDto[];
  options: ReceivingOptionsDto | null;
  canReceive: boolean;
  showAirwayBill?: boolean;
  empty: string;
}) {
  return (
    <DataTable
      label="Received kits"
      rows={kits}
      rowKey={(k) => k.id}
      empty={empty}
      rowClassName={(k) => (k.status === 'CANCELLED' ? 'row-muted' : undefined)}
      columns={[
        {
          header: 'Kit ID',
          primary: true,
          cell: (k) => (
            <>
              <code>{k.code}</code>
              {k.serialNumber && <span className="cell-sub">Serial {k.serialNumber}</span>}
              {showAirwayBill && (
                <span className="cell-sub">
                  <Link href={`/lab/receiving/${k.airwayBill.id}`}>AWB {k.airwayBill.number}</Link>{' '}
                  · {new Date(k.receivedAt).toLocaleDateString('en-GB')}
                </span>
              )}
            </>
          ),
        },
        {
          header: 'Kit',
          cell: (k) => (
            <>
              {k.product.name}
              {k.variant && <span className="cell-sub">{k.variant.name}</span>}
            </>
          ),
        },
        {
          header: 'Service type',
          cell: (k) => k.serviceType?.name ?? <span className="muted">Not chosen</span>,
        },
        {
          header: 'Vessel / client',
          cell: (k) =>
            k.vessel || k.client ? (
              <>
                {k.vessel?.name ?? <span className="muted">No vessel</span>}
                {k.client && <span className="cell-sub">{k.client.name}</span>}
              </>
            ) : (
              <Badge>Unlinked</Badge>
            ),
        },
        {
          header: 'Condition',
          cell: (k) => (
            <>
              <ConditionBadge condition={k.condition} />
              {k.conditionNotes && <span className="cell-sub">{k.conditionNotes}</span>}
            </>
          ),
        },
        { header: 'Status', cell: (k) => <StatusCell kit={k} /> },
        ...(canReceive && options
          ? [
              {
                header: 'Actions',
                actions: true,
                cell: (k: ReceivedKitDto) =>
                  k.status === 'PENDING_REGISTRATION' && (
                    <>
                      <EditDialog title={`Edit ${k.code}`}>
                        <EditKitForm kit={k} options={options} />
                      </EditDialog>
                      <EditDialog title={`Cancel ${k.code}`} label="Cancel">
                        <CancelKitForm kit={k} />
                      </EditDialog>
                    </>
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}

// ─── Airway bill ────────────────────────────────────────────────────────────

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export function AirwayBillForm({ awb }: { awb?: AirwayBillDto }) {
  const router = useRouter();
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      number: text(data, 'number'),
      courier: text(data, 'courier'),
      origin: text(data, 'origin'),
      receivedOn: text(data, 'receivedOn'),
      notes: text(data, 'notes'),
    };
    await run(
      () =>
        apiFetch<AirwayBillDto>(
          awb ? `/receiving/airway-bills/${awb.id}` : '/receiving/airway-bills',
          {
            method: awb ? 'PATCH' : 'POST',
            body: JSON.stringify(body),
          },
        ),
      {
        success: awb ? 'Saved.' : undefined,
        onSuccess: (res) => !awb && router.push(`/lab/receiving/${res.data.id}`),
      },
    );
  }
  const prefix = awb ? `awb-${awb.id}` : 'awb-new';
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="grid-2">
        <Field label="AWB number" htmlFor={`${prefix}-number`} error={fields.number}>
          <input
            className="input"
            id={`${prefix}-number`}
            name="number"
            defaultValue={awb?.number}
            autoFocus={!awb}
          />
        </Field>
        <Field label="Date received" htmlFor={`${prefix}-date`} error={fields.receivedOn}>
          <input
            className="input"
            id={`${prefix}-date`}
            name="receivedOn"
            type="date"
            defaultValue={awb?.receivedOn ?? new Date().toISOString().slice(0, 10)}
          />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Courier" htmlFor={`${prefix}-courier`} error={fields.courier}>
          <input
            className="input"
            id={`${prefix}-courier`}
            name="courier"
            defaultValue={awb?.courier ?? ''}
          />
        </Field>
        <Field
          label="Origin"
          htmlFor={`${prefix}-origin`}
          hint="Port or country it came from"
          error={fields.origin}
        >
          <input
            className="input"
            id={`${prefix}-origin`}
            name="origin"
            defaultValue={awb?.origin ?? ''}
          />
        </Field>
      </div>
      <Field label="Notes" htmlFor={`${prefix}-notes`} error={fields.notes}>
        <textarea
          className="textarea"
          id={`${prefix}-notes`}
          name="notes"
          rows={2}
          defaultValue={awb?.notes ?? ''}
        />
      </Field>
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : awb ? 'Save' : 'Start receiving'}
        </button>
      </div>
    </form>
  );
}

export function AirwayBillActions({ awb }: { awb: AirwayBillDto }) {
  const { pending, error, run } = useMutation();
  const open = awb.status === 'OPEN';
  return (
    <>
      <EditDialog title={`Edit AWB ${awb.number}`} label="Edit details">
        <AirwayBillForm awb={awb} />
      </EditDialog>
      <button
        type="button"
        className={open ? 'btn btn-primary' : 'btn'}
        disabled={pending}
        onClick={() =>
          run(() =>
            apiFetch(`/receiving/airway-bills/${awb.id}/${open ? 'close' : 'reopen'}`, {
              method: 'POST',
            }),
          )
        }
      >
        {open ? 'Close airway bill' : 'Reopen'}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
