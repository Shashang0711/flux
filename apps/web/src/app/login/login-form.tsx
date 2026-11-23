'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { UserDto } from '@flux/shared';
import { ApiError, apiFetch } from '@/lib/api';
import styles from './login.module.css';

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiFetch<UserDto>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.body.code === 'TOO_MANY_REQUESTS'
          ? 'Too many sign-in attempts. Please wait a minute and try again.'
          : err instanceof ApiError && err.status !== 0
            ? err.message
            : 'Could not reach FLUX. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={onSubmit} noValidate>
      <label className={styles.field}>
        <span>Email</span>
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button className={styles.button} type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
