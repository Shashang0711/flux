import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { proxyToApi } = await import('./api-proxy');

describe('proxyToApi', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.API_BASE_URL = 'http://api.internal:4000/api/v1';
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('forwards method, path, query, cookies and body to API_BASE_URL read at request time', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const request = new Request('http://web.local/api/v1/users?page=2', {
      method: 'POST',
      headers: {
        cookie: 'flux_session=abc',
        'content-type': 'application/json',
        host: 'web.local',
      },
      body: '{"name":"x"}',
    });

    await proxyToApi(request, ['users']);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.internal:4000/api/v1/users?page=2');
    expect(init.method).toBe('POST');
    expect(init.headers.get('cookie')).toBe('flux_session=abc');
    expect(init.headers.get('host')).toBeNull();
    expect(new TextDecoder().decode(init.body)).toBe('{"name":"x"}');
  });

  it('encodes path segments so they cannot inject a query or extra segments', async () => {
    fetchMock.mockResolvedValue(new Response('{}'));
    await proxyToApi(new Request('http://web.local/api/v1/x'), ['users', 'a/b?x=1']);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.internal:4000/api/v1/users/a%2Fb%3Fx%3D1');
  });

  it.each([['..'], ['.']])('rejects the dot segment %s without calling the API', async (seg) => {
    const response = await proxyToApi(new Request('http://web.local/api/v1/x'), [seg, 'admin']);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns every Set-Cookie header from the API', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; HttpOnly');
    headers.append('set-cookie', 'b=2; HttpOnly');
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers }));

    const response = await proxyToApi(
      new Request('http://web.local/api/v1/auth/logout', { method: 'POST' }),
      ['auth', 'logout'],
    );

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(['a=1; HttpOnly', 'b=2; HttpOnly']);
  });

  it('answers 503 in the standard envelope when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const response = await proxyToApi(new Request('http://web.local/api/v1/health'), ['health']);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Could not reach the FLUX API' },
    });
  });
});
