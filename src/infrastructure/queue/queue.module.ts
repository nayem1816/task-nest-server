import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { Env } from '../../config/env.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        // BullMQ types its connection options with an `any` index signature,
        // which the type-aware lint rule reads as an unsafe assignment.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const connection: ConnectionOptions = { url: config.get('REDIS_URL', { infer: true }) };
        return {
          connection,
          prefix: 'tasknest',
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2_000 },
            // Keep a short history for inspection; failed jobs stay longer so
            // they can be investigated and retried by hand.
            removeOnComplete: { age: 24 * 3600, count: 1_000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        };
      },
    }),
  ],
})
export class QueueModule {}
