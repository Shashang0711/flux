import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@flux/shared';
import { contentSecurityPolicy } from './lib/security-headers';

/**
 * Runs before every page:
 * - sets a Content-Security-Policy with a fresh nonce (Next.js adds it to its own scripts, as
 *   it reads the policy from the request headers), so injected scripts cannot run;
 * - optimistic sign-in check: redirects to /login when there is no session cookie at all. The
 *   session itself is validated by the API (requireSession in Server Components), as the
 *   Next.js docs recommend keeping database checks out of Proxy.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');

  const { pathname, search } = request.nextUrl;
  if (pathname !== '/login' && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL('/login', request.url);
    const next = pathname + search;
    if (next !== '/') loginUrl.searchParams.set('next', next);
    return NextResponse.redirect(loginUrl);
  }

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Every page, including the sign-in page. Not the API proxy, Next internals or static files.
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)',
      // Prefetches render nothing new; skip them.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
