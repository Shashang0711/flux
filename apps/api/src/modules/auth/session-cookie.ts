import type { CookieOptions, Response } from 'express';
import { SESSION_COOKIE_NAME } from '@flux/shared';

function baseOptions(secure: boolean): CookieOptions {
  // SameSite=Lax: the cookie is not sent on cross-site POSTs, which (with JSON-only bodies)
  // protects state-changing endpoints from CSRF.
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseOptions(secure), expires: expiresAt });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions(secure));
}

export function readSessionToken(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value = (cookies as Record<string, unknown>)[SESSION_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}
