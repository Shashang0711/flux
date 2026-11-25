export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'ACTIVE' ? 'badge-ok' : 'badge-bad';
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? 'badge-ok' : 'badge-muted'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function Badge({
  children,
  tone = 'muted',
}: {
  children: string;
  tone?: 'brand' | 'muted' | 'ok' | 'warn' | 'bad';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
