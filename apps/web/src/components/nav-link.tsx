'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';
import styles from './app-shell.module.css';

export function NavLink({ href, label, icon }: { href: string; label: string; icon: IconName }) {
  const pathname = usePathname();
  const active =
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
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
