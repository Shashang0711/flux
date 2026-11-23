import { MODULES, type HealthStatus } from '@flux/shared';
import { LogoutButton } from '@/components/logout-button';
import { ApiError, apiFetch } from '@/lib/api';
import { requireSession } from '@/lib/server-api';
import styles from './page.module.css';

async function loadHealth(): Promise<{ health?: HealthStatus; error?: string }> {
  try {
    const { data } = await apiFetch<HealthStatus>('/health', { cache: 'no-store' });
    return { health: data };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Unknown error' };
  }
}

export default async function HomePage() {
  const { user, tenant, modules } = await requireSession();
  const { health, error } = await loadHealth();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>FLUX</h1>
          <p className={styles.subtitle}>Fluid &amp; Laboratory Unified eXchange</p>
        </div>
        <LogoutButton className={styles.secondaryButton} />
      </header>

      <section className={styles.card} aria-label="Signed-in user">
        <div className={styles.row}>
          <span className={styles.label}>Signed in as</span>
          <span>
            {user.name} · {user.email}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Organisation</span>
          <span>{tenant ? tenant.name : 'FLUX platform'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Access</span>
          <span>
            {user.isPlatformAdmin
              ? 'Platform administrator'
              : user.isTenantAdmin
                ? 'Organisation administrator'
                : 'Standard user'}
          </span>
        </div>
        {tenant && (
          <div className={styles.row}>
            <span className={styles.label}>Modules</span>
            <span className={styles.modules}>
              {modules.map((key) => MODULES.find((m) => m.key === key)?.name ?? key).join(', ')}
            </span>
          </div>
        )}
      </section>

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
