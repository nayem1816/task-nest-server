import { OnEvent } from '@nestjs/event-emitter';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ChannelType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { InboxEvents, type MessageCreatedEvent } from '../inbox/inbox.events.js';
import { type VisitorClaims, VisitorTokenService } from './visitor-token.service.js';

interface WidgetServerEvents {
  /** Something new in the visitor's chat; the widget refetches its history. */
  'message.created': (event: { messageId: string }) => void;
}

type WidgetNamespace = Namespace<object, WidgetServerEvents, object, VisitorClaims>;
type WidgetSocket = Socket<object, WidgetServerEvents, object, VisitorClaims>;

const visitorRoom = (channelId: string, visitorId: string) => `visitor:${channelId}:${visitorId}`;

/**
 * The visitor's side of realtime, on its own namespace so a visitor token can
 * never join a member room. A visitor only ever hears about their own chat.
 */
@WebSocketGateway({ namespace: '/widget' })
export class WidgetGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() private readonly server?: WidgetNamespace;

  constructor(
    private readonly tokens: VisitorTokenService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(namespace: WidgetNamespace): void {
    namespace.use((socket, next) => {
      const auth: unknown = socket.handshake.auth;
      const token =
        typeof auth === 'object' && auth !== null && 'visitorToken' in auth
          ? auth.visitorToken
          : null;
      void (typeof token === 'string' ? this.tokens.verify(token) : Promise.resolve(null)).then(
        (claims) => {
          if (!claims) {
            return next(
              Object.assign(new Error('UNAUTHENTICATED'), { data: { code: 'UNAUTHENTICATED' } }),
            );
          }
          socket.data = claims;
          next();
        },
        () => next(new Error('Could not open the chat connection.')),
      );
    });
  }

  async handleConnection(socket: WidgetSocket): Promise<void> {
    await socket.join(visitorRoom(socket.data.channelId, socket.data.visitorId));
  }

  @OnEvent(InboxEvents.messageCreated)
  async onMessageCreated(event: MessageCreatedEvent): Promise<void> {
    // Internal notes and system lines ("Sam took this conversation") are for the team.
    if (event.internal || event.sender === 'SYSTEM' || !this.server) return;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: event.conversationId },
      select: {
        channelId: true,
        channel: { select: { type: true } },
        contact: {
          select: {
            identities: {
              where: { channel: ChannelType.WEBSITE_CHAT },
              select: { externalId: true },
            },
          },
        },
      },
    });
    if (conversation?.channel.type !== ChannelType.WEBSITE_CHAT) return;

    for (const { externalId } of conversation.contact.identities) {
      this.server
        .to(visitorRoom(conversation.channelId, externalId))
        .emit('message.created', { messageId: event.messageId });
    }
  }
}
