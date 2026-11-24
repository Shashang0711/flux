import Link from 'next/link';
import type { VesselRelationshipDto } from '@flux/shared';
import styles from './link-switcher.module.css';

/**
 * Billing, contacts and notifications are kept per client link. With several active clients,
 * this picks whose settings the tab shows (?link=…); with one, it just names the client.
 */
export function LinkSwitcher({
  basePath,
  tab,
  links,
  active,
}: {
  basePath: string;
  tab: string;
  links: VesselRelationshipDto[];
  active: VesselRelationshipDto;
}) {
  if (links.length === 1) {
    return (
      <p className={styles.switcher}>
        <span className={styles.label}>
          Settings for <strong>{active.client.name}</strong> ({active.relationshipType.name})
        </span>
      </p>
    );
  }
  return (
    <nav className={styles.switcher} aria-label="Client">
      <span className={styles.label}>Settings for</span>
      {links.map((l) => (
        <Link
          key={l.id}
          href={`${basePath}?tab=${tab}&link=${l.id}`}
          className={`${styles.option} ${l.id === active.id ? styles.active : ''}`}
          aria-current={l.id === active.id ? 'page' : undefined}
        >
          {l.client.name}
          <span className="muted">· {l.relationshipType.name}</span>
        </Link>
      ))}
    </nav>
  );
}
