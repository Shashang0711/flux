/**
 * Only allows same-site relative paths as post-login destinations, preventing open
 * redirects such as `?next=https://evil.example` or `?next=//evil.example`.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}
