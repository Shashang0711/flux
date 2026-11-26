import type { Metadata } from 'next';
import Link from 'next/link';
import type { PortalOverviewDto } from '@flux/shared';
import { Icon, type IconName } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, requireSession } from '@/lib/server-api';
import { ReportTable } from './report-table';
import { dateFormatter } from './portal-ui';
import styles from './portal.module.css';

export const metadata: Metadata = { title: 'Client portal · FLUX' };

export default async function ClientOverviewPage() {
  const session = await requireSession();
  const { data: overview } = await loadOrNotFound<PortalOverviewDto>('/portal/overview');
  const formatDate = await dateFormatter();
  const stats: { label: string; value: number; icon: IconName; href: string }[] = [
    {
      label: 'Received',
      value: overview.counts.RECEIVED,
      icon: 'inbox',
      href: '/client/samples?status=RECEIVED',
    },
    {
      label: 'In testing',
      value: overview.counts.IN_TESTING,
      icon: 'flask',
      href: '/client/samples?status=IN_TESTING',
    },
    {
      label: 'Report published',
      value: overview.counts.PUBLISHED,
      icon: 'report',
      href: '/client/samples?status=PUBLISHED',
    },
    { label: 'Vessels', value: overview.vesselCount, icon: 'vessels', href: '/client/samples' },
  ];
  return (
    <>
      <PageHeader
        title={overview.client.name}
        description={`Your samples and reports from ${session.tenant?.name ?? 'the laboratory'}.`}
      />
      <section className={styles.stats} aria-label="Samples by status">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className={styles.stat}>
            <span className={styles.statIcon}>
              <Icon name={s.icon} size={20} />
            </span>
            <span className={styles.statValue}>{s.value}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </Link>
        ))}
      </section>
      <section className="stack" aria-labelledby="recent-reports">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="recent-reports" className="card-title" style={{ margin: 0 }}>
            Latest reports
          </h2>
          <Link href="/client/reports">All reports</Link>
        </div>
        <ReportTable
          reports={overview.recentReports}
          formatDate={formatDate}
          empty="No reports published yet. They appear here as soon as the laboratory publishes them."
        />
      </section>
    </>
  );
}
