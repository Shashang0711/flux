'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './app-shell.module.css';

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active =
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}
