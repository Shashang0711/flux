import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './page-header.module.css';

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.heading}>
        {back && (
          <Link className={styles.back} href={back.href}>
            ← {back.label}
          </Link>
        )}
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
