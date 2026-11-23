import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('unwraps data and meta from the success envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [1, 2],
        meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      }),
    );
    const result = await apiFetch<number[]>('/things', {}, fetchImpl);
    expect(result.data).toEqual([1, 2]);
    expect(result.meta?.total).toBe(2);
  });

  it('throws ApiError carrying the server error envelope', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(409, { error: { code: 'CONFLICT', message: 'Duplicate IMO' } }),
      );
    await expect(apiFetch('/vessels', {}, fetchImpl)).rejects.toMatchObject({
      status: 409,
      body: { code: 'CONFLICT', message: 'Duplicate IMO' },
    });
  });

  it('maps network failures to SERVICE_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const error = await apiFetch('/health', {}, fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body.code).toBe('SERVICE_UNAVAILABLE');
  });
});
