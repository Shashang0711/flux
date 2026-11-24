import Link from 'next/link';
import { MODULES, PORTALS, type HealthStatus, type SessionInfo } from '@flux/shared';
import { Icon, type IconName } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { requireSession, serverApiFetch } from '@/lib/server-api';
import styles from './page.module.css';

async function loadHealth(): Promise<HealthStatus | null> {
  try {
    return (await apiFetch<HealthStatus>('/health', { cache: 'no-store' })).data;
  } catch (err) {
    if (err instanceof ApiError) return null;
    return null;
  }
}

/** Total of a list endpoint (one row requested); null if unavailable. */
async function count(path: string): Promise<number | null> {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const { meta } = await serverApiFetch<unknown[]>(`${path}${sep}pageSize=1`);
    return meta?.total ?? null;
  } catch {
    return null;
  }
}

interface Stat {
  label: string;
  icon: IconName;
  href: string;
  value: Promise<number | null>;
}

function tenantStats(session: SessionInfo): Stat[] {
  const can = (p: string) => session.access.permissions.includes(p as never);
  const has = (m: string) => session.modules.includes(m);
  const stats: Stat[] = [];
  if (has('clients') && can('client.view')) {
    stats.push({
      label: 'Active clients',
      icon: 'clients',
      href: '/admin/clients',
      value: count('/clients?status=ACTIVE'),
    });
  }
  if (has('vessels') && can('vessel.view')) {
    stats.push({
      label: 'Active vessels',
      icon: 'vessels',
      href: '/admin/vessels',
      value: count('/vessels?status=ACTIVE'),
    });
  }
  if (can('user.view')) {
    stats.push({
      label: 'Users',
      icon: 'users',
      href: '/admin/users',
      value: count('/users?status=ACTIVE'),
    });
  }
  if (can('role.view')) {
    stats.push({
      label: 'Roles',
      icon: 'roles',
      href: '/admin/roles',
      value: count('/roles?isActive=true'),
    });
  }
  return stats;
}

function platformStats(): Stat[] {
  return [
    {
      label: 'Active tenants',
      icon: 'tenants',
      href: '/platform/tenants?status=ACTIVE',
      value: count('/platform/tenants?status=ACTIVE'),
    },
    {
      label: 'Suspended tenants',
      icon: 'tenants',
      href: '/platform/tenants?status=SUSPENDED',
      value: count('/platform/tenants?status=SUSPENDED'),
    },
  ];
}

function quickActions(session: SessionInfo): { label: string; href: string; icon: IconName }[] {
  if (session.user.isPlatformAdmin) {
    return [
      { label: 'New tenant', href: '/platform/tenants/new', icon: 'tenants' },
      { label: 'FLUX defaults', href: '/platform/reference-data', icon: 'reference' },
    ];
  }
  const can = (p: string) => session.access.permissions.includes(p as never);
  const has = (m: string) => session.modules.includes(m);
  return [
    ...(has('clients') && can('client.manage')
      ? [{ label: 'New client', href: '/admin/clients/new', icon: 'clients' as const }]
      : []),
    ...(has('vessels') && can('vessel.manage')
      ? [{ label: 'New vessel', href: '/admin/vessels/new', icon: 'vessels' as const }]
      : []),
    ...(can('user.manage')
      ? [{ label: 'New user', href: '/admin/users/new', icon: 'users' as const }]
      : []),
  ];
}

export default async function HomePage() {
  const session = await requireSession();
  const { user, tenant, access } = session;
  const stats = user.isPlatformAdmin ? platformStats() : tenantStats(session);
  const [values, health] = await Promise.all([
    Promise.all(stats.map((s) => s.value)),
    loadHealth(),
  ]);
  const actions = quickActions(session);

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0]}`}
        description={tenant ? tenant.name : 'FLUX platform administration'}
      />

      {stats.length > 0 && (
        <section className={styles.stats} aria-label="Overview">
          {stats.map((s, i) => (
            <Link key={s.label} href={s.href} className={styles.stat}>
              <span className={styles.statIcon}>
                <Icon name={s.icon} size={20} />
              </span>
              <span className={styles.statValue}>{values[i] ?? '—'}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </Link>
          ))}
        </section>
      )}

      <div className={styles.columns}>
        {actions.length > 0 && (
          <section className="card" aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="card-title">
              Quick actions
            </h2>
            <div className={styles.actions}>
              {actions.map((a) => (
                <Link key={a.href} href={a.href} className={styles.action}>
                  <Icon name={a.icon} size={18} />
                  <span>{a.label}</span>
                  <Icon name="arrow" size={16} className={styles.actionArrow} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="card" aria-labelledby="your-access">
          <h2 id="your-access" className="card-title">
            Your access
          </h2>
          <dl className={styles.details}>
            <dt>Roles</dt>
            <dd>
              {user.isPlatformAdmin
                ? 'Platform administrator'
                : user.roles.map((r) => r.name).join(', ') || 'No roles assigned'}
            </dd>
            {tenant && (
              <>
                <dt>Portals</dt>
                <dd>
                  {access.portals.length > 0
                    ? access.portals
                        .map((k) => PORTALS.find((p) => p.key === k)?.name ?? k)
                        .join(', ')
                    : 'None'}
                </dd>
                <dt>Modules</dt>
                <dd className={styles.chips}>
                  {access.modules.length > 0
                    ? access.modules.map((k) => (
                        <span key={k} className="badge badge-brand">
                          {MODULES.find((m) => m.key === k)?.name ?? k}
                        </span>
                      ))
                    : 'None'}
                </dd>
              </>
            )}
          </dl>
        </section>
      </div>

      <p className={styles.status} role="status">
        <span className={health ? styles.dotOk : styles.dotBad} aria-hidden="true" />
        {health
          ? `All systems operational · API v${health.version}`
          : 'The FLUX API is not reachable right now.'}
      </p>
    </>
  );
}
