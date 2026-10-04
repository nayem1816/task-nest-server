import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AppLoggerModule } from './infrastructure/logging/logger.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    AppLoggerModule,
    DatabaseModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
