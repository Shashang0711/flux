'use client';

import { EditDialog } from '@/components/edit-dialog';
import { useState, type FormEvent } from 'react';
import {
  CUSTOM_FIELD_TYPES,
  customFieldKeyFromLabel,
  type CustomFieldDefinitionDto,
  type CustomFieldType,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { optionsText, parseOptions } from '@/lib/field-options';
import styles from './custom-fields.module.css';

const typeName = (type: CustomFieldType) =>
  CUSTOM_FIELD_TYPES.find((t) => t.key === type)?.name ?? type;

export function AddCustomField({ entity }: { entity: string }) {
  const { pending, error, fields, run } = useMutation();
  const [type, setType] = useState<CustomFieldType>('TEXT');
  const [label, setLabel] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const help = String(data.get('helpText') ?? '').trim();
    await run(
      () =>
        apiFetch('/custom-fields', {
          method: 'POST',
          body: JSON.stringify({
            entity,
            label: data.get('label'),
            type,
            required: data.get('required') === 'on',
            helpText: help || null,
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
      <h2 className="card-title">Add a field</h2>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="grid-2">
          <Field
            label="Label"
            htmlFor="cf-new-label"
            hint={label ? `Key: ${customFieldKeyFromLabel(label)}` : 'Shown on forms'}
            error={fields.label}
          >
            <input
              className="input"
              id="cf-new-label"
              name="label"
              required
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Type" htmlFor="cf-new-type">
            <select
              className="select"
              id="cf-new-type"
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
        {type === 'SELECT' && (
          <Field
            label="Options"
            htmlFor="cf-new-options"
            hint="One per line"
            error={fields.options}
          >
            <textarea className="textarea" id="cf-new-options" name="options" rows={4} />
          </Field>
        )}
        <div className="grid-2">
          <Field label="Help text" htmlFor="cf-new-help" error={fields.helpText}>
            <input className="input" id="cf-new-help" name="helpText" />
          </Field>
          <Field label="Sort order" htmlFor="cf-new-sort" hint="Lower numbers are shown first">
            <input
              className="input"
              id="cf-new-sort"
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={0}
            />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" name="required" /> Required when creating a record
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

function EditField({ def }: { def: CustomFieldDefinitionDto }) {
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const help = String(data.get('helpText') ?? '').trim();
    await run(
      () =>
        apiFetch(`/custom-fields/${def.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            label: data.get('label'),
            required: data.get('required') === 'on',
            helpText: help || null,
            sortOrder: Number(data.get('sortOrder') || 0),
            isActive: data.get('isActive') === 'on',
            ...(def.type === 'SELECT'
              ? { options: parseOptions(String(data.get('options') ?? ''), def.options) }
              : {}),
          }),
        }),
      { success: 'Saved.' },
    );
  }
  const id = (f: string) => `cf-${def.id}-${f}`;
  return (
    <EditDialog title={`Edit field: ${def.label}`}>
      <form className="form" onSubmit={onSubmit} noValidate>
        <Field label="Label" htmlFor={id('label')} error={fields.label}>
          <input
            className="input"
            id={id('label')}
            name="label"
            defaultValue={def.label}
            required
          />
        </Field>
        {def.type === 'SELECT' && (
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
              defaultValue={optionsText(def.options)}
            />
          </Field>
        )}
        <Field label="Help text" htmlFor={id('help')}>
          <input
            className="input"
            id={id('help')}
            name="helpText"
            defaultValue={def.helpText ?? ''}
          />
        </Field>
        <Field label="Sort order" htmlFor={id('sort')}>
          <input
            className="input"
            id={id('sort')}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={def.sortOrder}
          />
        </Field>
        <label className="check">
          <input type="checkbox" name="required" defaultChecked={def.required} /> Required
        </label>
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={def.isActive} /> Active
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

export function CustomFieldList({ definitions }: { definitions: CustomFieldDefinitionDto[] }) {
  return (
    <DataTable
      label="Custom fields"
      rows={definitions}
      rowKey={(d) => d.id}
      empty="No custom fields yet."
      rowClassName={(d) => (d.isActive ? undefined : styles.inactive)}
      columns={[
        {
          header: 'Label',
          primary: true,
          cell: (d) => (
            <>
              {d.label}
              {d.helpText && <span className="cell-sub">{d.helpText}</span>}
            </>
          ),
        },
        { header: 'Key', cell: (d) => <code>{d.key}</code> },
        {
          header: 'Type',
          cell: (d) => (
            <>
              {typeName(d.type)}
              {d.type === 'SELECT' && (
                <span className="cell-sub">{d.options.map((o) => o.label).join(', ')}</span>
              )}
            </>
          ),
        },
        {
          header: 'Rules',
          cell: (d) =>
            d.required || !d.isActive ? (
              <span className="row">
                {d.required && <Badge tone="brand">Required</Badge>}
                {!d.isActive && <Badge>Inactive</Badge>}
              </span>
            ) : (
              <span className="muted">Optional</span>
            ),
        },
        { header: 'Actions', actions: true, cell: (d) => <EditField def={d} /> },
      ]}
    />
  );
}
