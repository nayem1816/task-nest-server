import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { MailProcessor } from './mail.processor.js';
import { MailService } from './mail.service.js';
import { MAIL_QUEUE } from './mail.types.js';

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [MailProcessor],
})
class MailWorkerModule {}

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    ConditionalModule.registerWhen(MailWorkerModule, (env) => env.WORKERS_ENABLED !== 'false'),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
