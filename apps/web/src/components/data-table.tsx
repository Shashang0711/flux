import type { ReactNode } from 'react';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  /** Card title on phones (shown without a label). Use for the row's name. */
  primary?: boolean;
  /** Right-aligned action buttons; header is screen-reader only. */
  actions?: boolean;
  className?: string;
}

/**
 * The portal's table. On desktop a normal table; on phones (< 640px) each row becomes a card
 * whose cells are labelled with their column header, so no column is ever hidden off-screen.
 * Works in Server and Client Components (no hooks).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  label,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: ReactNode;
  /** Accessible name for the table. */
  label: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <div className="table-wrap table-stack">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={c.actions ? 'cell-actions' : c.className}>
                {c.actions ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted" data-empty="">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <td
                    key={c.header}
                    data-label={c.actions ? '' : c.header}
                    data-primary={c.primary ? '' : undefined}
                    className={c.actions ? 'cell-actions' : c.className}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
