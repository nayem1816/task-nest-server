import { Injectable, Module } from '@nestjs/common';
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
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const { ip } = req as unknown as Request;
    const body = (req as { body?: unknown }).body as Record<string, unknown> | undefined;
    const email = body?.email;
    const suffix = typeof email === 'string' ? `:${email.trim().toLowerCase()}` : '';
    return Promise.resolve(`${ip ?? 'unknown'}${suffix}`);
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
