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

/** Form-level feedback from useMutation. */
export function FormStatus({ error, success }: { error: string | null; success?: string | null }) {
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
