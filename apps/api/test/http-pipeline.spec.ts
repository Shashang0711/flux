import { Controller, Get, INestApplication, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { PageQuery } from '@flux/shared';
import { Paginated, pageQuerySchema } from '../src/common/pagination/pagination';
import { ZodValidationPipe } from '../src/common/validation/zod-validation.pipe';
import { Public } from '../src/modules/auth/decorators';
import { createTestApp, type PrismaMock } from './create-test-app';

/** Throwaway routes that exercise the shared pipeline pieces. */
@Public()
@Controller('__test')
class PipelineTestController {
  @Get('items')
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Paginated<{ n: number }> {
    return new Paginated([{ n: 1 }, { n: 2 }], 45, query);
  }

  @Get('duplicate')
  duplicate(): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['imo_number'] },
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail');
  }
}

/** No @Public(): must be rejected without a session. */
@Controller('__test-protected')
class ProtectedTestController {
  @Get()
  secret(): string {
    return 'secret';
  }
}

describe('HTTP pipeline', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({
      controllers: [PipelineTestController, ProtectedTestController],
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns the health status inside a data envelope', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      expect(res.body.data).toMatchObject({ status: 'ok', checks: { database: 'up' } });
      expect(typeof res.body.data.version).toBe('string');
    });

    it('returns 503 SERVICE_UNAVAILABLE when the database is down', async () => {
      prisma.ping.mockRejectedValueOnce(new Error('connection refused'));
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
      expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });
  });

  describe('request correlation', () => {
    it('generates an x-request-id and includes it in error bodies', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
      const header = res.headers['x-request-id'];
      expect(header).toEqual(expect.any(String));
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', requestId: header });
    });

    it('echoes an inbound x-request-id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('x-request-id', 'trace-123');
      expect(res.headers['x-request-id']).toBe('trace-123');
    });
  });

  describe('pagination and validation', () => {
    it('renders Paginated results as data + meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/__test/items?page=2&pageSize=20')
        .expect(200);
      expect(res.body).toEqual({
        data: [{ n: 1 }, { n: 2 }],
        meta: { page: 2, pageSize: 20, total: 45, totalPages: 3 },
      });
    });

    it('applies default paging when no query is given', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/__test/items').expect(200);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('rejects invalid query params with VALIDATION_ERROR and field details', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/__test/items?page=0&pageSize=500')
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['page', 'pageSize']));
    });
  });

  describe('error mapping', () => {
    it('maps Prisma unique violations to 409 CONFLICT', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/__test/duplicate').expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        details: { target: ['imo_number'] },
      });
    });

    it('hides internal details of unexpected errors', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/__test/boom').expect(500);
      expect(res.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });
  });

  it('denies routes by default when there is no session', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/__test-protected').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(JSON.stringify(res.body)).not.toContain('secret"');
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
