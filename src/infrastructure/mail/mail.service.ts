import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAIL_QUEUE, type OutgoingMail, type SendMailJob } from './mail.types.js';

/**
 * Callers hand over a rendered email and return immediately. Delivery happens
 * in the mail worker, with retries, so an SMTP hiccup never fails a signup.
 */
@Injectable()
export class MailService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<SendMailJob>) {}

  /**
   * @param dedupeKey Same key, same job: a retried request does not send twice.
   */
  async send(kind: string, mail: OutgoingMail, dedupeKey?: string): Promise<void> {
    await this.queue.add('send', { kind, ...mail }, dedupeKey ? { jobId: dedupeKey } : undefined);
  }
}
