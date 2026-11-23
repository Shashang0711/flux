import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/safe-redirect';
import { LoginForm } from './login-form';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in · FLUX' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>FLUX</h1>
      <p className={styles.subtitle}>Sign in to continue</p>
      <LoginForm nextPath={nextPath} />
    </main>
  );
}
