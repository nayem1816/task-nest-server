import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import {
  ChannelStatus,
  ChannelType,
  ConversationStatus,
  MessageSender,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { originAllowed, readWebChatSettings } from '../channels/channel-settings.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { MessagesService } from '../inbox/messages.service.js';
import { type VisitorClaims, VisitorTokenService } from './visitor-token.service.js';
import type {
  SendWidgetMessageDto,
  StartWidgetSessionDto,
  WidgetMessageDto,
  WidgetSessionDto,
} from './widget.dto.js';

const HISTORY_LIMIT = 100;

const errors = {
  // One answer for unknown, turned-off and deleted: the key is public, so the
  // response should not say which.
  unavailable: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      'WIDGET_UNAVAILABLE',
      'This chat is not available right now.',
    ),
  origin: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'WIDGET_ORIGIN_NOT_ALLOWED',
      'This chat is not set up for this website.',
    ),
};

const visibleSenders = [MessageSender.CONTACT, MessageSender.MEMBER, MessageSender.AI];

@Injectable()
export class WidgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: VisitorTokenService,
    private readonly contacts: ContactsService,
    private readonly messages: MessagesService,
  ) {}

  async startSession(dto: StartWidgetSessionDto): Promise<WidgetSessionDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { publicKey: dto.key },
      include: { organization: { select: { name: true, deletedAt: true } } },
    });
    if (
      !channel ||
      channel.type !== ChannelType.WEBSITE_CHAT ||
      channel.status !== ChannelStatus.ACTIVE ||
      channel.organization.deletedAt
    ) {
      throw errors.unavailable();
    }
    const settings = readWebChatSettings(channel.settings);
    if (!originAllowed(settings.allowedOrigins, dto.pageOrigin ?? null)) throw errors.origin();

    const previous = dto.visitorToken ? await this.tokens.verify(dto.visitorToken) : null;
    const visitorId = previous?.channelId === channel.id ? previous.visitorId : randomUUID();
    const claims = { visitorId, channelId: channel.id, organizationId: channel.organizationId };

    const contact = await this.visitorContact(claims);
    return {
      visitorToken: await this.tokens.sign(claims),
      config: {
        workspaceName: channel.organization.name,
        greeting: settings.greeting,
        accentColor: settings.accentColor,
        askForEmail: settings.askForEmail,
      },
      visitor: { name: contact?.name ?? null, email: contact?.email ?? null },
    };
  }

  /** The visitor's current conversation. A closed one is over; the next message starts fresh. */
  async history(visitor: VisitorClaims): Promise<WidgetMessageDto[]> {
    const contact = await this.visitorContact(visitor);
    if (!contact) return [];
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        organizationId: visitor.organizationId,
        channelId: visitor.channelId,
        contactId: contact.id,
        status: { not: ConversationStatus.CLOSED },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    if (!conversation) return [];

    const rows = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, internal: false, sender: { in: visibleSenders } },
      orderBy: { id: 'desc' },
      take: HISTORY_LIMIT,
      include: {
        author: { select: { displayName: true, user: { select: { name: true } } } },
      },
    });
    return rows.reverse().map((m) => ({
      id: m.id,
      from:
        m.sender === MessageSender.CONTACT
          ? 'visitor'
          : m.sender === MessageSender.AI
            ? 'assistant'
            : 'team',
      authorName: m.author ? firstName(m.author.displayName ?? m.author.user.name) : null,
      body: m.body,
      createdAt: m.createdAt,
    }));
  }

  async send(visitor: VisitorClaims, dto: SendWidgetMessageDto): Promise<WidgetMessageDto> {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: visitor.channelId,
        organizationId: visitor.organizationId,
        status: ChannelStatus.ACTIVE,
        organization: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!channel) throw errors.unavailable();

    const contactId = await this.contacts.resolveChannelContact({
      organizationId: visitor.organizationId,
      channel: 'WEBSITE_CHAT',
      externalId: visitor.visitorId,
      name: dto.name,
      email: dto.email,
    });
    const { messageId } = await this.messages.receiveInbound({
      organizationId: visitor.organizationId,
      channelId: channel.id,
      contactId,
      body: dto.body,
    });
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    return {
      id: message.id,
      from: 'visitor',
      authorName: null,
      body: message.body,
      createdAt: message.createdAt,
    };
  }

  private async visitorContact(visitor: VisitorClaims) {
    const identity = await this.prisma.contactIdentity.findUnique({
      where: {
        organizationId_channel_externalId: {
          organizationId: visitor.organizationId,
          channel: ChannelType.WEBSITE_CHAT,
          externalId: visitor.visitorId,
        },
      },
      select: { contact: { select: { id: true, name: true, email: true } } },
    });
    return identity?.contact ?? null;
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
