import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AppLoggerModule } from './infrastructure/logging/logger.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    AppLoggerModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    MailModule,
    // Global guards run in import order: rate limiting before authentication,
    // so invalid tokens are throttled too.
    RateLimitModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
