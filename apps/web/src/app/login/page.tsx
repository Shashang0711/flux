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
    <div className={styles.page}>
      <section className={styles.brandPanel} aria-hidden="true">
        <div className={styles.brandRow}>
          <span className={styles.mark}>F</span>
          <span className={styles.wordmark}>FLUX</span>
        </div>
        <p className={styles.tagline}>Fluid &amp; Laboratory Unified eXchange</p>
        <ul className={styles.points}>
          <li>Clients, vessels and fleets in one place</li>
          <li>From kit receiving to published reports</li>
          <li>Every change recorded in the audit trail</li>
        </ul>
      </section>
      <main className={styles.main}>
        <div className={styles.compactBrand}>
          <span className={styles.mark}>F</span>
          <span className={styles.wordmark}>FLUX</span>
        </div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          Use the email address your organisation registered for you.
        </p>
        <LoginForm nextPath={nextPath} />
      </main>
    </div>
  );
}
