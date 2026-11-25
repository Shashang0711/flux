'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  formatResultValue,
  sampleColour,
  type BatchResultsDto,
  type BatchResultsRequest,
  type TestParameterDto,
} from '@flux/shared';
import { FormStatus } from '@/components/field';
import { FlagBadge, ResultInput, inputValue, parameterHint } from '@/components/results';
import { SampleStatusBadge } from '@/components/sample-status';
import { ApiError, apiFetch } from '@/lib/api';
import { parseCsv, toCsv } from '@/lib/csv';
import { useMutation } from '@/hooks/use-mutation';

type Row = BatchResultsDto['samples'][number];

/** Field errors from the API (samples.<n>.<key>) re-keyed by sample id: "<id>.<key>". */
function errorsBySample(fields: Record<string, string>, sent: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fields)) {
    const m = /^samples\.(\d+)(?:\.(.+))?$/.exec(path);
    if (m && sent[Number(m[1])]) out[`${sent[Number(m[1])]}.${m[2] ?? '_'}`] = message;
  }
  return out;
}

function Cell({
  row,
  p,
  errors,
  locked,
}: {
  row: Row;
  p: TestParameterDto;
  errors: Record<string, string>;
  locked: boolean;
}) {
  const result = row.results.find((r) => r.parameterId === p.id);
  const error = errors[`${row.id}.${p.key}`];
  return (
    <td className={result?.flag ? `cell-flag-${result.flag.toLowerCase()}` : undefined}>
      <div className="grid-cell">
        <ResultInput
          parameter={p}
          id={`g-${row.id}-${p.key}`}
          name={`g-${row.id}-${p.key}`}
          label={`${p.name} for ${row.code}`}
          defaultValue={inputValue(p, result?.value)}
          invalid={Boolean(error)}
          disabled={locked || !p.isActive}
        />
        {result?.flag && result.flag !== 'NORMAL' && <FlagBadge flag={result.flag} />}
      </div>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </td>
  );
}

/**
 * Batch View (design pack §8): a grid of samples × parameters, plus CSV template download and
 * upload ("uploading batch-view results") with a server-checked preview before saving.
 */
export function ResultsGrid({ data, canTest }: { data: BatchResultsDto; canTest: boolean }) {
  const save = useMutation();
  const action = useMutation();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    body: BatchResultsRequest;
    result: BatchResultsDto;
  } | null>(null);
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const params = data.parameters;
  const open = data.samples.filter((s) => s.status !== 'RESULTS_ENTERED');
  const editable = canTest && open.length > 0;

  async function submit(body: BatchResultsRequest, dryRun: boolean) {
    const sent = body.samples.map((s) => s.sampleId);
    setErrors({});
    return save.run(
      () =>
        apiFetch<BatchResultsDto>(
          `/samples/batches/${data.batchId}/results${dryRun ? '?dryRun=true' : ''}`,
          {
            method: 'PUT',
            body: JSON.stringify(body),
          },
        ).catch((err: unknown) => {
          // Show each problem in its grid cell (or in the import preview's sample row).
          if (err instanceof ApiError && Array.isArray(err.body.details)) {
            const byPath = Object.fromEntries(err.body.details.map((d) => [d.path, d.message]));
            setErrors(errorsBySample(byPath, sent));
          }
          throw err;
        }),
      { success: dryRun ? undefined : 'Results saved.', refresh: !dryRun },
    );
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(
      {
        samples: open.map((s) => ({
          sampleId: s.id,
          results: params
            .filter((p) => p.isActive)
            .map((p) => ({
              parameterId: p.id,
              value: String(form.get(`g-${s.id}-${p.key}`) ?? ''),
            })),
        })),
      },
      false,
    );
  }

  function downloadTemplate() {
    const rows = [
      ['sample', 'kit', 'serial', 'vessel', ...params.map((p) => p.key)],
      ...data.samples.map((s) => [
        s.code,
        s.kit.code,
        s.kit.serialNumber ?? '',
        s.vessel ?? '',
        ...params.map((p) => inputValue(p, s.results.find((r) => r.parameterId === p.id)?.value)),
      ]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `${data.batchCode}-results.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPreview(null);
    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      const issues: string[] = [];
      const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
      const sampleCol = header.indexOf('sample');
      if (sampleCol < 0) {
        setImportIssues([
          'The file needs a "sample" column with the sample IDs (download the template).',
        ]);
        return;
      }
      const columns = params
        .map((p) => ({ p, col: header.indexOf(p.key.toLowerCase()) }))
        .filter((c) => c.col >= 0 && c.p.isActive);
      const known = new Set([
        'sample',
        'kit',
        'serial',
        'vessel',
        ...params.map((p) => p.key.toLowerCase()),
      ]);
      const unknown = header.filter((h) => h && !known.has(h));
      if (unknown.length > 0) issues.push(`Ignored columns: ${unknown.join(', ')}`);
      if (columns.length === 0)
        issues.push('No parameter columns found (use the parameter keys as headers).');
      const samples: BatchResultsRequest['samples'] = [];
      for (const [n, cells] of rows.slice(1).entries()) {
        const code = (cells[sampleCol] ?? '').trim();
        const sample = data.samples.find((s) => s.code.toLowerCase() === code.toLowerCase());
        if (!sample) {
          issues.push(`Row ${n + 2}: sample "${code}" is not in this batch`);
          continue;
        }
        if (sample.status === 'RESULTS_ENTERED') {
          issues.push(`Row ${n + 2}: ${sample.code} is completed; its row was skipped`);
          continue;
        }
        samples.push({
          sampleId: sample.id,
          results: columns.map(({ p, col }) => ({ parameterId: p.id, value: cells[col] ?? '' })),
        });
      }
      setImportIssues(issues);
      if (samples.length === 0 || columns.length === 0) return;
      const body = { samples };
      const result = await submit(body, true);
      if (result) setPreview({ body, result: result.data });
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    const ok = await submit(preview.body, false);
    if (ok) {
      setPreview(null);
      setImportIssues([]);
    }
  }

  const registered = data.samples.some((s) => s.status === 'REGISTERED');
  return (
    <div className="stack">
      {canTest && (
        <div className="selection-bar" role="region" aria-label="Batch actions">
          <span className="muted">
            {open.length === 0
              ? 'All results are completed.'
              : `${open.length} of ${data.samples.length} sample${data.samples.length === 1 ? '' : 's'} open`}
          </span>
          <span className="row">
            {registered && (
              <button
                type="button"
                className="btn"
                disabled={action.pending}
                onClick={() =>
                  action.run(() =>
                    apiFetch(`/samples/batches/${data.batchId}/start-testing`, { method: 'POST' }),
                  )
                }
              >
                Start testing
              </button>
            )}
            <button type="button" className="btn" onClick={downloadTemplate}>
              Download CSV template
            </button>
            {editable && (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={importing}
                  onClick={() => fileInput.current?.click()}
                >
                  {importing ? 'Reading…' : 'Upload CSV'}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  aria-label="CSV file with results"
                  onChange={onFile}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(() =>
                      apiFetch(`/samples/batches/${data.batchId}/complete-results`, {
                        method: 'POST',
                      }),
                    )
                  }
                >
                  Complete batch
                </button>
              </>
            )}
          </span>
        </div>
      )}
      <FormStatus error={action.error} fields={action.fields} />
      {importIssues.length > 0 && (
        <div className="alert alert-warn" role="status">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {importIssues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <section className="card" aria-label="Import preview">
          <h2 className="card-title">Check the imported results</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Values from the file, with their flags. Nothing is saved until you confirm.
          </p>
          <div className="table-wrap">
            <table className="table results-table">
              <thead>
                <tr>
                  <th>Sample</th>
                  {params.map((p) => (
                    <th key={p.id}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.result.samples
                  .filter((s) => preview.body.samples.some((b) => b.sampleId === s.id))
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <code>{s.code}</code>
                      </td>
                      {params.map((p) => {
                        const r = s.results.find((x) => x.parameterId === p.id);
                        return (
                          <td
                            key={p.id}
                            className={r?.flag ? `cell-flag-${r.flag.toLowerCase()}` : undefined}
                          >
                            {r ? formatResultValue(p, r.value) : '—'}{' '}
                            {r?.flag && r.flag !== 'NORMAL' && <FlagBadge flag={r.flag} />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={save.pending}
              onClick={confirmImport}
            >
              {save.pending ? 'Saving…' : 'Save imported results'}
            </button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              Discard
            </button>
          </div>
        </section>
      )}

      <form onSubmit={onSave} noValidate className="stack">
        <div className="table-wrap">
          <table className="table results-table" aria-label="Results">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                {params.map((p) => (
                  <th key={p.id} scope="col" title={parameterHint(p)}>
                    {p.name}
                    {p.required ? ' *' : ''}
                    {p.unit && <span className="cell-sub">{p.unit}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.samples.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <a href={`/lab/samples/${row.id}#results`}>
                      <code>{row.code}</code>
                    </a>
                    <span className="cell-sub">{row.kit.serialNumber ?? row.kit.code}</span>
                    <span className="cell-sub">
                      <SampleStatusBadge status={row.status} colour={sampleColour(row)} />
                    </span>
                    {errors[`${row.id}._`] && (
                      <span className="field-error" role="alert">
                        {errors[`${row.id}._`]}
                      </span>
                    )}
                  </th>
                  {params.map((p) => (
                    <Cell
                      key={p.id}
                      row={row}
                      p={p}
                      errors={errors}
                      locked={!canTest || row.status === 'RESULTS_ENTERED'}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!preview && <FormStatus error={save.error} success={save.success} />}
        {editable && (
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={save.pending}>
              {save.pending ? 'Saving…' : 'Save results'}
            </button>
          </div>
        )}
      </form>
      {canTest && (
        <p className="muted" style={{ margin: 0 }}>
          CSV columns: <code>sample</code> (required), then parameter keys (
          {params.map((p) => p.key).join(', ')}). Empty cells clear a value. Kit, serial and vessel
          columns are ignored. Completed samples are skipped.
        </p>
      )}
    </div>
  );
}
