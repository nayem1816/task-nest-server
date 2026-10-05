import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { uuidv7 } from '../../common/crypto/uuid-v7.js';
import { Prisma } from '../../generated/prisma/client.js';
import { KnowledgeSourceStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { AiError } from '../ai/ai.errors.js';
import { AiService } from '../ai/ai.service.js';
import { chunkText } from './chunk.js';
import { ExtractionError, extractFile, htmlToText } from './extract.js';
import {
  KNOWLEDGE_LIMITS,
  KnowledgeEvents,
  type KnowledgeSourceUpdatedEvent,
} from './knowledge.types.js';
import { fetchPublicPage } from './safe-fetch.js';

type Source = NonNullable<Awaited<ReturnType<PrismaService['knowledgeSource']['findUnique']>>>;

/**
 * Turns one source into searchable chunks: read the text, split it, embed the
 * pieces, and swap them in. The queue worker calls it; tests call it directly.
 */
@Injectable()
export class KnowledgeIndexer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * @param finalAttempt When false, a transient AI failure is rethrown so the
   *   queue retries later; the source stays "processing" meanwhile.
   */
  async index(sourceId: string, revision: number, finalAttempt = true): Promise<void> {
    const source = await this.prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
    // Deleted, or edited again since this job was queued: a newer job owns it.
    if (!source || source.revision !== revision) return;

    await this.setStatus(source, revision, {
      status: KnowledgeSourceStatus.PROCESSING,
      error: null,
    });

    try {
      const { text, title } = await this.readText(source);
      if (text.length > KNOWLEDGE_LIMITS.charsPerSource) {
        throw new ExtractionError(
          `This source has ${text.length.toLocaleString('en')} characters; the limit is ${KNOWLEDGE_LIMITS.charsPerSource.toLocaleString('en')}. Split it into smaller parts.`,
        );
      }
      const chunks = chunkText(text);
      if (chunks.length === 0) throw new ExtractionError('No text found to learn from.');

      const vectors = await this.ai.embed(
        { organizationId: source.organizationId, feature: 'knowledge.embed' },
        chunks.map((c) => (c.heading ? `${c.heading}\n\n${c.content}` : c.content)),
        'document',
      );

      const written = await this.prisma.$transaction(async (tx) => {
        // Lock the row so a concurrent edit cannot slip between check and write.
        const [current] = await tx.$queryRaw<{ revision: number }[]>`
          SELECT "revision" FROM "KnowledgeSource" WHERE "id" = ${source.id}::uuid FOR UPDATE`;
        if (current?.revision !== revision) return false;

        await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });
        const rows = chunks.map(
          (c, i) => Prisma.sql`(
            ${uuidv7()}::uuid, ${source.organizationId}::uuid, ${source.id}::uuid,
            ${c.position}, ${c.heading}, ${c.content}, ${toVector(vectors[i]!)}::vector)`,
        );
        await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk"
            ("id", "organizationId", "sourceId", "position", "heading", "content", "embedding")
          VALUES ${Prisma.join(rows)}`;
        await tx.knowledgeSource.update({
          where: { id: source.id },
          data: {
            status: KnowledgeSourceStatus.READY,
            error: null,
            content: text,
            // A page's own title replaces the address until someone renames it.
            ...(title && source.type === 'URL' && source.title === source.url && { title }),
            chunkCount: chunks.length,
            charCount: text.length,
            lastIndexedAt: new Date(),
          },
        });
        return true;
      });
      if (written) this.emit(source, 'READY');
    } catch (err) {
      if (err instanceof AiError && err.retryable && !finalAttempt) throw err;
      // Unreadable pages and provider outages are expected; only surprises need a stack.
      const expected = err instanceof ExtractionError || err instanceof AiError;
      this.logger.warn(
        { sourceId: source.id, reason: failureMessage(err), ...(!expected && { err }) },
        'Knowledge source failed to index',
      );
      await this.setStatus(source, revision, {
        status: KnowledgeSourceStatus.FAILED,
        error: failureMessage(err),
      });
    }
  }

  private async readText(source: Source): Promise<{ text: string; title: string | null }> {
    switch (source.type) {
      case 'TEXT':
        return { text: source.content ?? '', title: null };
      case 'URL': {
        const page = await fetchPublicPage(source.url!);
        return page.contentType === 'text/plain'
          ? { text: page.body, title: null }
          : htmlToText(page.body);
      }
      case 'FILE': {
        const buffer = await this.storage.get(source.fileKey!);
        return extractFile(buffer, source.mimeType!);
      }
    }
  }

  private async setStatus(
    source: Source,
    revision: number,
    data: { status: KnowledgeSourceStatus; error: string | null },
  ) {
    const { count } = await this.prisma.knowledgeSource.updateMany({
      where: { id: source.id, revision },
      data,
    });
    if (count > 0) this.emit(source, data.status);
  }

  private emit(source: Source, status: KnowledgeSourceUpdatedEvent['status']) {
    this.events.emit(KnowledgeEvents.sourceUpdated, {
      organizationId: source.organizationId,
      sourceId: source.id,
      status,
    } satisfies KnowledgeSourceUpdatedEvent);
  }
}

function failureMessage(err: unknown): string {
  if (err instanceof ExtractionError) return err.message;
  if (err instanceof AiError) {
    return err.code === 'AI_NOT_CONFIGURED'
      ? 'AI is not set up on this server, so sources cannot be indexed yet.'
      : `${err.message} Then use "Index again".`;
  }
  return 'Something went wrong while reading this source. Try "Index again"; if it keeps failing, contact support.';
}

function toVector(values: number[]): string {
  return `[${values.join(',')}]`;
}
