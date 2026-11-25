'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type {
  BottleLineDto,
  BottleTypeDto,
  ProductDto,
  ProductVariantDto,
  ServiceTypeSummaryDto,
} from '@flux/shared';
import { ActiveBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { Field, FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { CodeNameFields } from './catalogue-forms';

const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export function bottleSummary(lines: BottleLineDto[]): string {
  return lines.length === 0
    ? 'No bottles'
    : lines.map((l) => `${l.quantity} × ${l.bottleType.name}`).join(', ');
}

// ─── Kit (create and General tab) ───────────────────────────────────────────

export function KitForm({
  kit,
  serviceTypes,
  disabled,
}: {
  kit?: ProductDto;
  serviceTypes: ServiceTypeSummaryDto[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const { pending, error, fields, success, run } = useMutation();
  const linked = new Set(kit?.serviceTypes.map((s) => s.id));
  // Inactive service types stay listed only while the kit still uses them.
  const options = serviceTypes.filter(
    (s) => (s.isActive && s.category.isActive) || linked.has(s.id),
  );
  const groups = [...new Map(options.map((s) => [s.category.id, s.category])).values()];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      code: text(data, 'code'),
      name: text(data, 'name'),
      description: text(data, 'description'),
      serviceTypeIds: data.getAll('serviceTypeIds').map(String),
      ...(kit ? { isActive: data.get('isActive') === 'on' } : {}),
    };
    await run(
      () =>
        apiFetch<ProductDto>(kit ? `/lab/products/${kit.id}` : '/lab/products', {
          method: kit ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        }),
      {
        success: kit ? 'Saved.' : undefined,
        onSuccess: (created) =>
          !kit && router.push(`/admin/lab/kits/${created.data.id}?tab=bottles`),
      },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <CodeNameFields
        prefix="kit"
        values={kit}
        fields={fields}
        codeHint="Short and unique, e.g. BWK"
        disabled={disabled}
      />
      <Field label="Description" htmlFor="kit-description" error={fields.description}>
        <textarea
          className="textarea"
          id="kit-description"
          name="description"
          rows={2}
          defaultValue={kit?.description ?? ''}
          disabled={disabled}
        />
      </Field>
      <fieldset className="check-group">
        <legend>Used for</legend>
        {options.length === 0 && <span className="muted">Create a service type first.</span>}
        {groups.map((g) => (
          <div key={g.id} className="stack" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {g.name}
            </span>
            {options
              .filter((s) => s.category.id === g.id)
              .map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    name="serviceTypeIds"
                    value={s.id}
                    defaultChecked={linked.has(s.id)}
                    disabled={disabled}
                  />
                  {s.name}
                  {!s.isActive && ' (inactive)'}
                </label>
              ))}
          </div>
        ))}
      </fieldset>
      {fields.serviceTypeIds && (
        <span className="field-error" role="alert">
          {fields.serviceTypeIds}
        </span>
      )}
      {kit && (
        <label className="check">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={kit.isActive}
            disabled={disabled}
          />{' '}
          Active (can be received and registered)
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      {!disabled && (
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : kit ? 'Save' : 'Create kit'}
          </button>
        </div>
      )}
    </form>
  );
}

// ─── Bottle lines (kit and variant) ─────────────────────────────────────────

interface Line {
  bottleTypeId: string;
  quantity: number;
}

/** Edits a list of bottle types with quantities and saves it with PUT {bottles}. */
export function BottleLinesEditor({
  idPrefix,
  lines,
  bottleTypes,
  url,
  saveLabel = 'Save bottles',
  emptyHint,
}: {
  idPrefix: string;
  lines: BottleLineDto[];
  bottleTypes: BottleTypeDto[];
  url: string;
  saveLabel?: string;
  emptyHint: string;
}) {
  const initial = lines.map((l) => ({ bottleTypeId: l.bottleType.id, quantity: l.quantity }));
  const [rows, setRows] = useState<Line[]>(initial);
  const { pending, error, fields, success, run } = useMutation();
  const used = new Set(rows.map((r) => r.bottleTypeId));
  const choosable = (current: string) =>
    bottleTypes.filter(
      (b) =>
        b.id === current ||
        (!used.has(b.id) && (b.isActive || initial.some((i) => i.bottleTypeId === b.id))),
    );
  const update = (i: number, patch: Partial<Line>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstFree = bottleTypes.find((b) => b.isActive && !used.has(b.id));

  async function save(event: FormEvent) {
    event.preventDefault();
    await run(() => apiFetch(url, { method: 'PUT', body: JSON.stringify({ bottles: rows }) }), {
      success: 'Saved.',
    });
  }
  return (
    <form className="stack" onSubmit={save} noValidate>
      {rows.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {emptyHint}
        </p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <Field label="Bottle" htmlFor={`${idPrefix}-bottle-${i}`}>
              <select
                className="select"
                id={`${idPrefix}-bottle-${i}`}
                value={r.bottleTypeId}
                onChange={(e) => update(i, { bottleTypeId: e.target.value })}
              >
                {choosable(r.bottleTypeId).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ width: 110 }}>
            <Field label="Quantity" htmlFor={`${idPrefix}-qty-${i}`}>
              <input
                className="input"
                id={`${idPrefix}-qty-${i}`}
                type="number"
                min={1}
                max={100}
                value={r.quantity}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              />
            </Field>
          </div>
          <button
            type="button"
            className="btn"
            aria-label={`Remove bottle ${i + 1}`}
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={!firstFree}
          onClick={() =>
            firstFree && setRows((rs) => [...rs, { bottleTypeId: firstFree.id, quantity: 1 }])
          }
        >
          Add bottle
        </button>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : saveLabel}
        </button>
      </div>
      <FormStatus error={error} fields={fields} success={success} />
    </form>
  );
}

// ─── Variants ───────────────────────────────────────────────────────────────

function VariantForm({ kit, variant }: { kit: ProductDto; variant?: ProductVariantDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = variant ? `var-${variant.id}` : 'var-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      code: text(data, 'code'),
      name: text(data, 'name'),
      ...(variant ? { isActive: data.get('isActive') === 'on' } : {}),
    };
    await run(
      () =>
        apiFetch(variant ? `/lab/variants/${variant.id}` : `/lab/products/${kit.id}/variants`, {
          method: variant ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        }),
      { success: variant ? 'Saved.' : undefined, onSuccess: () => !variant && form.reset() },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <CodeNameFields prefix={prefix} values={variant} fields={fields} codeHint="e.g. UV" />
      {variant && (
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={variant.isActive} /> Active
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : variant ? 'Save' : 'Add variant'}
        </button>
      </div>
    </form>
  );
}

export function Variants({
  kit,
  bottleTypes,
  canManage,
}: {
  kit: ProductDto;
  bottleTypes: BottleTypeDto[];
  canManage: boolean;
}) {
  return (
    <div className="stack">
      <DataTable
        label="Variants"
        rows={kit.variants}
        rowKey={(v) => v.id}
        empty="No variants. Kits without variants are received as they are."
        columns={[
          {
            header: 'Variant',
            primary: true,
            cell: (v) => (
              <>
                {v.name}
                <span className="cell-sub">
                  <code>{v.code}</code>
                </span>
              </>
            ),
          },
          {
            header: 'Bottles',
            cell: (v) => (
              <>
                {bottleSummary(v.effectiveBottles)}
                <span className="cell-sub">
                  {v.bottles.length > 0 ? 'Own bottles' : 'Same as the kit'}
                </span>
              </>
            ),
          },
          { header: 'Status', cell: (v) => <ActiveBadge active={v.isActive} /> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (v: ProductVariantDto) => (
                    <>
                      <EditDialog title={`Edit ${v.name}`}>
                        <VariantForm kit={kit} variant={v} />
                      </EditDialog>
                      <EditDialog title={`Bottles for ${v.name}`} label="Bottles">
                        <p className="muted" style={{ marginTop: 0 }}>
                          Leave empty to use the kit’s bottles ({bottleSummary(kit.bottles)}).
                        </p>
                        <BottleLinesEditor
                          idPrefix={`var-${v.id}`}
                          lines={v.bottles}
                          bottleTypes={bottleTypes}
                          url={`/lab/variants/${v.id}/bottles`}
                          emptyHint="Uses the kit’s bottles."
                        />
                      </EditDialog>
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add a variant</h2>
          <VariantForm kit={kit} />
        </section>
      )}
    </div>
  );
}

// ─── Bottle types ───────────────────────────────────────────────────────────

function BottleTypeForm({ bottle }: { bottle?: BottleTypeDto }) {
  const { pending, error, fields, success, run } = useMutation();
  const prefix = bottle ? `bt-${bottle.id}` : 'bt-new';
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      code: text(data, 'code'),
      name: text(data, 'name'),
      volumeMl: text(data, 'volumeMl'),
      material: text(data, 'material'),
      ...(bottle ? { isActive: data.get('isActive') === 'on' } : {}),
    };
    await run(
      () =>
        apiFetch(bottle ? `/lab/bottle-types/${bottle.id}` : '/lab/bottle-types', {
          method: bottle ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        }),
      { success: bottle ? 'Saved.' : undefined, onSuccess: () => !bottle && form.reset() },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <CodeNameFields prefix={prefix} values={bottle} fields={fields} codeHint="e.g. PET-1000" />
      <div className="grid-2">
        <Field label="Volume (ml)" htmlFor={`${prefix}-volume`} error={fields.volumeMl}>
          <input
            className="input"
            id={`${prefix}-volume`}
            name="volumeMl"
            type="number"
            min={1}
            inputMode="numeric"
            defaultValue={bottle?.volumeMl}
          />
        </Field>
        <Field label="Material" htmlFor={`${prefix}-material`} hint="e.g. PET, HDPE, sterile PP">
          <input
            className="input"
            id={`${prefix}-material`}
            name="material"
            defaultValue={bottle?.material ?? ''}
          />
        </Field>
      </div>
      {bottle && (
        <label className="check">
          <input type="checkbox" name="isActive" defaultChecked={bottle.isActive} /> Active
        </label>
      )}
      <FormStatus error={error} fields={fields} success={success} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : bottle ? 'Save' : 'Add bottle type'}
        </button>
      </div>
    </form>
  );
}

export function BottleTypes({
  bottles,
  canManage,
}: {
  bottles: BottleTypeDto[];
  canManage: boolean;
}) {
  return (
    <div className="stack">
      {canManage && (
        <section className="card">
          <h2 className="card-title">Add a bottle type</h2>
          <BottleTypeForm />
        </section>
      )}
      <DataTable
        label="Bottle types"
        rows={bottles}
        rowKey={(b) => b.id}
        empty="No bottle types yet."
        columns={[
          {
            header: 'Bottle',
            primary: true,
            cell: (b) => (
              <>
                {b.name}
                <span className="cell-sub">
                  <code>{b.code}</code>
                </span>
              </>
            ),
          },
          { header: 'Volume', cell: (b) => `${b.volumeMl.toLocaleString('en')} ml` },
          { header: 'Material', cell: (b) => b.material ?? '—' },
          {
            header: 'Used by',
            cell: (b) =>
              b.usageCount === 0 ? (
                <span className="muted">Not used</span>
              ) : (
                `${b.usageCount} kit${b.usageCount === 1 ? '' : 's'} or variants`
              ),
          },
          { header: 'Status', cell: (b) => <ActiveBadge active={b.isActive} /> },
          ...(canManage
            ? [
                {
                  header: 'Actions',
                  actions: true,
                  cell: (b: BottleTypeDto) => (
                    <EditDialog title={`Edit ${b.name}`}>
                      <BottleTypeForm bottle={b} />
                    </EditDialog>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
