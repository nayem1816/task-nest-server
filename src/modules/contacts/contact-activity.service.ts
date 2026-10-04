import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface ActivityInput {
  organizationId: string;
  contactId: string;
  type: string;
  actor?: { id: string; label: string } | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Appends to a contact's timeline. Exported so other domains (conversations,
 * orders, leads) can record what happened to a contact in the same transaction
 * as their own change.
 */
@Injectable()
export class ContactActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: ActivityInput, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    await db.contactActivity.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        type: input.type,
        actorId: input.actor?.id,
        actorLabel: input.actor?.label,
        metadata: input.metadata,
      },
    });
  }

  async list(organizationId: string, contactId: string, limit: number, cursor?: string) {
    const rows = await this.prisma.contactActivity.findMany({
      where: { organizationId, contactId, ...(cursor && { id: { lt: cursor } }) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
  }
}
