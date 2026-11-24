'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import styles from './app-shell.module.css';

const DRAWER_QUERY = '(max-width: 1023px)';

/**
 * Responsive frame: a fixed sidebar on desktop; below 1024px a top bar whose menu button opens
 * the same sidebar as a drawer (closes on navigation, Esc or the backdrop; focus is managed and
 * the closed drawer is inert so keyboard users cannot tab into it).
 */
export function ShellFrame({
  brand,
  orgName,
  sidebar,
  children,
}: {
  brand: ReactNode;
  orgName: string;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isDrawer, setIsDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const query = window.matchMedia(DRAWER_QUERY);
    const update = () => setIsDrawer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Navigating closes the drawer.
  useEffect(() => setOpen(false), [pathname]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  // Focus moves into the drawer on open and back to the menu button on close.
  useEffect(() => {
    if (open) closeButton.current?.focus();
    else if (wasOpen.current) menuButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div className={styles.shell} data-drawer-open={open ? '' : undefined}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.topbar}>
        <button
          ref={menuButton}
          type="button"
          className={styles.iconButton}
          aria-label="Open menu"
          aria-controls="app-sidebar"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon name="menu" size={22} />
        </button>
        <div className={styles.topbarBrand}>{brand}</div>
        <span className={styles.topbarOrg}>{orgName}</span>
      </header>
      <div className={styles.backdrop} onClick={close} aria-hidden="true" />
      <aside
        id="app-sidebar"
        className={styles.sidebar}
        aria-label="Main menu"
        inert={isDrawer && !open ? true : undefined}
      >
        <button
          ref={closeButton}
          type="button"
          className={`${styles.iconButton} ${styles.closeButton}`}
          aria-label="Close menu"
          onClick={close}
        >
          <Icon name="close" size={22} />
        </button>
        {sidebar}
      </aside>
      <main id="main" className={styles.content} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
