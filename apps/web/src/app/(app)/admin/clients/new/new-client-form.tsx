'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { ClientDto, CustomFieldDefinitionDto } from '@flux/shared';
import { FormStatus } from '@/components/field';
import { useMutation } from '@/hooks/use-mutation';
import { apiFetch } from '@/lib/api';
import { ClientFields, clientPayload } from '../client-fields';

export function NewClientForm({ customFields }: { customFields: CustomFieldDefinitionDto[] }) {
  const router = useRouter();
  const { pending, error, fields, run } = useMutation();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = clientPayload(new FormData(event.currentTarget), customFields);
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
      <ClientFields fields={fields} customFields={customFields} />
      <FormStatus error={error} fields={fields} />
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create client'}
        </button>
      </div>
    </form>
  );
}
