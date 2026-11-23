'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { errorMessage, fieldErrors } from '@/lib/form-errors';

export interface MutationState {
  pending: boolean;
  /** Form-level message (also set when there are field errors). */
  error: string | null;
  /** Field-level messages keyed by path, e.g. "email" or "admin.email". */
  fields: Record<string, string>;
  /** Message after the last success, if one was given. */
  success: string | null;
}

/**
 * Runs an API call from a form or button, tracks pending/error state and refreshes the
 * server-rendered page afterwards so it shows fresh data.
 */
export function useMutation() {
  const router = useRouter();
  const [state, setState] = useState<MutationState>({
    pending: false,
    error: null,
    fields: {},
    success: null,
  });

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      options: { success?: string; onSuccess?: (result: T) => void; refresh?: boolean } = {},
    ): Promise<T | undefined> => {
      setState({ pending: true, error: null, fields: {}, success: null });
      try {
        const result = await action();
        setState({ pending: false, error: null, fields: {}, success: options.success ?? null });
        options.onSuccess?.(result);
        if (options.refresh !== false) router.refresh();
        return result;
      } catch (err) {
        setState({
          pending: false,
          error: errorMessage(err),
          fields: fieldErrors(err),
          success: null,
        });
        return undefined;
      }
    },
    [router],
  );

  return { ...state, run };
}
