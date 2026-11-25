'use client';

import { useState, type FormEvent } from 'react';
import {
  PARAMETER_TYPES,
  rangeLabel,
  type ParameterType,
  type ServiceTypeDto,
  type TestParameterDto,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

const typeName = (t: ParameterType) => PARAMETER_TYPES.find((x) => x.key === t)?.name ?? t;
const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

function ParameterForm({
  serviceType,
  parameter,
}: {
  serviceType: ServiceTypeDto;
  parameter?: TestParameterDto;
}) {
  const { pending, error, fields, success, run } = useMutation();
  const [type, setType] = useState<ParameterType>(parameter?.type ?? 'NUMBER');
  const id = (f: string) => `${parameter ? `p-${parameter.id}` : 'p-new'}-${f}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      name: text(data, 'name'),
      unit: text(data, 'unit'),
      method: text(data, 'method'),
      required: data.get('required') === 'on',
      sortOrder: Number(data.get('sortOrder') || 0),
      ...(type === 'NUMBER'
        ? {
            decimals: text(data, 'decimals'),
            cautionMin: text(data, 'cautionMin'),
            cautionMax: text(data, 'cautionMax'),
            criticalMin: text(data, 'criticalMin'),
            criticalMax: text(data, 'criticalMax'),
          }
        : {}),
      ...(type === 'CHOICE'
        ? {
            options: text(data, 'options')
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
      ...(parameter ? { isActive: data.get('isActive') === 'on' } : { type }),
    };
    await run(
      () =>
        apiFetch(
          parameter
            ? `/lab/parameters/${parameter.id}`
            : `/lab/service-types/${serviceType.id}/parameters`,
          {
            method: parameter ? 'PATCH' : 'POST',
            body: JSON.stringify(body),
          },
        ),
      {
        success: parameter ? 'Saved.' : undefined,
        onSuccess: () => {
          if (!parameter) form.reset();
        },
      },
    );
  }
  const num = (
    name: 'cautionMin' | 'cautionMax' | 'criticalMin' | 'criticalMax',
    label: string,
  ) => (
    <Field label={label} htmlFor={id(name)} error={fields[name]}>
      <input
        className="input"
        id={id(name)}
        name={name}
        inputMode="decimal"
        defaultValue={parameter?.[name] ?? ''}
      />
    </Field>
  );

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="grid-2">
        <Field label="Name" htmlFor={id('name')} error={fields.name}>
          <input className="input" id={id('name')} name="name" defaultValue={parameter?.name} />
        </Field>
        <Field
          label="Type"
          htmlFor={id('type')}
          hint={parameter ? `Key ${parameter.key}; key and type are fixed` : undefined}
        >
          <select
            className="select"
            id={id('type')}
            value={type}
            disabled={Boolean(parameter)}
            onChange={(e) => setType(e.target.value as ParameterType)}
          >
            {PARAMETER_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field
          label="Unit"
          htmlFor={id('unit')}
          hint="e.g. cSt, mg/l, cfu/100 ml"
          error={fields.unit}
        >
          <input
            className="input"
            id={id('unit')}
            name="unit"
            defaultValue={parameter?.unit ?? ''}
          />
        </Field>
        <Field label="Method" htmlFor={id('method')} hint="e.g. ASTM D445" error={fields.method}>
          <input
            className="input"
            id={id('method')}
            name="method"
            defaultValue={parameter?.method ?? ''}
          />
        </Field>
      </div>
      {type === 'NUMBER' && (
        <>
          <Field
            label="Decimal places"
            htmlFor={id('decimals')}
            hint="0–6; empty for any"
            error={fields.decimals}
          >
            <input
              className="input"
              id={id('decimals')}
              name="decimals"
              type="number"
              min={0}
              max={6}
              defaultValue={parameter?.decimals ?? ''}
              style={{ maxWidth: 140 }}
            />
          </Field>
          <fieldset className="check-group">
            <legend>Limits (acceptable range; outside is flagged)</legend>
            <div className="grid-2">
              {num('cautionMin', 'Caution below')}
              {num('cautionMax', 'Caution above')}
            </div>
            <div className="grid-2">
              {num('criticalMin', 'Critical below')}
              {num('criticalMax', 'Critical above')}
            </div>
          </fieldset>
        </>
      )}
      {type === 'CHOICE' && (
        <Field label="Choices" htmlFor={id('options')} hint="One per line" error={fields.options}>
          <textarea
            className="textarea"
            id={id('options')}
            name="options"
            rows={4}
            defaultValue={parameter?.options.join('\n')}
          />
        </Field>
      )}
      <div className="grid-2">
        <Field label="Sort order" htmlFor={id('sort')}>
          <input
            className="input"
            id={id('sort')}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={parameter?.sortOrder ?? 0}
          />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" name="required" defaultChecked={parameter?.required} /> Required
        before results can be completed
      </label>
      {parameter && (
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={parameter.isActive} /> Active
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : parameter ? 'Save' : 'Add parameter'}
        </button>
      </div>
    </form>
  );
}

function limitsLabel(p: TestParameterDto): string {
  const caution = rangeLabel(p.cautionMin, p.cautionMax);
  const critical = rangeLabel(p.criticalMin, p.criticalMax);
  return [caution && `normal ${caution}`, critical && `critical outside ${critical}`]
    .filter(Boolean)
    .join(' · ');
}

export function Parameters({
  serviceType,
  canManage,
}: {
  serviceType: ServiceTypeDto;
  canManage: boolean;
}) {
  return (
    <div className="stack">
      <DataTable
        label="Test parameters"
        rows={serviceType.parameters}
        rowKey={(p) => p.id}
        empty="No test parameters yet. Results are entered against these."
        rowClassName={(p) => (p.isActive ? undefined : 'row-muted')}
        columns={[
          {
            header: 'Parameter',
            primary: true,
            cell: (p) => (
              <>
                {p.name} {p.required && <Badge tone="brand">Required</Badge>}{' '}
                {!p.isActive && <Badge>Inactive</Badge>}
                <span className="cell-sub">
                  <code>{p.key}</code>
                  {p.method ? ` · ${p.method}` : ''}
                </span>
              </>
            ),
          },
          {
            header: 'Type',
            cell: (p) => (
              <>
                {typeName(p.type)}
                {p.unit && <span className="cell-sub">{p.unit}</span>}
                {p.type === 'CHOICE' && <span className="cell-sub">{p.options.join(', ')}</span>}
              </>
            ),
          },
          { header: 'Limits', cell: (p) => limitsLabel(p) || <span className="muted">None</span> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (p: TestParameterDto) => (
                    <EditDialog title={`Edit ${p.name}`}>
                      <ParameterForm serviceType={serviceType} parameter={p} />
                    </EditDialog>
                  ),
                },
              ]
            : []),
        ]}
      />
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add a test parameter</h2>
          <ParameterForm serviceType={serviceType} />
        </section>
      )}
    </div>
  );
}
