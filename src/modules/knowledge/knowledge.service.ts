import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { uuidv7 } from '../../common/crypto/uuid-v7.js';
import { AppException } from '../../common/http/app-exception.js';
import type { KnowledgeSource } from '../../generated/prisma/client.js';
import { KnowledgeSourceStatus, KnowledgeSourceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import { SUPPORTED_FILE_TYPES } from './extract.js';
import type {
  CreateTextSourceDto,
  CreateUrlSourceDto,
  KnowledgeSourceDetailDto,
  KnowledgeSourceDto,
  UpdateSourceDto,
} from './knowledge.dto.js';
import {
  type IndexSourceJob,
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_QUEUE,
  KnowledgeEvents,
  type KnowledgeSourceUpdatedEvent,
} from './knowledge.types.js';

const errors = {
  notFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'KNOWLEDGE_SOURCE_NOT_FOUND',
      'That knowledge source does not exist.',
    ),
  full: () =>
    new AppException(
      HttpStatus.CONFLICT,
      'KNOWLEDGE_LIMIT_REACHED',
      `A workspace can have up to ${KNOWLEDGE_LIMITS.sourcesPerWorkspace} sources. Remove ones you no longer need first.`,
    ),
  duplicateUrl: (id: string) =>
    new AppException(
      HttpStatus.CONFLICT,
      'KNOWLEDGE_URL_EXISTS',
      'That page is already in the knowledge base. Use "Index again" to refresh it.',
      { sourceId: id },
    ),
  fileType: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'KNOWLEDGE_FILE_TYPE',
      `Upload a ${Object.values(SUPPORTED_FILE_TYPES).join(', ')} file.`,
    ),
  noFile: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'KNOWLEDGE_FILE_MISSING', 'Choose a file to upload.'),
  notText: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'KNOWLEDGE_NOT_EDITABLE',
      'Only written sources can be edited here. Pages and files are re-read with "Index again".',
    ),
};

// Browsers disagree on types for .md and sometimes send none; the extension decides.
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
};

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const listSelect = {
  id: true,
  type: true,
  title: true,
  url: true,
  fileName: true,
  status: true,
  error: true,
  chunkCount: true,
  charCount: true,
  lastIndexedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
    @InjectQueue(KNOWLEDGE_QUEUE) private readonly queue: Queue<IndexSourceJob>,
  ) {}

  list(organizationId: string): Promise<KnowledgeSourceDto[]> {
    return this.prisma.knowledgeSource.findMany({
      where: { organizationId },
      select: listSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(organizationId: string, id: string): Promise<KnowledgeSourceDetailDto> {
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id, organizationId },
      select: {
        ...listSelect,
        content: true,
        chunks: {
          select: { position: true, heading: true, content: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!source) throw errors.notFound();
    return source;
  }

  async createText(actor: RequestActor, dto: CreateTextSourceDto): Promise<KnowledgeSourceDto> {
    return this.create(actor, {
      type: KnowledgeSourceType.TEXT,
      title: dto.title,
      content: dto.content,
    });
  }

  async createUrl(actor: RequestActor, dto: CreateUrlSourceDto): Promise<KnowledgeSourceDto> {
    const url = new URL(dto.url).toString();
    const existing = await this.prisma.knowledgeSource.findFirst({
      where: { organizationId: actor.organizationId, url },
      select: { id: true },
    });
    if (existing) throw errors.duplicateUrl(existing.id);
    // Until the page is read, its address stands in for the title.
    return this.create(actor, { type: KnowledgeSourceType.URL, title: dto.title ?? url, url });
  }

  async createFile(
    actor: RequestActor,
    file: UploadedFile | undefined,
    title?: string,
  ): Promise<KnowledgeSourceDto> {
    if (!file) throw errors.noFile();
    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = TYPE_BY_EXTENSION[extension];
    if (!mimeType) throw errors.fileType();
    await this.assertRoom(actor.organizationId);

    const id = uuidv7();
    const safeName = file.originalname.replace(/[^\w.-]+/g, '_').slice(-120);
    const fileKey = `orgs/${actor.organizationId}/knowledge/${id}/${safeName}`;
    await this.storage.put(fileKey, file.buffer, mimeType);
    try {
      return await this.create(actor, {
        id,
        type: KnowledgeSourceType.FILE,
        title: title ?? file.originalname.replace(/\.[^.]+$/, ''),
        fileKey,
        fileName: file.originalname,
        mimeType,
      });
    } catch (err) {
      await this.storage.delete(fileKey).catch(() => undefined);
      throw err;
    }
  }

  async update(actor: RequestActor, id: string, dto: UpdateSourceDto): Promise<KnowledgeSourceDto> {
    const source = await this.find(actor.organizationId, id);
    if (dto.content !== undefined && source.type !== KnowledgeSourceType.TEXT)
      throw errors.notText();

    const contentChanged = dto.content !== undefined && dto.content !== source.content;
    const updated = await this.prisma.knowledgeSource.update({
      where: { id },
      data: {
        title: dto.title,
        ...(contentChanged && {
          content: dto.content,
          revision: { increment: 1 },
          status: KnowledgeSourceStatus.PENDING,
          error: null,
        }),
      },
    });
    if (contentChanged) await this.enqueue(updated);
    return pick(updated);
  }

  async reindex(actor: RequestActor, id: string): Promise<KnowledgeSourceDto> {
    await this.find(actor.organizationId, id);
    const updated = await this.prisma.knowledgeSource.update({
      where: { id },
      data: { revision: { increment: 1 }, status: KnowledgeSourceStatus.PENDING, error: null },
    });
    await this.enqueue(updated);
    return pick(updated);
  }

  async remove(actor: RequestActor, id: string): Promise<void> {
    const source = await this.find(actor.organizationId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSource.delete({ where: { id } });
      await this.audit.record(
        actor,
        {
          action: 'knowledge.source_removed',
          entityType: 'knowledge_source',
          entityId: id,
          metadata: { title: source.title, type: source.type },
        },
        tx,
      );
    });
    if (source.fileKey) {
      await this.storage.delete(source.fileKey).catch((err: unknown) => {
        // The row is gone; an orphaned object costs a little storage, nothing more.
        this.logger.warn({ err, fileKey: source.fileKey }, 'Could not delete knowledge file');
      });
    }
    this.events.emit(KnowledgeEvents.sourceUpdated, {
      organizationId: actor.organizationId,
      sourceId: id,
      status: 'DELETED',
    } satisfies KnowledgeSourceUpdatedEvent);
  }

  private async create(
    actor: RequestActor,
    data: {
      id?: string;
      type: KnowledgeSourceType;
      title: string;
      content?: string;
      url?: string;
      fileKey?: string;
      fileName?: string;
      mimeType?: string;
    },
  ): Promise<KnowledgeSourceDto> {
    await this.assertRoom(actor.organizationId);
    const source = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeSource.create({
        data: { ...data, organizationId: actor.organizationId, createdById: actor.userId },
      });
      await this.audit.record(
        actor,
        {
          action: 'knowledge.source_added',
          entityType: 'knowledge_source',
          entityId: created.id,
          metadata: { title: created.title, type: created.type },
        },
        tx,
      );
      return created;
    });
    await this.enqueue(source);
    return pick(source);
  }

  private async assertRoom(organizationId: string) {
    const count = await this.prisma.knowledgeSource.count({ where: { organizationId } });
    if (count >= KNOWLEDGE_LIMITS.sourcesPerWorkspace) throw errors.full();
  }

  private async find(organizationId: string, id: string): Promise<KnowledgeSource> {
    const source = await this.prisma.knowledgeSource.findFirst({ where: { id, organizationId } });
    if (!source) throw errors.notFound();
    return source;
  }

  private async enqueue(source: KnowledgeSource) {
    await this.queue.add(
      'index',
      { sourceId: source.id, revision: source.revision },
      // One job per revision: a double click or a retried request does not index twice.
      { jobId: `index-${source.id}-${source.revision}`, attempts: 4 },
    );
    this.events.emit(KnowledgeEvents.sourceUpdated, {
      organizationId: source.organizationId,
      sourceId: source.id,
      status: 'PENDING',
    } satisfies KnowledgeSourceUpdatedEvent);
  }
}

function pick(source: KnowledgeSource): KnowledgeSourceDto {
  return {
    id: source.id,
    type: source.type,
    title: source.title,
    url: source.url,
    fileName: source.fileName,
    status: source.status,
    error: source.error,
    chunkCount: source.chunkCount,
    charCount: source.charCount,
    lastIndexedAt: source.lastIndexedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
