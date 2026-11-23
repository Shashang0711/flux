import { OPTIONAL_MODULE_KEYS, MODULES } from '@flux/shared';

/** Checkboxes for the optional (licensable) modules. Core modules are always included. */
export function ModuleCheckboxes({
  name,
  selected,
  disabled,
}: {
  name: string;
  selected: readonly string[];
  disabled?: boolean;
}) {
  return (
    <fieldset className="stack" style={{ gap: 10, border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 8 }}>
        Licensed modules
      </legend>
      {MODULES.filter((m) => OPTIONAL_MODULE_KEYS.includes(m.key)).map((module) => (
        <label key={module.key} className="check">
          <input
            type="checkbox"
            name={name}
            value={module.key}
            defaultChecked={selected.includes(module.key)}
            disabled={disabled}
          />
          <span>
            {module.name}
            <br />
            <span className="muted">{module.description}</span>
          </span>
        </label>
      ))}
      <p className="field-hint">Administration is always included.</p>
    </fieldset>
  );
}
