import type { ErrorCode, FieldIssue } from './errors';
import type { PageMeta } from './pagination';

/** Successful response: `{ data }`, plus `meta` for paginated lists. */
export interface SuccessEnvelope<T> {
  data: T;
  meta?: PageMeta;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: FieldIssue[] | Record<string, unknown>;
  /** Correlation ID; also sent as the `x-request-id` response header. */
  requestId?: string;
}

/** Failed response: `{ error }`. */
export interface ErrorEnvelope {
  error: ErrorBody;
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return typeof value === 'object' && value !== null && 'error' in value;
}
