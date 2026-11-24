'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { CustomFieldDefinitionDto, ReferenceItemDto, VesselDto } from '@flux/shared';
import {
  ClientLinkFields,
  clientLinkPayload,
  type ClientLinkOptions,
} from '@/components/client-link-fields';
import { CustomFieldInputs, customFieldPayload } from '@/components/custom-field-inputs';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

export interface VesselFormOptions {
  vesselTypes: ReferenceItemDto[];
  classificationSocieties: ReferenceItemDto[];
  customFields: CustomFieldDefinitionDto[];
}

/** Choices for a reference dropdown; keeps a vessel's current value even if it is now hidden. */
function choices(
  items: ReferenceItemDto[],
  current: { id: string; name: string } | null | undefined,
) {
  return current && !items.some((i) => i.id === current.id)
    ? [{ id: current.id, name: current.name }, ...items]
    : items;
}

/** Create (no vessel) or edit (vessel given) form for the vessel master record. */
export function VesselForm({
  vessel,
  options,
  disabled,
  linkOptions,
}: {
  vessel?: VesselDto;
  options: VesselFormOptions;
  disabled?: boolean;
  /** Create mode only: optionally link the new vessel to a client and fleet. */
  linkOptions?: ClientLinkOptions | null;
}) {
  const router = useRouter();
  const { pending, error, fields, errorBody, success, run } = useMutation();
  const existing = (
    errorBody?.details as
      { existingVessel?: { id: string; code: string; name: string } } | undefined
  )?.existingVessel;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const v = (k: string) => String(data.get(k) ?? '').trim();
    const payload = {
      name: v('name'),
      imoNumber: v('imoNumber'),
      previousName: v('previousName'),
      callSign: v('callSign'),
      vesselTypeId: v('vesselTypeId'),
      classificationSocietyId: v('classificationSocietyId'),
      yearBuilt: v('yearBuilt'),
      grossTonnage: v('grossTonnage'),
      deadweight: v('deadweight'),
      ...(options.customFields.length > 0
        ? { customFields: customFieldPayload(data, options.customFields) }
        : {}),
      ...(!vessel && linkOptions && clientLinkPayload(data, 'relationship.')
        ? { relationship: clientLinkPayload(data, 'relationship.') }
        : {}),
    };
    await run(
      () =>
        apiFetch<VesselDto>(vessel ? `/vessels/${vessel.id}` : '/vessels', {
          method: vessel ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        }),
      vessel
        ? { success: 'Saved.' }
        : {
            onSuccess: ({ data: created }) => router.push(`/admin/vessels/${created.id}`),
            refresh: false,
          },
    );
  }

  const text = (name: keyof VesselDto, label: string, hint?: string, type = 'text') => (
    <Field label={label} htmlFor={name} hint={hint} error={fields[name]}>
      <input
        className="input"
        id={name}
        name={name}
        type={type}
        defaultValue={(vessel?.[name] as string | number | null) ?? ''}
        disabled={disabled}
        required={name === 'name'}
      />
    </Field>
  );

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="grid-2">
        {text('name', 'Vessel name')}
        {text('imoNumber', 'IMO number', '7 digits, e.g. 9074729')}
      </div>
      {existing && (
        <p className="alert alert-warn" role="status">
          This ship is already registered as{' '}
          <Link href={`/admin/vessels/${existing.id}`}>
            {existing.code} {existing.name}
          </Link>
          . Open it instead of creating a duplicate.
        </p>
      )}
      <div className="grid-2">
        {text('previousName', 'Previous name')}
        {text('callSign', 'Call sign')}
      </div>
      <div className="grid-2">
        <Field label="Vessel type" htmlFor="vesselTypeId" error={fields.vesselTypeId}>
          <select
            className="select"
            id="vesselTypeId"
            name="vesselTypeId"
            defaultValue={vessel?.vesselType?.id ?? ''}
            disabled={disabled}
          >
            <option value="">—</option>
            {choices(options.vesselTypes, vessel?.vesselType).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Classification society"
          htmlFor="classificationSocietyId"
          error={fields.classificationSocietyId}
        >
          <select
            className="select"
            id="classificationSocietyId"
            name="classificationSocietyId"
            defaultValue={vessel?.classificationSociety?.id ?? ''}
            disabled={disabled}
          >
            <option value="">—</option>
            {choices(options.classificationSocieties, vessel?.classificationSociety).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        {text('yearBuilt', 'Year built', undefined, 'number')}
        {text('grossTonnage', 'Gross tonnage', undefined, 'number')}
      </div>
      <div className="grid-2">
        {text('deadweight', 'Deadweight (t)', undefined, 'number')}
        <span />
      </div>
      <CustomFieldInputs
        definitions={options.customFields}
        values={vessel?.customFields}
        fields={fields}
        disabled={disabled}
      />
      {!vessel && linkOptions && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="card-title" style={{ marginBottom: 12 }}>
            Link to a client (optional)
          </legend>
          <ClientLinkFields
            options={linkOptions}
            fields={fields}
            prefix="relationship."
            required={false}
          />
        </fieldset>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      {!disabled && (
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : vessel ? 'Save' : 'Create vessel'}
          </button>
        </div>
      )}
    </form>
  );
}
