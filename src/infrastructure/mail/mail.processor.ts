import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';
import { MAIL_QUEUE, type SendMailJob } from './mail.types.js';

@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(MailProcessor.name);
    this.transport = createTransport(config.get('SMTP_URL', { infer: true }));
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async process(job: Job<SendMailJob>): Promise<void> {
    const { kind, to, subject, text, html } = job.data;
    const started = Date.now();
    await this.transport.sendMail({ from: this.from, to, subject, text, html });
    // Recipient is logged by domain only; the full address is personal data.
    this.logger.info(
      { jobId: job.id, kind, toDomain: to.split('@')[1], ms: Date.now() - started },
      'Email sent',
    );
  }
}
