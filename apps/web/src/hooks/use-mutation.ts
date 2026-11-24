'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { ErrorBody } from '@flux/shared';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/form-errors';

export interface MutationState {
  pending: boolean;
  /** Form-level message (also set when there are field errors). */
  error: string | null;
  /** Field-level messages keyed by path, e.g. "email" or "admin.email". */
  fields: Record<string, string>;
  /** The API's full error body (code, details…), for errors that carry extra data. */
  errorBody: ErrorBody | null;
  /** Message after the last success, if one was given. */
  success: string | null;
}

const IDLE: MutationState = {
  pending: false,
  error: null,
  fields: {},
  errorBody: null,
  success: null,
};

/**
 * Runs an API call from a form or button, tracks pending/error state and refreshes the
 * server-rendered page afterwards so it shows fresh data.
 */
export function useMutation() {
  const router = useRouter();
  const [state, setState] = useState<MutationState>(IDLE);

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      options: { success?: string; onSuccess?: (result: T) => void; refresh?: boolean } = {},
    ): Promise<T | undefined> => {
      setState({ ...IDLE, pending: true });
      try {
        const result = await action();
        setState({ ...IDLE, success: options.success ?? null });
        options.onSuccess?.(result);
        if (options.refresh !== false) router.refresh();
        return result;
      } catch (err) {
        setState({
          ...IDLE,
          error: errorMessage(err),
          fields: fieldErrors(err),
          errorBody: err instanceof ApiError ? err.body : null,
        });
        return undefined;
      }
    },
    [router],
  );

  return { ...state, run };
}
