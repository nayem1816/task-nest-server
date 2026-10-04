import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/infrastructure/mail/mail.service.js';
import { MAIL_QUEUE } from '../src/infrastructure/mail/mail.types.js';

// Runs against the real BullMQ queue (workers are off in tests), because job
// options like custom ids are validated by BullMQ, not by our types.
describe('mail queue (e2e)', () => {
  let app: INestApplication;
  let queue: Queue;
  const dedupeKey = `email-verification-${Date.now()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    await app.init();
    queue = app.get<Queue>(getQueueToken(MAIL_QUEUE));
  });

  afterAll(async () => {
    await (await queue.getJob(dedupeKey))?.remove();
    await app.close();
  });

  it('queues an email once per dedupe key', async () => {
    const mail = app.get(MailService);
    const message = { to: 'ops@e2e.test', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' };

    await mail.send('email_verification', message, dedupeKey);
    await mail.send('email_verification', message, dedupeKey);

    const job = await queue.getJob(dedupeKey);
    expect(job?.data).toMatchObject({ kind: 'email_verification', to: 'ops@e2e.test' });
    expect(await queue.getJobCountByTypes('waiting', 'delayed')).toBeGreaterThanOrEqual(1);
    const waiting = await queue.getJobs(['waiting']);
    expect(waiting.filter((j) => j.id === dedupeKey)).toHaveLength(1);
  });
});
