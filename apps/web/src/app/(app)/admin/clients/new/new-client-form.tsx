'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { ClientDto } from '@flux/shared';
import { FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { ClientFields, clientPayload } from '../client-fields';

export function NewClientForm() {
  const router = useRouter();
  const { pending, error, fields, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = clientPayload(new FormData(event.currentTarget));
    await run(
      () => apiFetch<ClientDto>('/clients', { method: 'POST', body: JSON.stringify(payload) }),
      {
        onSuccess: ({ data: client }) => router.push(`/admin/clients/${client.id}`),
        refresh: false,
      },
    );
  }
  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <ClientFields fields={fields} />
      <FormStatus error={Object.keys(fields).length > 0 ? null : error} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create client'}
        </button>
      </div>
    </form>
  );
}
