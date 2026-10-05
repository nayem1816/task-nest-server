import { type ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Limits are counted per client IP, and per IP + email on routes that take an
 * email. That way one office behind a NAT does not lock everyone out of login,
 * while a single account still cannot be brute-forced from one address.
 */
@Injectable()
class TrackerThrottlerGuard extends ThrottlerGuard {
  // Global guards also wrap realtime message handlers, which have no HTTP request.
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(context.getType() !== 'http');
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { ip, clientIp, originalUrl } = req as unknown as Request;
    const body = (req as { body?: unknown }).body as Record<string, unknown> | undefined;
    // Only sign-in style routes: elsewhere (the chat widget) the email is just
    // data, and keying on it would let a caller dodge the limit by varying it.
    const email = originalUrl.startsWith('/api/v1/auth/') ? body?.email : undefined;
    const suffix = typeof email === 'string' ? `:${email.trim().toLowerCase()}` : '';
    return Promise.resolve(`${clientIp ?? ip ?? 'unknown'}${suffix}`);
  }
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        // A generous ceiling for everything; sensitive routes set tighter limits.
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: TrackerThrottlerGuard }],
})
export class RateLimitModule {}
