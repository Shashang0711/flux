import {
  ErrorCode,
  isErrorEnvelope,
  type ErrorBody,
  type PageMeta,
  type SuccessEnvelope,
} from '@flux/shared';

/** Thrown for any non-2xx API response; carries the server's error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: PageMeta;
}

type FetchLike = typeof fetch;

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1';
}

/**
 * Calls the FLUX API and unwraps the `{ data, meta }` envelope.
 * Errors (including network failures) surface as ApiError with a stable `code`.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, {
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Could not reach the FLUX API',
    });
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isErrorEnvelope(body)) throw new ApiError(response.status, body.error);
    throw new ApiError(response.status, {
      code: ErrorCode.INTERNAL_ERROR,
      message: `Unexpected response (${response.status})`,
    });
  }

  const envelope = body as SuccessEnvelope<T>;
  return { data: envelope.data, meta: envelope.meta };
}
