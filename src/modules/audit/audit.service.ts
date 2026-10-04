import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { ActorType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

export interface AuditQuery {
  limit: number;
  cursor?: string;
  action?: string;
  entityType?: string;
  actorId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass the transaction client when recording alongside a change, so the
   * entry exists if and only if the change committed.
   */
  async record(actor: RequestActor, entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorType: ActorType.USER,
        actorId: actor.userId,
        actorLabel: actor.label,
        ip: actor.ip,
        userAgent: actor.userAgent,
        ...entry,
      },
    });
  }

  /** Newest first. UUIDv7 ids are time-ordered, so the id doubles as the cursor. */
  async list(organizationId: string, query: AuditQuery) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        action: query.action,
        entityType: query.entityType,
        actorId: query.actorId,
        ...(query.cursor && { id: { lt: query.cursor } }),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
  }
}
