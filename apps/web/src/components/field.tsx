import type { ReactNode } from 'react';

/** Label + control + hint/error, with accessible wiring. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/**
 * Form-level feedback from useMutation. With field errors, it lists them all, so a problem is
 * never silent even when its field has no input on screen.
 */
export function FormStatus({
  error,
  success,
  fields,
}: {
  error: string | null;
  success?: string | null;
  fields?: Record<string, string>;
}) {
  const messages = Object.values(fields ?? {});
  if (messages.length > 0) {
    return (
      <div className="alert alert-error" role="alert">
        Please correct the following:
        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
          {[...new Set(messages)].map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (error) {
    return (
      <p className="alert alert-error" role="alert">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p className="alert alert-success" role="status">
        {success}
      </p>
    );
  }
  return null;
}
