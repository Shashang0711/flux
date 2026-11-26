import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SessionInfo } from '@flux/shared';
import { visibleNavigation } from '@/lib/navigation';
import { Icon } from './icons';
import { LogoutButton } from './logout-button';
import { NavLink } from './nav-link';
import { ShellFrame } from './shell-frame';
import { TimeZoneCookie } from './time-zone-cookie';
import styles from './app-shell.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** The FLUX wordmark with its mark. */
export function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="FLUX home">
      <span className={styles.brandMark} aria-hidden="true">
        F
      </span>
      <span>FLUX</span>
    </Link>
  );
}

/** Signed-in layout: permission-aware navigation, organisation and user menu. */
export function AppShell({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const groups = visibleNavigation(session);
  const orgName = session.tenant?.name ?? 'Platform administration';
  return (
    <ShellFrame
      brand={<Brand />}
      orgName={orgName}
      sidebar={
        <div className={styles.sidebarInner}>
          <div className={styles.sidebarHead}>
            <Brand />
            <p className={styles.org}>{orgName}</p>
          </div>
          <nav aria-label="Main" className={styles.nav}>
            {groups.map((group) => (
              <div key={group.label} className={styles.navGroup}>
                <p className={styles.navGroupLabel}>{group.label}</p>
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
                ))}
              </div>
            ))}
          </nav>
          <div className={styles.user}>
            <div className={styles.userIdentity}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(session.user.name)}
              </span>
              <span className={styles.userText}>
                <span className={styles.userName}>{session.user.name}</span>
                <span className={styles.userEmail}>{session.user.email}</span>
              </span>
            </div>
            <div className={styles.userActions}>
              <Link className="btn" href="/account">
                <Icon name="account" size={16} />
                Account
              </Link>
              <LogoutButton className="btn" />
            </div>
          </div>
        </div>
      }
    >
      {children}
      <TimeZoneCookie />
    </ShellFrame>
  );
}
