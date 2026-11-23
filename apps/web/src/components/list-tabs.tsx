import Link from 'next/link';
import styles from './list-tabs.module.css';

/** Link-based tabs that keep state in the URL (?list=…). */
export function ListTabs({
  basePath,
  param,
  active,
  tabs,
}: {
  basePath: string;
  param: string;
  active: string;
  tabs: readonly { key: string; name: string }[];
}) {
  return (
    <nav className={styles.tabs} aria-label="Lists">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${basePath}?${param}=${t.key}`}
          className={`${styles.tab} ${t.key === active ? styles.active : ''}`}
          aria-current={t.key === active ? 'page' : undefined}
        >
          {t.name}
        </Link>
      ))}
    </nav>
  );
}
