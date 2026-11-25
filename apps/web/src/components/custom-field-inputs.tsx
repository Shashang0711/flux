import type { CustomFieldDefinitionDto, CustomFieldValues } from '@flux/shared';
import { Field } from '@/components/field';

/** What an input needs from a field definition (custom fields and registration fields). */
export type InputDefinition = Pick<
  CustomFieldDefinitionDto,
  'id' | 'key' | 'label' | 'type' | 'required' | 'helpText' | 'options'
>;

/** Input names: "cf:<key>" for record custom fields, "<scope>:<key>" otherwise. */
const namePrefix = (scope: string) => (scope === 'customFields' ? 'cf:' : `${scope}:`);
const idFor = (scope: string, key: string) =>
  `${scope === 'customFields' ? 'cf' : scope.replace(/\./g, '-')}-${key}`;

/**
 * Inputs for tenant-defined fields. `scope` is the API's error path prefix ("customFields",
 * "batch", "samples.0"); read values back with customFieldPayload(data, definitions, scope).
 */
export function CustomFieldInputs({
  definitions,
  values,
  fields,
  disabled,
  scope = 'customFields',
  legend = 'Additional information',
}: {
  definitions: InputDefinition[];
  values?: CustomFieldValues;
  /** Field errors from the API, keyed "<scope>.<key>". */
  fields: Record<string, string>;
  disabled?: boolean;
  scope?: string;
  /** null for no legend. */
  legend?: string | null;
}) {
  if (definitions.length === 0) return null;
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      {legend && (
        <legend className="card-title" style={{ marginBottom: 12 }}>
          {legend}
        </legend>
      )}
      {definitions.map((def) => {
        const id = idFor(scope, def.key);
        const name = `${namePrefix(scope)}${def.key}`;
        const current = values?.[def.key];
        const label = def.required ? `${def.label} *` : def.label;
        const common = {
          id,
          name,
          disabled,
          'aria-invalid': Boolean(fields[`${scope}.${def.key}`]),
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
            error={fields[`${scope}.${def.key}`]}
          >
            {control}
          </Field>
        );
      })}
    </fieldset>
  );
}

/** Reads custom field inputs from a form: { key: value } with booleans parsed and "" for empty. */
export function customFieldPayload(
  data: FormData,
  definitions: InputDefinition[],
  scope = 'customFields',
) {
  const result: Record<string, string | boolean> = {};
  for (const def of definitions) {
    const raw = String(data.get(`${namePrefix(scope)}${def.key}`) ?? '');
    result[def.key] = def.type === 'BOOLEAN' && raw !== '' ? raw === 'true' : raw;
  }
  return result;
}
