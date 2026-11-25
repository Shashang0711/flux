import {
  formatCustomFieldValue,
  type CustomFieldValues,
  type RegistrationFieldDto,
} from '@flux/shared';

/** Registration values as label/value pairs, in field order; fields without a value are skipped. */
export function FieldValues({
  fields,
  values,
  empty = 'No details recorded.',
}: {
  fields: RegistrationFieldDto[];
  values: CustomFieldValues;
  empty?: string;
}) {
  const shown = fields.filter((f) => values[f.key] !== undefined && values[f.key] !== null);
  if (shown.length === 0)
    return (
      <p className="muted" style={{ margin: 0 }}>
        {empty}
      </p>
    );
  return (
    <dl className="details">
      {shown.map((f) => (
        <div key={f.key}>
          <dt>{f.label}</dt>
          <dd>{formatCustomFieldValue(f, values[f.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Sampling point: Intake · Date sampled: 2026-11-20" for table cells. */
export function fieldSummary(fields: RegistrationFieldDto[], values: CustomFieldValues): string {
  return fields
    .filter((f) => values[f.key] !== undefined && values[f.key] !== null)
    .map((f) => `${f.label}: ${formatCustomFieldValue(f, values[f.key])}`)
    .join(' · ');
}
