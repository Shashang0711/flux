'use client';

import { useState, type FormEvent } from 'react';
import type { SampleAttachmentDto } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { DownloadButton, FileField } from '@/components/file-field';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { fileError, formatBytes, uploadFile } from '@/lib/files';

/** Supporting files for the results (printouts, photos, instrument exports). */
export function SampleAttachments({
  sampleId,
  attachments,
  canEdit,
}: {
  sampleId: string;
  attachments: SampleAttachmentDto[];
  canEdit: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const add = useMutation();
  const remove = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const note = String(new FormData(form).get('note') ?? '');
    await add.run(
      async () => {
        if (!file) throw fileError('Choose a file');
        const uploaded = await uploadFile('RESULT_ATTACHMENT', file);
        return apiFetch(`/samples/${sampleId}/attachments`, {
          method: 'POST',
          body: JSON.stringify({ fileId: uploaded.id, note }),
        });
      },
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <div className="stack">
      <DataTable
        label="Attachments"
        rows={attachments}
        rowKey={(a) => a.id}
        empty="No attachments."
        columns={[
          {
            header: 'File',
            primary: true,
            cell: (a) => (
              <>
                {a.file.name}
                <span className="cell-sub">
                  {formatBytes(a.file.size)}
                  {a.file.uploadedBy ? ` · ${a.file.uploadedBy}` : ''}
                </span>
              </>
            ),
          },
          { header: 'Note', cell: (a) => a.note ?? '—' },
          {
            header: 'Actions',
            actions: true,
            cell: (a) => (
              <>
                <DownloadButton
                  linkPath={`/samples/${sampleId}/attachments/${a.id}/download-link`}
                />
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={remove.pending}
                    onClick={() =>
                      window.confirm(`Remove ${a.file.name}?`) &&
                      remove.run(() =>
                        apiFetch(`/samples/${sampleId}/attachments/${a.id}`, { method: 'DELETE' }),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </>
            ),
          },
        ]}
      />
      <FormStatus error={remove.error} />
      {canEdit && (
        <form className="form" onSubmit={onSubmit} noValidate>
          <div className="grid-2">
            <FileField
              id="attachment-file"
              label="Add a file"
              purpose="RESULT_ATTACHMENT"
              onChange={setFile}
              hint="PDF, image, CSV or Excel; up to 25 MB"
              error={add.fields.file ?? add.fields.fileId}
            />
            <Field label="Note" htmlFor="attachment-note" error={add.fields.note}>
              <input className="input" id="attachment-note" name="note" />
            </Field>
          </div>
          <FormStatus error={add.error} fields={add.fields} />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={add.pending}>
              {add.pending ? 'Uploading…' : 'Add attachment'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
