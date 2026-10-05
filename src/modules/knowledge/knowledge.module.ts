import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { KnowledgeIndexer } from './knowledge-indexer.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeProcessor } from './knowledge.processor.js';
import { KnowledgeService } from './knowledge.service.js';
import { KNOWLEDGE_QUEUE } from './knowledge.types.js';

@Module({
  imports: [BullModule.registerQueue({ name: KNOWLEDGE_QUEUE })],
  providers: [KnowledgeProcessor, KnowledgeIndexer],
})
class KnowledgeWorkerModule {}

@Module({
  imports: [
    BullModule.registerQueue({ name: KNOWLEDGE_QUEUE }),
    ConditionalModule.registerWhen(
      KnowledgeWorkerModule,
      (env) => env.WORKERS_ENABLED !== 'false',
      {
        timeout: 20_000,
      },
    ),
  ],
  controllers: [KnowledgeController],
  // The indexer is here too so tests (which run no workers) can call it directly.
  providers: [KnowledgeService, KnowledgeSearchService, KnowledgeIndexer],
  exports: [KnowledgeSearchService],
})
export class KnowledgeModule {}
