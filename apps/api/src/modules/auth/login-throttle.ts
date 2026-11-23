/** Throttle key for the per-account login limit: the normalised email being attempted. */
export function loginAccountTracker(body: unknown): string {
  const email =
    typeof body === 'object' && body !== null && 'email' in body
      ? (body as { email: unknown }).email
      : '';
  return `account:${String(email ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254)}`;
}
