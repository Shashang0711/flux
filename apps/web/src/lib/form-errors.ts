import type { FieldIssue } from '@flux/shared';
import { ApiError } from './api';

/**
 * Field-level messages from an API error, keyed by field path ("email", "admin.email").
 * The API sends issues either as an array (validation) or as `{ fields: [...] }` (conflicts).
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const details = error.body.details;
  const issues: FieldIssue[] = Array.isArray(details)
    ? details
    : details && Array.isArray((details as { fields?: unknown }).fields)
      ? (details as { fields: FieldIssue[] }).fields
      : [];
  const result: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.path && !(issue.path in result)) result[issue.path] = issue.message;
  }
  return result;
}

/** A human-readable message for a failed request. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
