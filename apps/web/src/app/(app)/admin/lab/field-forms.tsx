'use client';

import { useState, type FormEvent } from 'react';
import {
  CUSTOM_FIELD_TYPES,
  REGISTRATION_FIELD_SCOPES,
  customFieldKeyFromLabel,
  formatCustomFieldValue,
  type CustomFieldType,
  type RegistrationCheckResultDto,
  type RegistrationFieldDto,
  type RegistrationFieldScope,
  type ServiceTypeDto,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { CustomFieldInputs, customFieldPayload } from '@/components/custom-field-inputs';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { optionsText, parseOptions } from '@/lib/field-options';

const typeName = (t: CustomFieldType) => CUSTOM_FIELD_TYPES.find((x) => x.key === t)?.name ?? t;
const scopeName = (s: RegistrationFieldScope) =>
  REGISTRATION_FIELD_SCOPES.find((x) => x.key === s)?.name ?? s;

function AddField({ serviceType }: { serviceType: ServiceTypeDto }) {
  const { pending, error, fields, run } = useMutation();
  const [type, setType] = useState<CustomFieldType>('TEXT');
  const [label, setLabel] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await run(
      () =>
        apiFetch(`/lab/service-types/${serviceType.id}/fields`, {
          method: 'POST',
          body: JSON.stringify({
            label: data.get('label'),
            type,
            scope: data.get('scope'),
            required: data.get('required') === 'on',
            helpText: String(data.get('helpText') ?? ''),
            options: type === 'SELECT' ? parseOptions(String(data.get('options') ?? '')) : [],
            sortOrder: Number(data.get('sortOrder') || 0),
          }),
        }),
      {
        onSuccess: () => {
          form.reset();
          setType('TEXT');
          setLabel('');
        },
      },
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">Add a registration field</h2>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="grid-2">
          <Field
            label="Label"
            htmlFor="rf-new-label"
            hint={
              label ? `Key: ${customFieldKeyFromLabel(label)}` : 'Shown on the registration form'
            }
            error={fields.label ?? fields.key}
          >
            <input
              className="input"
              id="rf-new-label"
              name="label"
              required
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Type" htmlFor="rf-new-type">
            <select
              className="select"
              id="rf-new-type"
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="check-group">
          <legend>Entered</legend>
          {REGISTRATION_FIELD_SCOPES.map((s, i) => (
            <label key={s.key} className="check">
              <input type="radio" name="scope" value={s.key} defaultChecked={i === 1} />
              <span>
                {s.name}
                <span className="cell-sub">
                  {s.key === 'BATCH'
                    ? 'e.g. port of sampling — the same for every sample in the batch'
                    : 'e.g. sampling point, date sampled'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {type === 'SELECT' && (
          <Field
            label="Options"
            htmlFor="rf-new-options"
            hint="One per line"
            error={fields.options}
          >
            <textarea className="textarea" id="rf-new-options" name="options" rows={4} />
          </Field>
        )}
        <div className="grid-2">
          <Field label="Help text" htmlFor="rf-new-help" error={fields.helpText}>
            <input className="input" id="rf-new-help" name="helpText" />
          </Field>
          <Field label="Sort order" htmlFor="rf-new-sort" hint="Lower numbers are shown first">
            <input
              className="input"
              id="rf-new-sort"
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={0}
            />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" name="required" /> Required
        </label>
        <FormStatus error={error} fields={fields} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add field'}
          </button>
        </div>
      </form>
    </section>
  );
}

function EditField({ field }: { field: RegistrationFieldDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const id = (f: string) => `rf-${field.id}-${f}`;
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        apiFetch(`/lab/registration-fields/${field.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            label: data.get('label'),
            required: data.get('required') === 'on',
            helpText: String(data.get('helpText') ?? ''),
            sortOrder: Number(data.get('sortOrder') || 0),
            isActive: data.get('isActive') === 'on',
            ...(field.type === 'SELECT'
              ? { options: parseOptions(String(data.get('options') ?? ''), field.options) }
              : {}),
          }),
        }),
      { success: 'Saved.' },
    );
  }
  return (
    <EditDialog title={`Edit field: ${field.label}`}>
      <form className="form" onSubmit={onSubmit} noValidate>
        <p className="muted" style={{ margin: 0 }}>
          {typeName(field.type)} · {scopeName(field.scope).toLowerCase()} · key{' '}
          <code>{field.key}</code>
        </p>
        <Field label="Label" htmlFor={id('label')} error={fields.label}>
          <input className="input" id={id('label')} name="label" defaultValue={field.label} />
        </Field>
        {field.type === 'SELECT' && (
          <Field
            label="Options"
            htmlFor={id('options')}
            hint="value = Label, one per line"
            error={fields.options}
          >
            <textarea
              className="textarea"
              id={id('options')}
              name="options"
              rows={4}
              defaultValue={optionsText(field.options)}
            />
          </Field>
        )}
        <Field label="Help text" htmlFor={id('help')}>
          <input
            className="input"
            id={id('help')}
            name="helpText"
            defaultValue={field.helpText ?? ''}
          />
        </Field>
        <Field label="Sort order" htmlFor={id('sort')}>
          <input
            className="input"
            id={id('sort')}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={field.sortOrder}
          />
        </Field>
        <label className="check">
          <input type="checkbox" name="required" defaultChecked={field.required} /> Required
        </label>
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={field.isActive} /> Active
        </label>
        <FormStatus error={error} fields={fields} success={success} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </EditDialog>
  );
}

export function RegistrationFields({
  serviceType,
  canManage,
}: {
  serviceType: ServiceTypeDto;
  canManage: boolean;
}) {
  return (
    <div className="stack">
      <DataTable
        label="Registration fields"
        rows={serviceType.fields}
        rowKey={(f) => f.id}
        empty="No registration fields yet. Samples of this type will be registered with the standard details only."
        columns={[
          {
            header: 'Field',
            primary: true,
            cell: (f) => (
              <>
                {f.label} {f.required && <Badge tone="brand">Required</Badge>}{' '}
                {!f.isActive && <Badge>Inactive</Badge>}
                <span className="cell-sub">
                  <code>{f.key}</code>
                  {f.helpText ? ` · ${f.helpText}` : ''}
                </span>
              </>
            ),
          },
          { header: 'Entered', cell: (f) => scopeName(f.scope) },
          {
            header: 'Type',
            cell: (f) => (
              <>
                {typeName(f.type)}
                {f.type === 'SELECT' && (
                  <span className="cell-sub">{f.options.map((o) => o.label).join(', ')}</span>
                )}
              </>
            ),
          },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (f: RegistrationFieldDto) => <EditField field={f} />,
                },
              ]
            : []),
        ]}
      />
      {canManage && <AddField serviceType={serviceType} />}
      <p className="muted" style={{ margin: 0 }}>
        A field’s key, type and whether it is entered per batch or per sample can’t change after it
        is created, so registered values stay valid. Deactivate fields you no longer need.
      </p>
    </div>
  );
}

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * The registration form as the Lab will see it (M11), with the server's validation. Nothing is
 * saved: it calls the registration-check endpoint.
 */
export function RegistrationPreview({ serviceType }: { serviceType: ServiceTypeDto }) {
  const active = serviceType.fields.filter((f) => f.isActive);
  const batchFields = active.filter((f) => f.scope === 'BATCH');
  const sampleFields = active.filter((f) => f.scope === 'SAMPLE');
  const [samples, setSamples] = useState(2);
  const [result, setResult] = useState<RegistrationCheckResultDto | null>(null);
  const { pending, error, fields, run } = useMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setResult(null);
    await run(
      () =>
        apiFetch<RegistrationCheckResultDto>(
          `/lab/service-types/${serviceType.id}/registration-check`,
          {
            method: 'POST',
            body: JSON.stringify({
              batch: customFieldPayload(data, batchFields, 'batch'),
              samples: Array.from({ length: samples }, (_, i) =>
                customFieldPayload(data, sampleFields, `samples.${i}`),
              ),
            }),
          },
        ),
      { onSuccess: (res) => setResult(res.data), refresh: false },
    );
  }

  if (active.length === 0) {
    return (
      <p className="card muted" style={{ margin: 0 }}>
        This service type has no active registration fields to preview.
      </p>
    );
  }
  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        The form shown when registering a batch of {serviceType.name} samples. Try it: values are
        checked by the server exactly as at registration, but nothing is saved.
      </p>
      {batchFields.length > 0 && (
        <section className="card">
          <CustomFieldInputs
            definitions={batchFields}
            fields={fields}
            scope="batch"
            legend="Batch details"
          />
        </section>
      )}
      {sampleFields.length > 0 &&
        Array.from({ length: samples }, (_, i) => (
          <section className="card" key={i}>
            <CustomFieldInputs
              definitions={sampleFields}
              fields={fields}
              scope={`samples.${i}`}
              legend={`Sample ${i + 1}`}
            />
          </section>
        ))}
      {sampleFields.length > 0 && (
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => setSamples((n) => Math.min(n + 1, 10))}
          >
            Add a sample
          </button>
          {samples > 1 && (
            <button type="button" className="btn" onClick={() => setSamples((n) => n - 1)}>
              Remove last sample
            </button>
          )}
        </div>
      )}
      <FormStatus error={error} fields={fields} />
      {result && (
        <div className="alert alert-success" role="status">
          All values are valid.
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {batchFields.map((f) => (
              <li key={f.key}>
                {f.label}: {formatCustomFieldValue(f, result.batch[f.key])}
              </li>
            ))}
            {result.samples.map((s, i) => (
              <li key={i}>
                Sample {i + 1}:{' '}
                {sampleFields
                  .map((f) => `${f.label} ${formatCustomFieldValue(f, s[f.key])}`)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Check values'}
        </button>
      </div>
    </form>
  );
}
