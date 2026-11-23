import { MODULES, PORTALS, type HealthStatus } from '@flux/shared';
import { PageHeader } from '@/components/page-header';
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
  const { user, tenant, access } = await requireSession();
  const { health, error } = await loadHealth();

  return (
    <div className={styles.main}>
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0]}`}
        description="Fluid & Laboratory Unified eXchange"
      />

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
          <span className={styles.label}>Roles</span>
          <span className={styles.modules}>
            {user.isPlatformAdmin
              ? 'Platform administrator'
              : user.roles.length > 0
                ? user.roles.map((r) => r.name).join(', ')
                : 'No roles assigned'}
          </span>
        </div>
        {tenant && (
          <>
            <div className={styles.row}>
              <span className={styles.label}>Portals</span>
              <span>
                {access.portals.length > 0
                  ? access.portals
                      .map((key) => PORTALS.find((p) => p.key === key)?.name ?? key)
                      .join(', ')
                  : 'None'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Modules</span>
              <span className={styles.modules}>
                {access.modules.length > 0
                  ? access.modules
                      .map((key) => MODULES.find((m) => m.key === key)?.name ?? key)
                      .join(', ')
                  : 'None'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Permissions</span>
              <span>{access.permissions.length}</span>
            </div>
          </>
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
    </div>
  );
}
