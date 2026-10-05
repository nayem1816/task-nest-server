import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { AI_PROVIDER } from '../../src/modules/ai/ai.types.js';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { MailService } from '../../src/infrastructure/mail/mail.service.js';
import type { OutgoingMail } from '../../src/infrastructure/mail/mail.types.js';
import { RATE_LIMIT_KEY_PREFIX } from '../../src/infrastructure/rate-limit/redis-throttler.storage.js';
import { REDIS } from '../../src/infrastructure/redis/redis.module.js';
import { StorageService } from '../../src/infrastructure/storage/storage.service.js';
import { MemoryStorage } from './memory-storage.js';
import { ScriptedAiProvider } from './scripted-ai.js';

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
  /** The model every suite talks to; script its answers per test. */
  ai: ScriptedAiProvider;
  storage: MemoryStorage;
  resetRateLimits(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const outbox = new MailOutbox();
  const ai = new ScriptedAiProvider();
  const storage = new MemoryStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(outbox)
    // Never the real provider: a developer's .env key must not make tests spend tokens.
    .overrideProvider(AI_PROVIDER)
    .useValue(ai)
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({ bufferLogs: true });
  await configureApp(app);
  // Listen once for the whole suite. Otherwise supertest starts and stops the
  // server per request, and a request built while another one runs loses it.
  await app.listen(0);

  const redis = app.get<Redis>(REDIS);
  return {
    app,
    prisma: app.get(PrismaService),
    redis,
    outbox,
    ai,
    storage,
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

/** The `data` array of a paginated response, typed for the assertion at hand. */
export const rows = <T>(res: { body: unknown }) => (res.body as { data: T[] }).data;
