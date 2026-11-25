'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ReceivedKitDto, ReceivingOptionsDto } from '@flux/shared';
import { KitTable } from '../receiving/kit-forms';

/**
 * The queue with kit selection for batch registration. A batch has one service type, so kits
 * already assigned to different service types cannot be registered together.
 */
export function QueueTable({
  kits,
  options,
  canReceive,
  canRegister,
}: {
  kits: ReceivedKitDto[];
  options: ReceivingOptionsDto;
  canReceive: boolean;
  canRegister: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = kits.filter((k) => selected.has(k.id));
  const serviceTypes = new Set(chosen.map((k) => k.serviceType?.id).filter(Boolean));
  const mixed = serviceTypes.size > 1;

  return (
    <div className="stack">
      {canRegister && kits.length > 0 && (
        <div className="selection-bar" role="region" aria-label="Batch registration">
          <span>
            {chosen.length === 0
              ? 'Select kits of one service type to register them as a batch.'
              : `${chosen.length} kit${chosen.length === 1 ? '' : 's'} selected`}
            {mixed && <span className="field-error"> Choose kits of a single service type.</span>}
          </span>
          <span className="row">
            {chosen.length > 0 && (
              <button type="button" className="btn" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            )}
            {chosen.length > 0 && !mixed ? (
              <Link
                className="btn btn-primary"
                href={`/lab/batches/new?kits=${chosen.map((k) => k.id).join(',')}`}
              >
                Register batch
              </Link>
            ) : (
              <button type="button" className="btn btn-primary" disabled>
                Register batch
              </button>
            )}
          </span>
        </div>
      )}
      <KitTable
        kits={kits}
        options={options}
        canReceive={canReceive}
        showAirwayBill
        empty="No kits are waiting for registration."
        selection={canRegister ? { selected, toggle } : undefined}
        hideStatus
      />
    </div>
  );
}
