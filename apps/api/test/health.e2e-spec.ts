import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/** Real database round-trip. Requires DATABASE_URL to point at a migrated database. */
describe('Health (e2e, real database)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, { corsOrigins: [] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.data.checks.database).toBe('up');
  });
});
