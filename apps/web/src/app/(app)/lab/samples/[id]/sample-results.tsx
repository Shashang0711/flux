'use client';

import type { FormEvent } from 'react';
import { worstFlag, type SampleResultsDto } from '@flux/shared';
import { Field, FormStatus } from '@/components/field';
import { FlagBadge, ResultInput, inputValue, parameterHint } from '@/components/results';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

/**
 * Individual Sample View (design pack §8): one input per test parameter. Saving moves the
 * sample under testing; completing needs every required result and locks them until reopened.
 */
export function SampleResults({ data, canTest }: { data: SampleResultsDto; canTest: boolean }) {
  const save = useMutation();
  const state = useMutation();
  const locked = data.status === 'RESULTS_ENTERED';
  const editable = canTest && !locked;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await save.run(
      () =>
        apiFetch(`/samples/${data.sampleId}/results`, {
          method: 'PUT',
          body: JSON.stringify({
            results: data.parameters.map((p) => ({
              parameterId: p.id,
              value: String(form.get(`r-${p.key}`) ?? ''),
            })),
          }),
        }),
      { success: 'Results saved.' },
    );
  }

  if (data.parameters.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        This service type has no test parameters yet (Lab setup → Service types → Parameters).
      </p>
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="row">
          {worstFlag(data.results.map((r) => r.flag)) ? (
            <>
              Worst result: <FlagBadge flag={data.worstFlag} />
            </>
          ) : (
            <span className="muted">No flagged results</span>
          )}
        </span>
        {data.missingRequired.length > 0 && !locked && (
          <span className="muted">Still required: {data.missingRequired.join(', ')}</span>
        )}
      </div>
      <div className="grid-2">
        {data.parameters.map((p) => {
          const result = data.results.find((r) => r.parameterId === p.id);
          return (
            <Field
              key={p.id}
              label={`${p.name}${p.required ? ' *' : ''}${p.isActive ? '' : ' (no longer used)'}`}
              htmlFor={`r-${p.key}`}
              hint={parameterHint(p) || undefined}
              error={save.fields[p.key]}
            >
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <ResultInput
                  parameter={p}
                  id={`r-${p.key}`}
                  name={`r-${p.key}`}
                  defaultValue={inputValue(p, result?.value)}
                  invalid={Boolean(save.fields[p.key])}
                  disabled={!editable || !p.isActive}
                />
                <FlagBadge flag={result?.flag ?? null} />
              </div>
            </Field>
          );
        })}
      </div>
      <FormStatus error={save.error} fields={save.fields} success={save.success} />
      <FormStatus error={state.error} />
      {canTest && (
        <div className="form-actions row">
          {editable && (
            <button className="btn btn-primary" type="submit" disabled={save.pending}>
              {save.pending ? 'Saving…' : 'Save results'}
            </button>
          )}
          {editable && (
            <button
              type="button"
              className="btn"
              disabled={state.pending || data.results.length === 0}
              onClick={() =>
                state.run(() =>
                  apiFetch(`/samples/${data.sampleId}/complete-results`, { method: 'POST' }),
                )
              }
            >
              Complete results
            </button>
          )}
          {locked && (
            <button
              type="button"
              className="btn"
              disabled={state.pending}
              onClick={() =>
                state.run(() =>
                  apiFetch(`/samples/${data.sampleId}/reopen-results`, { method: 'POST' }),
                )
              }
            >
              Reopen to correct
            </button>
          )}
        </div>
      )}
    </form>
  );
}
