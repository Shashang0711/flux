import 'server-only';
import { ErrorCode, type ErrorEnvelope } from '@flux/shared';
import { apiBaseUrl } from './api';

/** Hop-by-hop and recomputed headers that must not be forwarded in either direction. */
const STRIPPED_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  // fetch() already decoded the body; the encoding header would be wrong.
  'content-encoding',
]);

function copyHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!STRIPPED_HEADERS.has(key) && key !== 'set-cookie') headers.set(key, value);
  });
  // forEach joins multiple Set-Cookie values into one; copy them individually.
  for (const cookie of source.getSetCookie()) headers.append('set-cookie', cookie);
  return headers;
}

/**
 * Forwards a browser request on `/api/v1/*` to the FLUX API.
 * The upstream URL comes from API_BASE_URL at request time (not build time), so one
 * build works in every environment. Cookies and x-forwarded-for pass through, and
 * Set-Cookie from the API comes back on this same origin.
 */
export async function proxyToApi(request: Request, path: string[]): Promise<Response> {
  // Dot segments would be resolved by fetch() and could escape the API base path.
  if (path.some((segment) => segment === '.' || segment === '..')) {
    const body: ErrorEnvelope = {
      error: { code: ErrorCode.BAD_REQUEST, message: 'Invalid API path' },
    };
    return Response.json(body, { status: 400 });
  }

  const incoming = new URL(request.url);
  const target = `${apiBaseUrl()}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: copyHeaders(request.headers),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    const body: ErrorEnvelope = {
      error: { code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Could not reach the FLUX API' },
    };
    return Response.json(body, { status: 503 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyHeaders(upstream.headers),
  });
}
