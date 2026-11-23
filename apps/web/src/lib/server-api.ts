import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, type UserDto } from '@flux/shared';
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

/** The signed-in user, or null if the session is missing, expired or revoked. */
export async function getCurrentUser(): Promise<UserDto | null> {
  try {
    return (await serverApiFetch<UserDto>('/auth/me')).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Use at the top of protected pages: validates the session with the API. */
export async function requireUser(): Promise<UserDto> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
