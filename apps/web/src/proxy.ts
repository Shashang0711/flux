import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@flux/shared';

/**
 * Optimistic check only: redirects to /login when there is no session cookie at all.
 * The session itself is validated by the API (requireSession in Server Components), as the
 * Next.js docs recommend keeping database checks out of Proxy.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') loginUrl.searchParams.set('next', next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the login page, API proxy, Next internals and static files.
  matcher: ['/((?!login|api/|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
