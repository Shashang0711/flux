import type { HealthStatus } from '@flux/shared';
import { ApiError, apiFetch } from '@/lib/api';
import styles from './page.module.css';

// Always render on request so the status reflects the live API.
export const dynamic = 'force-dynamic';

async function loadHealth(): Promise<{ health?: HealthStatus; error?: string }> {
  try {
    const { data } = await apiFetch<HealthStatus>('/health', { cache: 'no-store' });
    return { health: data };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Unknown error' };
  }
}

export default async function HomePage() {
  const { health, error } = await loadHealth();

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>FLUX</h1>
      <p className={styles.subtitle}>Fluid &amp; Laboratory Unified eXchange</p>

      <section className={styles.card} aria-label="System status">
        <div className={styles.row}>
          <span className={styles.label}>API</span>
          {health ? (
            <span className={styles.ok}>Online · v{health.version}</span>
          ) : (
            <span className={styles.bad}>Unavailable</span>
          )}
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Database</span>
          {health ? (
            <span className={styles.ok}>Up</span>
          ) : (
            <span className={styles.bad}>{error}</span>
          )}
        </div>
      </section>
    </main>
  );
}
