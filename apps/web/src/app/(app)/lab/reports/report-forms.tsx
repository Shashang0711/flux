'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { BatchDto, LabReportDto, LabReportStatus, LabReportSummaryDto } from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { DownloadButton, FileField } from '@/components/file-field';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { fileError, uploadFile } from '@/lib/files';

const STATUS: Record<LabReportStatus, { label: string; tone: 'warn' | 'bad' | 'ok' }> = {
  SUBMITTED: { label: 'Awaiting review', tone: 'warn' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  READY_TO_PUBLISH: { label: 'Ready to publish', tone: 'ok' },
};

export function ReportStatusBadge({ status }: { status: LabReportStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

/** Upload a lab report covering completed samples of the batch (submits it for review). */
export function UploadReportForm({ batch }: { batch: BatchDto }) {
  const eligible = batch.samples.filter((s) => s.status === 'RESULTS_ENTERED' && !s.labReport);
  const [selected, setSelected] = useState<string[]>(eligible.map((s) => s.id));
  const [file, setFile] = useState<File | null>(null);
  const { pending, error, fields, success, run } = useMutation();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '');
    await run(
      async () => {
        if (!file) throw fileError('Choose the PDF report');
        const uploaded = await uploadFile('LAB_REPORT', file);
        return apiFetch('/lab-reports', {
          method: 'POST',
          body: JSON.stringify({
            batchId: batch.id,
            sampleIds: selected,
            fileId: uploaded.id,
            note,
          }),
        });
      },
      { success: 'Report submitted for review.' },
    );
  }

  if (eligible.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        A report can cover samples whose results are complete and that are not in a report yet. None
        of this batch&apos;s samples are ready.
      </p>
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <fieldset className="check-group">
        <legend>Samples the report covers</legend>
        {eligible.map((s) => (
          <label key={s.id} className="check">
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) =>
                setSelected((sel) =>
                  e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id),
                )
              }
            />
            <span>
              {s.code}
              <span className="cell-sub">
                {s.vessel?.name ?? 'No vessel'} · {s.client.name}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {fields.sampleIds && (
        <span className="field-error" role="alert">
          {fields.sampleIds}
        </span>
      )}
      <FileField
        id="report-file"
        label="Report (PDF)"
        purpose="LAB_REPORT"
        onChange={setFile}
        error={fields.file ?? fields.fileId}
      />
      <Field label="Note for the reviewer" htmlFor="report-note" error={fields.note}>
        <input className="input" id="report-note" name="note" />
      </Field>
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || selected.length === 0}
        >
          {pending
            ? 'Uploading…'
            : `Submit report for ${selected.length} sample${selected.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}

/** Replace the report file: a new version, back to "awaiting review". */
export function ReplaceFileForm({ report }: { report: LabReportDto }) {
  const [file, setFile] = useState<File | null>(null);
  const { pending, error, fields, success, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '');
    await run(
      async () => {
        if (!file) throw fileError('Choose the PDF report');
        const uploaded = await uploadFile('LAB_REPORT', file);
        return apiFetch(`/lab-reports/${report.id}/versions`, {
          method: 'POST',
          body: JSON.stringify({ fileId: uploaded.id, note }),
        });
      },
      { success: 'New version uploaded.' },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <FileField
        id={`replace-${report.id}`}
        label="New report (PDF)"
        purpose="LAB_REPORT"
        onChange={setFile}
        error={fields.file ?? fields.fileId}
      />
      <Field label="What changed" htmlFor={`replace-note-${report.id}`} error={fields.note}>
        <input className="input" id={`replace-note-${report.id}`} name="note" />
      </Field>
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Uploading…' : `Upload version ${report.currentVersion + 1}`}
        </button>
      </div>
    </form>
  );
}

export function ReportTable({
  reports,
  showBatch = true,
  empty = 'No lab reports yet.',
}: {
  reports: LabReportSummaryDto[];
  showBatch?: boolean;
  empty?: string;
}) {
  return (
    <DataTable
      label="Lab reports"
      rows={reports}
      rowKey={(r) => r.id}
      empty={empty}
      columns={[
        {
          header: 'Report',
          primary: true,
          cell: (r) => (
            <>
              <Link href={`/lab/reports/${r.id}`}>
                <code>{r.code}</code>
              </Link>
              <span className="cell-sub">
                Version {r.currentVersion}
                {r.uploadedBy ? ` · ${r.uploadedBy}` : ''}
              </span>
            </>
          ),
        },
        ...(showBatch
          ? [
              {
                header: 'Batch',
                cell: (r: LabReportSummaryDto) => (
                  <>
                    <Link href={`/lab/batches/${r.batch.id}`}>{r.batch.code}</Link>
                    <span className="cell-sub">{r.serviceType.name}</span>
                  </>
                ),
              },
            ]
          : []),
        { header: 'Samples', cell: (r) => r.sampleCount },
        {
          header: 'Submitted',
          cell: (r) =>
            new Date(r.submittedAt).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
        },
        { header: 'Status', cell: (r) => <ReportStatusBadge status={r.status} /> },
        {
          header: 'Actions',
          actions: true,
          cell: (r) => <DownloadButton linkPath={`/lab-reports/${r.id}/download-link`} />,
        },
      ]}
    />
  );
}
