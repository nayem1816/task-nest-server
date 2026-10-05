import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AI_PROVIDER } from './ai.types.js';
import { GeminiProvider } from './gemini.provider.js';

/** Global so the agent, knowledge base and playground can all inject AiService. */
@Global()
@Module({
  controllers: [AiController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new GeminiProvider({
          apiKey: config.get('GEMINI_API_KEY', { infer: true }),
          chatModel: config.get('AI_CHAT_MODEL', { infer: true }),
          embeddingModel: config.get('AI_EMBEDDING_MODEL', { infer: true }),
        }),
    },
    AiService,
    AiUsageService,
  ],
  exports: [AiService],
})
export class AiModule {}
