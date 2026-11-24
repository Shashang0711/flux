import type { ClientDto, CustomFieldDefinitionDto } from '@flux/shared';
import { CustomFieldInputs, customFieldPayload } from '@/components/custom-field-inputs';
import { Field } from '@/components/field';

/** Client master fields, shared by the New client form and the Overview tab. */
export function ClientFields({
  client,
  fields,
  disabled,
  customFields = [],
}: {
  client?: ClientDto;
  fields: Record<string, string>;
  disabled?: boolean;
  /** Active custom field definitions for clients. */
  customFields?: CustomFieldDefinitionDto[];
}) {
  const input = (name: keyof ClientDto, label: string, type = 'text', hint?: string) => (
    <Field label={label} htmlFor={name} error={fields[name]} hint={hint}>
      <input
        className="input"
        id={name}
        name={name}
        type={type}
        defaultValue={(client?.[name] as string | null) ?? ''}
        disabled={disabled}
        required={name === 'name'}
      />
    </Field>
  );
  return (
    <>
      {input('name', 'Company name')}
      {input('tradingName', 'Trading name', 'text', 'If different from the company name')}
      <div className="grid-2">
        {input('email', 'Email', 'email')}
        {input('phone', 'Phone', 'tel')}
      </div>
      <div className="grid-2">
        {input('website', 'Website', 'url', 'e.g. https://example.com')}
        {input('taxNumber', 'Tax / VAT number')}
      </div>
      <Field label="Notes" htmlFor="notes" error={fields.notes}>
        <textarea
          className="textarea"
          id="notes"
          name="notes"
          rows={3}
          defaultValue={client?.notes ?? ''}
          disabled={disabled}
        />
      </Field>
      <CustomFieldInputs
        definitions={customFields}
        values={client?.customFields}
        fields={fields}
        disabled={disabled}
      />
    </>
  );
}

export function clientPayload(data: FormData, customFields: CustomFieldDefinitionDto[] = []) {
  const value = (key: string) => String(data.get(key) ?? '');
  return {
    name: value('name'),
    tradingName: value('tradingName'),
    email: value('email'),
    phone: value('phone'),
    website: value('website'),
    taxNumber: value('taxNumber'),
    notes: value('notes'),
    ...(customFields.length > 0 ? { customFields: customFieldPayload(data, customFields) } : {}),
  };
}
