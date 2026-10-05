import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { KnowledgeSourceStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { KnowledgeIndexer } from './knowledge-indexer.service.js';
import { type IndexSourceJob, KNOWLEDGE_QUEUE } from './knowledge.types.js';

// Embedding calls are rate limited per key; a couple at a time is plenty.
@Processor(KNOWLEDGE_QUEUE, { concurrency: 2 })
export class KnowledgeProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly indexer: KnowledgeIndexer,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    @InjectQueue(KNOWLEDGE_QUEUE) private readonly queue: Queue<IndexSourceJob>,
  ) {
    super();
    this.logger.setContext(KnowledgeProcessor.name);
  }

  async process(job: Job<IndexSourceJob>): Promise<void> {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.indexer.index(job.data.sourceId, job.data.revision, finalAttempt);
  }

  /**
   * Sources added while no worker ran (or by the seed script) are still
   * waiting. Queue them; the job id makes this a no-op for ones already queued.
   */
  async onApplicationBootstrap(): Promise<void> {
    const waiting = await this.prisma.knowledgeSource.findMany({
      where: { status: { in: [KnowledgeSourceStatus.PENDING, KnowledgeSourceStatus.PROCESSING] } },
      select: { id: true, revision: true },
    });
    for (const s of waiting) {
      await this.queue.add(
        'index',
        { sourceId: s.id, revision: s.revision },
        { jobId: `index-${s.id}-${s.revision}`, attempts: 4 },
      );
    }
    if (waiting.length > 0)
      this.logger.info({ count: waiting.length }, 'Queued waiting knowledge sources');
  }
}
