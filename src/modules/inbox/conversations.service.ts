import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppException } from '../../common/http/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  ConversationPriority,
  ConversationStatus,
  MemberStatus,
  MessageSender,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import { displayName } from '../contacts/contacts.service.js';
import type {
  AssignConversationDto,
  ConversationDto,
  InboxCountsDto,
  InboxView,
  ListConversationsQueryDto,
  UpdateConversationDto,
} from './inbox.dto.js';
import {
  type ConversationUpdatedEvent,
  InboxEvents,
  type MessageCreatedEvent,
} from './inbox.events.js';

const errors = {
  notFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'CONVERSATION_NOT_FOUND',
      'That conversation does not exist.',
    ),
  badAssignee: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'ASSIGNEE_NOT_AVAILABLE',
      'That person is not an active member of this workspace.',
    ),
  badTeam: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'TEAM_NOT_FOUND', 'That team does not exist.'),
  unknownTags: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'TAG_NOT_FOUND', 'Some of those tags do not exist.'),
  badCursor: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'That page cursor is not valid.'),
};

const OPEN_STATUSES: ConversationStatus[] = [ConversationStatus.OPEN, ConversationStatus.PENDING];

export const conversationInclude = {
  channel: { select: { id: true, type: true, name: true } },
  contact: { select: { id: true, name: true, email: true, phone: true, stage: true } },
  assignee: { select: { id: true, displayName: true, user: { select: { name: true } } } },
  team: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} as const satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;

const STATUS_WORDS: Record<ConversationStatus, string> = {
  OPEN: 'reopened',
  PENDING: 'marked this as waiting on the customer',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async list(actor: RequestActor, query: ListConversationsQueryDto) {
    const where: Prisma.ConversationWhereInput = {
      organizationId: actor.organizationId,
      ...this.statusFilter(query.status),
      ...(await this.viewFilter(actor, query.view)),
      handler: query.handler,
      channelId: query.channelId,
      contactId: query.contactId,
      ...(query.priority === 'high' && {
        priority: { in: [ConversationPriority.HIGH, ConversationPriority.URGENT] },
      }),
      ...(query.stage && { contact: { stage: query.stage } }),
      ...(query.tagId && { tags: { some: { tagId: query.tagId } } }),
    };

    const search = query.search?.trim();
    const and: Prisma.ConversationWhereInput[] = [];
    if (search) {
      and.push({
        OR: [
          { subject: { contains: search, mode: 'insensitive' } },
          { lastMessagePreview: { contains: search, mode: 'insensitive' } },
          { contact: { name: { contains: search, mode: 'insensitive' } } },
          { contact: { email: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.unread) {
      and.push({ id: { in: await this.unreadIds(actor) } });
    }
    if (query.cursor) {
      const { at, id } = decodeCursor(query.cursor);
      // Keyset on (lastMessageAt, id): stable even as new messages reorder the inbox.
      and.push({ OR: [{ lastMessageAt: { lt: at } }, { lastMessageAt: at, id: { lt: id } }] });
    }

    const rows = await this.prisma.conversation.findMany({
      where: { ...where, AND: and },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const unread = await this.unreadCounts(
      actor.memberId,
      page.map((c) => c.id),
    );
    const last = page.at(-1);
    return {
      data: page.map((c) => toConversationDto(c, unread.get(c.id) ?? 0)),
      nextCursor: hasMore && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    };
  }

  async counts(actor: RequestActor): Promise<InboxCountsDto> {
    const base = { organizationId: actor.organizationId, status: { in: OPEN_STATUSES } };
    const [all, mine, unassigned, team] = await Promise.all([
      this.prisma.conversation.count({ where: base }),
      this.prisma.conversation.count({
        where: { ...base, ...(await this.viewFilter(actor, 'mine')) },
      }),
      this.prisma.conversation.count({ where: { ...base, assigneeId: null } }),
      this.prisma.conversation.count({
        where: { ...base, ...(await this.viewFilter(actor, 'team')) },
      }),
    ]);
    return { all, mine, unassigned, team };
  }

  async get(actor: RequestActor, id: string): Promise<ConversationDto> {
    const row = await this.prisma.conversation.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: conversationInclude,
    });
    if (!row) throw errors.notFound();
    const unread = await this.unreadCounts(actor.memberId, [row.id]);
    return toConversationDto(row, unread.get(row.id) ?? 0);
  }

  async assign(actor: RequestActor, id: string, dto: AssignConversationDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await this.findOwned(tx, actor.organizationId, id);

      const assignee = dto.assigneeId
        ? await tx.organizationMember.findFirst({
            where: {
              id: dto.assigneeId,
              organizationId: actor.organizationId,
              status: MemberStatus.ACTIVE,
            },
            include: { user: { select: { name: true } } },
          })
        : null;
      if (dto.assigneeId && !assignee) throw errors.badAssignee();

      if (dto.teamId) {
        const team = await tx.team.count({
          where: { id: dto.teamId, organizationId: actor.organizationId },
        });
        if (!team) throw errors.badTeam();
      }

      const assigneeChanged = before.assigneeId !== (dto.assigneeId ?? null);
      const teamChanged = dto.teamId !== undefined && before.teamId !== dto.teamId;
      if (!assigneeChanged && !teamChanged) return null;

      await tx.conversation.update({
        where: { id },
        data: {
          assigneeId: dto.assigneeId,
          ...(dto.teamId !== undefined && { teamId: dto.teamId }),
        },
      });

      if (!assigneeChanged) return { messageId: null };
      const assigneeName = assignee ? (assignee.displayName ?? assignee.user.name) : null;
      const text = !assignee
        ? `${actor.label} unassigned this conversation`
        : assignee.id === actor.memberId
          ? `${actor.label} took this conversation`
          : `${actor.label} assigned this to ${assigneeName}`;
      const message = await this.systemMessage(tx, actor, id, text, {
        event: 'assigned',
        assigneeId: assignee?.id ?? null,
      });
      return { messageId: message.id };
    });

    if (result) this.emitUpdate(actor, id, ['assignee'], result.messageId);
    return this.get(actor, id);
  }

  async update(actor: RequestActor, id: string, dto: UpdateConversationDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await this.findOwned(tx, actor.organizationId, id);
      const statusChanged = dto.status !== undefined && dto.status !== before.status;
      const priorityChanged = dto.priority !== undefined && dto.priority !== before.priority;
      if (!statusChanged && !priorityChanged) return null;

      await tx.conversation.update({
        where: { id },
        data: {
          status: dto.status,
          priority: dto.priority,
          ...(statusChanged && {
            resolvedAt: dto.status === ConversationStatus.RESOLVED ? new Date() : null,
          }),
        },
      });

      let messageId: string | null = null;
      if (statusChanged) {
        const message = await this.systemMessage(
          tx,
          actor,
          id,
          `${actor.label} ${STATUS_WORDS[dto.status!]}`,
          { event: 'status', from: before.status, to: dto.status },
        );
        messageId = message.id;
      }
      const changes: ConversationUpdatedEvent['changes'] = [];
      if (statusChanged) changes.push('status');
      if (priorityChanged) changes.push('priority');
      return { changes, messageId };
    });

    if (result) this.emitUpdate(actor, id, result.changes, result.messageId);
    return this.get(actor, id);
  }

  async setTags(actor: RequestActor, id: string, tagIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      await this.findOwned(tx, actor.organizationId, id);
      const unique = [...new Set(tagIds)];
      const found = await tx.tag.count({
        where: { id: { in: unique }, organizationId: actor.organizationId },
      });
      if (found !== unique.length) throw errors.unknownTags();
      await tx.conversationTag.deleteMany({
        where: { conversationId: id, tagId: { notIn: unique } },
      });
      await tx.conversationTag.createMany({
        data: unique.map((tagId) => ({ conversationId: id, tagId })),
        skipDuplicates: true,
      });
    });
    this.emitUpdate(actor, id, ['tags'], null);
    return this.get(actor, id);
  }

  async markRead(actor: RequestActor, id: string): Promise<void> {
    await this.findOwned(this.prisma, actor.organizationId, id);
    const now = new Date();
    await this.prisma.conversationRead.upsert({
      where: { conversationId_memberId: { conversationId: id, memberId: actor.memberId } },
      update: { lastReadAt: now },
      create: { conversationId: id, memberId: actor.memberId, lastReadAt: now },
    });
  }

  private async findOwned(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const row = await db.conversation.findFirst({ where: { id, organizationId } });
    if (!row) throw errors.notFound();
    return row;
  }

  private systemMessage(
    tx: Prisma.TransactionClient,
    actor: RequestActor,
    conversationId: string,
    body: string,
    metadata: Prisma.InputJsonValue,
  ) {
    return tx.message.create({
      data: {
        organizationId: actor.organizationId,
        conversationId,
        sender: MessageSender.SYSTEM,
        authorId: actor.memberId,
        body,
        metadata,
      },
    });
  }

  private emitUpdate(
    actor: RequestActor,
    conversationId: string,
    changes: ConversationUpdatedEvent['changes'],
    messageId: string | null,
  ) {
    this.events.emit(InboxEvents.conversationUpdated, {
      organizationId: actor.organizationId,
      conversationId,
      changes,
    } satisfies ConversationUpdatedEvent);
    if (messageId) {
      this.events.emit(InboxEvents.messageCreated, {
        organizationId: actor.organizationId,
        conversationId,
        messageId,
        internal: false,
        sender: 'SYSTEM',
      } satisfies MessageCreatedEvent);
    }
  }

  private statusFilter(status: ListConversationsQueryDto['status']): Prisma.ConversationWhereInput {
    if (status === 'all') return {};
    if (status === 'open') return { status: { in: OPEN_STATUSES } };
    return { status };
  }

  private async viewFilter(
    actor: RequestActor,
    view: InboxView,
  ): Promise<Prisma.ConversationWhereInput> {
    switch (view) {
      case 'mine':
        return { assigneeId: actor.memberId };
      case 'unassigned':
        return { assigneeId: null };
      case 'team': {
        const teams = await this.prisma.teamMember.findMany({
          where: { memberId: actor.memberId },
          select: { teamId: true },
        });
        return { teamId: { in: teams.map((t) => t.teamId) } };
      }
      default:
        return {};
    }
  }

  /** Conversations with a customer message newer than this member's read marker. */
  private async unreadIds(actor: RequestActor): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id"
      FROM "Conversation" c
      LEFT JOIN "ConversationRead" r
        ON r."conversationId" = c."id" AND r."memberId" = ${actor.memberId}::uuid
      WHERE c."organizationId" = ${actor.organizationId}::uuid
        AND c."lastInboundAt" IS NOT NULL
        AND c."lastInboundAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp)`;
    return rows.map((r) => r.id);
  }

  /** One query for the whole page instead of one count per conversation. */
  private async unreadCounts(memberId: string, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ conversationId: string; count: bigint }[]>`
      SELECT m."conversationId", COUNT(*) AS count
      FROM "Message" m
      LEFT JOIN "ConversationRead" r
        ON r."conversationId" = m."conversationId" AND r."memberId" = ${memberId}::uuid
      WHERE m."conversationId" = ANY(${ids}::uuid[])
        AND m."sender" = 'CONTACT'
        AND m."createdAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp)
      GROUP BY m."conversationId"`;
    return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime())) throw errors.badCursor();
  return { at, id };
}

export function toConversationDto(c: ConversationRow, unreadCount: number): ConversationDto {
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    handler: c.handler,
    priority: c.priority,
    escalationReason: c.escalationReason,
    channel: c.channel,
    contact: {
      id: c.contact.id,
      displayName: displayName(c.contact),
      email: c.contact.email,
      stage: c.contact.stage,
    },
    assignee: c.assignee
      ? { id: c.assignee.id, name: c.assignee.displayName ?? c.assignee.user.name }
      : null,
    team: c.team,
    tags: c.tags.map((t) => t.tag),
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    unreadCount,
    createdAt: c.createdAt,
  };
}
