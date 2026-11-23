import type { RoleSummaryDto } from '@flux/shared';

/** Role picker used on user forms. Inactive roles are listed but marked. */
export function RoleCheckboxes({
  roles,
  selected,
  disabled,
}: {
  roles: RoleSummaryDto[];
  selected: readonly string[];
  disabled?: boolean;
}) {
  if (roles.length === 0) return <p className="muted">No roles defined yet.</p>;
  return (
    <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 8 }}>
        Roles
      </legend>
      {roles.map((role) => (
        <label key={role.id} className={`check ${role.isActive ? '' : 'check-muted'}`}>
          <input
            type="checkbox"
            name="roleIds"
            value={role.id}
            defaultChecked={selected.includes(role.id)}
            disabled={disabled}
          />
          <span>
            {role.name}
            {!role.isActive && ' (inactive, grants nothing)'}
            {role.description && (
              <>
                <br />
                <span className="muted">{role.description}</span>
              </>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
