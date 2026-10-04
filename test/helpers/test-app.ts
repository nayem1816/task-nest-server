import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { MailService } from '../../src/infrastructure/mail/mail.service.js';
import type { OutgoingMail } from '../../src/infrastructure/mail/mail.types.js';
import { RATE_LIMIT_KEY_PREFIX } from '../../src/infrastructure/rate-limit/redis-throttler.storage.js';
import { REDIS } from '../../src/infrastructure/redis/redis.module.js';

/** Captures outgoing email instead of queueing it. */
export class MailOutbox {
  readonly sent: (OutgoingMail & { kind: string })[] = [];

  send(kind: string, mail: OutgoingMail): Promise<void> {
    this.sent.push({ kind, ...mail });
    return Promise.resolve();
  }

  /** The `token` query parameter of the last link emailed to `to`. */
  lastToken(to: string, kind: string): string {
    const mail = this.sent.filter((m) => m.to === to && m.kind === kind).at(-1);
    const token = mail?.text.match(/token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`No ${kind} email with a token was sent to ${to}`);
    return token;
  }
}

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  redis: Redis;
  outbox: MailOutbox;
  resetRateLimits(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const outbox = new MailOutbox();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(outbox)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({ bufferLogs: true });
  await configureApp(app);
  await app.init();

  const redis = app.get<Redis>(REDIS);
  return {
    app,
    prisma: app.get(PrismaService),
    redis,
    outbox,
    async resetRateLimits() {
      const keys = await redis.keys(`${RATE_LIMIT_KEY_PREFIX}*`);
      if (keys.length > 0) await redis.del(...keys);
    },
  };
}

export function uniqueEmail(label: string): string {
  return `${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@e2e.test`;
}

/** The refresh cookie value from a response's Set-Cookie header. */
export function refreshCookie(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = cookies.map((c) => c.match(/^tn_refresh=([^;]*)/)?.[1]).find(Boolean);
  if (!match) throw new Error('No tn_refresh cookie in response');
  return match;
}
