import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/http/app-exception.js';
import type { Channel, Prisma } from '../../generated/prisma/client.js';
import { ChannelType, ConversationStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { RequestActor } from '../authorization/tenant.decorators.js';
import {
  newPublicKey,
  normalizeOrigin,
  readWebChatSettings,
  type WebChatSettings,
} from './channel-settings.js';
import type { ChannelDto, CreateWebsiteChannelDto, UpdateChannelDto } from './channels.dto.js';

const errors = {
  notFound: () =>
    new AppException(HttpStatus.NOT_FOUND, 'CHANNEL_NOT_FOUND', 'That channel does not exist.'),
  badOrigin: (value: string) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_ORIGIN',
      `"${value}" is not a website address. Use the form https://shop.example.com.`,
    ),
};

const OPEN_STATUSES = [ConversationStatus.OPEN, ConversationStatus.PENDING];

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<ChannelDto[]> {
    const channels = await this.prisma.channel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { conversations: { where: { status: { in: OPEN_STATUSES } } } } },
      },
    });
    return channels.map((c) => toChannelDto(c, c._count.conversations));
  }

  async createWebsite(actor: RequestActor, dto: CreateWebsiteChannelDto): Promise<ChannelDto> {
    const channel = await this.prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          organizationId: actor.organizationId,
          type: ChannelType.WEBSITE_CHAT,
          name: dto.name,
          publicKey: newPublicKey(),
          settings: readWebChatSettings({}),
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'channel.created',
          entityType: 'channel',
          entityId: created.id,
          metadata: { name: created.name, type: created.type },
        },
        tx,
      );
      return created;
    });
    return toChannelDto(channel, 0);
  }

  async update(actor: RequestActor, id: string, dto: UpdateChannelDto): Promise<ChannelDto> {
    const allowedOrigins = dto.allowedOrigins?.map((value) => {
      const origin = normalizeOrigin(value);
      if (!origin) throw errors.badOrigin(value);
      return origin;
    });

    const channel = await this.prisma.$transaction(async (tx) => {
      const current = await tx.channel.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!current) throw errors.notFound();

      const data: Prisma.ChannelUpdateInput = { name: dto.name, status: dto.status };
      const changed: string[] = [];
      if (dto.name !== undefined && dto.name !== current.name) changed.push('name');
      if (dto.status !== undefined && dto.status !== current.status) changed.push('status');

      if (current.type === ChannelType.WEBSITE_CHAT) {
        const before = readWebChatSettings(current.settings);
        const after: WebChatSettings = {
          greeting: dto.greeting ?? before.greeting,
          accentColor: dto.accentColor?.toLowerCase() ?? before.accentColor,
          allowedOrigins: allowedOrigins ? [...new Set(allowedOrigins)] : before.allowedOrigins,
          askForEmail: dto.askForEmail ?? before.askForEmail,
        };
        for (const key of Object.keys(after) as (keyof WebChatSettings)[]) {
          if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) changed.push(key);
        }
        data.settings = after;
      }

      const updated = await tx.channel.update({ where: { id: current.id }, data });
      if (changed.length > 0) {
        await this.audit.record(
          actor,
          {
            action: 'channel.updated',
            entityType: 'channel',
            entityId: current.id,
            metadata: { name: updated.name, changed },
          },
          tx,
        );
      }
      return updated;
    });

    const open = await this.prisma.conversation.count({
      where: { channelId: channel.id, status: { in: OPEN_STATUSES } },
    });
    return toChannelDto(channel, open);
  }
}

function toChannelDto(channel: Channel, openConversations: number): ChannelDto {
  const isWebChat = channel.type === ChannelType.WEBSITE_CHAT;
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    status: channel.status,
    publicKey: isWebChat ? channel.publicKey : null,
    webChat: isWebChat ? readWebChatSettings(channel.settings) : null,
    openConversations,
    createdAt: channel.createdAt,
  };
}
