import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, type PermissionKey, type SessionInfo } from '@flux/shared';
import { ApiError, apiFetch, type ApiResult } from './api';

/** apiFetch for Server Components: forwards the caller's session cookie to the API. */
export async function serverApiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const session = (await cookies()).get(SESSION_COOKIE_NAME);
  return apiFetch<T>(path, {
    cache: 'no-store',
    ...init,
    headers: {
      ...(session ? { Cookie: `${SESSION_COOKIE_NAME}=${session.value}` } : {}),
      ...init.headers,
    },
  });
}

/** The signed-in session (user + tenant + modules), or null if missing, expired or revoked. */
export async function getSession(): Promise<SessionInfo | null> {
  try {
    return (await serverApiFetch<SessionInfo>('/auth/me')).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Use at the top of protected pages: validates the session with the API. */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Page guard: the session if the user holds every permission, otherwise null (render
 * <Forbidden />). The API enforces the same permissions on every call regardless.
 */
export async function sessionWithPermission(
  ...permissions: PermissionKey[]
): Promise<{ session: SessionInfo; allowed: boolean }> {
  const session = await requireSession();
  const allowed = permissions.every((p) => session.access.permissions.includes(p));
  return { session, allowed };
}

/** Loads data for a page: 401 → sign-in, 404 → not-found page, anything else throws. */
export async function loadOrNotFound<T>(path: string): Promise<{ data: T; meta?: unknown }> {
  try {
    return await serverApiFetch<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login');
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
}
