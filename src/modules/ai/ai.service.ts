import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AiError } from './ai.errors.js';
import {
  AI_PROVIDER,
  type AiProvider,
  type EmbeddingPurpose,
  type GenerateRequest,
  type GenerateResult,
} from './ai.types.js';

/** Who is calling, for usage records and limits. */
export interface AiCallContext {
  organizationId: string;
  /** e.g. "agent.reply", "knowledge.embed", "ai.check". */
  feature: string;
}

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 700;

/**
 * The one door to the AI provider. Adds what every caller needs and none
 * should write twice: a timeout, one retry on transient failures, translated
 * errors, and a usage row per call (success or not).
 */
@Injectable()
export class AiService {
  private readonly timeoutMs: number;

  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('AI_TIMEOUT_MS', { infer: true });
  }

  get status() {
    return {
      configured: this.provider.configured,
      provider: this.provider.configured ? this.provider.name : null,
      chatModel: this.provider.chatModel,
      embeddingModel: this.provider.embeddingModel,
    };
  }

  generate(context: AiCallContext, request: GenerateRequest): Promise<GenerateResult> {
    return this.run(
      context,
      this.provider.chatModel,
      (signal) => this.provider.generate(request, signal),
      (result) => result.usage,
    );
  }

  embed(context: AiCallContext, texts: string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([]);
    return this.run(
      context,
      this.provider.embeddingModel,
      (signal) => this.provider.embed(texts, purpose, signal),
      // The embedding API does not report tokens; ~4 characters per token.
      () => ({
        inputTokens: Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4),
        outputTokens: 0,
      }),
    );
  }

  private async run<T>(
    context: AiCallContext,
    model: string,
    work: (signal: AbortSignal) => Promise<T>,
    tokens: (result: T) => { inputTokens: number; outputTokens: number },
  ): Promise<T> {
    if (!this.provider.configured) throw new AiError('AI_NOT_CONFIGURED');

    const started = Date.now();
    let lastError: AiError | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.withTimeout(work);
        await this.record(context, model, started, { ok: true, ...tokens(result) });
        return result;
      } catch (err) {
        lastError = err instanceof AiError ? err : new AiError('AI_UNAVAILABLE', String(err));
        this.logger.warn(
          { code: lastError.code, detail: lastError.detail, attempt, feature: context.feature },
          'AI call failed',
        );
        if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }
    await this.record(context, model, started, { ok: false, errorCode: lastError!.code });
    throw lastError!;
  }

  private async withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await work(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) throw new AiError('AI_TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async record(
    context: AiCallContext,
    model: string,
    started: number,
    outcome: { ok: boolean; inputTokens?: number; outputTokens?: number; errorCode?: string },
  ) {
    try {
      await this.prisma.aiUsage.create({
        data: {
          organizationId: context.organizationId,
          feature: context.feature,
          model,
          latencyMs: Date.now() - started,
          ...outcome,
        },
      });
    } catch (err) {
      // Losing a usage row must not fail the reply the customer is waiting for.
      this.logger.error({ err }, 'Could not record AI usage');
    }
  }
}
