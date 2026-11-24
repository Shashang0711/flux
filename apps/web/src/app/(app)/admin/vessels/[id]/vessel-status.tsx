'use client';

import type { VesselDto } from '@flux/shared';
import { FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';

export function VesselStatusCard({ vessel }: { vessel: VesselDto }) {
  const { pending, error, run } = useMutation();
  const active = vessel.status === 'ACTIVE';
  return (
    <section className="card">
      <h2 className="card-title">Status</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {active
          ? 'Deactivate vessels that are sold, scrapped or no longer serviced. Their history is kept.'
          : 'This vessel is inactive.'}
      </p>
      <FormStatus error={error} />
      <button
        type="button"
        className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}
        disabled={pending}
        onClick={() =>
          run(() =>
            apiFetch(`/vessels/${vessel.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: active ? 'INACTIVE' : 'ACTIVE' }),
            }),
          )
        }
      >
        {active ? 'Deactivate vessel' : 'Activate vessel'}
      </button>
    </section>
  );
}
