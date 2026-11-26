'use client';

import { useState, type FormEvent } from 'react';
import {
  notificationEventName,
  type DeliveryStatus,
  type LabReportDto,
  type NotificationDto,
} from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { FileField } from '@/components/file-field';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { fileError, uploadFile } from '@/lib/files';

/** Publish (design pack §9): upload the final PDF and release it; samples turn green. */
export function PublishForm({ report }: { report: LabReportDto }) {
  const [file, setFile] = useState<File | null>(null);
  const { pending, error, fields, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '');
    await run(async () => {
      if (!file) throw fileError('Choose the final report PDF');
      const uploaded = await uploadFile('FINAL_REPORT', file);
      return apiFetch(`/lab-reports/${report.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ fileId: uploaded.id, note }),
      });
    });
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        Upload the final report released to the client (for example the signed version). Publishing
        turns the samples green and emails the client’s recipients the report.
      </p>
      <FileField
        id="final-file"
        label="Final report (PDF)"
        purpose="FINAL_REPORT"
        onChange={setFile}
        error={fields.file ?? fields.fileId}
      />
      <Field label="Note" htmlFor="publish-note" error={fields.note}>
        <input className="input" id="publish-note" name="note" />
      </Field>
      <FormStatus error={error} fields={fields} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </form>
  );
}

const DELIVERY: Record<DeliveryStatus, { label: string; tone: 'muted' | 'ok' | 'bad' | 'warn' }> = {
  PENDING: { label: 'Queued', tone: 'muted' },
  SENDING: { label: 'Sending', tone: 'warn' },
  SENT: { label: 'Sent', tone: 'ok' },
  FAILED: { label: 'Failed', tone: 'bad' },
};

/** Who was (or will be) emailed about the publication, with each delivery's status. */
export function NotificationsTable({
  reportId,
  notifications,
  canRetry,
}: {
  reportId: string;
  notifications: NotificationDto[];
  canRetry: boolean;
}) {
  const retry = useMutation();
  const failed = notifications.some((n) => n.deliveries.some((d) => d.status === 'FAILED'));
  return (
    <div className="stack">
      <DataTable
        label="Notifications"
        rows={notifications}
        rowKey={(n) => n.id}
        empty="No notifications were raised."
        columns={[
          {
            header: 'Notification',
            primary: true,
            cell: (n) => (
              <>
                {notificationEventName(n.event)}
                <span className="cell-sub">
                  {n.vessel ?? 'No vessel'} · {n.client} · {n.samples.join(', ')}
                </span>
              </>
            ),
          },
          {
            header: 'Recipients',
            cell: (n) =>
              n.skippedReason ? (
                <span className="muted">Not sent: {n.skippedReason}</span>
              ) : (
                <ul
                  className="chips"
                  aria-label="Recipients"
                  style={{ flexDirection: 'column', gap: 4 }}
                >
                  {n.deliveries.map((d) => (
                    <li key={d.id}>
                      {d.name ? `${d.name} · ` : ''}
                      {d.email}{' '}
                      <Badge tone={DELIVERY[d.status].tone}>{DELIVERY[d.status].label}</Badge>
                      {d.lastError && d.status !== 'SENT' && (
                        <span className="cell-sub">{d.lastError}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
      />
      {canRetry && failed && (
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={retry.pending}
            onClick={() =>
              retry.run(() =>
                apiFetch(`/lab-reports/${reportId}/notifications/retry`, { method: 'POST' }),
              )
            }
          >
            Retry failed deliveries
          </button>
          <FormStatus error={retry.error} />
        </div>
      )}
    </div>
  );
}
