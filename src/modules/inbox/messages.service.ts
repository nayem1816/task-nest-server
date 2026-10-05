import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppException } from '../../common/http/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ConversationHandler,
  ConversationStatus,
  MessageSender,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import { ContactActivityService } from '../contacts/contact-activity.service.js';
import type { MessageDto } from './inbox.dto.js';
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
};

const PREVIEW_LENGTH = 140;

const messageInclude = {
  author: { select: { id: true, displayName: true, user: { select: { name: true } } } },
} as const satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export interface InboundMessage {
  organizationId: string;
  channelId: string;
  contactId: string;
  body: string;
  subject?: string;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ContactActivityService,
    private readonly events: EventEmitter2,
  ) {}

  /** Newest page first in the database, returned oldest first for rendering. */
  async list(actor: RequestActor, conversationId: string, limit: number, before?: string) {
    await this.assertConversation(actor.organizationId, conversationId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...(before && { id: { lt: before } }) },
      include: messageInclude,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
    return {
      data: page.map(toMessageDto),
      nextBefore: hasMore ? (page[0]?.id ?? null) : null,
    };
  }

  /**
   * A reply or internal note from a team member. A customer-facing reply also
   * takes the conversation over from the AI, reopens it if it was closed, and
   * picks it up for the sender if nobody owned it.
   */
  async send(actor: RequestActor, conversationId: string, body: string, internal: boolean) {
    const now = new Date();
    const { message, pickedUp, changes } = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, organizationId: actor.organizationId },
      });
      if (!conversation) throw errors.notFound();

      // Recorded before the reply so the thread reads in order.
      const pickUp = !internal && conversation.assigneeId === null;
      const pickedUp = pickUp
        ? await tx.message.create({
            data: {
              organizationId: actor.organizationId,
              conversationId,
              sender: MessageSender.SYSTEM,
              authorId: actor.memberId,
              body: `${actor.label} took this conversation`,
              metadata: { event: 'assigned', assigneeId: actor.memberId },
            },
            select: { id: true },
          })
        : null;

      const message = await tx.message.create({
        data: {
          organizationId: actor.organizationId,
          conversationId,
          sender: MessageSender.MEMBER,
          authorId: actor.memberId,
          internal,
          body,
        },
        include: messageInclude,
      });

      const changes: ConversationUpdatedEvent['changes'] = [];
      if (!internal) {
        const reopen =
          conversation.status === ConversationStatus.RESOLVED ||
          conversation.status === ConversationStatus.CLOSED;
        const takeOver = conversation.handler !== ConversationHandler.HUMAN_HANDLING;
        if (reopen) changes.push('status');
        if (takeOver) changes.push('handler');
        if (pickUp) changes.push('assignee');

        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: now,
            lastMessagePreview: preview(body),
            firstResponseAt: conversation.firstResponseAt ?? now,
            ...(reopen && { status: ConversationStatus.OPEN, resolvedAt: null }),
            ...(takeOver && { handler: ConversationHandler.HUMAN_HANDLING }),
            ...(pickUp && { assigneeId: actor.memberId }),
          },
        });
      }

      // Writing in a conversation means you have read it.
      await tx.conversationRead.upsert({
        where: { conversationId_memberId: { conversationId, memberId: actor.memberId } },
        update: { lastReadAt: now },
        create: { conversationId, memberId: actor.memberId, lastReadAt: now },
      });
      return { message, pickedUp, changes };
    });

    if (pickedUp)
      this.emitMessage(actor.organizationId, conversationId, pickedUp.id, false, 'SYSTEM');
    this.emitMessage(actor.organizationId, conversationId, message.id, internal, 'MEMBER');
    if (changes.length > 0) this.emitUpdate(actor.organizationId, conversationId, changes);
    return toMessageDto(message);
  }

  /**
   * A message from a customer, from any channel. It continues their open
   * conversation on that channel, or starts a new one. Channel adapters call
   * this; it is not exposed over the agent API.
   */
  async receiveInbound(input: InboundMessage) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          organizationId: input.organizationId,
          channelId: input.channelId,
          contactId: input.contactId,
          status: { not: ConversationStatus.CLOSED },
        },
        orderBy: { lastMessageAt: 'desc' },
      });

      const conversation =
        existing ??
        (await tx.conversation.create({
          data: {
            organizationId: input.organizationId,
            channelId: input.channelId,
            contactId: input.contactId,
            subject: input.subject,
          },
        }));

      const message = await tx.message.create({
        data: {
          organizationId: input.organizationId,
          conversationId: conversation.id,
          sender: MessageSender.CONTACT,
          body: input.body,
        },
      });

      const reopened = existing?.status === ConversationStatus.RESOLVED;
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          lastInboundAt: now,
          lastMessagePreview: preview(input.body),
          ...(reopened && { status: ConversationStatus.OPEN, resolvedAt: null }),
        },
      });
      await tx.contact.update({ where: { id: input.contactId }, data: { lastSeenAt: now } });

      if (!existing) {
        await this.activity.record(
          {
            organizationId: input.organizationId,
            contactId: input.contactId,
            type: 'conversation.started',
            metadata: { conversationId: conversation.id, excerpt: preview(input.body) },
          },
          tx,
        );
      }
      return {
        conversationId: conversation.id,
        messageId: message.id,
        created: !existing,
        reopened,
      };
    });

    this.emitMessage(
      input.organizationId,
      result.conversationId,
      result.messageId,
      false,
      'CONTACT',
    );
    const changes: ConversationUpdatedEvent['changes'] = [];
    if (result.created) changes.push('created');
    if (result.reopened) changes.push('status');
    if (changes.length > 0) this.emitUpdate(input.organizationId, result.conversationId, changes);
    return result;
  }

  private async assertConversation(organizationId: string, id: string) {
    const found = await this.prisma.conversation.count({ where: { id, organizationId } });
    if (!found) throw errors.notFound();
  }

  private emitMessage(
    organizationId: string,
    conversationId: string,
    messageId: string,
    internal: boolean,
    sender: MessageCreatedEvent['sender'],
  ) {
    this.events.emit(InboxEvents.messageCreated, {
      organizationId,
      conversationId,
      messageId,
      internal,
      sender,
    } satisfies MessageCreatedEvent);
  }

  private emitUpdate(
    organizationId: string,
    conversationId: string,
    changes: ConversationUpdatedEvent['changes'],
  ) {
    this.events.emit(InboxEvents.conversationUpdated, {
      organizationId,
      conversationId,
      changes,
    } satisfies ConversationUpdatedEvent);
  }
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

export function toMessageDto(m: MessageRow): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    internal: m.internal,
    body: m.body,
    author: m.author ? { id: m.author.id, name: m.author.displayName ?? m.author.user.name } : null,
    metadata: m.metadata as Record<string, unknown> | null,
    createdAt: m.createdAt,
  };
}
