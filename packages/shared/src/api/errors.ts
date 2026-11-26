/** Machine-readable error codes returned in every error envelope. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  /** The tenant is not licensed for the module this endpoint belongs to. */
  MODULE_NOT_ENABLED: 'MODULE_NOT_ENABLED',
  /** The user's organisation has been suspended by the platform. */
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  /** The request body is larger than the API accepts. */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** One field-level problem, e.g. from request validation. */
export interface FieldIssue {
  path: string;
  message: string;
}
