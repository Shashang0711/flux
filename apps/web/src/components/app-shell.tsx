import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SessionInfo } from '@flux/shared';
import { visibleNavigation } from '@/lib/navigation';
import { LogoutButton } from './logout-button';
import { NavLink } from './nav-link';
import styles from './app-shell.module.css';

/** Signed-in layout: permission-aware sidebar, organisation and user menu. */
export function AppShell({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const groups = visibleNavigation(session);
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand}>
          FLUX
        </Link>
        <p className={styles.org}>{session.tenant?.name ?? 'Platform administration'}</p>
        <nav aria-label="Main">
          {groups.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <p className={styles.navGroupLabel}>{group.label}</p>
              {group.items.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.user}>
          <p className={styles.userName}>{session.user.name}</p>
          <p className={styles.userEmail}>{session.user.email}</p>
          <div className={styles.userActions}>
            <Link className="btn" href="/account">
              Account
            </Link>
            <LogoutButton className="btn" />
          </div>
        </div>
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
