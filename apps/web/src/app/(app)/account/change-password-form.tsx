'use client';

import { useRef, useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

export function ChangePasswordForm() {
  const form = useRef<HTMLFormElement>(null);
  const { pending, error, fields, success, run } = useMutation();
  const [mismatch, setMismatch] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get('newPassword'));
    if (newPassword !== data.get('confirmPassword')) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    await run(
      () =>
        apiFetch<void>('/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword }),
        }),
      {
        success: 'Password changed. Your other sessions have been signed out.',
        onSuccess: () => form.current?.reset(),
        refresh: false,
      },
    );
  }

  return (
    <form ref={form} className="form" onSubmit={onSubmit} noValidate>
      <Field label="Current password" htmlFor="currentPassword" error={fields.currentPassword}>
        <input
          className="input"
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field
        label="New password"
        htmlFor="newPassword"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
        error={fields.newPassword}
      >
        <input
          className="input"
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </Field>
      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={mismatch ? 'Passwords do not match' : undefined}
      >
        <input
          className="input"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <FormStatus error={Object.keys(fields).length > 0 ? null : error} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
