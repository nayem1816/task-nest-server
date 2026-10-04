import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

export const RATE_LIMIT_KEY_PREFIX = 'tasknest:throttle:';

// Fixed window counter plus an optional block key, done atomically so two API
// replicas cannot both let the (limit + 1)th request through.
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(redis.call('GET', KEYS[1]) or ARGV[2]), redis.call('PTTL', KEYS[1]), 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) and tonumber(ARGV[3]) > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    const base = `${RATE_LIMIT_KEY_PREFIX}${name}:${key}`;
    const [totalHits, ttlMs, blocked, blockMs] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    // The guard expects seconds, as the built-in in-memory storage returns.
    return {
      totalHits,
      timeToExpire: Math.ceil(Math.max(ttlMs, 0) / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(Math.max(blockMs, 0) / 1000),
    };
  }
}
