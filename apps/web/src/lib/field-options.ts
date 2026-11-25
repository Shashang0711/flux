import { customFieldKeyFromLabel, type CustomFieldOption } from '@flux/shared';

/**
 * Dropdown options are edited one per line: "Label", or "value = Label" to keep a value fixed.
 * Values default to a key derived from the label, so existing options keep their values.
 */
export function parseOptions(
  text: string,
  existing: CustomFieldOption[] = [],
): CustomFieldOption[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [left, ...rest] = line.split('=');
      if (rest.length > 0) return { value: left!.trim(), label: rest.join('=').trim() };
      const match = existing.find((o) => o.label === line);
      return { value: match?.value ?? customFieldKeyFromLabel(line), label: line };
    });
}

export function optionsText(options: CustomFieldOption[]): string {
  return options.map((o) => `${o.value} = ${o.label}`).join('\n');
}
