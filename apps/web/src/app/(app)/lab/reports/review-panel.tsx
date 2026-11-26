'use client';

import type { FormEvent } from 'react';
import type { LabReportDto } from '@flux/shared';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

function DecisionForm({
  report,
  action,
  field,
  label,
  required,
  submit,
  danger,
}: {
  report: LabReportDto;
  action: 'reject' | 'ready-to-publish' | 'reopen-review';
  field: 'comment' | 'reason';
  label: string;
  required: boolean;
  submit: string;
  danger?: boolean;
}) {
  const { pending, error, fields, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get(field) ?? '');
    await run(() =>
      apiFetch(`/lab-reports/${report.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ [field]: value }),
      }),
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field
        label={label}
        htmlFor={`${action}-${field}`}
        error={fields[field]}
        hint={required ? undefined : 'Optional'}
      >
        <textarea className="textarea" id={`${action}-${field}`} name={field} rows={4} />
      </Field>
      <FormStatus error={error} fields={fields} />
      <div className="form-actions">
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          type="submit"
          disabled={pending}
        >
          {pending ? 'Saving…' : submit}
        </button>
      </div>
    </form>
  );
}

/**
 * Admin review (design pack §8): reject with a comment (back to the lab) or mark ready to
 * publish; a ready report can be sent back with a reason. The uploader of the current version
 * cannot review it.
 */
export function ReviewPanel({ report, userId }: { report: LabReportDto; userId: string }) {
  if (report.status === 'READY_TO_PUBLISH') {
    return (
      <div className="row">
        <span className="muted">Ready to publish. It now waits on the Publish page.</span>
        <EditDialog title={`Send ${report.code} back to review`} label="Send back to review">
          <DecisionForm
            report={report}
            action="reopen-review"
            field="reason"
            label="Reason"
            required
            submit="Send back to review"
          />
        </EditDialog>
      </div>
    );
  }
  if (report.status !== 'SUBMITTED') return null;
  if (report.currentUploaderId === userId) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        You uploaded this version, so another reviewer must review it.
      </p>
    );
  }
  return (
    <div className="row">
      <EditDialog title={`Mark ${report.code} ready to publish`} label="Mark ready to publish">
        <DecisionForm
          report={report}
          action="ready-to-publish"
          field="comment"
          label="Comment"
          required={false}
          submit="Mark ready to publish"
        />
      </EditDialog>
      <EditDialog title={`Reject ${report.code}`} label="Reject">
        <DecisionForm
          report={report}
          action="reject"
          field="comment"
          label="What should the lab correct?"
          required
          submit="Reject and return to the lab"
          danger
        />
      </EditDialog>
    </div>
  );
}
