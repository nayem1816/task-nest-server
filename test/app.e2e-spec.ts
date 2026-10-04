import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

describe('HTTP foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    await configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness under the versioned prefix', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports database and redis as ready', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('echoes a well-formed upstream request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'lb-7f3a9c21');

    expect(res.headers['x-request-id']).toBe('lb-7f3a9c21');
  });

  it('replaces a malformed request id instead of trusting it', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'contains spaces; and "quotes"');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);

    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
