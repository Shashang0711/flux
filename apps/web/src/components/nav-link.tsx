'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';
import styles from './app-shell.module.css';

export function NavLink({
  href,
  label,
  icon,
  exact = href === '/',
}: {
  href: string;
  label: string;
  icon: IconName;
  /** Active on this path only, not on the paths below it (home pages). */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </Link>
  );
}
