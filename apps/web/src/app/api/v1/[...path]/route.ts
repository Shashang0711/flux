import { proxyToApi } from '@/lib/api-proxy';

/**
 * Same-origin gateway to the FLUX API for browser code (see lib/api-proxy.ts).
 * Keeps the session cookie first-party and avoids CORS.
 */
type Context = { params: Promise<{ path: string[] }> };

async function handler(request: Request, { params }: Context): Promise<Response> {
  return proxyToApi(request, (await params).path);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
