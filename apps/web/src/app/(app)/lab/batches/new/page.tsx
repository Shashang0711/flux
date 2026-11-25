import type { Metadata } from 'next';
import Link from 'next/link';
import type { RegistrationDraftDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { ApiError } from '@/lib/api';
import { serverApiFetch, sessionWithPermission } from '@/lib/server-api';
import { RegisterBatchForm } from './register-form';

export const metadata: Metadata = { title: 'Register batch · FLUX' };

export default async function RegisterBatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('sample.register');
  if (!allowed) return <Forbidden />;
  const kits = readParams(await searchParams, ['kits'] as const).kits ?? '';
  let draft: RegistrationDraftDto | null = null;
  let problem: string | null = null;
  try {
    draft = (
      await serverApiFetch<RegistrationDraftDto>(
        `/samples/registration-draft?kitIds=${encodeURIComponent(kits)}`,
      )
    ).data;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status >= 500) throw err;
    problem =
      err.status === 409 ? err.message : 'Choose the kits to register from the registration queue.';
  }
  return (
    <>
      <PageHeader
        title="Register batch"
        description="A batch ID and one sample ID per kit are assigned when you register."
        back={{ href: '/lab/registration-queue', label: 'Registration queue' }}
      />
      {problem || !draft ? (
        <p className="alert alert-error">
          {problem} <Link href="/lab/registration-queue">Back to the queue</Link>
        </p>
      ) : (
        <RegisterBatchForm draft={draft} />
      )}
    </>
  );
}
