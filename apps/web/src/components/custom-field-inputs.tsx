import type { CustomFieldDefinitionDto, CustomFieldValues } from '@flux/shared';
import { Field } from '@/components/field';

const PREFIX = 'cf:';

/** Inputs for a record's custom fields. Names are "cf:<key>"; read them back with customFieldPayload. */
export function CustomFieldInputs({
  definitions,
  values,
  fields,
  disabled,
}: {
  definitions: CustomFieldDefinitionDto[];
  values?: CustomFieldValues;
  /** Field errors from the API, keyed "customFields.<key>". */
  fields: Record<string, string>;
  disabled?: boolean;
}) {
  if (definitions.length === 0) return null;
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="card-title" style={{ marginBottom: 12 }}>
        Additional information
      </legend>
      {definitions.map((def) => {
        const id = `cf-${def.key}`;
        const name = `${PREFIX}${def.key}`;
        const current = values?.[def.key];
        const label = def.required ? `${def.label} *` : def.label;
        const common = {
          id,
          name,
          disabled,
          'aria-invalid': Boolean(fields[`customFields.${def.key}`]),
        };
        let control;
        switch (def.type) {
          case 'LONG_TEXT':
            control = (
              <textarea
                className="textarea"
                rows={3}
                defaultValue={(current as string) ?? ''}
                {...common}
              />
            );
            break;
          case 'NUMBER':
            control = (
              <input
                className="input"
                type="number"
                step="any"
                defaultValue={(current as number) ?? ''}
                {...common}
              />
            );
            break;
          case 'DATE':
            control = (
              <input
                className="input"
                type="date"
                defaultValue={(current as string) ?? ''}
                {...common}
              />
            );
            break;
          case 'BOOLEAN':
            control = (
              <select
                className="select"
                defaultValue={current === undefined || current === null ? '' : String(current)}
                {...common}
              >
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            );
            break;
          case 'SELECT':
            control = (
              <select className="select" defaultValue={(current as string) ?? ''} {...common}>
                <option value="">—</option>
                {def.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          default:
            control = (
              <input className="input" defaultValue={(current as string) ?? ''} {...common} />
            );
        }
        return (
          <Field
            key={def.id}
            label={label}
            htmlFor={id}
            hint={def.helpText ?? undefined}
            error={fields[`customFields.${def.key}`]}
          >
            {control}
          </Field>
        );
      })}
    </fieldset>
  );
}

/** Reads custom field inputs from a form: { key: value } with booleans parsed and "" for empty. */
export function customFieldPayload(data: FormData, definitions: CustomFieldDefinitionDto[]) {
  const result: Record<string, string | boolean> = {};
  for (const def of definitions) {
    const raw = String(data.get(`${PREFIX}${def.key}`) ?? '');
    result[def.key] = def.type === 'BOOLEAN' && raw !== '' ? raw === 'true' : raw;
  }
  return result;
}
