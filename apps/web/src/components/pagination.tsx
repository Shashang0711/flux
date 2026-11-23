import Link from 'next/link';
import type { PageMeta } from '@flux/shared';

/** Previous/next links that keep the current filters in the URL. */
export function Pagination({
  meta,
  basePath,
  params,
}: {
  meta: PageMeta;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (meta.totalPages <= 1) {
    return <p className="muted">{meta.total === 1 ? '1 result' : `${meta.total} results`}</p>;
  }
  const href = (page: number) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
    query.set('page', String(page));
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav className="row" aria-label="Pagination" style={{ justifyContent: 'space-between' }}>
      <span className="muted">
        Page {meta.page} of {meta.totalPages} · {meta.total} results
      </span>
      <span className="row">
        {meta.page > 1 ? (
          <Link className="btn" href={href(meta.page - 1)}>
            Previous
          </Link>
        ) : (
          <span className="btn" aria-disabled="true" style={{ opacity: 0.5 }}>
            Previous
          </span>
        )}
        {meta.page < meta.totalPages ? (
          <Link className="btn" href={href(meta.page + 1)}>
            Next
          </Link>
        ) : (
          <span className="btn" aria-disabled="true" style={{ opacity: 0.5 }}>
            Next
          </span>
        )}
      </span>
    </nav>
  );
}

/** Reads page/q/status-style string params from Next's searchParams. */
export function readParams<K extends string>(
  raw: Record<string, string | string[] | undefined>,
  keys: readonly K[],
): Record<K, string | undefined> {
  const out = {} as Record<K, string | undefined>;
  for (const key of keys) {
    const value = raw[key];
    out[key] = (Array.isArray(value) ? value[0] : value) || undefined;
  }
  return out;
}
